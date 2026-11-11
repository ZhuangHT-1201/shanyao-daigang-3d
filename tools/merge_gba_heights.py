"""Attach GBA height estimates to the local building footprint subset."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import ijson


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--buildings",
        type=Path,
        default=Path("public/data/buildings_real.geojson"),
    )
    parser.add_argument(
        "--heights",
        type=Path,
        default=Path("research/gba_lod1_e115_n30_e120_n25.json"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/data/buildings_real.geojson"),
    )
    return parser.parse_args()


def all_ids(features: list[dict]) -> set[str]:
    ids: set[str] = set()
    for feature in features:
        properties = feature.get("properties") or {}
        if feature.get("id"):
            ids.add(str(feature["id"]))
        value = properties.get("id")
        if value:
            ids.add(str(value))
        if properties.get("source") and value:
            ids.add(f"{properties['source']}{value}{properties.get('region', '')}")
    return ids


def main() -> None:
    args = parse_args()
    collection = json.loads(args.buildings.read_text(encoding="utf-8"))
    features = collection["features"]
    needed = all_ids(features)
    heights: dict[str, dict] = {}
    started = time.time()

    with args.heights.open("rb") as source:
        for key, value in ijson.kvitems(source, "", use_float=True):
            if key in needed:
                heights[key] = value

    found = 0
    for feature in features:
        keys = {
            str(feature.get("id") or ""),
            str((feature.get("properties") or {}).get("id") or ""),
        }
        properties = feature.get("properties") or {}
        if properties.get("source") and properties.get("id"):
            keys.add(
                f"{properties['source']}{properties['id']}{properties.get('region', '')}"
            )
        estimate = next((heights[key] for key in keys if key in heights), None)
        if estimate:
            feature["properties"]["height_m"] = round(float(estimate.get("height", 0)), 2)
            feature["properties"]["height_variance"] = round(float(estimate.get("var", 0)), 2)
            found += 1
        else:
            feature["properties"]["height_m"] = None
            feature["properties"]["height_variance"] = None

    collection["height_source"] = (
        "GlobalBuildingAtlas GBA.LoD1, CC BY-NC 4.0; "
        "machine-estimated above-ground building height"
    )
    args.output.write_text(
        json.dumps(collection, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"Matched {found:,}/{len(features):,} local building heights "
        f"in {time.time() - started:.1f}s"
    )


if __name__ == "__main__":
    main()
