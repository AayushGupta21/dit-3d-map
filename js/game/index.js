// Multiplayer game (2–4 players) on the DIT campus, peer-to-peer over WebRTC (PeerJS).
//
// The player who creates the room is the host. The host owns health, scores, timers, flags and
// roles, checks every hit (with lag compensation) and relays positions at 20 Hz. Clients draw other
// players ~100 ms in the past and interpolate between snapshots, so movement looks smooth.
//
// Modes: Shootout (free for all), Team Deathmatch, Capture the Flag, Hide & Seek.
import * as THREE from "three";
import { createAudio } from "./audio.js";
import { createFX } from "./fx.js";
import { WEAPONS, falloff, createViewModel } from "./weapons.js";
import { makeAvatar } from "./avatar.js";
import { createHUD, createMinimap, COLORS, TEAM_COLORS } from "./hud.js";

const MODES = {
  dm: { name: "Shootout", team: false, time: 300e3, target: 10,
    info: "Everyone for themselves. Most takedowns in 5 minutes wins, or first to 10." },
  tdm: { name: "Team Deathmatch", team: true, time: 300e3, target: 25,
    info: "Red vs Blue. First team to 25 takedowns, or the most after 5 minutes. No friendly fire." },
  ctf: { name: "Capture the Flag", team: true, time: 480e3, target: 3,
    info: "Red base: Chanakya Flag Lawn. Blue base: Boys Hostel Sports Ground. Grab their flag and bring it home while yours is safe. First to 3." },
  hs: { name: "Hide & Seek", team: false, hide: 30e3, time: 180e3,
    info: "One seeker counts to 30 while everyone hides. The seeker gets a radar ping every 30 s. One shot finds a hider, who then joins the seekers. Hiders: press T to taunt for points." },
};
const MAX_PLAYERS = 4, TICK = 50, INTERP = 100, RESPAWN = 3000, PROTECT = 2000, OVER_TIME = 9000;
const PEERJS = ["https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js", "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js"];
const ROOM_PREFIX = "dit3d-r2-";
const SURF = ["none", "brick", "concrete", "metal", "ground", "player"];
const DEFAULT_NAMES = ["Red", "Blue", "Green", "Yellow"];

const clean = (s) => String(s || "").replace(/[<>&"']/g, "").trim().slice(0, 14);
const fmt = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const r2 = (v) => Math.round(v * 100) / 100;
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
function pointIn([x, y], p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) ins = !ins;
  }
  return ins;
}
function loadScript(urls) {
  if (window.Peer) return Promise.resolve();
  return urls.reduce((p, url) => p.catch(() => new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = url; s.onload = res; s.onerror = () => { s.remove(); rej(new Error("load")); };
    document.head.append(s);
  })), Promise.reject());
}

export function createGame(ctx) {
  const { scene, camera, canvas, walk, world, data, enterWalk, exitWalk, toast, isTouch, lite } = ctx;
  const hud = createHUD(), $ = hud.$;
  const audio = createAudio({ isTouch });
  const B = data.boundary && data.boundary.length > 2 ? data.boundary : null;
  const inCampus = (p) => !B || pointIn(p, B);
  const gates = (data.connectors || []).filter((c) => c.type === "gate").map((c) => c.pts[0]);
  const styleById = new Map(data.buildings.map((b) => [b.id, b.style]));
  if (isTouch) document.body.classList.add("gm-touch");

  // ---------- settings ----------
  const settings = Object.assign({ sens: 1, fov: 74, master: 0.8, music: 0.35, sfx: 0.9, invert: false, low: lite },
    (() => { try { return JSON.parse(localStorage.getItem("dit-game-settings") || "{}"); } catch { return {}; } })());
  function saveSettings(s) {
    try { localStorage.setItem("dit-game-settings", JSON.stringify(s)); } catch { /* private mode */ }
    audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    walk.invertY = s.invert;
  }

  // ---------- places ----------
  const featureBy = (pred) => data.features.find(pred);
  const lawn = featureBy((f) => f.kind === "lawn") || data.features[0];
  const field = featureBy((f) => f.kind === "field") || data.features[data.features.length - 1];
  // bases sit a few metres off the feature centre (the lawn has a real flagpole in the middle)
  const off = (f, d) => (f ? walk.findOpen(f.c[0] + d, f.c[1] - d, 2.5) : [0, 0]);
  const BASES = { r: off(lawn, 7), b: off(field, 6) };
  let spots = null;
  function spawnSpots() {
    if (spots) return spots;
    spots = [];
    for (const r of data.roads) for (const p of r.pts) {
      if (!inCampus(p) || spots.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 14)) continue;
      const o = walk.findOpen(p[0], p[1], 3);
      if (inCampus(o)) spots.push(o);
    }
    if (!spots.length) spots.push([0, 0]);
    return spots;
  }
  /** A spawn far from `avoid`, optionally within `radius` of `near`. */
  function pickSpot(avoid = [], near = null, radius = 50) {
    let S = spawnSpots();
    if (near) { const n = S.filter((s) => Math.hypot(s[0] - near[0], s[1] - near[1]) < radius); if (n.length) S = n; }
    let best = S[0], bd = -1;
    for (let k = 0; k < 12; k++) {
      const s = S[Math.floor(Math.random() * S.length)];
      const d = avoid.length ? Math.min(...avoid.map((a) => Math.hypot(a[0] - s[0], a[1] - s[1]))) : Math.random();
      if (d > bd) { bd = d; best = s; }
    }
    return [best[0], best[1], Math.random() * Math.PI * 2];
  }
  function ringSpot(c, i) {
    const a = i * Math.PI / 2;
    const p = walk.findOpen(c[0] + Math.cos(a) * 3, c[1] + Math.sin(a) * 3, 2);
    return [p[0], p[1], a + Math.PI / 2];
  }

  // ---------- raycasting ----------
  const ray = new THREE.Raycaster();
  const v3 = new THREE.Vector3(), v3b = new THREE.Vector3(), nrm = new THREE.Vector3();
  /** Boundary wall (2D segment test, ~2.9 m tall, open at gates). Returns {t, n} or null. */
  function wallHit(o, d, maxT) {
    if (!B) return null;
    const ox = o.x, oy = -o.z, dx = d.x, dy = -d.z;
    let best = null;
    for (let i = 0; i < B.length; i++) {
      const a = B[i], b = B[(i + 1) % B.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den;
      const u = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;
      if (t <= 0.05 || t >= maxT || u < 0 || u > 1 || (best && t >= best.t)) continue;
      const h = o.y + d.y * t;
      if (h > 2.9 || h < 0) continue;
      const hx = ox + dx * t, hy = oy + dy * t;
      if (gates.some((g) => Math.hypot(g[0] - hx, g[1] - hy) < 5.5)) continue;
      let nx = -ey, ny = ex; const l = Math.hypot(nx, ny); nx /= l; ny /= l;
      if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny; }
      best = { t, n: new THREE.Vector3(nx, 0, -ny) };
    }
    return best;
  }
  /** World hit along a ray: buildings, boundary wall, ground. */
  function worldHit(o, d, far) {
    ray.set(o, d); ray.far = far;
    let best = null;
    const h = ray.intersectObjects(world.pickables, true)[0];
    if (h) {
      const st = styleById.get(h.object.userData.id) || "";
      const surf = /modern|concrete|glass|round|stone|step/.test(st) ? "concrete" : "brick";
      nrm.copy(h.face ? h.face.normal : v3.set(0, 1, 0)).transformDirection(h.object.matrixWorld);
      best = { t: h.distance, n: nrm.clone(), surf };
    }
    const w = wallHit(o, d, best ? best.t : far);
    if (w) best = { t: w.t, n: w.n, surf: "brick" };
    if (d.y < -1e-4) {
      const t = -o.y / d.y;
      if (t > 0 && t < far && (!best || t < best.t)) best = { t, n: new THREE.Vector3(0, 1, 0), surf: "ground" };
    }
    return best;
  }
  function lineBlocked(a, b) {
    const d = v3b.copy(b).sub(a), L = d.length();
    d.divideScalar(L || 1);
    const h = worldHit(a, d, L - 0.4);
    return !!(h && h.surf !== "ground");
  }

  // ---------- state ----------
  let peer = null, conn = null, isHost = false, myId = null, code = null, active = false;
  const conns = new Map();
  let G = null, endLocal = 0, lastPhase = null, offset = 0, offsetSamples = [];
  const buf = new Map();      // id -> [{T, s:[x, y, jy, yaw, pitch, flags]}]
  const avatars = new Map();
  let H = null, respawns = [], timers = [];
  const now = () => performance.now();
  const hostNow = () => (isHost ? now() : now() + offset);
  let fx = null, vm = null, mini = null;

  // local player
  const me = () => (G && G.players[myId]) || null;
  const L = {
    w: 1, ammo: WEAPONS.map((w) => ({ mag: w.mag, res: w.reserve })), cd: 0, reload: 0, swap: 0,
    trigger: false, semiLock: false, ads: false, bloom: 0, recoilDebt: 0, lastShot: 0,
    stamina: 1, exhausted: false, kick: 0, shake: 0, stepT: 0, lastYaw: 0, lastPitch: 0,
    showBoard: false, tauntCd: 0, radarAng: null, enemySeen: new Map(), pings: [],
  };
  function resetAmmo() { L.ammo = WEAPONS.map((w) => ({ mag: w.mag, res: w.reserve })); L.reload = 0; L.cd = 0; }

  function pushState(id, T, s) {
    let a = buf.get(id);
    if (!a) buf.set(id, (a = []));
    if (a.length && T <= a[a.length - 1].T) a[a.length - 1] = { T, s }; else a.push({ T, s });
    if (a.length > 40) a.shift();
  }
  function sample(id, T) {
    const a = buf.get(id);
    if (!a || !a.length) return null;
    if (T <= a[0].T) return a[0].s;
    const last = a[a.length - 1];
    if (T >= last.T) return last.s;
    for (let i = a.length - 2; i >= 0; i--) {
      if (a[i].T <= T) {
        const p = a[i], q = a[i + 1], k = (T - p.T) / (q.T - p.T || 1);
        return [p.s[0] + (q.s[0] - p.s[0]) * k, p.s[1] + (q.s[1] - p.s[1]) * k, p.s[2] + (q.s[2] - p.s[2]) * k,
          p.s[3] + angDiff(q.s[3], p.s[3]) * k, p.s[4] + (q.s[4] - p.s[4]) * k, k < 0.5 ? p.s[5] : q.s[5]];
      }
    }
    return last.s;
  }
  const latest = (id) => { const a = buf.get(id); return a && a.length ? a[a.length - 1].s : null; };

  // ---------- networking ----------
  function bc(msg, except) {
    for (const [id, c] of conns) if (id !== except && c.open) { try { c.send(msg); } catch { /* closing */ } }
    if (except !== myId) onNet(msg);
  }
  function toHost(msg) {
    if (isHost) hostHandle(myId, msg);
    else if (conn && conn.open) { try { conn.send(msg); } catch { /* closing */ } }
  }

  // ================= HOST =================
  function addPlayer(id, name) {
    const used = new Set(Object.values(H.players).map((p) => p.slot));
    let slot = 0; while (used.has(slot)) slot++;
    const reds = Object.values(H.players).filter((p) => p.team === "r").length, blues = Object.values(H.players).length - reds;
    H.players[id] = { name: clean(name) || DEFAULT_NAMES[slot], slot, team: reds <= blues ? "r" : "b", hp: 100, score: 0, kills: 0, deaths: 0,
      role: H.mode === "hs" && H.phase !== "lobby" ? "seeker" : "", alive: true, prot: 0, carry: null, lastShot: 0, tauntT: 0 };
  }
  function pushG() {
    const t = now();
    const players = {};
    for (const [id, p] of Object.entries(H.players)) {
      players[id] = { name: p.name, slot: p.slot, team: p.team, hp: Math.round(p.hp), score: p.score, kills: p.kills, deaths: p.deaths,
        role: p.role, alive: p.alive, prot: p.prot > t, carry: p.carry };
    }
    const flags = H.flags ? { r: { ...H.flags.r }, b: { ...H.flags.b } } : null;
    bc({ t: "g", g: { mode: H.mode, phase: H.phase, rem: Math.max(0, H.end - t), msg: H.msg, ts: H.ts, players, flags } });
  }
  const feed = (text) => bc({ t: "ev", text });
  function sendSpawn(id, s) {
    pushState(id, now(), [s[0], s[1], 0, s[2], 0, 0]);
    bc({ t: "sp", id, x: r2(s[0]), y: r2(s[1]), yaw: r2(s[2]) });
  }
  const others = (id) => Object.keys(H.players).filter((k) => k !== id).map(latest).filter(Boolean);
  const enemiesOf = (id) => Object.keys(H.players).filter((k) => k !== id && (!MODES[H.mode].team || H.players[k].team !== H.players[id].team)).map(latest).filter(Boolean);
  function spawnFor(id) {
    const P = H.players[id];
    if (H.mode === "hs") return H.phase === "lobby" ? pickSpot(others(id), BASES.r, 25) : ringSpot(BASES.r, P.slot);
    if (MODES[H.mode].team && H.phase !== "lobby") return pickSpot(enemiesOf(id), BASES[P.team], 45);
    return pickSpot(others(id));
  }

  function hostHandle(id, m) {
    if (m.t === "hello") {
      if (!H.players[id]) {
        if (Object.keys(H.players).length >= MAX_PLAYERS) { const c = conns.get(id); if (c) { c.send({ t: "full" }); setTimeout(() => c.close(), 300); } return; }
        addPlayer(id, m.name);
        feed(`${H.players[id].name} joined`);
      }
      pushG();
      sendSpawn(id, spawnFor(id));
      return;
    }
    if (m.t === "pi") { const c = conns.get(id); if (c && c.open) c.send({ t: "po", c: m.c, T: now() }); return; }
    const P = H.players[id];
    if (!P) return;
    if (m.t === "st") {
      if (P.alive) pushState(id, now(), m.s);
    } else if (m.t === "sh") hostShot(id, P, m);
    else if (m.t === "taunt") {
      if (H.mode !== "hs" || H.phase !== "play" || P.role !== "hider" || now() - P.tauntT < 14000) return;
      P.tauntT = now(); P.score += 1;
      const s = latest(id);
      if (s) bc({ t: "taunt", id, x: s[0], y: s[1] });
      pushG();
    }
  }

  function hostShot(id, P, m) {
    const w = WEAPONS[m.w];
    if (!w || !P.alive) return;
    const t = now();
    if (t - P.lastShot < w.rate * 1000 * 0.7) return; // faster than the gun can fire: ignore
    P.lastShot = t;
    P.prot = 0;
    bc({ t: "fx", id, w: m.w, o: m.o, e: m.e }, id);
    if (H.phase !== "play" || !Array.isArray(m.h)) return;
    const T = Math.max(t - 600, Math.min(t, +m.T || t));
    const dmg = new Map();
    for (const [vid, head, x, y, z] of m.h.slice(0, w.pellets)) {
      const V = H.players[vid];
      if (!V || vid === id || !V.alive || V.prot > t) continue;
      if (MODES[H.mode].team && V.team === P.team) continue;
      if (H.mode === "hs" && !(P.role === "seeker" && V.role === "hider")) continue;
      const res = checkHit(id, vid, T, [x, y, z], !!head, w);
      if (!res) continue;
      const e = dmg.get(vid) || { d: 0, head: false };
      e.d += w.dmg * (res.head ? w.head : 1) * falloff(w, res.dist); e.head = e.head || res.head;
      dmg.set(vid, e);
    }
    for (const [vid, e] of dmg) applyDamage(id, vid, e.d, e.head, m.w);
    if (dmg.size) pushG();
  }
  /** Lag-compensated check: was the target really where the shooter saw them? */
  function checkHit(sid, vid, T, pt, head, w) {
    const ts = sample(vid, T), ss = latest(sid);
    if (!ts || !ss) return null;
    const [tx, ty, tjy, , , fl] = ts, crouch = fl & 1;
    if (Math.hypot(pt[0] - tx, -pt[2] - ty) > 1.0) return null;
    const feet = 0.1 + tjy, top = feet + (crouch ? 1.3 : 1.9);
    if (pt[1] < feet - 0.2 || pt[1] > top + 0.3) return null;
    const eye = new THREE.Vector3(ss[0], (ss[5] & 1 ? 1.12 : 1.7) + ss[2], -ss[1]);
    const p = new THREE.Vector3(pt[0], pt[1], pt[2]);
    const dist = eye.distanceTo(p);
    if (dist > w.range + 10) return null;
    if (lineBlocked(eye, p)) return null;
    return { dist, head: head && pt[1] >= feet + (crouch ? 0.9 : 1.42) };
  }
  function applyDamage(aid, vid, d, head, wi) {
    const A = H.players[aid], V = H.players[vid];
    if (H.mode === "hs") {
      V.role = "seeker"; A.score++; A.kills++;
      feed(`${A.name} found ${V.name}!`);
      bc({ t: "hit", a: aid, v: vid, head, kill: true, hs: true });
      if (!Object.values(H.players).some((p) => p.role === "hider")) endRound();
      return;
    }
    V.hp -= d;
    const kill = V.hp <= 0;
    bc({ t: "hit", a: aid, v: vid, head, kill });
    if (!kill) return;
    V.hp = 0; V.alive = false; V.deaths++;
    A.kills++; A.score++;
    if (MODES[H.mode].team) H.ts[A.team]++;
    feed(`${A.name} ⟶ ${V.name} · ${WEAPONS[wi].name}${head ? " · headshot" : ""}`);
    dropFlag(vid);
    respawns.push({ id: vid, at: now() + RESPAWN });
    const target = MODES[H.mode].target;
    if (H.mode === "dm" && A.score >= target) endRound();
    if (H.mode === "tdm" && H.ts[A.team] >= target) endRound();
  }
  function dropFlag(id) {
    const P = H.players[id];
    if (!P || !P.carry || !H.flags) return;
    const f = H.flags[P.carry], s = latest(id);
    f.carrier = null; f.home = false; f.dropT = now();
    if (s) { f.x = s[0]; f.y = s[1]; }
    feed(`${P.name} dropped the ${P.carry === "r" ? "red" : "blue"} flag`);
    P.carry = null;
  }
  function resetFlags() {
    H.flags = { r: { x: BASES.r[0], y: BASES.r[1], home: true, carrier: null, dropT: 0 }, b: { x: BASES.b[0], y: BASES.b[1], home: true, carrier: null, dropT: 0 } };
  }
  function balanceTeams() {
    const ids = Object.keys(H.players).sort(() => Math.random() - 0.5);
    ids.forEach((id, i) => (H.players[id].team = i % 2 ? "b" : "r"));
  }
  function startRound() {
    const ids = Object.keys(H.players);
    if (ids.length < 2) { toast("You need at least 2 players. Share the invite link."); return; }
    respawns = [];
    H.ts = { r: 0, b: 0 };
    for (const id of ids) Object.assign(H.players[id], { hp: 100, score: 0, kills: 0, deaths: 0, alive: true, role: "", carry: null, prot: now() + PROTECT });
    const mode = MODES[H.mode];
    if (mode.team) balanceTeams();
    if (H.mode === "ctf") resetFlags(); else H.flags = null;
    if (H.mode === "hs") {
      const seeker = ids[Math.floor(Math.random() * ids.length)];
      for (const id of ids) { H.players[id].role = id === seeker ? "seeker" : "hider"; H.players[id].prot = 0; }
      H.phase = "hide"; H.end = now() + mode.hide; H.nextPing = 0;
      feed(`${H.players[seeker].name} is the seeker. Everyone else: hide!`);
    } else {
      H.phase = "play"; H.end = now() + mode.time;
      feed(`${mode.name}! Good luck.`);
    }
    H.msg = "";
    for (const id of ids) sendSpawn(id, spawnFor(id));
    bc({ t: "start" });
    pushG();
  }
  function endRound() {
    if (H.phase === "over") return;
    const ps = Object.values(H.players);
    let msg;
    if (H.mode === "hs") {
      const left = ps.filter((p) => p.role === "hider");
      msg = left.length ? `Hiders win! ${left.map((p) => p.name).join(" & ")} stayed hidden.` : "The seekers found everyone!";
      for (const p of left) p.score += 3;
    } else if (MODES[H.mode].team) {
      msg = H.ts.r === H.ts.b ? `Draw, ${H.ts.r} – ${H.ts.b}` : `${H.ts.r > H.ts.b ? "Red" : "Blue"} team wins, ${Math.max(H.ts.r, H.ts.b)} – ${Math.min(H.ts.r, H.ts.b)}!`;
    } else {
      const top = Math.max(0, ...ps.map((p) => p.score)), w = ps.filter((p) => p.score === top);
      msg = top === 0 ? "Round over. Nobody scored!" : w.length > 1 ? `Draw between ${w.map((p) => p.name).join(" & ")}` : `${w[0].name} wins with ${top}!`;
    }
    H.phase = "over"; H.end = now() + OVER_TIME; H.msg = msg; respawns = [];
    for (const p of ps) { p.alive = true; p.hp = 100; p.carry = null; }
    pushG();
  }
  function hostTick() {
    const t = now();
    if (H.phase === "hide" && t >= H.end) {
      H.phase = "play"; H.end = t + MODES.hs.time; H.nextPing = t + 30000;
      feed("Ready or not, here comes the seeker!"); pushG();
    } else if (H.phase === "play" && t >= H.end) endRound();
    else if (H.phase === "over" && t >= H.end) {
      H.phase = "lobby"; H.msg = ""; H.flags = null;
      for (const p of Object.values(H.players)) { p.role = ""; p.prot = 0; }
      pushG();
    }
    for (const r of respawns.splice(0)) {
      if (t < r.at) { respawns.push(r); continue; }
      const P = H.players[r.id]; if (!P) continue;
      P.alive = true; P.hp = 100; P.prot = t + PROTECT;
      sendSpawn(r.id, spawnFor(r.id));
      pushG();
    }
    if (H.phase === "play" && H.mode === "ctf") ctfTick(t);
    if (H.phase === "play" && H.mode === "hs" && t >= H.nextPing) {
      H.nextPing = t + 30000;
      const hiders = Object.keys(H.players).filter((k) => H.players[k].role === "hider").map((k) => latest(k)).filter(Boolean);
      for (const [sid, S] of Object.entries(H.players)) {
        if (S.role !== "seeker") continue;
        const s = latest(sid); if (!s || !hiders.length) continue;
        let best = null, bd = Infinity;
        for (const h of hiders) { const d = Math.hypot(h[0] - s[0], h[1] - s[1]); if (d < bd) { bd = d; best = h; } }
        bc({ t: "ping", to: sid, ang: Math.atan2(-(best[0] - s[0]), best[1] - s[1]), d: Math.round(bd), x: r2(best[0] + (Math.random() - 0.5) * 20), y: r2(best[1] + (Math.random() - 0.5) * 20) });
      }
    }
    // positions snapshot
    const p = [];
    for (const [id, P] of Object.entries(H.players)) { const s = latest(id); if (s) p.push([P.slot, ...s.map(r2)]); }
    const snap = { t: "s", T: Math.round(t), p };
    for (const c of conns.values()) if (c.open) { try { c.send(snap); } catch { /* closing */ } }
    if (++hostTick.n % 40 === 0 && H.phase !== "lobby") pushG();
  }
  hostTick.n = 0;
  function ctfTick(t) {
    let changed = false;
    for (const [id, P] of Object.entries(H.players)) {
      if (!P.alive) continue;
      const s = latest(id); if (!s) continue;
      for (const team of ["r", "b"]) {
        const f = H.flags[team];
        if (f.carrier) continue;
        const d = Math.hypot(s[0] - f.x, s[1] - f.y);
        if (d > 2.6) continue;
        if (team !== P.team && !P.carry) { f.carrier = id; f.home = false; P.carry = team; feed(`${P.name} took the ${team === "r" ? "red" : "blue"} flag!`); bc({ t: "flag", ev: "take", team, id }); changed = true; }
        else if (team === P.team && !f.home) { Object.assign(f, { x: BASES[team][0], y: BASES[team][1], home: true, dropT: 0 }); feed(`${P.name} returned the ${team === "r" ? "red" : "blue"} flag`); bc({ t: "flag", ev: "ret", team, id }); changed = true; }
      }
      if (P.carry && H.flags[P.team].home && Math.hypot(s[0] - BASES[P.team][0], s[1] - BASES[P.team][1]) < 4.5) {
        const f = H.flags[P.carry];
        Object.assign(f, { x: BASES[P.carry][0], y: BASES[P.carry][1], home: true, carrier: null, dropT: 0 });
        P.carry = null; P.score += 3; H.ts[P.team]++;
        feed(`${P.name} captured the flag for ${P.team === "r" ? "Red" : "Blue"}!`);
        bc({ t: "flag", ev: "cap", team: P.team, id });
        changed = true;
        if (H.ts[P.team] >= MODES.ctf.target) return endRound();
      }
    }
    for (const team of ["r", "b"]) {
      const f = H.flags[team];
      if (f.carrier) { const s = latest(f.carrier); if (s) { f.x = s[0]; f.y = s[1]; } }
      if (!f.home && !f.carrier && f.dropT && t - f.dropT > 20000) { Object.assign(f, { x: BASES[team][0], y: BASES[team][1], home: true, dropT: 0 }); feed(`The ${team === "r" ? "red" : "blue"} flag went home`); changed = true; }
    }
    if (changed || hostTick.n % 10 === 0) pushG();
  }
  function hostDrop(id) {
    conns.delete(id); buf.delete(id);
    const P = H.players[id];
    if (!P) return;
    dropFlag(id);
    delete H.players[id];
    feed(`${P.name} left`);
    const ps = Object.values(H.players);
    if (H.phase === "hide" || H.phase === "play") {
      if (ps.length < 2) endRound();
      else if (H.mode === "hs" && (!ps.some((p) => p.role === "hider") || !ps.some((p) => p.role === "seeker"))) endRound();
    }
    pushG();
  }

  // ================= EVERYONE =================
  const nameOf = (id) => (G && G.players[id] ? G.players[id].name : "Someone");
  const teamMode = () => G && MODES[G.mode].team && G.phase !== "lobby";
  const isEnemy = (id) => {
    if (!G || !G.players[id] || id === myId) return false;
    if (G.mode === "hs" && G.phase !== "lobby") { const M = me(); return M && M.role === "seeker" && G.players[id].role === "hider"; }
    return !teamMode() || G.players[id].team !== me()?.team;
  };
  function onNet(m) {
    switch (m.t) {
      case "g": {
        const prev = G;
        G = m.g; endLocal = now() + G.rem;
        onGameState(prev);
        break;
      }
      case "s":
        if (isHost) break;
        if (!offsetSamples.length) offset = m.T - now() + 60;
        for (const [slot, ...s] of m.p) {
          const id = G && Object.keys(G.players).find((k) => G.players[k].slot === slot);
          if (id && id !== myId) pushState(id, m.T, s);
        }
        break;
      case "po": {
        const rtt = now() - m.c;
        offsetSamples.push({ rtt, off: m.T + rtt / 2 - now() });
        if (offsetSamples.length > 6) offsetSamples.shift();
        offset = offsetSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off;
        break;
      }
      case "sp": {
        if (m.id === myId) {
          walk.setPos(m.x, m.y, m.yaw); L.prev = [m.x, m.y];
          resetAmmo(); L.stamina = 1; L.bloom = 0;
        } else { buf.delete(m.id); pushState(m.id, hostNow() - INTERP - 1, [m.x, m.y, 0, m.yaw, 0, 0]); }
        break;
      }
      case "fx": remoteShot(m); break;
      case "hit": onHit(m); break;
      case "ev": hud.feed(m.text); break;
      case "start": audio.horn(); break;
      case "ping":
        if (m.to === myId) { L.radarAng = m.ang; L.pings.push({ x: m.x, y: m.y, t: now() }); audio.ping(); hud.big(`Radar: nearest hider about ${m.d} m away`, 2200); }
        break;
      case "taunt": {
        const s = latest(m.id) || [m.x, m.y];
        audio.taunt(v3.set(s[0], 1.5, -s[1]).clone());
        L.pings.push({ x: m.x, y: m.y, t: now(), taunt: true });
        if (m.id !== myId) hud.feed(`${nameOf(m.id)} taunted!`);
        break;
      }
      case "flag": {
        const M = me();
        const mine = M && M.team === m.team;
        if (m.ev === "cap") { audio.fanfare(mine); hud.big(`${nameOf(m.id)} captured the flag!`, 2500); }
        else audio.flag(m.ev === "take" ? !mine : mine);
        break;
      }
      case "full": toast("That room is full (4 players max)."); leave(); break;
    }
  }
  function onHit(m) {
    if (m.a === myId) {
      hud.hit(m.kill ? "kill" : m.head ? "head" : "");
      if (m.head) audio.headshot(); else audio.hit();
      if (m.kill) { audio.kill(); hud.big(m.hs ? `Found ${nameOf(m.v)}!` : `You took down ${nameOf(m.v)}`, 1500); }
      L.enemySeen.set(m.v, now());
    }
    if (m.v === myId) {
      audio.hurt();
      const s = sample(m.a, hostNow() - INTERP) || latest(m.a);
      if (s) {
        const ang = Math.atan2(-(s[0] - walk.pos[0]), s[1] - walk.pos[1]);
        hud.damage(-angDiff(ang, walk.yaw));
      } else hud.damage(0);
      L.shake = Math.min(1, L.shake + 0.6);
      if (m.kill) {
        hud.big(m.hs ? `${nameOf(m.a)} found you! Now you're a seeker too.` : `Taken down by ${nameOf(m.a)} · back in ${RESPAWN / 1000} s`, m.hs ? 2600 : RESPAWN);
        L.ads = false; L.trigger = false;
      }
    }
    const a = avatars.get(m.v); if (a) a.flinch();
  }
  function onGameState(prev) {
    const M = me();
    if (G.phase !== lastPhase) {
      if (G.phase === "lobby") { audio.music("lobby"); if (lastPhase === "over") resetAmmo(); }
      if (G.phase === "play" && G.mode !== "hs") { audio.music("fight"); hud.big(MODES[G.mode].name + "!"); resetAmmo(); }
      if (G.phase === "hide") { audio.music("hide"); resetAmmo(); hud.big(M && M.role === "seeker" ? "You're the seeker! Counting to 30…" : "Hide! The seeker comes in 30 seconds.", 3500); }
      if (G.phase === "play" && G.mode === "hs") { audio.horn(); hud.big(M && M.role === "seeker" ? "Go find them!" : "Here comes the seeker. Stay hidden!"); }
      if (G.phase === "over") {
        const won = M && ((MODES[G.mode].team && G.ts[M.team] > G.ts[M.team === "r" ? "b" : "r"]) || (!MODES[G.mode].team && /wins/.test(G.msg) && G.msg.startsWith(M.name)) || (G.mode === "hs" && /Hiders win/.test(G.msg) && M.role === "hider"));
        audio.fanfare(!!won); hud.big(G.msg, OVER_TIME - 500);
        L.showBoard = true; setTimeout(() => (L.showBoard = false), OVER_TIME - 1000);
      }
      lastPhase = G.phase;
    }
    if (prev && M && prev.players[myId] && !prev.players[myId].alive && M.alive) $("gmDown").hidden = true;
    hud.lobby(G, { code, myId, isHost, modes: MODES, maxPlayers: MAX_PLAYERS });
    hud.teamScore(G);
    for (const [id, a] of avatars) if (!G.players[id]) { scene.remove(a.g); a.dispose(); avatars.delete(id); buf.delete(id); }
    const fs = $("gmFlagSt");
    fs.hidden = !(G.mode === "ctf" && G.flags && G.phase === "play");
    if (!fs.hidden && M) {
      const mine = G.flags[M.team], theirs = G.flags[M.team === "r" ? "b" : "r"];
      fs.textContent = M.carry ? "You have their flag! Bring it to your base." :
        !mine.home ? (mine.carrier ? `${nameOf(mine.carrier)} has your flag!` : "Your flag is dropped. Touch it to return it.") :
          theirs.carrier ? `${nameOf(theirs.carrier)} has their flag` : "Steal their flag and bring it home";
    }
  }
  function canShoot() {
    const M = me();
    if (!G || !M || !M.alive) return false;
    if (G.phase === "lobby") return true;
    if (G.phase !== "play") return false;
    return G.mode !== "hs" || M.role === "seeker";
  }

  // ---------- shooting ----------
  function currentSpread(w) {
    const air = walk.jy > 0.05;
    let s = (L.ads ? w.spread.ads : w.spread.hip) + (walk.moving ? w.spread.move * (L.ads ? 0.5 : 1) : 0) + (air ? w.spread.air : 0) + L.bloom;
    if (walk.crouch) s *= 0.7;
    if (walk.running) s += 0.04;
    return s;
  }
  function targetMeshes() {
    const out = [];
    for (const [id, a] of avatars) {
      if (!a.g.visible || !G.players[id] || !G.players[id].alive) continue;
      if (G.phase === "play" && !isEnemy(id)) continue;
      a.hitBody.userData.pid = id; a.hitHead.userData.pid = id;
      a.hitBody.userData.head = false; a.hitHead.userData.head = true;
      out.push(a.hitHead, a.hitBody);
    }
    return out;
  }
  function fire() {
    const w = WEAPONS[L.w], A = L.ammo[L.w];
    if (!canShoot() || L.cd > 0 || L.reload > 0 || L.swap > 0) return;
    if (!w.auto && L.semiLock) return;
    if (walk.running) return;
    if (A.mag <= 0) { audio.empty(); L.cd = 0.25; if (A.res > 0) startReload(); return; }
    A.mag--; L.cd = w.rate; L.semiLock = true; L.lastShot = now();
    const o = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const right = v3.set(1, 0, 0).applyQuaternion(camera.quaternion).clone(), up = v3b.set(0, 1, 0).applyQuaternion(camera.quaternion).clone();
    const spread = currentSpread(w);
    const targets = G.phase === "play" ? targetMeshes() : [];
    const muzzle = vm.muzzle.getWorldPosition(new THREE.Vector3());
    const ends = [], hits = [];
    let anyHit = false;
    for (let k = 0; k < w.pellets; k++) {
      const r = spread * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
      const d = dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const wh = worldHit(o, d, w.range);
      let end, surf, n;
      ray.set(o, d); ray.far = wh ? wh.t : w.range;
      const ph = targets.length ? ray.intersectObjects(targets, false)[0] : null;
      if (ph) {
        end = ph.point; surf = "player"; n = d.clone().negate();
        hits.push([ph.object.userData.pid, ph.object.userData.head ? 1 : 0, r2(end.x), r2(end.y), r2(end.z)]);
        anyHit = true;
        L.enemySeen.set(ph.object.userData.pid, now());
      } else if (wh) { end = o.clone().addScaledVector(d, wh.t); surf = wh.surf; n = wh.n; }
      else { end = o.clone().addScaledVector(d, w.range); surf = "none"; n = up; }
      if (k < 3) fx.tracer(muzzle, end);
      if (surf !== "none") fx.impact(end, n, surf);
      ends.push([r2(end.x), r2(end.y), r2(end.z), SURF.indexOf(surf), r2(n.x), r2(n.y), r2(n.z)]);
    }
    fx.muzzle(muzzle, true);
    if (!settings.low) fx.casing(vm.eject.getWorldPosition(new THREE.Vector3()), right, up);
    audio.gunshot(w.id);
    if (anyHit) { hud.hit(); audio.hit(); }
    vm.fire(L.w);
    // recoil: kick the view, partly recovered afterwards
    const rk = (L.ads ? 0.6 : 1) * (walk.crouch ? 0.75 : 1);
    const v = w.recoil.v * rk * (1 + Math.random() * 0.3), h = (Math.random() - 0.5) * 2 * w.recoil.h * rk;
    walk.addLook(h, v); L.recoilDebt += v * 0.65;
    L.kick = Math.min(1, L.kick + (w.pellets > 1 || w.id === "sniper" ? 1 : 0.4));
    L.bloom = Math.min(0.05, L.bloom + w.bloom);
    audio.intensity = 1; L.combatT = now();
    toHost({ t: "sh", w: L.w, T: Math.round(hostNow() - INTERP), o: [r2(muzzle.x), r2(muzzle.y), r2(muzzle.z)], e: ends, h: hits });
    if (A.mag === 0 && A.res > 0) setTimeout(() => { if (active && L.ammo[L.w] === A && A.mag === 0) startReload(); }, 250);
  }
  function startReload() {
    const w = WEAPONS[L.w], A = L.ammo[L.w];
    if (L.reload > 0 || A.mag >= w.mag || A.res <= 0 || L.swap > 0) return;
    L.reload = w.reload; L.ads = false;
    vm.reload(w.reload); audio.reload(w.id, w.reload);
  }
  function switchTo(i) {
    if (i === L.w || i < 0 || i >= WEAPONS.length) return;
    L.w = i; L.reload = 0; L.swap = 0.35; L.cd = 0; L.ads = false; L.bloom = 0;
    vm.set(i); vm.swap(); audio.swap();
    hud.slots(WEAPONS, L.w);
  }
  function remoteShot(m) {
    const w = WEAPONS[m.w]; if (!w) return;
    const a = avatars.get(m.id);
    const o = a && a.g.visible ? a.muzzleWorld(new THREE.Vector3()) : new THREE.Vector3(...m.o);
    m.e.forEach((e, k) => {
      const end = new THREE.Vector3(e[0], e[1], e[2]);
      if (k < 3) fx.tracer(o, end);
      const surf = SURF[e[3]];
      if (surf !== "none") fx.impact(end, new THREE.Vector3(e[4], e[5], e[6]), surf);
      if (k === 0 && surf !== "none" && surf !== "player" && end.distanceTo(camera.position) < 25) audio.impact(end, surf);
    });
    fx.muzzle(o);
    const d = o.distanceTo(camera.position);
    audio.gunshot(w.id, o, { distant: d > 70, occluded: d > 6 && lineBlocked(camera.position, o) });
    if (isEnemy(m.id)) L.enemySeen.set(m.id, now());
    if (d < 60) { audio.intensity = 1; L.combatT = now(); }
  }

  // ---------- input ----------
  function inGame() { return active; }
  canvas.addEventListener("mousedown", (e) => {
    if (!inGame() || isTouch) return;
    audio.resume();
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
    if (e.button === 0) { L.trigger = true; L.semiLock = false; fire(); }
    if (e.button === 2) L.ads = true;
  });
  addEventListener("mouseup", (e) => { if (e.button === 0) { L.trigger = false; L.semiLock = false; } if (e.button === 2) L.ads = false; });
  canvas.addEventListener("contextmenu", (e) => { if (inGame()) e.preventDefault(); });
  canvas.addEventListener("wheel", (e) => {
    if (!inGame() || document.pointerLockElement !== canvas) return;
    e.preventDefault(); e.stopImmediatePropagation();
    switchTo((L.w + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length);
  }, { passive: false, capture: true });
  addEventListener("keydown", (e) => {
    if (!inGame() || e.target.closest?.("input, select, textarea")) return;
    const k = e.key.toLowerCase();
    if (k === "r") startReload();
    else if (k >= "1" && k <= "4") switchTo(+k - 1);
    else if (k === "tab") { e.preventDefault(); L.boardKey = true; }
    else if (k === "t") toHost({ t: "taunt" });
    else if (k === "f") { L.trigger = true; L.semiLock = false; fire(); }
  });
  addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "tab") L.boardKey = false;
    if (k === "f") { L.trigger = false; L.semiLock = false; }
  });
  document.addEventListener("pointerlockchange", () => { if (active) $("gmAim").hidden = document.pointerLockElement === canvas || isTouch; });
  const hold = (id, down, up) => {
    const el = $(id);
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); audio.resume(); down(); });
    if (up) for (const ev of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(ev, up);
  };
  hold("gmFire", () => { L.trigger = true; L.semiLock = false; fire(); }, () => { L.trigger = false; L.semiLock = false; });
  hold("gmAds", () => { L.ads = !L.ads; $("gmAds").classList.toggle("on", L.ads); });
  hold("gmRl", startReload);
  hold("gmJp", () => walk.jump());
  hold("gmCr", () => { walk.crouchBtn = !walk.crouchBtn; $("gmCr").classList.toggle("on", walk.crouchBtn); });
  hold("gmSw", () => switchTo((L.w + 1) % WEAPONS.length));
  hold("gmTt", () => toHost({ t: "taunt" }));
  hold("gmSb", () => { L.boardKey = true; }, () => { L.boardKey = false; });

  // ---------- per frame ----------
  let sendT = 0, miniT = 0;
  const flagMeshes = {};
  function flagMesh(team) {
    if (flagMeshes[team]) return flagMeshes[team];
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), new THREE.MeshStandardMaterial({ color: "#d9d9d9", metalness: 0.6, roughness: 0.4 }));
    pole.position.y = 1.2; g.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55, 8, 1), new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], side: THREE.DoubleSide, emissive: TEAM_COLORS[team], emissiveIntensity: 0.35 }));
    cloth.position.set(0.45, 2.1, 0); g.add(cloth);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.6, 32), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring);
    g.userData = { cloth, ring };
    scene.add(g);
    return (flagMeshes[team] = g);
  }
  function update(dt) {
    if (!active) return;
    const t = now();
    const M = me();
    const w = WEAPONS[L.w];
    const alive = M ? M.alive : true;
    const blind = !!(G && M && G.phase === "hide" && M.role === "seeker");

    // movement rules
    walk.frozen = !alive || blind;
    if (walk.running) { L.stamina = Math.max(0, L.stamina - dt * 0.22); L.restT = t; if (L.stamina === 0) L.exhausted = true; }
    else if (t - (L.restT || 0) > 700) L.stamina = Math.min(1, L.stamina + dt * 0.18);
    if (L.exhausted && L.stamina > 0.3) L.exhausted = false;
    walk.canRun = !L.exhausted && !L.ads && L.reload <= 0;
    walk.speedMul = w.speed * (L.ads ? 0.6 : 1) * (M && M.carry ? 0.85 : 1);
    if (walk.takeLanding()) { audio.land(); L.kick = Math.max(L.kick, 0.3); }
    const p = walk.pos;
    if (B && !inCampus(p) && L.prev) walk.setPos(L.prev[0], L.prev[1]); else L.prev = [p[0], p[1]];

    // weapon timers
    L.cd = Math.max(0, L.cd - dt);
    L.swap = Math.max(0, L.swap - dt);
    if (L.reload > 0) {
      L.reload -= dt;
      if (L.reload <= 0) { const A = L.ammo[L.w], n = Math.min(w.mag - A.mag, A.res); A.mag += n; A.res -= n; L.reload = 0; }
    }
    if (L.trigger && w.auto) fire();
    L.bloom = Math.max(0, L.bloom - dt * 0.12);
    if (t - L.lastShot > 120 && L.recoilDebt > 0) { const r = L.recoilDebt * Math.min(1, dt * 6); L.recoilDebt -= r; walk.addLook(0, -r); }
    if (!canShoot()) L.ads = false;

    // aim assist on phones: slow the look when the crosshair is on an enemy
    let assist = 1;
    if (isTouch && G && G.phase === "play") {
      ray.setFromCamera({ x: 0, y: 0 }, camera); ray.far = 120;
      const tm = targetMeshes();
      const near = tm.length && ray.ray.direction && tm.some((m) => ray.ray.distanceSqToPoint(m.getWorldPosition(v3)) < 1.2);
      if (near) assist = 0.55;
    }
    const scoped = w.scope && L.ads;
    walk.lookMul = settings.sens * (L.ads ? (scoped ? 0.3 : 0.6) : 1) * assist;

    // camera: walker pose + fov + kick/shake
    walk.refresh();
    const fovT = L.ads ? w.fov : settings.fov;
    if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); }
    L.kick = Math.max(0, L.kick - dt * 8);
    L.shake = Math.max(0, L.shake - dt * 3);
    camera.rotateX(L.kick * 0.012);
    if (L.shake > 0) { camera.rotateZ((Math.random() - 0.5) * L.shake * 0.03); camera.rotateX((Math.random() - 0.5) * L.shake * 0.02); }
    if (scoped) { camera.rotateY(Math.sin(t / 700) * 0.0015); camera.rotateX(Math.cos(t / 900) * 0.0012); }
    if (!alive) { camera.position.y = 0.45; camera.rotateZ(0.5); }
    $("gmDown").hidden = alive;

    // view model
    const yaw = walk.yaw, pitch = walk.pitch;
    vm.visible = canShoot() || (G && G.phase === "lobby");
    vm.update(dt, { moving: walk.moving, running: walk.running, crouch: walk.crouch, ads: L.ads, lookDX: angDiff(yaw, L.lastYaw) / Math.max(dt, 1e-3) * 0.01, lookDY: (pitch - L.lastPitch) / Math.max(dt, 1e-3) * 0.01 });
    L.lastYaw = yaw; L.lastPitch = pitch;

    // own footsteps
    if (walk.moving && walk.jy === 0 && alive) {
      L.stepT -= dt * (walk.running ? 1.45 : walk.crouch ? 0.6 : 1);
      if (L.stepT <= 0) { L.stepT = 0.48; audio.footstep(null, { run: walk.running, crouch: walk.crouch, grass: false }); }
    }

    // send own state (20 Hz)
    sendT += dt;
    if (sendT >= TICK / 1000) {
      sendT = 0;
      const fl = (walk.crouch ? 1 : 0) | (L.ads ? 2 : 0) | (walk.running ? 4 : 0) | (L.w << 4);
      const s = [r2(p[0]), r2(p[1]), r2(walk.jy), Math.round(yaw * 1000) / 1000, Math.round(pitch * 1000) / 1000, fl];
      if (isHost) { if (alive) pushState(myId, t, s); } else toHost({ t: "st", s });
    }

    // other players, drawn INTERP ms in the past
    if (G) {
      const rt = hostNow() - INTERP;
      const M2 = me();
      for (const id in G.players) {
        if (id === myId) continue;
        const P = G.players[id];
        const color = teamMode() ? TEAM_COLORS[P.team] : COLORS[P.slot];
        let a = avatars.get(id);
        if (!a || a.key !== P.name + color) {
          if (a) { scene.remove(a.g); a.dispose(); }
          a = makeAvatar({ color, name: P.name }); a.key = P.name + color; a.wi = -1; a.last = null;
          avatars.set(id, a); scene.add(a.g);
        }
        const s = sample(id, rt);
        if (!P.alive) a.downT = (a.downT ?? 2) - dt; else a.downT = undefined;
        a.g.visible = !!s && (P.alive || a.downT > 0);
        if (!s) continue;
        const wi = (s[5] >> 4) & 3;
        if (wi !== a.wi) { a.wi = wi; a.setWeapon(WEAPONS[wi].id); }
        const sp = a.last ? Math.hypot(s[0] - a.last[0], s[1] - a.last[1]) / Math.max(dt, 1e-3) : 0;
        a.last = [s[0], s[1]];
        a.g.position.set(s[0], 0.1, -s[1]);
        a.g.rotation.y = s[3];
        a.seeker = G.mode === "hs" && P.role === "seeker" && G.phase !== "lobby";
        a.protected = !!P.prot;
        const stepped = a.update(dt, { speed: sp, running: !!(s[5] & 4), crouch: !!(s[5] & 1), jy: s[2], pitch: s[4], aiming: !!(s[5] & 2), down: !P.alive });
        if (stepped && !(s[5] & 1)) {
          const d = Math.hypot(s[0] - walk.pos[0], s[1] - walk.pos[1]);
          if (d < 35) audio.footstep(v3.set(s[0], 0.2, -s[1]).clone(), { run: !!(s[5] & 4) });
        }
        const dist = Math.hypot(s[0] - walk.pos[0], s[1] - walk.pos[1]);
        const friend = teamMode() && M2 && P.team === M2.team;
        a.label.visible = !(G.mode === "hs" && G.phase !== "lobby" && M2 && M2.role === "seeker" && P.role === "hider") && (friend || !teamMode() || dist < 30);
        // CTF: flag on the carrier's back
        if (P.carry && G.flags) {
          const fm = flagMesh(P.carry);
          if (fm.parent !== a.flagHolder) { a.flagHolder.add(fm); fm.position.set(0, -1.1, 0); fm.scale.setScalar(0.55); fm.userData.ring.visible = false; }
        }
      }
    }
    // flags at rest
    if (G && G.mode === "ctf" && G.flags && G.phase !== "lobby") {
      for (const team of ["r", "b"]) {
        const f = G.flags[team], fm = flagMesh(team);
        fm.visible = !(f.carrier === myId);
        if (!f.carrier && fm.parent !== scene) { scene.add(fm); fm.scale.setScalar(1); fm.userData.ring.visible = true; }
        if (!f.carrier) { fm.position.set(f.x, 0, -f.y); }
        const cl = fm.userData.cloth.geometry.attributes.position;
        for (let i = 0; i < cl.count; i++) { const x = cl.getX(i) + 0.45; cl.setZ(i, Math.sin(x * 6 - t / 160) * 0.07 * x); }
        cl.needsUpdate = true;
      }
    } else for (const fm of Object.values(flagMeshes)) if (fm.parent) fm.parent.remove(fm);

    fx.update(dt);
    audio.setListener(camera);
    if (t - (L.combatT || 0) > 6000) audio.intensity = G && G.phase === "play" && endLocal - t < 30000 ? 0.8 : G && G.phase === "hide" ? 0.2 : 0;
    else if (G && G.phase === "play" && endLocal - t < 30000) audio.intensity = 1;

    // HUD
    const A = L.ammo[L.w];
    hud.ammo(w, A.mag, A.res, L.reload > 0);
    const role = !G || G.phase === "lobby" ? "" : G.mode === "hs" ? (M && M.role === "seeker" ? "Seeker" : "Hider") : null;
    $("gmLeft").hidden = !M || !G || G.phase === "lobby";
    if (M) hud.health(G.mode === "hs" ? 100 : M.hp, L.stamina, role);
    const spreadPx = Math.tan(currentSpread(w)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (innerHeight / 2);
    hud.crosshair(spreadPx, canShoot() && !scoped && !walk.running);
    $("gmScope").hidden = !(scoped && vm.adsAmount > 0.8);
    $("gmBlind").hidden = !blind;
    if (blind) {
      const sec = Math.ceil(Math.max(0, endLocal - t) / 1000);
      if (sec !== L.lastBeep) { L.lastBeep = sec; $("gmBlindT").textContent = sec; if (sec <= 5 && sec > 0) audio.beep(sec <= 3); }
    }
    if (G) {
      const rem = Math.max(0, endLocal - t);
      $("gmTimer").textContent = G.phase === "lobby" ? "Lobby" : G.phase === "over" ? "Round over" : (G.phase === "hide" ? "Hide! " : "") + fmt(rem);
      if (G.phase === "play" && rem < 10500 && rem > 0) { const sec = Math.ceil(rem / 1000); if (sec !== L.lastTick) { L.lastTick = sec; audio.beep(sec <= 3); } }
    }
    if (L.radarAng != null) hud.radar(-angDiff(L.radarAng, yaw), false);
    if (L.radarAng != null && L.pings.length && t - L.pings[L.pings.length - 1].t < 100) hud.radar(-angDiff(L.radarAng, yaw), true);
    hud.board(G, myId, L.boardKey || L.showBoard);
    const hsMode = G && G.mode === "hs" && G.phase !== "lobby";
    $("gmFire").hidden = !isTouch || !canShoot();
    $("gmAds").hidden = !isTouch || !canShoot();
    $("gmRl").hidden = !isTouch || !canShoot();
    for (const id of ["gmJp", "gmCr", "gmSw", "gmSb"]) $(id).hidden = !isTouch;
    $("gmTt").hidden = !isTouch || !(hsMode && M && M.role === "hider");

    // minimap (10 Hz)
    miniT -= dt;
    if (miniT <= 0 && G) {
      miniT = 0.1;
      const items = [];
      if (G.mode === "ctf" && G.flags) for (const team of ["r", "b"]) items.push({ kind: "flag", x: G.flags[team].x, y: G.flags[team].y, color: TEAM_COLORS[team] });
      for (const id in G.players) {
        if (id === myId) continue;
        const P = G.players[id], s = latest(id);
        if (!s || !P.alive) continue;
        const friend = teamMode() && M && P.team === M.team;
        const seen = t - (L.enemySeen.get(id) || 0) < 2500;
        if (G.phase === "lobby" || friend || (seen && !hsMode)) items.push({ kind: "dot", x: s[0], y: s[1], color: teamMode() ? TEAM_COLORS[P.team] : COLORS[P.slot] });
      }
      L.pings = L.pings.filter((q) => t - q.t < 5000);
      for (const q of L.pings) items.push({ kind: "ping", x: q.x, y: q.y, color: q.taunt ? "#f2c062" : "#ff5a4e", alpha: 1 - (t - q.t) / 5000 });
      items.push({ kind: "me", x: p[0], y: p[1], yaw });
      mini.draw(items);
    }
  }

  // ---------- rooms ----------
  function status(text) { $("gmStatus").textContent = text; }
  function newCode() { const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(""); }
  async function getPeerLib() {
    status("Connecting…");
    try { await loadScript(PEERJS); } catch { status("Couldn't load the multiplayer library. Check your internet connection."); throw new Error("peerjs"); }
  }
  function storeName(n) { try { localStorage.setItem("dit-mpname", JSON.stringify(n)); } catch { /* private mode */ } }
  async function create() {
    const name = clean($("gmName").value); storeName(name);
    audio.resume();
    await getPeerLib();
    code = newCode();
    peer = new window.Peer(ROOM_PREFIX + code.toLowerCase());
    peer.on("open", (id) => {
      myId = id; isHost = true;
      H = { mode: "dm", phase: "lobby", end: 0, players: {}, msg: "", ts: { r: 0, b: 0 }, flags: null };
      addPlayer(myId, name);
      begin();
      pushG();
    });
    peer.on("connection", (c) => {
      c.on("open", () => conns.set(c.peer, c));
      c.on("data", (m) => { if (m && typeof m === "object") hostHandle(c.peer, m); });
      c.on("close", () => hostDrop(c.peer));
      c.on("error", () => hostDrop(c.peer));
    });
    peer.on("error", (e) => {
      if (e.type === "unavailable-id" && !active) { peer.destroy(); create(); return; }
      if (!active) status("Couldn't create a room: " + (e.type || e.message));
    });
  }
  async function join() {
    const name = clean($("gmName").value);
    const c = $("gmCode").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length !== 5) { status("Room codes have 5 letters."); return; }
    storeName(name);
    audio.resume();
    await getPeerLib();
    code = c;
    peer = new window.Peer();
    peer.on("open", (id) => {
      myId = id; isHost = false;
      conn = peer.connect(ROOM_PREFIX + code.toLowerCase(), { reliable: true });
      const to = setTimeout(() => { if (!active) status("No answer from that room. Check the code, or ask the host to keep their tab open."); }, 12000);
      conn.on("open", () => {
        clearTimeout(to);
        conn.send({ t: "hello", name });
        begin();
        const ping = () => { if (conn && conn.open) conn.send({ t: "pi", c: now() }); };
        ping(); setTimeout(ping, 300); setTimeout(ping, 800);
        timers.push(setInterval(ping, 2000));
      });
      conn.on("data", (m) => { if (m && typeof m === "object") onNet(m); });
      conn.on("close", () => { if (active) { toast("The host left, so the game ended."); leave(); } });
    });
    peer.on("error", (e) => {
      if (!active) status(e.type === "peer-unavailable" ? "No room with that code. Check it and try again." : "Connection problem: " + (e.type || e.message));
    });
  }
  function begin() {
    active = true;
    $("gmStart").hidden = true;
    document.body.classList.add("gaming");
    $("gmHud").hidden = false;
    fx = createFX(scene, { lite: settings.low });
    vm = createViewModel(camera);
    if (!camera.parent) scene.add(camera);
    vm.set(L.w);
    mini = mini || createMinimap($("gmMini"), data);
    resetAmmo();
    hud.slots(WEAPONS, L.w);
    const a0 = Math.random() * Math.PI * 2;
    const s = walk.findOpen(BASES.r[0] + Math.cos(a0) * 6, BASES.r[1] + Math.sin(a0) * 6, 3);
    enterWalk(s, Math.random() * 6.28);
    walk.game = true;
    saveSettings(settings);
    L.prev = [s[0], s[1]];
    $("gmAim").hidden = isTouch;
    $("gmKeys").textContent = isTouch ? "Joystick moves · drag to look · buttons on the right" :
      "Click to aim · WASD move · Shift sprint · Space jump · C crouch · R reload · 1–4 or wheel: weapons · right-click: aim · Tab: scores · T: taunt";
    audio.music("lobby");
    timers.push(setInterval(() => { if (isHost) hostTick(); }, TICK));
    history.replaceState(null, "", location.pathname + location.search.replace(/([?&])room=[^&]*&?/, "$1").replace(/[?&]$/, ""));
  }
  function leave() {
    if (!active && !peer) { $("gmStart").hidden = true; return; }
    active = false;
    for (const tm of timers) clearInterval(tm);
    timers = [];
    try { peer && peer.destroy(); } catch { /* already closed */ }
    peer = null; conn = null; conns.clear(); buf.clear(); G = null; H = null; lastPhase = null; offsetSamples = [];
    for (const a of avatars.values()) { scene.remove(a.g); a.dispose(); }
    avatars.clear();
    for (const fm of Object.values(flagMeshes)) if (fm.parent) fm.parent.remove(fm);
    if (fx) { fx.dispose(); fx = null; }
    if (vm) { vm.dispose(); vm = null; }
    audio.stop();
    walk.frozen = false; L.trigger = false; L.ads = false; walk.crouchBtn = false;
    if (document.pointerLockElement) document.exitPointerLock();
    document.body.classList.remove("gaming");
    for (const id of ["gmHud", "gmLobby", "gmBlind", "gmStart", "gmBoard", "gmSet"]) $(id).hidden = true;
    exitWalk();
  }
  function open(prefill) {
    if (active) return;
    let n = "";
    try { n = JSON.parse(localStorage.getItem("dit-mpname") || '""'); } catch { /* ignore */ }
    $("gmName").value = n;
    if (prefill) $("gmCode").value = prefill;
    status("");
    $("gmStart").hidden = false;
  }

  // ---------- buttons ----------
  $("gmCreate").onclick = () => create().catch(() => {});
  $("gmJoin").onclick = () => join().catch(() => {});
  $("gmCode").addEventListener("keydown", (e) => { if (e.key === "Enter") join().catch(() => {}); });
  $("gmClose").onclick = () => { if (!active) { try { peer && peer.destroy(); } catch { /* */ } peer = null; } $("gmStart").hidden = true; };
  $("gmLeave").onclick = leave;
  $("gmLeave2").onclick = leave;
  $("gmStartBtn").onclick = () => { if (isHost) startRound(); };
  $("gmModes").addEventListener("click", (e) => {
    const m = e.target.dataset.mode;
    if (!m || !isHost || H.phase !== "lobby") return;
    H.mode = m;
    if (MODES[m].team) balanceTeams();
    pushG();
  });
  $("gmCopy").onclick = async () => {
    const link = `${location.origin}${location.pathname}?room=${code}`;
    try { await navigator.clipboard.writeText(link); toast("Invite link copied. Send it to your friends!"); } catch { toast(link); }
  };
  $("gmSetBtn").onclick = () => {
    if (document.pointerLockElement) document.exitPointerLock();
    hud.settings(settings, saveSettings);
    $("gmSet").hidden = false;
  };
  $("gsDone").onclick = () => { $("gmSet").hidden = true; };
  addEventListener("beforeunload", () => { try { peer && peer.destroy(); } catch { /* */ } });

  return {
    open, leave, update,
    get active() { return active; },
    debug: () => ({ G, myId, isHost, code, L, offset, buf: [...buf.keys()], avatars: avatars.size,
      av: [...avatars].map(([id, a]) => ({ id, x: a.g.position.x, y: -a.g.position.z, vis: a.g.visible })) }),
  };
}
