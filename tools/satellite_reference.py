"""Download a local satellite tile mosaic for visual verification only."""

from __future__ import annotations

import argparse
import io
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from PIL import Image


def tile_xy(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    count = 2**zoom
    x = int((lon + 180) / 360 * count)
    lat_rad = math.radians(lat)
    y = int(
        (1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi)
        / 2
        * count
    )
    return x, y


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lat", type=float, default=25.1208)
    parser.add_argument("--lon", type=float, default=118.9005)
    parser.add_argument("--zoom", type=int, default=18)
    parser.add_argument("--radius-tiles", type=int, default=6)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("research/daigang_satellite.jpg"),
    )
    parser.add_argument(
        "--provider",
        choices=["google", "esri"],
        default="google",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    center_x, center_y = tile_xy(args.lat, args.lon, args.zoom)
    radius = args.radius_tiles
    x_values = range(center_x - radius, center_x + radius + 1)
    y_values = range(center_y - radius, center_y + radius + 1)
    image = Image.new("RGB", ((radius * 2 + 1) * 256, (radius * 2 + 1) * 256))
    session = requests.Session()
    session.headers["User-Agent"] = "ShanyaoDaigangResearch/1.0"

    def fetch(tile: tuple[int, int]) -> tuple[int, int, Image.Image]:
        x, y = tile
        if args.provider == "google":
            url = f"https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={args.zoom}"
        else:
            url = (
                "https://server.arcgisonline.com/ArcGIS/rest/services/"
                f"World_Imagery/MapServer/tile/{args.zoom}/{y}/{x}"
            )
        response = session.get(url, timeout=30)
        response.raise_for_status()
        return x, y, Image.open(io.BytesIO(response.content)).convert("RGB")

    tiles = [(x, y) for x in x_values for y in y_values]
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(fetch, tile) for tile in tiles]
        completed = 0
        for future in as_completed(futures):
            x, y, tile_image = future.result()
            image.paste(
                tile_image,
                (
                    (x - (center_x - radius)) * 256,
                    (y - (center_y - radius)) * 256,
                ),
            )
            completed += 1
            if completed % 25 == 0:
                print(f"Downloaded {completed}/{len(tiles)} tiles")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output, quality=92)
    print(f"Saved {args.output.resolve()}")


if __name__ == "__main__":
    main()
