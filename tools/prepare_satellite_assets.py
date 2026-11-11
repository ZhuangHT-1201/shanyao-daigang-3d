"""Prepare browser-sized satellite atlases from the georeferenced survey mosaics."""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = {
    "research/daigang_satellite_z17_esri.jpg": (
        "public/data/satellite_basemap.jpg",
        2048,
    ),
    "research/oldstreet_satellite_z18_esri.jpg": (
        "public/data/oldstreet_satellite.jpg",
        2048,
    ),
}

for source_name, (output_name, size) in ASSETS.items():
    source = ROOT / source_name
    output = ROOT / output_name
    with Image.open(source) as image:
        image = image.convert("RGB")
        image = image.resize((size, size), Image.Resampling.LANCZOS)
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output, quality=88, optimize=True, progressive=True)
    print(f"{source_name} -> {output_name} ({output.stat().st_size:,} bytes)")
