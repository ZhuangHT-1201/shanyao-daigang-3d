const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;
const EARTH_RADIUS = 6378137.0;

export const SCENE_ORIGIN = {
  lat: 25.1208,
  lon: 118.9005,
};

export function outOfChina(lat, lon) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let result =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  result += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  result += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  result += (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return result;
}

function transformLon(x, y) {
  let result =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  result += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  result += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  result += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return result;
}

export function wgs84ToGcj02(lat, lon) {
  if (outOfChina(lat, lon)) return { lat, lon };
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { lat: lat + dLat, lon: lon + dLon };
}

export function gcj02ToWgs84(lat, lon) {
  if (outOfChina(lat, lon)) return { lat, lon };
  const converted = wgs84ToGcj02(lat, lon);
  return {
    lat: lat * 2 - converted.lat,
    lon: lon * 2 - converted.lon,
  };
}

export function wgs84ToLocal(lat, lon, origin = SCENE_ORIGIN) {
  const metersPerDegreeLon = 111320 * Math.cos((origin.lat * PI) / 180);
  return {
    x: (lon - origin.lon) * metersPerDegreeLon,
    z: -(lat - origin.lat) * 110574,
  };
}

export function gcj02ToLocal(lat, lon, origin = SCENE_ORIGIN) {
  const wgs = gcj02ToWgs84(lat, lon);
  return { ...wgs84ToLocal(wgs.lat, wgs.lon, origin), ...wgs };
}

export function webMercatorToWgs84(x, y) {
  return {
    lon: (x / EARTH_RADIUS) * 180 / PI,
    lat: (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - PI / 2) * 180 / PI,
  };
}

export function wgs84ToWebMercator(lat, lon) {
  return {
    x: EARTH_RADIUS * lon * PI / 180,
    y: EARTH_RADIUS * Math.log(Math.tan(PI / 4 + (lat * PI) / 360)),
  };
}

export function localToWgs84(x, z, origin = SCENE_ORIGIN) {
  const metersPerDegreeLon = 111320 * Math.cos((origin.lat * PI) / 180);
  return {
    lon: origin.lon + x / metersPerDegreeLon,
    lat: origin.lat - z / 110574,
  };
}

export function localToGcj02(x, z, origin = SCENE_ORIGIN) {
  const wgs = localToWgs84(x, z, origin);
  const gcj = wgs84ToGcj02(wgs.lat, wgs.lon);
  return {
    lat: gcj.lat,
    lon: gcj.lon,
    wgsLat: wgs.lat,
    wgsLon: wgs.lon,
  };
}

export function distanceMeters(a, b) {
  const midLat = ((a.lat + b.lat) / 2) * PI / 180;
  return Math.hypot(
    (a.lon - b.lon) * 111320 * Math.cos(midLat),
    (a.lat - b.lat) * 110574,
  );
}

export function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area) / 2;
}

export function centroid(points) {
  let signedArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    signedArea += cross;
    x += (current[0] + next[0]) * cross;
    y += (current[1] + next[1]) * cross;
  }
  signedArea *= 0.5;
  if (Math.abs(signedArea) < 0.0001) {
    return {
      x: points.reduce((sum, point) => sum + point[0], 0) / points.length,
      z: points.reduce((sum, point) => sum + point[1], 0) / points.length,
    };
  }
  return { x: x / (6 * signedArea), z: y / (6 * signedArea) };
}
