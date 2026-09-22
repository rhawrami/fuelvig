"""Fetch current AAA prices, update history, and rebuild frontend data."""

from __future__ import annotations

import argparse
import json
import re
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
from bs4 import BeautifulSoup

from scripts.normalize_prices import DEFAULT_INPUT, DEFAULT_OUTPUT, normalize_prices, write_prices

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_DIRECTORY = PROJECT_ROOT / "data/prices/raw/daily"
AAA_HOME_URL = "https://gasprices.aaa.com/"
AAA_STATES_URL = "https://gasprices.aaa.com/state-gas-price-averages/"
AAA_CRAWL_DELAY_SECONDS = 10
NATIONAL_GRADES = ("regular", "midGrade", "premium", "diesel", "e85")
STATE_GRADES = ("regular", "midGrade", "premium", "diesel")
STATE_CODES = frozenset(
    {
        "AK",
        "AL",
        "AR",
        "AZ",
        "CA",
        "CO",
        "CT",
        "DC",
        "DE",
        "FL",
        "GA",
        "HI",
        "IA",
        "ID",
        "IL",
        "IN",
        "KS",
        "KY",
        "LA",
        "MA",
        "MD",
        "ME",
        "MI",
        "MN",
        "MO",
        "MS",
        "MT",
        "NC",
        "ND",
        "NE",
        "NH",
        "NJ",
        "NM",
        "NV",
        "NY",
        "OH",
        "OK",
        "OR",
        "PA",
        "RI",
        "SC",
        "SD",
        "TN",
        "TX",
        "UT",
        "VA",
        "VT",
        "WA",
        "WI",
        "WV",
        "WY",
    }
)
DATE_PATTERN = re.compile(r"Price as of\s+(\d{1,2}/\d{1,2}/\d{2})", re.IGNORECASE)
GRADE_NAMES = {
    "regular": "regular",
    "mid-grade": "midGrade",
    "mid": "midGrade",
    "premium": "premium",
    "diesel": "diesel",
    "e85": "e85",
}


@dataclass(frozen=True)
class PriceScrape:
    price_date: date
    national: dict[str, float]
    states: dict[str, dict[str, float]]


def _parse_date(soup: BeautifulSoup) -> date:
    match = DATE_PATTERN.search(soup.get_text(" ", strip=True))
    if match is None:
        raise ValueError("AAA page does not contain a 'Price as of' date")
    month, day, short_year = (int(part) for part in match.group(1).split("/"))
    return date(2000 + short_year, month, day)


def _parse_price(value: str, *, location: str) -> float:
    normalized = value.strip().replace("$", "").replace(",", "")
    try:
        price = float(normalized)
    except ValueError as error:
        raise ValueError(f"Invalid price at {location}: {value!r}") from error
    if not 0 < price < 20:
        raise ValueError(f"Price at {location} is outside the expected range: {price}")
    return price


def parse_national_page(html: str) -> tuple[date, dict[str, float]]:
    soup = BeautifulSoup(html, "lxml")
    price_date = _parse_date(soup)
    heading = next(
        (
            candidate
            for candidate in soup.select("h1.nati")
            if candidate.find("span")
            and candidate.find("span").get_text(" ", strip=True).casefold() == "national"
        ),
        None,
    )
    if heading is None:
        raise ValueError("AAA national average heading was not found")

    table = heading.find_next("table", class_="table-mob")
    if table is None:
        raise ValueError("AAA national price table was not found")

    headers = [cell.get_text(" ", strip=True).casefold() for cell in table.select("thead th")]
    current_row = next(
        (
            row
            for row in table.select("tbody tr")
            if row.find("td")
            and row.find("td").get_text(" ", strip=True).casefold() == "current avg."
        ),
        None,
    )
    if current_row is None:
        raise ValueError("AAA national current-average row was not found")

    cells = [cell.get_text(" ", strip=True) for cell in current_row.find_all("td")]
    if len(headers) != len(cells):
        raise ValueError("AAA national table headers do not match its current-average row")

    prices = {
        GRADE_NAMES[header]: _parse_price(value, location=f"national/{header}")
        for header, value in zip(headers[1:], cells[1:], strict=True)
        if header in GRADE_NAMES
    }
    if set(prices) != set(NATIONAL_GRADES):
        raise ValueError(f"AAA national grades are incomplete: {sorted(prices)}")
    return price_date, prices


def parse_states_page(html: str) -> tuple[date, dict[str, dict[str, float]]]:
    soup = BeautifulSoup(html, "lxml")
    price_date = _parse_date(soup)
    table = soup.select_one("table#sortable")
    if table is None:
        raise ValueError("AAA state averages table was not found")

    states: dict[str, dict[str, float]] = {}
    for row in table.select("tbody tr"):
        state_link = row.find("a", href=True)
        if state_link is None:
            continue
        state_values = parse_qs(urlparse(state_link["href"]).query).get("state", [])
        if len(state_values) != 1:
            raise ValueError(f"AAA state row has an invalid link: {state_link['href']}")
        state_code = state_values[0].upper()
        if state_code in states:
            raise ValueError(f"AAA state table contains duplicate state: {state_code}")

        prices = {}
        for css_class, grade in (
            ("regular", "regular"),
            ("mid_grade", "midGrade"),
            ("premium", "premium"),
            ("diesel", "diesel"),
        ):
            cell = row.select_one(f"td.{css_class}")
            if cell is None:
                raise ValueError(f"AAA state {state_code} is missing {grade}")
            prices[grade] = _parse_price(
                cell.get_text(" ", strip=True), location=f"states/{state_code}/{grade}"
            )
        states[state_code] = prices

    return price_date, states


def validate_scrape(scrape: PriceScrape) -> None:
    if set(scrape.national) != set(NATIONAL_GRADES):
        raise ValueError("National scrape does not contain every expected grade")
    if set(scrape.states) != STATE_CODES:
        missing = sorted(STATE_CODES - set(scrape.states))
        unexpected = sorted(set(scrape.states) - STATE_CODES)
        raise ValueError(
            f"State scrape coverage mismatch; missing={missing}, unexpected={unexpected}"
        )
    for state_code, prices in scrape.states.items():
        if set(prices) != set(STATE_GRADES):
            raise ValueError(f"State {state_code} does not contain every expected grade")


def parse_pages(home_html: str, states_html: str) -> PriceScrape:
    national_date, national = parse_national_page(home_html)
    states_date, states = parse_states_page(states_html)
    if national_date != states_date:
        raise ValueError(
            f"AAA pages report different dates: national={national_date}, states={states_date}"
        )
    scrape = PriceScrape(price_date=national_date, national=national, states=states)
    validate_scrape(scrape)
    return scrape


def fetch_pages() -> tuple[str, str]:
    transport = httpx.HTTPTransport(retries=3)
    headers = {
        "User-Agent": "gas-prices-mvp/0.1 (+https://github.com/rhawrami/gas_prices)",
        "Accept": "text/html,application/xhtml+xml",
    }
    with httpx.Client(
        transport=transport,
        headers=headers,
        follow_redirects=True,
        timeout=30,
    ) as client:
        home_response = client.get(AAA_HOME_URL)
        home_response.raise_for_status()
        time.sleep(AAA_CRAWL_DELAY_SECONDS)
        states_response = client.get(AAA_STATES_URL)
        states_response.raise_for_status()
    return home_response.text, states_response.text


def load_database(path: Path = DEFAULT_INPUT) -> dict[str, Any]:
    database = json.loads(path.read_text())
    if set(database) != {"metadata", "national", "states"}:
        raise ValueError("Price database must contain metadata, national, and states")
    return database


def update_database(
    database: dict[str, Any],
    scrape: PriceScrape,
    *,
    updated_at: datetime | None = None,
) -> bool:
    price_date = scrape.price_date.isoformat()
    previous_last_date = date.fromisoformat(database["metadata"]["lastDate"])
    if scrape.price_date < previous_last_date:
        raise ValueError(
            f"AAA scrape date {price_date} is older than database date {previous_last_date}"
        )

    changed = (
        database["national"].get(price_date) != scrape.national
        or database["states"].get(price_date) != scrape.states
    )
    if not changed:
        return False

    database["national"][price_date] = scrape.national
    database["states"][price_date] = dict(sorted(scrape.states.items()))

    all_dates = sorted(database["national"])
    timestamp = updated_at or datetime.now(UTC)
    database["metadata"] = {
        "lastUpdated": timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "totalDays": len(all_dates),
        "firstDate": all_dates[0],
        "lastDate": all_dates[-1],
    }
    return True


def write_database(database: dict[str, Any], path: Path = DEFAULT_INPUT) -> None:
    temporary_path = path.with_suffix(f"{path.suffix}.tmp")
    temporary_path.write_text(json.dumps(database, ensure_ascii=False, indent=2) + "\n")
    temporary_path.replace(path)


def write_snapshot(scrape: PriceScrape, directory: Path = SNAPSHOT_DIRECTORY) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{scrape.price_date.isoformat()}.json"
    snapshot = {
        "source": {
            "name": "AAA Gas Prices",
            "nationalUrl": AAA_HOME_URL,
            "statesUrl": AAA_STATES_URL,
        },
        "date": scrape.price_date.isoformat(),
        "national": scrape.national,
        "states": dict(sorted(scrape.states.items())),
    }
    path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")
    return path


def run_update(
    home_html: str,
    states_html: str,
    *,
    database_path: Path = DEFAULT_INPUT,
    normalized_path: Path = DEFAULT_OUTPUT,
    snapshot_directory: Path = SNAPSHOT_DIRECTORY,
) -> tuple[PriceScrape, bool]:
    scrape = parse_pages(home_html, states_html)
    database = load_database(database_path)
    changed = update_database(database, scrape)
    write_snapshot(scrape, snapshot_directory)
    if changed:
        write_database(database, database_path)
    write_prices(normalize_prices(database_path), normalized_path)
    return scrape, changed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--snapshots", type=Path, default=SNAPSHOT_DIRECTORY)
    parser.add_argument("--home-html", type=Path)
    parser.add_argument("--states-html", type=Path)
    arguments = parser.parse_args()

    fixture_paths = (arguments.home_html, arguments.states_html)
    if any(fixture_paths) and not all(fixture_paths):
        parser.error("--home-html and --states-html must be provided together")
    if all(fixture_paths):
        home_html = arguments.home_html.read_text()
        states_html = arguments.states_html.read_text()
    else:
        home_html, states_html = fetch_pages()

    scrape, changed = run_update(
        home_html,
        states_html,
        database_path=arguments.database,
        normalized_path=arguments.output,
        snapshot_directory=arguments.snapshots,
    )
    action = "updated" if changed else "already current"
    print(f"Prices for {scrape.price_date.isoformat()} are {action}")


if __name__ == "__main__":
    main()
