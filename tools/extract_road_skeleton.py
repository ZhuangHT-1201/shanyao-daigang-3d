"""Derive street-space centerlines from real building footprints."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt
from skimage.morphology import remove_small_objects, skeletonize


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--buildings",
        type=Path,
        default=Path("public/data/buildings_real.geojson"),
    )
    parser.add_argument("--west", type=float, default=-760)
    parser.add_argument("--east", type=float, default=760)
    parser.add_argument("--north", type=float, default=-1080)
    parser.add_argument("--south", type=float, default=920)
    parser.add_argument("--pixels-per-metre", type=float, default=1)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("research/road-space-skeleton.png"),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    collection = json.loads(args.buildings.read_text(encoding="utf-8"))
    scale = args.pixels_per_metre
    width = round((args.east - args.west) * scale)
    height = round((args.south - args.north) * scale)
    buildings = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(buildings)

    def project(point: list[float]) -> tuple[float, float]:
        return (
            (point[0] - args.west) * scale,
            (point[1] - args.north) * scale,
        )

    for feature in collection["features"]:
        cx, cz = feature["properties"].get("centroid_local", [0, 0])
        if not (args.west <= cx <= args.east and args.north <= cz <= args.south):
            continue
        geometry = feature["geometry"]
        polygons = (
            [geometry["coordinates"]]
            if geometry["type"] == "Polygon"
            else geometry["coordinates"]
        )
        for polygon in polygons:
            draw.polygon([project(point) for point in polygon[0]], fill=255)

    occupied = cv2.dilate(
        np.asarray(buildings, dtype=np.uint8),
        np.ones((3, 3), dtype=np.uint8),
    ) > 0
    distance = distance_transform_edt(~occupied)
    free_street = (distance >= 2.2) & ~occupied
    skeleton = skeletonize(free_street)
    skeleton = remove_small_objects(skeleton, min_size=60)
    result = np.zeros((height, width, 3), dtype=np.uint8)
    result[..., 0] = np.where(occupied, 75, 244)
    result[..., 1] = np.where(occupied, 78, 241)
    result[..., 2] = np.where(occupied, 75, 236)
    result[skeleton] = (20, 72, 220)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(result).save(args.output, quality=92)
    print(f"Wrote {args.output.resolve()} ({width} x {height})")


if __name__ == "__main__":
    main()
