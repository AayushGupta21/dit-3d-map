// Hide & Seek hideouts: glowing stair doors on the hostels lead to hidden rooms on the upper floors.
// Room positions come straight from the building footprints, so every browser builds the same rooms
// without sending anything over the network. Which hostels are open changes every round (seeded).
import * as THREE from "three";

const FLOOR = 3.6, ROOM_H = 3.3, MAX_FLOORS = 3, OPEN_PER_ROUND = 5;

function pointIn(x, y, p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) ins = !ins;
  }
  return ins;
}
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = (s) => s.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** The biggest room rectangle (in the building's own axis) that fits inside the footprint. */
function fitRoom(b) {
  const [cx, cy] = b.c;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of b.pts) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(ang), s = Math.sin(ang);
  const at = (u, v) => [cx + u * c - v * s, cy + u * s + v * c];
  const fits = (hw, hd) => {
    const m = 0.5;
    for (let i = 0; i <= 12; i++) {
      const k = i / 12;
      const pts = [at(-hw - m + 2 * (hw + m) * k, -hd - m), at(-hw - m + 2 * (hw + m) * k, hd + m),
        at(-hw - m, -hd - m + 2 * (hd + m) * k), at(hw + m, -hd - m + 2 * (hd + m) * k)];
      if (pts.some(([x, y]) => !pointIn(x, y, b.pts))) return false;
    }
    return true;
  };
  let best = null;
  for (const hw of [7, 6, 5, 4.5, 4, 3.5, 3]) for (const hd of [3.5, 3, 2.5, 2]) {
    if (hd > hw || (best && hw * hd <= best.hw * best.hd)) continue;
    if (fits(hw, hd)) best = { cx, cy, ang, hw, hd };
  }
  return best;
}

function labelTex(text, bg = "#0f1a24", fg = "#ffffff", w = 512, h = 128) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = `600 ${Math.round(h * 0.42)}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function tileTex(a, b, n = 8) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const g = cv.getContext("2d"), s = 256 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? a : b; g.fillRect(i * s, j * s, s, s); }
  g.strokeStyle = "rgba(0,0,0,.12)"; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 256); g.moveTo(0, i * s); g.lineTo(256, i * s); g.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createHideouts({ scene, data, walk, inCampus }) {
  // ---------- where the hideouts are ----------
  const list = [];
  for (const b of data.buildings) {
    if (b.cat !== "hostel" || !b.pts || b.pts.length < 3) continue;
    const r = fitRoom(b);
    if (!r) continue;
    const floors = Math.min(MAX_FLOORS, (b.levels || 2) - 1);
    if (floors < 1) continue;
    // a door spot just outside the wall, trying the long sides first
    const c = Math.cos(r.ang), s = Math.sin(r.ang);
    let door = null;
    for (const [du, dv] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const dx = du * c - dv * s, dy = du * s + dv * c;
      let d = 0;
      while (d < 60 && pointIn(r.cx + dx * d, r.cy + dy * d, b.pts)) d += 0.25;
      const wx = r.cx + dx * d, wy = r.cy + dy * d;
      const px = wx + dx * 1.45, py = wy + dy * 1.45;
      if (walk.clearance(px, py) < 1.15 || !inCampus([px, py])) continue;
      door = { x: px, y: py, wx, wy, dx, dy, yaw: Math.atan2(-dx, dy) };
      break;
    }
    if (!door) continue;
    const short = b.name.replace(/\s*\(.*\)/, "").replace("Hostel – ", "").replace(" Hostel", "");
    list.push({ id: b.id, name: b.name, short, rect: r, floors, door });
  }
  const byId = new Map(list.map((h) => [h.id, h]));

  // ---------- shared materials ----------
  const M = {
    wall: new THREE.MeshStandardMaterial({ color: "#e9dfcc", roughness: 0.95, side: THREE.BackSide, emissive: "#e9dfcc", emissiveIntensity: 0.25 }),
    floor: new THREE.MeshStandardMaterial({ map: (() => { const t = tileTex("#b9a88f", "#cdbfa8"); t.repeat.set(5, 3); return t; })(), roughness: 0.8, side: THREE.BackSide, emissive: "#9c8e78", emissiveIntensity: 0.25 }),
    ceil: new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 1, side: THREE.BackSide, emissive: "#f4f1ea", emissiveIntensity: 0.35 }),
    wood: new THREE.MeshStandardMaterial({ color: "#7a5434", roughness: 0.8, emissive: "#3a2818", emissiveIntensity: 0.4 }),
    steel: new THREE.MeshStandardMaterial({ color: "#6e7781", roughness: 0.5, metalness: 0.5, emissive: "#30363d", emissiveIntensity: 0.4 }),
    sheet: new THREE.MeshStandardMaterial({ color: "#5b7fa8", roughness: 0.95, emissive: "#2a3d52", emissiveIntensity: 0.4 }),
    sheet2: new THREE.MeshStandardMaterial({ color: "#a85b5b", roughness: 0.95, emissive: "#522a2a", emissiveIntensity: 0.4 }),
    lamp: new THREE.MeshBasicMaterial({ color: "#fff6dc" }),
    door: new THREE.MeshStandardMaterial({ color: "#5d3b22", roughness: 0.7, emissive: "#2c1b0f", emissiveIntensity: 0.5 }),
    glow: new THREE.MeshBasicMaterial({ color: "#3fe0a0", transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    frame: new THREE.MeshStandardMaterial({ color: "#1d2a24", roughness: 0.6, emissive: "#3fe0a0", emissiveIntensity: 0.6 }),
  };
  const geoBox = new THREE.BoxGeometry(1, 1, 1);
  const box = (g, m, w, h, d, x, y, z, ry = 0) => {
    const o = new THREE.Mesh(geoBox, m);
    o.scale.set(w, h, d); o.position.set(x, y, z); o.rotation.y = ry;
    g.add(o); return o;
  };

  // ---------- portals (outside, on the ground floor) ----------
  const portals = new THREE.Group();
  scene.add(portals);
  for (const h of list) {
    const g = new THREE.Group();
    const d = h.door;
    g.position.set(d.wx + d.dx * 0.12, 0, -(d.wy + d.dy * 0.12));
    g.rotation.y = Math.atan2(d.dx, -d.dy);
    box(g, M.frame, 0.16, 2.5, 0.16, -0.85, 1.25, 0);
    box(g, M.frame, 0.16, 2.5, 0.16, 0.85, 1.25, 0);
    box(g, M.frame, 1.86, 0.18, 0.16, 0, 2.55, 0);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.54, 2.4), M.glow);
    pane.position.set(0, 1.2, 0); g.add(pane);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshBasicMaterial({ map: labelTex(`▲ ${h.short} stairs`, "#0f2a20", "#9ff5cf") }));
    sign.position.set(0, 3.0, 0.05); g.add(sign);
    g.visible = false;
    h.portal = g;
    portals.add(g);
  }

  // ---------- rooms (built the first time someone needs them) ----------
  const rooms = new Map();
  function room(hid, floor) {
    const key = hid + ":" + floor;
    if (rooms.has(key)) return rooms.get(key);
    const h = byId.get(hid), r = h.rect;
    const y = floor * FLOOR + 0.05;
    const g = new THREE.Group();
    g.position.set(r.cx, y, -r.cy); g.rotation.y = r.ang;
    const W = r.hw * 2, D = r.hd * 2;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W, ROOM_H, D), [M.wall, M.wall, M.ceil, M.floor, M.wall, M.wall]);
    shell.position.y = ROOM_H / 2;
    g.add(shell);
    // stair doors: up at the +u end, down at the -u end
    const up = floor < h.floors, downTxt = floor > 1 ? `▼ Floor ${floor - 1}` : "▼ Exit";
    const doorAt = (x, ry, txt, live) => {
      box(g, live ? M.door : M.steel, 0.08, 2.2, 1.2, x, 1.1, 0, 0);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.38), new THREE.MeshBasicMaterial({ map: labelTex(txt, live ? "#0f2a20" : "#333", live ? "#9ff5cf" : "#aaa") }));
      s.position.set(x, 2.55, 0); s.rotation.y = ry; g.add(s);
    };
    doorAt(r.hw - 0.04, -Math.PI / 2, up ? `▲ Floor ${floor + 1}` : "Roof locked", up);
    doorAt(-r.hw + 0.04, Math.PI / 2, downTxt, true);
    // furniture: different every room, good for crouching behind (or inside the cupboard...)
    const rnd = seeded(hashStr(key));
    const n = Math.max(1, Math.floor((W - 3.2) / 2.3));
    for (let i = 0; i < n; i++) {
      const x = -r.hw + 2.1 + i * 2.3 + rnd() * 0.3;
      for (const side of [-1, 1]) {
        if (rnd() < 0.25) continue;
        const z = side * (r.hd - 0.5);
        box(g, M.wood, 1.95, 0.42, 0.95, x, 0.21, z);
        box(g, rnd() < 0.5 ? M.sheet : M.sheet2, 1.8, 0.14, 0.88, x, 0.49, z);
        box(g, M.wood, 0.06, 0.9, 0.95, x - 0.95, 0.45, z);
      }
    }
    const cupX = (rnd() - 0.5) * (W - 4);
    box(g, M.steel, 1.0, 2.0, 0.6, cupX, 1.0, -(r.hd - 0.32) * (rnd() < 0.5 ? 1 : -1));
    const deskX = (rnd() - 0.5) * (W - 4);
    box(g, M.wood, 1.3, 0.75, 0.65, deskX, 0.375, (r.hd - 0.35) * (rnd() < 0.5 ? 1 : -1));
    box(g, M.wood, 0.6, 0.9, 0.6, deskX + 0.9, 0.45, 0);
    for (let i = 0; i < Math.max(1, Math.round(W / 5)); i++) box(g, M.lamp, 1.2, 0.04, 0.25, -r.hw + (i + 0.5) * (W / Math.max(1, Math.round(W / 5))), ROOM_H - 0.03, 0);
    g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    scene.add(g);
    const out = { cx: r.cx, cy: r.cy, ang: r.ang, hw: r.hw, hd: r.hd, y, hid, floor, g };
    rooms.set(key, out);
    return out;
  }

  /** The room a scene-space point is in (works for rooms nobody has built yet). */
  function roomAt(sx, sy, sz) {
    if (sy < FLOOR * 0.9) return null;
    const x = sx, y = -sz;
    for (const h of list) {
      const r = h.rect, c = Math.cos(r.ang), s = Math.sin(r.ang), dx = x - r.cx, dy = y - r.cy;
      const u = dx * c + dy * s, v = -dx * s + dy * c;
      if (Math.abs(u) > r.hw + 0.05 || Math.abs(v) > r.hd + 0.05) continue;
      const k = Math.floor((sy - 0.05) / FLOOR);
      if (k < 1 || k > h.floors || sy - (k * FLOOR + 0.05) > ROOM_H) continue;
      return { cx: r.cx, cy: r.cy, ang: r.ang, hw: r.hw, hd: r.hd, y: k * FLOOR + 0.05 };
    }
    return null;
  }
  /** Where a ray from inside a room meets its walls, floor or ceiling. */
  function rayRoom(o, d, rm) {
    const c = Math.cos(rm.ang), s = Math.sin(rm.ang);
    const px = o.x - rm.cx, pz = o.z + rm.cy;
    // scene -> room local (local x = u, local z = -v)
    const lx = px * c - pz * s, lz = px * s + pz * c, ly = o.y - rm.y;
    const dx = d.x * c - d.z * s, dz = d.x * s + d.z * c, dy = d.y;
    let t = Infinity, axis = 0, sign = 1;
    const test = (p, dd, lo, hi, ax) => {
      if (Math.abs(dd) < 1e-9) return;
      const tt = ((dd > 0 ? hi : lo) - p) / dd;
      if (tt > 0 && tt < t) { t = tt; axis = ax; sign = dd > 0 ? -1 : 1; }
    };
    test(lx, dx, -rm.hw, rm.hw, 0); test(ly, dy, 0, ROOM_H, 1); test(lz, dz, -rm.hd, rm.hd, 2);
    if (!isFinite(t)) return null;
    let nx = axis === 0 ? sign : 0, ny = axis === 1 ? sign : 0, nz = axis === 2 ? sign : 0;
    // back to scene space
    const sx = nx * c + nz * s, sz = -nx * s + nz * c;
    return { t, n: new THREE.Vector3(sx, ny, sz), surf: axis === 1 && sign > 0 ? "ground" : "concrete" };
  }

  // ---------- which hostels are open this round ----------
  let open = new Set();
  function setOpen(seed) {
    if (seed === null) open = new Set();
    else if (!seed) open = new Set(list.map((h) => h.id));
    else {
      const rnd = seeded(seed), ids = list.map((h) => h.id);
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      open = new Set(ids.slice(0, OPEN_PER_ROUND));
    }
    for (const h of list) h.portal.visible = open.has(h.id);
  }

  /** What "use" (E / ✋) would do here, or null. */
  function actionAt(pos) {
    const rm = walk.room;
    if (rm) {
      const h = byId.get(rm.hid);
      const c = Math.cos(rm.ang), s = Math.sin(rm.ang);
      const u = (pos[0] - rm.cx) * c + (pos[1] - rm.cy) * s;
      if (u > rm.hw - 1.7 && rm.floor < h.floors) return { label: `Go up to floor ${rm.floor + 1}`, go: () => enter(h, rm.floor + 1, true) };
      if (u < -rm.hw + 1.7) return rm.floor > 1 ? { label: `Go down to floor ${rm.floor - 1}`, go: () => enter(h, rm.floor - 1, false) } : { label: `Leave ${h.short}`, go: () => exit(h) };
      return null;
    }
    let best = null, bd = 2.6;
    for (const h of list) {
      if (!open.has(h.id)) continue;
      const d = Math.hypot(pos[0] - h.door.x, pos[1] - h.door.y);
      if (d < bd) { bd = d; best = h; }
    }
    return best ? { label: `Enter ${best.short} · hidden floor rooms`, go: () => enter(best, 1, true) } : null;
  }
  function enter(h, floor, fromBelow) {
    const rm = room(h.id, floor);
    walk.room = rm;
    const c = Math.cos(rm.ang), s = Math.sin(rm.ang);
    const u = fromBelow ? -rm.hw + 1.25 : rm.hw - 1.25;
    const fu = fromBelow ? 1 : -1; // face into the room
    walk.setPos(rm.cx + u * c, rm.cy + u * s, Math.atan2(-fu * c, fu * s));
    return `${h.short} · floor ${floor}`;
  }
  function exit(h) {
    walk.room = null;
    walk.setPos(h.door.x, h.door.y, h.door.yaw);
    return h.short;
  }
  let pulse = 0;
  function update(dt) { pulse += dt; M.glow.opacity = 0.42 + Math.sin(pulse * 3) * 0.14; }
  function dispose() {
    for (const r of rooms.values()) scene.remove(r.g);
    rooms.clear();
    scene.remove(portals);
  }
  return { list, room, roomAt, rayRoom, setOpen, actionAt, update, dispose, get openIds() { return [...open]; } };
}
