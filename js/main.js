import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { buildWorld, buildingHeight, ribbon, toV3 } from "./world.js?v=1795612424";
import { sunPosition, sunVector, istMinutes, istDateAt, istMonth, sunTimes, fmtTime } from "./sun.js?v=1795612424";
import { buildGraph, route } from "./routing.js?v=1795612424";
import { openGMap } from "./gmap.js?v=1795612424";
import { createWalk } from "./walk.js?v=1795612424";
import { createGame } from "./game.js?v=1795612424";
import { createTraffic } from "./traffic.js?v=1795612424";

const DATA = window.CAMPUS_DATA;
const KEY = (window.DIT_CONFIG || {}).GOOGLE_MAPS_API_KEY || "";
const LAT = 30.3987, LNG = 78.0761;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

const CATS = {
  academic: { label: "Academic", color: "#2bb39a" },
  hostel: { label: "Hostels", color: "#5b8def" },
  food: { label: "Food", color: "#f39c3c" },
  admin: { label: "Admin", color: "#b07fe0" },
  sports: { label: "Sports", color: "#74c44c" },
  other: { label: "Other", color: "#9aa6b6" },
};

// ---------- settings ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem("dit-" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("dit-" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const isPhone = matchMedia("(max-width: 720px)").matches;
const weakDevice = (navigator.deviceMemory && navigator.deviceMemory <= 3) || (isPhone && (navigator.hardwareConcurrency || 8) <= 4);
const lite = store.get("lite", weakDevice);

// ---------- renderer / scene ----------
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, lite ? 1 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = !lite;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog("#cfe3f2", 650, 2200);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 1, 6000);
const HOME = { target: new THREE.Vector3(-70, 0, 60), pos: new THREE.Vector3(-170, 300, 400) };
if (innerWidth < innerHeight) HOME.pos.sub(HOME.target).multiplyScalar(1.7).add(HOME.target); // portrait phones: start further out
camera.position.copy(HOME.pos);

const controls = new MapControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = false;
controls.minDistance = 35;
controls.maxDistance = 1300;
controls.maxPolarAngle = 1.32;
controls.zoomToCursor = true;
controls.enableZoom = false;       // we handle wheel / pinch ourselves (see "map-style gestures" below)
controls.update();

// ---------- map-style gestures: pinch / wheel zoom at the cursor, two-finger swipe pans ----------
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _hit = new THREE.Vector3();
function groundAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  return _ray.ray.intersectPlane(groundPlane, _hit) ? _hit.clone() : controls.target.clone();
}
/** Zoom by `factor` (<1 = in) keeping the ground point under the cursor fixed. */
function smoothZoom(factor, clientX, clientY) {
  if (walkActive()) return;
  flight = null;
  const dist = camera.position.distanceTo(controls.target);
  const nd = clamp(dist * factor, controls.minDistance, controls.maxDistance);
  const s = nd / dist;
  if (Math.abs(s - 1) < 1e-4) return;
  const P = clientX == null ? controls.target.clone() : groundAt(clientX, clientY);
  controls.target.sub(P).multiplyScalar(s).add(P);
  camera.position.sub(P).multiplyScalar(s).add(P);
  controls.target.y = 0;
  controls.update(); markDirty(); hideHint();
}
/** Move the map by a screen-space delta (pixels), like dragging it. */
function panBy(dx, dy) {
  if (walkActive()) return;
  flight = null;
  const dist = camera.position.distanceTo(controls.target);
  const k = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / canvas.clientHeight;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0); right.y = 0; right.normalize();
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const move = right.multiplyScalar(-dx * k).add(fwd.multiplyScalar(dy * k * 1.4));
  controls.target.add(move); camera.position.add(move);
  controls.update(); markDirty(); hideHint();
}
function walkActive() { return document.body.classList.contains("walking"); }
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  let dy = e.deltaY, dx = e.deltaX;
  if (e.deltaMode === 1) { dy *= 16; dx *= 16; } else if (e.deltaMode === 2) { dy *= 400; dx *= 400; }
  if (e.ctrlKey) {                                  // trackpad pinch (browsers send it as ctrl+wheel)
    smoothZoom(Math.exp(dy * 0.012), e.clientX, e.clientY);
  } else if (e.deltaMode === 0 && (Math.abs(dx) > 0 || Math.abs(dy) < 40 && !Number.isInteger(dy))) {
    panBy(-dx, -dy);                                // trackpad two-finger swipe: move the map
  } else {
    smoothZoom(Math.exp(dy * 0.0022), e.clientX, e.clientY); // mouse wheel: zoom at cursor
  }
}, { passive: false });
// Safari's native pinch gesture events
let _gs = 1;
canvas.addEventListener("gesturestart", (e) => { e.preventDefault(); _gs = 1; });
canvas.addEventListener("gesturechange", (e) => { e.preventDefault(); smoothZoom(_gs / e.scale, e.clientX, e.clientY); _gs = e.scale; });
canvas.addEventListener("dblclick", (e) => { if (!walkActive()) animateZoom(0.5, e.clientX, e.clientY); });
function animateZoom(total, cx, cy) {
  const steps = 14, f = Math.pow(total, 1 / steps); let i = 0;
  const tick = () => { smoothZoom(f, cx, cy); if (++i < steps) requestAnimationFrame(tick); };
  tick();
}

// ---------- lights + sky ----------
const hemi = new THREE.HemisphereLight("#dbe9ff", "#6b7a4a", 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff4e0", 2.5);
sun.castShadow = !lite;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -420; sc.right = 420; sc.top = 420; sc.bottom = -420; sc.near = 50; sc.far = 1600;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

const skyU = { uTop: { value: new THREE.Color("#4f8fdc") }, uHorizon: { value: new THREE.Color("#cfe3f2") }, uBottom: { value: new THREE.Color("#9fb56a") } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `uniform vec3 uTop, uHorizon, uBottom; varying vec3 vP;
    void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h,0.0,1.0), 0.55)) : mix(uHorizon, uBottom, clamp(-h*6.0,0.0,1.0));
    gl_FragColor = vec4(c, 1.0); }`,
}));
sky.renderOrder = -1;
scene.add(sky);

// ---------- world ----------
const world = buildWorld(scene, DATA, { lite, anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
const graph = buildGraph(DATA.roads);
const traffic = createTraffic(scene, DATA, { lite, shadows: !lite });
traffic.visible = store.get("traffic", true);
const walk = createWalk({ camera, canvas, data: DATA, joystickEl: $("joystick"), knobEl: $("knob") });

// ---------- items (everything searchable / labelled) ----------
const items = [];
for (const b of DATA.buildings) items.push({ id: b.id, name: b.name, cat: b.cat, c: b.c, h: buildingHeight(b) + (b.roof === "red" ? 3 : 1.5), kind: "building", ref: b, area: polyArea(b.pts), sub: b.sub });
for (const f of DATA.features) items.push({ id: f.id, name: f.name, cat: f.cat, c: f.c, h: 2, kind: "feature", ref: f, area: polyArea(f.pts) * 0.3, sub: f.sub });
(DATA.connectors || []).forEach((c, i) => {
  const p = c.pts[Math.floor(c.pts.length / 2)];
  items.push({ id: c.name, name: c.name, cat: c.type === "gate" || c.type === "portico" ? "admin" : c.type === "amphitheatre" ? "sports" : c.type === "cafe" ? "food" : "other", c: p,
    h: c.type === "bridge" ? (c.deck || 6) + 4 : c.type === "ramp" ? (c.deck || 4) + 2 : 4, kind: "connector", ref: c, area: c.type === "bridge" ? 900 : 120, sub: c.sub });
});
DATA.places.forEach((p, i) => items.push({ id: "P" + i, name: p.name, cat: p.cat || "other", c: p.c, h: 3, kind: "place", ref: p, area: 50, sub: p.sub }));
function polyArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a / 2); }
const byId = new Map(items.map((it) => [it.id, it]));

// ---------- environment: time, weather, season ----------
const env = { minutes: istMinutes(), live: true, weather: "clear", season: "auto", nightF: 0 };
const KEYS = [ // sun altitude (deg) keyframes
  { a: -14, top: "#070d1d", hor: "#121a31", sunC: "#7d93d8", sunI: 0.32, hemiI: 0.22, exp: 1.15 },
  { a: -5, top: "#1d2850", hor: "#3a3d63", sunC: "#8fa0e0", sunI: 0.3, hemiI: 0.35, exp: 1.05 },
  { a: 0, top: "#3e5a8e", hor: "#ee8a5a", sunC: "#ff8f52", sunI: 0.9, hemiI: 0.6, exp: 1.0 },
  { a: 6, top: "#5d8cc8", hor: "#f9b679", sunC: "#ffb066", sunI: 1.9, hemiI: 0.85, exp: 1.0 },
  { a: 15, top: "#5a96d8", hor: "#f3dcbc", sunC: "#ffe1b8", sunI: 2.6, hemiI: 1.0, exp: 1.0 },
  { a: 35, top: "#4b8bd8", hor: "#cfe3f2", sunC: "#fff3e2", sunI: 2.6, hemiI: 1.0, exp: 0.92 },
  { a: 90, top: "#3f80d4", hor: "#d3e6f4", sunC: "#fffaf2", sunI: 2.8, hemiI: 1.05, exp: 0.9 },
];
const c1 = new THREE.Color(), c2 = new THREE.Color();
function sample(alt) {
  let i = 0;
  while (i < KEYS.length - 2 && alt > KEYS[i + 1].a) i++;
  const A = KEYS[i], B = KEYS[i + 1];
  const t = clamp((alt - A.a) / (B.a - A.a), 0, 1);
  const mixC = (x, y) => c1.set(A[x]).lerp(c2.set(B[y || x]), t).clone();
  return { top: mixC("top"), hor: mixC("hor"), sunC: mixC("sunC"), sunI: lerp(A.sunI, B.sunI, t), hemiI: lerp(A.hemiI, B.hemiI, t), exp: lerp(A.exp, B.exp, t) };
}

const SEASONS = {
  summer: { base: "#a3b263", grass: "#8fab52", tree: "#4f7530", sand: "#d6cda8", leaf: "#ffffff", con: "#ffffff" },
  monsoon: { base: "#7fae4e", grass: "#62a03c", tree: "#2e6a26", sand: "#c9c49e", leaf: "#d8f0c8", con: "#e8f4e0" },
  autumn: { base: "#98ad5e", grass: "#88a652", tree: "#5f6e30", sand: "#d6cba6", leaf: "#f4d49a", con: "#ffffff" },
  winter: { base: "#93a874", grass: "#84a066", tree: "#4f6c3d", sand: "#d8d2bd", leaf: "#d9dccb", con: "#e6ebe2" },
};
function currentSeason() {
  if (env.season !== "auto") return env.season;
  const m = istMonth();
  return m >= 2 && m <= 4 ? "summer" : m >= 5 && m <= 8 ? "monsoon" : m >= 9 && m <= 10 ? "autumn" : "winter";
}

// rain particles
const RAIN_N = lite ? 2500 : 6000;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 6);
for (let i = 0; i < RAIN_N; i++) {
  const x = (Math.random() - 0.5) * 500, y = Math.random() * 260, z = (Math.random() - 0.5) * 500;
  rainPos.set([x, y, z, x + 0.4, y + 3.2, z + 0.2], i * 6);
}
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: "#b8c8dc", transparent: true, opacity: 0.28, fog: false }));
rain.visible = false;
rain.frustumCulled = false;
scene.add(rain);

const grey = new THREE.Color("#9aa3ad");
function applyEnvironment() {
  const date = istDateAt(env.minutes);
  const pos = sunPosition(date, LAT, LNG);
  const altDeg = (pos.altitude * 180) / Math.PI;
  const k = sample(altDeg);
  const w = env.weather;
  const overcast = w === "cloudy" ? 0.6 : w === "rain" ? 0.75 : w === "fog" ? 0.5 : 0;

  // light direction: sun by day, a fixed high moon at night
  let v = sunVector(pos);
  if (altDeg < -4) v = { x: -0.35, y: 0.8, z: 0.45 };
  else if (v.y < 0.06) v = { x: v.x, y: 0.06, z: v.z };
  const tgt = controls.target;
  sun.position.set(tgt.x + v.x * 700, v.y * 700, tgt.z + v.z * 700);
  sun.target.position.copy(tgt);
  sun.color.copy(k.sunC);
  sun.intensity = k.sunI * (1 - overcast * 0.75);
  hemi.intensity = k.hemiI * (1 + overcast * 0.35);
  hemi.color.copy(k.top).lerp(new THREE.Color("#ffffff"), 0.45);

  const nightBright = clamp((altDeg + 8) / 14, 0, 1); // 0 at night, 1 by day
  const greyNow = grey.clone().multiplyScalar(0.25 + 0.75 * nightBright);
  const top = k.top.clone().lerp(greyNow, overcast), hor = k.hor.clone().lerp(greyNow, overcast);
  skyU.uTop.value.copy(top);
  skyU.uHorizon.value.copy(hor);
  skyU.uBottom.value.copy(hor).multiplyScalar(0.8);
  renderer.toneMappingExposure = k.exp;

  // fog
  if (w === "fog") { scene.fog = new THREE.FogExp2(hor.clone().lerp(new THREE.Color("#c9ced4"), 0.5 * nightBright), 0.0042); }
  else if (w === "rain") { scene.fog = new THREE.FogExp2(hor.clone().multiplyScalar(0.6 + 0.4 * nightBright), 0.0012); }
  else { scene.fog = new THREE.Fog(hor, 650, 2200); }
  rain.visible = w === "rain";

  // night: windows + lamps
  const n = clamp((3 - altDeg) / 11, 0, 1);
  env.nightF = n;
  for (const m of world.facadeMats) m.emissiveIntensity = n * 1.25;
  world.lamps.bulbMat.emissiveIntensity = n * 3;
  world.lamps.poolMat.opacity = n * 0.75;

  // season
  const s = SEASONS[currentSeason()];
  const g = world.groundU;
  g.uBase.value.set(s.base); g.uGrass.value.set(s.grass); g.uTree.value.set(s.tree); g.uSand.value.set(s.sand);
  world.outerMat.color.set(s.base);
  world.treeMats.round.color.set(s.leaf);
  world.treeMats.conifer.color.set(s.con);

  // labels darker at night for contrast
  document.body.classList.toggle("night", n > 0.5);
  updateTimeUI();
}

// ---------- time UI ----------
let times = sunTimes(LAT, LNG);
function updateTimeUI() {
  const t = fmtTime(env.minutes);
  $("tbTime").textContent = t;
  $("tpTime").textContent = t;
  $("tpSlider").value = Math.round(env.minutes);
  $("tpLive").classList.toggle("on", env.live);
  $("tbLive").classList.toggle("live", env.live);
  $("tpSun").textContent = `Sunrise ${fmtTime(times.rise)} · Sunset ${fmtTime(times.set)} · ${cap(currentSeason())}`;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
function setMinutes(m, live = false) { env.minutes = ((m % 1440) + 1440) % 1440; env.live = live; applyEnvironment(); markDirty(); }
$("tpSlider").addEventListener("input", (e) => setMinutes(+e.target.value, false));
$("tpLive").onclick = () => { times = sunTimes(LAT, LNG); setMinutes(istMinutes(), true); };
$("tpPresets").addEventListener("click", (e) => {
  const p = e.target.dataset.preset; if (!p) return;
  const m = { sunrise: times.rise + 10, noon: times.noon, golden: times.set - 40, sunset: times.set + 4, night: 21 * 60 + 30 }[p];
  setMinutes(m, false);
});
function pickOne(containerId, attr, value) {
  $(containerId).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset[attr] === value));
}
$("tpWeather").addEventListener("click", (e) => { const w = e.target.dataset.weather; if (!w) return; env.weather = w; pickOne("tpWeather", "weather", w); applyEnvironment(); markDirty(); });
$("tpSeason").addEventListener("click", (e) => { const s = e.target.dataset.season; if (!s) return; env.season = s; pickOne("tpSeason", "season", s); applyEnvironment(); markDirty(); });
$("tpLite").checked = lite;
$("tpTraffic").checked = traffic.visible;
$("tpTraffic").onchange = (e) => { traffic.visible = e.target.checked; store.set("traffic", e.target.checked); markDirty(); };
$("tpLite").onchange = (e) => { store.set("lite", e.target.checked); location.reload(); };
$("btnTime").onclick = () => { $("timePanel").hidden = !$("timePanel").hidden; hideHint(); };
setInterval(() => { if (env.live) { env.minutes = istMinutes(); applyEnvironment(); markDirty(); } }, 20000);

// ---------- labels ----------
const labelsEl = $("labels");
let labelsOn = true, activeCat = "all", selected = null;
for (const it of items) {
  const el = document.createElement("div");
  el.className = "lbl";
  el.innerHTML = `<span class="cdot" style="background:${(CATS[it.cat] || CATS.other).color}"></span>${esc(it.name)}`;
  el.addEventListener("click", (e) => { e.stopPropagation(); select(it); });
  labelsEl.append(el);
  it.el = el;
  it.anchor = toV3(it.c, it.h);
}
const ordered = [...items].sort((a, b) => b.area - a.area);
const v = new THREE.Vector3();
const occRay = new THREE.Raycaster();
function occluded(it) {
  // At eye level, hide labels whose building is behind another one.
  const to = it.anchor.clone().sub(camera.position);
  const d = to.length();
  occRay.set(camera.position, to.normalize());
  occRay.far = d - 2;
  const hit = occRay.intersectObjects(world.pickables, true)[0];
  return !!hit && hit.object.userData.id !== it.id;
}
function updateLabels() {
  const W = innerWidth, H = innerHeight;
  const placed = [];
  const dark = env.nightF > 0.5;
  const camDist = camera.position.distanceTo(controls.target);
  const list = selected ? [selected, ...ordered.filter((x) => x !== selected)] : ordered;
  for (const it of list) {
    const el = it.el;
    const near = walk.active ? camera.position.distanceTo(it.anchor) < 260 : (camDist < 950 || it.area > 2500);
    const show = labelsOn && (activeCat === "all" || it.cat === activeCat || it === selected) && (near || it === selected);
    if (!show) { el.style.display = "none"; continue; }
    if (walk.active && occluded(it)) { el.style.display = "none"; continue; }
    v.copy(it.anchor).project(camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { el.style.display = "none"; continue; }
    const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
    const w = it.name.length * 7.4 + 34, h = 28;
    const box = [x - w / 2, y - h - 6, x + w / 2, y];
    if (it !== selected && placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) { el.style.display = "none"; continue; }
    placed.push(box);
    el.style.display = "flex";
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) translate(0, -6px)`;
    el.classList.toggle("dark", dark);
    el.classList.toggle("sel", it === selected);
  }
}

// ---------- chips ----------
const chips = $("chips");
const chipDefs = [["all", "All"], ...Object.entries(CATS).filter(([k]) => items.some((i) => i.cat === k)).map(([k, c]) => [k, c.label])];
for (const [k, label] of chipDefs) {
  const b = document.createElement("button");
  b.className = "pill" + (k === "all" ? " on" : "");
  b.innerHTML = k === "all" ? label : `<span class="cdot" style="background:${CATS[k].color}"></span>${label}`;
  b.onclick = () => { activeCat = k; chips.querySelectorAll(".pill").forEach((x) => x.classList.toggle("on", x === b)); markDirty(); runSearch(); };
  chips.append(b);
}

// ---------- search ----------
let results = [], activeIdx = -1;
function runSearch() {
  const q = $("q").value.trim().toLowerCase();
  if (!q) { $("results").hidden = true; return; }
  const words = q.split(/\s+/);
  results = items.filter((it) => (activeCat === "all" || it.cat === activeCat) &&
    words.every((w) => (it.name + " " + (CATS[it.cat] || CATS.other).label + " " + (it.sub || "")).toLowerCase().includes(w)))
    .sort((a, b) => a.name.toLowerCase().indexOf(words[0]) - b.name.toLowerCase().indexOf(words[0]));
  activeIdx = results.length ? 0 : -1;
  $("results").innerHTML = results.length
    ? results.slice(0, 10).map((it, i) => `<li data-i="${i}" class="${i === 0 ? "active" : ""}"><span class="cdot" style="background:${(CATS[it.cat] || CATS.other).color}"></span><div>${esc(it.name)}<small>${(CATS[it.cat] || CATS.other).label}${it.ref.verified === false ? " · name unconfirmed" : ""}</small></div></li>`).join("")
    : `<li class="muted">No match. Missing a place? Add it to data/places.json</li>`;
  $("results").hidden = false;
}
$("q").addEventListener("input", runSearch);
$("q").addEventListener("keydown", (e) => {
  const lis = [...$("results").querySelectorAll("li[data-i]")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    activeIdx = clamp(activeIdx + (e.key === "ArrowDown" ? 1 : -1), 0, lis.length - 1);
    lis.forEach((li, i) => li.classList.toggle("active", i === activeIdx));
  } else if (e.key === "Enter" && results[activeIdx]) { select(results[activeIdx]); closeSearch(); }
  else if (e.key === "Escape") closeSearch();
});
$("results").addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) { select(results[+li.dataset.i]); closeSearch(); } });
function closeSearch() { $("results").hidden = true; $("q").blur(); }

// ---------- selection / info ----------
let highlight = null;
function select(it) {
  selected = it;
  const cat = CATS[it.cat] || CATS.other;
  $("infoCat").innerHTML = `<span class="cdot" style="background:${cat.color}"></span>${cat.label}`;
  $("infoCat").style.color = cat.color;
  $("infoName").textContent = it.name;
  const r = it.ref;
  const sub = r.sub || it.sub || "";
  $("infoMeta").textContent = it.kind === "building" ? [sub, `${r.levels} floors`].filter(Boolean).join(" · ") : (sub || (it.kind === "feature" ? "Open ground" : ""));
  $("infoNote").hidden = !(it.kind === "building" && r.verified === false);
  const ll = toLatLng(it.c);
  $("infoGmaps").href = `https://www.google.com/maps/search/?api=1&query=${ll.lat.toFixed(6)},${ll.lng.toFixed(6)}`;
  $("info").hidden = false;
  setHighlight(it);
  if (!walk.active) flyTo(it.c, it.kind === "building" ? 150 + Math.sqrt(it.area) * 1.2 : 170);
  markDirty();
}
function setHighlight(it) {
  if (highlight) { scene.remove(highlight); highlight.geometry.dispose(); highlight = null; }
  if (!it || !it.ref.pts) return;
  const h = it.kind === "building" ? buildingHeight(it.ref) : 0.3;
  const pts = it.ref.pts;
  const seg = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    seg.push(toV3(a, 0.3), toV3(b, 0.3), toV3(a, h + 0.8), toV3(b, h + 0.8));
    if (h > 1) seg.push(toV3(a, 0.3), toV3(a, h + 0.8));
  }
  highlight = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: "#f2c062", fog: false }));
  scene.add(highlight);
}
$("infoClose").onclick = () => { $("info").hidden = true; selected = null; setHighlight(null); markDirty(); };
$("infoFrom").onclick = () => { openDirections(); $("dirFrom").value = selected.id; };
$("infoTo").onclick = () => { openDirections(); $("dirTo").value = selected.id; if ($("dirFrom").value !== selected.id) showRoute(); };
$("infoPhoto").onclick = () => { const ll = toLatLng(selected ? selected.c : [0, 0]); location.href = `photo3d.html?lat=${ll.lat.toFixed(6)}&lng=${ll.lng.toFixed(6)}`; };

function toLatLng(p) {
  const o = DATA.origin;
  return { lat: o.lat + p[1] / 110574, lng: o.lng + p[0] / (111320 * Math.cos((o.lat * Math.PI) / 180)) };
}

// ---------- directions ----------
const sortedNames = [...items].sort((a, b) => a.name.localeCompare(b.name));
for (const id of ["dirFrom", "dirTo"]) $(id).innerHTML = sortedNames.map((it) => `<option value="${it.id}">${esc(it.name)}</option>`).join("");
function openDirections() { $("dirPanel").hidden = false; $("results").hidden = true; }
$("btnDirections").onclick = () => { $("dirPanel").hidden = !$("dirPanel").hidden; };
$("dirClose").onclick = () => { $("dirPanel").hidden = true; clearRoute(); };
$("dirSwap").onclick = () => { const a = $("dirFrom").value; $("dirFrom").value = $("dirTo").value; $("dirTo").value = a; showRoute(); };
$("dirGo").onclick = showRoute;
let routeObj = null;
function clearRoute() { if (routeObj) { scene.remove(routeObj); routeObj.traverse((o) => o.geometry && o.geometry.dispose()); routeObj = null; markDirty(); } $("dirInfo").textContent = ""; }
function showRoute() {
  const A = byId.get($("dirFrom").value), B = byId.get($("dirTo").value);
  if (!A || !B || A === B) { $("dirInfo").textContent = "Pick two different places."; return; }
  clearRoute();
  const r = route(graph, A.c, B.c);
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: "#f2a33a", fog: false, polygonOffset: true, polygonOffsetFactor: -4 });
  grp.add(new THREE.Mesh(ribbon(r.path, 3.4, 0.45), mat));
  const ends = new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false });
  for (const [p, col] of [[r.path[0], "#2bb39a"], [r.path[r.path.length - 1], "#ef4b4b"]]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.6, 20), new THREE.MeshBasicMaterial({ color: col, fog: false }));
    pin.position.copy(toV3(p, 0.6));
    grp.add(pin);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.4, 20), ends);
    ring.position.copy(toV3(p, 0.45));
    grp.add(ring);
  }
  routeObj = grp;
  scene.add(grp);
  const mins = Math.max(1, Math.round(r.meters / 1.25 / 60));
  $("dirInfo").textContent = `${Math.round(r.meters)} m · about ${mins} min walk` + (r.straight ? " (no road link found; straight line shown)" : "");
  const xs = r.path.map((p) => p[0]), ys = r.path.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!walk.active) flyTo([(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2], clamp(span * 1.5, 160, 900));
  markDirty();
}

// ---------- camera flights ----------
let flight = null;
function flyTo(c, dist = 200) {
  const target = toV3(c, 0);
  const dir = camera.position.clone().sub(controls.target);
  const polar = clamp(Math.acos(dir.y / dir.length()), 0.5, 1.0);
  const az = Math.atan2(dir.x, dir.z);
  const pos = new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az)).multiplyScalar(dist).add(target);
  flight = { t0: performance.now(), dur: 1300, fromT: controls.target.clone(), toT: target, fromP: camera.position.clone(), toP: pos };
  markDirty();
}
function home() {
  flight = { t0: performance.now(), dur: 1300, fromT: controls.target.clone(), toT: HOME.target.clone(), fromP: camera.position.clone(), toP: HOME.pos.clone() };
  markDirty();
}

// ---------- picking ----------
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let downAt = null;
canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; hideHint(); flight = null; });
canvas.addEventListener("pointerup", (e) => {
  if (game.active) return;
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(world.pickables, true)[0];
  if (hit) { const it = byId.get(hit.object.userData.id); if (it) select(it); }
  $("results").hidden = true;
});

// ---------- toolbar buttons ----------
$("btnReset").onclick = () => { home(); };
$("btnZoomIn").onclick = () => animateZoom(0.6);
$("btnZoomOut").onclick = () => animateZoom(1 / 0.6);
$("btnLabels").onclick = () => { labelsOn = !labelsOn; $("btnLabels").classList.toggle("on", labelsOn); markDirty(); };
let locked = false;
$("btnLock").onclick = () => {
  locked = !locked;
  controls.enableRotate = !locked;
  $("btnLock").classList.toggle("on", locked);
  $("btnLock").textContent = locked ? "Unlock angle" : "Lock angle";
};
$("btnPhoto").onclick = () => { location.href = "photo3d.html"; };
$("btn2D").onclick = async () => {
  try {
    $("gmapWrap").hidden = false;
    await openGMap($("gmap"), DATA, KEY, selected ? selected.c : null);
  } catch (err) {
    $("gmapWrap").hidden = true;
    toast(err.message);
  }
};
$("gmapBack").onclick = () => { $("gmapWrap").hidden = true; };
let meMarker = null;
$("btnLocate").onclick = () => {
  if (!navigator.geolocation) return toast("Location isn't available in this browser.");
  navigator.geolocation.getCurrentPosition((p) => {
    const o = DATA.origin;
    const xy = [(p.coords.longitude - o.lng) * 111320 * Math.cos((o.lat * Math.PI) / 180), (p.coords.latitude - o.lat) * 110574];
    const e = DATA.extent;
    if (xy[0] < e.minX || xy[0] > e.maxX || xy[1] < e.minY || xy[1] > e.maxY) return toast("You're not on campus right now.");
    if (!meMarker) {
      meMarker = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.8, 24), new THREE.MeshBasicMaterial({ color: "#2f7bf6", fog: false }));
      scene.add(meMarker);
    }
    meMarker.position.copy(toV3(xy, 0.6));
    flyTo(xy, 180);
    $("btnLocate").classList.add("on");
  }, () => toast("Couldn't get your location. Check location permission."), { enableHighAccuracy: true, timeout: 10000 });
};
$("btnAbout").onclick = () => { $("about").hidden = false; };
$("aboutClose").onclick = () => { $("about").hidden = true; };
$("about").addEventListener("click", (e) => { if (e.target.id === "about") $("about").hidden = true; });
$("attrib").textContent = DATA.attribution;

function hideHint() { const h = $("hint"); if (h.style.opacity !== "0") { h.style.opacity = "0"; setTimeout(() => (h.hidden = true), 700); } }
setTimeout(hideHint, 9000);
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3500); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------- walk mode ----------
const isTouch = matchMedia("(pointer: coarse)").matches;
function yawToward(dx, dy) { return Math.atan2(-dx, dy); } // data-space direction -> yaw
function enterWalk(start, yaw) {
  flight = null;
  controls.enabled = false;
  $("timePanel").hidden = true; $("results").hidden = true; $("info").hidden = true;
  document.body.classList.add("walking");
  $("walkHud").hidden = false;
  const hint = $("walkHint");
  hint.textContent = isTouch ? "Joystick to walk (push all the way to run) · drag to look around · tap a building for info"
    : "W A S D or arrow keys to walk · Shift to run · drag to look · Q / E to turn · Esc to exit";
  hint.style.opacity = "1";
  clearTimeout(enterWalk.t); enterWalk.t = setTimeout(() => (hint.style.opacity = "0"), 7000);
  walk.enter(start, yaw);
  controls.target.set(walk.pos[0], 0, -walk.pos[1]);
  markDirty();
}
function exitWalk() {
  if (!walk.active) return;
  const [x, y] = walk.pos, yaw = walk.yaw;
  walk.exit();
  document.body.classList.remove("walking");
  $("walkHud").hidden = true;
  // rise up behind where you were standing
  controls.target.set(x, 0, -y);
  const back = [Math.sin(yaw), -Math.cos(yaw)]; // opposite of forward, in data space
  camera.position.set(x + back[0] * 140, 170, -(y + back[1] * 140));
  controls.enabled = true;
  controls.update();
  markDirty();
}
$("btnWalk").onclick = () => {
  const t = controls.target, d = t.clone().sub(camera.position);
  enterWalk([t.x, -t.z], yawToward(d.x, -d.z));
};
$("infoWalk").onclick = () => {
  if (!selected) return;
  const c = selected.c;
  let p = walk.resolve(c[0], c[1]);
  let dx = p[0] - c[0], dy = p[1] - c[1];
  const l = Math.hypot(dx, dy);
  if (l < 0.5) { dx = 0; dy = -1; } else { dx /= l; dy /= l; }
  p = walk.resolve(p[0] + dx * 26, p[1] + dy * 26);
  enterWalk(p, yawToward(c[0] - p[0], c[1] - p[1]));
};
$("walkExit").onclick = exitWalk;
addEventListener("keydown", (e) => { if (e.key === "Escape" && walk.active && !game.active) exitWalk(); });

// ---------- multiplayer ----------
const game = createGame({ scene, camera, canvas, walk, world, data: DATA, enterWalk, exitWalk, toast, isTouch });
$("btnPlay").onclick = () => game.open();

// ---------- render loop (renders only when something changes) ----------
let dirty = 2, labelsDirty = true;
function markDirty() { dirty = Math.max(dirty, 2); labelsDirty = true; }
controls.addEventListener("change", markDirty);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); markDirty();
});
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let last = performance.now(), trafficAcc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let moved = false;
  if (walk.active) {
    moved = walk.update(dt);
    if (game.active) { game.update(dt); dirty = Math.max(dirty, 1); }
    if (moved) controls.target.set(walk.pos[0], 0, -walk.pos[1]);
  } else {
    if (flight) {
      const t = clamp((now - flight.t0) / flight.dur, 0, 1), k = ease(t);
      controls.target.lerpVectors(flight.fromT, flight.toT, k);
      camera.position.lerpVectors(flight.fromP, flight.toP, k);
      if (t >= 1) flight = null;
      markDirty();
    }
    moved = controls.update();
  }
  if (rain.visible) {
    rain.position.set(controls.target.x, 0, controls.target.z);
    const a = rainGeo.attributes.position.array;
    for (let i = 0; i < RAIN_N; i++) {
      const j = i * 6; let y = a[j + 1] - 160 * dt;
      if (y < 0) y += 260;
      a[j + 1] = y; a[j + 4] = y + 3.2;
    }
    rainGeo.attributes.position.needsUpdate = true;
    markDirty();
  }
  if (moved) {
    // keep the shadow camera centred on what we're looking at
    const off = sun.position.clone().sub(sun.target.position);
    sun.target.position.copy(controls.target);
    sun.position.copy(controls.target).add(off);
  }
  // cars and people: step at ~30 fps (smooth enough, half the battery of 60)
  if (traffic.visible && !document.hidden) {
    trafficAcc += dt;
    if (trafficAcc >= 1 / 31) {
      traffic.update(Math.min(trafficAcc, 0.1), now / 1000, env.nightF || 0);
      trafficAcc = 0;
      dirty = Math.max(dirty, 1);
    }
  }
  sky.position.copy(camera.position);
  if (dirty > 0 || moved) {
    renderer.render(scene, camera);
    if (labelsDirty || moved) { updateLabels(); labelsDirty = dirty > 1; }
    dirty--;
  }
}

applyEnvironment();
requestAnimationFrame(frame);
requestAnimationFrame(() => { const l = $("loading"); l.style.opacity = "0"; setTimeout(() => l.remove(), 600); });

// deep link: ?place=VED
const q = new URLSearchParams(location.search).get("place");
if (q && byId.get(q)) setTimeout(() => select(byId.get(q)), 400);

// debugging aid: open with ?debug to poke at the scene from the console
if (new URLSearchParams(location.search).has("debug")) window.__dit = { game, traffic, THREE, scene, camera, controls, walk, world };
