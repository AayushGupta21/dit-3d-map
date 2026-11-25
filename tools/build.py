"""Build data/campus.js (local metres) from the source data files.

Sources (edit these, then re-run):
  data/buildings.json  traced building outlines in lat/lng (+ name, category, levels, style)
  data/features.json   grounds / courts
  data/places.json     extra named points (gates, canteens, ATMs...)
  data/osm.json        cached OpenStreetMap roads (ODbL)

Optional imagery step (regenerates assets/ground.jpg and tree positions):
  python3 tools/build.py --imagery path/to/campus_z18.jpg path/to/campus_z18.json

Run:  python3 tools/build.py
"""
import json, math, os, sys, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, *p)

# Scene origin and extent (lat/lng). Origin is roughly the middle of campus.
LAT0, LNG0 = 30.39870, 78.07610
EXTENT = {"south": 30.3958, "north": 30.4025, "west": 78.0727, "east": 78.0825}

M_PER_DEG_LAT = 110574.0
M_PER_DEG_LNG = 111320.0 * math.cos(math.radians(LAT0))


def to_local(lat, lng):
    """x = metres east, y = metres north of origin."""
    return [round((lng - LNG0) * M_PER_DEG_LNG, 2), round((lat - LAT0) * M_PER_DEG_LAT, 2)]


def in_extent(lat, lng, pad=0.0005):
    return (EXTENT["south"] - pad <= lat <= EXTENT["north"] + pad
            and EXTENT["west"] - pad <= lng <= EXTENT["east"] + pad)


def poly_area(pts):
    a = 0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return a / 2


def centroid(pts):
    return [round(sum(p[0] for p in pts) / len(pts), 2), round(sum(p[1] for p in pts) / len(pts), 2)]


def point_in_poly(x, y, pts):
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]; xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


OUTSIDE_ROADS = {621301955}  # branch road to IMS Unison University

SKIP_OSM_NAMES = {"DIT University", "Girls Hostel", "DIT boys Hostel"}

ROAD_WIDTH = {"motorway": 12, "trunk": 11, "primary": 9, "secondary": 8, "tertiary": 7,
              "unclassified": 6, "residential": 5.5, "service": 4.5, "living_street": 4.5,
              "track": 3.5, "footway": 2.2, "path": 2, "pedestrian": 4, "steps": 2, "cycleway": 2.2}


def auto_boundary(polys, lines, pad=11.0, close=34.0, res=2.0, simplify=3.0):
    """Wall line hugging everything on campus: rasterise campus shapes, dilate by `pad`,
    close gaps up to `close` metres, fill holes, trace the outer contour and simplify it."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter
    allpts = [p for poly in polys for p in poly] + [p for ln in lines for p in ln]
    minx = min(p[0] for p in allpts) - pad - close - 10; maxx = max(p[0] for p in allpts) + pad + close + 10
    miny = min(p[1] for p in allpts) - pad - close - 10; maxy = max(p[1] for p in allpts) + pad + close + 10
    W, H = int((maxx - minx) / res) + 1, int((maxy - miny) / res) + 1
    G = lambda p: ((p[0] - minx) / res, (maxy - p[1]) / res)
    im = Image.new("L", (W, H), 0); d = ImageDraw.Draw(im)
    for poly in polys:
        if len(poly) > 2: d.polygon([G(p) for p in poly], fill=255)
        else: d.line([G(p) for p in poly], fill=255, width=4)
    for ln in lines: d.line([G(p) for p in ln], fill=255, width=4)
    def grow(img, metres, f):
        n = int(round(metres / res))
        while n > 0:
            k = min(n, 6); img = img.filter(f(2 * k + 1)); n -= k
        return img
    im = grow(im, pad + close, ImageFilter.MaxFilter)
    im = grow(im, close, ImageFilter.MinFilter)
    m = np.asarray(im) > 127
    # fill holes: flood the outside from the border
    out = np.zeros_like(m); stack = [(0, 0)]; out[0, 0] = True
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < H and 0 <= nx < W and not out[ny, nx] and not m[ny, nx]:
                out[ny, nx] = True; stack.append((ny, nx))
    m = ~out
    # Moore-neighbour contour trace of the outer edge
    ys, xs = np.nonzero(m); i = np.lexsort((xs, ys))[0]; start = (int(ys[i]), int(xs[i]))
    nb = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    inside = lambda y, x: 0 <= y < H and 0 <= x < W and m[y, x]
    cont = [start]; cur = start; back = 6
    for _ in range(200000):
        found = False
        for k in range(8):
            dir_ = (back + 1 + k) % 8
            ny, nx = cur[0] + nb[dir_][0], cur[1] + nb[dir_][1]
            if inside(ny, nx):
                back = (dir_ + 4) % 8; cur = (ny, nx); found = True; break
        if not found or cur == start: break
        cont.append(cur)
    pts = [[minx + (x + 0.5) * res, maxy - (y + 0.5) * res] for y, x in cont]
    def dp(P, eps):
        if len(P) < 3: return P
        a, b = P[0], P[-1]; dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1e-9
        dists = [abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / L for p in P]
        i = max(range(len(P)), key=lambda k: dists[k])
        if dists[i] > eps: return dp(P[:i + 1], eps)[:-1] + dp(P[i:], eps)
        return [a, b]
    half = len(pts) // 2
    s = dp(pts[:half + 1], simplify)[:-1] + dp(pts[half:] + [pts[0]], simplify)[:-1]
    return [[round(x, 2), round(y, 2)] for x, y in s]


def build():
    buildings = json.load(open(D("data", "buildings.json")))
    features = json.load(open(D("data", "features.json")))
    places = json.load(open(D("data", "places.json"))) if os.path.exists(D("data", "places.json")) else []
    osm = json.load(open(D("data", "osm.json")))["elements"]

    out_b = []
    for b in buildings:
        pts = [to_local(lat, lng) for lat, lng in b["outline"]]
        if poly_area(pts) < 0:
            pts.reverse()  # counter-clockwise
        out_b.append({
            "id": b["id"], "name": b["name"], "cat": b.get("cat", "other"),
            "levels": b.get("levels", 3), "style": b.get("style", "concrete"),
            "roof": b.get("roof", "flat"), "verified": b.get("verified", False),
            "sub": b.get("sub", ""), "solar": b.get("solar", False),
            "pts": pts, "c": centroid(pts),
        })

    out_f = []
    for f in features:
        pts = [to_local(lat, lng) for lat, lng in f["outline"]]
        out_f.append({"id": f["id"], "name": f["name"], "cat": f.get("cat", "sports"), "sub": f.get("sub", ""),
                      "kind": f.get("kind", "field"), "flag": f.get("flag", False), "pts": pts, "c": centroid(pts)})

    roads = []
    for e in osm:
        t = e.get("tags", {})
        if e["type"] != "way" or "highway" not in t or "geometry" not in e:
            continue
        geom = e["geometry"]
        if not any(g and in_extent(g["lat"], g["lon"], 0.002) for g in geom):
            continue
        hw = t["highway"]
        if hw in ("construction", "proposed", "platform", "bus_stop"):
            continue
        roads.append({
            "id": e["id"], "hw": hw, "name": t.get("name", ""),
            "w": ROAD_WIDTH.get(hw, 4),
            "nodes": e.get("nodes", []),
            "pts": [to_local(g["lat"], g["lon"]) for g in geom if g],
        })

    # Hand-traced campus lanes (from imagery + the walking tour) that OSM is missing.
    extra_path = D("data", "roads_campus.json")
    if os.path.exists(extra_path):
        for k, r in enumerate(json.load(open(extra_path))):
            roads.append({"id": f"c{k}", "hw": r["hw"], "name": r.get("name", ""), "campus": True,
                          "w": ROAD_WIDTH.get(r["hw"], 4), "nodes": [],
                          "pts": [to_local(lat, lng) for lat, lng in r["pts"]]})

    out_p = []
    for p in places:
        out_p.append({"name": p["name"], "cat": p.get("cat", "other"), "sub": p.get("sub", ""),
                      "c": to_local(p["lat"], p["lng"])})
    for e in osm:  # named OSM points of interest inside the scene
        t = e.get("tags", {})
        if t.get("name") in SKIP_OSM_NAMES:
            continue  # covered by our own traced buildings
        if e["type"] == "node" and "name" in t and in_extent(e["lat"], e["lon"], 0) and "highway" not in t:
            cat = "food" if t.get("amenity") in ("restaurant", "cafe", "fast_food") else \
                  "hostel" if "hostel" in t["name"].lower() else "other"
            out_p.append({"name": t["name"], "cat": cat, "sub": t.get("amenity", ""),
                          "c": to_local(e["lat"], e["lon"]), "src": "osm"})

    x0, y0 = to_local(EXTENT["south"], EXTENT["west"])
    x1, y1 = to_local(EXTENT["north"], EXTENT["east"])
    extent = {"minX": x0, "minY": y0, "maxX": x1, "maxY": y1}

    trees_path = D("data", "trees.json")
    trees = json.load(open(trees_path)) if os.path.exists(trees_path) else []
    ctx_path = D("data", "context.json")
    context = json.load(open(ctx_path)) if os.path.exists(ctx_path) else []

    bpath = D("data", "boundary.json")
    boundary = [to_local(lat, lng) for lat, lng in json.load(open(bpath))] if os.path.exists(bpath) else []

    cpath = D("data", "connectors.json")
    connectors = []
    if os.path.exists(cpath):
        for c in json.load(open(cpath)):
            connectors.append({**{k: v for k, v in c.items() if k != "pts"}, "pts": [to_local(a, b) for a, b in c["pts"]]})

    # Boundary wall: generated to enclose every campus building, ground, campus lane and connector
    # (gates excluded so they sit on the wall line instead of pushing it out).
    if os.environ.get("DIT_BOUNDARY", "auto") == "auto":
        polys = [x["pts"] for x in out_b] + [x["pts"] for x in out_f] + \
                [c["pts"] for c in connectors if c["type"] not in ("gate",)]
        lines = [r["pts"] for r in roads if r.get("campus")]
        # Campus access road: the stretch from the old gate up to the main road is campus land,
        # so the wall follows it on both sides and the main gate sits at its top end.
        mg = next((c for c in connectors if c.get("access_road")), None)
        if mg:
            rd = next((r for r in roads if r["id"] == mg["access_road"]), None)
            if rd:
                P = rd["pts"]; g = mg["pts"][0]
                # whole road from its campus end (the end farther from the junction) up to the junction
                k = len(P) - 1 if mg.get("to_index", 0) == 0 else 0
                j = mg.get("to_index", 0)
                path = P[k:j - 1 if j else None:-1] if k > j else P[k:j + 1]
                # trim the far end so the wall stops short of the main road
                stop = mg.get("stop_short", 12); rem = stop; out = list(path)
                while len(out) > 1 and rem > 0:
                    a, b2 = out[-2], out[-1]; L = math.hypot(b2[0] - a[0], b2[1] - a[1])
                    if L <= rem: out.pop(); rem -= L
                    else: t = (L - rem) / L; out[-1] = [a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t]; rem = 0
                lines.append(out)
                a, b2 = out[-2], out[-1]
                mg["pts"] = [[round(b2[0], 2), round(b2[1], 2)]]
                mg["ang"] = round(math.atan2(b2[1] - a[1], b2[0] - a[0]) + math.pi / 2, 4)  # gate spans across the road
                mg["fixed"] = True
        boundary = auto_boundary(polys, lines, pad=10.0, close=46.0)
        # Roads that lead to other properties (IMS) stay outside: cut them off at the wall.
        for r in roads:
            if r["id"] in OUTSIDE_ROADS:
                kept = [p for p in r["pts"] if not point_in_poly(p[0], p[1], boundary)]
                r["pts"] = kept
        roads[:] = [r for r in roads if len(r["pts"]) >= 2]
        # put the main gate exactly where the access road crosses the wall
        if mg and rd:
            best = None
            for i in range(len(rd["pts"]) - 1):
                a, c = rd["pts"][i], rd["pts"][i + 1]
                for jj in range(len(boundary)):
                    e, f = boundary[jj - 1], boundary[jj]
                    rx, ry = c[0] - a[0], c[1] - a[1]; sx, sy = f[0] - e[0], f[1] - e[1]
                    den = rx * sy - ry * sx
                    if abs(den) < 1e-9: continue
                    t = ((e[0] - a[0]) * sy - (e[1] - a[1]) * sx) / den; u = ((e[0] - a[0]) * ry - (e[1] - a[1]) * rx) / den
                    if 0 <= t <= 1 and 0 <= u <= 1:
                        q = (a[0] + t * rx, a[1] + t * ry)
                        dd = math.hypot(q[0] - mg["pts"][0][0], q[1] - mg["pts"][0][1])
                        if best is None or dd < best[0]: best = (dd, q, math.atan2(sy, sx))
            if best:
                mg["pts"] = [[round(best[1][0], 2), round(best[1][1], 2)]]; mg["ang"] = round(best[2], 4)

    # Snap the main gate onto the wall where the nearest through-road crosses it, and give every
    # gate the wall's direction so it is drawn in line with the wall.
    def seg_x(a, b, c, d):
        r = (b[0] - a[0], b[1] - a[1]); s = (d[0] - c[0], d[1] - c[1]); den = r[0] * s[1] - r[1] * s[0]
        if abs(den) < 1e-9: return None
        t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den; u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
        return (a[0] + t * r[0], a[1] + t * r[1], math.atan2(s[1], s[0])) if 0 <= t <= 1 and 0 <= u <= 1 else None
    def wall_dir_at(p):
        best = None
        for i in range(len(boundary)):
            a, b2 = boundary[i - 1], boundary[i]
            dx, dy = b2[0] - a[0], b2[1] - a[1]; L2 = dx * dx + dy * dy or 1e-9
            t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
            q = (a[0] + t * dx, a[1] + t * dy); dd = math.hypot(p[0] - q[0], p[1] - q[1])
            if not best or dd < best[0]: best = (dd, q, math.atan2(dy, dx))
        return best
    crossings = []
    for r in roads:
        if r.get("campus") or r["w"] <= 2.5: continue
        for i in range(len(r["pts"]) - 1):
            for j in range(len(boundary)):
                hit = seg_x(r["pts"][i], r["pts"][i + 1], boundary[j - 1], boundary[j])
                if hit: crossings.append(hit)
    for c in connectors:
        if c["type"] != "gate": continue
        if c.get("fixed"):
            continue
        if c["name"] == "DIT Main Gate" and crossings:
            gx, gy = c["pts"][0]
            x, y, ang = min(crossings, key=lambda h: math.hypot(h[0] - gx, h[1] - gy))
            c["pts"] = [[round(x, 2), round(y, 2)]]; c["ang"] = round(ang, 4)
        else:
            dd, q, ang = wall_dir_at(c["pts"][0])
            c["ang"] = round(ang, 4)
            if dd < 8: c["pts"] = [[round(q[0], 2), round(q[1], 2)]]

    # drop auto-detected houses inside the campus wall or on grounds: those are traced by hand
    # (bare sports grounds and paved yards are bright and get mistaken for roofs)
    zones = ([boundary] if len(boundary) > 2 else []) + [f["pts"] for f in out_f]
    context = [h for h in context if not any(point_in_poly(h[0], h[1], z) for z in zones)]
    def _edge(p, poly):
        best = 1e9
        for i in range(len(poly)):
            a, c = poly[i - 1], poly[i]; dx, dy = c[0] - a[0], c[1] - a[1]; L2 = dx * dx + dy * dy or 1e-9
            t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
            best = min(best, math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
        return best
    if len(boundary) > 2:  # nothing may straddle the wall
        context = [h for h in context if _edge(h, boundary) > math.hypot(h[2], h[3]) / 2 + 1.5]

    data = {
        "origin": {"lat": LAT0, "lng": LNG0, "groundAltitude": 920},
        "extent": extent,
        "buildings": out_b, "features": out_f, "roads": roads, "places": out_p, "trees": trees, "context": context,
        "boundary": boundary, "connectors": connectors,
        "attribution": "Roads © OpenStreetMap contributors (ODbL). Building outlines and land cover traced from Esri World Imagery (Esri, Maxar, Earthstar Geographics).",
    }
    with open(D("data", "campus.js"), "w") as f:
        f.write("// Generated by tools/build.py. Do not edit by hand; edit data/*.json and rebuild.\n")
        f.write("window.CAMPUS_DATA = ")
        json.dump(data, f, separators=(",", ":"))
        f.write(";\n")
    print(f"campus.js: {len(out_b)} buildings, {len(out_f)} features, {len(roads)} roads, "
          f"{len(out_p)} places, {len(trees)} trees")
    return data


def imagery(img_path, meta_path):
    """Make a stylised land-cover texture + tree positions from satellite imagery."""
    import numpy as np
    from PIL import Image, ImageFilter
    meta = json.load(open(meta_path))
    Z, X0, Y0 = meta["z"], meta["x0"], meta["y0"]
    N = 2 ** Z * 256

    def ll2px(lat, lng):
        x = (lng + 180) / 360 * N
        y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * N
        return x - X0 * 256, y - Y0 * 256

    left, top = ll2px(EXTENT["north"], EXTENT["west"])
    right, bottom = ll2px(EXTENT["south"], EXTENT["east"])
    src = Image.open(img_path).convert("RGB").crop((round(left), round(top), round(right), round(bottom)))
    W, H = 1024, round(1024 * src.height / src.width)
    src = src.resize((W, H), Image.LANCZOS)
    a = np.asarray(src).astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = (r + g + b) / 3
    gr = g - r  # the imagery has a warm tint, so green-minus-red separates vegetation best

    veg = np.clip((gr + 0.005) * 25, 0, 1) * np.clip((0.45 - lum) * 5, 0, 1)    # green cover
    dense = np.clip((gr - 0.03) * 30, 0, 1) * np.clip((0.30 - lum) * 8, 0, 1)   # dark green = tree canopy
    bare = np.clip((lum - 0.36) * 5, 0, 1) * (1 - veg)                          # riverbed / sand / paving

    def smooth(arr, rad):
        im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rad))
        return np.asarray(im).astype(np.float32) / 255.0

    veg_s, bare_s, dense_s = smooth(veg, 3), smooth(bare, 3), smooth(dense, 2)
    rgb = np.stack([veg_s, bare_s, dense_s], axis=2)
    Image.fromarray((rgb * 255).astype(np.uint8)).save(D("assets", "ground.jpg"), quality=88)

    # Tree positions: jittered grid sampled from dense canopy, kept clear of buildings and roads.
    data = build()
    ext = data["extent"]
    sx = (ext["maxX"] - ext["minX"]) / W
    sy = (ext["maxY"] - ext["minY"]) / H
    blds = [b["pts"] for b in data["buildings"]] + [f["pts"] for f in data["features"]]
    segs = []
    for rd in data["roads"]:
        for i in range(len(rd["pts"]) - 1):
            segs.append((rd["pts"][i], rd["pts"][i + 1], rd["w"] / 2 + 2.5))

    def near_road(x, y):
        for (ax, ay), (bx, by), w in segs:
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy or 1e-9
            t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L2))
            px, py = ax + t * dx, ay + t * dy
            if (x - px) ** 2 + (y - py) ** 2 < w * w:
                return True
        return False

    # ---- surrounding houses: bright / coloured roof blobs outside campus become simple blocks ----
    redroof = (r - g > 0.10) & (r > 0.42)
    blueroof = (b - r > 0.04) & (b > 0.38)
    roofmask = (((lum > 0.50) & (veg < 0.25)) | redroof | blueroof)
    mimg = Image.fromarray((roofmask * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    mask = np.asarray(mimg) > 127
    lab = np.zeros(mask.shape, dtype=np.int32)
    comps = []
    Hm, Wm = mask.shape
    for sy0 in range(Hm):
        row = mask[sy0]
        for sx0 in np.nonzero(row)[0]:
            if lab[sy0, sx0]:
                continue
            cid = len(comps) + 1
            stack = [(sy0, sx0)]; lab[sy0, sx0] = cid; px_list = []
            while stack:
                yy, xx = stack.pop(); px_list.append((xx, yy))
                for ny_, nx_ in ((yy + 1, xx), (yy - 1, xx), (yy, xx + 1), (yy, xx - 1)):
                    if 0 <= ny_ < Hm and 0 <= nx_ < Wm and mask[ny_, nx_] and not lab[ny_, nx_]:
                        lab[ny_, nx_] = cid; stack.append((ny_, nx_))
            comps.append(px_list)

    def to_m(ix, iy):
        return ext["minX"] + (ix + 0.5) * sx, ext["maxY"] - (iy + 0.5) * sy

    context = []
    for px_list in comps:
        area = len(px_list) * sx * sy
        if area < 35 or area > 900:
            continue
        P = np.array([to_m(ix, iy) for ix, iy in px_list])
        c = P.mean(axis=0)
        if any(point_in_poly(c[0], c[1], p) for p in blds) or near_road(c[0], c[1]):
            continue
        cov = np.cov((P - c).T)
        evals, evecs = np.linalg.eigh(cov)
        ax = evecs[:, 1]
        ang = math.atan2(ax[1], ax[0])
        rot = np.array([[math.cos(-ang), -math.sin(-ang)], [math.sin(-ang), math.cos(-ang)]])
        Q = (P - c) @ rot.T
        w = Q[:, 0].max() - Q[:, 0].min() + 1.2
        d = Q[:, 1].max() - Q[:, 1].min() + 1.2
        if len(px_list) * sx * sy / (w * d) < 0.45 or max(w, d) / max(1, min(w, d)) > 4.5:
            continue  # not box-like (riverbed, paths)
        ixs = [p[0] for p in px_list]; iys = [p[1] for p in px_list]
        col = a[iys, ixs].mean(axis=0)
        col = np.clip((col - col.mean()) * 1.6 + col.mean() * 1.05, 0, 1)  # punch up the roof colour a little
        hexc = "#%02x%02x%02x" % tuple(int(v * 255) for v in col)
        levels = 2 + (1 if area > 120 else 0) + (1 if area > 300 else 0) + (1 if random.Random(int(area)).random() < 0.3 else 0)
        context.append([round(float(c[0]), 1), round(float(c[1]), 1), round(float(w), 1), round(float(d), 1), round(ang, 3), levels, hexc])

    def in_context(x, y):
        for cx_, cy_, w_, d_, ang_, *_ in context:
            dx, dy = x - cx_, y - cy_
            u = dx * math.cos(ang_) + dy * math.sin(ang_); v = -dx * math.sin(ang_) + dy * math.cos(ang_)
            if abs(u) < w_ / 2 + 1.5 and abs(v) < d_ / 2 + 1.5:
                return True
        return False

    json.dump(context, open(D("data", "context.json"), "w"), separators=(",", ":"))

    rnd = random.Random(7)
    trees = []
    step = 7.0
    y = ext["minY"]
    while y < ext["maxY"]:
        x = ext["minX"]
        while x < ext["maxX"]:
            jx, jy = x + rnd.uniform(-2.5, 2.5), y + rnd.uniform(-2.5, 2.5)
            ix = int((jx - ext["minX"]) / sx); iy = int((ext["maxY"] - jy) / sy)
            if 0 <= ix < W and 0 <= iy < H:
                d = dense_s[iy, ix]
                if d > 0.35 and rnd.random() < d:
                    if not any(point_in_poly(jx, jy, p) for p in blds) and not near_road(jx, jy) and not in_context(jx, jy):
                        kind = 1 if rnd.random() < 0.35 else 0  # 1 = conifer
                        trees.append([round(jx, 1), round(jy, 1), round(rnd.uniform(0.75, 1.3), 2), kind])
            x += step
        y += step
    json.dump(trees, open(D("data", "trees.json"), "w"), separators=(",", ":"))
    print(f"ground.jpg {W}x{H}, {len(trees)} trees, {len(context)} surrounding houses")


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "--imagery":
        imagery(sys.argv[2], sys.argv[3])
    build()
