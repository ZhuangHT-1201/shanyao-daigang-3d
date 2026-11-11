import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const argument = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputPath = path.resolve(
  root,
  argument("--input", path.join("research", "overture_oldstreet.geojson")),
);
const outputPath = path.resolve(
  root,
  argument("--output", path.join("public", "data", "buildings_oldstreet.geojson")),
);
const origin = { lat: 25.1208, lon: 118.9005 };
const metresPerDegreeLon = 111320 * Math.cos((origin.lat * Math.PI) / 180);
const metresPerDegreeLat = 110574;

const collection = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const overviewCollection = JSON.parse(
  fs.readFileSync(path.join(root, "public", "data", "buildings_real.geojson"), "utf8"),
);
const overviewBuildings = (overviewCollection.features || [])
  .map((feature) => ({
    x: feature.properties?.centroid_local?.[0],
    z: feature.properties?.centroid_local?.[1],
    height: Number(feature.properties?.height_m),
  }))
  .filter(
    (building) =>
      Number.isFinite(building.x) &&
      Number.isFinite(building.z) &&
      Number.isFinite(building.height) &&
      building.height > 1,
  );

function nearestOverviewHeight(x, z) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const building of overviewBuildings) {
    const distance = Math.hypot(building.x - x, building.z - z);
    if (distance < nearestDistance) {
      nearest = building;
      nearestDistance = distance;
    }
  }
  if (!nearest || nearestDistance > 60) return null;
  return {
    height: Number(nearest.height.toFixed(2)),
    distance: Number(nearestDistance.toFixed(1)),
  };
}

function projectRing(ring) {
  const points = ring.map(([lon, lat]) => [
    Number(((lon - origin.lon) * metresPerDegreeLon).toFixed(2)),
    Number((-(lat - origin.lat) * metresPerDegreeLat).toFixed(2)),
  ]);
  if (
    points.length > 1 &&
    Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) > 0.02
  ) {
    points.push([...points[0]]);
  }
  return points;
}

function projectGeometry(geometry) {
  if (geometry?.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map(projectRing),
    };
  }
  if (geometry?.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((polygon) => polygon.map(projectRing)),
    };
  }
  return null;
}

function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area) * 0.5;
}

function outerRings(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates[0]];
  return geometry.coordinates.map((polygon) => polygon[0]);
}

const features = [];
for (const feature of collection.features || []) {
  const geometry = projectGeometry(feature.geometry);
  if (!geometry) continue;
  const rings = outerRings(geometry);
  const area = rings.reduce((sum, ring) => sum + ringArea(ring), 0);
  if (area < 4) continue;
  const points = rings.flat();
  const centroid = points.reduce(
    (sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length],
    [0, 0],
  );
  const heightMatch = nearestOverviewHeight(centroid[0], centroid[1]);
  const source = feature.properties?.sources?.[0] || {};
  features.push({
    type: "Feature",
    id: feature.id,
    properties: {
      source: "Overture Maps Foundation",
      source_dataset: source.dataset || null,
      source_provider: source.provider || null,
      area_m2: Number(area.toFixed(2)),
      centroid_local: centroid.map((value) => Number(value.toFixed(2))),
      height_m: feature.properties?.height ?? heightMatch?.height ?? null,
      height_source:
        feature.properties?.height != null
          ? "Overture"
          : heightMatch
            ? `GlobalBuildingAtlas nearest centroid (${heightMatch.distance} m)`
            : null,
      class: feature.properties?.class ?? null,
      subtype: feature.properties?.subtype ?? null,
    },
    geometry,
  });
}

const output = {
  type: "FeatureCollection",
  name:
    path.basename(inputPath, path.extname(inputPath)) === "overture_oldstreet"
      ? "Shanyao Old Street detailed building footprints"
      : "Daigang detailed building footprints",
  source: "Overture Maps Foundation buildings release 2026-10-21.0",
  underlying_source: "East Asian Buildings, Zenodo DOI 10.5281/zenodo.8174931",
  underlying_license: "CC BY 4.0",
  underlying_creators: [
    "Qian Shi",
    "Jiajun Zhu",
    "Zhengyu Liu",
    "Haonan Guo",
    "Mengxi Liu",
    "Zihong Liu",
    "Xiaoping Liu",
  ],
  crs: "local metric coordinates; x=east, z=south",
  origin_wgs84: [origin.lon, origin.lat],
  clip_bbox_wgs84: collection.bbox,
  features,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output), "utf8");
console.log(`Projected ${features.length} Overture building footprints to ${outputPath}`);
