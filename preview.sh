#!/usr/bin/env bash
uv run python -m scripts.build_site
uv run python -m http.server --directory _site 8000 >/tmp/gas-prices-preview.log 2>&1 & sleep 1; "$SHELL" -ic 'bb "http://localhost:8000/"'
