import re
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from scripts.build_site import build_site


def test_static_site_build_includes_pages_and_processed_data(tmp_path: Path) -> None:
    output = tmp_path / "site"

    build_site(output)

    assert (output / "index.html").is_file()
    assert (output / "methodology.html").is_file()
    assert (output / "styles.css").is_file()
    assert (output / "app.js").is_file()
    assert (output / "favicon.svg").is_file()
    assert (output / "data/prices/processed/prices.json").is_file()
    assert (output / "data/vehicles/processed/index.json").is_file()
    assert (output / "data/vehicles/processed/by-make/toyota.json").is_file()


def test_frontend_script_selectors_exist_in_index() -> None:
    index = Path("docs/index.html").read_text()
    application = Path("docs/app.js").read_text()
    soup = BeautifulSoup(index, "html.parser")

    selectors = re.findall(r'document\.querySelector\("([#.][^" ]+)"\)', application)

    assert selectors
    assert not [selector for selector in selectors if soup.select_one(selector) is None]
    assert soup.select_one("script[src*='d3@7.9.0']") is not None
    assert soup.select_one("script[type='module'][src='app.js']") is not None


@pytest.mark.parametrize("output", [Path("."), Path("docs"), Path("data"), Path("docs/site")])
def test_static_site_build_rejects_destructive_output_paths(output: Path) -> None:
    with pytest.raises(ValueError, match="overlaps protected"):
        build_site(output)
