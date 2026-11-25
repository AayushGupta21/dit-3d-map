// Living campus: parked cars in the lots, cars driving the roads (left-hand traffic, as in India)
// and students walking the paths. Everything is instanced, so ~200 agents cost only a few draw calls.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const CAR_COLORS = ["#f4f4f2", "#f4f4f2", "#f4f4f2", "#c9ccd1", "#c9ccd1", "#8b9097", "#2b2d31", "#b3261e", "#1f4fa3", "#7a1f24", "#d8c9a8", "#2f6d4f"];
const SHIRTS = ["#f2f2f2", "#2b4c8c", "#c0392b", "#1d1d1f", "#e6b422", "#5a8f3e", "#8e44ad", "#e07a5f", "#3d7ea6", "#f4a7b9", "#6b4f3a", "#9aa0a6"];
const PANTS = ["#2b3445", "#1d2230", "#3b3b3b", "#5d6b82", "#2f2a26"];

function rand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function pointIn([x, y], p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) ins = !ins;
  }
  return ins;
}
function edgeDist([x, y], p) {
  let d = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t));
  }
  return d;
}

// ---------- geometry helpers ----------
function part(geo, color, x = 0, y = 0, z = 0) {
  geo = geo.toNonIndexed();
  geo.translate(x, y, z);
  const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute("color", new THREE.BufferAttribute(a, 3));
  geo.deleteAttribute("uv");
  return geo;
}
const box = (w, h, d, color, x, y, z) => part(new THREE.BoxGeometry(w, h, d), color, x, y, z);

/** A small hatchback, facing +X. White parts take the instance colour; glass and tyres stay dark. */
function carGeometry() {
  const L = 4.1, W = 1.75;
  const wheel = (x, z) => {
    const g = new THREE.CylinderGeometry(0.31, 0.31, 0.24, 10);
    g.rotateX(Math.PI / 2);
    return part(g, "#141414", x, 0.31, z);
  };
  return mergeGeometries([
    box(L, 0.62, W, "#ffffff", 0, 0.62, 0),                 // body
    box(L - 0.25, 0.1, W - 0.1, "#2a2a2a", 0, 0.3, 0),     // sill
    box(2.25, 0.56, W - 0.14, "#3a4652", -0.25, 1.21, 0),  // glass cabin
    box(2.0, 0.07, W - 0.2, "#ffffff", -0.3, 1.52, 0),     // roof
    box(0.06, 0.12, W - 0.4, "#2a2a2a", L / 2, 0.5, 0),    // front grille
    wheel(1.3, W / 2 - 0.08), wheel(1.3, -W / 2 + 0.08), wheel(-1.3, W / 2 - 0.08), wheel(-1.3, -W / 2 + 0.08),
  ]);
}
function carLightsGeometry() {
  const L = 4.1;
  return mergeGeometries([
    box(0.05, 0.16, 0.36, "#fff6d8", L / 2 + 0.02, 0.78, 0.6), box(0.05, 0.16, 0.36, "#fff6d8", L / 2 + 0.02, 0.78, -0.6),
    box(0.05, 0.14, 0.3, "#ff2a1a", -L / 2 - 0.02, 0.8, 0.62), box(0.05, 0.14, 0.3, "#ff2a1a", -L / 2 - 0.02, 0.8, -0.62),
  ]);
}
/** Person parts, ~1.7 m tall, facing +X. Legs pivot at the hip so they can swing. */
function legGeometry() { return part(new THREE.BoxGeometry(0.16, 0.86, 0.17), "#ffffff", 0, -0.43, 0); }
function torsoGeometry() {
  return mergeGeometries([
    box(0.24, 0.58, 0.44, "#ffffff", 0, 1.16, 0),
    box(0.13, 0.55, 0.11, "#ffffff", 0, 1.15, 0.29), box(0.13, 0.55, 0.11, "#ffffff", 0, 1.15, -0.29),
  ]);
}
function headGeometry() {
  return mergeGeometries([
    part(new THREE.SphereGeometry(0.125, 10, 8), "#b07a55", 0, 1.6, 0),
    part(new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), "#1b1512", -0.01, 1.63, 0)
  ]);
}

// ---------- road network ----------
function buildNet(roads, useRoad, keep) {
  const nodes = [], byKey = new Map();
  const id = (p) => {
    const k = Math.round(p[0] * 2) + "," + Math.round(p[1] * 2);
    let i = byKey.get(k);
    if (i == null) { i = nodes.length; byKey.set(k, i); nodes.push({ p, nb: [] }); }
    return i;
  };
  for (const r of roads) {
    if (!useRoad(r)) continue;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      if (!keep(a) || !keep(b)) continue;
      const ia = id(a), ib = id(b);
      if (ia === ib || nodes[ia].nb.some((e) => e.i === ib)) continue;
      nodes[ia].nb.push({ i: ib, w: r.w, main: r.w >= 7 });
      nodes[ib].nb.push({ i: ia, w: r.w, main: r.w >= 7 });
    }
  }
  // join road ends that almost touch (traced lanes meet OSM roads with small gaps)
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.nb.length !== 1) continue;
    let best = -1, bd = 9;
    for (let j = 0; j < nodes.length; j++) {
      if (j === i || n.nb.some((e) => e.i === j)) continue;
      const d = Math.hypot(n.p[0] - nodes[j].p[0], n.p[1] - nodes[j].p[1]);
      if (d < bd) { bd = d; best = j; }
    }
    if (best >= 0) {
      const w = n.nb[0].w;
      n.nb.push({ i: best, w, main: false });
      nodes[best].nb.push({ i, w, main: false });
    }
  }
  return nodes;
}

export function createTraffic(scene, data, { lite = false, shadows = true } = {}) {
  const R = rand(20241125);
  const ext = data.extent, M = 15;
  const inExt = (p) => p[0] > ext.minX + M && p[0] < ext.maxX - M && p[1] > ext.minY + M && p[1] < ext.maxY - M;
  const B = data.boundary && data.boundary.length > 2 ? data.boundary : null;
  const inCampus = (p) => !B || pointIn(p, B) || edgeDist(p, B) < 4;
  const group = new THREE.Group();
  group.name = "traffic";
  scene.add(group);

  // ---------- cars ----------
  const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const carGeo = carGeometry();

  // parked: fill the bays between the painted stripes (same grid world.js paints)
  const parked = [];
  // keep bays clear of any road that runs through or along the lot
  const nearRoad = (x, y) => data.roads.some((r) => {
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      if (Math.min(a[0], b[0]) - 12 > x || Math.max(a[0], b[0]) + 12 < x || Math.min(a[1], b[1]) - 12 > y || Math.max(a[1], b[1]) + 12 < y) continue;
      if (edgeDist([x, y], [a, b]) < r.w / 2 + 1.6) return true;
    }
    return false;
  });
  for (const f of data.features) {
    if (f.kind !== "parking") continue;
    const xs = f.pts.map((p) => p[0]), ys = f.pts.map((p) => p[1]);
    for (let y = Math.min(...ys) + 4; y < Math.max(...ys) - 4; y += 6) {
      for (let x = Math.min(...xs) + 3; x + 2.6 < Math.max(...xs) - 3; x += 2.6) {
        const cx = x + 1.3;
        if (![[x, y - 2], [x + 2.6, y - 2], [x, y + 2], [x + 2.6, y + 2]].every((q) => pointIn(q, f.pts))) continue;
        if (R() < 0.3 || nearRoad(cx, y - 1.8) || nearRoad(cx, y + 1.8) || nearRoad(cx, y)) continue;
        parked.push({ x: cx + (R() - 0.5) * 0.25, y: y + (R() - 0.5) * 0.4, yaw: (R() < 0.5 ? 1 : -1) * Math.PI / 2 + (R() - 0.5) * 0.06 });
      }
    }
  }

  const carNet = buildNet(data.roads, (r) => r.w >= 4, inExt);
  const nCars = lite ? 10 : 26;
  const moving = [];
  const carEdges = [];
  for (let i = 0; i < carNet.length; i++) for (const e of carNet[i].nb) if (i < e.i) carEdges.push([i, e.i, e]);
  const edgeLen = (a, b) => Math.hypot(carNet[b].p[0] - carNet[a].p[0], carNet[b].p[1] - carNet[a].p[1]);
  if (carEdges.length) {
    // spread cars over the network in proportion to road length, with campus lanes favoured a little
    const wts = carEdges.map(([a, b, e]) => edgeLen(a, b) * (e.main ? 0.6 : 1.4) * (inCampus(carNet[a].p) ? 1.6 : 1));
    const tot = wts.reduce((s, w) => s + w, 0);
    for (let k = 0; k < nCars; k++) {
      let r = R() * tot, j = 0;
      while (r > wts[j] && j < wts.length - 1) r -= wts[j++];
      const [a, b] = carEdges[j];
      const fwd = R() < 0.5;
      moving.push({ from: fwd ? a : b, to: fwd ? b : a, s: R() * edgeLen(a, b), v: 0, vmax: 0, yaw: null, color: CAR_COLORS[Math.floor(R() * CAR_COLORS.length)], x: 0, y: 0 });
    }
  }

  const carsMesh = new THREE.InstancedMesh(carGeo, carMat, parked.length + moving.length);
  carsMesh.castShadow = shadows; carsMesh.receiveShadow = false;
  const lights = new THREE.InstancedMesh(carLightsGeometry(), lightMat, Math.max(1, moving.length));
  lights.count = moving.length;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  parked.forEach((c, i) => {
    dummy.position.set(c.x, 0.08, -c.y); dummy.rotation.set(0, c.yaw, 0); dummy.updateMatrix();
    carsMesh.setMatrixAt(i, dummy.matrix);
    carsMesh.setColorAt(i, col.set(CAR_COLORS[Math.floor(R() * CAR_COLORS.length)]));
  });
  moving.forEach((c, k) => carsMesh.setColorAt(parked.length + k, col.set(c.color)));
  carsMesh.frustumCulled = false; lights.frustumCulled = false;
  group.add(carsMesh, lights);

  // ---------- people ----------
  const pedNet = buildNet(data.roads, () => true, (p) => inExt(p) && inCampus(p));
  const pedEdges = [];
  for (let i = 0; i < pedNet.length; i++) for (const e of pedNet[i].nb) if (i < e.i) pedEdges.push([i, e.i, e]);
  const pLen = (a, b) => Math.hypot(pedNet[b].p[0] - pedNet[a].p[0], pedNet[b].p[1] - pedNet[a].p[1]);
  const walkers = [];
  const nWalk = lite ? 40 : 110;
  if (pedEdges.length) {
    const wts = pedEdges.map(([a, b, e]) => pLen(a, b) * (e.w <= 2.5 ? 2.5 : 1));
    const tot = wts.reduce((s, w) => s + w, 0);
    for (let k = 0; k < nWalk; k++) {
      let r = R() * tot, j = 0;
      while (r > wts[j] && j < wts.length - 1) r -= wts[j++];
      const [a, b] = pedEdges[j];
      const fwd = R() < 0.5;
      walkers.push({ from: fwd ? a : b, to: fwd ? b : a, s: R() * pLen(a, b), v: 1.05 + R() * 0.55, side: R() < 0.5 ? 1 : -1,
        phase: R() * 6.28, yaw: null, pause: 0, x: 0, y: 0 });
    }
  }
  // people standing around in small groups: lawn, grounds, courts and the cafe
  const idle = [];
  const spots = [];
  for (const f of data.features) if (f.kind !== "parking") spots.push({ pts: f.pts, n: f.kind === "court" ? 3 : 6 });
  for (const c of data.connectors || []) if (c.type === "cafe" || c.type === "amphitheatre") spots.push({ c: c.pts[0], n: 7, r: 9 });
  for (const s of spots) {
    for (let g = 0; g < Math.ceil(s.n / 3); g++) {
      let gx, gy, tries = 0;
      do {
        if (s.pts) {
          const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
          gx = Math.min(...xs) + R() * (Math.max(...xs) - Math.min(...xs)); gy = Math.min(...ys) + R() * (Math.max(...ys) - Math.min(...ys));
        } else { const a = R() * 6.28, r = R() * s.r; gx = s.c[0] + Math.cos(a) * r; gy = s.c[1] + Math.sin(a) * r; }
      } while (s.pts && !pointIn([gx, gy], s.pts) && ++tries < 30);
      const m = 2 + Math.floor(R() * 3);
      for (let k = 0; k < m && idle.length < (lite ? 20 : 60); k++) {
        const a = (k / m) * 6.28 + R() * 0.5, rr = 0.7 + R() * 0.3;
        const x = gx + Math.cos(a) * rr, y = gy + Math.sin(a) * rr;
        idle.push({ x, y, yaw: Math.atan2(gy - y, gx - x), phase: R() * 6.28 });
      }
    }
  }

  const nPeople = walkers.length + idle.length;
  const pplMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const legs = new THREE.InstancedMesh(legGeometry(), pplMat, Math.max(1, nPeople * 2));
  const torsos = new THREE.InstancedMesh(torsoGeometry(), pplMat, Math.max(1, nPeople));
  const heads = new THREE.InstancedMesh(headGeometry(), pplMat, Math.max(1, nPeople));
  for (const m of [legs, torsos, heads]) { m.castShadow = shadows; m.frustumCulled = false; group.add(m); }
  for (let i = 0; i < nPeople; i++) {
    torsos.setColorAt(i, col.set(SHIRTS[Math.floor(R() * SHIRTS.length)]));
    const pc = col.set(PANTS[Math.floor(R() * PANTS.length)]).clone();
    legs.setColorAt(i * 2, pc); legs.setColorAt(i * 2 + 1, pc);
    heads.setColorAt(i, col.set("#ffffff").multiplyScalar(0.8 + R() * 0.3));
  }

  // ---------- movement ----------
  function nextNode(net, a, b, allowMain = true) {
    const pa = net[a].p, pb = net[b].p;
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dl = Math.hypot(dx, dy) || 1;
    const opts = net[b].nb.filter((e) => e.i !== a && (allowMain || !e.main));
    if (!opts.length) return a; // dead end: turn round
    const sc = opts.map((e) => {
      const q = net[e.i].p, ex = q[0] - pb[0], ey = q[1] - pb[1];
      const dot = (dx * ex + dy * ey) / (dl * (Math.hypot(ex, ey) || 1));
      return 0.35 + Math.max(0, dot) * 2.2;
    });
    let r = Math.random() * sc.reduce((s, v) => s + v, 0);
    for (let i = 0; i < opts.length; i++) { if ((r -= sc[i]) <= 0) return opts[i].i; }
    return opts[opts.length - 1].i;
  }
  const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

  function placeOnEdge(net, ag, off) {
    const pa = net[ag.from].p, pb = net[ag.to].p;
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], L = Math.hypot(dx, dy) || 1;
    const t = ag.s / L, ux = dx / L, uy = dy / L;
    ag.x = pa[0] + dx * t - uy * off; // left of travel direction
    ag.y = pa[1] + dy * t + ux * off;
    return Math.atan2(uy, ux);
  }

  function update(dt, time, night) {
    // cars
    for (let k = 0; k < moving.length; k++) {
      const c = moving[k];
      const e = carNet[c.from].nb.find((q) => q.i === c.to) || { w: 4.5, main: false };
      c.vmax = e.main ? 12 : e.w >= 5 ? 7.5 : 6;
      // keep a gap to the car ahead going the same way
      let ahead = Infinity;
      if (c.yaw != null) {
        const fx = Math.cos(c.yaw), fy = Math.sin(c.yaw);
        for (const o of moving) {
          if (o === c || o.yaw == null) continue;
          const rx = o.x - c.x, ry = o.y - c.y, d = Math.hypot(rx, ry);
          if (d > 14 || d < 0.01) continue;
          if ((rx * fx + ry * fy) / d > 0.9 && Math.cos(o.yaw - c.yaw) > 0.5) ahead = Math.min(ahead, d);
        }
      }
      const target = ahead < 7 ? 0 : ahead < 14 ? c.vmax * (ahead - 7) / 7 : c.vmax;
      c.v += Math.max(-8 * dt, Math.min(2.5 * dt, target - c.v));
      c.s += c.v * dt;
      let L = edgeLen(c.from, c.to);
      let guard = 0;
      while (c.s > L && guard++ < 6) {
        c.s -= L;
        const n = nextNode(carNet, c.from, c.to);
        if (n === c.from) c.v *= 0.3; // U-turn at a dead end
        c.from = c.to; c.to = n; L = edgeLen(c.from, c.to);
      }
      const yaw = placeOnEdge(carNet, c, (e.w || 4.5) * 0.26);
      c.yaw = c.yaw == null ? yaw : lerpAngle(c.yaw, yaw, Math.min(1, dt * 6));
      dummy.position.set(c.x, 0.14, -c.y); dummy.rotation.set(0, c.yaw, 0); dummy.updateMatrix();
      carsMesh.setMatrixAt(parked.length + k, dummy.matrix);
      lights.setMatrixAt(k, dummy.matrix);
    }
    carsMesh.instanceMatrix.needsUpdate = true;
    lights.instanceMatrix.needsUpdate = true;
    const glow = 0.35 + night * 1.6;
    lightMat.color.setRGB(glow, glow, glow);

    // people
    const setPerson = (i, x, y, yaw, swing, bob) => {
      dummy.position.set(x, 0.1 + bob, -y); dummy.rotation.set(0, yaw, 0); dummy.updateMatrix();
      torsos.setMatrixAt(i, dummy.matrix); heads.setMatrixAt(i, dummy.matrix);
      const ca = Math.cos(yaw), sa = Math.sin(yaw);
      for (const sgn of [1, -1]) {
        // hip is 0.1 m to the side of centre (local z), legs swing about local z axis
        dummy.position.set(x + sa * 0.1 * sgn, 0.96 + bob, -y + ca * 0.1 * sgn);
        dummy.rotation.set(0, yaw, swing * sgn, "YXZ");
        dummy.updateMatrix();
        legs.setMatrixAt(i * 2 + (sgn > 0 ? 0 : 1), dummy.matrix);
      }
    };
    for (let k = 0; k < walkers.length; k++) {
      const w = walkers[k];
      let moved = w.v;
      if (w.pause > 0) { w.pause -= dt; moved = 0; }
      w.s += moved * dt;
      let L = pLen(w.from, w.to), guard = 0;
      while (w.s > L && guard++ < 6) {
        w.s -= L;
        const n = nextNode(pedNet, w.from, w.to, false);
        w.from = w.to; w.to = n; L = pLen(w.from, w.to);
        if (Math.random() < 0.04) w.pause = 2 + Math.random() * 5;
      }
      const e = pedNet[w.from].nb.find((q) => q.i === w.to) || { w: 2.2 };
      const off = e.w <= 2.5 ? w.side * 0.45 : w.side * (e.w / 2 + 0.55);
      const yaw = placeOnEdge(pedNet, w, off);
      w.yaw = w.yaw == null ? yaw : lerpAngle(w.yaw, yaw, Math.min(1, dt * 5));
      if (moved) w.phase += dt * w.v * 5.2;
      const sw = moved ? Math.sin(w.phase) * 0.42 : 0;
      setPerson(k, w.x, w.y, w.yaw, sw, moved ? Math.abs(Math.cos(w.phase)) * 0.04 : 0);
    }
    for (let k = 0; k < idle.length; k++) {
      const p = idle[k];
      setPerson(walkers.length + k, p.x, p.y, p.yaw + Math.sin(time * 0.4 + p.phase) * 0.25, 0, 0);
    }
    for (const m of [legs, torsos, heads]) m.instanceMatrix.needsUpdate = true;
  }

  update(0, 0, 0);
  for (const m of [carsMesh, lights, legs, torsos, heads]) if (m.instanceColor) m.instanceColor.needsUpdate = true;

  return {
    group, update,
    stats: { parked: parked.length, cars: moving.length, walkers: walkers.length, idle: idle.length },
    set visible(v) { group.visible = v; },
    get visible() { return group.visible; },
  };
}
