import * as THREE from "three";
import { makeLabelTexture } from "./textures.js";
import { centroid, distanceMeters, polygonArea } from "./geo.js";

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pointInPolygon(x, z, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const xi = points[index][0];
    const zi = points[index][1];
    const xj = points[previous][0];
    const zj = points[previous][1];
    const intersects = zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonRings(feature) {
  const { geometry } = feature;
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function cleanRing(ring) {
  const points = ring.map(([x, z]) => [x, z]);
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.01) points.pop();
  }
  return points;
}

function addTriangle(positions, colors, indices, uvs, a, b, c, color) {
  const offset = positions.length / 3;
  positions.push(...a, ...b, ...c);
  for (let index = 0; index < 3; index += 1) {
    colors.push(color.r, color.g, color.b);
  }
  indices.push(offset, offset + 1, offset + 2);
  uvs.push(a[0] / 6, a[2] / 6, b[0] / 6, b[2] / 6, c[0] / 6, c[2] / 6);
}

function addQuad(positions, colors, indices, uvs, a, b, c, d, color) {
  const offset = positions.length / 3;
  positions.push(...a, ...b, ...c, ...d);
  for (let index = 0; index < 4; index += 1) {
    colors.push(color.r, color.g, color.b);
  }
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  const edgeLength = Math.hypot(b[0] - a[0], b[2] - a[2]);
  uvs.push(0, a[1] / 4, edgeLength / 4, b[1] / 4, edgeLength / 4, c[1] / 4, 0, d[1] / 4);
}

class Batch {
  constructor(material) {
    this.material = material;
    this.positions = [];
    this.colors = [];
    this.indices = [];
    this.uvs = [];
  }

  geometry() {
    if (!this.positions.length) return null;
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    result.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    result.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    result.setIndex(this.indices);
    result.computeVertexNormals();
    result.computeBoundingSphere();
    return result;
  }
}

function triangulate(outer) {
  const points = outer.map(([x, z]) => new THREE.Vector2(x, -z));
  return THREE.ShapeUtils.triangulateShape(points, []);
}

function wallMaterial(map, side = THREE.DoubleSide) {
  return new THREE.MeshStandardMaterial({
    map,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    side,
  });
}

function roofMaterial(map) {
  return new THREE.MeshStandardMaterial({
    map,
    vertexColors: true,
    roughness: 0.84,
    side: THREE.DoubleSide,
  });
}

function chooseHeight(properties) {
  const measured = Number(properties.height_m);
  if (Number.isFinite(measured) && measured > 1) return Math.min(42, measured);
  const area = Number(properties.area_m2) || 60;
  if (area < 28) return 4.0;
  if (area < 75) return 5.2;
  if (area < 180) return 7.2;
  if (area < 420) return 9.5;
  return 5.4;
}

function buildingColor(random, kind, aerialSample = null) {
  if (kind === "industrial") {
    return new THREE.Color().setHSL(0.09, 0.03, 0.58 + random() * 0.1);
  }
  if (kind === "modern") {
    return new THREE.Color().setHSL(0.08, 0.025, 0.56 + random() * 0.22);
  }
  if (aerialSample && random() < 0.76) {
    const sampled = new THREE.Color(aerialSample.r, aerialSample.g, aerialSample.b);
    const plaster = new THREE.Color(0xd2c8b4);
    return sampled.lerp(plaster, 0.56).multiplyScalar(0.9 + random() * 0.12);
  }
  const roll = random();
  const palette = roll < 0.58
    ? [0xd1c6ae, 0xc8b59c, 0xd7d2c2, 0xb7b2a4, 0xc7bca7]
    : roll < 0.83
      ? [0xb55c46, 0x9e4d3b, 0xa95642, 0x8f4b3a]
      : [0xa99f8c, 0x918b7e, 0x817d72];
  return new THREE.Color(palette[Math.floor(random() * palette.length)]);
}

function roofColor(random, kind, aerialSample = null) {
  if (aerialSample) {
    const sampled = new THREE.Color(aerialSample.r, aerialSample.g, aerialSample.b);
    sampled.offsetHSL((random() - 0.5) * 0.025, -0.08, 0.06 + random() * 0.06);
    return sampled;
  }
  if (kind === "industrial") return new THREE.Color(0x8f918c);
  if (kind === "modern") return new THREE.Color(0xa5a59c);
  const colors = [0x7d3a2f, 0x964734, 0xa4513b, 0x6f312b, 0x5f6461];
  return new THREE.Color(colors[Math.floor(random() * colors.length)]);
}

function addFootprintWalls(batch, rings, height, color) {
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      const length = Math.hypot(next[0] - current[0], next[1] - current[1]);
      if (length < 0.35) continue;
      addQuad(
        batch.positions,
        batch.colors,
        batch.indices,
        batch.uvs,
        [current[0], 0.05, current[1]],
        [next[0], 0.05, next[1]],
        [next[0], height, next[1]],
        [current[0], height, current[1]],
        color,
      );
    }
  }
}

function addFacadeBand(batch, ring, y, thickness, color) {
  const center = ring.reduce(
    (sum, point) => [sum[0] + point[0] / ring.length, sum[1] + point[1] / ring.length],
    [0, 0],
  );
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    const midX = (start[0] + end[0]) * 0.5;
    const midZ = (start[1] + end[1]) * 0.5;
    const dx = midX - center[0];
    const dz = midZ - center[1];
    const length = Math.hypot(dx, dz) || 1;
    const offsetX = (dx / length) * 0.035;
    const offsetZ = (dz / length) * 0.035;
    addQuad(
      batch.positions,
      batch.colors,
      batch.indices,
      batch.uvs,
      [start[0] + offsetX, y, start[1] + offsetZ],
      [end[0] + offsetX, y, end[1] + offsetZ],
      [end[0] + offsetX, y + thickness, end[1] + offsetZ],
      [start[0] + offsetX, y + thickness, start[1] + offsetZ],
      color,
    );
  }
}

function addFlatRoof(batch, ring, height, color) {
  const triangles = triangulate(ring);
  for (const triangle of triangles) {
    const [ia, ib, ic] = triangle;
    addTriangle(
      batch.positions,
      batch.colors,
      batch.indices,
      batch.uvs,
      [ring[ia][0], height, ring[ia][1]],
      [ring[ib][0], height, ring[ib][1]],
      [ring[ic][0], height, ring[ic][1]],
      color,
    );
  }
}

function addHipRoof(batch, outer, height, color) {
  const center = outer.reduce(
    (sum, point) => [sum[0] + point[0] / outer.length, sum[1] + point[1] / outer.length],
    [0, 0],
  );
  const expanded = outer.map(([x, z]) => [
    center[0] + (x - center[0]) * 1.035,
    center[1] + (z - center[1]) * 1.035,
  ]);
  const area = polygonArea(expanded);
  const rise = Math.min(2.2, 0.85 + Math.sqrt(area) * 0.035);
  const apex = [center[0], height + rise, center[1]];
  for (let index = 0; index < expanded.length; index += 1) {
    const next = expanded[(index + 1) % expanded.length];
    addTriangle(
      batch.positions,
      batch.colors,
      batch.indices,
      batch.uvs,
      [expanded[index][0], height, expanded[index][1]],
      [next[0], height, next[1]],
      apex,
      color,
    );
  }
}

function addPerimeterRoof(batch, outer, height, color, inset = 4.5) {
  const center = outer.reduce(
    (sum, point) => [sum[0] + point[0] / outer.length, sum[1] + point[1] / outer.length],
    [0, 0],
  );
  for (let index = 0; index < outer.length; index += 1) {
    const start = outer[index];
    const end = outer[(index + 1) % outer.length];
    const midX = (start[0] + end[0]) * 0.5;
    const midZ = (start[1] + end[1]) * 0.5;
    const inwardX = center[0] - midX;
    const inwardZ = center[1] - midZ;
    const inwardLength = Math.hypot(inwardX, inwardZ) || 1;
    const offsetX = (inwardX / inwardLength) * inset;
    const offsetZ = (inwardZ / inwardLength) * inset;
    addQuad(
      batch.positions,
      batch.colors,
      batch.indices,
      batch.uvs,
      [start[0], height, start[1]],
      [end[0], height, end[1]],
      [end[0] + offsetX, height + 0.32, end[1] + offsetZ],
      [start[0] + offsetX, height + 0.32, start[1] + offsetZ],
      color,
    );
  }
}

function nearestRoadPoint(samples, x, z) {
  let best = { distance: Infinity, point: samples[0] };
  for (const point of samples) {
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance < best.distance) best = { distance, point };
  }
  return best;
}

function nearestFrontage(outer, roadSamples) {
  if (!roadSamples.length) return null;
  let best = null;
  for (let edgeIndex = 0; edgeIndex < outer.length; edgeIndex += 1) {
    const start = outer[edgeIndex];
    const end = outer[(edgeIndex + 1) % outer.length];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length < 3.2) continue;
    for (let step = 0; step <= 4; step += 1) {
      const t = step / 4;
      const x = THREE.MathUtils.lerp(start[0], end[0], t);
      const z = THREE.MathUtils.lerp(start[1], end[1], t);
      const road = nearestRoadPoint(roadSamples, x, z);
      if (best && road.distance >= best.distance) continue;
      const dx = road.point.x - x;
      const dz = road.point.z - z;
      const normalLength = Math.hypot(dx, dz) || 1;
      best = {
        distance: road.distance,
        x,
        z,
        start,
        end,
        length,
        outwardX: dx / normalLength,
        outwardZ: dz / normalLength,
      };
    }
  }
  return best;
}

function addFacadeBox(group, material, width, height, depth, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function createOldStreetShopfront({ scene, building, index, shopNames, materials }) {
  const frontage = building.frontage;
  if (!frontage) return;

  const group = new THREE.Group();
  group.position.set(frontage.x, 0.12, frontage.z);
  group.rotation.y = Math.atan2(frontage.outwardX, frontage.outwardZ);
  const width = Math.min(9.2, Math.max(3.2, frontage.length - 0.65));
  const shopName = shopNames[index % shopNames.length];
  const glazed = new THREE.MeshStandardMaterial({
    color: index % 3 === 0 ? 0x24342f : 0x302b25,
    emissive: 0xffb466,
    emissiveIntensity: 0.045,
    roughness: 0.3,
    metalness: 0.05,
  });
  const shutter = new THREE.MeshStandardMaterial({
    color: index % 2 ? 0x6f746d : 0x8e8a7c,
    roughness: 0.72,
    metalness: 0.26,
  });

  addFacadeBox(group, glazed, width - 0.45, 2.32, 0.08, 0, 1.32, 0.08);
  addFacadeBox(group, shutter, 0.22, 2.55, 0.18, -width / 2 + 0.16, 1.36, 0.18);
  addFacadeBox(group, shutter, 0.22, 2.55, 0.18, width / 2 - 0.16, 1.36, 0.18);

  const awning = addFacadeBox(group, materials.awning, width * 0.98, 0.1, 1.14, 0, 2.76, 0.55);
  awning.rotation.x = -0.12;
  addFacadeBox(group, materials.woodDark, width * 0.94, 0.08, 0.09, 0, 2.69, 1.08);

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(8.7, width * 0.9), 0.72),
    new THREE.MeshStandardMaterial({
      map: makeLabelTexture(shopName, {
        width: 900,
        height: 200,
        fontSize: 82,
        background: ["#3b261e", "#263932", "#55281f"][index % 3],
        color: "#ead19a",
        borderColor: "#987448",
        distress: true,
      }),
      emissive: 0xffc46c,
      emissiveIntensity: 0.04,
      roughness: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  sign.position.set(0, 3.35, 0.1);
  group.add(sign);

  if (building.height >= 6.6 && width > 4.2) {
    const balcony = addFacadeBox(group, materials.concrete, width * 0.92, 0.16, 1.06, 0, 4.42, 0.5);
    balcony.castShadow = true;
    addFacadeBox(group, materials.woodDark, width * 0.88, 0.07, 0.07, 0, 5.05, 0.94);
    for (let rail = -width * 0.4; rail <= width * 0.4; rail += 0.72) {
      addFacadeBox(group, materials.woodDark, 0.055, 0.63, 0.055, rail, 4.72, 0.94);
    }
  }

  if (index % 4 === 0) {
    const drain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, Math.min(5.8, building.height - 0.4), 6),
      shutter,
    );
    drain.position.set(width / 2 - 0.15, Math.min(5.8, building.height - 0.4) / 2, 0.24);
    drain.castShadow = true;
    group.add(drain);
  }

  if (index % 2 === 0) {
    addFacadeBox(
      group,
      materials.concreteDark,
      0.48,
      0.32,
      0.4,
      -width / 2 + 0.62,
      0.28,
      0.58,
    );
    const leafMaterial = new THREE.MeshStandardMaterial({
      color: index % 4 === 0 ? 0x4e744b : 0x617d4e,
      roughness: 0.96,
      flatShading: true,
    });
    for (let leaf = 0; leaf < 3; leaf += 1) {
      const foliage = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.24 + leaf * 0.035, 0),
        leafMaterial,
      );
      foliage.position.set(
        -width / 2 + 0.62 + (leaf - 1) * 0.12,
        0.56 + leaf * 0.12,
        0.58 + (leaf % 2) * 0.1,
      );
      foliage.castShadow = true;
      group.add(foliage);
    }
  }

  if (index % 5 === 1) {
    addFacadeBox(group, materials.woodWarm, 1.55, 0.1, 0.38, width * 0.22, 0.48, 0.52);
    for (const side of [-0.58, 0.58]) {
      addFacadeBox(group, materials.metal, 0.06, 0.45, 0.28, width * 0.22 + side, 0.25, 0.52);
    }
  }

  scene.add(group);
}

export function createRealBuildings({
  scene,
  collection,
  materials,
  textures,
  roads,
  satelliteSample = null,
  progress = () => {},
}) {
  const stoneBatch = new Batch(wallMaterial(textures.granite));
  const plasterBatch = new Batch(wallMaterial(textures.plaster));
  const concreteBatch = new Batch(wallMaterial(textures.graniteDark));
  const tileBatch = new Batch(roofMaterial(textures.roof));
  const templeTileBatch = new Batch(roofMaterial(textures.templeRoof));
  const flatTexture = textures.oldStreet.clone();
  flatTexture.wrapS = THREE.RepeatWrapping;
  flatTexture.wrapT = THREE.RepeatWrapping;
  flatTexture.needsUpdate = true;
  const flatBatch = new Batch(
    new THREE.MeshStandardMaterial({
      map: flatTexture,
      color: 0xb7b3a6,
      roughness: 0.95,
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
  );
  const trimBatch = new Batch(
    new THREE.MeshStandardMaterial({
      color: 0xa7a194,
      roughness: 0.94,
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
  );
  const windowMatrices = [];
  const colliders = [];
  const centers = [];
  const storefrontBuildings = [];
  const oldStreetCurve = roads.find((road) => road.id === "shan-yao-old-street")?.curve;
  const oldStreetSamples = oldStreetCurve
    ? Array.from({ length: 361 }, (_, index) => oldStreetCurve.getPointAt(index / 360))
    : [];
  const features = collection.features || [];

  features.forEach((feature, featureIndex) => {
    if (featureIndex % 200 === 0) {
      progress(0.55 + (featureIndex / Math.max(1, features.length)) * 0.22);
    }
    const properties = feature.properties || {};
    const rings = polygonRings(feature);
    if (!rings.length) return;
    const outer = cleanRing(rings[0][0]);
    if (outer.length < 3) return;
    const area = Number(properties.area_m2) || polygonArea(outer);
    if (area < 8) return;
    if (area > 6000) return;
    const center = centroid(outer);

    const nearStreet = oldStreetSamples.length
      ? nearestRoadPoint(oldStreetSamples, center.x, center.z).distance
      : 999;
    const measuredHeight = Number(properties.height_m);
    let height = chooseHeight(properties);
    if (!(Number.isFinite(measuredHeight) && measuredHeight > 1) && nearStreet < 14) {
      height = area < 48 ? 6.4 : area < 130 ? 8.1 : 5.8;
    }
    const kind = height > 10.5
      ? "modern"
      : area > 700
        ? "industrial"
        : "traditional";
    const random = seeded(hashString(String(feature.id || properties.id || featureIndex)));
    const aerialSample = satelliteSample?.(center.x, center.z);
    const wallColor = buildingColor(random, kind, aerialSample);
    const roofTint = roofColor(random, kind, aerialSample);
    const wallBatch = kind === "industrial"
      ? concreteBatch
      : random() > 0.44
        ? plasterBatch
        : stoneBatch;
    const wallRings = rings.map((polygon) => polygon.map(cleanRing));
    if (kind === "industrial" || kind === "modern" || height > 12) {
      addFootprintWalls(wallBatch, [outer], height, wallColor);
      addFlatRoof(flatBatch, outer, height, roofTint);
    } else {
      const roofHeight = Math.min(2.1, 0.7 + Math.sqrt(area) * 0.04);
      const wallHeight = Math.max(2.6, height - roofHeight);
      addFootprintWalls(wallBatch, [outer], wallHeight, wallColor);
      const roofBatch = nearStreet < 6 && height > 9
        ? random() > 0.62
          ? flatBatch
          : tileBatch
        : random() > 0.9
          ? templeTileBatch
          : tileBatch;
      if (roofBatch === flatBatch) addFlatRoof(flatBatch, outer, wallHeight, roofTint);
      else addHipRoof(roofBatch, outer, wallHeight, roofTint);
    }

    if (nearStreet < 22 && height > 5.2) {
      const bandColor = new THREE.Color(kind === "modern" ? 0x9f9a8d : 0x8d877a);
      addFacadeBand(trimBatch, outer, Math.min(3.05, height - 1), 0.13, bandColor);
      if (height > 6.8) {
        addFacadeBand(trimBatch, outer, Math.min(5.72, height - 1), 0.1, bandColor);
      }
    }

    const floors = Math.max(1, Math.min(5, Math.floor(height / 2.7)));
    if (area < 720 && outer.length <= 80) {
      for (let edgeIndex = 0; edgeIndex < outer.length; edgeIndex += 1) {
        const start = outer[edgeIndex];
        const end = outer[(edgeIndex + 1) % outer.length];
        const dx = end[0] - start[0];
        const dz = end[1] - start[1];
        const edgeLength = Math.hypot(dx, dz);
        if (edgeLength < 4.2) continue;
        const count = Math.min(3, Math.max(1, Math.floor(edgeLength / 5)));
        // The window plane must lie on the wall plane. Its local X axis runs
        // along the footprint edge, while its normal points away from the wall.
        const angle = Math.atan2(-dz, dx);
        for (let floor = 0; floor < Math.min(floors, 3); floor += 1) {
          for (let windowIndex = 0; windowIndex < count; windowIndex += 1) {
            const t = (windowIndex + 1) / (count + 1);
            const x = start[0] + dx * t - (dz / edgeLength) * 0.035;
            const z = start[1] + dz * t + (dx / edgeLength) * 0.035;
            const y = 1.6 + floor * 2.75;
            if (y > height - 0.8) continue;
            const matrix = new THREE.Matrix4();
            matrix.compose(
              new THREE.Vector3(x, y, z),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0)),
              new THREE.Vector3(1, 1, 1),
            );
            windowMatrices.push(matrix);
          }
        }
      }
    }

    if (nearStreet < 18 && area > 16 && area < 520) {
      storefrontBuildings.push({
        center,
        area,
        height,
        feature,
        frontage: nearestFrontage(outer, oldStreetSamples),
      });
    }
    centers.push({ x: center.x, z: center.z, height, area });
    const xs = outer.map((point) => point[0]);
    const zs = outer.map((point) => point[1]);
    colliders.push({
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
      polygon: outer,
    });
  });

  const groups = new THREE.Group();
  groups.name = "GBA building footprints";
  for (const batch of [
    stoneBatch,
    plasterBatch,
    concreteBatch,
    tileBatch,
    templeTileBatch,
    flatBatch,
    trimBatch,
  ]) {
    const geometry = batch.geometry();
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, batch.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    groups.add(mesh);
  }

  const windowGeometry = new THREE.PlaneGeometry(1.2, 1.35);
  const windowMaterial = new THREE.MeshStandardMaterial({
    map: textures.window,
    color: 0x87908b,
    emissive: 0xffaf60,
    emissiveIntensity: 0.015,
    roughness: 0.28,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const windows = new THREE.InstancedMesh(windowGeometry, windowMaterial, windowMatrices.length);
  windowMatrices.forEach((matrix, index) => windows.setMatrixAt(index, matrix));
  windows.instanceMatrix.needsUpdate = true;
  windows.castShadow = false;
  windows.receiveShadow = false;
  groups.add(windows);
  scene.add(groups);

  const shopNames = [
    "锋宾面线糊", "郑记煎包", "老巷糖杂货", "古茗", "泉港华艺教育书店",
    "港兴堂大药店", "阿胡茶室", "海蛎煎", "浮粿", "娟娟古早味",
    "泉港海货", "修补铺", "山腰供销", "老街茶桌",
  ];
  const shopRandom = seeded(7737);
  storefrontBuildings
    .filter((building) => building.frontage)
    .sort((a, b) => a.frontage.distance - b.frontage.distance)
    .slice(0, 40)
    .forEach((building, index) => {
      createOldStreetShopfront({
        scene,
        building,
        index: (index + Math.floor(shopRandom() * 4)) % shopNames.length,
        shopNames,
        materials,
      });
    });

  return {
    groups,
    windows,
    windowMaterial,
    colliders,
    centers,
    storefrontCount: storefrontBuildings.length,
    shopfrontCount: Math.min(40, storefrontBuildings.filter((building) => building.frontage).length),
    count: centers.length,
    sourceCount: features.length,
  };
}

export function pointBlockedByBuilding(x, z, radius, collider) {
  if (
    x - radius > collider.maxX ||
    x + radius < collider.minX ||
    z - radius > collider.maxZ ||
    z + radius < collider.minZ
  ) {
    return false;
  }
  if (pointInPolygon(x, z, collider.polygon)) return true;
  for (const offsetX of [-radius, radius]) {
    for (const offsetZ of [-radius, radius]) {
      if (pointInPolygon(x + offsetX, z + offsetZ, collider.polygon)) return true;
    }
  }
  return false;
}
