"""Normalize the historical gas-price database for the static frontend."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = PROJECT_ROOT / "data/prices/raw/gas_prices_db.json"
DEFAULT_OUTPUT = PROJECT_ROOT / "data/prices/processed/prices.json"
NATIONAL_GRADES = ("regular", "midGrade", "premium", "diesel", "e85")
STATE_GRADES = ("regular", "midGrade", "premium", "diesel")


def _validate_date(value: str) -> None:
    try:
        date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"Invalid price date: {value}") from error


def _price(value: Any, *, location: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"Price at {location} is not numeric: {value!r}")
    if not 0 < value < 20:
        raise ValueError(f"Price at {location} is outside the expected range: {value}")
    return float(value)


def normalize_prices(input_path: Path = DEFAULT_INPUT) -> dict[str, Any]:
    database = json.loads(input_path.read_text())
    if set(database) != {"metadata", "national", "states"}:
        raise ValueError("Price database must contain metadata, national, and states")

    metadata = database["metadata"]
    national = database["national"]
    states_by_date = database["states"]

    national_rows = []
    for price_date in sorted(national):
        _validate_date(price_date)
        values = national[price_date]
        national_rows.append(
            [price_date]
            + [
                _price(values.get(grade), location=f"national/{price_date}/{grade}")
                for grade in NATIONAL_GRADES
            ]
        )

    state_codes = sorted(
        {state_code for daily_states in states_by_date.values() for state_code in daily_states}
    )
    state_rows: dict[str, list[list[Any]]] = {state_code: [] for state_code in state_codes}

    for price_date in sorted(states_by_date):
        _validate_date(price_date)
        for state_code, values in sorted(states_by_date[price_date].items()):
            state_rows[state_code].append(
                [price_date]
                + [
                    _price(
                        values.get(grade),
                        location=f"states/{state_code}/{price_date}/{grade}",
                    )
                    for grade in STATE_GRADES
                ]
            )

    last_date = metadata["lastDate"]
    if last_date not in states_by_date or len(states_by_date[last_date]) != 51:
        raise ValueError("Latest price date must contain all 50 states and DC")

    return {
        "schemaVersion": 1,
        "source": {
            "name": "AAA Gas Prices",
            "url": "https://gasprices.aaa.com/",
            "historicalBackfill": "https://github.com/jacobschulman/gas-tracker",
            "lastUpdated": metadata["lastUpdated"],
        },
        "firstDate": metadata["firstDate"],
        "lastDate": last_date,
        "nationalGrades": list(NATIONAL_GRADES),
        "stateGrades": list(STATE_GRADES),
        "national": national_rows,
        "states": state_rows,
    }


def write_prices(output: dict[str, Any], output_path: Path = DEFAULT_OUTPUT) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()

    output = normalize_prices(arguments.input)
    write_prices(output, arguments.output)
    print(
        f"Wrote {len(output['national'])} national dates and "
        f"{len(output['states'])} jurisdictions to {arguments.output}"
    )


if __name__ == "__main__":
    main()
