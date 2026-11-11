"""Stream a GlobalBuildingAtlas tile and extract the Daigang study area.

The source polygon file is distributed in EPSG:3857. This utility writes a
small local GeoJSON with the same geometry and projected local metre
coordinates suitable for the Three.js scene.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path
from typing import Iterable

import ijson
from shapely.geometry import Polygon as ShapelyPolygon


R_EARTH = 6_378_137.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("research/gba_polygon_e115_n25_e120_n20.geojson"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/data/buildings_real.geojson"),
    )
    parser.add_argument("--west", type=float, default=118.889)
    parser.add_argument("--south", type=float, default=25.108)
    parser.add_argument("--east", type=float, default=118.912)
    parser.add_argument("--north", type=float, default=25.134)
    parser.add_argument("--origin-lon", type=float, default=118.9005)
    parser.add_argument("--origin-lat", type=float, default=25.1208)
    return parser.parse_args()


def mercator(lon: float, lat: float) -> tuple[float, float]:
    x = R_EARTH * math.radians(lon)
    y = R_EARTH * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def ring_xy(ring: Iterable[Iterable[float]]) -> list[tuple[float, float]]:
    return [(float(point[0]), float(point[1])) for point in ring]


def rings_for_feature(geometry: dict) -> list[list[tuple[float, float]]]:
    if geometry.get("type") == "Polygon":
        return [ring_xy(geometry["coordinates"][0])]
    if geometry.get("type") == "MultiPolygon":
        return [ring_xy(polygon[0]) for polygon in geometry["coordinates"]]
    return []


def make_local_geometry(points: list[tuple[float, float]], origin_x: float, origin_y: float) -> dict:
    coordinates = [
        [
            round(x - origin_x, 3),
            round(-(y - origin_y), 3),
        ]
        for x, y in points
    ]
    if coordinates[0] != coordinates[-1]:
        coordinates.append(coordinates[0])
    return {"type": "Polygon", "coordinates": [coordinates]}


def main() -> None:
    args = parse_args()
    if not args.input.exists():
        raise SystemExit(f"Missing source dataset: {args.input}")

    west_x, south_y = mercator(args.west, args.south)
    east_x, north_y = mercator(args.east, args.north)
    origin_x, origin_y = mercator(args.origin_lon, args.origin_lat)
    features: list[dict] = []
    scanned = 0
    started = time.time()

    with args.input.open("rb") as source:
        for feature in ijson.items(source, "features.item", use_float=True):
            scanned += 1
            geometry = feature.get("geometry") or {}
            rings = rings_for_feature(geometry)
            local_rings = []
            source_rings = []
            for ring in rings:
                xs = [point[0] for point in ring]
                ys = [point[1] for point in ring]
                if max(xs) < west_x or min(xs) > east_x or max(ys) < south_y or min(ys) > north_y:
                    continue
                source_rings.append(ring)
                local_rings.append(make_local_geometry(ring, origin_x, origin_y)["coordinates"][0])

            if not local_rings:
                continue

            local_geometry = (
                {"type": "Polygon", "coordinates": [local_rings[0]]}
                if len(local_rings) == 1
                else {"type": "MultiPolygon", "coordinates": [[ring] for ring in local_rings]}
            )
            properties = dict(feature.get("properties") or {})
            simplified_rings = []
            for ring in local_rings:
                simplified = ShapelyPolygon(ring).simplify(0.24, preserve_topology=True)
                if simplified.is_empty or simplified.area < 7:
                    continue
                simplified_rings.append([[round(x, 2), round(y, 2)] for x, y in simplified.exterior.coords])
            if not simplified_rings:
                continue
            combined = ShapelyPolygon(simplified_rings[0])
            properties["area_m2"] = round(combined.area, 2)
            properties["centroid_local"] = [
                round(combined.centroid.x, 2),
                round(combined.centroid.y, 2),
            ]
            features.append(
                {
                    "type": "Feature",
                    "id": feature.get("id") or properties.get("id"),
                    "properties": properties,
                    "geometry": (
                        {"type": "Polygon", "coordinates": [simplified_rings[0]]}
                        if len(simplified_rings) == 1
                        else {
                            "type": "MultiPolygon",
                            "coordinates": [[ring] for ring in simplified_rings],
                        }
                    ),
                }
            )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "name": "Daigang and Shanyao Old Street buildings",
                "source": "GlobalBuildingAtlas GBA.Polygon, CC BY-NC 4.0",
                "crs": "local metric coordinates; x=east, y=south",
                "origin_wgs84": [args.origin_lon, args.origin_lat],
                "clip_bbox_wgs84": [args.west, args.south, args.east, args.north],
                "features": features,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    elapsed = time.time() - started
    print(f"Scanned {scanned:,} features, retained {len(features):,} in {elapsed:.1f}s")
    print(f"Output: {args.output.resolve()}")


if __name__ == "__main__":
    main()
