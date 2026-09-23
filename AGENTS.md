# Fuel Vig

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

The GitHub Pages workflow packages `docs/` together with the normalized files
under `data/processed`; data outside `docs/` is not published.

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

The updater requires all 50 states plus DC and every expected grade before
writing data. Rerunning it for unchanged prices is idempotent. GitHub Actions
fetches the two AAA pages directly with Node's HTTPS client, observes AAA's
10-second crawl delay, and passes the saved pages to the Python updater.

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

## Frontend

Build the two-page static site and copy only its processed data dependencies:

```sh
uv run python -m scripts.build_site
```

Preview the generated artifact from the repository root:

```sh
uv run python -m http.server --directory _site 8000
```

Then open `http://localhost:8000/`. The frontend uses D3 for its price-history
and calculator figures. Its calculation rules are tested independently with:

```sh
node --test tests/test_calculations.mjs
```

Pushes to `main` build the same `_site` artifact and deploy it through the
GitHub Pages workflow. The repository's Pages source must be set to GitHub
Actions.
