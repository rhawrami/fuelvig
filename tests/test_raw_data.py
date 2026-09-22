import csv
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_gas_price_snapshot_has_expected_shape() -> None:
    path = PROJECT_ROOT / "data/prices/raw/gas_prices_db.json"
    database = json.loads(path.read_text())

    assert set(database) == {"metadata", "national", "states"}

    latest_date = database["metadata"]["lastDate"]
    assert latest_date in database["national"]
    assert latest_date in database["states"]
    assert len(database["states"][latest_date]) == 51
    assert {"regular", "midGrade", "premium", "diesel"} <= set(database["national"][latest_date])


def test_vehicle_snapshot_has_expected_columns() -> None:
    path = PROJECT_ROOT / "data/vehicles/raw/engines.csv"
    with path.open(newline="") as source:
        columns = set(next(csv.reader(source)))

    assert {
        "make",
        "model",
        "generation",
        "gen_year_start",
        "gen_year_end",
        "engine_label",
        "fuel_type",
    } <= columns
