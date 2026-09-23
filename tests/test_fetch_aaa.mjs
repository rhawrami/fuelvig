import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

const execFileAsync = promisify(execFile);
const scriptPath = resolve("scripts/fetch_aaa.mjs");

async function listen(server) {
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

test("fetches both AAA pages with the expected request behavior", async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, headers: request.headers });
    const body = request.url === "/" ? "national page" : "states page";
    response.writeHead(200, { "Content-Encoding": "gzip" });
    response.end(gzipSync(body));
  });
  const baseUrl = await listen(server);
  const directory = await mkdtemp(join(tmpdir(), "gas-prices-"));
  const homePath = join(directory, "home.html");
  const statesPath = join(directory, "states.html");

  try {
    const result = await execFileAsync(process.execPath, [scriptPath, homePath, statesPath], {
      env: {
        ...process.env,
        AAA_HOME_URL: `${baseUrl}/`,
        AAA_STATES_URL: `${baseUrl}/states`,
        AAA_CRAWL_DELAY_MS: "0",
      },
    });

    assert.match(result.stdout, /Fetched AAA national and state pages directly/);
    assert.equal(await readFile(homePath, "utf8"), "national page");
    assert.equal(await readFile(statesPath, "utf8"), "states page");
    assert.deepEqual(
      requests.map((request) => request.url),
      ["/", "/states"],
    );
    assert.match(requests[0].headers["user-agent"], /fuelvig/);
    assert.equal(requests[0].headers["accept-encoding"], "gzip, deflate");
  } finally {
    await close(server);
    await rm(directory, { recursive: true });
  }
});

test("fails without writing files when AAA rejects a request", async () => {
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/" ? 200 : 403);
    response.end("response");
  });
  const baseUrl = await listen(server);
  const directory = await mkdtemp(join(tmpdir(), "gas-prices-"));
  const homePath = join(directory, "home.html");
  const statesPath = join(directory, "states.html");

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath, homePath, statesPath], {
        env: {
          ...process.env,
          AAA_HOME_URL: `${baseUrl}/`,
          AAA_STATES_URL: `${baseUrl}/states`,
          AAA_CRAWL_DELAY_MS: "0",
        },
      }),
      /Failed to fetch.*403/,
    );
    await assert.rejects(readFile(homePath), { code: "ENOENT" });
    await assert.rejects(readFile(statesPath), { code: "ENOENT" });
  } finally {
    await close(server);
    await rm(directory, { recursive: true });
  }
});
