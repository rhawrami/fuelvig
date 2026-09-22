# Data sources

Raw source files are stored unchanged under each domain's `raw/` directory.
Scripts will write stable, frontend-ready schemas under `processed/`.

## Gas prices

`prices/raw/gas_prices_db.json` was downloaded from the
[`jacobschulman/gas-tracker`](https://github.com/jacobschulman/gas-tracker)
historical database. That project collects national and state averages from
AAA Gas Prices. The snapshot metadata reports coverage from 2020-03-16 through
2026-09-21.

The upstream repository does not currently state a data license. Keep this
provenance attached to derived files and reassess reuse terms before a public
or commercial launch.

## Vehicles

`vehicles/raw/engines.csv` and the per-make files under the repository's
`json/` directory were downloaded from
[`gor3a/vehicle-makes-models`](https://github.com/gor3a/vehicle-makes-models).
The upstream project licenses its data under the Open Database License (ODbL)
v1.0 and requests attribution to both the project and autoevolution.com.

The CSV contains normalized engine and dimension fields, but it does not
contain fuel-tank capacity. The per-make JSON files retain a `specs` mapping
that sometimes includes `ENGINE SPECS / Fuel capacity`. `json/all.json`
duplicates the per-make files and is intentionally ignored by the normalizer.

Manually verified tank capacities belong in `vehicles/overrides.csv`, not in
the raw source file.

## Processed schemas

`prices/processed/prices.json` contains compact national and state time-series
arrays. Grade names and their array order are included in the file.

`prices/raw/daily/*.json` contains the validated values parsed during each AAA
update. These small semantic snapshots preserve the fetched result without
committing the source pages' unrelated markup, scripts, and advertisements.

`vehicles/processed/index.json` contains make-level counts and file slugs.
`vehicles/processed/by-make/*.json` contains models, generations, variants,
fuel economy, and normalized tank capacities. Splitting by make keeps the
initial browser download small.
