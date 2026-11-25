// Multiplayer for 2–4 players, right in the browser. Players connect peer-to-peer over WebRTC
// (PeerJS; its free public server only introduces the browsers to each other). The player who
// creates the room is the host: it keeps the score, health and timer and relays positions.
//
// Modes:  Shootout   – everyone for themselves, most takedowns wins.
//         Hide & Seek – one seeker counts while the rest hide; found players join the seekers.
import * as THREE from "three";

const COLORS = ["#e5483b", "#3b82f6", "#22c55e", "#f5b800"];
const DEFAULT_NAMES = ["Red", "Blue", "Green", "Yellow"];
const MODES = {
  dm: { name: "Shootout", info: "Everyone for themselves. 3 body shots or 2 headshots take someone down. Most takedowns in 5 minutes wins (or first to 10)." },
  hs: { name: "Hide & Seek", info: "One seeker counts to 30 while everyone hides anywhere on campus. Then the seeker has 3 minutes to find them (one shot = found). Found players become seekers too." },
};
const DM_TIME = 300e3, DM_TARGET = 10, HIDE_TIME = 30e3, SEEK_TIME = 180e3, OVER_TIME = 8e3, RESPAWN = 3000;
const FIRE_GAP = 0.22, RANGE = 140, TICK = 66, MAX_PLAYERS = 4;
const PEERJS = ["https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js", "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js"];
const ROOM_PREFIX = "dit3d-room-";

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
const clean = (s) => String(s || "").replace(/[<>&"']/g, "").trim().slice(0, 14);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ---------- sound (generated, no files) ----------
let ac = null;
function zap(vol = 0.22, pitch = 900) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(pitch, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.13);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + 0.16);
  } catch { /* audio blocked */ }
}

// ---------- avatars ----------
function nameSprite(text, color) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const g = c.getContext("2d");
  g.font = "600 30px Outfit, system-ui, sans-serif";
  const w = Math.min(244, g.measureText(text).width + 34);
  g.fillStyle = "rgba(18,26,38,0.78)";
  g.beginPath(); g.roundRect((256 - w) / 2, 10, w, 44, 22); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc((256 - w) / 2 + 18, 32, 7, 0, 7); g.fill();
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 128 + 8, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(2.6, 0.65, 1);
  s.position.y = 2.25;
  return s;
}
function makeAvatar(color, name) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 });
  const body = mat(color), skin = mat("#c08a62"), dark = mat("#1e222b"), jeans = mat("#2b3445");
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; return b; };
  g.add(box(0.28, 0.6, 0.5, body, 0, 1.17, 0));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), skin); head.position.y = 1.64; head.castShadow = true; g.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 14), mat("#d62828")); cap.position.y = 1.75; cap.visible = false; g.add(cap);
  const brim = box(0.2, 0.03, 0.3, cap.material, 0.13, 1.71, 0); brim.visible = false; g.add(brim);
  // arms forward holding a blaster
  g.add(box(0.42, 0.11, 0.11, body, 0.2, 1.3, 0.22), box(0.42, 0.11, 0.11, body, 0.2, 1.3, -0.22));
  g.add(box(0.55, 0.12, 0.09, dark, 0.45, 1.33, 0.05));
  const legs = [];
  for (const z of [0.12, -0.12]) {
    const pivot = new THREE.Group(); pivot.position.set(0, 0.88, z);
    pivot.add(box(0.17, 0.86, 0.18, jeans, 0, -0.43, 0));
    g.add(pivot); legs.push(pivot);
  }
  const label = nameSprite(name, color);
  g.add(label);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.85, 8), new THREE.MeshBasicMaterial());
  hit.position.y = 0.93; hit.visible = false;
  g.add(hit);
  return { g, legs, cap: [cap, brim], label, hit, x: null, y: 0, yaw: 0, phase: 0, name, color };
}

/** First-person blaster attached to the camera. */
function makeViewGun() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: "#2a2f3a", roughness: 0.5, metalness: 0.4 });
  const glow = new THREE.MeshBasicMaterial({ color: "#f2c062", toneMapped: false });
  const add = (w, h, d, x, y, z, mm = m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mm); b.position.set(x, y, z); g.add(b); return b; };
  add(0.07, 0.09, 0.42, 0, 0, 0);
  add(0.045, 0.045, 0.22, 0, 0.02, -0.3);
  add(0.06, 0.14, 0.07, 0, -0.1, 0.1);
  add(0.075, 0.015, 0.2, 0, 0.052, -0.02, glow);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffe39a", toneMapped: false }));
  flash.position.set(0, 0.02, -0.44); flash.visible = false; g.add(flash);
  g.scale.setScalar(0.32);
  g.position.set(0.1, -0.085, -0.3);
  g.userData.flash = flash;
  g.traverse((o) => { o.renderOrder = 10; if (o.material) o.material.depthTest = false; });
  return g;
}

export function createGame(ctx) {
  const { scene, camera, canvas, walk, world, data, enterWalk, exitWalk, toast, isTouch } = ctx;
  const $ = (id) => document.getElementById(id);
  const B = data.boundary && data.boundary.length > 2 ? data.boundary : null;
  const inCampus = (p) => !B || pointIn(p, B);

  // spawn candidates: open road points spread across the campus
  let spots = null;
  function spawnSpots() {
    if (spots) return spots;
    spots = [];
    for (const r of data.roads) for (const p of r.pts) {
      if (!inCampus(p) || spots.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 18)) continue;
      const o = walk.findOpen(p[0], p[1], 3);
      if (inCampus(o)) spots.push(o);
    }
    if (!spots.length) spots.push([0, 0]);
    return spots;
  }
  function pickSpot(avoid = []) {
    const S = spawnSpots();
    let best = S[0], bd = -1;
    for (let k = 0; k < 10; k++) {
      const s = S[Math.floor(Math.random() * S.length)];
      const d = avoid.length ? Math.min(...avoid.map((a) => Math.hypot(a[0] - s[0], a[1] - s[1]))) : Math.random();
      if (d > bd) { bd = d; best = s; }
    }
    return [best[0], best[1], Math.random() * Math.PI * 2];
  }
  function hsCenter() {
    const lawn = data.features.find((f) => f.kind === "lawn") || data.features.find((f) => f.kind !== "parking") || data.features[0];
    return lawn ? lawn.c : [0, 0];
  }
  function ringSpot(c, i) {
    const a = i * Math.PI / 2;
    const p = walk.findOpen(c[0] + Math.cos(a) * 3, c[1] + Math.sin(a) * 3, 2);
    return [p[0], p[1], a + Math.PI / 2];
  }

  // ---------- state ----------
  let peer = null, conn = null, isHost = false, myId = null, code = null, active = false;
  const conns = new Map();
  let G = null, endLocal = 0, lastHp = 100, lastPhase = null, lastRole = "";
  const pos = new Map();      // id -> [x, y, yaw, pitch]
  const avatars = new Map();  // id -> avatar
  const tracers = [];
  let H = null, respawns = [], timers = [];
  let fireCd = 0, firing = false, prevPos = null;
  const gun = makeViewGun();
  gun.visible = false;
  camera.add(gun);
  if (!camera.parent) scene.add(camera);

  // ---------- networking ----------
  function bc(msg, except) {
    for (const [id, c] of conns) if (id !== except && c.open) { try { c.send(msg); } catch { /* closing */ } }
    if (except !== myId) onNet(msg);
  }
  function toHost(msg) {
    if (isHost) hostHandle(myId, msg);
    else if (conn && conn.open) { try { conn.send(msg); } catch { /* closing */ } }
  }

  // ---------- host logic ----------
  const now = () => performance.now();
  function addPlayer(id, name) {
    const used = new Set(Object.values(H.players).map((p) => p.c));
    let c = 0; while (used.has(c)) c++;
    H.players[id] = { name: clean(name) || DEFAULT_NAMES[c], c, hp: 100, score: 0, alive: true,
      role: H.mode === "hs" && H.phase !== "lobby" ? "seeker" : "" };
  }
  function pushG() {
    const { end, ...rest } = H;
    bc({ t: "g", g: { ...rest, rem: Math.max(0, end - now()) } });
  }
  function feed(text) { bc({ t: "ev", text }); }
  function sendSpawn(id, s) { bc({ t: "spawn", id, x: s[0], y: s[1], yaw: s[2] }); }
  function otherPositions(id) { return [...pos.entries()].filter(([k]) => k !== id && H.players[k]).map(([, p]) => p); }

  function hostHandle(id, m) {
    if (m.t === "hello") {
      if (!H.players[id]) {
        if (Object.keys(H.players).length >= MAX_PLAYERS) { const c = conns.get(id); if (c) { c.send({ t: "full" }); setTimeout(() => c.close(), 300); } return; }
        addPlayer(id, m.name);
        feed(`${H.players[id].name} joined`);
      }
      pushG();
      sendSpawn(id, H.mode === "hs" && H.phase !== "lobby" ? ringSpot(hsCenter(), 0) : pickSpot(otherPositions(id)));
      return;
    }
    const P = H.players[id];
    if (!P) return;
    if (m.t === "st") pos.set(id, m.p);
    else if (m.t === "fire") {
      bc({ t: "fx", id, o: m.o, e: m.e }, id);
      if (m.hit) hostHit(id, m.hit, m.head);
    }
  }
  function hostHit(from, to, head) {
    const A = H.players[from], V = H.players[to];
    if (!A || !V || from === to || !A.alive || !V.alive || H.phase !== "play") return;
    if (H.mode === "dm") {
      V.hp -= head ? 60 : 34;
      if (V.hp <= 0) {
        V.hp = 0; V.alive = false; A.score++;
        feed(`${A.name} took down ${V.name}${head ? " · headshot" : ""}`);
        bc({ t: "down", id: to, by: from });
        respawns.push({ id: to, at: now() + RESPAWN });
        if (A.score >= DM_TARGET) return endRound();
      }
    } else {
      if (A.role !== "seeker" || V.role !== "hider") return;
      V.role = "seeker"; A.score++;
      feed(`${A.name} found ${V.name}!`);
      bc({ t: "found", id: to, by: from });
      if (!Object.values(H.players).some((p) => p.role === "hider")) return endRound();
    }
    pushG();
  }
  function startRound() {
    const ids = Object.keys(H.players);
    if (ids.length < 2) { toast("You need at least 2 players. Share the invite link."); return; }
    respawns = [];
    for (const id of ids) Object.assign(H.players[id], { hp: 100, score: 0, alive: true, role: "" });
    if (H.mode === "dm") {
      H.phase = "play"; H.end = now() + DM_TIME;
      const used = [];
      for (const id of ids) { const s = pickSpot(used); used.push(s); sendSpawn(id, s); }
      feed("Shootout! Most takedowns wins.");
    } else {
      const seeker = ids[Math.floor(Math.random() * ids.length)];
      for (const id of ids) H.players[id].role = id === seeker ? "seeker" : "hider";
      H.phase = "hide"; H.end = now() + HIDE_TIME;
      const c = hsCenter();
      ids.forEach((id, i) => sendSpawn(id, ringSpot(c, i)));
      feed(`${H.players[seeker].name} is the seeker. Everyone else: hide!`);
    }
    H.msg = "";
    pushG();
  }
  function endRound() {
    const ps = Object.values(H.players);
    let msg;
    if (H.mode === "dm") {
      const top = Math.max(0, ...ps.map((p) => p.score));
      const w = ps.filter((p) => p.score === top);
      msg = top === 0 ? "Round over. Nobody scored!" : w.length > 1 ? `Draw between ${w.map((p) => p.name).join(" & ")}` : `${w[0].name} wins with ${top} takedowns!`;
    } else {
      const left = ps.filter((p) => p.role === "hider");
      msg = left.length ? `Hiders win! ${left.map((p) => p.name).join(" & ")} stayed hidden.` : "The seekers found everyone!";
      for (const p of left) p.score += 3;
    }
    H.phase = "over"; H.end = now() + OVER_TIME; H.msg = msg;
    respawns = [];
    for (const p of ps) { p.alive = true; p.hp = 100; }
    pushG();
  }
  function hostTick() {
    const t = now();
    if (H.phase === "hide" && t >= H.end) { H.phase = "play"; H.end = t + SEEK_TIME; feed("Ready or not, here comes the seeker!"); pushG(); }
    else if (H.phase === "play" && t >= H.end) endRound();
    else if (H.phase === "over" && t >= H.end) { H.phase = "lobby"; H.msg = ""; for (const p of Object.values(H.players)) p.role = ""; pushG(); }
    for (const r of respawns.splice(0)) {
      if (t < r.at) { respawns.push(r); continue; }
      const P = H.players[r.id]; if (!P) continue;
      P.alive = true; P.hp = 100;
      sendSpawn(r.id, pickSpot(otherPositions(r.id)));
      pushG();
    }
    const s = {};
    for (const [id, p] of pos) if (H.players[id]) s[id] = p;
    for (const c of conns.values()) if (c.open) { try { c.send({ t: "ss", s }); } catch { /* closing */ } }
    if (++hostTick.n % 30 === 0 && H.phase !== "lobby") pushG(); // keep timers in sync
  }
  hostTick.n = 0;
  function hostDrop(id) {
    conns.delete(id);
    pos.delete(id);
    const P = H.players[id];
    if (!P) return;
    delete H.players[id];
    feed(`${P.name} left`);
    if (H.mode === "hs" && (H.phase === "hide" || H.phase === "play")) {
      const ps = Object.values(H.players);
      if (!ps.some((p) => p.role === "hider") || !ps.some((p) => p.role === "seeker")) return endRound();
    }
    pushG();
  }

  // ---------- client side (everyone, host included) ----------
  const me = () => (G && G.players[myId]) || null;
  function onNet(m) {
    if (m.t === "g") {
      G = m.g; endLocal = now() + G.rem;
      refreshUI();
    } else if (m.t === "ss") {
      for (const id in m.s) if (id !== myId) pos.set(id, m.s[id]);
    } else if (m.t === "fx") {
      addTracer(new THREE.Vector3(...m.o), new THREE.Vector3(...m.e));
      const d = camera.position.distanceTo(new THREE.Vector3(...m.o));
      zap(Math.max(0.02, 0.18 - d / 600), 650);
    } else if (m.t === "spawn") {
      pos.set(m.id, [m.x, m.y, m.yaw, 0]);
      const a = avatars.get(m.id); if (a) a.x = null; // snap, don't glide across campus
      if (m.id === myId) { walk.setPos(m.x, m.y, m.yaw); prevPos = [m.x, m.y]; }
    } else if (m.t === "down") {
      if (m.id === myId) big(`Taken down by ${nameOf(m.by)}. Back in ${RESPAWN / 1000} s…`, RESPAWN);
      else if (m.by === myId) { big(`You took down ${nameOf(m.id)}!`, 1600); hitMark(true); }
    } else if (m.t === "found") {
      if (m.id === myId) big(`${nameOf(m.by)} found you! Now you're a seeker too.`, 2600);
      else if (m.by === myId) big(`Found ${nameOf(m.id)}!`, 1600);
    } else if (m.t === "ev") {
      const li = document.createElement("div");
      li.textContent = m.text;
      $("mpFeed").prepend(li);
      setTimeout(() => li.remove(), 6000);
      while ($("mpFeed").children.length > 4) $("mpFeed").lastChild.remove();
    } else if (m.t === "full") {
      toast("That room is full (4 players max).");
      leave();
    }
  }
  const nameOf = (id) => (G && G.players[id] ? G.players[id].name : "Someone");

  // ---------- UI ----------
  let bigT = 0;
  function big(text, ms = 2200) {
    const el = $("mpBig");
    el.textContent = text; el.hidden = false;
    clearTimeout(bigT); bigT = setTimeout(() => (el.hidden = true), ms);
  }
  function hitMark(kill = false) {
    const el = $("mpHit");
    el.classList.remove("on", "kill"); void el.offsetWidth;
    el.classList.add("on"); if (kill) el.classList.add("kill");
  }
  function refreshUI() {
    if (!G) return;
    const M = me();
    // damage flash
    if (M && G.mode === "dm" && M.hp < lastHp && G.phase === "play") {
      const d = $("mpDmg"); d.classList.remove("on"); void d.offsetWidth; d.classList.add("on");
      zap(0.12, 220);
    }
    lastHp = M ? M.hp : 100;
    // phase changes
    if (G.phase !== lastPhase) {
      if (G.phase === "play" && G.mode === "dm") big("Shootout! Most takedowns wins.");
      if (G.phase === "hide") big(M && M.role === "seeker" ? "You are the seeker! Counting to 30…" : "Hide! The seeker comes in 30 seconds.", 3500);
      if (G.phase === "play" && G.mode === "hs") big(M && M.role === "seeker" ? "Go find them!" : "Here comes the seeker. Stay hidden!");
      if (G.phase === "over") big(G.msg, OVER_TIME - 500);
      lastPhase = G.phase;
    }
    if (M && M.role !== lastRole) lastRole = M.role;

    // lobby card
    $("mpLobby").hidden = G.phase !== "lobby";
    $("mpCode").textContent = code;
    const ids = Object.keys(G.players);
    $("mpPlayers").innerHTML = ids.map((id) => {
      const p = G.players[id];
      return `<li><i style="background:${COLORS[p.c]}"></i>${esc(p.name)}${id === myId ? " <span class='muted'>(you)</span>" : ""}${isHost && id === myId ? " <span class='muted'>· host</span>" : ""}</li>`;
    }).join("") + (ids.length < MAX_PLAYERS ? `<li class="muted">${MAX_PLAYERS - ids.length} more can join</li>` : "");
    for (const b of $("mpModes").children) { b.classList.toggle("on", b.dataset.mode === G.mode); b.disabled = !isHost; }
    $("mpModeInfo").textContent = MODES[G.mode].info;
    $("mpStartGame").hidden = !isHost;
    $("mpStartGame").disabled = ids.length < 2;
    $("mpWait").textContent = isHost ? (ids.length < 2 ? "Waiting for friends to join. Walk around meanwhile!" : "") : "Waiting for the host to start. Walk around meanwhile!";

    // scoreboard
    const sorted = ids.slice().sort((a, b) => G.players[b].score - G.players[a].score);
    $("mpScore").innerHTML = `<b>${MODES[G.mode].name}</b>` + sorted.map((id) => {
      const p = G.players[id];
      const extra = G.phase === "lobby" ? "" : G.mode === "dm" ? (p.alive ? `${p.hp}♥` : "down") : p.role === "seeker" ? "seeker" : "hiding";
      return `<div class="${id === myId ? "me" : ""}"><i style="background:${COLORS[p.c]}"></i><span>${esc(p.name)}</span><em>${extra}</em><b>${p.score}</b></div>`;
    }).join("");

    // health / role bar
    $("mpHpBox").hidden = !M || G.phase === "lobby";
    if (M) {
      $("mpHpFill").style.width = (G.mode === "dm" ? M.hp : 100) + "%";
      $("mpHpFill").style.background = G.mode === "hs" ? (M.role === "seeker" ? "#e5483b" : "#22c55e") : M.hp > 50 ? "#22c55e" : M.hp > 25 ? "#f5b800" : "#e5483b";
      $("mpRole").textContent = G.mode === "dm" ? `${M.hp} HP` : M.role === "seeker" ? "Seeker: find everyone" : "Hider: stay out of sight";
    }
    // avatars that left
    for (const [id, a] of avatars) if (!G.players[id]) { scene.remove(a.g); avatars.delete(id); }
  }
  function canShoot() {
    const M = me();
    if (!G || !M || !M.alive) return false;
    if (G.phase === "lobby") return true; // practice
    if (G.phase !== "play") return false;
    return G.mode === "dm" || M.role === "seeker";
  }

  // ---------- shooting ----------
  const ray = new THREE.Raycaster();
  const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  function addTracer(a, b) {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: "#ffd36b", transparent: true, opacity: 0.9, toneMapped: false }));
    m.scale.set(0.05, 0.05, len);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.lookAt(b);
    scene.add(m);
    tracers.push({ m, life: 0.14 });
  }
  function fire() {
    if (!canShoot() || fireCd > 0) return;
    fireCd = FIRE_GAP;
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    ray.far = RANGE;
    const wall = ray.intersectObjects(world.pickables, true)[0];
    const targets = [];
    const M = me();
    for (const [id, a] of avatars) {
      const P = G.players[id];
      if (!P || !P.alive || !a.g.visible) continue;
      if (G.phase === "play" && G.mode === "hs" && !(M.role === "seeker" && P.role === "hider")) continue;
      a.hit.userData.pid = id;
      targets.push(a.hit);
    }
    const hp = ray.intersectObjects(targets, false)[0];
    let end, hitId = null, head = false;
    if (hp && (!wall || hp.distance < wall.distance)) {
      end = hp.point; hitId = hp.object.userData.pid;
      head = hp.point.y > 1.55;
      hitMark();
    } else end = wall ? wall.point : ray.ray.at(RANGE, new THREE.Vector3());
    const o = gun.userData.flash.getWorldPosition(new THREE.Vector3());
    addTracer(o, end);
    zap();
    gun.position.z = -0.27; gun.userData.flash.visible = true;
    setTimeout(() => (gun.userData.flash.visible = false), 50);
    toHost({ t: "fire", o: o.toArray().map((v) => +v.toFixed(2)), e: end.toArray().map((v) => +v.toFixed(2)), hit: G.phase === "play" ? hitId : null, head });
  }
  // desktop: click locks the mouse to aim, then click / hold to fire
  canvas.addEventListener("mousedown", (e) => {
    if (!active || isTouch || e.button !== 0) return;
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
    firing = true; fire();
  });
  addEventListener("mouseup", () => { firing = false; });
  addEventListener("keydown", (e) => {
    if (!active || e.target.closest?.("input, select, textarea")) return;
    if (e.code === "Space" || e.key === "f" || e.key === "F") { e.preventDefault(); if (!e.repeat) { firing = true; fire(); } }
  });
  addEventListener("keyup", (e) => { if (e.code === "Space" || e.key === "f" || e.key === "F") firing = false; });
  document.addEventListener("pointerlockchange", () => {
    if (!active) return;
    $("mpAim").hidden = document.pointerLockElement === canvas || isTouch;
  });
  const fb = $("mpFire");
  fb.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); firing = true; fire(); });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) fb.addEventListener(ev, () => { firing = false; });

  // ---------- per frame ----------
  let sendT = 0;
  function update(dt) {
    if (!active) return;
    const M = me();
    // freeze: dead, or seeker while the others hide
    const blind = !!(G && M && G.phase === "hide" && M.role === "seeker");
    walk.frozen = !!(G && M && (!M.alive || blind));
    $("mpBlind").hidden = !blind;
    if (blind) $("mpBlindT").textContent = Math.ceil(Math.max(0, endLocal - now()) / 1000);
    // keep players inside the campus wall
    const p = walk.pos;
    if (B && !inCampus(p) && prevPos) walk.setPos(prevPos[0], prevPos[1]);
    else prevPos = [p[0], p[1]];

    // own state out
    sendT += dt;
    if (sendT >= TICK / 1000) {
      sendT = 0;
      const s = [+walk.pos[0].toFixed(2), +walk.pos[1].toFixed(2), +walk.yaw.toFixed(3), +walk.pitch.toFixed(3)];
      pos.set(myId, s);
      if (!isHost) toHost({ t: "st", p: s });
    }

    // shooting
    fireCd = Math.max(0, fireCd - dt);
    if (firing && fireCd === 0) fire();
    gun.visible = canShoot();
    gun.position.z += (-0.3 - gun.position.z) * Math.min(1, dt * 14);
    $("mpFire").hidden = !isTouch || !canShoot();
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / 0.14);
      if (t.life <= 0) { scene.remove(t.m); t.m.material.dispose(); tracers.splice(i, 1); }
    }

    // other players
    if (G) {
      const iAmSeeker = M && M.role === "seeker" && G.mode === "hs" && G.phase !== "lobby";
      for (const id in G.players) {
        if (id === myId) continue;
        const P = G.players[id];
        let a = avatars.get(id);
        if (!a || a.name !== P.name) {
          if (a) scene.remove(a.g);
          a = makeAvatar(COLORS[P.c], P.name);
          avatars.set(id, a); scene.add(a.g);
        }
        const s = pos.get(id);
        a.g.visible = !!s && P.alive;
        if (!s) continue;
        if (a.x == null) { a.x = s[0]; a.y = s[1]; a.yaw = s[2]; }
        const k = Math.min(1, dt * 12);
        const ox = a.x, oy = a.y;
        a.x += (s[0] - a.x) * k; a.y += (s[1] - a.y) * k;
        let dy = s[2] - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        a.yaw += dy * k;
        const sp = Math.hypot(a.x - ox, a.y - oy) / Math.max(dt, 1e-3);
        a.phase += dt * Math.min(sp, 9) * 5;
        const sw = sp > 0.4 ? Math.sin(a.phase) * Math.min(0.6, sp * 0.12) : 0;
        a.legs[0].rotation.z = sw; a.legs[1].rotation.z = -sw;
        a.g.position.set(a.x, 0.1, -a.y);
        a.g.rotation.y = a.yaw + Math.PI / 2;
        const seeker = G.mode === "hs" && P.role === "seeker" && G.phase !== "lobby";
        a.cap[0].visible = a.cap[1].visible = seeker;
        a.label.visible = !(iAmSeeker && P.role === "hider");
      }
    }
    // HUD timer
    if (G) {
      const rem = Math.max(0, endLocal - now());
      $("mpTimer").textContent = G.phase === "lobby" ? "Lobby" : G.phase === "over" ? "Round over" : (G.phase === "hide" ? "Hide! " : "") + fmt(rem);
    }
  }

  // ---------- room setup ----------
  function status(t) { $("mpStatus").textContent = t; }
  function newCode() {
    const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join("");
  }
  async function getPeerLib() {
    status("Connecting…");
    try { await loadScript(PEERJS); }
    catch { status("Couldn't load the multiplayer library. Check your internet connection."); throw new Error("peerjs"); }
  }
  async function create() {
    const name = clean($("mpName").value);
    store(name);
    await getPeerLib();
    code = newCode();
    peer = new window.Peer(ROOM_PREFIX + code.toLowerCase());
    peer.on("open", (id) => {
      myId = id; isHost = true;
      H = { mode: "dm", phase: "lobby", end: 0, players: {}, msg: "" };
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
    const name = clean($("mpName").value);
    const c = $("mpJoinCode").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length !== 5) { status("Room codes have 5 letters."); return; }
    store(name);
    await getPeerLib();
    code = c;
    peer = new window.Peer();
    peer.on("open", (id) => {
      myId = id; isHost = false;
      conn = peer.connect(ROOM_PREFIX + code.toLowerCase(), { reliable: true });
      const to = setTimeout(() => { if (!active) status("No answer from that room. Check the code, or ask the host to keep their tab open."); }, 12000);
      conn.on("open", () => { clearTimeout(to); conn.send({ t: "hello", name }); begin(); });
      conn.on("data", (m) => { if (m && typeof m === "object") onNet(m); });
      conn.on("close", () => { if (active) { toast("The host left, so the game ended."); leave(); } });
    });
    peer.on("error", (e) => {
      if (!active) status(e.type === "peer-unavailable" ? "No room with that code. Check it and try again." : "Connection problem: " + (e.type || e.message));
    });
  }
  function store(name) { try { localStorage.setItem("dit-mpname", JSON.stringify(name)); } catch { /* private mode */ } }

  function begin() {
    active = true;
    $("mpStart").hidden = true;
    document.body.classList.add("gaming");
    $("mpHud").hidden = false;
    const c = hsCenter();
    const s = walk.findOpen(c[0] + (Math.random() - 0.5) * 8, c[1] + (Math.random() - 0.5) * 8, 3);
    enterWalk(s, Math.random() * 6.28);
    prevPos = [s[0], s[1]];
    const hint = $("walkHint");
    hint.textContent = isTouch ? "Joystick to move · drag to look · FIRE to shoot"
      : "Click to aim with the mouse · W A S D to move · Shift to run · click or Space to shoot · Esc frees the mouse";
    $("mpAim").hidden = isTouch;
    timers.push(setInterval(() => { if (isHost) hostTick(); }, TICK));
    history.replaceState(null, "", location.pathname + location.search.replace(/([?&])room=[^&]*&?/, "$1").replace(/[?&]$/, ""));
  }
  function leave() {
    if (!active && !peer) { $("mpStart").hidden = true; return; }
    active = false;
    for (const t of timers) clearInterval(t);
    timers = [];
    try { peer && peer.destroy(); } catch { /* already closed */ }
    peer = null; conn = null; conns.clear(); pos.clear(); G = null; H = null; lastPhase = null;
    for (const a of avatars.values()) scene.remove(a.g);
    avatars.clear();
    for (const t of tracers) scene.remove(t.m);
    tracers.length = 0;
    gun.visible = false; walk.frozen = false; firing = false;
    if (document.pointerLockElement) document.exitPointerLock();
    document.body.classList.remove("gaming");
    for (const id of ["mpHud", "mpLobby", "mpBlind", "mpStart"]) $(id).hidden = true;
    exitWalk();
  }
  function open(prefill) {
    if (active) return;
    let n = "";
    try { n = JSON.parse(localStorage.getItem("dit-mpname") || '""'); } catch { /* ignore */ }
    $("mpName").value = n;
    if (prefill) $("mpJoinCode").value = prefill;
    status("");
    $("mpStart").hidden = false;
  }

  // ---------- buttons ----------
  $("mpCreate").onclick = () => create().catch(() => {});
  $("mpJoin").onclick = () => join().catch(() => {});
  $("mpJoinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") join().catch(() => {}); });
  $("mpClose").onclick = () => { if (!active) { try { peer && peer.destroy(); } catch { /* */ } peer = null; } $("mpStart").hidden = true; };
  $("mpLeave").onclick = leave;
  $("mpLeaveBtn").onclick = leave;
  $("mpStartGame").onclick = () => { if (isHost) startRound(); };
  $("mpModes").addEventListener("click", (e) => {
    const m = e.target.dataset.mode;
    if (!m || !isHost || H.phase !== "lobby") return;
    H.mode = m; pushG();
  });
  $("mpCopy").onclick = async () => {
    const link = `${location.origin}${location.pathname}?room=${code}`;
    try { await navigator.clipboard.writeText(link); toast("Invite link copied. Send it to your friends!"); }
    catch { toast(link); }
  };
  addEventListener("beforeunload", () => { try { peer && peer.destroy(); } catch { /* */ } });

  const roomParam = new URLSearchParams(location.search).get("room");
  if (roomParam) setTimeout(() => open(roomParam.toUpperCase()), 300);

  return {
    open, leave, update,
    get active() { return active; },
    debug: () => ({ G, myId, isHost, code, pos: [...pos.entries()] }),
  };
}
