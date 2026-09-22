import json

from scripts.normalize_prices import DEFAULT_OUTPUT as PRICES_OUTPUT
from scripts.normalize_vehicles import DEFAULT_OUTPUT as VEHICLES_OUTPUT
from scripts.normalize_vehicles import parse_capacity


def test_capacity_parser_normalizes_source_units() -> None:
    assert parse_capacity("12.7 gallons (48.1 L)") == {
        "gallons": 12.7,
        "liters": 48.1,
        "status": "unverified",
    }
    assert parse_capacity("18,8 gallons (68.1 L)") == {
        "gallons": 18.8,
        "liters": 68.1,
        "status": "suspect",
    }


def test_capacity_parser_flags_implausible_and_invalid_values() -> None:
    assert parse_capacity("2.7 gallons (10.2 L)")["status"] == "suspect"
    assert parse_capacity("111 gallons (420.2 L)")["status"] == "suspect"
    assert parse_capacity("not a capacity") == {
        "gallons": None,
        "liters": None,
        "status": "invalid",
        "raw": "not a capacity",
    }
    assert parse_capacity(None) is None


def test_processed_price_data_has_expected_shape() -> None:
    prices = json.loads(PRICES_OUTPUT.read_text())

    assert prices["schemaVersion"] == 1
    assert prices["stateGrades"] == ["regular", "midGrade", "premium", "diesel"]
    assert len(prices["states"]) == 51
    assert prices["national"] == sorted(prices["national"], key=lambda row: row[0])


def test_processed_vehicle_index_matches_make_files() -> None:
    index = json.loads((VEHICLES_OUTPUT / "index.json").read_text())
    make_paths = list((VEHICLES_OUTPUT / "by-make").glob("*.json"))

    assert index["schemaVersion"] == 1
    assert index["makeCount"] == len(index["makes"]) == len(make_paths)
    assert index["variantCount"] == 30_390
    assert index["withTankCapacity"] == 22_498
