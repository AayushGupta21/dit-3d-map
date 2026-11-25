// First-person walk mode: eye-level camera, keyboard / joystick movement, drag to look,
// and simple collision so you can't walk through buildings.
import * as THREE from "three";

const EYE = 1.7, RADIUS = 1.0;
const WALK = 4.2, RUN = 9; // m/s (a bit faster than real life so exploring isn't tedious)

export function createWalk({ camera, canvas, data, joystickEl, knobEl }) {
  // Obstacles: campus buildings + surrounding houses, as polygons in data space [x east, y north].
  const polys = data.buildings.map((b) => b.pts);
  for (const [cx, cy, w, d, ang] of data.context || []) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const c = (u, v) => [cx + u * ca - v * sa, cy + u * sa + v * ca];
    polys.push([c(-w / 2, -d / 2), c(w / 2, -d / 2), c(w / 2, d / 2), c(-w / 2, d / 2)]);
  }
  const boxes = polys.map((p) => {
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    return { p, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });
  const ext = data.extent;

  const st = {
    active: false, pos: [0, 0], yaw: 0, pitch: -0.05, bob: 0,
    keys: new Set(), joy: { x: 0, y: 0, id: null }, look: null, frozen: false, lockLook: false,
    // game mode extras: crouch / jump / sprint control and look tuning
    game: false, crouchBtn: false, crouch: false, eye: EYE, jy: 0, vy: 0, jumpReq: false, landed: false,
    speedMul: 1, canRun: true, running: false, moving: false, lookMul: 1, invertY: false,
  };

  // ---------- collision ----------
  function inside(x, y, p) {
    let ins = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) ins = !ins;
    }
    return ins;
  }
  function nearestEdge(x, y, p) {
    let best = null;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1e-9)));
      const qx = a[0] + dx * t, qy = a[1] + dy * t;
      const d = Math.hypot(x - qx, y - qy);
      if (!best || d < best.d) best = { d, qx, qy };
    }
    return best;
  }
  /** Push a point out of any building it is in or too close to. */
  function resolve(x, y) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const bx of boxes) {
        if (x < bx.minX - 1 || x > bx.maxX + 1 || y < bx.minY - 1 || y > bx.maxY + 1) continue;
        const ins = inside(x, y, bx.p);
        const e = nearestEdge(x, y, bx.p);
        if (!ins && e.d >= RADIUS) continue;
        // direction from the edge point outwards
        let nx = x - e.qx, ny = y - e.qy;
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        if (ins) { nx = -nx; ny = -ny; }
        if (!isFinite(nx) || (nx === 0 && ny === 0)) { nx = 1; ny = 0; }
        x = e.qx + nx * (RADIUS + 0.01);
        y = e.qy + ny * (RADIUS + 0.01);
        moved = true;
      }
      if (!moved) break;
    }
    x = Math.min(ext.maxX - 2, Math.max(ext.minX + 2, x));
    y = Math.min(ext.maxY - 2, Math.max(ext.minY + 2, y));
    return [x, y];
  }

  /** Distance to the nearest building wall (0 if inside one). */
  function clearance(x, y) {
    let best = Infinity;
    for (const bx of boxes) {
      if (x < bx.minX - best || x > bx.maxX + best || y < bx.minY - best || y > bx.maxY + best) continue;
      if (inside(x, y, bx.p)) return 0;
      best = Math.min(best, nearestEdge(x, y, bx.p).d);
    }
    return best;
  }
  /** Nearest spot to (x, y) with some open space around it, so you never start nose-to-wall. */
  function findOpen(x, y, need = 6) {
    if (clearance(x, y) >= need) return [x, y];
    for (let r = 3; r <= 90; r += 3) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (clearance(px, py) >= need) return [px, py];
      }
    }
    return resolve(x, y);
  }

  // ---------- input ----------
  const onKey = (down) => (e) => {
    if (!st.active || e.target.closest?.("input, select, textarea")) return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", "q", "e"].includes(k)
      || (st.game && ["c", "control", " "].includes(k))) {
      e.preventDefault();
      if (k === " " && down && !e.repeat) st.jumpReq = true;
      down ? st.keys.add(k) : st.keys.delete(k);
    }
  };
  addEventListener("keydown", onKey(true));
  addEventListener("keyup", onKey(false));
  addEventListener("blur", () => st.keys.clear());

  canvas.addEventListener("pointerdown", (e) => {
    if (!st.active) return;
    st.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  addEventListener("pointermove", (e) => {
    if (!st.active || !st.look || e.pointerId !== st.look.id) return;
    const dx = e.clientX - st.look.x, dy = e.clientY - st.look.y;
    st.look.x = e.clientX; st.look.y = e.clientY;
    const k = (e.pointerType === "touch" ? 0.006 : 0.0035) * st.lookMul;
    st.yaw -= dx * k;
    st.pitch = Math.max(-1.25, Math.min(1.25, st.pitch - dy * k * (st.invertY ? -1 : 1)));
  });
  // mouse-locked look (game mode on desktop): no button needed
  addEventListener("mousemove", (e) => {
    if (!st.active || document.pointerLockElement !== canvas) return;
    st.yaw -= e.movementX * 0.0022 * st.lookMul;
    st.pitch = Math.max(-1.25, Math.min(1.25, st.pitch - e.movementY * 0.0022 * st.lookMul * (st.invertY ? -1 : 1)));
    st.lockLook = true;
  });
  const endLook = (e) => { if (st.look && e.pointerId === st.look.id) st.look = null; };
  addEventListener("pointerup", endLook);
  addEventListener("pointercancel", endLook);

  // on-screen joystick (phones, but also usable with a mouse)
  const R = 46;
  joystickEl.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    st.joy.id = e.pointerId;
    try { joystickEl.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    moveJoy(e);
  });
  joystickEl.addEventListener("pointermove", (e) => { if (e.pointerId === st.joy.id) moveJoy(e); });
  const endJoy = (e) => {
    if (e.pointerId !== st.joy.id) return;
    st.joy = { x: 0, y: 0, id: null };
    knobEl.style.transform = "translate(-50%, -50%)";
  };
  joystickEl.addEventListener("pointerup", endJoy);
  joystickEl.addEventListener("pointercancel", endJoy);
  function moveJoy(e) {
    const r = joystickEl.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const l = Math.hypot(x, y);
    if (l > R) { x *= R / l; y *= R / l; }
    st.joy.x = x / R; st.joy.y = y / R;
    knobEl.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  // ---------- public ----------
  function enter(start, yaw) {
    st.active = true;
    st.pos = findOpen(start[0], start[1]);
    st.yaw = yaw; st.pitch = 0.12;
    st.keys.clear();
    camera.fov = 68; camera.near = 0.2; camera.updateProjectionMatrix();
    apply();
  }
  function exit() {
    st.active = false; st.keys.clear(); st.look = null;
    st.game = false; st.crouchBtn = false; st.crouch = false; st.eye = EYE; st.jy = 0; st.vy = 0;
    st.speedMul = 1; st.canRun = true; st.lookMul = 1; st.invertY = false;
    camera.fov = 42; camera.near = 1; camera.updateProjectionMatrix();
  }
  function apply() {
    const bob = Math.sin(st.bob) * 0.04;
    camera.position.set(st.pos[0], st.eye + st.jy + bob, -st.pos[1]);
    const dir = new THREE.Vector3(
      -Math.sin(st.yaw) * Math.cos(st.pitch),
      Math.sin(st.pitch),
      -Math.cos(st.yaw) * Math.cos(st.pitch));
    camera.lookAt(camera.position.clone().add(dir));
  }
  /** Advance one frame. Returns true if the view changed. */
  function update(dt) {
    if (!st.active) return false;
    const k = st.keys;
    let f = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0) - st.joy.y;
    let s = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0) + st.joy.x;
    const turn = (k.has("arrowleft") || k.has("q") ? 1 : 0) - (k.has("arrowright") || k.has("e") ? 1 : 0);
    if (turn) st.yaw += turn * 1.8 * dt;
    const l = Math.hypot(f, s);
    if (l > 1) { f /= l; s /= l; }
    const moving = l > 0.05;
    // crouch / jump (game mode only)
    let vert = false;
    st.crouch = st.game && !st.frozen && (k.has("c") || k.has("control") || st.crouchBtn);
    const eyeT = st.crouch ? 1.12 : EYE;
    if (Math.abs(st.eye - eyeT) > 0.002) { st.eye += (eyeT - st.eye) * Math.min(1, dt * 12); vert = true; }
    if (st.jumpReq && st.game && st.jy === 0 && !st.frozen) st.vy = 4.6;
    st.jumpReq = false;
    if (st.jy > 0 || st.vy > 0) {
      st.vy -= 13 * dt;
      st.jy = Math.max(0, st.jy + st.vy * dt);
      if (st.jy === 0) { st.vy = 0; st.landed = true; }
      vert = true;
    }
    st.moving = moving && !st.frozen;
    st.running = st.moving && !st.crouch && st.canRun && f > 0.3 && (k.has("shift") || Math.hypot(st.joy.x, st.joy.y) > 0.95);
    if (moving && !st.frozen) {
      const base = st.game ? (st.running ? 6.6 : WALK) : (k.has("shift") || Math.hypot(st.joy.x, st.joy.y) > 0.95 ? RUN : WALK);
      const speed = base * st.speedMul * (st.crouch ? 0.5 : 1) * (st.jy > 0 ? 0.85 : 1) * dt;
      // forward in data space: yaw 0 looks north (+y)
      const fx = -Math.sin(st.yaw), fy = Math.cos(st.yaw);
      const rx = Math.cos(st.yaw), ry = Math.sin(st.yaw);
      const nx = st.pos[0] + (fx * f + rx * s) * speed;
      const ny = st.pos[1] + (fy * f + ry * s) * speed;
      st.pos = resolve(nx, ny);
      st.bob += dt * (speed / dt > WALK ? 13 : 9);
    }
    const looking = !!st.look || st.lockLook;
    st.lockLook = false;
    if ((moving && !st.frozen) || looking || turn || vert) { apply(); return true; }
    return false;
  }

  /** Put the walker somewhere (game spawns / staying inside the campus). */
  function setPos(x, y, yaw) {
    st.pos = [x, y];
    if (yaw != null) { st.yaw = yaw; st.pitch = 0; }
    apply();
  }
  return {
    enter, exit, update, resolve, findOpen, setPos, clearance,
    get pitch() { return st.pitch; },
    /** Re-place the camera from the walker state (game mode does this every frame, then adds shake). */
    refresh: apply,
    /** Kick the view (weapon recoil). */
    addLook(dYaw, dPitch) { st.yaw += dYaw; st.pitch = Math.max(-1.25, Math.min(1.25, st.pitch + dPitch)); },
    jump() { st.jumpReq = true; },
    takeLanding() { const l = st.landed; st.landed = false; return l; },
    get game() { return st.game; }, set game(v) { st.game = v; },
    get crouch() { return st.crouch; },
    set crouchBtn(v) { st.crouchBtn = v; }, get crouchBtn() { return st.crouchBtn; },
    get jy() { return st.jy; },
    get eye() { return st.eye + st.jy; },
    get running() { return st.running; },
    get moving() { return st.moving; },
    set speedMul(v) { st.speedMul = v; },
    set canRun(v) { st.canRun = v; },
    set lookMul(v) { st.lookMul = v; },
    set invertY(v) { st.invertY = v; },
    get frozen() { return st.frozen; },
    set frozen(v) { st.frozen = v; if (v) st.keys.clear(); },
    get active() { return st.active; },
    get pos() { return st.pos; },
    get yaw() { return st.yaw; },
  };
}
