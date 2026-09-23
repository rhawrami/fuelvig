import { writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzip, inflate } from "node:zlib";
import { promisify } from "node:util";

const DEFAULT_HOME_URL = "https://gasprices.aaa.com/";
const DEFAULT_STATES_URL = "https://gasprices.aaa.com/state-gas-price-averages/";
const DEFAULT_CRAWL_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = "fuelvig/1.0 (+https://github.com/rhawrami/fuelvig)";

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);

async function decodeBody(response, body) {
  const encoding = response.headers["content-encoding"]?.toLowerCase();
  if (encoding === "gzip") {
    return gunzipAsync(body);
  }
  if (encoding === "deflate") {
    return inflateAsync(body);
  }
  return body;
}

export function fetchPage(url, redirectsRemaining = MAX_REDIRECTS) {
  return new Promise((resolvePromise, reject) => {
    const parsedUrl = new URL(url);
    const get = parsedUrl.protocol === "http:" ? httpGet : httpsGet;
    const request = get(
      parsedUrl,
      {
        headers: {
          Accept: "*/*",
          "Accept-Encoding": "gzip, deflate",
          "User-Agent": USER_AGENT,
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (redirectsRemaining === 0) {
            reject(new Error(`Too many redirects fetching ${url}`));
            return;
          }
          const redirectUrl = new URL(response.headers.location, parsedUrl).toString();
          resolvePromise(fetchPage(redirectUrl, redirectsRemaining - 1));
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Failed to fetch ${url}: ${status} ${response.statusMessage ?? ""}`));
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", async () => {
          try {
            const body = await decodeBody(response, Buffer.concat(chunks));
            resolvePromise(body.toString("utf8"));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Timed out fetching ${url}`));
    });
    request.on("error", reject);
  });
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function main() {
  const [homePath, statesPath] = process.argv.slice(2);
  if (!homePath || !statesPath) {
    throw new Error("Usage: node scripts/fetch_aaa.mjs HOME_PATH STATES_PATH");
  }

  const homeUrl = process.env.AAA_HOME_URL ?? DEFAULT_HOME_URL;
  const statesUrl = process.env.AAA_STATES_URL ?? DEFAULT_STATES_URL;
  const crawlDelay = Number.parseInt(
    process.env.AAA_CRAWL_DELAY_MS ?? String(DEFAULT_CRAWL_DELAY_MS),
    10,
  );
  if (!Number.isInteger(crawlDelay) || crawlDelay < 0) {
    throw new Error("AAA_CRAWL_DELAY_MS must be a non-negative integer");
  }

  const homeHtml = await fetchPage(homeUrl);
  await sleep(crawlDelay);
  const statesHtml = await fetchPage(statesUrl);
  await Promise.all([writeFile(homePath, homeHtml), writeFile(statesPath, statesHtml)]);
  console.log("Fetched AAA national and state pages directly");
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
