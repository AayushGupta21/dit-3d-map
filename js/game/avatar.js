// Low-poly humanoid for other players: jointed hips, knees, shoulders, elbows and head,
// animated procedurally (idle, walk, run, crouch, jump, aim, flinch, "down"), holding their gun.
// Faces -Z locally, so rotation.y = yaw (same convention as the walk camera).
import * as THREE from "three";
import { buildGun } from "./weapons.js";

function nameSprite(text, color) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const g = c.getContext("2d");
  g.font = "600 30px Outfit, system-ui, sans-serif";
  const w = Math.min(244, g.measureText(text).width + 36);
  g.fillStyle = "rgba(18,26,38,0.8)";
  g.beginPath(); g.roundRect((256 - w) / 2, 10, w, 44, 22); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc((256 - w) / 2 + 19, 32, 7, 0, 7); g.fill();
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 136, 33);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(2.4, 0.6, 1);
  return s;
}

export function makeAvatar({ color, name, skin = "#c08a62" }) {
  const g = new THREE.Group();
  const M = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const shirt = M(color), jeans = M("#2b3445"), skinM = M(skin), shoe = M("#1b1d22"), hair = M("#1b1512");
  const part = (parent, w, h, d, m, x, y, z) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z); b.castShadow = true; parent.add(b); return b;
  };
  const pivot = (parent, x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; };

  const hips = pivot(g, 0, 0.95, 0);
  part(hips, 0.36, 0.16, 0.22, jeans, 0, 0.02, 0);
  const legs = [-1, 1].map((sx) => {
    const hip = pivot(hips, sx * 0.1, 0, 0);
    part(hip, 0.15, 0.46, 0.17, jeans, 0, -0.23, 0);
    const knee = pivot(hip, 0, -0.46, 0);
    part(knee, 0.13, 0.44, 0.15, jeans, 0, -0.22, 0);
    part(knee, 0.13, 0.08, 0.25, shoe, 0, -0.46, -0.04);
    return { hip, knee };
  });
  const spine = pivot(hips, 0, 0.06, 0);
  part(spine, 0.42, 0.56, 0.24, shirt, 0, 0.28, 0);
  const neck = pivot(spine, 0, 0.58, 0);
  part(neck, 0.1, 0.08, 0.1, skinM, 0, 0.03, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), skinM);
  head.position.y = 0.17; head.castShadow = true; neck.add(head);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.137, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair);
  hairM.position.set(0, 0.185, 0.01); neck.add(hairM);
  const cap = new THREE.Group();
  const capM = M("#d62828");
  const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.07, 14), capM); c1.position.y = 0.27; cap.add(c1);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.14), capM); c2.position.set(0, 0.24, -0.15); cap.add(c2);
  cap.visible = false; neck.add(cap);
  const arms = [-1, 1].map((sx) => {
    const sh = pivot(spine, sx * 0.27, 0.52, 0);
    part(sh, 0.1, 0.3, 0.11, shirt, 0, -0.15, 0);
    const el = pivot(sh, 0, -0.3, 0);
    part(el, 0.09, 0.27, 0.09, skinM, 0, -0.13, 0);
    part(el, 0.09, 0.08, 0.09, skinM, 0, -0.29, 0);
    return { sh, el, sx };
  });
  // gun held in front of the chest, pitched with the aim
  const gunMount = pivot(spine, 0.12, 0.4, -0.3);
  let gun = null;
  function setWeapon(id) {
    if (gun) gunMount.remove(gun.g);
    gun = buildGun(id);
    gun.g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    gunMount.add(gun.g);
  }
  setWeapon("rifle");

  const label = nameSprite(name, color);
  label.position.y = 2.15; g.add(label);

  // flag carried on the back (CTF)
  const flagHolder = pivot(spine, 0, 0.5, 0.18);

  // hitboxes (never drawn; raycast directly)
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitBody = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 1, 8), hitMat);
  const hitHead = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), hitMat);
  g.add(hitBody, hitHead);

  const st = { phase: 0, flinch: 0, down: 0, crouch: 0, aim: 0, prot: false, t: 0 };
  const tmp = new THREE.Vector3();

  /** s: { speed, running, crouch, jy, pitch, aiming, down }. Returns true on a footstep. */
  function update(dt, s) {
    st.t += dt;
    st.crouch += ((s.crouch ? 1 : 0) - st.crouch) * Math.min(1, dt * 10);
    st.aim += ((s.aiming || !s.running ? 1 : 0) - st.aim) * Math.min(1, dt * 8);
    st.down += ((s.down ? 1 : 0) - st.down) * Math.min(1, dt * 5);
    st.flinch = Math.max(0, st.flinch - dt * 5);
    const moving = s.speed > 0.4 && !s.down;
    const prev = st.phase;
    if (moving) st.phase += dt * Math.min(s.speed, 8) * (s.running ? 1.55 : 1.9);
    const step = moving && Math.floor(prev / Math.PI) !== Math.floor(st.phase / Math.PI);
    const amp = moving ? Math.min(0.75, 0.25 + s.speed * 0.08) : 0;
    const c = st.crouch, air = s.jy > 0.05;

    hips.position.y = 0.95 - c * 0.43 + (moving ? Math.abs(Math.cos(st.phase)) * 0.04 : Math.sin(st.t * 2) * 0.006) + s.jy;
    legs.forEach((L, i) => {
      const sw = Math.sin(st.phase + i * Math.PI) * amp;
      L.hip.rotation.x = -c * 1.2 + sw * (1 - c * 0.5) - (air ? 0.5 : 0);
      L.knee.rotation.x = c * 2.0 + Math.max(0, -Math.sin(st.phase + i * Math.PI)) * amp * 1.3 + (air ? 0.9 : 0);
    });
    spine.rotation.x = -(s.pitch || 0) * 0.45 * st.aim + (s.running ? 0.18 : 0) + c * 0.15;
    spine.rotation.z = Math.sin(st.t * 30) * st.flinch * 0.15;
    neck.rotation.x = -(s.pitch || 0) * 0.45;
    // arms: aiming holds the gun up; running swings them
    arms.forEach((A, i) => {
      const swing = Math.sin(st.phase + (i ? 0 : Math.PI)) * amp * 0.8;
      const aimX = A.sx > 0 ? -1.35 : -1.25, aimZ = A.sx > 0 ? 0.05 : -0.45;
      A.sh.rotation.x = THREE.MathUtils.lerp(swing, aimX, st.aim);
      A.sh.rotation.z = THREE.MathUtils.lerp(A.sx * 0.08, aimZ, st.aim);
      A.el.rotation.x = THREE.MathUtils.lerp(-0.3 - Math.max(0, swing) * 0.5, -0.35, st.aim);
    });
    gunMount.rotation.x = 0;
    gunMount.position.set(0.12, THREE.MathUtils.lerp(0.25, 0.4, st.aim), THREE.MathUtils.lerp(-0.18, -0.32, st.aim));
    gunMount.rotation.y = THREE.MathUtils.lerp(0.6, 0, st.aim);
    // down: fall backwards and lie on the ground
    g.rotation.x = st.down * 1.45;
    g.position.y = st.down * 0.18;
    // spawn-protection shimmer
    shirt.emissive.set(st.prot ? color : "#000"); shirt.emissiveIntensity = st.prot ? 0.35 + Math.sin(st.t * 12) * 0.25 : 0;
    // hitboxes follow the pose
    const top = hips.position.y + 0.06 + 0.58 * Math.cos(spine.rotation.x);
    hitBody.scale.y = Math.max(0.5, top); hitBody.position.set(0, top / 2, 0);
    neck.updateWorldMatrix(true, false);
    head.getWorldPosition(tmp); g.worldToLocal(tmp);
    hitHead.position.copy(tmp);
    label.position.y = top + 0.65;
    return step;
  }
  return {
    g, update, setWeapon, hitBody, hitHead, label, flagHolder,
    flinch() { st.flinch = 1; },
    set seeker(v) { cap.visible = v; },
    set protected(v) { st.prot = v; },
    muzzleWorld(v) { return gun ? gun.muzzle.getWorldPosition(v) : g.getWorldPosition(v); },
    dispose() {
      g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      label.material.map.dispose();
    },
  };
}
