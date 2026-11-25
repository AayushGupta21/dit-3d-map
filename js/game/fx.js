// Shooting effects, all pooled so firing never allocates: tracers, sparks, dust puffs,
// bullet-hole decals, shell casings and muzzle flashes.
import * as THREE from "three";

function radialTexture(inner, outer, size = 64) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d"), r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function starTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  g.translate(32, 32);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  grd.addColorStop(0, "rgba(255,250,220,1)"); grd.addColorStop(0.35, "rgba(255,200,90,0.9)"); grd.addColorStop(1, "rgba(255,120,20,0)");
  g.fillStyle = grd;
  for (let i = 0; i < 6; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(-5, 0); g.lineTo(0, -30); g.lineTo(5, 0); g.fill(); }
  g.beginPath(); g.arc(0, 0, 12, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SURF = {
  brick: { spark: "#ffb05a", dust: "#b4735c", sparks: 7 },
  concrete: { spark: "#ffd08a", dust: "#bdb8ae", sparks: 7 },
  metal: { spark: "#fff1b0", dust: "#9aa0a6", sparks: 14 },
  ground: { spark: null, dust: "#8d7556", sparks: 0 },
  player: { spark: "#ffffff", dust: "#e9eef5", sparks: 4 },
};

export function createFX(scene, { lite = false } = {}) {
  const V = new THREE.Vector3(), Q = new THREE.Quaternion(), dummy = new THREE.Object3D();

  // ---- tracers ----
  const tGeo = new THREE.BoxGeometry(1, 1, 1); tGeo.translate(0, 0, 0.5);
  const tracers = Array.from({ length: 36 }, () => {
    const m = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({ color: "#ffd27a", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.visible = false; m.frustumCulled = false; scene.add(m);
    return { m, life: 0 };
  });
  let tIdx = 0;
  function tracer(a, b) {
    const t = tracers[tIdx++ % tracers.length];
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    t.m.position.copy(a); t.m.lookAt(b);
    t.m.scale.set(0.03, 0.03, len);
    t.m.visible = true; t.life = 0.07 + Math.min(0.06, len / 2500);
    t.max = t.life;
  }

  // ---- sparks (one Points cloud) ----
  const NS = lite ? 120 : 360;
  const sPos = new Float32Array(NS * 3).fill(-999), sCol = new Float32Array(NS * 3), sVel = new Float32Array(NS * 3), sLife = new Float32Array(NS);
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute("color", new THREE.BufferAttribute(sCol, 3));
  const sparks = new THREE.Points(sGeo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  sparks.frustumCulled = false; scene.add(sparks);
  let sIdx = 0;
  const col = new THREE.Color();
  function emitSparks(p, n, color, normal) {
    col.set(color);
    for (let k = 0; k < n; k++) {
      const i = sIdx++ % NS;
      sPos[i * 3] = p.x; sPos[i * 3 + 1] = p.y; sPos[i * 3 + 2] = p.z;
      V.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random() * 2.5);
      if (normal) V.addScaledVector(normal, 2 + Math.random() * 2);
      sVel[i * 3] = V.x; sVel[i * 3 + 1] = V.y + 1; sVel[i * 3 + 2] = V.z;
      sCol[i * 3] = col.r; sCol[i * 3 + 1] = col.g; sCol[i * 3 + 2] = col.b;
      sLife[i] = 0.18 + Math.random() * 0.3;
    }
  }

  // ---- dust puffs ----
  const dustTex = radialTexture("rgba(255,255,255,0.85)", "rgba(255,255,255,0)");
  const puffs = Array.from({ length: lite ? 12 : 28 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false }));
    s.visible = false; scene.add(s);
    return { s, life: 0, max: 1, grow: 1 };
  });
  let pIdx = 0;
  function puff(p, color, size = 0.5, normal) {
    const d = puffs[pIdx++ % puffs.length];
    d.s.position.copy(p); if (normal) d.s.position.addScaledVector(normal, 0.15);
    d.s.material.color.set(color); d.s.material.opacity = 0.8;
    d.s.scale.setScalar(size * 0.4); d.grow = size * 2.4;
    d.max = d.life = 0.5 + Math.random() * 0.3; d.s.visible = true;
  }

  // ---- bullet-hole decals ----
  const holeTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, "rgba(10,10,10,1)"); grd.addColorStop(0.35, "rgba(25,22,20,0.95)"); grd.addColorStop(0.6, "rgba(60,55,50,0.45)"); grd.addColorStop(1, "rgba(60,55,50,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const ND = lite ? 24 : 60;
  const decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), ND);
  decals.count = 0; decals.frustumCulled = false; scene.add(decals);
  let dIdx = 0;
  function decal(p, normal) {
    dummy.position.copy(p).addScaledVector(normal, 0.015);
    dummy.lookAt(V.copy(dummy.position).add(normal));
    dummy.rotateZ(Math.random() * 6.28);
    dummy.scale.setScalar(0.7 + Math.random() * 0.6);
    dummy.updateMatrix();
    decals.setMatrixAt(dIdx % ND, dummy.matrix);
    dIdx++;
    decals.count = Math.min(ND, dIdx);
    decals.instanceMatrix.needsUpdate = true;
  }

  // ---- shell casings ----
  const brass = new THREE.MeshStandardMaterial({ color: "#c9a24a", metalness: 0.8, roughness: 0.35 });
  const casingGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.024, 6);
  const casings = Array.from({ length: lite ? 6 : 16 }, () => {
    const m = new THREE.Mesh(casingGeo, brass); m.visible = false; scene.add(m);
    return { m, v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 };
  });
  let cIdx = 0;
  function casing(p, right, up) {
    const c = casings[cIdx++ % casings.length];
    c.m.position.copy(p);
    c.v.copy(right).multiplyScalar(1.6 + Math.random()).addScaledVector(up, 1.4 + Math.random()).addScaledVector(V.set(Math.random() - 0.5, 0, Math.random() - 0.5), 0.6);
    c.spin.set(Math.random() * 30, Math.random() * 30, Math.random() * 30);
    c.life = 1.6; c.m.visible = true;
  }

  // ---- muzzle flashes ----
  const starTex = starTexture();
  const flashes = Array.from({ length: 8 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    s.visible = false; scene.add(s);
    return { s, life: 0 };
  });
  let fIdx = 0;
  const light = lite ? null : new THREE.PointLight("#ffc070", 0, 9, 2);
  if (light) scene.add(light);
  let lightLife = 0;
  /** big: own gun (bigger sprite + light), otherwise a remote shot. */
  function muzzle(p, big = false) {
    const f = flashes[fIdx++ % flashes.length];
    f.s.position.copy(p); f.s.scale.setScalar(big ? 0.35 : 0.6);
    f.s.material.rotation = Math.random() * 6.28;
    f.s.visible = true; f.life = 0.05;
    if (light) { light.position.copy(p); light.intensity = big ? 4 : 2.5; lightLife = 0.05; }
  }

  /** Bullet impact at p with surface normal n. */
  function impact(p, n, surface = "concrete") {
    const S = SURF[surface] || SURF.concrete;
    if (S.sparks && S.spark) emitSparks(p, lite ? Math.ceil(S.sparks / 2) : S.sparks, S.spark, n);
    puff(p, S.dust, surface === "player" ? 0.35 : surface === "ground" ? 0.7 : 0.5, n);
    if (surface === "brick" || surface === "concrete" || surface === "metal") decal(p, n);
  }

  function update(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) t.m.visible = false;
    }
    let any = false;
    for (let i = 0; i < NS; i++) {
      if (sLife[i] <= 0) continue;
      any = true;
      sLife[i] -= dt;
      if (sLife[i] <= 0) { sPos[i * 3 + 1] = -999; continue; }
      sVel[i * 3 + 1] -= 9.8 * dt;
      sPos[i * 3] += sVel[i * 3] * dt; sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt; sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt;
      if (sPos[i * 3 + 1] < 0.02) { sPos[i * 3 + 1] = 0.02; sVel[i * 3 + 1] *= -0.3; }
    }
    if (any) sGeo.attributes.position.needsUpdate = true;
    for (const d of puffs) {
      if (d.life <= 0) continue;
      d.life -= dt;
      const k = 1 - d.life / d.max;
      d.s.scale.setScalar(0.1 + d.grow * Math.sqrt(k));
      d.s.material.opacity = 0.75 * (1 - k);
      d.s.position.y += dt * 0.25;
      if (d.life <= 0) d.s.visible = false;
    }
    for (const c of casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.v.y -= 9.8 * dt;
      c.m.position.addScaledVector(c.v, dt);
      if (c.m.position.y < 0.12) { c.m.position.y = 0.12; c.v.y *= -0.35; c.v.x *= 0.6; c.v.z *= 0.6; c.spin.multiplyScalar(0.6); }
      c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt; c.m.rotation.z += c.spin.z * dt;
      if (c.life <= 0) c.m.visible = false;
    }
    for (const f of flashes) { if (f.life > 0) { f.life -= dt; if (f.life <= 0) f.s.visible = false; } }
    if (light && lightLife > 0) { lightLife -= dt; light.intensity = lightLife > 0 ? light.intensity * 0.7 : 0; }
  }

  function dispose() {
    for (const t of tracers) scene.remove(t.m);
    for (const d of puffs) scene.remove(d.s);
    for (const c of casings) scene.remove(c.m);
    for (const f of flashes) scene.remove(f.s);
    scene.remove(sparks, decals);
    if (light) scene.remove(light);
  }
  return { tracer, impact, casing, muzzle, update, dispose, Q };
}
