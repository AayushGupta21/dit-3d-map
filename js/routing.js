// Walking routes over the OSM road network (Dijkstra). Buildings connect to the nearest road point.

export function buildGraph(roads) {
  const nodes = new Map(); // key -> {p:[x,y], edges:[{to, w}]}
  const keyOf = (r, i) => (r.nodes && r.nodes[i] != null ? "n" + r.nodes[i] : `p${r.pts[i][0].toFixed(1)},${r.pts[i][1].toFixed(1)}`);
  const segs = [];
  for (const r of roads) {
    for (let i = 0; i < r.pts.length; i++) {
      const k = keyOf(r, i);
      if (!nodes.has(k)) nodes.set(k, { p: r.pts[i], edges: [] });
      if (i > 0) {
        const kp = keyOf(r, i - 1);
        const w = dist(r.pts[i], r.pts[i - 1]);
        nodes.get(k).edges.push({ to: kp, w });
        nodes.get(kp).edges.push({ to: k, w });
        segs.push({ a: kp, b: k });
      }
    }
  }
  // Join road ends that almost touch (OSM gaps) so the network is connected.
  const arr = [...nodes.entries()];
  for (let i = 0; i < arr.length; i++) {
    const [ki, ni] = arr[i];
    if (ni.edges.length > 1) continue;
    let best = null, bd = 12;
    for (let j = 0; j < arr.length; j++) {
      if (i === j) continue;
      const d = dist(ni.p, arr[j][1].p);
      if (d < bd && !ni.edges.some((e) => e.to === arr[j][0])) { bd = d; best = arr[j][0]; }
    }
    if (best) { ni.edges.push({ to: best, w: bd }); nodes.get(best).edges.push({ to: ki, w: bd }); }
  }
  return { nodes, segs };
}

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

function nearestOnSegs(graph, p) {
  let best = null;
  for (const s of graph.segs) {
    const A = graph.nodes.get(s.a).p, B = graph.nodes.get(s.b).p;
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / L2));
    const q = [A[0] + dx * t, A[1] + dy * t];
    const d = dist(p, q);
    if (!best || d < best.d) best = { d, q, s, t };
  }
  return best;
}

/** Shortest walking path from point a to point b ([x,y] in metres). */
export function route(graph, a, b) {
  const sa = nearestOnSegs(graph, a), sb = nearestOnSegs(graph, b);
  if (!sa || !sb) return { path: [a, b], meters: dist(a, b), straight: true };

  // temporary nodes on the road where each end joins it
  const nodes = graph.nodes;
  const tmp = (id, snap) => {
    const A = nodes.get(snap.s.a), B = nodes.get(snap.s.b);
    return { id, p: snap.q, edges: [{ to: snap.s.a, w: dist(snap.q, A.p) }, { to: snap.s.b, w: dist(snap.q, B.p) }] };
  };
  const S = tmp("__s", sa), T = tmp("__t", sb);
  const get = (k) => (k === "__s" ? S : k === "__t" ? T : nodes.get(k));
  const extra = new Map(); // edges into T from its segment ends
  extra.set(sb.s.a, [{ to: "__t", w: dist(sb.q, nodes.get(sb.s.a).p) }]);
  extra.set(sb.s.b, [...(extra.get(sb.s.b) || []), { to: "__t", w: dist(sb.q, nodes.get(sb.s.b).p) }]);
  if (sa.s === sb.s) S.edges.push({ to: "__t", w: dist(sa.q, sb.q) });

  const D = new Map([["__s", 0]]), prev = new Map(), done = new Set();
  const heap = [["__s", 0]];
  while (heap.length) {
    let bi = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i][1] < heap[bi][1]) bi = i;
    const [k, d] = heap.splice(bi, 1)[0];
    if (done.has(k)) continue;
    done.add(k);
    if (k === "__t") break;
    const n = get(k);
    for (const e of [...n.edges, ...(extra.get(k) || [])]) {
      const nd = d + e.w;
      if (nd < (D.get(e.to) ?? Infinity)) { D.set(e.to, nd); prev.set(e.to, k); heap.push([e.to, nd]); }
    }
  }
  if (!D.has("__t")) return { path: [a, b], meters: dist(a, b), straight: true };
  const path = [];
  for (let k = "__t"; k; k = prev.get(k)) path.push(get(k).p);
  path.reverse();
  const full = [a, ...path, b];
  return { path: full, meters: D.get("__t") + sa.d + sb.d, straight: false };
}
