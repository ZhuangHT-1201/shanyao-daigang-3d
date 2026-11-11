"""Query Overture building footprints for a geographic bounding box."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import duckdb


OVERTURE_RELEASE = "2026-10-21.0"
BUILDINGS_GLOB = (
    "s3://overturemaps-us-west-2/"
    f"release/{OVERTURE_RELEASE}/theme=buildings/type=building/*.parquet"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--west", type=float, default=118.891)
    parser.add_argument("--south", type=float, default=25.108)
    parser.add_argument("--east", type=float, default=118.905)
    parser.add_argument("--north", type=float, default=25.122)
    parser.add_argument("--output", type=Path, default=Path("research/overture_buildings.geojson"))
    parser.add_argument("--schema", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    con = duckdb.connect()
    con.execute("SET s3_region='us-west-2'")
    con.execute("INSTALL httpfs")
    con.execute("LOAD httpfs")
    con.execute("INSTALL spatial")
    con.execute("LOAD spatial")

    started = time.time()
    bbox_condition = (
        f"bbox.xmin <= {args.east} AND bbox.xmax >= {args.west} "
        f"AND bbox.ymin <= {args.north} AND bbox.ymax >= {args.south}"
    )

    if args.schema:
        rows = con.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{BUILDINGS_GLOB}') "
            f"WHERE {bbox_condition} LIMIT 1"
        ).fetchall()
        for row in rows:
            print(row)
        return

    rows = con.execute(
        f"""
        SELECT
          id,
          names,
          sources,
          level,
          height,
          min_height,
          num_floors,
          subtype,
          class,
          facade_color,
          facade_material,
          roof_material,
          roof_shape,
          roof_direction,
          roof_orientation,
          roof_color,
          roof_height,
          ST_AsGeoJSON(geometry) AS geometry_json
        FROM read_parquet('{BUILDINGS_GLOB}')
        WHERE {bbox_condition}
        """
    ).fetchall()

    features = []
    for (
        building_id,
        names,
        sources,
        level,
        height,
        min_height,
        num_floors,
        subtype,
        building_class,
        facade_color,
        facade_material,
        roof_material,
        roof_shape,
        roof_direction,
        roof_orientation,
        roof_color,
        roof_height,
        geometry_json,
    ) in rows:
        if not geometry_json:
            continue
        source_items = sources or []
        source_list = [dict(item) for item in source_items]
        features.append(
            {
                "type": "Feature",
                "id": building_id,
                "properties": {
                    "names": dict(names) if names else None,
                    "sources": source_list,
                    "level": level,
                    "height": height,
                    "min_height": min_height,
                    "num_floors": num_floors,
                    "subtype": subtype,
                    "class": building_class,
                    "facade_color": facade_color,
                    "facade_material": facade_material,
                    "roof_material": roof_material,
                    "roof_shape": roof_shape,
                    "roof_direction": roof_direction,
                    "roof_orientation": roof_orientation,
                    "roof_color": roof_color,
                    "roof_height": roof_height,
                },
                "geometry": json.loads(geometry_json),
            }
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "name": "Overture buildings",
                "release": OVERTURE_RELEASE,
                "bbox": [args.west, args.south, args.east, args.north],
                "features": features,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(
        f"Wrote {len(features)} buildings to {args.output} "
        f"in {time.time() - started:.1f}s"
    )


if __name__ == "__main__":
    main()
