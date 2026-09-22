import json
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
import pytest

from scripts.update_prices import (
    AAA_CRAWL_DELAY_SECONDS,
    AAA_HOME_FETCH_URLS,
    AAA_HOME_URL,
    AAA_STATES_FETCH_URLS,
    NATIONAL_GRADES,
    STATE_CODES,
    STATE_GRADES,
    UPSTREAM_LATEST_URL,
    PriceScrape,
    fetch_current_scrape,
    fetch_pages,
    parse_latest_json,
    parse_national_page,
    parse_pages,
    parse_states_page,
    run_update,
    update_database,
    validate_scrape,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _prices(grades: tuple[str, ...], value: float = 4.25) -> dict[str, float]:
    return {grade: value for grade in grades}


def _complete_states_html(price_date: str = "9/21/26") -> str:
    rows = "".join(
        f"""
        <tr>
          <td><a href="https://gasprices.aaa.com?state={state_code}">{state_code}</a></td>
          <td class="regular">$4.1000</td>
          <td class="mid_grade">$4.5000</td>
          <td class="premium">$4.9000</td>
          <td class="diesel">$5.3000</td>
        </tr>
        """
        for state_code in sorted(STATE_CODES)
    )
    return f"""
    <html><body>
      <p>Price as of {price_date}</p>
      <table id="sortable"><tbody>{rows}</tbody></table>
    </body></html>
    """


def _latest_json(price_date: str = "2026-09-21") -> str:
    return json.dumps(
        {
            "date": price_date,
            "national": _prices(NATIONAL_GRADES),
            "states": {state_code: _prices(STATE_GRADES) for state_code in sorted(STATE_CODES)},
        }
    )


def test_parse_national_page() -> None:
    price_date, prices = parse_national_page((FIXTURES / "aaa_home.html").read_text())

    assert price_date == date(2026, 9, 21)
    assert prices == {
        "regular": 4.4786,
        "midGrade": 4.9599,
        "premium": 5.3545,
        "diesel": 6.5107,
        "e85": 3.4768,
    }


def test_parse_states_page() -> None:
    price_date, states = parse_states_page((FIXTURES / "aaa_states.html").read_text())

    assert price_date == date(2026, 9, 21)
    assert states["CA"] == {
        "regular": 6.1687,
        "midGrade": 6.3857,
        "premium": 6.5888,
        "diesel": 8.4208,
    }
    assert set(states) == {"CA", "DC", "TX"}


def test_validation_rejects_incomplete_state_coverage() -> None:
    scrape = PriceScrape(
        price_date=date(2026, 9, 21),
        national=_prices(NATIONAL_GRADES),
        states={"CA": _prices(STATE_GRADES)},
    )

    with pytest.raises(ValueError, match="coverage mismatch"):
        validate_scrape(scrape)


def test_parse_latest_json_validates_complete_payload() -> None:
    scrape = parse_latest_json(_latest_json())

    assert scrape.price_date == date(2026, 9, 21)
    assert scrape.national == _prices(NATIONAL_GRADES)
    assert set(scrape.states) == STATE_CODES


def test_fetch_pages_falls_back_after_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    home_html = (FIXTURES / "aaa_home.html").read_text()
    states_html = (FIXTURES / "aaa_states.html").read_text()
    requested_urls = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        assert request.headers["user-agent"].startswith("Mozilla/5.0")
        assert request.headers["accept-language"] == "en-US,en;q=0.9"
        if str(request.url) == AAA_HOME_FETCH_URLS[0]:
            return httpx.Response(403)
        if str(request.url) == AAA_HOME_URL:
            return httpx.Response(200, text=home_html)
        if str(request.url) == AAA_STATES_FETCH_URLS[0]:
            return httpx.Response(403)
        return httpx.Response(200, text=states_html)

    sleeps = []
    monkeypatch.setattr("scripts.update_prices.time.sleep", sleeps.append)

    pages = fetch_pages(transport=httpx.MockTransport(handler))

    assert pages == (home_html, states_html)
    assert requested_urls == [*AAA_HOME_FETCH_URLS, *AAA_STATES_FETCH_URLS]
    assert sleeps == [AAA_CRAWL_DELAY_SECONDS] * 3


def test_fetch_pages_reports_exhausted_routes(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        status_code = 200 if str(request.url) == AAA_HOME_URL else 403
        return httpx.Response(status_code, text="blocked")

    monkeypatch.setattr("scripts.update_prices.time.sleep", lambda _: None)

    with pytest.raises(RuntimeError, match="AAA state averages fetch failed") as error:
        fetch_pages(transport=httpx.MockTransport(handler))

    for url in AAA_STATES_FETCH_URLS:
        assert url in str(error.value)
    assert str(error.value).count("403 Forbidden") == len(AAA_STATES_FETCH_URLS)


def test_fetch_current_scrape_uses_validated_upstream_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def aaa_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="blocked")

    def upstream_handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == UPSTREAM_LATEST_URL
        return httpx.Response(200, text=_latest_json())

    monkeypatch.setattr("scripts.update_prices.time.sleep", lambda _: None)

    scrape = fetch_current_scrape(
        aaa_transport=httpx.MockTransport(aaa_handler),
        upstream_transport=httpx.MockTransport(upstream_handler),
    )

    assert scrape.price_date == date(2026, 9, 21)
    assert set(scrape.states) == STATE_CODES


def test_fetch_current_scrape_rejects_incomplete_upstream_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def aaa_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="blocked")

    def upstream_handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(_latest_json())
        del payload["states"]["DC"]
        return httpx.Response(200, json=payload)

    monkeypatch.setattr("scripts.update_prices.time.sleep", lambda _: None)

    with pytest.raises(RuntimeError, match="coverage mismatch"):
        fetch_current_scrape(
            aaa_transport=httpx.MockTransport(aaa_handler),
            upstream_transport=httpx.MockTransport(upstream_handler),
        )


def test_database_update_is_idempotent() -> None:
    old_date = "2026-09-20"
    scrape = PriceScrape(
        price_date=date(2026, 9, 21),
        national=_prices(NATIONAL_GRADES),
        states={state_code: _prices(STATE_GRADES) for state_code in STATE_CODES},
    )
    database = {
        "metadata": {
            "lastUpdated": "2026-09-20T12:00:00.000Z",
            "totalDays": 1,
            "firstDate": old_date,
            "lastDate": old_date,
        },
        "national": {old_date: _prices(NATIONAL_GRADES, 4.0)},
        "states": {
            old_date: {state_code: _prices(STATE_GRADES, 4.0) for state_code in STATE_CODES}
        },
    }
    updated_at = datetime(2026, 9, 21, 12, tzinfo=UTC)

    assert update_database(database, scrape, updated_at=updated_at) is True
    assert database["metadata"] == {
        "lastUpdated": "2026-09-21T12:00:00.000Z",
        "totalDays": 2,
        "firstDate": "2026-09-20",
        "lastDate": "2026-09-21",
    }
    assert update_database(database, scrape, updated_at=updated_at) is False


def test_offline_update_pipeline_is_idempotent(tmp_path: Path) -> None:
    home_html = (FIXTURES / "aaa_home.html").read_text()
    states_html = _complete_states_html()
    scrape = parse_pages(home_html, states_html)
    old_date = "2026-09-20"
    database_path = tmp_path / "database.json"
    normalized_path = tmp_path / "prices.json"
    snapshots = tmp_path / "daily"
    database_path.write_text(
        json.dumps(
            {
                "metadata": {
                    "lastUpdated": "2026-09-20T12:00:00.000Z",
                    "totalDays": 1,
                    "firstDate": old_date,
                    "lastDate": old_date,
                },
                "national": {old_date: _prices(NATIONAL_GRADES, 4.0)},
                "states": {
                    old_date: {state_code: _prices(STATE_GRADES, 4.0) for state_code in STATE_CODES}
                },
            }
        )
    )

    _, first_changed = run_update(
        home_html,
        states_html,
        database_path=database_path,
        normalized_path=normalized_path,
        snapshot_directory=snapshots,
    )
    database_after_first_run = database_path.read_bytes()
    normalized_after_first_run = normalized_path.read_bytes()

    _, second_changed = run_update(
        home_html,
        states_html,
        database_path=database_path,
        normalized_path=normalized_path,
        snapshot_directory=snapshots,
    )

    assert scrape.price_date == date(2026, 9, 21)
    assert first_changed is True
    assert second_changed is False
    assert database_path.read_bytes() == database_after_first_run
    assert normalized_path.read_bytes() == normalized_after_first_run
    assert [path.name for path in snapshots.iterdir()] == ["2026-09-21.json"]
