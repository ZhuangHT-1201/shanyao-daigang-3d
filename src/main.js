import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { TownWorld } from "./world.js";
import { CAMERA_PRESETS, POIS } from "./config.js";
import "./style.css";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = THREE.MathUtils.clamp;
const easeInOut = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const app = $("#app");
const sceneRoot = $("#scene");
const loadingScreen = $("#loadingScreen");
const loadingBar = $("#loadingBar");
const loadingStatus = $("#loadingStatus");
const enterTownButton = $("#enterTownButton");
const clockElement = $("#clock");
const dayPhaseElement = $("#dayPhase");
const timeRange = $("#timeRange");
const autoTimeButton = $("#autoTimeButton");
const rainButton = $("#rainButton");
const soundButton = $("#soundButton");
const helpButton = $("#helpButton");
const helpModal = $("#helpModal");
const storyModal = $("#storyModal");
const storyButton = $("#storyButton");
const walkHint = $("#walkHint");
const walkLockPrompt = $("#walkLockPrompt");
const poiToast = $("#poiToast");
const poiToastKicker = $("#poiToastKicker");
const poiToastTitle = $("#poiToastTitle");
const poiToastText = $("#poiToastText");
const poiToastMeta = $("#poiToastMeta");
const poiListElement = $("#poiList");
const buildingCountLabel = $("#buildingCountLabel");
const minimapCanvas = $("#minimap");
const minimapContext = minimapCanvas.getContext("2d");
const minimapSatellite = new Image();
minimapSatellite.src = "/data/satellite_basemap.jpg";
const MAP_SATELLITE_BOUNDS = {
  minX: -2034.9597,
  maxX: 2117.492,
  minZ: -2157.5105,
  maxZ: 1967.0849,
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 3200);
camera.position.set(520, 440, 460);
camera.lookAt(-20, 3, -300);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute("aria-label", "拖动漫游埭港三维场景");
sceneRoot.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = "label-layer";
sceneRoot.appendChild(labelRenderer.domElement);

const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  0.35,
  0.58,
  0.93,
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.065;
orbit.minDistance = 8;
orbit.maxDistance = 1500;
orbit.minPolarAngle = 0.17;
orbit.maxPolarAngle = Math.PI * 0.48;
orbit.zoomSpeed = 0.75;
orbit.panSpeed = 0.55;
orbit.screenSpacePanning = false;
orbit.target.set(-26, 3, -330);

const walkControls = new PointerLockControls(camera, renderer.domElement);
walkControls.pointerSpeed = 0.72;

const state = {
  mode: "orbit",
  activePoi: null,
  autoTime: true,
  timeOfDay: 17.7,
  rain: false,
  ready: false,
  entered: false,
  modal: null,
  lastFocus: null,
  lastUiUpdate: 0,
  lastNearbyCheck: 0,
  directRenderer: false,
  frameWatchStarted: 0,
  frameWatchCount: 0,
  qualityChecked: false,
  lastMinimapUpdate: 0,
};

const keys = new Set();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
let world;
let cameraFlight = null;
let tourControls = null;
let pointerStart = null;
let walkVelocity = new THREE.Vector3();
let walkBob = 0;
let loadedAt = 0;

class Soundscape {
  constructor() {
    this.active = false;
    this.context = null;
    this.master = null;
    this.oceanGain = null;
    this.rainGain = null;
    this.nightAmount = 0.2;
    this.weather = "clear";
    this.nextBird = 0;
    this.elapsed = 0;
  }

  init() {
    if (this.context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);

    const oceanBuffer = this.createNoiseBuffer(5);
    const ocean = this.context.createBufferSource();
    ocean.buffer = oceanBuffer;
    ocean.loop = true;
    const oceanFilter = this.context.createBiquadFilter();
    oceanFilter.type = "lowpass";
    oceanFilter.frequency.value = 420;
    oceanFilter.Q.value = 0.4;
    this.oceanGain = this.context.createGain();
    this.oceanGain.gain.value = 0.36;
    ocean.connect(oceanFilter).connect(this.oceanGain).connect(this.master);
    ocean.start();

    const rainBuffer = this.createNoiseBuffer(4);
    const rain = this.context.createBufferSource();
    rain.buffer = rainBuffer;
    rain.loop = true;
    const rainFilter = this.context.createBiquadFilter();
    rainFilter.type = "highpass";
    rainFilter.frequency.value = 1200;
    this.rainGain = this.context.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rainFilter).connect(this.rainGain).connect(this.master);
    rain.start();
  }

  createNoiseBuffer(seconds) {
    const length = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.018 * white) / 1.018;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  async toggle() {
    this.init();
    if (!this.context) return false;
    if (this.context.state === "suspended") await this.context.resume();
    this.active = !this.active;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.active ? 0.15 : 0, now + 0.7);
    return this.active;
  }

  setWeather(rain) {
    this.weather = rain ? "rain" : "clear";
    if (!this.context) return;
    const now = this.context.currentTime;
    this.rainGain.gain.cancelScheduledValues(now);
    this.rainGain.gain.setTargetAtTime(rain ? 0.36 : 0, now, 0.9);
    this.oceanGain.gain.setTargetAtTime(rain ? 0.58 : 0.36, now, 0.9);
  }

  setNight(night) {
    this.nightAmount = night;
  }

  update(dt) {
    if (!this.active || !this.context) return;
    this.elapsed += dt;
    if (this.elapsed < this.nextBird) return;
    this.nextBird = this.elapsed + (this.nightAmount > 0.55 ? 7 + Math.random() * 9 : 5 + Math.random() * 9);
    if (this.nightAmount > 0.55) this.playCricket();
    else this.playBird();
  }

  playBird() {
    const now = this.context.currentTime;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i += 1) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const start = now + i * 0.115;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(1550 + Math.random() * 480, start);
      oscillator.frequency.exponentialRampToValueAtTime(2600 + Math.random() * 420, start + 0.06);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.025, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.11);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + 0.12);
    }
  }

  playCricket() {
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(3400, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.013, now + 0.015);
    gain.gain.linearRampToValueAtTime(0, now + 0.08);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.1);
  }
}

const soundscape = new Soundscape();

function buildPoiList() {
  poiListElement.innerHTML = POIS.map(
    (poi) => `
      <button class="poi-item" type="button" data-poi="${poi.id}" aria-label="前往${poi.title}">
        <span class="poi-index">${poi.index}</span>
        <span class="poi-item-main">
          <span class="poi-name">${poi.shortTitle}</span>
          <span class="poi-subtitle">${poi.kicker}</span>
        </span>
        <span class="poi-arrow" aria-hidden="true">›</span>
      </button>
    `,
  ).join("");
  poiListElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-poi]");
    if (!button) return;
    const poi = POIS.find((item) => item.id === button.dataset.poi);
    if (poi) selectPoi(poi);
  });
}

function formatClock(hour) {
  const normalized = ((hour % 24) + 24) % 24;
  const hours = Math.floor(normalized);
  const minutes = Math.round((normalized - hours) * 60) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function phaseName(hour) {
  if (hour < 6.2) return "盐田微光";
  if (hour < 10.5) return "海风初醒";
  if (hour < 16.2) return "天光正盛";
  if (hour < 19.5) return "落日余晖";
  if (hour < 21.5) return "灯火人家";
  return "海街入夜";
}

function setTime(hour, manual = false) {
  state.timeOfDay = ((hour - 5 + 24) % 24) + 5;
  if (state.timeOfDay > 23) state.timeOfDay -= 18;
  const phase = world?.setTimeOfDay(state.timeOfDay);
  clockElement.textContent = formatClock(state.timeOfDay);
  dayPhaseElement.textContent = phaseName(state.timeOfDay);
  timeRange.value = String(state.timeOfDay);
  if (phase) soundscape.setNight(phase.night);
  if (manual) {
    state.autoTime = false;
    autoTimeButton.setAttribute("aria-pressed", "false");
  }
}

function toggleAutoTime() {
  state.autoTime = !state.autoTime;
  autoTimeButton.setAttribute("aria-pressed", String(state.autoTime));
}

function toggleRain() {
  state.rain = !state.rain;
  world?.setRain(state.rain);
  rainButton.setAttribute("aria-pressed", String(state.rain));
  rainButton.querySelector("span:last-child").textContent = state.rain ? "细雨海风" : "海风晴朗";
  soundscape.setWeather(state.rain);
}

function setMode(mode, options = {}) {
  if (!world) return;
  if (state.modal) hideModal(state.modal);
  cameraFlight = null;
  tourControls = null;
  if (walkControls.isLocked) walkControls.unlock();
  orbit.enabled = false;
  walkHint.hidden = true;
  walkLockPrompt.hidden = true;
  app.classList.toggle("is-walking", mode === "walk");

  if (mode === "walk") {
    if (camera.position.y > 8 || Math.hypot(camera.position.x, camera.position.z) > 280) {
      const oldStreet = POIS[0];
      camera.position.set(oldStreet.position[0], 1.72, oldStreet.position[2] + 24);
      camera.lookAt(oldStreet.position[0] - 12, 1.7, oldStreet.position[2]);
    } else {
      camera.position.y = 1.72;
    }
    walkHint.hidden = false;
    walkLockPrompt.hidden = false;
  } else if (mode === "tour") {
    startTour();
  } else {
    if (camera.position.y < 7) {
      animateCameraTo(
        [...CAMERA_PRESETS.overview.position],
        CAMERA_PRESETS.overview.target,
        1.8,
        "orbit",
      );
    } else {
      orbit.target.copy(options.target ?? new THREE.Vector3(-8, 4, 12));
      orbit.enabled = true;
    }
  }

  state.mode = mode;
  $$(".view-button[data-view]").forEach((button) => {
    const active = button.dataset.view === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function startTour() {
  const positionCurve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(640, 430, 480),
      new THREE.Vector3(310, 160, 70),
      new THREE.Vector3(160, 70, -470),
      new THREE.Vector3(180, 45, -760),
      new THREE.Vector3(-150, 65, -430),
      new THREE.Vector3(-300, 95, 170),
      new THREE.Vector3(100, 180, 440),
    ],
    true,
    "centripetal",
    0.5,
  );
  const targetCurve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(70, 3, -260),
      new THREE.Vector3(30, 3, -510),
      new THREE.Vector3(80, 3, -740),
      new THREE.Vector3(70, 3, -800),
      new THREE.Vector3(-180, 3, -360),
      new THREE.Vector3(-160, 3, 200),
      new THREE.Vector3(-40, 3, 420),
    ],
    true,
    "centripetal",
    0.5,
  );
  tourControls = { positionCurve, targetCurve, startedAt: performance.now() / 1000 };
  camera.up.set(0, 1, 0);
}

function animateCameraTo(position, target, duration = 1.8, finishMode = "orbit") {
  tourControls = null;
  orbit.enabled = false;
  cameraFlight = {
    startedAt: performance.now() / 1000,
    duration,
    startPosition: camera.position.clone(),
    endPosition: new THREE.Vector3(...position),
    startTarget: orbit.target.clone(),
    endTarget: new THREE.Vector3(...target),
    finishMode,
  };
}

function showPoi(poi) {
  state.activePoi = poi.id;
  poiToastKicker.textContent = poi.kicker;
  poiToastTitle.textContent = poi.title;
  poiToastText.textContent = poi.description;
  poiToastMeta.textContent = poi.meta;
  poiToast.hidden = false;
  $$(".poi-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.poi === poi.id);
  });
}

function selectPoi(poi, options = {}) {
  if (!world) return;
  showPoi(poi);
  if (options.walk) {
    setWalkAtPoi(poi);
    return;
  }
  state.mode = "orbit";
  state.autoTime = true;
  autoTimeButton.setAttribute("aria-pressed", "true");
  orbit.enabled = false;
  if (walkControls.isLocked) walkControls.unlock();
  app.classList.remove("is-walking");
  walkHint.hidden = true;
  walkLockPrompt.hidden = true;
  $$(".view-button[data-view]").forEach((button) => {
    const active = button.dataset.view === "orbit";
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  animateCameraTo(poi.camera, poi.target, options.fast ? 1.1 : 2.2, "orbit");
}

function setWalkAtPoi(poi) {
  const [targetX, targetY, targetZ] = poi.target;
  const [cameraX, , cameraZ] = poi.camera;
  const dx = cameraX - targetX;
  const dz = cameraZ - targetZ;
  const length = Math.hypot(dx, dz) || 1;
  let x = targetX + (dx / length) * Math.min(28, poi.focusRadius * 0.8);
  let z = targetZ + (dz / length) * Math.min(28, poi.focusRadius * 0.8);
  if (world.isPositionBlocked(x, z, 0.7)) {
    x = targetX;
    z = targetZ + Math.min(28, poi.focusRadius * 0.8);
  }
  state.mode = "walk";
  state.activePoi = poi.id;
  cameraFlight = null;
  tourControls = null;
  orbit.enabled = false;
  camera.position.set(x, 1.72, z);
  camera.lookAt(targetX, Math.max(1.7, targetY - 0.3), targetZ);
  walkHint.hidden = false;
  walkLockPrompt.hidden = false;
  app.classList.add("is-walking");
  $$(".view-button[data-view]").forEach((button) => {
    const active = button.dataset.view === "walk";
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  showPoi(poi);
}

function goOverview() {
  state.activePoi = null;
  poiToast.hidden = true;
  $$(".poi-item").forEach((button) => button.classList.remove("is-active"));
  state.mode = "orbit";
  orbit.enabled = false;
  if (walkControls.isLocked) walkControls.unlock();
  walkHint.hidden = true;
  walkLockPrompt.hidden = true;
  app.classList.remove("is-walking");
  $$(".view-button[data-view]").forEach((button) => {
    const active = button.dataset.view === "orbit";
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  animateCameraTo(
    CAMERA_PRESETS.overview.position,
    CAMERA_PRESETS.overview.target,
    1.8,
    "orbit",
  );
}

function enterTown() {
  if (!state.ready || state.entered) return;
  state.entered = true;
  app.dataset.started = "true";
  loadedAt = performance.now();
  setTime(17.7, false);
  loadingScreen.classList.add("is-hidden");
  loadingScreen.setAttribute("aria-hidden", "true");
}

function showModal(name) {
  const modal = name === "help" ? helpModal : storyModal;
  if (!modal) return;
  state.lastFocus = document.activeElement;
  modal.hidden = false;
  state.modal = name;
  const close = modal.querySelector(".modal-close");
  requestAnimationFrame(() => close?.focus());
}

function hideModal(name = state.modal) {
  if (!name) return;
  const modal = name === "help" ? helpModal : storyModal;
  if (modal) modal.hidden = true;
  state.modal = null;
  if (state.lastFocus instanceof HTMLElement) state.lastFocus.focus();
}

function updateWalk(dt) {
  if (state.mode !== "walk" || state.modal) return;
  const forwardInput = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) -
    (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const sideInput = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
    (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const moving = forwardInput !== 0 || sideInput !== 0;
  const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 12.5 : 5.4;

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const desired = new THREE.Vector3()
    .addScaledVector(forward, forwardInput)
    .addScaledVector(right, sideInput);
  if (desired.lengthSq() > 1) desired.normalize();
  desired.multiplyScalar(speed);
  walkVelocity.lerp(desired, 1 - Math.pow(0.0008, dt));

  if (!moving) walkVelocity.multiplyScalar(Math.pow(0.0001, dt));
  const oldX = camera.position.x;
  const oldZ = camera.position.z;
  const nextX = oldX + walkVelocity.x * dt;
  const nextZ = oldZ + walkVelocity.z * dt;

  if (!world.isPositionBlocked(nextX, oldZ, 0.52)) camera.position.x = nextX;
  else walkVelocity.x *= -0.08;
  if (!world.isPositionBlocked(camera.position.x, nextZ, 0.52)) camera.position.z = nextZ;
  else walkVelocity.z *= -0.08;

  walkBob += moving ? dt * speed * 1.25 : dt;
  const bob = moving ? Math.sin(walkBob) * (speed > 7 ? 0.055 : 0.028) : 0;
  camera.position.y = 1.72 + bob;
  if (!walkControls.isLocked && state.mode === "walk") {
    walkLockPrompt.hidden = false;
  }
}

function updateCameraAnimations(now) {
  if (cameraFlight) {
    const elapsed = (now - cameraFlight.startedAt) / cameraFlight.duration;
    const t = clamp(elapsed, 0, 1);
    const eased = easeInOut(t);
    camera.position.lerpVectors(cameraFlight.startPosition, cameraFlight.endPosition, eased);
    orbit.target.lerpVectors(cameraFlight.startTarget, cameraFlight.endTarget, eased);
    camera.lookAt(orbit.target);
    if (t >= 1) {
      const finishMode = cameraFlight.finishMode;
      cameraFlight = null;
      state.mode = finishMode;
      if (finishMode === "orbit") orbit.enabled = true;
    }
  } else if (tourControls) {
    const t = ((now - tourControls.startedAt) / 64) % 1;
    const position = tourControls.positionCurve.getPointAt(t);
    const target = tourControls.targetCurve.getPointAt(t);
    camera.position.copy(position);
    camera.lookAt(target);
    orbit.target.copy(target);
  } else if (state.mode === "orbit") {
    orbit.update();
  }
}

function onPointerDown(event) {
  pointerStart = { x: event.clientX, y: event.clientY };
  if (state.mode === "walk" && !walkControls.isLocked) {
    walkControls.lock();
  }
}

function onPointerUp(event) {
  if (!pointerStart || state.mode === "walk" || state.modal) {
    pointerStart = null;
    return;
  }
  const dragDistance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  pointerStart = null;
  if (dragDistance > 7 || !world) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const poiId = world.pick(raycaster, camera);
  const poi = POIS.find((item) => item.id === poiId);
  if (poi) selectPoi(poi);
}

function onKeyDown(event) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.code === "Escape") {
    if (state.modal) hideModal(state.modal);
    return;
  }
  if (state.modal) return;
  if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(event.code)) {
    keys.add(event.code);
    if (state.mode === "walk") event.preventDefault();
  }
  if (event.code === "KeyN") {
    setTime(state.timeOfDay > 19 ? 11.8 : 20.4, true);
  }
  if (event.code === "KeyR") toggleRain();
  if (event.code === "KeyO") goOverview();
  if (/^Digit[1-6]$/.test(event.code)) {
    const poi = POIS[Number(event.code.slice(-1)) - 1];
    if (poi) selectPoi(poi);
  }
}

function onKeyUp(event) {
  keys.delete(event.code);
}

function updateUiTime(now) {
  if (now - state.lastUiUpdate < 220) return;
  state.lastUiUpdate = now;
  clockElement.textContent = formatClock(state.timeOfDay);
  dayPhaseElement.textContent = phaseName(state.timeOfDay);
}

function drawMinimap() {
  if (!world || minimapCanvas.offsetParent === null) return;
  const ctx = minimapContext;
  const { width, height } = minimapCanvas;
  const pad = 20;
  const minX = -1320;
  const maxX = 1470;
  const minZ = -1740;
  const maxZ = 1490;
  const toX = (x) => pad + ((x - minX) / (maxX - minX)) * (width - pad * 2);
  const toY = (z) => pad + ((z - minZ) / (maxZ - minZ)) * (height - pad * 2);
  const data = world.getMinimapData();

  ctx.clearRect(0, 0, width, height);
  if (minimapSatellite.complete && minimapSatellite.naturalWidth > 0) {
    const sourceX =
      ((minX - MAP_SATELLITE_BOUNDS.minX) /
        (MAP_SATELLITE_BOUNDS.maxX - MAP_SATELLITE_BOUNDS.minX)) *
      minimapSatellite.naturalWidth;
    const sourceY =
      ((minZ - MAP_SATELLITE_BOUNDS.minZ) /
        (MAP_SATELLITE_BOUNDS.maxZ - MAP_SATELLITE_BOUNDS.minZ)) *
      minimapSatellite.naturalHeight;
    const sourceWidth =
      ((maxX - minX) /
        (MAP_SATELLITE_BOUNDS.maxX - MAP_SATELLITE_BOUNDS.minX)) *
      minimapSatellite.naturalWidth;
    const sourceHeight =
      ((maxZ - minZ) /
        (MAP_SATELLITE_BOUNDS.maxZ - MAP_SATELLITE_BOUNDS.minZ)) *
      minimapSatellite.naturalHeight;
    ctx.drawImage(
      minimapSatellite,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      pad,
      pad,
      width - pad * 2,
      height - pad * 2,
    );
    ctx.fillStyle = "rgba(11, 24, 22, .24)";
    ctx.fillRect(pad, pad, width - pad * 2, height - pad * 2);
  } else {
    ctx.fillStyle = "#142722";
    ctx.fillRect(0, 0, width, height);
  }

  const labelledRoads = new Set([
    "shan-yao-old-street",
    "zhongxing-street",
    "jinshan-street",
    "qixing-street",
    "shan-yao-street",
    "nan-shan-road",
    "xuefu-road",
    "village-link",
  ]);
  for (const road of data.roads) {
    ctx.beginPath();
    road.points.forEach(([x, z], index) => {
      if (index === 0) ctx.moveTo(toX(x), toY(z));
      else ctx.lineTo(toX(x), toY(z));
    });
    ctx.strokeStyle = "rgba(218,202,169,.2)";
    ctx.lineWidth = Math.max(2.2, road.width * 0.28);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.strokeStyle = "rgba(238,224,194,.62)";
    ctx.lineWidth = 1;
    ctx.stroke();
    if (labelledRoads.has(road.id)) {
      const middle = road.points[Math.floor(road.points.length * 0.5)];
      if (middle) {
        ctx.save();
        ctx.translate(toX(middle[0]), toY(middle[1]));
        const mid = Math.max(1, Math.floor(road.points.length * 0.5));
        const prev = road.points[mid - 1] || middle;
        ctx.rotate(Math.atan2(toY(middle[1]) - toY(prev[1]), toX(middle[0]) - toX(prev[0])));
        ctx.font = '8px "Microsoft YaHei", sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "rgba(255,245,215,.82)";
        ctx.fillText(road.name, 0, -3);
        ctx.restore();
      }
    }
  }

  for (const district of data.districts) {
    ctx.fillStyle = "rgba(237,225,198,.58)";
    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(district.name, toX(district.x), toY(district.z) + 3);
  }

  for (const poi of data.pois) {
    const x = toX(poi.position[0]);
    const y = toY(poi.position[2]);
    const active = poi.id === state.activePoi;
    if (active) {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(220,178,92,.18)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, active ? 3.5 : 2.4, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#f1cf84" : "#bb9c67";
    ctx.fill();
  }

  const cameraX = toX(camera.position.x);
  const cameraY = toY(camera.position.z);
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const angle = Math.atan2(direction.z, direction.x);
  ctx.save();
  ctx.translate(cameraX, cameraY);
  ctx.rotate(angle);
  ctx.fillStyle = "#f4ead5";
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, -4);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-4, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function resize() {
  const width = innerWidth;
  const height = innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const pixelRatio = Math.min(devicePixelRatio, 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);
  labelRenderer.setSize(width, height);
  bloomPass.setSize(width, height);
}

async function init() {
  buildPoiList();
  walkControls.addEventListener("lock", () => {
    walkLockPrompt.hidden = true;
    walkHint.hidden = false;
  });
  walkControls.addEventListener("unlock", () => {
    if (state.mode === "walk") walkLockPrompt.hidden = false;
  });

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", resize);
  window.addEventListener("blur", () => keys.clear());

  $$(".view-button[data-view]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.view));
  });
  $("#overviewButton").addEventListener("click", goOverview);
  enterTownButton.addEventListener("click", enterTown);
  $("#exploreHereButton").addEventListener("click", () => {
    const poi = POIS.find((item) => item.id === state.activePoi);
    if (poi) setWalkAtPoi(poi);
  });
  timeRange.addEventListener("input", () => {
    setTime(Number(timeRange.value), true);
  });
  autoTimeButton.addEventListener("click", toggleAutoTime);
  rainButton.addEventListener("click", toggleRain);
  soundButton.addEventListener("click", async () => {
    const active = await soundscape.toggle();
    soundButton.setAttribute("aria-pressed", String(active));
    soundButton.setAttribute("aria-label", active ? "关闭环境声景" : "开启环境声景");
  });
  helpButton.addEventListener("click", () => showModal("help"));
  storyButton.addEventListener("click", () => showModal("story"));
  $$("[data-close-modal]").forEach((element) => {
    element.addEventListener("click", () => hideModal(element.dataset.closeModal));
  });

  labelRenderer.setSize(innerWidth, innerHeight);
  world = new TownWorld(scene, renderer, labelRenderer.domElement, (progress, label) => {
    loadingBar.style.width = `${Math.round(progress * 100)}%`;
    loadingStatus.textContent = label;
  });
  try {
    await world.build();
    setTime(17.7, false);
    if (buildingCountLabel && world.realBuildings) {
      buildingCountLabel.textContent =
        `${world.realBuildings.count.toLocaleString("zh-CN")} 个可视轮廓`;
    }
    orbit.enabled = false;
    animateCameraTo(
      CAMERA_PRESETS.overview.position,
      CAMERA_PRESETS.overview.target,
      3.2,
      "orbit",
    );
    state.ready = true;
    loadedAt = performance.now();
    app.dataset.ready = "true";
    window.__shanyao = {
      scene,
      camera,
      renderer,
      world,
      state,
      goOverview,
      selectPoi,
      setMode,
      setTime,
      toggleRain,
      enterTown,
    };
    enterTownButton.hidden = false;
    loadingStatus.textContent = "真实轮廓与卫星底图已经就位";
  } catch (error) {
    console.error(error);
    loadingStatus.textContent = "场景加载失败，请刷新页面重试";
    loadingBar.style.background = "#c8523c";
    loadingBar.style.width = "100%";
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  const now = performance.now() / 1000;

  if (world && state.ready) {
    if (state.autoTime && state.entered && !state.modal) {
      setTime(state.timeOfDay + dt * 0.018, false);
    }
    updateWalk(dt);
    updateCameraAnimations(now);
    world.update(dt, elapsed, camera);
    soundscape.update(dt);
    updateUiTime(performance.now());
    if (performance.now() - state.lastMinimapUpdate > 240) {
      state.lastMinimapUpdate = performance.now();
      drawMinimap();
    }
  }

  if (!state.qualityChecked && state.ready) {
    if (!state.frameWatchStarted) state.frameWatchStarted = performance.now();
    state.frameWatchCount += 1;
    const watchDuration = performance.now() - state.frameWatchStarted;
    if (watchDuration > 6500) {
      const fps = state.frameWatchCount / (watchDuration / 1000);
      state.qualityChecked = true;
      if (fps < 24) {
        state.directRenderer = true;
        renderer.shadowMap.enabled = false;
        bloomPass.enabled = false;
        if (world?.sunLight) world.sunLight.castShadow = false;
      }
    }
  }

  if (state.directRenderer) {
    renderer.render(scene, camera);
  } else {
    composer.render();
  }
  labelRenderer.render(scene, camera);

  if (state.ready && loadingScreen.classList.contains("is-hidden")) {
    // Keep the first interactive seconds quiet and uncluttered.
  }
}

init();
animate();
