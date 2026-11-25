// Weapon stats, first-person models and their procedural animation (sway, bob, recoil,
// reload, switch, aim-down-sights). Models are built from primitives so they cost no downloads.
import * as THREE from "three";

// spread values are radians of cone half-angle; recoil in radians of view kick per shot
export const WEAPONS = [
  { id: "pistol", name: "Pistol", key: "1", auto: false, dmg: 26, head: 2.0, rate: 0.16, mag: 12, reserve: 72, reload: 1.3, pellets: 1,
    spread: { hip: 0.016, ads: 0.003, move: 0.02, air: 0.06 }, bloom: 0.012, recoil: { v: 0.022, h: 0.006 }, falloff: [25, 70, 0.6], range: 150, fov: 56, speed: 1.0 },
  { id: "rifle", name: "Rifle", key: "2", auto: true, dmg: 20, head: 1.8, rate: 0.1, mag: 30, reserve: 120, reload: 2.0, pellets: 1,
    spread: { hip: 0.03, ads: 0.006, move: 0.025, air: 0.07 }, bloom: 0.006, recoil: { v: 0.016, h: 0.01 }, falloff: [40, 100, 0.7], range: 200, fov: 48, speed: 0.95 },
  { id: "shotgun", name: "Shotgun", key: "3", auto: false, dmg: 12, head: 1.5, rate: 0.85, mag: 6, reserve: 30, reload: 2.4, pellets: 8,
    spread: { hip: 0.075, ads: 0.055, move: 0.02, air: 0.04 }, bloom: 0, recoil: { v: 0.07, h: 0.02 }, falloff: [8, 28, 0.15], range: 60, fov: 60, speed: 0.95 },
  { id: "sniper", name: "Sniper", key: "4", auto: false, dmg: 75, head: 2.5, rate: 1.25, mag: 5, reserve: 20, reload: 2.7, pellets: 1,
    spread: { hip: 0.07, ads: 0.0, move: 0.05, air: 0.1 }, bloom: 0, recoil: { v: 0.08, h: 0.015 }, falloff: [400, 500, 1], range: 400, fov: 16, speed: 0.88, scope: true },
];
export const weaponIndex = (id) => WEAPONS.findIndex((w) => w.id === id);

/** Damage multiplier for distance. */
export function falloff(w, d) {
  const [a, b, m] = w.falloff;
  return d <= a ? 1 : d >= b ? m : 1 - (1 - m) * ((d - a) / (b - a));
}

// ---------- models ----------
const MAT = {};
function mat(c, rough = 0.55, metal = 0.35) {
  const k = c + rough + metal;
  return MAT[k] || (MAT[k] = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal }));
}
function add(g, geo, m, x, y, z, rx = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z); o.rotation.x = rx;
  g.add(o); return o;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r, l, s = 10) => { const c = new THREE.CylinderGeometry(r, r, l, s); c.rotateX(Math.PI / 2); return c; };

/** A gun pointing down -Z, origin at the grip. Returns { g, muzzle, eject }. */
export function buildGun(id, hands = null) {
  const g = new THREE.Group();
  const dark = mat("#262a31"), black = mat("#15171b", 0.7, 0.2), tan = mat("#8a7a5c", 0.8, 0.05), wood = mat("#6b4423", 0.7, 0.05), steel = mat("#4b525c", 0.35, 0.8);
  let mz = -0.2;
  if (id === "pistol") {
    add(g, box(0.034, 0.034, 0.19), dark, 0, 0.05, -0.06);
    add(g, box(0.03, 0.11, 0.045), black, 0, -0.01, 0.01, 0.25);
    add(g, box(0.026, 0.02, 0.06), black, 0, 0.022, -0.05);
    add(g, box(0.006, 0.012, 0.01), steel, 0, 0.072, -0.14);
    mz = -0.16;
  } else if (id === "rifle") {
    add(g, box(0.05, 0.07, 0.3), dark, 0, 0.04, -0.12);
    add(g, cyl(0.012, 0.3), steel, 0, 0.055, -0.42);
    add(g, box(0.056, 0.055, 0.2), tan, 0, 0.05, -0.33);
    add(g, box(0.034, 0.13, 0.06), black, 0, -0.04, -0.13, -0.2);
    add(g, box(0.03, 0.1, 0.045), black, 0, -0.03, 0.01, 0.3);
    add(g, box(0.042, 0.07, 0.2), tan, 0, 0.03, 0.11);
    add(g, box(0.02, 0.025, 0.12), black, 0, 0.088, -0.12);
    mz = -0.57;
  } else if (id === "shotgun") {
    add(g, box(0.052, 0.065, 0.22), dark, 0, 0.04, -0.08);
    add(g, cyl(0.017, 0.5), steel, 0, 0.06, -0.42);
    add(g, cyl(0.016, 0.4), black, 0, 0.025, -0.38);
    add(g, box(0.05, 0.05, 0.15), wood, 0, 0.022, -0.32);
    add(g, box(0.035, 0.09, 0.05), wood, 0, -0.03, 0.04, 0.35);
    add(g, box(0.042, 0.075, 0.22), wood, 0, 0.02, 0.17);
    mz = -0.67;
  } else {
    add(g, box(0.048, 0.06, 0.32), dark, 0, 0.04, -0.06);
    add(g, cyl(0.013, 0.62), steel, 0, 0.05, -0.52);
    add(g, cyl(0.026, 0.28), black, 0, 0.115, -0.08);
    add(g, cyl(0.032, 0.05), black, 0, 0.115, -0.24);
    add(g, box(0.01, 0.01, 0.06), steel, 0.04, 0.05, 0.03);
    add(g, box(0.034, 0.1, 0.05), black, 0, -0.02, 0.05, 0.3);
    add(g, box(0.045, 0.08, 0.26), wood, 0, 0.02, 0.24);
    mz = -0.84;
  }
  if (hands) {
    // first-person hands and sleeves holding the gun
    const skin = mat("#c08a62", 0.8, 0), sleeve = mat(hands, 0.85, 0);
    add(g, box(0.055, 0.075, 0.1), skin, 0.005, -0.03, 0.035);
    const ra = add(g, box(0.075, 0.075, 0.42), sleeve, 0.05, -0.1, 0.25); ra.rotation.set(0.35, -0.25, 0);
    const fz = id === "pistol" ? 0.0 : mz * 0.55;
    add(g, box(0.06, 0.05, 0.09), skin, id === "pistol" ? -0.02 : -0.005, id === "pistol" ? -0.035 : 0.0, fz);
    const la = add(g, box(0.075, 0.075, 0.5), sleeve, -0.1, -0.12, fz + 0.27); la.rotation.set(0.3, 0.45, 0);
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.055, mz); g.add(muzzle);
  const eject = new THREE.Object3D(); eject.position.set(0.03, 0.06, -0.06); g.add(eject);
  return { g, muzzle, eject };
}

/**
 * First-person weapon: owns the four view models on the camera and animates them.
 * State fed in each frame: { moving, running, crouch, air, ads, lookDX, lookDY }.
 */
export function createViewModel(camera, sleeve = "#3b4a63") {
  const root = new THREE.Group();
  camera.add(root);
  const guns = WEAPONS.map((w) => {
    const m = buildGun(w.id, sleeve);
    m.g.visible = false;
    root.add(m.g);
    m.g.traverse((o) => { if (o.material) { o.renderOrder = 20; } });
    return m;
  });
  // keep the gun drawn on top of the world without clipping into walls
  for (const m of guns) m.g.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.depthTest = false; o.material.depthWrite = false; } });
  const HIP = new THREE.Vector3(0.24, -0.27, -0.72), ADS = new THREE.Vector3(0, -0.07, -0.55);
  const v = { cur: 0, ads: 0, bob: 0, sway: new THREE.Vector2(), kick: 0, kickRot: 0, reload: 0, reloadDur: 1, swap: 0, visible: true };

  function set(i) { v.cur = i; guns.forEach((m, k) => (m.g.visible = k === i && v.visible)); }
  function fire(i) { v.kick = Math.min(1, v.kick + (i === 2 || i === 3 ? 1 : 0.55)); v.kickRot = Math.min(1, v.kickRot + (i >= 2 ? 1 : 0.5)); }
  function reload(dur) { v.reload = dur; v.reloadDur = dur; }
  function swap() { v.swap = 0.35; }
  function update(dt, s) {
    const g = guns[v.cur];
    const scoped = WEAPONS[v.cur].scope && v.ads > 0.85;
    g.g.visible = v.visible && !scoped;
    v.ads += ((s.ads ? 1 : 0) - v.ads) * Math.min(1, dt * 14);
    if (s.moving) v.bob += dt * (s.running ? 13 : 8.5);
    const bobAmt = (s.moving ? (s.running ? 0.045 : 0.025) : 0.006) * (1 - v.ads * 0.85);
    v.sway.x += (THREE.MathUtils.clamp(-s.lookDX * 0.6, -0.04, 0.04) - v.sway.x) * Math.min(1, dt * 8);
    v.sway.y += (THREE.MathUtils.clamp(s.lookDY * 0.6, -0.04, 0.04) - v.sway.y) * Math.min(1, dt * 8);
    v.kick = Math.max(0, v.kick - dt * 9);
    v.kickRot = Math.max(0, v.kickRot - dt * 7);
    v.reload = Math.max(0, v.reload - dt);
    v.swap = Math.max(0, v.swap - dt);
    const rp = v.reload > 0 ? Math.sin(Math.PI * (1 - v.reload / v.reloadDur)) : 0;
    const sp = v.swap > 0 ? Math.sin(Math.PI * (v.swap / 0.35)) : 0;
    const p = HIP.clone().lerp(ADS, v.ads);
    p.x += Math.cos(v.bob * 0.5) * bobAmt + v.sway.x * (1 - v.ads * 0.7);
    p.y += -Math.abs(Math.sin(v.bob * 0.5)) * bobAmt + v.sway.y * (1 - v.ads * 0.7) - rp * 0.25 - sp * 0.4 - (s.crouch ? 0.005 : 0);
    p.z += v.kick * 0.1 * (1 - v.ads * 0.4);
    if (s.running && !v.ads) { p.x -= 0.06; p.y -= 0.06; }
    g.g.position.copy(p);
    g.g.rotation.set(v.kickRot * 0.09 - rp * 0.6 + (s.running && !v.ads ? -0.25 : 0), (s.running && !v.ads ? 0.5 : 0) + v.sway.x * 2, rp * 0.4 + (s.running && !v.ads ? 0.2 : 0));
  }
  return {
    set, fire, reload, swap, update,
    get muzzle() { return guns[v.cur].muzzle; },
    get eject() { return guns[v.cur].eject; },
    get adsAmount() { return v.ads; },
    set visible(b) { v.visible = b; guns.forEach((m, k) => (m.g.visible = b && k === v.cur)); },
    dispose() { camera.remove(root); },
  };
}
