import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { Sky } from "three/addons/objects/Sky.js";
import {
  DISTRICTS,
  POIS,
  ROAD_PATHS,
  VILLAGE_CENTER,
  YUNCHENG_CENTER,
} from "./config.js";
import {
  createProceduralTextures,
  makeLabelTexture,
  makeSpriteTexture,
  makeWaterNormalTexture,
} from "./textures.js";
import { createRealBuildings, pointBlockedByBuilding } from "./real-buildings.js";
import { localToWgs84, wgs84ToLocal } from "./geo.js";

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
const UP = new THREE.Vector3(0, 1, 0);

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smoothstep = THREE.MathUtils.smoothstep;
const SATELLITE_BOUNDS_WGS84 = {
  west: 118.88031005859375,
  east: 118.9215087890625,
  north: 25.14031191468074,
  south: 25.103010240530725,
};
const OLDSTREET_SATELLITE_BOUNDS_WGS84 = {
  west: 118.89266967773438,
  east: 118.90777587890625,
  north: 25.12787928859756,
  south: 25.11420193832609,
};

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneTexture(texture, repeatX = 1, repeatY = 1) {
  const cloned = texture.clone();
  cloned.wrapS = THREE.RepeatWrapping;
  cloned.wrapT = THREE.RepeatWrapping;
  cloned.repeat.set(repeatX, repeatY);
  cloned.needsUpdate = true;
  return cloned;
}

function meshBox(parent, material, width, height, depth, x, y, z, cast = true, receive = true) {
  const mesh = new THREE.Mesh(UNIT_BOX, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(width, height, depth);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

function meshPlane(parent, material, width, height, x, y, z, rotationX = 0, rotationY = 0) {
  const mesh = new THREE.Mesh(UNIT_PLANE, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(width, height, 1);
  mesh.rotation.set(rotationX, rotationY, 0);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, material, radiusTop, radiusBottom, height, radialSegments, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments),
    material,
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function sphere(parent, material, radius, x, y, z, widthSegments = 16, heightSegments = 12) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, widthSegments, heightSegments),
    material,
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeRibbonGeometry(points, width, y = 0) {
  const positions = [];
  const uvs = [];
  const indices = [];
  let distance = 0;
  const left = [];
  const right = [];

  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const previous = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const tangentX = next.x - previous.x;
    const tangentZ = next.z - previous.z;
    const length = Math.hypot(tangentX, tangentZ) || 1;
    const normalX = (-tangentZ / length) * width * 0.5;
    const normalZ = (tangentX / length) * width * 0.5;
    if (i > 0) {
      distance += Math.hypot(current.x - previous.x, current.z - previous.z);
    }
    left.push(new THREE.Vector3(current.x + normalX, y, current.z + normalZ));
    right.push(new THREE.Vector3(current.x - normalX, y, current.z - normalZ));
    uvs.push(0, distance / 16, 1, distance / 16);
  }

  for (let i = 0; i < points.length; i += 1) {
    positions.push(left[i].x, y, left[i].z, right[i].x, y, right[i].z);
    if (i < points.length - 1) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function sampleCurve(points, count = 64) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    "centripetal",
    0.38,
  );
  return curve.getPoints(count);
}

function createCurvedRoof(width, depth, height, roofMaterial, ridgeMaterial) {
  const group = new THREE.Group();
  const xSegments = 2;
  const slopeSegments = 5;

  for (const side of [-1, 1]) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let ix = 0; ix <= xSegments; ix += 1) {
      const u = ix / xSegments;
      const x = lerp(-width / 2, width / 2, u);
      for (let iz = 0; iz <= slopeSegments; iz += 1) {
        const t = iz / slopeSegments;
        const z = side * depth * 0.5 * t;
        const y = height * Math.pow(1 - t, 0.74) + 0.18 * Math.pow(t, 5);
        positions.push(x, y, z);
        uvs.push(u * width * 0.12, t * depth * 0.18);
      }
    }
    for (let ix = 0; ix < xSegments; ix += 1) {
      for (let iz = 0; iz < slopeSegments; iz += 1) {
        const a = ix * (slopeSegments + 1) + iz;
        const b = a + slopeSegments + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const roof = new THREE.Mesh(geometry, roofMaterial);
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);
  }

  const ridgePoints = [
    new THREE.Vector3(-width / 2 - 0.65, height + 0.18, 0),
    new THREE.Vector3(-width / 2 + 0.12, height + 0.04, 0),
    new THREE.Vector3(0, height + 0.12, 0),
    new THREE.Vector3(width / 2 - 0.12, height + 0.04, 0),
    new THREE.Vector3(width / 2 + 0.65, height + 0.18, 0),
  ];
  const ridgeCurve = new THREE.CatmullRomCurve3(ridgePoints);
  const ridge = new THREE.Mesh(
    new THREE.TubeGeometry(ridgeCurve, 28, 0.115, 5, false),
    ridgeMaterial,
  );
  ridge.castShadow = true;
  group.add(ridge);

  for (const side of [-1, 1]) {
    const eave = meshBox(
      group,
      ridgeMaterial,
      width + 0.9,
      0.14,
      0.14,
      0,
      0.2,
      side * (depth * 0.5 + 0.12),
      true,
      false,
    );
    eave.castShadow = true;
  }

  return group;
}

function createGableEnd(width, depth, height, material) {
  const positions = [
    -width / 2, 0, depth / 2,
    -width / 2, 0, -depth / 2,
    -width / 2, height, 0,
    width / 2, 0, depth / 2,
    width / 2, height, 0,
    width / 2, 0, -depth / 2,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function makeTexturedNameplate(text, options = {}) {
  const texture = makeLabelTexture(text, {
    width: 800,
    height: 220,
    fontSize: options.fontSize ?? 104,
    background: options.background ?? "#382621",
    color: options.color ?? "#e9ca8a",
    borderColor: options.borderColor ?? "#a8834d",
    distress: true,
  });
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  return mesh;
}

function lookAtXZ(object, target) {
  const dx = target.x - object.position.x;
  const dz = target.z - object.position.z;
  object.rotation.y = Math.atan2(dx, dz);
}

export class TownWorld {
  constructor(scene, renderer, labelRoot, progress = () => {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.labelRoot = labelRoot;
    this.progress = progress;
    this.clock = new THREE.Clock();
    this.colliders = [];
    this.people = [];
    this.vehicles = [];
    this.smokeEmitters = [];
    this.birds = [];
    this.cloths = [];
    this.treeData = [];
    this.labels = [];
    this.poiMarkers = [];
    this.interactiveRoots = [];
    this.lampLights = [];
    this.windowMaterials = [];
    this.lanternMaterials = [];
    this.roadMaterials = [];
    this.weather = "clear";
    this.timeOfDay = 17.7;
    this.waterMeshes = [];
    this.puddles = [];
    this.random = seeded(82026);
    this.temp = new THREE.Vector3();
    this.temp2 = new THREE.Vector3();
  }

  async build() {
    this.progress(0.04, "读取埭港的空间轮廓");
    this.createMaterials();
    this.createSky();
    await this.nextFrame();

    this.progress(0.1, "将卫星影像对齐到埭港坐标");
    await this.buildSatelliteBase();
    await this.nextFrame();

    this.progress(0.18, "铺开塔山、水网与海风");
    this.buildLandscape();
    await this.nextFrame();

    this.progress(0.39, "铺筑山腰老街与埭港村道");
    this.buildRoads();
    this.buildStreetLife();
    await this.nextFrame();

    this.progress(0.53, "读取真实建筑轮廓与高度");
    await this.buildRealVillage();
    this.buildHeritageLandmarks();
    this.buildOldStreetInfrastructure();
    await this.nextFrame();

    this.progress(0.75, "挂起灯笼，让市场醒来");
    this.buildPeople();
    this.buildBirds();
    await this.nextFrame();

    this.progress(0.9, "交还一条可以走进的街");
    this.buildLabels();
    this.buildWeather();
    this.setTimeOfDay(this.timeOfDay, true);
    this.setRain(false, true);
    await this.nextFrame();

    this.progress(1, "埭港已经醒来");
    return this;
  }

  nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  createMaterials() {
    const textures = createProceduralTextures(this.renderer);
    this.textures = textures;
    this.waterNormal = makeWaterNormalTexture();
    this.glowTexture = makeSpriteTexture("glow");
    this.mistTexture = makeSpriteTexture("mist");

    const standard = (map, options = {}) =>
      new THREE.MeshStandardMaterial({
        map,
        roughness: options.roughness ?? 0.84,
        metalness: options.metalness ?? 0,
        color: options.color ?? 0xffffff,
        side: options.side ?? THREE.FrontSide,
        transparent: options.transparent ?? false,
        opacity: options.opacity ?? 1,
        emissive: options.emissive ?? 0x000000,
        emissiveIntensity: options.emissiveIntensity ?? 0,
      });

    this.materials = {
      granite: standard(cloneTexture(textures.granite, 2.6, 1.4), { roughness: 0.94 }),
      graniteDark: standard(cloneTexture(textures.granite, 4, 2), {
        roughness: 0.9,
        color: 0x8e928b,
      }),
      brick: standard(cloneTexture(textures.brick, 2.8, 1.8), { roughness: 0.88 }),
      roof: standard(cloneTexture(textures.roof, 3.2, 2.2), {
        roughness: 0.78,
        side: THREE.DoubleSide,
      }),
      templeRoof: standard(cloneTexture(textures.templeRoof, 3.4, 2), {
        roughness: 0.72,
        side: THREE.DoubleSide,
      }),
      plaster: standard(cloneTexture(textures.plaster, 2, 1), { roughness: 0.93 }),
      asphalt: standard(cloneTexture(textures.asphalt, 1, 1), { roughness: 0.92 }),
      oldStreet: standard(cloneTexture(textures.oldStreet, 1.4, 1), { roughness: 0.88 }),
      stone: standard(cloneTexture(textures.stone, 3, 3), { roughness: 0.95 }),
      stonePath: standard(cloneTexture(textures.stone, 2, 5), { roughness: 0.92 }),
      ground: standard(cloneTexture(textures.ground, 36, 36), { roughness: 1 }),
      field: standard(cloneTexture(textures.field, 4, 5), { roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x4a2820, roughness: 0.68 }),
      woodDark: new THREE.MeshStandardMaterial({ color: 0x261b17, roughness: 0.76 }),
      woodWarm: new THREE.MeshStandardMaterial({ color: 0x74402a, roughness: 0.7 }),
      black: new THREE.MeshStandardMaterial({ color: 0x131917, roughness: 0.58 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe5dfcf, roughness: 0.8 }),
      mortar: new THREE.MeshStandardMaterial({ color: 0xbeb9ab, roughness: 0.96 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x58645d, roughness: 0.5, metalness: 0.45 }),
      brass: new THREE.MeshStandardMaterial({ color: 0x9c7542, roughness: 0.42, metalness: 0.4 }),
      redPaint: new THREE.MeshStandardMaterial({ color: 0x9c3827, roughness: 0.58 }),
      goldPaint: new THREE.MeshStandardMaterial({ color: 0xd2a150, roughness: 0.44, metalness: 0.35 }),
      footpath: standard(cloneTexture(textures.stone, 1.2, 3), { roughness: 0.9, color: 0xa2a092 }),
      awning: standard(cloneTexture(textures.awning, 1, 1), { roughness: 0.82, side: THREE.DoubleSide }),
      window: new THREE.MeshStandardMaterial({
        map: textures.window,
        color: 0x9d927d,
        emissive: 0xffb252,
        emissiveIntensity: 0.04,
        roughness: 0.35,
      }),
      glowingWindow: new THREE.MeshStandardMaterial({
        map: textures.window,
        color: 0xe8c99b,
        emissive: 0xf39b45,
        emissiveIntensity: 0.2,
        roughness: 0.26,
      }),
      lantern: new THREE.MeshStandardMaterial({
        color: 0xb34331,
        emissive: 0xff5228,
        emissiveIntensity: 0.15,
        roughness: 0.48,
      }),
      lampGlow: new THREE.MeshBasicMaterial({
        color: 0xffc77a,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      hill: new THREE.MeshStandardMaterial({
        color: 0x53634a,
        roughness: 1,
        flatShading: true,
      }),
      hillFar: new THREE.MeshStandardMaterial({
        color: 0x617164,
        roughness: 1,
        flatShading: true,
      }),
      foliage: new THREE.MeshStandardMaterial({
        color: 0x4e6e43,
        roughness: 0.98,
        flatShading: true,
      }),
      foliageLight: new THREE.MeshStandardMaterial({
        color: 0x698356,
        roughness: 0.96,
        flatShading: true,
      }),
      palm: new THREE.MeshStandardMaterial({
        color: 0x496d4d,
        roughness: 0.94,
        side: THREE.DoubleSide,
        flatShading: true,
      }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x554336, roughness: 1 }),
      concrete: new THREE.MeshStandardMaterial({ color: 0x9c9b90, roughness: 0.9 }),
      concreteDark: new THREE.MeshStandardMaterial({ color: 0x5f6862, roughness: 0.86 }),
      puddle: new THREE.MeshPhysicalMaterial({
        color: 0x4e6e70,
        roughness: 0.08,
        metalness: 0.1,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    };

    this.windowMaterials.push(this.materials.window, this.materials.glowingWindow);
    this.lanternMaterials.push(this.materials.lantern);
  }

  async buildSatelliteBase() {
    try {
      const loader = new THREE.TextureLoader();
      const texture = await loader.loadAsync("/data/satellite_basemap.jpg");
      let detailTexture = null;
      try {
        detailTexture = await loader.loadAsync("/data/oldstreet_satellite.jpg");
      } catch (error) {
        console.warn("Old Street detail imagery unavailable.", error);
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;

      const satelliteExtent = (bounds) => {
        const northWest = wgs84ToLocal(bounds.north, bounds.west);
        const southEast = wgs84ToLocal(bounds.south, bounds.east);
        return {
          minX: northWest.x,
          maxX: southEast.x,
          minZ: northWest.z,
          maxZ: southEast.z,
          width: southEast.x - northWest.x,
          depth: southEast.z - northWest.z,
        };
      };
      const baseBounds = satelliteExtent(SATELLITE_BOUNDS_WGS84);
      const { minX, maxX, minZ, maxZ, width, depth } = baseBounds;
      const sampleCanvas = document.createElement("canvas");
      const sampleSize = 2048;
      sampleCanvas.width = sampleSize;
      sampleCanvas.height = sampleSize;
      const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
      sampleContext.drawImage(texture.image, 0, 0, sampleSize, sampleSize);
      const satellitePixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize).data;
      this.sampleSatelliteColor = (x, z) => {
        const px = Math.round(((x - minX) / width) * (sampleSize - 1));
        const py = Math.round(((z - minZ) / depth) * (sampleSize - 1));
        if (px < 0 || py < 0 || px >= sampleSize || py >= sampleSize) return null;
        let red = 0;
        let green = 0;
        let blue = 0;
        let samples = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const sx = Math.min(sampleSize - 1, Math.max(0, px + ox));
            const sy = Math.min(sampleSize - 1, Math.max(0, py + oy));
            const offset = (sy * sampleSize + sx) * 4;
            red += satellitePixels[offset];
            green += satellitePixels[offset + 1];
            blue += satellitePixels[offset + 2];
            samples += 1;
          }
        }
        return {
          r: red / samples / 255,
          g: green / samples / 255,
          b: blue / samples / 255,
        };
      };

      this.satelliteBounds = baseBounds;
      this.satelliteMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      this.satelliteMaterials = [this.satelliteMaterial];
      const satellite = meshPlane(
        this.scene,
        this.satelliteMaterial,
        width,
        depth,
        (minX + maxX) / 2,
        -0.268,
        (minZ + maxZ) / 2,
        -Math.PI / 2,
      );
      satellite.receiveShadow = true;
      satellite.renderOrder = -1;
      const shadowCatcher = meshPlane(
        this.scene,
        new THREE.ShadowMaterial({
          color: 0x111511,
          opacity: 0.2,
          transparent: true,
          depthWrite: false,
        }),
        width,
        depth,
        (minX + maxX) / 2,
        -0.249,
        (minZ + maxZ) / 2,
        -Math.PI / 2,
      );
      shadowCatcher.receiveShadow = true;
      shadowCatcher.renderOrder = 1;

      if (detailTexture) {
        detailTexture.colorSpace = THREE.SRGBColorSpace;
        detailTexture.wrapS = THREE.ClampToEdgeWrapping;
        detailTexture.wrapT = THREE.ClampToEdgeWrapping;
        detailTexture.anisotropy = texture.anisotropy;
        detailTexture.needsUpdate = true;
        const detailBounds = satelliteExtent(OLDSTREET_SATELLITE_BOUNDS_WGS84);
        const detailMaterial = new THREE.MeshBasicMaterial({
          map: detailTexture,
          color: 0xffffff,
          toneMapped: false,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        detailMaterial.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <dithering_fragment>",
            `#include <dithering_fragment>
            float imageryFade =
              smoothstep(0.0, 0.06, vUv.x) *
              smoothstep(0.0, 0.06, vUv.y) *
              smoothstep(0.0, 0.06, 1.0 - vUv.x) *
              smoothstep(0.0, 0.06, 1.0 - vUv.y);
            gl_FragColor.a *= imageryFade;`,
          );
        };
        detailMaterial.customProgramCacheKey = () => "oldstreet-imagery-fade";
        const detailPlane = meshPlane(
          this.scene,
          detailMaterial,
          detailBounds.width,
          detailBounds.depth,
          (detailBounds.minX + detailBounds.maxX) / 2,
          -0.252,
          (detailBounds.minZ + detailBounds.maxZ) / 2,
          -Math.PI / 2,
        );
        detailPlane.receiveShadow = true;
        detailPlane.renderOrder = 0;
        this.satelliteMaterials.push(detailMaterial);
      }
      this.satelliteSource = "Esri World Imagery z17 + z18 detail";
    } catch (error) {
      console.warn("Satellite basemap unavailable; using procedural ground.", error);
    }
  }

  createSky() {
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.scene.add(this.sky);
    const uniforms = this.sky.material.uniforms;
    uniforms.turbidity.value = 7.2;
    uniforms.rayleigh.value = 1.45;
    uniforms.mieCoefficient.value = 0.0044;
    uniforms.mieDirectionalG.value = 0.82;

    this.hemisphereLight = new THREE.HemisphereLight(0xb6d0cf, 0x4d3d2c, 1.35);
    this.scene.add(this.hemisphereLight);
    this.ambientLight = new THREE.AmbientLight(0x9bb1ae, 0.06);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffe6c0, 3.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 680;
    this.sunLight.shadow.camera.left = -260;
    this.sunLight.shadow.camera.right = 260;
    this.sunLight.shadow.camera.top = 260;
    this.sunLight.shadow.camera.bottom = -260;
    this.sunLight.shadow.bias = -0.00025;
    this.sunLight.shadow.normalBias = 0.04;
    this.scene.add(this.sunLight);

    this.moonLight = new THREE.DirectionalLight(0x8ba6be, 0);
    this.moonLight.position.set(-100, 180, -120);
    this.scene.add(this.moonLight);

    this.scene.fog = new THREE.FogExp2(0x9a9a83, 0.00036);

    const starCount = 900;
    const positions = new Float32Array(starCount * 3);
    const random = seeded(2331);
    for (let i = 0; i < starCount; i += 1) {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(0.12 + random() * 0.88);
      const radius = 600 + random() * 500;
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.cos(phi) * radius;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0xe7ebdf,
        size: 1.2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.scene.add(this.stars);
  }

  buildLandscape() {
    const ground = meshPlane(
      this.scene,
      this.materials.ground,
      3200,
      3500,
      0,
      -0.28,
      -120,
      -Math.PI / 2,
    );
    ground.receiveShadow = true;

    // Waterways and the shoreline remain part of the georeferenced satellite
    // image. No procedural ocean or canal is laid over the real photograph.
  }

  buildSaltPans() {
    const foundation = new THREE.Mesh(
      new THREE.BoxGeometry(440, 0.5, 590),
      new THREE.MeshStandardMaterial({ color: 0x776c55, roughness: 1 }),
    );
    foundation.position.set(690, -0.08, 360);
    foundation.receiveShadow = true;
    this.scene.add(foundation);

    const columns = 14;
    const rows = 18;
    const panGeometry = new THREE.BoxGeometry(26.2, 0.08, 26.2);
    const panMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x76989a,
      roughness: 0.08,
      metalness: 0.04,
      transparent: true,
      opacity: 0.82,
      normalMap: this.waterNormal,
      normalScale: new THREE.Vector2(0.42, 0.42),
      clearcoat: 0.55,
    });
    this.saltPanMaterial = panMaterial;
    const pans = new THREE.InstancedMesh(panGeometry, panMaterial, columns * rows);
    pans.receiveShadow = true;
    const dummy = new THREE.Object3D();
    let index = 0;
    for (let col = 0; col < columns; col += 1) {
      for (let row = 0; row < rows; row += 1) {
        dummy.position.set(491 + col * 30, 0.22, 93 + row * 30);
        dummy.updateMatrix();
        pans.setMatrixAt(index, dummy.matrix);
        index += 1;
      }
    }
    this.scene.add(pans);

    const dikeMaterial = new THREE.MeshStandardMaterial({ color: 0x8a806d, roughness: 0.95 });
    for (let col = 0; col <= columns; col += 1) {
      meshBox(
        this.scene,
        dikeMaterial,
        1.35,
        0.48,
        552,
        476 + col * 30,
        0.15,
        360,
        false,
        true,
      );
    }
    for (let row = 0; row <= rows; row += 1) {
      meshBox(
        this.scene,
        dikeMaterial,
        430,
        0.48,
        1.35,
        690,
        0.15,
        78 + row * 30,
        false,
        true,
      );
    }

    meshBox(
      this.scene,
      dikeMaterial,
      452,
      0.72,
      8,
      690,
      0.2,
      63,
      false,
      true,
    );
    for (const side of [-1, 1]) {
      meshBox(
        this.scene,
        dikeMaterial,
        8,
        0.72,
        600,
        470 + side * 4,
        0.2,
        360,
        false,
        true,
      );
    }

    const saltPileMaterial = new THREE.MeshStandardMaterial({
      color: 0xe6e1d2,
      roughness: 0.92,
      flatShading: true,
    });
    const random = seeded(171);
    for (let i = 0; i < 48; i += 1) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.1 + random() * 1.5, 1.1 + random() * 1.5, 9),
        saltPileMaterial,
      );
      cone.position.set(480 + random() * 420, 0.72, 76 + random() * 548);
      cone.castShadow = true;
      this.scene.add(cone);
    }
  }

  buildFields() {
    const patches = [
      [-710, 220, 150, 92, 0.14],
      [-755, 530, 122, 145, -0.08],
      [-540, 1160, 180, 108, 0.04],
      [-60, 1260, 210, 105, -0.04],
      [390, 1110, 165, 92, 0.07],
      [1010, -820, 130, 205, 0.02],
    ];
    const rowMaterial = new THREE.MeshStandardMaterial({
      color: 0x657a45,
      roughness: 0.96,
    });
    const bundMaterial = new THREE.MeshStandardMaterial({
      color: 0x8c866d,
      roughness: 0.98,
    });
    for (const [x, z, width, depth, rotation] of patches) {
      const group = new THREE.Group();
      group.position.set(x, 0.03, z);
      group.rotation.y = rotation;
      const field = meshPlane(
        group,
        this.materials.field,
        width,
        depth,
        0,
        0,
        0,
        -Math.PI / 2,
      );
      field.receiveShadow = true;
      const rows = Math.max(5, Math.floor(width / 17));
      for (let row = 0; row < rows; row += 1) {
        meshBox(
          group,
          rowMaterial,
          width - 4,
          0.18,
          0.58,
          0,
          0.08,
          -depth * 0.42 + (row / (rows - 1)) * depth * 0.84,
          false,
          true,
        );
      }
      meshBox(group, bundMaterial, width + 2, 0.42, 1.2, 0, 0.16, -depth / 2, false, true);
      meshBox(group, bundMaterial, width + 2, 0.42, 1.2, 0, 0.16, depth / 2, false, true);
      for (const side of [-1, 1]) {
        meshBox(
          group,
          bundMaterial,
          1.2,
          0.42,
          depth,
          side * width / 2,
          0.16,
          0,
          false,
          true,
        );
      }
      this.scene.add(group);
    }
  }

  buildRoads() {
    this.roadPaths = [];
    const satelliteActive = Boolean(this.satelliteMaterial);
    for (const [index, road] of ROAD_PATHS.entries()) {
      const curvePoints = sampleCurve(road.points, 110);
      const shoulderMaterial = new THREE.MeshStandardMaterial({
          color: index === 0 ? 0x726f61 : 0x837c68,
          roughness: 0.96,
          side: THREE.DoubleSide,
          transparent: satelliteActive,
          opacity: satelliteActive ? 0.04 : 1,
          depthWrite: !satelliteActive,
        });
      const shoulder = new THREE.Mesh(
        makeRibbonGeometry(curvePoints, road.width + 3.8, 0.06),
        shoulderMaterial,
      );
      shoulder.receiveShadow = true;
      this.scene.add(shoulder);

      const isOldStreet = road.id === "shan-yao-old-street";
      const material = (isOldStreet ? this.materials.oldStreet : this.materials.asphalt).clone();
      material.map = cloneTexture(
        isOldStreet ? this.textures.oldStreet : this.textures.asphalt,
        isOldStreet ? 1.2 : 1.2,
        Math.max(4, road.points.length * 2),
      );
      material.roughness = isOldStreet ? 0.86 : 0.9;
      material.side = THREE.DoubleSide;
      material.transparent = satelliteActive;
      material.opacity = satelliteActive ? (isOldStreet ? 0.1 : 0.07) : 1;
      material.depthWrite = !satelliteActive;
      this.roadMaterials.push(material);
      const roadMesh = new THREE.Mesh(
        makeRibbonGeometry(curvePoints, road.width, isOldStreet ? 0.13 : 0.1),
        material,
      );
      roadMesh.receiveShadow = true;
      this.scene.add(roadMesh);

      const curve = new THREE.CatmullRomCurve3(
        road.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
        false,
        "centripetal",
      );
      this.roadPaths.push({ ...road, curve, points: curvePoints });

      if (index === 0 || index === 1 || index === 2) {
        const steps = index === 0 ? 12 : 7;
        for (let i = 0; i < steps; i += 1) {
          const point = curve.getPointAt((i + 0.4) / steps);
          const tangent = curve.getTangentAt((i + 0.4) / steps);
          const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
          const side = i % 2 === 0 ? 1 : -1;
          this.addStreetLamp(
            point.x + normal.x * (road.width * 0.72 + 1.4) * side,
            point.z + normal.z * (road.width * 0.72 + 1.4) * side,
            i % 3 === 0,
          );
        }
      }
    }

    const stoneLane = sampleCurve([
      [18, 34], [44, 17], [60, 0], [72, -17], [86, -34],
    ], 28);
    const lane = new THREE.Mesh(
      makeRibbonGeometry(stoneLane, 3.1, 0.13),
      this.materials.stonePath,
    );
    lane.receiveShadow = true;
    this.scene.add(lane);

    const bridge = new THREE.Group();
    meshBox(bridge, this.materials.graniteDark, 48, 0.7, 5.2, 0, 0.48, 0, true, true);
    for (const x of [-17, -8.5, 0, 8.5, 17]) {
      meshBox(bridge, this.materials.granite, 1.2, 2.2, 6.6, x, -0.4, 0, true, true);
    }
    for (const z of [-2.3, 2.3]) {
      meshBox(bridge, this.materials.granite, 49, 0.7, 0.45, 0, 1.1, z, true, true);
    }
    bridge.position.set(90, 0, -9);
    bridge.rotation.y = -0.12;
    this.scene.add(bridge);
  }

  buildOldStreetInfrastructure() {
    const road = this.roadPaths.find((item) => item.id === "shan-yao-old-street");
    if (!road) return;
    const curve = road.curve;
    const start = 0.38;
    const end = 0.72;

    for (const side of [-1, 1]) {
      const edgePoints = [];
      for (let index = 0; index <= 120; index += 1) {
        const t = THREE.MathUtils.lerp(start, end, index / 120);
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t);
        edgePoints.push(
          new THREE.Vector3(
            point.x - tangent.z * road.width * 0.48 * side,
            0.16,
            point.z + tangent.x * road.width * 0.48 * side,
          ),
        );
      }
      const gutterCurve = new THREE.CatmullRomCurve3(edgePoints, false, "centripetal");
      const gutter = new THREE.Mesh(
        new THREE.TubeGeometry(gutterCurve, 120, 0.095, 5, false),
        this.materials.graniteDark,
      );
      gutter.receiveShadow = true;
      this.scene.add(gutter);
    }

    const poleGroups = [];
    const poleCount = 11;
    for (let index = 0; index < poleCount; index += 1) {
      const t = THREE.MathUtils.lerp(start, end, index / (poleCount - 1));
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const x = point.x + normal.x * (road.width * 0.5 + 2.15);
      const z = point.z + normal.z * (road.width * 0.5 + 2.15);
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      group.rotation.y = Math.atan2(tangent.x, tangent.z);
      cylinder(group, this.materials.concrete, 0.13, 0.18, 7.2, 8, 0, 3.6, 0);
      meshBox(group, this.materials.woodDark, 2.15, 0.1, 0.1, 0, 6.9, 0);
      for (const offset of [-0.82, 0, 0.82]) {
        const insulator = sphere(
          group,
          this.materials.white,
          0.085,
          offset,
          7.03,
          0,
          8,
          6,
        );
        insulator.castShadow = false;
      }
      this.scene.add(group);
      poleGroups.push({ group, point: new THREE.Vector3(x, 6.95, z), tangent, normal });
      this.addCollider(x, z, 0.58, 0.58, 0);
    }

    const wireMaterial = new THREE.LineBasicMaterial({
      color: 0x171b1a,
      transparent: true,
      opacity: 0.72,
    });
    for (let wire = 0; wire < 3; wire += 1) {
      const offset = (wire - 1) * 0.82;
      for (let index = 0; index < poleGroups.length - 1; index += 1) {
        const a = poleGroups[index];
        const b = poleGroups[index + 1];
        const points = [];
        for (let step = 0; step <= 10; step += 1) {
          const t = step / 10;
          points.push(
            new THREE.Vector3(
              THREE.MathUtils.lerp(a.point.x, b.point.x, t) + a.normal.x * offset,
              THREE.MathUtils.lerp(a.point.y, b.point.y, t) - Math.sin(t * Math.PI) * 0.42,
              THREE.MathUtils.lerp(a.point.z, b.point.z, t) + a.normal.z * offset,
            ),
          );
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        this.scene.add(new THREE.Line(geometry, wireMaterial));
      }
    }

    const drainMaterial = new THREE.MeshStandardMaterial({
      color: 0x323a36,
      roughness: 0.7,
      metalness: 0.36,
    });
    for (let index = 0; index < 9; index += 1) {
      const t = THREE.MathUtils.lerp(start + 0.01, end - 0.01, index / 8);
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const drain = meshBox(
        this.scene,
        drainMaterial,
        0.62,
        0.035,
        0.42,
        point.x + normal.x * road.width * 0.35,
        0.17,
        point.z + normal.z * road.width * 0.35,
        false,
        true,
      );
      drain.rotation.y = Math.atan2(tangent.x, tangent.z);
    }

    const shopSigns = [
      { t: 0.455, text: "锋宾面线糊", side: -1 },
      { t: 0.486, text: "郑记煎包", side: 1 },
      { t: 0.512, text: "老巷糖杂货", side: -1 },
      { t: 0.541, text: "华艺教育书店", side: 1 },
      { t: 0.568, text: "港兴堂大药店", side: -1 },
    ];
    for (const signData of shopSigns) {
      const point = curve.getPointAt(signData.t);
      const tangent = curve.getTangentAt(signData.t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const group = new THREE.Group();
      group.position.set(
        point.x + normal.x * (road.width * 0.5 + signData.side * 0.72),
        4.35,
        point.z + normal.z * (road.width * 0.5 + signData.side * 0.72),
      );
      group.rotation.y = Math.atan2(-tangent.x, -tangent.z);
      meshBox(group, this.materials.woodDark, 2.25, 0.68, 0.09, 0, 0, 0);
      const sign = makeTexturedNameplate(signData.text, {
        width: 920,
        height: 220,
        fontSize: 78,
        background: "#3a2a22",
        color: "#ead19a",
        borderColor: "#9a7547",
      });
      sign.scale.set(2.08, 0.52, 1);
      sign.position.z = 0.06;
      group.add(sign);
      const arm = meshBox(
        group,
        this.materials.metal,
        0.05,
        0.05,
        1.3,
        0,
        0.38,
        -signData.side * 0.62,
        false,
        false,
      );
      arm.rotation.y = Math.PI / 2;
      this.scene.add(group);
    }
  }

  addStreetLamp(x, z, lightEnabled) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    cylinder(group, this.materials.woodDark, 0.08, 0.12, 3.8, 7, 0, 1.9, 0);
    meshBox(group, this.materials.woodDark, 1.1, 0.08, 0.08, 0.42, 3.75, 0);
    const lantern = new THREE.Group();
    lantern.position.set(0.85, 3.36, 0);
    makeLantern(lantern, this.materials, 0.62);
    group.add(lantern);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xffb668,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.position.set(0.85, 3.28, 0);
    glow.scale.setScalar(3.4);
    group.add(glow);
    if (lightEnabled) {
      const light = new THREE.PointLight(0xffa95e, 0, 22, 2);
      light.position.set(0.85, 3.26, 0);
      group.add(light);
      this.lampLights.push({ light, glow });
    }
    this.scene.add(group);
  }

  buildStreetLife() {
    const stallMaterial = new THREE.MeshStandardMaterial({ color: 0x6a4530, roughness: 0.84 });
    const clothMaterial = new THREE.MeshStandardMaterial({
      color: 0xaa4633,
      roughness: 0.82,
      side: THREE.DoubleSide,
    });
    const positions = [
      [142, 0, -706, 0.2], [126, 0, -681, -0.1],
      [105, 0, -658, 0.14], [87, 0, -635, -0.24],
      [72, 0, -610, 0.1],
    ];
    for (let i = 0; i < positions.length; i += 1) {
      const [x, , z, rot] = positions[i];
      const stall = new THREE.Group();
      stall.position.set(x, 0, z);
      stall.rotation.y = rot;
      meshBox(stall, stallMaterial, 3.6, 0.2, 2.1, 0, 1.1, 0);
      for (const sx of [-1.55, 1.55]) {
        for (const sz of [-0.8, 0.8]) {
          meshBox(stall, this.materials.woodDark, 0.08, 1.1, 0.08, sx, 0.56, sz);
        }
      }
      meshBox(stall, clothMaterial, 4.2, 0.08, 2.55, 0, 2.25, 0);
      for (const sx of [-1.9, -0.65, 0.65, 1.9]) {
        meshBox(stall, clothMaterial, 0.12, 1.3, 0.12, sx, 1.55, 1.17);
      }
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(1, 0.36, 0.7),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x94724e : 0x607764, roughness: 0.9 }),
      );
      crate.position.set(0.6, 1.38, 0.2);
      crate.castShadow = true;
      stall.add(crate);
      this.scene.add(stall);
    }

    const lightCordPoints = [
      new THREE.Vector3(170, 5.2, -730),
      new THREE.Vector3(145, 4.3, -705),
      new THREE.Vector3(113, 5.1, -674),
      new THREE.Vector3(87, 4.2, -640),
      new THREE.Vector3(58, 5.4, -604),
    ];
    const cordCurve = new THREE.CatmullRomCurve3(lightCordPoints);
    const cord = new THREE.Mesh(
      new THREE.TubeGeometry(cordCurve, 60, 0.025, 4, false),
      new THREE.MeshBasicMaterial({ color: 0x1b1a17 }),
    );
    this.scene.add(cord);
    for (let i = 2; i < 20; i += 1) {
      const p = cordCurve.getPointAt(i / 22);
      const bulb = sphere(
        this.scene,
        new THREE.MeshBasicMaterial({ color: 0xffb663, toneMapped: false }),
        0.12,
        p.x,
        p.y - 0.18,
        p.z,
        8,
        6,
      );
      bulb.castShadow = false;
    }

    for (const [x, z, rotation] of [[160, -720, 0.07], [102, -665, -0.08], [64, -610, 0.12]]) {
      this.addBikeRack(x, z, rotation);
    }

    const road = this.roadPaths.find((item) => item.id === "shan-yao-old-street");
    if (road) {
      const clothColors = [0xc9bca4, 0x6d858b, 0x9e5847, 0xd9d0bc];
      const clothMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.92,
        side: THREE.DoubleSide,
      });
      for (let index = 0; index < 3; index += 1) {
        const t = 0.47 + index * 0.045;
        const side = index % 2 === 0 ? 1 : -1;
        const center = road.curve.getPointAt(t);
        const tangent = road.curve.getTangentAt(t);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const anchorOffset = road.width * 0.5 + 2.1;
        const lineStart = new THREE.Vector3(
          center.x + normal.x * anchorOffset - tangent.x * 2.5,
          4.7,
          center.z + normal.z * anchorOffset - tangent.z * 2.5,
        );
        const lineEnd = new THREE.Vector3(
          center.x + normal.x * anchorOffset + tangent.x * 2.5,
          4.7,
          center.z + normal.z * anchorOffset + tangent.z * 2.5,
        );
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([lineStart, lineEnd]),
          new THREE.LineBasicMaterial({ color: 0x2b2924 }),
        );
        this.scene.add(line);
        for (let piece = 0; piece < 3; piece += 1) {
          const material = clothMaterial.clone();
          material.color.setHex(clothColors[(index + piece) % clothColors.length]);
          const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.05, 3, 3), material);
          const step = (piece + 1) / 4;
          cloth.position.set(
            THREE.MathUtils.lerp(lineStart.x, lineEnd.x, step),
            4.13,
            THREE.MathUtils.lerp(lineStart.z, lineEnd.z, step),
          );
          cloth.rotation.y = Math.atan2(normal.x * side, normal.z * side);
          cloth.castShadow = true;
          cloth.userData.phase = index * 1.7 + piece * 0.8;
          cloth.userData.baseRotationY = cloth.rotation.y;
          this.cloths.push(cloth);
          this.scene.add(cloth);
        }
      }
    }
  }

  addBikeRack(x, z, rotation) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    for (const offset of [-0.5, 0, 0.5]) {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.035, 6, 12, Math.PI),
        this.materials.metal,
      );
      arc.position.set(offset, 0.5, 0);
      arc.rotation.x = Math.PI / 2;
      group.add(arc);
    }
    this.scene.add(group);
  }

  buildVillage() {
    const houseLayout = [
      [-170, 111, 0.12, 0.91], [-151, 83, -0.08, 0.86], [-187, 76, 0.18, 0.82],
      [-129, 68, 0.06, 0.94], [-83, 82, -0.16, 0.82], [-48, 79, 0.12, 0.86],
      [-9, 69, -0.1, 0.9], [27, 60, 0.05, 0.83],
      [-144, -20, 0.11, 0.87], [-167, -58, -0.09, 0.8], [-88, -78, 0.18, 0.92],
      [-45, -66, -0.15, 0.84], [18, -47, 0.05, 0.9], [101, -71, 0.12, 0.85],
      [130, -106, -0.08, 0.88], [-21, -137, 0.09, 0.86], [26, -158, -0.14, 0.82],
      [79, -139, 0.04, 0.9], [110, -152, 0.1, 0.84],
      [115, 109, 0.07, 0.86], [145, 129, -0.1, 0.82], [174, 91, 0.13, 0.9],
      [189, 54, -0.07, 0.82], [10, 124, 0.1, 0.84],
    ];
    houseLayout.forEach(([x, z, rotation, scale], index) => {
      this.createTraditionalHouse({
        x,
        z,
        rotation,
        scale,
        accent: index % 4 === 0 ? "brick" : index % 3 === 0 ? "stone" : "mixed",
        courtyard: index % 5 !== 0,
        twoStorey: index === 7 || index === 16,
      });
    });

    this.createAncestralHall(-100, 19, Math.PI * 0.02);
    this.createWell(-13, 29);
    this.createSchool(39, -89, -0.08);
    this.createCommunityCenter(-137, 101, 0.1);

    for (let i = 0; i < 13; i += 1) {
      const x = 292 + (i % 4) * 21;
      const z = -335 - Math.floor(i / 4) * 34;
      this.createModernTower(x, z, 22 + (i % 3) * 8, 9 + (i % 2) * 3, i);
    }
  }

  async buildRealVillage() {
    const response = await fetch("/data/buildings_real.geojson");
    if (!response.ok) {
      throw new Error(`Unable to load real building footprints (${response.status})`);
    }
    const overviewCollection = await response.json();
    const fullDetailResponse = await fetch("/data/buildings_overture.geojson");
    if (fullDetailResponse.ok) {
      const detailCollection = await fullDetailResponse.json();
      const coveredCells = new Set();
      for (const feature of detailCollection.features || []) {
        const centroid = feature.properties?.centroid_local;
        if (!centroid) continue;
        coveredCells.add(
          `${Math.floor(centroid[0] / 100)},${Math.floor(centroid[1] / 100)}`,
        );
      }
      const fallbackFeatures = (overviewCollection.features || []).filter((feature) => {
        const centroid = feature.properties?.centroid_local;
        if (!centroid) return true;
        const cell = `${Math.floor(centroid[0] / 100)},${Math.floor(centroid[1] / 100)}`;
        return !coveredCells.has(cell);
      });
      this.buildingCollection = {
        ...detailCollection,
        name: "Daigang Overture footprints with GBA coverage fallback",
        overview_source: overviewCollection.source,
        detail_source: detailCollection.source,
        detail_bbox_wgs84: detailCollection.clip_bbox_wgs84,
        fallback_source: overviewCollection.source,
        fallback_features: fallbackFeatures.length,
        features: [...(detailCollection.features || []), ...fallbackFeatures],
      };
    } else {
      const focusedResponse = await fetch("/data/buildings_oldstreet.geojson");
      if (focusedResponse.ok) {
        const detailCollection = await focusedResponse.json();
        const [west, south, east, north] = detailCollection.clip_bbox_wgs84;
        const overviewFeatures = (overviewCollection.features || []).filter((feature) => {
          const centroid = feature.properties?.centroid_local;
          if (!centroid) return true;
          const coordinate = localToWgs84(centroid[0], centroid[1]);
          return (
            coordinate.lon < west ||
            coordinate.lon > east ||
            coordinate.lat < south ||
            coordinate.lat > north
          );
        });
        this.buildingCollection = {
          ...overviewCollection,
          name: "Daigang overview plus detailed Shanyao Old Street footprints",
          overview_source: overviewCollection.source,
          detail_source: detailCollection.source,
          detail_bbox_wgs84: detailCollection.clip_bbox_wgs84,
          features: [...overviewFeatures, ...(detailCollection.features || [])],
        };
      } else {
        this.buildingCollection = overviewCollection;
      }
    }
    const result = createRealBuildings({
      scene: this.scene,
      collection: this.buildingCollection,
      materials: this.materials,
      textures: this.textures,
      roads: this.roadPaths,
      satelliteSample: this.sampleSatelliteColor,
      progress: (progress) => {
        this.progress(
          progress,
          `按真实轮廓重建建筑 ${Math.round(progress * 100)}%`,
        );
      },
    });
    this.sampleSatelliteColor = null;
    this.realBuildings = result;
    this.buildingCenters = result.centers;
    this.colliders.push(...result.colliders);
    this.windowMaterials.push(result.windowMaterial);
    this.progress(0.75, `已重建 ${result.count.toLocaleString("zh-CN")} 栋建筑`);
    this.createAncestralHall(-249, -229, 0.18);
    this.createSchool(-108, 742, -0.06);
  }

  createTraditionalHouse({
    x,
    z,
    rotation = 0,
    scale = 1,
    accent = "mixed",
    courtyard = true,
    twoStorey = false,
    landmark = false,
  }) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    group.scale.setScalar(scale);

    const width = 15.5;
    const depth = 5.6;
    const wallHeight = twoStorey ? 5.6 : 3.25;
    const plasterWall = accent === "stone" ? this.materials.granite : this.materials.plaster;
    const upperWall = accent === "brick" ? this.materials.brick : plasterWall;

    meshBox(group, this.materials.stone, width + 2.1, 0.22, depth + 5.8, 0, 0.12, 1.1, false, true);
    if (courtyard) {
      meshPlane(group, this.materials.stonePath, width - 1.2, 8.5, 0, 0.24, 5.6, -Math.PI / 2);
    }

    meshBox(group, this.materials.granite, width, 1.42, depth, 0, 0.89, 0, true, true);
    meshBox(group, upperWall, width - 0.06, wallHeight - 1.4, depth - 0.02, 0, 1.42 + (wallHeight - 1.4) / 2, 0, true, true);

    for (const px of [-width / 2 + 0.25, width / 2 - 0.25]) {
      cylinder(group, this.materials.redPaint, 0.16, 0.18, wallHeight + 0.45, 10, px, (wallHeight + 0.45) / 2, depth / 2 + 0.05);
    }

    const doorMaterial = new THREE.MeshStandardMaterial({
      color: 0x311c17,
      roughness: 0.65,
      metalness: 0.08,
    });
    meshPlane(group, doorMaterial, 2.25, 2.45, 0, 1.4, depth / 2 + 0.07);
    for (const dx of [-1.15, 1.15]) {
      meshBox(group, this.materials.redPaint, 0.12, 2.65, 0.12, dx, 1.4, depth / 2 + 0.1);
    }
    for (const side of [-1, 1]) {
      meshPlane(
        group,
        this.materials.glowingWindow,
        2.3,
        1.35,
        side * 4.1,
        twoStorey ? 4.7 : 2.35,
        depth / 2 + 0.07,
      );
      meshBox(group, this.materials.woodDark, 2.5, 0.12, 0.16, side * 4.1, twoStorey ? 5.42 : 3.06, depth / 2 + 0.12);
    }

    if (twoStorey) {
      meshBox(group, this.materials.woodDark, width - 0.8, 0.16, 2.4, 0, 3.3, depth / 2 + 0.65);
      for (let rail = -6; rail <= 6; rail += 1.4) {
        meshBox(group, this.materials.woodDark, 0.08, 0.85, 0.08, rail, 3.76, depth / 2 + 1.72);
      }
      meshBox(group, this.materials.woodDark, width - 0.8, 0.09, 0.12, 0, 4.2, depth / 2 + 1.72);
    }

    const roofHeight = landmark ? 2.15 : 1.68;
    const roof = createCurvedRoof(
      width + 1.7,
      depth + 2.6,
      roofHeight,
      landmark ? this.materials.templeRoof : this.materials.roof,
      this.materials.roof,
    );
    roof.position.set(0, wallHeight + 0.04, 0);
    group.add(roof);

    const gableMaterial = upperWall;
    for (const side of [-1, 1]) {
      const gable = createGableEnd(width, depth, wallHeight, gableMaterial);
      gable.position.set(0, 0.16, 0);
      gable.rotation.y = side === 1 ? 0 : Math.PI;
      gable.castShadow = true;
      group.add(gable);
    }

    if (courtyard) {
      const wallHeightLow = 1.65;
      meshBox(group, this.materials.granite, 5.8, wallHeightLow, 0.35, -width / 2 - 1.4, 0.92, 9.2);
      meshBox(group, this.materials.granite, 5.8, wallHeightLow, 0.35, width / 2 + 1.4, 0.92, 9.2);
      meshBox(group, this.materials.granite, width + 7, 0.28, 0.48, 0, 2.25, 9.2);
      meshBox(group, this.materials.woodDark, 3.4, 2.3, 0.18, 0, 1.18, 9.22);
      for (const side of [-1, 1]) {
        meshBox(group, this.materials.granite, 3.7, 2.25, 3.8, side * (width / 2 + 2.6), 1.25, 4.9);
        const wingRoof = createCurvedRoof(5.2, 6.8, 1.18, this.materials.roof, this.materials.roof);
        wingRoof.position.set(side * (width / 2 + 2.6), 2.4, 4.9);
        group.add(wingRoof);
        meshPlane(group, this.materials.glowingWindow, 1.15, 1.15, side * (width / 2 + 2.6), 1.35, 6.82);
      }
    }

    if (landmark) {
      const plaque = makeTexturedNameplate("锦绣传芳", { fontSize: 108 });
      plaque.scale.set(4.2, 1.16, 1);
      plaque.position.set(0, wallHeight - 0.28, depth / 2 + 0.12);
      group.add(plaque);
    }

    makeLantern(group, this.materials, 0.7).position.set(-3.9, 2.95, depth / 2 + 0.35);
    makeLantern(group, this.materials, 0.7).position.set(3.9, 2.95, depth / 2 + 0.35);

    this.scene.add(group);
    this.addCollider(x, z, width * scale + 7, depth * scale + 17, rotation);
    return group;
  }

  createAncestralHall(x, z, rotation) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    meshPlane(group, this.materials.stonePath, 36, 25, 0, 0.08, 0, -Math.PI / 2);
    meshBox(group, this.materials.graniteDark, 31, 0.45, 9, 0, 0.36, -1.2);
    for (let column = -3; column <= 3; column += 1) {
      cylinder(group, this.materials.redPaint, 0.24, 0.28, 5.8, 12, column * 3.8, 2.9, 0.6);
    }
    meshBox(group, this.materials.woodWarm, 25, 0.5, 7.8, 0, 3.2, -1.1);
    meshBox(group, this.materials.plaster, 25, 2.4, 7.8, 0, 1.45, -1.3);
    const roof = createCurvedRoof(30, 13, 2.65, this.materials.templeRoof, this.materials.roof);
    roof.position.y = 5.25;
    group.add(roof);
    const nameplate = makeTexturedNameplate("庄氏宗祠", { fontSize: 110 });
    nameplate.scale.set(5.6, 1.52, 1);
    nameplate.position.set(0, 4.95, 3.05);
    group.add(nameplate);
    for (const side of [-1, 1]) {
      makeLantern(group, this.materials, 0.78).position.set(side * 8.2, 4.2, 5.4);
    }
    for (let i = -2; i <= 2; i += 1) {
      meshBox(group, this.materials.granite, 3.2, 0.16, 1.2, i * 4.8, 0.23, 6.3);
    }
    this.scene.add(group);
    this.addCollider(x, z, 34, 25, rotation, true);
  }

  createWell(x, z) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    cylinder(group, this.materials.granite, 1.55, 1.7, 0.85, 24, 0, 0.42, 0);
    cylinder(group, new THREE.MeshStandardMaterial({ color: 0x1d4d52, roughness: 0.2 }), 1.32, 1.35, 0.1, 24, 0, 0.78, 0);
    this.scene.add(group);
  }

  createSchool(x, z, rotation) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    meshBox(group, this.materials.concrete, 38, 8.6, 12, 0, 4.3, 0, true, true);
    for (let floor = 0; floor < 2; floor += 1) {
      for (let i = -4; i <= 4; i += 1) {
        meshPlane(group, this.materials.window, 2.3, 1.8, i * 3.5, 2.3 + floor * 3.1, 6.03);
      }
    }
    meshBox(group, this.materials.redPaint, 13, 0.8, 0.2, 0, 7.25, 6.05);
    const schoolName = makeTexturedNameplate("埭港小学", {
      background: "#d8d0b9",
      color: "#8f3026",
      borderColor: "#8f3026",
      fontSize: 104,
    });
    schoolName.scale.set(8.6, 1.95, 1);
    schoolName.position.set(0, 6.4, 6.12);
    group.add(schoolName);
    this.scene.add(group);
    this.addCollider(x, z, 40, 14, rotation);
  }

  createCommunityCenter(x, z, rotation) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    meshBox(group, this.materials.plaster, 18, 3.1, 8, 0, 1.55, 0);
    meshBox(group, this.materials.brick, 18.1, 0.9, 8.1, 0, 2.65, 0);
    const roof = createCurvedRoof(19.4, 9.4, 1.2, this.materials.roof, this.materials.roof);
    roof.position.y = 3.2;
    group.add(roof);
    const sign = makeTexturedNameplate("老人活动中心", { fontSize: 88 });
    sign.scale.set(5.4, 1.48, 1);
    sign.position.set(0, 2.65, 4.08);
    group.add(sign);
    this.scene.add(group);
    this.addCollider(x, z, 20, 10, rotation);
  }

  createModernTower(x, z, height, width, index) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const material = new THREE.MeshStandardMaterial({
      color: index % 2 ? 0xb3b1a8 : 0x999f9a,
      roughness: 0.76,
    });
    meshBox(group, material, width, height, width * 0.62, 0, height / 2, 0, false, true);
    for (let floor = 2; floor < height - 1; floor += 3.1) {
      meshBox(
        group,
        this.materials.glowingWindow,
        width + 0.08,
        0.34,
        width * 0.64,
        0,
        floor,
        0,
        false,
        false,
      );
    }
    this.scene.add(group);
  }

  buildHeritageLandmarks() {
    this.createShiqiaoComplex();
    this.createLongjiangong();
    this.createWatchtower();
  }

  createShiqiaoComplex() {
    const positions = [
      [-392, -326, 0.1, 0.8], [-376, -332, 0.1, 0.9],
      [-359, -338, 0.1, 0.82], [-389, -352, 0.1, 0.72],
      [-371, -356, 0.1, 0.78], [-354, -360, 0.1, 0.7],
    ];
    positions.forEach(([x, z, r, s], i) => {
      const house = this.createTraditionalHouse({
        x,
        z,
        rotation: r,
        scale: s,
        accent: i % 2 === 0 ? "mixed" : "brick",
        courtyard: i % 3 !== 0,
        landmark: true,
      });
      if (i === 1) {
        const plaque = makeTexturedNameplate("山腰庄氏古民居", {
          width: 1100,
          fontSize: 82,
          background: "#2b211d",
          color: "#dfc58c",
        });
        plaque.scale.set(7.2, 1.65, 1);
        plaque.position.set(0, 4.3, 11.45);
        house.add(plaque);
      }
    });
    // The complex is intentionally walked as a loose nine-courtyard ensemble;
    // three deeper wings are suggested behind the main row.
    meshPlane(this.scene, this.materials.stonePath, 47, 43, -374, 0.13, -340, -Math.PI / 2);
  }

  createLongjiangong() {
    const x = -455;
    const z = 416;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = -0.16;
    meshPlane(group, this.materials.stonePath, 43, 38, 0, 0.08, 3, -Math.PI / 2);
    meshBox(group, this.materials.granite, 28, 0.7, 13, 0, 0.38, 0);
    meshBox(group, this.materials.granite, 22, 1.45, 4, 0, 1.15, 10.5);
    for (const side of [-1, 1]) {
      meshBox(group, this.materials.granite, 3.2, 4.6, 3.2, side * 9.8, 2.3, 8.3);
    }
    meshBox(group, this.materials.brick, 21, 4.2, 9.2, 0, 2.7, -1.6);
    for (let i = -3; i <= 3; i += 1) {
      cylinder(group, this.materials.redPaint, 0.27, 0.3, 5.5, 12, i * 3.1, 3.18, 3);
    }
    meshBox(group, this.materials.woodWarm, 21.5, 0.5, 9.8, 0, 5.38, -1.2);
    const roof = createCurvedRoof(27, 17, 2.9, this.materials.templeRoof, this.materials.roof);
    roof.position.set(0, 6.1, -3.6);
    group.add(roof);
    const frontRoof = createCurvedRoof(31, 8, 1.55, this.materials.templeRoof, this.materials.roof);
    frontRoof.position.set(0, 4.95, 4.1);
    group.add(frontRoof);
    const nameplate = makeTexturedNameplate("龙见宫", {
      width: 780,
      height: 250,
      fontSize: 138,
      background: "#3a211a",
      color: "#e9cb89",
    });
    nameplate.scale.set(5.3, 1.7, 1);
    nameplate.position.set(0, 5.7, 3.62);
    group.add(nameplate);

    for (const side of [-1, 1]) {
      makeLantern(group, this.materials, 0.92).position.set(side * 8.1, 4.15, 4.1);
      const lion = new THREE.Group();
      lion.position.set(side * 11.4, 0, 15.8);
      sphere(lion, this.materials.graniteDark, 1.05, 0, 1.15, 0, 12, 8);
      sphere(lion, this.materials.graniteDark, 0.62, 0, 2.0, 0.1, 10, 8);
      meshBox(lion, this.materials.granite, 2.1, 0.45, 2.7, 0, 0.4, 0);
      group.add(lion);
    }
    const censer = cylinder(group, this.materials.brass, 0.85, 1.08, 1.15, 12, 0, 0.85, 16.5);
    censer.castShadow = true;
    for (let i = -2; i <= 2; i += 1) {
      meshBox(group, this.materials.granite, 2.8, 0.1, 1.15, i * 2.5, 0.18 + Math.abs(i) * -0.0, 21);
    }
    this.scene.add(group);
    this.addCollider(x, z, 34, 43, -0.16, true);
    this.tagPoi(group, "longjiangong");
  }

  createWatchtower() {
    const x = 17;
    const z = 73;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = 0.1;
    meshBox(group, this.materials.graniteDark, 8.4, 7.8, 7.4, 0, 3.9, 0);
    meshBox(group, this.materials.granite, 7.2, 4.8, 6.3, 0, 9.9, 0);
    meshBox(group, this.materials.woodWarm, 8.1, 0.22, 7.2, 0, 7.95, 0);
    for (const side of [-1, 1]) {
      for (const depthSide of [-1, 1]) {
        for (let rail = -2; rail <= 2; rail += 1) {
          meshBox(group, this.materials.woodDark, 0.08, 0.9, 0.08, rail, 8.45, depthSide * 3.3);
        }
      }
    }
    for (const floor of [3.2, 7.8, 10.2]) {
      for (const side of [-1, 1]) {
        meshPlane(group, this.materials.glowingWindow, 1.25, 1.5, side * 2.0, floor, side > 0 ? 3.73 : -3.73, 0, side > 0 ? 0 : Math.PI);
      }
    }
    const lowerRoof = createCurvedRoof(10, 8.8, 1.3, this.materials.roof, this.materials.roof);
    lowerRoof.position.y = 8.18;
    group.add(lowerRoof);
    const roof = createCurvedRoof(10.5, 9.6, 1.85, this.materials.roof, this.materials.roof);
    roof.position.y = 12.3;
    group.add(roof);
    const plate = makeTexturedNameplate("望海楼", { fontSize: 118 });
    plate.scale.set(4.0, 1.12, 1);
    plate.position.set(0, 11.4, 3.85);
    group.add(plate);
    cylinder(group, this.materials.woodDark, 0.06, 0.06, 7.4, 6, 6.3, 16.2, -3.1);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(2.7, 1.4, 6, 2),
      new THREE.MeshStandardMaterial({ color: 0xa82f25, side: THREE.DoubleSide, roughness: 0.8 }),
    );
    flag.position.set(7.7, 18.6, -3.1);
    group.add(flag);
    this.scene.add(group);
    this.addCollider(x, z, 12, 12, 0.1, true);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xffb464,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.position.set(x, 13.3, z + 3.9);
    glow.scale.setScalar(6);
    this.scene.add(glow);
    this.lampLights.push({ glow, light: null });
    this.tagPoi(group, "watchtower");
  }

  buildNature() {
    const treePositions = [
      [-520, -610, 1.15], [-352, -528, 0.9], [-188, -902, 1.02],
      [314, -788, 0.94], [-424, -124, 0.82], [282, -286, 0.86],
      [-552, 252, 0.92], [-338, 348, 0.88], [-88, 262, 0.78],
      [184, 506, 0.84], [-424, 646, 0.93], [421, -118, 0.72],
      [-328, -16, 0.82], [32, -468, 0.76], [268, -506, 0.72],
      [-272, -748, 0.8], [518, 662, 0.74], [438, 350, 0.7],
      [-588, -340, 0.78], [348, 58, 0.7], [-210, -612, 0.68],
    ];
    for (const [x, z, scale] of treePositions) {
      this.createTree(x, z, scale);
    }

    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x8d8c7d, roughness: 0.98, flatShading: true });
    const random = seeded(761);
    for (let i = 0; i < 30; i += 1) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.4 + random() * 1.1, 0),
        rockMaterial,
      );
      rock.position.set(-260 + random() * 640, 0.2 + random() * 0.3, -230 + random() * 470);
      rock.scale.y = 0.4 + random() * 0.6;
      rock.rotation.set(random(), random(), random());
      rock.castShadow = true;
      this.scene.add(rock);
    }

    for (const [x, z, scale] of [
      [335, -154, 1], [354, -99, 0.88], [371, 18, 0.95], [342, 103, 0.82],
      [383, 175, 0.86], [268, 214, 0.75],
    ]) {
      this.createPalm(x, z, scale);
    }

    const shrubMaterial = new THREE.MeshStandardMaterial({
      color: 0x49653e,
      roughness: 1,
      flatShading: true,
    });
    const shrubs = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.62, 0),
      shrubMaterial,
      260,
    );
    shrubs.castShadow = true;
    shrubs.receiveShadow = true;
    const shrubRandom = seeded(9904);
    const shrubAreas = [
      [-249, 140, 115, 55], [-205, 119, 75, 35], [-153, 178, 94, 44],
      [15, 156, 98, 54], [98, 152, 58, 37], [-195, -194, 104, 48],
      [229, 192, 90, 28], [216, -204, 105, 38],
    ];
    const shrubDummy = new THREE.Object3D();
    for (let i = 0; i < shrubs.count; i += 1) {
      const area = shrubAreas[Math.floor(shrubRandom() * shrubAreas.length)];
      shrubDummy.position.set(
        area[0] + (shrubRandom() - 0.5) * area[2],
        0.34,
        area[1] + (shrubRandom() - 0.5) * area[3],
      );
      shrubDummy.rotation.set(shrubRandom() * 0.2, shrubRandom() * Math.PI, shrubRandom() * 0.2);
      const scale = 0.55 + shrubRandom() * 1.05;
      shrubDummy.scale.set(scale, 0.55 + shrubRandom() * 0.7, scale);
      shrubDummy.updateMatrix();
      shrubs.setMatrixAt(i, shrubDummy.matrix);
    }
    shrubs.instanceMatrix.needsUpdate = true;
    this.scene.add(shrubs);

    const riceTuftGeometry = new THREE.ConeGeometry(0.12, 0.8, 4);
    const riceTuftMaterial = new THREE.MeshStandardMaterial({
      color: 0x79924d,
      roughness: 0.92,
      flatShading: true,
    });
    const riceTufts = new THREE.InstancedMesh(riceTuftGeometry, riceTuftMaterial, 520);
    const riceRandom = seeded(340);
    const riceDummy = new THREE.Object3D();
    for (let i = 0; i < riceTufts.count; i += 1) {
      riceDummy.position.set(
        -284 + riceRandom() * 72,
        0.38,
        151 + (riceRandom() - 0.5) * 50,
      );
      riceDummy.rotation.set((riceRandom() - 0.5) * 0.18, riceRandom() * Math.PI, (riceRandom() - 0.5) * 0.18);
      riceDummy.scale.set(0.65 + riceRandom() * 0.65, 0.7 + riceRandom() * 0.45, 0.65 + riceRandom() * 0.65);
      riceDummy.updateMatrix();
      riceTufts.setMatrixAt(i, riceDummy.matrix);
    }
    riceTufts.instanceMatrix.needsUpdate = true;
    this.scene.add(riceTufts);

    const flowerColors = [0xd4a665, 0xc96e56, 0xe4d3a4];
    for (let variant = 0; variant < flowerColors.length; variant += 1) {
      const flowers = new THREE.InstancedMesh(
        new THREE.TetrahedronGeometry(0.16, 0),
        new THREE.MeshBasicMaterial({ color: flowerColors[variant] }),
        70,
      );
      const flowerRandom = seeded(112 + variant * 19);
      const flowerDummy = new THREE.Object3D();
      for (let i = 0; i < flowers.count; i += 1) {
        flowerDummy.position.set(
          -235 + flowerRandom() * 370,
          0.36 + flowerRandom() * 0.25,
          -174 + flowerRandom() * 355,
        );
        flowerDummy.rotation.set(flowerRandom() * 2, flowerRandom() * 2, flowerRandom() * 2);
        const scale = 0.7 + flowerRandom() * 0.8;
        flowerDummy.scale.set(scale, scale, scale);
        flowerDummy.updateMatrix();
        flowers.setMatrixAt(i, flowerDummy.matrix);
      }
      flowers.instanceMatrix.needsUpdate = true;
      this.scene.add(flowers);
    }
  }

  createTree(x, z, scale) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const trunk = cylinder(group, this.materials.trunk, 0.38 * scale, 0.62 * scale, 5.8 * scale, 9, 0, 2.9 * scale, 0);
    trunk.rotation.z = (this.random() - 0.5) * 0.14;
    const crownY = 5.5 * scale;
    const branches = [
      [-1.2, 0.3, 0.6, -0.4],
      [1.1, 0.4, 0.4, 0.5],
      [0.4, 0.7, -1.0, 0.2],
      [-0.4, 0.6, -0.9, -0.3],
    ];
    for (const [dx, dy, dz, tilt] of branches) {
      const branch = cylinder(
        group,
        this.materials.trunk,
        0.12 * scale,
        0.25 * scale,
        3.2 * scale,
        7,
        dx * scale,
        (3.5 + dy) * scale,
        dz * scale,
      );
      branch.rotation.z = tilt;
      branch.rotation.x = dz * 0.16;
    }
    const foliageGeometry = new THREE.DodecahedronGeometry(1.65 * scale, 1);
    const random = seeded(Math.round(x * 31 + z * 13));
    for (let i = 0; i < 7; i += 1) {
      const foliage = new THREE.Mesh(
        foliageGeometry,
        i % 3 === 0 ? this.materials.foliageLight : this.materials.foliage,
      );
      foliage.position.set(
        (random() - 0.5) * 5.2 * scale,
        crownY + (random() - 0.2) * 2.2 * scale,
        (random() - 0.5) * 4.3 * scale,
      );
      foliage.scale.set(1 + random() * 0.7, 0.65 + random() * 0.4, 1 + random() * 0.8);
      foliage.rotation.set(random(), random(), random());
      foliage.castShadow = true;
      group.add(foliage);
    }
    this.scene.add(group);
    this.treeData.push({ group, phase: this.random() * Math.PI * 2, scale });
  }

  createPalm(x, z, scale) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const trunk = cylinder(group, this.materials.trunk, 0.22 * scale, 0.42 * scale, 6.8 * scale, 8, 0, 3.4 * scale, 0);
    trunk.rotation.z = -0.14;
    for (let i = 0; i < 8; i += 1) {
      const frondGeometry = new THREE.PlaneGeometry(0.6 * scale, 4.2 * scale, 1, 4);
      const pos = frondGeometry.attributes.position;
      for (let v = 0; v < pos.count; v += 1) {
        const y = pos.getY(v);
        pos.setZ(v, Math.sin((y / 4.2 + 0.5) * Math.PI) * 0.75 * scale);
      }
      frondGeometry.computeVertexNormals();
      const frond = new THREE.Mesh(frondGeometry, this.materials.palm);
      frond.position.set(-0.65 * scale, 6.8 * scale, 0);
      frond.rotation.z = Math.PI * 0.22 + (i < 4 ? 0 : Math.PI * 0.52);
      frond.rotation.y = (i % 4) * Math.PI * 0.5;
      frond.castShadow = true;
      group.add(frond);
    }
    this.scene.add(group);
  }

  buildPeople() {
    const crowd = [
      ["#a84b37", 0, 0.04, 4.2], ["#d1b180", 0, 0.45, 3.6], ["#4a6c6a", 0, 0.72, 3.9],
      ["#6a4d37", 0, 0.18, 4.7], ["#c28b55", 0, 0.58, 3.8], ["#405566", 0, 0.86, 4.5],
      ["#8d4b39", 1, 0.12, 3.8], ["#bdb49c", 1, 0.32, 4.1], ["#526343", 1, 0.6, 3.6],
      ["#ac744c", 1, 0.84, 4.4], ["#7a3630", 2, 0.08, 3.7], ["#6b8278", 2, 0.38, 4.5],
      ["#9c7a58", 2, 0.66, 4.0], ["#4c4e61", 2, 0.91, 3.4],
      ["#ae5e45", 3, 0.15, 4.0], ["#bbad88", 3, 0.49, 3.5], ["#5d7a68", 3, 0.7, 4.2],
      ["#8b5348", 4, 0.25, 3.6], ["#d3b883", 4, 0.55, 4.0], ["#4e6273", 4, 0.79, 3.8],
      ["#815247", 0, 0.43, 3.3], ["#c3b595", 0, 0.47, 3.1],
      ["#4e665d", 0, 0.5, 3.4], ["#a8704d", 0, 0.53, 3.0],
      ["#687277", 0, 0.56, 3.2], ["#985f42", 0, 0.59, 3.5],
      ["#cdb999", 0, 0.62, 3.0], ["#596f64", 0, 0.65, 3.3],
    ];
    for (const [color, pathIndex, offset, speed] of crowd) {
      const person = this.createPerson(color, false);
      person.userData.pathIndex = pathIndex;
      person.userData.offset = offset;
      person.userData.speed = speed;
      person.userData.direction = offset > 0.5 ? -1 : 1;
      this.people.push(person);
      this.scene.add(person);
    }

    const oldStreetCurve = this.roadPaths.find(
      (road) => road.id === "shan-yao-old-street",
    )?.curve;
    if (oldStreetCurve) {
      const locals = [
        ["#5c4d40", 0.448, 1],
        ["#8f4638", 0.468, -1],
        ["#6e7b70", 0.493, 1],
        ["#b57956", 0.517, -1],
        ["#4e5966", 0.543, 1],
        ["#7f6249", 0.566, -1],
      ];
      for (const [color, t, side] of locals) {
        const point = oldStreetCurve.getPointAt(t);
        const tangent = oldStreetCurve.getTangentAt(t);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const person = this.createPerson(color, false);
        person.position.set(
          point.x + normal.x * (2.9 * side),
          0.13,
          point.z + normal.z * (2.9 * side),
        );
        person.rotation.y = Math.atan2(-normal.x * side, -normal.z * side);
        person.userData.isStatic = true;
        this.people.push(person);
        this.scene.add(person);
      }
    }

    for (let i = 0; i < 5; i += 1) {
      const worker = this.createPerson(["#455c51", "#b7805c", "#7c5946"][i % 3], true);
      worker.position.set(600 + (i % 3) * 32, 0.18, 930 + i * 46);
      worker.rotation.y = 1.2 + i * 0.2;
      worker.userData.isWorker = true;
      this.people.push(worker);
      this.scene.add(worker);
      const rake = cylinder(
        worker,
        this.materials.woodDark,
        0.025,
        0.025,
        3.2,
        5,
        1.1,
        1.2,
        0.2,
      );
      rake.rotation.z = -0.75;
    }

    const scooterColors = [0x374d52, 0xa84b39, 0xd6cba9, 0x5f7563, 0x8f5a38];
    for (let i = 0; i < 5; i += 1) {
      const scooter = this.createScooter(scooterColors[i], i);
      scooter.userData.pathIndex = i % 2 === 0 ? 0 : 2;
      scooter.userData.offset = i / 5 + 0.07;
      scooter.userData.speed = 5.3 + i * 0.45;
      scooter.userData.direction = i % 2 === 0 ? 1 : -1;
      this.vehicles.push(scooter);
      this.scene.add(scooter);
    }

    if (oldStreetCurve) {
      for (let index = 0; index < 4; index += 1) {
        const t = 0.452 + index * 0.035;
        const point = oldStreetCurve.getPointAt(t);
        const tangent = oldStreetCurve.getTangentAt(t);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const side = index % 2 === 0 ? 1 : -1;
        const scooter = this.createScooter(
          [0x465a58, 0x9b4c3b, 0xd2c6a8, 0x667268][index],
          index,
          false,
        );
        scooter.position.set(
          point.x + normal.x * (3.1 * side),
          0.12,
          point.z + normal.z * (3.1 * side),
        );
        scooter.rotation.y = Math.atan2(tangent.x, tangent.z) + (index % 2 ? 0.22 : -0.18);
        this.scene.add(scooter);
      }
    }

    const truck = this.createMiniTruck();
    truck.userData.pathIndex = 3;
    truck.userData.offset = 0.2;
    truck.userData.speed = 2.8;
    truck.userData.direction = 1;
    this.vehicles.push(truck);
    this.scene.add(truck);

    this.createChickens();
    this.createBoat();
  }

  createPerson(coatColor, worker = false) {
    const group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xc88f68, roughness: 0.82 });
    const coat = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.88 });
    const pants = new THREE.MeshStandardMaterial({ color: worker ? 0x4f5a50 : 0x263a3c, roughness: 0.9 });
    cylinder(group, pants, 0.14, 0.16, 0.75, 7, -0.16, 0.45, 0);
    cylinder(group, pants, 0.14, 0.16, 0.75, 7, 0.16, 0.45, 0);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.68, 4, 8), coat);
    body.position.y = 1.28;
    body.castShadow = true;
    group.add(body);
    const head = sphere(group, skin, 0.26, 0, 2.05, 0, 12, 9);
    head.castShadow = true;
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52),
      this.materials.black,
    );
    hair.position.set(0, 2.14, 0);
    group.add(hair);
    const leftArm = cylinder(group, coat, 0.075, 0.1, 0.72, 7, -0.38, 1.27, 0);
    leftArm.rotation.z = -0.15;
    const rightArm = cylinder(group, coat, 0.075, 0.1, 0.72, 7, 0.38, 1.27, 0);
    rightArm.rotation.z = 0.15;
    group.userData.leftArm = leftArm;
    group.userData.rightArm = rightArm;
    group.userData.legs = [group.children[0], group.children[1]];
    group.scale.setScalar(0.94 + this.random() * 0.15);
    if (worker) {
      const hat = new THREE.Mesh(
        new THREE.ConeGeometry(0.52, 0.3, 18),
        new THREE.MeshStandardMaterial({ color: 0xc6ad76, roughness: 0.9, side: THREE.DoubleSide }),
      );
      hat.position.y = 2.35;
      group.add(hat);
    }
    const umbrella = new THREE.Group();
    const canvas = new THREE.Mesh(
      new THREE.ConeGeometry(0.92, 0.4, 16, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xa84a34,
        roughness: 0.86,
        side: THREE.DoubleSide,
      }),
    );
    canvas.position.y = 2.55;
    umbrella.add(canvas);
    cylinder(umbrella, this.materials.woodDark, 0.018, 0.018, 1.8, 5, 0, 1.8, 0);
    umbrella.visible = false;
    group.add(umbrella);
    group.userData.umbrella = umbrella;
    return group;
  }

  createScooter(color, seed, withRider = true) {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.16 });
    meshBox(group, bodyMaterial, 0.52, 0.22, 1.6, 0, 0.52, 0);
    meshBox(group, bodyMaterial, 0.58, 0.72, 0.5, 0, 0.87, -0.65);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1c201e, roughness: 0.8 });
    for (const z of [-0.72, 0.66]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.08, 7, 14), wheelMaterial);
      wheel.position.set(0, 0.3, z);
      wheel.rotation.y = Math.PI / 2;
      group.add(wheel);
    }
    if (withRider) {
      const rider = this.createPerson(["#6b5540", "#a74335", "#536b65"][seed % 3]);
      rider.scale.setScalar(0.72);
      rider.position.set(0, 0.44, -0.05);
      group.add(rider);
      rider.userData.umbrella.visible = false;
      // Hands replace the free-hanging arms for a readable riding silhouette.
      rider.userData.leftArm.rotation.x = -0.9;
      rider.userData.rightArm.rotation.x = -0.9;
    }
    return group;
  }

  createMiniTruck() {
    const group = new THREE.Group();
    const blue = new THREE.MeshStandardMaterial({ color: 0x557d79, roughness: 0.62, metalness: 0.15 });
    meshBox(group, blue, 1.35, 0.68, 2.6, 0, 0.76, 0);
    meshBox(group, blue, 1.3, 0.86, 0.9, 0, 1.16, -0.98);
    meshBox(group, this.materials.woodWarm, 1.2, 0.14, 1.25, 0, 1.18, 0.68);
    meshPlane(group, this.materials.window, 1.02, 0.48, 0, 1.37, -1.45, 0, Math.PI);
    for (const x of [-0.63, 0.63]) {
      for (const z of [-0.84, 0.84]) {
        const wheel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.3, 0.16, 12),
          new THREE.MeshStandardMaterial({ color: 0x171a18, roughness: 0.9 }),
        );
        wheel.position.set(x, 0.33, z);
        wheel.rotation.z = Math.PI / 2;
        group.add(wheel);
      }
    }
    return group;
  }

  createChickens() {
    const random = seeded(515);
    for (let i = 0; i < 7; i += 1) {
      const chicken = new THREE.Group();
      const body = sphere(
        chicken,
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0xc79a58 : 0xd3c5a7, roughness: 0.9 }),
        0.22,
        0,
        0.28,
        0,
        8,
        6,
      );
      body.scale.z = 1.4;
      sphere(chicken, new THREE.MeshStandardMaterial({ color: 0xb54535, roughness: 0.75 }), 0.09, 0, 0.51, 0.22, 8, 6);
      chicken.position.set(-124 + random() * 32, 0, 40 + random() * 20);
      chicken.rotation.y = random() * Math.PI * 2;
      chicken.userData.phase = random() * 10;
      this.scene.add(chicken);
    }
  }

  createBoat() {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 20, 10, 0, Math.PI * 2, Math.PI * 0.48, Math.PI * 0.34),
      new THREE.MeshStandardMaterial({ color: 0x6d472d, roughness: 0.7, side: THREE.DoubleSide }),
    );
    hull.scale.set(0.7, 0.4, 2.1);
    hull.position.y = -0.3;
    boat.add(hull);
    meshBox(boat, this.materials.woodDark, 0.16, 3.6, 0.16, 0, 1.4, 0);
    const sail = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.6, 5, 5),
      new THREE.MeshStandardMaterial({
        color: 0xd4c19a,
        roughness: 0.9,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.82,
      }),
    );
    sail.position.set(1.45, 2.4, 0);
    sail.rotation.y = Math.PI / 2;
    boat.add(sail);
    boat.position.set(470, 0.3, 154);
    boat.rotation.y = 0.5;
    this.boat = boat;
    this.scene.add(boat);
  }

  buildBirds() {
    const material = new THREE.MeshBasicMaterial({ color: 0x2d3734, side: THREE.DoubleSide });
    const random = seeded(1902);
    for (let i = 0; i < 14; i += 1) {
      const bird = new THREE.Group();
      const left = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.22), material);
      left.position.x = -0.55;
      left.rotation.z = -0.12;
      bird.add(left);
      const right = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.22), material);
      right.position.x = 0.55;
      right.rotation.z = 0.12;
      bird.add(right);
      bird.userData = {
        left,
        right,
        radius: 45 + random() * 90,
        height: 28 + random() * 38,
        offset: random() * Math.PI * 2,
        speed: 0.16 + random() * 0.15,
        centerX: -40 + random() * 160,
        centerZ: -60 + random() * 120,
      };
      this.birds.push(bird);
      this.scene.add(bird);
    }
  }

  buildSmoke() {
    this.createSmokeEmitter(153, 2.4, 67, 0.3, 18, 0xded8c7);
    this.createSmokeEmitter(-39, 1.7, 59, 0.15, 14, 0xe0cda8);
    this.createSmokeEmitter(-13, 1.2, 30, 0.12, 10, 0xd5c9ad);
  }

  createSmokeEmitter(x, y, z, radius, count, color) {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const random = seeded(Math.round(x * 11 + z * 19));
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (random() - 0.5) * radius;
      positions[i * 3 + 1] = random() * 9;
      positions[i * 3 + 2] = (random() - 0.5) * radius;
      speeds[i] = 0.25 + random() * 0.55;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      map: this.mistTexture,
      color,
      size: 2.2,
      transparent: true,
      opacity: 0.23,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.position.set(x, y, z);
    points.userData.speeds = speeds;
    this.scene.add(points);
    this.smokeEmitters.push(points);
  }

  buildLabels() {
    for (const district of DISTRICTS) {
      const element = document.createElement("div");
      element.className = "world-label";
      element.textContent = district.name;
      element.style.setProperty("--label-accent", district.accent);
      const label = new CSS2DObject(element);
      label.position.set(district.x, 18, district.z);
      label.userData = {
        baseY: 18,
        phase: this.random() * Math.PI,
        worldPosition: new THREE.Vector3(district.x, 18, district.z),
      };
      this.scene.add(label);
      this.labels.push(label);
    }

    for (const poi of POIS) {
      const marker = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.7, 0.06, 8, 40),
        new THREE.MeshBasicMaterial({
          color: 0xe6c47f,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.2;
      marker.add(ring);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.09, 7, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xf5cf82,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      beam.position.y = 3.5;
      marker.add(beam);
      marker.position.set(poi.position[0], 0.3, poi.position[2]);
      marker.userData.phase = this.random() * Math.PI * 2;
      this.scene.add(marker);
      this.poiMarkers.push(marker);

      const hitbox = meshBox(
        this.scene,
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
          color: 0xffffff,
        }),
        poi.id === "saltpan" ? 430 : 34,
        poi.id === "saltpan" ? 4 : 18,
        poi.id === "saltpan" ? 590 : 32,
        poi.position[0],
        poi.id === "saltpan" ? 2 : 7,
        poi.position[2],
        false,
        false,
      );
      this.tagPoi(hitbox, poi.id);
    }
  }

  buildWeather() {
    const count = 1800;
    const positions = new Float32Array(count * 6);
    const random = seeded(101);
    this.rainSpeeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const x = (random() - 0.5) * 300;
      const y = random() * 90;
      const z = (random() - 0.5) * 300;
      const length = 1.1 + random() * 1.3;
      positions[i * 6] = x;
      positions[i * 6 + 1] = y;
      positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x + 0.15;
      positions[i * 6 + 4] = y - length;
      positions[i * 6 + 5] = z + 0.25;
      this.rainSpeeds[i] = 25 + random() * 28;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xb9d3db,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(geometry, material);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);

    const puddleGeometry = new THREE.CircleGeometry(1, 24);
    const random2 = seeded(14);
    for (let i = 0; i < 28; i += 1) {
      const puddle = new THREE.Mesh(puddleGeometry, this.materials.puddle);
      puddle.rotation.x = -Math.PI / 2;
      puddle.scale.set(1.5 + random2() * 3.4, 0.6 + random2() * 1.7, 1);
      puddle.position.set(-180 + random2() * 390, 0.17, -160 + random2() * 280);
      puddle.renderOrder = 2;
      this.puddles.push(puddle);
      this.scene.add(puddle);
    }
  }

  addCollider(x, z, width, depth, rotation, exact = false) {
    const halfW = width / 2;
    const halfD = depth / 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const corners = [
      [-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD],
    ].map(([px, pz]) => ({
      x: x + px * cos + pz * sin,
      z: z - px * sin + pz * cos,
    }));
    const xs = corners.map((point) => point.x);
    const zs = corners.map((point) => point.z);
    this.colliders.push({
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
      exact,
    });
  }

  tagPoi(root, poiId) {
    root.userData.poiId = poiId;
    root.traverse((child) => {
      child.userData.poiId = poiId;
    });
    this.interactiveRoots.push(root);
  }

  setTimeOfDay(hour, force = false) {
    if (!force && Math.abs(this.timeOfDay - hour) < 0.001) return;
    this.timeOfDay = hour;
    const daylight = clamp(Math.sin(((hour - 5.6) / 14.2) * Math.PI), 0, 1);
    const bell = smoothstep(daylight, 0.05, 0.95);
    const night = 1 - smoothstep(daylight, 0.15, 0.54);
    const golden = Math.max(0, 1 - Math.abs(hour - 17.85) / 2.2);

    const altitude = Math.sin(((hour - 5.65) / 14.25) * Math.PI) * 68 - (hour < 5.65 || hour > 19.9 ? 12 : 0);
    const azimuth = ((hour - 5.65) / 14.25) * 180;
    const phi = THREE.MathUtils.degToRad(90 - altitude);
    const theta = THREE.MathUtils.degToRad(180 - azimuth);
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(sunPosition);
    this.sky.material.uniforms.turbidity.value = 6.5 + golden * 2.6;
    this.sky.material.uniforms.rayleigh.value = 1.25 + golden * 1.1;

    this.sunLight.position.copy(sunPosition).multiplyScalar(260);
    this.sunLight.intensity = Math.max(0, Math.sin(((hour - 5.6) / 14.4) * Math.PI)) * 3.6;
    this.sunLight.color.setHSL(0.09 + golden * 0.03, 0.5 + golden * 0.24, 0.76 - golden * 0.08);
    this.hemisphereLight.intensity = 0.44 + daylight * 1.05;
    this.hemisphereLight.color.set(daylight > 0.3 ? 0xb8d2d2 : 0x7e9dbc);
    this.hemisphereLight.groundColor.set(daylight > 0.3 ? 0x584735 : 0x19211e);
    this.ambientLight.intensity = 0.05 + night * 0.17;
    this.ambientLight.color.set(daylight > 0.3 ? 0x9bb1ae : 0x7995ae);
    this.moonLight.intensity = night * 0.82;

    const fogColor = new THREE.Color();
    if (night > 0.65) fogColor.set(0x142321);
    else if (golden > 0.35) fogColor.set(0x796d59);
    else fogColor.set(0x8e9d8e);
    this.scene.fog.color.copy(fogColor);
    this.scene.fog.density = this.weather === "rain" ? 0.001 : 0.00036 + night * 0.00008;
    this.stars.material.opacity = Math.pow(night, 1.5) * 0.86;
    if (this.satelliteMaterials) {
      const aerialShade = 0.18 + daylight * 0.82;
      const aerialColor = new THREE.Color(
        aerialShade * (1 + golden * 0.08),
        aerialShade,
        aerialShade * (1 - golden * 0.08),
      );
      this.satelliteMaterials.forEach((material) => {
        material.color.copy(aerialColor);
      });
    }

    this.lampLights.forEach(({ light, glow }) => {
      if (light) light.intensity = night * 9.2;
      if (glow) glow.material.opacity = 0.08 + night * 0.62;
    });
    this.windowMaterials.forEach((material) => {
      material.emissiveIntensity = 0.01 + night * 0.5;
    });
    this.lanternMaterials.forEach((material) => {
      material.emissiveIntensity = 0.15 + night * 2.25;
    });
    this.birds.forEach((bird) => {
      bird.visible = daylight > 0.15;
    });
    this.renderer.toneMappingExposure = 0.86 + daylight * 0.17 + night * 0.08;
    this.nightAmount = night;
    this.daylightAmount = daylight;

    if (this.saltPanMaterial) {
      this.saltPanMaterial.opacity = daylight > 0.2 ? 0.82 : 0.58;
    }
    return { daylight, night, golden };
  }

  setRain(active, force = false) {
    if (!force && this.weather === (active ? "rain" : "clear")) return;
    this.weather = active ? "rain" : "clear";
    this.rain.visible = active;
    this.puddles.forEach((puddle) => {
      puddle.material.opacity = active ? 0.5 : 0;
    });
    this.roadMaterials.forEach((material) => {
      material.roughness = active ? 0.32 : 0.9;
      material.map.offset.y = active ? 0.01 : 0;
    });
    this.scene.fog.density = active ? 0.001 : 0.00036 + (this.nightAmount ?? 0) * 0.00008;
    this.people.forEach((person) => {
      if (person.userData.umbrella) person.userData.umbrella.visible = active;
    });
  }

  update(dt, elapsed, camera) {
    if (this.waterNormal) {
      this.waterNormal.offset.x = elapsed * 0.0018;
      this.waterNormal.offset.y = elapsed * 0.0012;
    }
    if (this.oceanMaterial) {
      this.oceanMaterial.color.setHSL(0.52, 0.24, 0.27 + (this.daylightAmount ?? 0.5) * 0.12);
    }
    if (this.boat) {
      this.boat.position.y = 0.35 + Math.sin(elapsed * 0.55) * 0.16;
      this.boat.rotation.z = Math.sin(elapsed * 0.45) * 0.035;
    }

    for (const person of this.people) {
      const { pathIndex, offset, speed, direction, isWorker } = person.userData;
      if (isWorker) continue;
      const path = this.roadPaths[pathIndex]?.curve;
      if (!path) continue;
      const t = (offset + elapsed * speed * 0.0025 * direction + 1) % 1;
      const point = path.getPointAt(t);
      const tangent = path.getTangentAt(t);
      person.position.set(point.x, 0.13, point.z);
      person.rotation.y = Math.atan2(tangent.x, tangent.z) + (direction < 0 ? Math.PI : 0);
      const walk = elapsed * 6.5 + offset * 20;
      person.userData.leftArm.rotation.x = Math.sin(walk) * 0.42;
      person.userData.rightArm.rotation.x = -Math.sin(walk) * 0.42;
      person.userData.legs[0].rotation.x = Math.sin(walk) * 0.38;
      person.userData.legs[1].rotation.x = -Math.sin(walk) * 0.38;
    }

    for (const vehicle of this.vehicles) {
      const { pathIndex, offset, speed, direction } = vehicle.userData;
      const path = this.roadPaths[pathIndex]?.curve;
      if (!path) continue;
      const t = (offset + elapsed * speed * 0.0015 * direction + 1) % 1;
      const point = path.getPointAt(t);
      const tangent = path.getTangentAt(t);
      vehicle.position.set(point.x, 0.16, point.z);
      vehicle.rotation.y = Math.atan2(tangent.x, tangent.z) + (direction < 0 ? Math.PI : 0);
    }

    for (const bird of this.birds) {
      const data = bird.userData;
      const angle = elapsed * data.speed + data.offset;
      bird.position.set(
        data.centerX + Math.cos(angle) * data.radius,
        data.height + Math.sin(angle * 1.7) * 3,
        data.centerZ + Math.sin(angle) * data.radius * 0.65,
      );
      bird.rotation.y = -angle + Math.PI / 2;
      const flap = Math.sin(elapsed * 5 + data.offset * 20) * 0.35;
      data.left.rotation.z = -0.12 + flap;
      data.right.rotation.z = 0.12 - flap;
    }

    for (const cloth of this.cloths) {
      const phase = elapsed * 1.8 + cloth.userData.phase;
      cloth.rotation.y =
        cloth.userData.baseRotationY + Math.sin(phase) * 0.11;
      cloth.rotation.x = Math.sin(phase * 0.63) * 0.035;
    }

    for (const smoke of this.smokeEmitters) {
      const position = smoke.geometry.attributes.position;
      const speeds = smoke.userData.speeds;
      for (let i = 0; i < position.count; i += 1) {
        let y = position.getY(i) + speeds[i] * dt;
        let x = position.getX(i) + Math.sin(elapsed * 0.6 + i) * dt * 0.08;
        if (y > 9) {
          y = 0;
          x = (this.random() - 0.5) * 0.28;
        }
        position.setY(i, y);
        position.setX(i, x);
      }
      position.needsUpdate = true;
    }

    for (const marker of this.poiMarkers) {
      const phase = elapsed * 1.4 + marker.userData.phase;
      marker.rotation.y = phase * 0.2;
      marker.children[0].material.opacity = 0.45 + Math.sin(phase) * 0.2;
    }

    if (this.rain.visible) {
      const position = this.rain.geometry.attributes.position;
      const array = position.array;
      for (let i = 0; i < this.rainSpeeds.length; i += 1) {
        const speed = this.rainSpeeds[i];
        array[i * 6 + 1] -= speed * dt;
        array[i * 6 + 4] -= speed * dt;
        if (array[i * 6 + 1] < 0) {
          const y = 65 + this.random() * 40;
          array[i * 6 + 1] = y;
          array[i * 6 + 4] = y - 1.2 - this.random() * 1.4;
        }
      }
      this.rain.position.x = camera.position.x;
      this.rain.position.z = camera.position.z;
      position.needsUpdate = true;
    }

    for (const label of this.labels) {
      label.position.y = label.userData.baseY + Math.sin(elapsed * 0.65 + label.userData.phase) * 0.45;
      const distance = camera.position.distanceTo(label.userData.worldPosition);
      label.element.style.opacity = distance > 420 ? "0" : String(clamp((420 - distance) / 90, 0.18, 0.92));
    }
  }

  pick(raycaster, camera) {
    const intersections = raycaster.intersectObjects(this.interactiveRoots, true);
    if (!intersections.length) return null;
    return intersections[0].object.userData.poiId ?? null;
  }

  isPositionBlocked(x, z, radius = 0.45) {
    if (x < -1500 || x > 1550 || z < -1780 || z > 1520) return true;
    for (const collider of this.colliders) {
      if (collider.polygon) {
        if (pointBlockedByBuilding(x, z, radius, collider)) return true;
        continue;
      }
      if (
        x + radius > collider.minX &&
        x - radius < collider.maxX &&
        z + radius > collider.minZ &&
        z - radius < collider.maxZ
      ) {
        return true;
      }
    }
    return false;
  }

  getMinimapData() {
    return {
      roads: this.roadPaths.map((road) => ({
        id: road.id,
        name: road.name,
        points: road.points.map((point) => [point.x, point.z]),
        width: road.width,
      })),
      pois: POIS,
      districts: DISTRICTS,
      buildings: this.buildingCenters || [],
      location: VILLAGE_CENTER,
      yuncheng: YUNCHENG_CENTER,
    };
  }

  dispose() {
    this.scene.traverse((object) => {
      if (object.geometry && object.geometry !== UNIT_BOX && object.geometry !== UNIT_PLANE) {
        object.geometry.dispose();
      }
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }
}

function makeLantern(parent, materials, scale = 1) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.42 * scale, 12, 9),
    materials.lantern,
  );
  body.scale.y = 1.28;
  group.add(body);
  for (const side of [-1, 1]) {
    const cap = cylinder(
      group,
      materials.goldPaint,
      0.19 * scale,
      0.19 * scale,
      0.09 * scale,
      10,
      0,
      side * 0.52 * scale,
      0,
    );
    cap.castShadow = false;
  }
  cylinder(group, materials.woodDark, 0.012, 0.012, 0.48 * scale, 5, 0, 0.79 * scale, 0);
  parent.add(group);
  return group;
}

export { POIS, DISTRICTS };
