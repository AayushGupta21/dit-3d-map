// Builds the static campus scene from window.CAMPUS_DATA.
// Scene space: x = east (m), y = up (m), z = south (m). Data space: [x east, y north].
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeFacade, makeGlow, STYLES, BAY, FLOOR, TILE_BAYS, TILE_FLOORS } from "./textures.js?v=1795619339";

export const toV3 = (p, h = 0) => new THREE.Vector3(p[0], h, -p[1]);

export function buildingHeight(b) { return b.levels * FLOOR + 0.6; }

// ---------- geometry helpers ----------
function shapeFrom(pts) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

/** Flat polygon lying on the ground at height h (shape y = north becomes -z). */
function flatPoly(pts, h) {
  const g = new THREE.ShapeGeometry(shapeFrom(pts));
  g.rotateX(-Math.PI / 2);
  g.translate(0, h, 0);
  return g;
}

/** Outer walls with UVs in metres so window bays line up across the whole facade. */
function wallGeometry(pts, h0, h1) {
  const pos = [], uv = [], idx = [];
  let u = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.01) continue;
    const base = pos.length / 3;
    pos.push(a[0], h0, -a[1], b[0], h0, -b[1], b[0], h1, -b[1], a[0], h1, -a[1]);
    const u0 = u / (BAY * TILE_BAYS), u1 = (u + len) / (BAY * TILE_BAYS);
    const v0 = h0 / (FLOOR * TILE_FLOORS), v1 = h1 / (FLOOR * TILE_FLOORS);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    u += Math.round(len / BAY) * BAY || len; // snap so bays restart cleanly at corners
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Hipped roof for 4-cornered buildings. */
function hipRoof(pts, h, pitch = 0.32) {
  const [A, B, C, D] = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  const ab = A.distanceTo(B), bc = B.distanceTo(C);
  const long = ab >= bc;
  const len = long ? (ab + C.distanceTo(D)) / 2 : (bc + D.distanceTo(A)) / 2;
  const wid = long ? (bc + D.distanceTo(A)) / 2 : (ab + C.distanceTo(D)) / 2;
  const ctr = A.clone().add(B).add(C).add(D).multiplyScalar(0.25);
  const axis = (long ? B.clone().sub(A).add(C.clone().sub(D)) : C.clone().sub(B).add(D.clone().sub(A))).normalize();
  const half = Math.max(0, len / 2 - wid / 2);
  const R1 = ctr.clone().addScaledVector(axis, -half), R2 = ctr.clone().addScaledVector(axis, half);
  const top = h + wid * pitch;
  const v = (p, y) => [p.x, y, -p.y];
  // pick which ridge end is nearer each corner
  const near = (P) => (P.distanceTo(R1) < P.distanceTo(R2) ? R1 : R2);
  const tris = [];
  const corners = [A, B, C, D];
  for (let i = 0; i < 4; i++) {
    const P = corners[i], Q = corners[(i + 1) % 4];
    const rp = near(P), rq = near(Q);
    if (rp === rq) tris.push(v(P, h), v(Q, h), v(rp, top));
    else { tris.push(v(P, h), v(Q, h), v(rq, top)); tris.push(v(P, h), v(rq, top), v(rp, top)); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

/** Ribbon along a polyline (for roads and routes). */
export function ribbon(pts, width, y) {
  const pos = [], idx = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const nx = -dy * width / 2, ny = dx * width / 2;
    pos.push(p[0] + nx, y, -(p[1] + ny), p[0] - nx, y, -(p[1] - ny));
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Thin raised strip offset to one side of a polyline, with UVs every metre (for striped kerbs). */
function kerbStrip(pts, off, side, width, height) {
  const pos = [], uv = [], idx = [];
  let dist = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const nx = -dy * side, ny = dx * side;
    if (i > 0) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const p = pts[i];
    const ix = p[0] + nx * off, iy = p[1] + ny * off;
    const ox = p[0] + nx * (off + width), oy = p[1] + ny * (off + width);
    pos.push(ix, height, -iy, ox, height, -oy);
    uv.push(dist / 1.0, 0, dist / 1.0, 1);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Dashed white centre line. */
function dashLine(pts, y) {
  const geos = [];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = carry;
    while (d < len) {
      const L = Math.min(2.5, len - d);
      const t0 = d / len, t1 = (d + L) / len;
      geos.push(ribbon([[a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]], 0.18, y).toNonIndexed());
      d += 6;
    }
    carry = d - len;
  }
  return geos.length ? mergeGeometries(geos) : new THREE.BufferGeometry();
}

function discs(points, r, y, seg = 12) {
  return points.map(([x, z]) => { const g = new THREE.CircleGeometry(r, seg); g.rotateX(-Math.PI / 2); g.translate(x, y, -z); return g; });
}

function pointIn([x, y], p) {
  let ins = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) ins = !ins;
  }
  return ins;
}

/** Tall flagpole with an Indian tricolour (the landmark in front of Chanakya). */
function addFlag(scene, c) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.35, 32, 10), new THREE.MeshStandardMaterial({ color: "#d9dce0", metalness: 0.6, roughness: 0.35 }));
  pole.position.y = 16; pole.castShadow = true;
  g.add(pole);
  const cv = document.createElement("canvas"); cv.width = 300; cv.height = 200;
  const x = cv.getContext("2d");
  x.fillStyle = "#ff9933"; x.fillRect(0, 0, 300, 67);
  x.fillStyle = "#ffffff"; x.fillRect(0, 67, 300, 66);
  x.fillStyle = "#138808"; x.fillRect(0, 133, 300, 67);
  x.strokeStyle = "#000080"; x.lineWidth = 3; x.beginPath(); x.arc(150, 100, 26, 0, Math.PI * 2); x.stroke();
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; x.beginPath(); x.moveTo(150, 100); x.lineTo(150 + Math.cos(a) * 26, 100 + Math.sin(a) * 26); x.lineWidth = 1.2; x.stroke(); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(9, 6, 12, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const u = (pos.getX(i) + 4.5) / 9; pos.setZ(i, Math.sin(u * Math.PI * 1.6) * 0.6 * u); }
  geo.computeVertexNormals();
  const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }));
  flag.position.set(4.7, 28.5, 0); flag.castShadow = true;
  g.add(flag);
  g.position.set(c[0], 0, -c[1]);
  g.rotation.y = 0.6;
  scene.add(g);
}

function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------- world ----------
export function buildWorld(scene, data, { lite = false, anisotropy = 4 } = {}) {
  const ext = data.extent;
  const W = ext.maxX - ext.minX, H = ext.maxY - ext.minY;
  const cx = (ext.minX + ext.maxX) / 2, cy = (ext.minY + ext.maxY) / 2;
  const handles = { pickables: [], buildingById: new Map(), facadeMats: [], lamps: null, treeMats: [], groundU: null };

  // ---- ground (land cover texture tinted per season in the shader) ----
  const groundU = {
    uBase: { value: new THREE.Color("#9fb56a") }, uGrass: { value: new THREE.Color("#7aa548") },
    uTree: { value: new THREE.Color("#3f6f2c") }, uSand: { value: new THREE.Color("#d7caa6") },
  };
  handles.groundU = groundU;
  const groundTex = new THREE.TextureLoader().load("assets/ground.jpg");
  groundTex.anisotropy = anisotropy;
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 });
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, groundU);
    sh.fragmentShader = "uniform vec3 uBase, uGrass, uTree, uSand;\n" + sh.fragmentShader.replace(
      "#include <map_fragment>",
      `vec3 wgt = texture2D(map, vMapUv).rgb;
       vec3 cc = mix(uBase, uGrass, wgt.r);
       cc = mix(cc, uTree, wgt.b * 0.85);
       cc = mix(cc, uSand, smoothstep(0.35, 0.95, wgt.g) * 0.8);
       diffuseColor.rgb *= cc;`);
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, -cy);
  ground.receiveShadow = true;
  ground.name = "ground";
  scene.add(ground);
  handles.ground = ground;

  const outerMat = new THREE.MeshStandardMaterial({ color: "#9fb56a", roughness: 1 });
  handles.outerMat = outerMat;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), outerMat);
  outer.rotation.x = -Math.PI / 2; outer.position.set(cx, -0.05, -cy);
  scene.add(outer);

  // ---- grounds / courts ----
  const FEATURE_COLORS = { court: "#3d5fae", parking: "#9a9c98", lawn: "#6fae45", field: "#79ad4b" };
  for (const f of data.features) {
    const col = FEATURE_COLORS[f.kind] || FEATURE_COLORS.field;
    const m = new THREE.Mesh(flatPoly(f.pts, 0.08), new THREE.MeshStandardMaterial({ color: col, roughness: 0.95 }));
    m.receiveShadow = true;
    scene.add(m);
    if (f.kind !== "parking") {
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(f.pts.map((p) => toV3(p, 0.12))),
        new THREE.LineBasicMaterial({ color: "#f4f4ee", transparent: true, opacity: 0.85 }));
      scene.add(line);
    } else {
      // parking bay stripes along the long axis
      const xs = f.pts.map((p) => p[0]), ys = f.pts.map((p) => p[1]);
      const seg = [];
      for (let y = Math.min(...ys) + 4; y < Math.max(...ys) - 4; y += 6) {
        for (let x = Math.min(...xs) + 3; x < Math.max(...xs) - 3; x += 2.6) {
          if (pointIn([x, y], f.pts)) seg.push(toV3([x, y - 2], 0.12), toV3([x, y + 2], 0.12));
        }
      }
      scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg),
        new THREE.LineBasicMaterial({ color: "#f2f2ec", transparent: true, opacity: 0.7 })));
    }
    if (f.kind === "court" && f.pts.length === 4) courtMarkings(scene, f.pts);
    if (f.flag) addFlag(scene, f.c);
  }

  // ---- roads ----
  const kerb = [], asphalt = [], paths = [], joints = [], kerbJoints = [];
  for (const r of data.roads) {
    if (r.pts.length < 2) continue;
    const foot = r.w <= 2.5;
    if (foot) { paths.push(ribbon(r.pts, r.w, 0.1)); continue; }
    kerb.push(ribbon(r.pts, r.w + 1.2, 0.1));
    asphalt.push(ribbon(r.pts, r.w, 0.14));
    joints.push(...discs(r.pts, r.w / 2, 0.14));
    kerbJoints.push(...discs(r.pts, (r.w + 1.2) / 2, 0.1));
  }
  const addMerged = (geos, color, rough = 0.95) => {
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos.map((g) => g.index ? g.toNonIndexed() : g).map((g) => { g.deleteAttribute("uv"); return g; })),
      new THREE.MeshStandardMaterial({ color, roughness: rough, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  addMerged([...kerb, ...kerbJoints], "#cfd1cc");
  addMerged([...asphalt, ...joints], "#4f545c", 0.9);
  addMerged(paths, "#b9614a"); // red paver walkways, as seen on campus

  // Yellow-and-black kerb stones along both edges of drivable roads (the DIT look).
  const kerbTex = (() => {
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 4;
    const x = cv.getContext("2d");
    x.fillStyle = "#f2c230"; x.fillRect(0, 0, 32, 4);
    x.fillStyle = "#1d1d1f"; x.fillRect(32, 0, 32, 4);
    const tx = new THREE.CanvasTexture(cv); tx.wrapS = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace;
    tx.magFilter = THREE.NearestFilter;
    return tx;
  })();
  const kerbGeos = [], lineGeos = [];
  for (const r of data.roads) {
    if (r.pts.length < 2 || r.w <= 2.5) continue;
    for (const side of [-1, 1]) kerbGeos.push(kerbStrip(r.pts, r.w / 2 + 0.15, side, 0.35, 0.3));
    if (r.w >= 5) { const dl = dashLine(r.pts, 0.16); if (dl.attributes.position) lineGeos.push(dl); }
  }
  if (kerbGeos.length) {
    const m = new THREE.Mesh(mergeGeometries(kerbGeos), new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.7 }));
    m.castShadow = false; m.receiveShadow = true;
    scene.add(m);
  }
  if (lineGeos.length) {
    scene.add(new THREE.Mesh(mergeGeometries(lineGeos), new THREE.MeshBasicMaterial({ color: "#f4f4ef", transparent: true, opacity: 0.85 })));
  }

  if (data.boundary && data.boundary.length > 2) buildWalls(scene, data.boundary, data.roads, (data.connectors || []).filter((c) => c.type === "gate"));

  // ---- buildings ----
  const facades = {};
  for (const name of Object.keys(STYLES)) {
    const f = makeFacade(name, anisotropy);
    const mat = new THREE.MeshStandardMaterial({
      map: f.map, emissiveMap: f.emissiveMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0,
      roughness: 0.85, metalness: 0.02,
    });
    facades[name] = mat;
    handles.facadeMats.push(mat);
  }
  const roofMats = {};
  const roofMat = (color) => (roofMats[color] ||= new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  const detailMat = new THREE.MeshStandardMaterial({ color: "#a9adb3", roughness: 0.8 });
  const solarMat = new THREE.MeshStandardMaterial({ color: "#2b3d5c", roughness: 0.35, metalness: 0.3 });
  const parapetMat = new THREE.MeshStandardMaterial({ color: "#eeeae2", roughness: 0.9 });

  for (const b of data.buildings) {
    const h = buildingHeight(b);
    const st = STYLES[b.style] || STYLES.concrete;
    const group = new THREE.Group();
    group.userData = { kind: "building", id: b.id };

    const walls = new THREE.Mesh(wallGeometry(b.pts, 0, h), facades[b.style] || facades.concrete);
    walls.castShadow = walls.receiveShadow = true;
    group.add(walls);

    const pitched = b.roof === "red" && b.pts.length === 4;
    if (pitched) {
      const roof = new THREE.Mesh(hipRoof(b.pts, h), roofMat("#a8472f"));
      roof.castShadow = roof.receiveShadow = true;
      group.add(roof);
    } else {
      const roof = new THREE.Mesh(flatPoly(b.pts, h), roofMat(b.roof === "red" ? "#a8472f" : st.roof));
      roof.castShadow = roof.receiveShadow = true;
      group.add(roof);
      // parapet: a thin light rim on the roof edge
      const rim = new THREE.Mesh(wallGeometry(b.pts, h, h + 0.7), parapetMat);
      rim.castShadow = true;
      group.add(rim);
      // rooftop details: water tanks / AC units, solar panels on modern blocks
      const rnd = seeded(b.id.split("").reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7));
      const [ccx, ccy] = b.c;
      const n = 2 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const px = ccx + (rnd() - 0.5) * 8, py = ccy + (rnd() - 0.5) * 8;
        const s = 1.2 + rnd() * 1.6;
        const box = new THREE.Mesh(new THREE.BoxGeometry(s, 1.1 + rnd(), s), detailMat);
        box.position.set(px, h + 0.6, -py);
        box.castShadow = true;
        group.add(box);
      }
      if (b.solar || b.style === "modern") {
        for (let i = 0; i < 4; i++) {
          const p = new THREE.Mesh(new THREE.BoxGeometry(5, 0.15, 2.2), solarMat);
          p.position.set(ccx + (i % 2 ? 4 : -4), h + 0.5, -(ccy + (i < 2 ? 4 : -4)));
          p.rotation.x = -0.25;
          group.add(p);
        }
      }
    }
    if (b.id === "AUD" || /rooftop/i.test(b.name)) { // rooftop cafe: a few umbrellas
      const [ccx, ccy] = b.c;
      const umbMat = new THREE.MeshStandardMaterial({ color: "#d9483b", roughness: 0.8 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2, r = 7;
        const u = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.8, 8), umbMat);
        u.position.set(ccx + Math.cos(a) * r, h + 2.6, -(ccy + Math.sin(a) * r));
        u.castShadow = true;
        group.add(u);
      }
    }
    group.traverse((o) => { if (o.isMesh) o.userData = { kind: "building", id: b.id }; });
    scene.add(group);
    handles.pickables.push(group);
    handles.buildingById.set(b.id, { data: b, group, height: h });
  }

  // ---- surrounding houses detected from imagery (merged, not clickable) ----
  if (data.context && data.context.length) {
    const wallGeos = [], roofGeos = [];
    const col = new THREE.Color();
    for (const [cx, cy, w, d, ang, levels, roofHex] of data.context) {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const corner = (u, v) => [cx + u * ca - v * sa, cy + u * sa + v * ca];
      const pts = [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)];
      const h = levels * FLOOR * 0.92;
      wallGeos.push(wallGeometry(pts, 0, h));
      const roof = flatPoly(pts, h).toNonIndexed();
      col.set(roofHex);
      const n = roof.attributes.position.count;
      const cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) cols.set([col.r, col.g, col.b], i * 3);
      roof.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      roof.deleteAttribute("uv");
      roofGeos.push(roof);
    }
    const walls = new THREE.Mesh(mergeGeometries(wallGeos), facades.house);
    walls.castShadow = walls.receiveShadow = true;
    const roofs = new THREE.Mesh(mergeGeometries(roofGeos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    roofs.castShadow = roofs.receiveShadow = true;
    scene.add(walls, roofs);
  }

  if (data.connectors) buildConnectors(scene, data.connectors, handles);

  // ---- trees (instanced) ----
  const rnd = seeded(42);
  const trees = lite ? data.trees.filter((_, i) => i % 2 === 0) : data.trees;
  const round = trees.filter((t) => t[3] === 0), conif = trees.filter((t) => t[3] === 1);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 3, 5); trunkGeo.translate(0, 1.5, 0);
  const roundGeo = new THREE.IcosahedronGeometry(2.6, 0); roundGeo.scale(1, 1.1, 1); roundGeo.translate(0, 4.6, 0);
  const coneGeo = new THREE.ConeGeometry(2.1, 6.5, 6); coneGeo.translate(0, 5.6, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: "#6b4a32", roughness: 1 });
  const roundMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, flatShading: true });
  const coneMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, flatShading: true });
  handles.treeMats = { round: roundMat, conifer: coneMat };
  const mkInst = (geo, mat, list, colorFn) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    list.forEach((t, i) => {
      const sc = t[2];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      s.set(sc, sc * (0.9 + rnd() * 0.3), sc);
      p.set(t[0], 0, -t[1]);
      m.compose(p, q, s);
      im.setMatrixAt(i, m);
      if (colorFn) { colorFn(c); im.setColorAt(i, c); }
    });
    im.castShadow = true; im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    return im;
  };
  const leafVar = (c) => c.setHSL(0.27 + (rnd() - 0.5) * 0.05, 0.45 + rnd() * 0.15, 0.3 + rnd() * 0.12);
  const conVar = (c) => c.setHSL(0.3 + (rnd() - 0.5) * 0.04, 0.32 + rnd() * 0.1, 0.22 + rnd() * 0.07);
  mkInst(trunkGeo, trunkMat, trees);
  mkInst(roundGeo, roundMat, round, leafVar);
  mkInst(coneGeo, coneMat, conif, conVar);

  // ---- street lamps along drivable roads ----
  const lampPts = [];
  for (const r of data.roads) {
    if (r.w <= 2.5 || r.w > 8) continue;
    let carry = 10;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      const nx = -dy / len, ny = dx / len;
      let d = carry;
      while (d < len) {
        const t = d / len, side = lampPts.length % 2 ? 1 : -1;
        const off = r.w / 2 + 0.9;
        lampPts.push([a[0] + dx * t + nx * off * side, a[1] + dy * t + ny * off * side]);
        d += 32;
      }
      carry = d - len;
    }
  }
  const inExt = (p) => p[0] > ext.minX && p[0] < ext.maxX && p[1] > ext.minY && p[1] < ext.maxY;
  const lamps = lampPts.filter(inExt);
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 5.2, 5); poleGeo.translate(0, 2.6, 0);
  const bulbGeo = new THREE.SphereGeometry(0.32, 8, 6); bulbGeo.translate(0, 5.3, 0);
  const poolGeo = new THREE.PlaneGeometry(14, 14); poolGeo.rotateX(-Math.PI / 2); poolGeo.translate(0, 0.25, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: "#4a4f57", roughness: 0.7 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: "#fff3d6", emissive: new THREE.Color("#ffd28a"), emissiveIntensity: 0 });
  const poolMat = new THREE.MeshBasicMaterial({ map: makeGlow(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const mkLamp = (geo, mat, shadow) => {
    const im = new THREE.InstancedMesh(geo, mat, lamps.length);
    const m = new THREE.Matrix4();
    lamps.forEach((p, i) => { m.makeTranslation(p[0], 0, -p[1]); im.setMatrixAt(i, m); });
    im.castShadow = shadow;
    scene.add(im);
    return im;
  };
  mkLamp(poleGeo, poleMat, true);
  mkLamp(bulbGeo, bulbMat, false);
  const pools = mkLamp(poolGeo, poolMat, false);
  pools.renderOrder = 2;
  handles.lamps = { bulbMat, poolMat, count: lamps.length };

  return handles;
}


// ---------- bridges, ramps, stairs, gates, amphitheatre (from the route log) ----------
function buildConnectors(scene, list, handles) {
  const deckMat = new THREE.MeshStandardMaterial({ color: "#d8d2c6", roughness: 0.8 });
  const railMat = new THREE.MeshStandardMaterial({ color: "#c9ccd1", metalness: 0.6, roughness: 0.35 });
  const roofMat = new THREE.MeshStandardMaterial({ color: "#a8472f", roughness: 0.8 });
  const parMat = new THREE.MeshStandardMaterial({ color: "#c2402f", roughness: 0.8 });
  const stepMat = new THREE.MeshStandardMaterial({ color: "#bdb5a8", roughness: 0.9 });
  const pierMat = new THREE.MeshStandardMaterial({ color: "#efe7d8", roughness: 0.85 });
  const hutMat = new THREE.MeshStandardMaterial({ color: "#efe9dc", roughness: 0.85 });
  const gateMat = new THREE.MeshStandardMaterial({ color: "#2a2d33", metalness: 0.5, roughness: 0.5 });
  const tag = (o, c) => { o.traverse((m) => { if (m.isMesh) m.userData = { kind: "connector", id: c.name }; }); handles.pickables.push(o); };

  for (const c of list) {
    const g = new THREE.Group();
    if (c.type === "bridge" || c.type === "ramp") {
      const pts = c.pts, n = pts.length, deck = c.deck || 6;
      for (let i = 0; i < n - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        // ramps climb from ground to deck height; bridges stay level
        const h0 = c.type === "ramp" ? (deck * i) / (n - 1) : deck, h1 = c.type === "ramp" ? (deck * (i + 1)) / (n - 1) : deck;
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], hm = (h0 + h1) / 2;
        const tilt = Math.atan2(h1 - h0, len);
        const seg = new THREE.Group();
        seg.position.set(mid[0], hm, -mid[1]);
        seg.rotation.y = ang;
        const inner = new THREE.Group(); inner.rotation.z = tilt; seg.add(inner);
        const W = c.type === "bridge" ? 3.2 : 2.6;
        const d = new THREE.Mesh(new THREE.BoxGeometry(len + 0.4, 0.35, W), deckMat); d.castShadow = d.receiveShadow = true; inner.add(d);
        for (const s of [-1, 1]) {
          const p = new THREE.Mesh(new THREE.BoxGeometry(len, c.type === "bridge" ? 1.1 : 0.9, 0.12), c.type === "ramp" ? parMat : railMat);
          p.position.set(0, 0.6, s * (W / 2)); inner.add(p);
        }
        if (c.covered) {
          const r = new THREE.Mesh(new THREE.BoxGeometry(len + 0.6, 0.2, W + 0.8), roofMat); r.position.y = 2.9; r.castShadow = true; inner.add(r);
          for (const s of [-1, 1]) for (let k = -1; k <= 1; k++) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.7, 0.15), railMat); post.position.set((k * len) / 2.2, 1.5, s * (W / 2)); inner.add(post);
          }
        }
        g.add(seg);
        // support piers under each joint
        if (deck > 1.5) for (const p of [a, b]) {
          const hh = c.type === "ramp" ? (p === a ? h0 : h1) : deck;
          if (hh < 1) continue;
          const pier = new THREE.Mesh(new THREE.BoxGeometry(0.7, hh, 0.7), pierMat);
          pier.position.set(p[0], hh / 2, -p[1]); pier.castShadow = true; g.add(pier);
        }
      }
    } else if (c.type === "stairs") {
      const [a, b] = c.pts, ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = 7;
      for (let i = 0; i < steps; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(len / steps + 0.05, 0.22 * (i + 1), 4), stepMat);
        const t = (i + 0.5) / steps;
        s.position.set(a[0] + (b[0] - a[0]) * t, 0.11 * (i + 1), -(a[1] + (b[1] - a[1]) * t));
        s.rotation.y = ang; s.castShadow = s.receiveShadow = true; g.add(s);
      }
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), railMat);
        const ox = -Math.sin(ang) * 2.1 * side, oy = Math.cos(ang) * 2.1 * side;
        rail.position.set((a[0] + b[0]) / 2 + ox, 1.2, -((a[1] + b[1]) / 2 + oy));
        rail.rotation.y = ang; rail.rotation.z = Math.atan2(1.5, len); g.add(rail);
      }
    } else if (c.type === "gate") {
      // black vertical-bar steel gate between brick pillars with cream caps + guard cabin (BH 0:55, V6 1:10, KG 2:00)
      const [p] = c.pts;
      const gg = new THREE.Group(); gg.position.set(p[0], 0, -p[1]); gg.rotation.y = c.ang || 0;
      const main = c.name === "DIT Main Gate";
      const half = main ? 6.5 : 4.4;
      const brickM = new THREE.MeshStandardMaterial({ color: "#9c4733", roughness: 0.9 });
      const capM = new THREE.MeshStandardMaterial({ color: "#f0e9dc", roughness: 0.8 });
      for (const s of [-1, 1]) {
        const pw = main ? 1.6 : 1.1, ph = main ? 4.2 : 3.2;
        const pil = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pw), brickM); pil.position.set(s * half, ph / 2, 0); pil.castShadow = true; gg.add(pil);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(pw + 0.25, 0.25, pw + 0.25), capM); cap.position.set(s * half, ph + 0.12, 0); gg.add(cap);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(main ? 0.4 : 0.28, 10, 8), capM); ball.position.set(s * half, ph + 0.5, 0); gg.add(ball);
      }
      const leafW = half - 0.6;
      const leafGeo = new THREE.PlaneGeometry(leafW, 2.3);
      const uv = leafGeo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * leafW * 6);
      const leafMat = new THREE.MeshStandardMaterial({ map: barTexture("#1c1d20"), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.4 });
      // leaves stand open, swung inward
      for (const s of [-1, 1]) {
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        const hinge = new THREE.Group(); hinge.position.set(s * (half - 0.6), 1.25, 0); hinge.rotation.y = s * 1.2; gg.add(hinge);
        leaf.position.set(-s * leafW / 2, 0, 0); hinge.add(leaf);
      }
      const hut = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.4), hutMat); hut.position.set(half + 3.2, 1.3, -2.2); hut.castShadow = true; gg.add(hut);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.1, 4), roofMat); roof.rotation.y = Math.PI / 4; roof.position.set(half + 3.2, 3.15, -2.2); gg.add(roof);
      if (main) { // boom barrier
        const arm = new THREE.Mesh(new THREE.BoxGeometry(half * 1.6, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: "#e23b2e" }));
        arm.position.set(0, 1.0, 2.5); gg.add(arm);
      }
      g.add(gg);
    } else if (c.type === "portico") {
      // flat cream canopy on dark brick piers, slatted underside, at the Chanakya entrance (NR 4:18–4:22)
      const [a, b] = c.pts;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const grp = new THREE.Group(); grp.position.set((a[0] + b[0]) / 2, 0, -(a[1] + b[1]) / 2); grp.rotation.y = ang;
      const pierM = new THREE.MeshStandardMaterial({ color: "#5a3a2f", roughness: 0.9 });
      for (const s of [-1, 1]) for (const d of [-1, 1]) {
        const pr = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6, 1.2), pierM); pr.position.set(s * (len / 2 - 0.8), 3, d * 3.2); pr.castShadow = true; grp.add(pr);
      }
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 1.4, 8.6), new THREE.MeshStandardMaterial({ color: "#e4d6b6", roughness: 0.7 }));
      canopy.position.y = 6.7; canopy.castShadow = true; grp.add(canopy);
      for (let k = -8; k <= 8; k++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(len + 1.6, 0.12, 0.18), new THREE.MeshStandardMaterial({ color: "#2b2622" }));
        slat.position.set(0, 5.95, k * 0.48); grp.add(slat);
      }
      g.add(grp);
    } else if (c.type === "cafe") {
      // Café Frisco: two hexagonal gazebos with dark pyramid roofs, signboard, picnic benches (NR 0:40–0:52)
      const [p] = c.pts;
      const postM = new THREE.MeshStandardMaterial({ color: "#d9d2c3", roughness: 0.8 });
      const roofM = new THREE.MeshStandardMaterial({ color: "#3b3f45", roughness: 0.7, flatShading: true });
      const woodM = new THREE.MeshStandardMaterial({ color: "#c9b28c", roughness: 0.9 });
      for (const [dx, dy] of [[-4.5, 0], [4.5, 1]]) {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 0.3, 6), postM); base.position.set(p[0] + dx, 0.15, -(p[1] + dy)); base.receiveShadow = true; g.add(base);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.6, 0.22), postM);
          post.position.set(p[0] + dx + Math.cos(a) * 2.8, 1.6, -(p[1] + dy) + Math.sin(a) * 2.8); post.castShadow = true; g.add(post);
        }
        const roof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.9, 6), roofM); roof.position.set(p[0] + dx, 3.85, -(p[1] + dy)); roof.castShadow = true; g.add(roof);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 6), roofM); tip.position.set(p[0] + dx, 5.1, -(p[1] + dy)); g.add(tip);
      }
      // signboard
      const cv = document.createElement("canvas"); cv.width = 256; cv.height = 64;
      const x = cv.getContext("2d"); x.fillStyle = "#3a3f46"; x.fillRect(0, 0, 256, 64);
      x.fillStyle = "#f4efe6"; x.font = "bold 34px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("Café Frisco", 128, 34);
      const st = new THREE.CanvasTexture(cv); st.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshStandardMaterial({ map: st, side: THREE.DoubleSide }));
      sign.position.set(p[0], 4.2, -(p[1] - 3.5)); g.add(sign);
      // picnic table-benches
      for (const [bx, by] of [[-1, -6], [3, -6.5], [7.5, -5.5], [-6, -5]]) {
        const tb = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.9), woodM); tb.position.set(p[0] + bx, 0.78, -(p[1] + by)); tb.castShadow = true; g.add(tb);
        for (const s of [-1, 1]) {
          const bench = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.35), woodM); bench.position.set(p[0] + bx, 0.45, -(p[1] + by) + s * 0.75); g.add(bench);
        }
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.75, 0.15), woodM); leg.position.set(p[0] + bx, 0.38, -(p[1] + by)); g.add(leg);
      }
      // red sheet fence behind (NR 0:44–0:52)
      const fence = new THREE.Mesh(new THREE.BoxGeometry(22, 2.4, 0.1), new THREE.MeshStandardMaterial({ color: "#b23a2e", roughness: 0.6, metalness: 0.2 }));
      fence.position.set(p[0] + 2, 1.2, -(p[1] + 6)); fence.castShadow = true; g.add(fence);
    } else if (c.type === "amphitheatre") {
      const [p] = c.pts;
      for (let i = 0; i < 5; i++) {
        const r0 = 6 + i * 1.1;
        const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 1.1, 28, 1, 0, Math.PI), stepMat);
        ring.rotation.x = -Math.PI / 2; ring.position.set(p[0], 0.15 + i * 0.4, -p[1]);
        ring.receiveShadow = true; g.add(ring);
        const riser = new THREE.Mesh(new THREE.CylinderGeometry(r0 + 1.1, r0 + 1.1, 0.4, 28, 1, true, -Math.PI / 2, Math.PI), stepMat);
        riser.position.set(p[0], 0.15 + i * 0.4 - 0.2, -p[1]); g.add(riser);
      }
      const court = new THREE.Mesh(new THREE.PlaneGeometry(11, 7), new THREE.MeshStandardMaterial({ color: "#8f9a98", roughness: 0.9 }));
      court.rotation.x = -Math.PI / 2; court.position.set(p[0], 0.12, -p[1] + 3); g.add(court);
    }
    tag(g, c);
    scene.add(g);
  }
}


// ---------- boundary wall, as seen in the videos ----------
// rubble-stone plinth, red brick, cream band and coping, brick pillars with cream caps,
// dark green steel railing panels on top (NR 4:26–5:10, V6 0:40–1:30, KG 2:08).
function barTexture(color, barsPerUnit = 1) {
  const cv = document.createElement("canvas"); cv.width = 32; cv.height = 64;
  const x = cv.getContext("2d");
  x.clearRect(0, 0, 32, 64);
  x.fillStyle = color;
  x.fillRect(0, 0, 32, 5); x.fillRect(0, 59, 32, 5);   // top and bottom rails
  x.fillRect(13, 0, 6, 64);                            // one upright per tile
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function stripBox(a, b, w, y0, y1) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const g = new THREE.BoxGeometry(len + w, y1 - y0, w);   // overhang by the thickness so corners close
  g.rotateY(Math.atan2(b[1] - a[1], b[0] - a[0]));
  g.translate((a[0] + b[0]) / 2, (y0 + y1) / 2, -(a[1] + b[1]) / 2);
  return g;
}
function buildWalls(scene, pts, roads = [], gates = []) {
  const stone = [], brick = [], cream = [], piers = [], caps = [], rails = [];
  // openings: wherever a drivable road crosses the wall, and at each gate
  const segs = [];
  for (const r of roads) if (r.w > 2.5) for (let i = 0; i < r.pts.length - 1; i++) segs.push([r.pts[i], r.pts[i + 1], r.w / 2 + 1.2]);
  const gatePts = gates.map((g) => g.pts[0]);
  // the wall opens only at gates; everywhere else it is one continuous line
  const isOpen = (x, y) => gates.some((g) => Math.hypot(x - g.pts[0][0], y - g.pts[0][1]) < (g.name === "DIT Main Gate" ? 6.6 : 4.6));
  const addSpan = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.4) return;
    stone.push(stripBox(a, b, 0.6, 0, 0.6));
    brick.push(stripBox(a, b, 0.4, 0.6, 2.1));
    cream.push(stripBox(a, b, 0.44, 1.6, 1.72));
    cream.push(stripBox(a, b, 0.48, 2.1, 2.2));
    const n = Math.max(1, Math.round(len / 3.6));
    for (let k = 0; k <= n; k++) {
      const t = k / n, px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
      const p = new THREE.BoxGeometry(0.62, 2.7, 0.62); p.translate(px, 1.35, -py); piers.push(p);
      const c = new THREE.BoxGeometry(0.8, 0.16, 0.8); c.translate(px, 2.78, -py); caps.push(c);
    }
    const r = new THREE.PlaneGeometry(len, 0.95);
    const uv = r.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * len * 4);
    r.rotateY(Math.atan2(b[1] - a[1], b[0] - a[0]));
    r.translate((a[0] + b[0]) / 2, 2.7, -(a[1] + b[1]) / 2);
    rails.push(r);
  };
  const outline = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / 0.5));
    let runStart = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const open = isOpen(x, y);
      if (!open && runStart === null) runStart = [x, y];
      if ((open || k === n) && runStart !== null) { const end = open ? [a[0] + (b[0] - a[0]) * ((k - 1) / n), a[1] + (b[1] - a[1]) * ((k - 1) / n)] : [x, y]; addSpan(runStart, end); outline.push([runStart, end]); runStart = null; }
    }
  }
  const add = (geos, mat, shadow = true) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = shadow; m.receiveShadow = true; scene.add(m);
  };
  add(stone, new THREE.MeshStandardMaterial({ color: "#8d867b", roughness: 1 }));
  add(brick, new THREE.MeshStandardMaterial({ color: "#a24c37", roughness: 0.9 }));
  add(cream, new THREE.MeshStandardMaterial({ color: "#ece4d3", roughness: 0.8 }));
  add(piers, new THREE.MeshStandardMaterial({ color: "#9c4733", roughness: 0.9 }));
  add(caps, new THREE.MeshStandardMaterial({ color: "#f0e9dc", roughness: 0.8 }));
  add(rails, new THREE.MeshStandardMaterial({ map: barTexture("#2f4a3c"), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.5 }), false);
  // a brick-paved strip along the foot of the wall makes the boundary read clearly from above
  const band = outline.map(([a, b]) => ribbon([a, b], 3.2, 0.07).toNonIndexed());
  if (band.length) {
    const bm = new THREE.Mesh(mergeGeometries(band), new THREE.MeshStandardMaterial({ color: "#9a4433", roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
    bm.receiveShadow = true; scene.add(bm);
  }
  // a 1-pixel outline on top so the boundary still reads when zoomed far out
  const lp = [];
  for (const [a, b] of outline) lp.push(new THREE.Vector3(a[0], 2.25, -a[1]), new THREE.Vector3(b[0], 2.25, -b[1]));
  const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lp), new THREE.LineBasicMaterial({ color: "#b03a26" }));
  line.renderOrder = 3; scene.add(line);
}


/** Basketball court lines + hoops on a 4-corner court outline. */
function courtMarkings(scene, P) {
  const lineMat = new THREE.MeshBasicMaterial({ color: "#f4f1ea" });
  const keyMat = new THREE.MeshStandardMaterial({ color: "#c8553d", roughness: 0.9 });
  const e01 = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]), e12 = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]);
  // long axis u, short axis v
  const [A, B, C] = e01 >= e12 ? [P[0], P[1], P[2]] : [P[1], P[2], P[3]];
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]), W = Math.hypot(C[0] - B[0], C[1] - B[1]);
  const u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], v = [(C[0] - B[0]) / W, (C[1] - B[1]) / W];
  const ctr = [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2];
  const at = (s, t) => [ctr[0] + u[0] * s + v[0] * t, ctr[1] + u[1] * s + v[1] * t];
  const g = new THREE.Group();
  const ang = Math.atan2(u[1], u[0]);
  const seg = (a, b, w = 0.12) => g.add(new THREE.Mesh(ribbon([a, b], w, 0.13), lineMat));
  seg(at(0, -W / 2), at(0, W / 2));                                  // centre line
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 1.84, 32), lineMat);
  ring.rotation.x = -Math.PI / 2; const c0 = at(0, 0); ring.position.set(c0[0], 0.13, -c0[1]); g.add(ring);
  const hoopM = new THREE.MeshStandardMaterial({ color: "#e7e9ec", metalness: 0.5, roughness: 0.4 });
  const rimM = new THREE.MeshStandardMaterial({ color: "#e0582f" });
  for (const s of [-1, 1]) {
    const key = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 4.6), keyMat);    // painted key
    key.rotation.x = -Math.PI / 2; key.rotation.z = ang;
    const k = at(s * (L / 2 - 2.8), 0); key.position.set(k[0], 0.11, -k[1]); g.add(key);
    // (three-point arcs omitted: the courts here are compact)
    // hoop: pole, backboard, rim
    const hp = at(s * (L / 2 + 0.6), 0), bb = at(s * (L / 2 - 1.2), 0);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.4, 8), hoopM); pole.position.set(hp[0], 1.7, -hp[1]); pole.castShadow = true; g.add(pole);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.05, 1.8), hoopM); board.position.set(bb[0], 3.3, -bb[1]); board.rotation.y = ang; board.castShadow = true; g.add(board);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.08), hoopM); const am = at(s * (L / 2 - 0.3), 0); arm.position.set(am[0], 3.3, -am[1]); arm.rotation.y = ang; g.add(arm);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.025, 6, 16), rimM); const rc = at(s * (L / 2 - 1.55), 0);
    rim.rotation.x = Math.PI / 2; rim.position.set(rc[0], 3.05, -rc[1]); g.add(rim);
  }
  // court boundary lines
  const corners = [at(-L / 2, -W / 2), at(L / 2, -W / 2), at(L / 2, W / 2), at(-L / 2, W / 2)];
  for (let i = 0; i < 4; i++) seg(corners[i], corners[(i + 1) % 4]);
  scene.add(g);
}
