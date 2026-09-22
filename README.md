# Gas Prices

A static gas-price tracker and vehicle fill-up cost calculator. Python scripts
collect and normalize source data, while the browser frontend is deployed from
a custom GitHub Pages artifact.

## Project layout

```text
data/
  prices/
    raw/          Original downloaded and scraped price data
    processed/    Normalized data consumed by the frontend
  vehicles/
    raw/          Original downloaded vehicle data
    processed/    Normalized vehicle data consumed by the frontend
    overrides.csv Manually verified vehicle corrections
docs/             Static HTML, CSS, and JavaScript frontend
json/             Upstream per-make vehicle specification JSON
scripts/          Data collection, normalization, and validation scripts
tests/            Python tests
```

Files under `data/*/raw` are retained so parsing and normalization can be
reproduced. Generated files should be deterministic and should not overwrite
the original source data.

## Development

Install Python and development dependencies with [uv](https://docs.astral.sh/uv/):

```sh
uv sync
```

Run the checks with:

```sh
uv run ruff check .
uv run pytest
```

The GitHub Pages workflow will eventually package `docs/` together with the
normalized files under `data/processed`; data outside `docs/` is not published
by the standard Pages-from-branch configuration.

## Normalize data

Generate the frontend price and vehicle files with:

```sh
uv run python -m scripts.normalize_prices
uv run python -m scripts.normalize_vehicles
```

Prices are written to `data/prices/processed/prices.json`. Its time-series rows
are arrays whose value order is declared by `nationalGrades` and `stateGrades`.

Vehicles are split between `data/vehicles/processed/index.json` and one file
per make under `data/vehicles/processed/by-make/`. The frontend can load the
small index first and fetch a make only after the user selects it. Source tank
capacities are marked `unverified`; implausible or inconsistent values are
marked `suspect`; entries from `data/vehicles/overrides.csv` are marked
`verified`.

## Update prices

Fetch the current AAA national and state averages, validate them, update the
historical database, save a dated parsed snapshot, and rebuild frontend data:

```sh
uv run python -m scripts.update_prices
```

The updater requests AAA with browser-compatible headers and observes AAA's
10-second crawl delay. If AAA blocks the runner, it uses the static latest-price
endpoint from the attributed `jacobschulman/gas-tracker` source. Both paths
require all 50 states plus DC and every expected grade before writing data.
Rerunning it for unchanged prices is idempotent.

Run the parser and update-pipeline fixtures without network access using:

```sh
uv run pytest tests/test_update_prices.py
```

The command also accepts `--home-html` and `--states-html` when debugging with
complete saved pages.

GitHub Actions runs this update daily at 16:30 UTC and can also be started
manually from the Actions tab. The workflow commits only validated changes
under `data/prices/`. Pull requests and pushes to `main` run lint, formatting,
and tests through the separate CI workflow.
