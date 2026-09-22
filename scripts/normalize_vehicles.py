"""Normalize vehicle specifications into frontend-friendly per-make JSON."""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = PROJECT_ROOT / "json"
DEFAULT_OUTPUT = PROJECT_ROOT / "data/vehicles/processed"
DEFAULT_OVERRIDES = PROJECT_ROOT / "data/vehicles/overrides.csv"
SOURCE_URL = "https://github.com/gor3a/vehicle-makes-models"
LITERS_PER_GALLON = 3.785411784
CAPACITY_PATTERN = re.compile(
    r"^\s*(?P<gallons>\d+(?:[.,]\d+)?) gallons "
    r"\((?P<liters>\d+(?:[.,]\d+)?) L\)\s*$"
)

OverrideKey = tuple[str, str, str, str]


def parse_capacity(raw_value: object) -> dict[str, Any] | None:
    if raw_value is None:
        return None
    if not isinstance(raw_value, str):
        return {"gallons": None, "liters": None, "status": "invalid", "raw": raw_value}

    match = CAPACITY_PATTERN.fullmatch(raw_value)
    if match is None:
        return {"gallons": None, "liters": None, "status": "invalid", "raw": raw_value}

    gallons = float(match.group("gallons").replace(",", "."))
    liters = float(match.group("liters").replace(",", "."))
    conversion_error = abs(gallons * LITERS_PER_GALLON - liters)
    status = "suspect" if gallons < 3 or gallons > 80 or conversion_error > 1 else "unverified"
    return {"gallons": gallons, "liters": liters, "status": status}


def load_overrides(path: Path = DEFAULT_OVERRIDES) -> dict[OverrideKey, dict[str, Any]]:
    overrides: dict[OverrideKey, dict[str, Any]] = {}
    with path.open(newline="") as source:
        for row_number, row in enumerate(csv.DictReader(source), start=2):
            if not any(row.values()):
                continue

            key = (
                row["make"].strip(),
                row["model"].strip(),
                row["generation"].strip(),
                row["engine_label"].strip(),
            )
            if not all(key):
                raise ValueError(f"Override row {row_number} has an incomplete vehicle key")
            if key in overrides:
                raise ValueError(f"Override row {row_number} duplicates {key}")

            liters = float(row["tank_capacity_l"])
            if liters <= 0:
                raise ValueError(f"Override row {row_number} has an invalid capacity")

            override: dict[str, Any] = {
                "gallons": round(liters / LITERS_PER_GALLON, 3),
                "liters": liters,
                "status": "verified",
                "source": row["source"].strip(),
                "verifiedAt": row["verified_at"].strip(),
            }
            notes = row["notes"].strip()
            if notes:
                override["notes"] = notes
            overrides[key] = override

    return overrides


def _normalize_variant(
    make_name: str,
    model_name: str,
    generation_name: str,
    engine: dict[str, Any],
    overrides: dict[OverrideKey, dict[str, Any]],
) -> dict[str, Any]:
    engine_label = engine["label"]
    specs = engine.get("specs") or {}
    override_key = (make_name, model_name, generation_name, engine_label)
    capacity = overrides.get(override_key) or parse_capacity(
        specs.get("ENGINE SPECS / Fuel capacity")
    )

    variant = {
        "engine": engine_label,
        "fuelType": engine.get("fuelType"),
        "transmission": engine.get("transmission"),
        "drivetrain": engine.get("drivetrain"),
        "combinedLitersPer100Km": engine.get("fuelEconomyCombinedL100"),
        "tankCapacity": capacity,
    }

    optional_capacity = parse_capacity(specs.get("ENGINE SPECS / Fuel capacity (optional)"))
    if optional_capacity is not None:
        variant["optionalTankCapacity"] = optional_capacity

    return variant


def _normalize_make(
    source_make: dict[str, Any],
    slug: str,
    overrides: dict[OverrideKey, dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    make_name = source_make["name"]
    models = []
    variant_count = 0
    capacity_count = 0
    suspect_count = 0

    for source_model in source_make["models"]:
        generations = []
        for source_generation in source_model.get("generations", []):
            variants = []
            for engine in source_generation["engines"]:
                variant = _normalize_variant(
                    make_name,
                    source_model["name"],
                    source_generation["name"],
                    engine,
                    overrides,
                )
                capacity = variant["tankCapacity"]
                variant_count += 1
                if capacity is not None:
                    capacity_count += 1
                    if capacity["status"] in {"invalid", "suspect"}:
                        suspect_count += 1
                variants.append(variant)

            generations.append(
                {
                    "name": source_generation["name"],
                    "yearStart": source_generation.get("yearStart"),
                    "yearEnd": source_generation.get("yearEnd"),
                    "bodyType": source_generation.get("bodyType"),
                    "variants": variants,
                }
            )

        models.append(
            {
                "name": source_model["name"],
                "yearStart": source_model.get("yearStart"),
                "yearEnd": source_model.get("yearEnd"),
                "generations": generations,
            }
        )

    output = {
        "schemaVersion": 1,
        "source": {"name": "gor3a/vehicle-makes-models", "url": SOURCE_URL},
        "slug": slug,
        "name": make_name,
        "models": models,
    }
    year_starts = [model["yearStart"] for model in models if model["yearStart"] is not None]
    index_entry = {
        "slug": slug,
        "name": make_name,
        "yearStart": min(year_starts) if year_starts else None,
        "yearEnd": (
            None
            if any(model["yearEnd"] is None for model in models)
            else max(model["yearEnd"] for model in models)
        ),
        "modelCount": len(models),
        "variantCount": variant_count,
        "withTankCapacity": capacity_count,
        "suspectTankCapacity": suspect_count,
    }
    return output, index_entry


def normalize_vehicles(
    input_directory: Path = DEFAULT_INPUT,
    overrides_path: Path = DEFAULT_OVERRIDES,
) -> tuple[list[tuple[str, dict[str, Any]]], dict[str, Any]]:
    overrides = load_overrides(overrides_path)
    make_outputs: list[tuple[str, dict[str, Any]]] = []
    index_entries = []
    seen_slugs: set[str] = set()

    source_paths = sorted(
        path for path in input_directory.glob("*.json") if path.name != "all.json"
    )
    if not source_paths:
        raise ValueError(f"No per-make JSON files found in {input_directory}")

    for source_path in source_paths:
        group = json.loads(source_path.read_text())
        slug = group["group"]
        makes = group["makes"]
        if len(makes) != 1:
            raise ValueError(f"Expected one make in {source_path}, found {len(makes)}")
        if slug in seen_slugs:
            raise ValueError(f"Duplicate vehicle group slug: {slug}")
        seen_slugs.add(slug)

        make_output, index_entry = _normalize_make(makes[0], slug, overrides)
        make_outputs.append((slug, make_output))
        index_entries.append(index_entry)

    unused_overrides = set(overrides) - {
        (
            make_output["name"],
            model["name"],
            generation["name"],
            variant["engine"],
        )
        for _, make_output in make_outputs
        for model in make_output["models"]
        for generation in model["generations"]
        for variant in generation["variants"]
    }
    if unused_overrides:
        raise ValueError(f"Overrides did not match source vehicles: {sorted(unused_overrides)}")

    index_entries.sort(key=lambda entry: (entry["name"].casefold(), entry["slug"]))
    index = {
        "schemaVersion": 1,
        "source": {"name": "gor3a/vehicle-makes-models", "url": SOURCE_URL},
        "makeCount": len(index_entries),
        "modelCount": sum(entry["modelCount"] for entry in index_entries),
        "variantCount": sum(entry["variantCount"] for entry in index_entries),
        "withTankCapacity": sum(entry["withTankCapacity"] for entry in index_entries),
        "suspectTankCapacity": sum(entry["suspectTankCapacity"] for entry in index_entries),
        "makes": index_entries,
    }
    return make_outputs, index


def write_vehicles(
    make_outputs: list[tuple[str, dict[str, Any]]],
    index: dict[str, Any],
    output_directory: Path = DEFAULT_OUTPUT,
) -> None:
    by_make_directory = output_directory / "by-make"
    by_make_directory.mkdir(parents=True, exist_ok=True)
    expected_paths = set()

    for slug, output in make_outputs:
        output_path = by_make_directory / f"{slug}.json"
        output_path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
        expected_paths.add(output_path)

    for existing_path in by_make_directory.glob("*.json"):
        if existing_path not in expected_paths:
            existing_path.unlink()

    (output_directory / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES)
    arguments = parser.parse_args()

    make_outputs, index = normalize_vehicles(arguments.input, arguments.overrides)
    write_vehicles(make_outputs, index, arguments.output)
    print(
        f"Wrote {index['variantCount']} variants across {index['makeCount']} makes "
        f"to {arguments.output}"
    )


if __name__ == "__main__":
    main()
