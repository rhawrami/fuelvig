"""Build the static site artifact with its processed data dependencies."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DOCS = PROJECT_ROOT / "docs"
DEFAULT_DATA = PROJECT_ROOT / "data"
DEFAULT_OUTPUT = PROJECT_ROOT / "_site"


def build_site(
    output_directory: Path = DEFAULT_OUTPUT,
    *,
    docs_directory: Path = DEFAULT_DOCS,
    data_directory: Path = DEFAULT_DATA,
) -> None:
    output_directory = output_directory.resolve()
    project_root = PROJECT_ROOT.resolve()
    source_paths = {docs_directory.resolve(), data_directory.resolve()}
    unsafe_project_output = (
        output_directory.is_relative_to(project_root)
        and output_directory != DEFAULT_OUTPUT.resolve()
    )
    contains_project = project_root.is_relative_to(output_directory)
    overlaps_source = any(
        output_directory == path
        or output_directory.is_relative_to(path)
        or path.is_relative_to(output_directory)
        for path in source_paths
    )
    if unsafe_project_output or contains_project or overlaps_source:
        raise ValueError(f"Output directory overlaps protected project files: {output_directory}")

    if output_directory.exists():
        shutil.rmtree(output_directory)
    shutil.copytree(docs_directory, output_directory)

    site_data = output_directory / "data"
    price_source = data_directory / "prices/processed/prices.json"
    vehicle_source = data_directory / "vehicles/processed"
    shutil.copytree(vehicle_source, site_data / "vehicles/processed")
    (site_data / "prices/processed").mkdir(parents=True)
    shutil.copy2(price_source, site_data / "prices/processed/prices.json")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()
    build_site(arguments.output)
    print(f"Built static site at {arguments.output}")


if __name__ == "__main__":
    main()
