(() => {
  "use strict";
  const KEY = (window.DIT_CONFIG || {}).GOOGLE_MAPS_API_KEY || "";
  const CAMPUS = window.DIT_CAMPUS;
  const $ = (id) => document.getElementById(id);

  function showMsg(html) { $("msg").innerHTML = `<div>${html}</div>`; $("msg").hidden = false; }

  if (!KEY || KEY.startsWith("PASTE_")) {
    showMsg(`<h2>Add your Google Maps API key</h2>
      <p>Open <code>config.js</code> in this folder and replace <code>PASTE_YOUR_KEY_HERE</code> with your key, then reload.</p>
      <p class="muted">Enable these APIs for the key: Maps JavaScript API, Map Tiles API, Places API (New), Routes API.</p>`);
    return;
  }

  // Official Google Maps JS dynamic bootstrap loader.
  ((g) => { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => { await (a = m.createElement("script")); e.set("libraries", [...r] + ""); for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]); e.set("callback", c + ".maps." + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e; d[q] = f; a.onerror = () => h = n(Error(p + " could not load.")); a.nonce = m.querySelector("script[nonce]")?.nonce || ""; m.head.append(a) })); d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)) })({ key: KEY, v: "beta" });

  window.gm_authFailure = () => showMsg(`<h2>Google rejected the API key</h2><p>Check that the key is valid, billing is on, and the Map Tiles API + Maps JavaScript API are enabled. If you restricted the key by website, add <code>http://localhost:5173/*</code>.</p>`);

  const state = {
    places: [],          // {name, sub, lat, lng, source}
    markers: [],
    route: null,
    selected: null,
    mode: "3d",
    map3d: null,
    map2d: null,
    map2dObjs: [],
    touring: false,
  };

  const center = { lat: CAMPUS.center.lat, lng: CAMPUS.center.lng };
  const overviewCam = () => ({
    center: { ...center, altitude: CAMPUS.groundAltitude || 0 },
    range: CAMPUS.overview.range, tilt: CAMPUS.overview.tilt, heading: CAMPUS.overview.heading,
  });

  async function init() {
    const lib3d = await google.maps.importLibrary("maps3d");
    const { Map3DElement, MapMode } = lib3d;
    state.lib3d = lib3d;

    const map = new Map3DElement({
      ...overviewCam(),
      mode: MapMode ? MapMode.SATELLITE : "SATELLITE",
      defaultUIHidden: true,
    });
    $("map3d").append(map);
    state.map3d = map;

    // Curated places first, then whatever Google knows around campus.
    for (const p of window.DIT_PLACES || []) addPlace({ ...p, source: "campus" });
    renderMarkers();
    refreshLists();
    loadGooglePlaces().catch((e) => console.warn("Places lookup failed:", e));

    wireUI();
  }

  // ---------- places ----------
  function addPlace(p) {
    const dup = state.places.find((x) => x.name.toLowerCase() === p.name.toLowerCase()
      || (Math.abs(x.lat - p.lat) < 0.00005 && Math.abs(x.lng - p.lng) < 0.00005));
    if (dup) return dup;
    state.places.push(p);
    return p;
  }

  // Hotels, homestays and flats near campus clutter the map; skip them.
  const OFF_CAMPUS = /hotel|homestay|home stay|\binn\b|resort|suites?\b|villa|apartment|homes\b|manor|oyo|rent|pg\b|real estate|school\b/i;

  async function loadGooglePlaces() {
    const { Place } = await google.maps.importLibrary("places");
    const fields = ["displayName", "location", "primaryTypeDisplayName", "formattedAddress"];
    const circle = { center, radius: CAMPUS.searchRadius };
    const groups = [
      undefined,
      ["restaurant", "cafe", "atm", "bank", "store", "convenience_store", "pharmacy"],
      ["university", "school", "library", "gym", "stadium", "hospital", "parking", "hindu_temple"],
    ];
    for (const includedTypes of groups) {
      try {
        const req = { fields, locationRestriction: circle, maxResultCount: 20 };
        if (includedTypes) req.includedTypes = includedTypes;
        const { places } = await Place.searchNearby(req);
        for (const pl of places || []) {
          if (!pl.location || OFF_CAMPUS.test(pl.displayName || "")) continue;
          addPlace({
            name: pl.displayName, sub: pl.primaryTypeDisplayName || pl.formattedAddress || "",
            lat: pl.location.lat(), lng: pl.location.lng(), source: "google",
          });
        }
      } catch (e) { console.warn("searchNearby", includedTypes, e); }
    }
    renderMarkers();
    refreshLists();
  }

  async function textSearch(q) {
    const { Place } = await google.maps.importLibrary("places");
    const { places } = await Place.searchByText({
      textQuery: `${q} DIT University Dehradun`,
      fields: ["displayName", "location", "primaryTypeDisplayName", "formattedAddress"],
      locationBias: { center, radius: 2000 },
      maxResultCount: 8,
    });
    return (places || []).filter((p) => p.location).map((pl) => ({
      name: pl.displayName, sub: pl.primaryTypeDisplayName || pl.formattedAddress || "",
      lat: pl.location.lat(), lng: pl.location.lng(), source: "google",
    }));
  }

  // ---------- markers ----------
  function renderMarkers() {
    if (state.mode === "2d") return render2dMarkers();
    const { Marker3DInteractiveElement } = state.lib3d;
    if (!Marker3DInteractiveElement) return;
    state.markers.forEach((m) => m.remove());
    state.markers = state.places.map((p) => {
      const m = new Marker3DInteractiveElement({
        position: { lat: p.lat, lng: p.lng, altitude: 30 },
        altitudeMode: "RELATIVE_TO_GROUND",
        extruded: true,
      });
      if (p.source !== "google" || p === state.selected) m.label = shortName(p.name);
      m.addEventListener("gmp-click", () => select(p));
      state.map3d.append(m);
      return m;
    });
  }

  function shortName(n) { return n.length > 28 ? n.slice(0, 26) + "…" : n; }
  function refreshLabels() {
    if (state.mode === "2d") return;
    state.markers.forEach((m, i) => {
      const p = state.places[i];
      m.label = (p.source !== "google" || p === state.selected) ? shortName(p.name) : null;
    });
  }

  // ---------- camera ----------
  function flyTo(p, range = 260) {
    stopTour();
    if (state.mode === "2d") { state.map2d.panTo(p); state.map2d.setZoom(19); return; }
    state.map3d.flyCameraTo({
      endCamera: { center: { lat: p.lat, lng: p.lng, altitude: CAMPUS.groundAltitude || 0 }, range, tilt: 62, heading: state.map3d.heading || 0 },
      durationMillis: 2200,
    });
  }
  function home() {
    stopTour();
    if (state.mode === "2d") { state.map2d.panTo(center); state.map2d.setZoom(17); return; }
    state.map3d.flyCameraTo({ endCamera: overviewCam(), durationMillis: 2200 });
  }
  function tour() {
    if (state.mode === "2d") return;
    if (state.touring) return stopTour();
    state.touring = true; $("btnTour").classList.add("on");
    state.map3d.flyCameraAround({ camera: overviewCam(), durationMillis: 40000, repeatCount: 3 });
  }
  function stopTour() {
    if (!state.touring) return;
    state.touring = false; $("btnTour").classList.remove("on");
    try { state.map3d.stopCameraAnimation(); } catch (_) {}
  }

  // ---------- info card ----------
  function select(p) {
    state.selected = p;
    $("infoTitle").textContent = p.name;
    $("infoSub").textContent = [p.sub, p.source === "google" ? "via Google" : "campus list"].filter(Boolean).join(" · ");
    $("info").hidden = false;
    refreshLabels();
    flyTo(p);
  }

  // ---------- search ----------
  let activeIdx = -1, lastResults = [];
  function renderResults(list) {
    lastResults = list; activeIdx = -1;
    $("results").innerHTML = "";
    list.slice(0, 12).forEach((p, i) => {
      const li = document.createElement("li");
      li.innerHTML = `${escapeHtml(p.name)}<small>${escapeHtml(p.sub || "")}</small>`;
      li.onclick = () => { pick(p); };
      $("results").append(li);
    });
  }
  function pick(p) {
    const added = addPlace(p);
    if (added === p) { renderMarkers(); refreshLists(); }
    $("results").innerHTML = ""; $("q").value = added.name;
    select(added);
  }
  function localMatch(q) {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return state.places.filter((p) => (p.name + " " + (p.sub || "")).toLowerCase().includes(s));
  }

  // ---------- directions ----------
  function refreshLists() {
    for (const id of ["dirFrom", "dirTo"]) {
      const sel = $(id), prev = sel.value;
      sel.innerHTML = state.places.map((p, i) => `<option value="${i}">${escapeHtml(p.name)}</option>`).join("");
      if (prev && sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
    }
  }

  async function computeRoute(a, b) {
    // Prefer the Routes library; fall back to legacy DirectionsService.
    try {
      const { Route } = await google.maps.importLibrary("routes");
      if (Route && Route.computeRoutes) {
        const { routes } = await Route.computeRoutes({
          origin: { lat: a.lat, lng: a.lng }, destination: { lat: b.lat, lng: b.lng },
          travelMode: "WALKING", fields: ["path", "distanceMeters", "durationMillis"],
        });
        const r = routes && routes[0];
        if (r && r.path) return {
          path: r.path.map((ll) => ({ lat: ll.lat(), lng: ll.lng() })),
          meters: r.distanceMeters, seconds: (r.durationMillis || 0) / 1000,
        };
      }
    } catch (e) { console.warn("Route.computeRoutes failed, trying DirectionsService", e); }
    const { DirectionsService } = await google.maps.importLibrary("routes");
    const res = await new DirectionsService().route({
      origin: { lat: a.lat, lng: a.lng }, destination: { lat: b.lat, lng: b.lng },
      travelMode: google.maps.TravelMode.WALKING,
    });
    const leg = res.routes[0].legs[0];
    return {
      path: res.routes[0].overview_path.map((ll) => ({ lat: ll.lat(), lng: ll.lng() })),
      meters: leg.distance.value, seconds: leg.duration.value,
    };
  }

  async function showRoute() {
    const a = state.places[+$("dirFrom").value], b = state.places[+$("dirTo").value];
    if (!a || !b || a === b) { $("dirInfo").textContent = "Pick two different places."; return; }
    $("dirInfo").textContent = "Finding route…";
    let r;
    try { r = await computeRoute(a, b); }
    catch (e) {
      console.warn(e);
      r = { path: [a, b], meters: haversine(a, b), seconds: haversine(a, b) / 1.3, straight: true };
    }
    clearRoute();
    drawRoute(r.path);
    const mins = Math.max(1, Math.round(r.seconds / 60));
    $("dirInfo").textContent = `${Math.round(r.meters)} m · about ${mins} min walk` + (r.straight ? " (straight line — Google had no route)" : "");
    // Frame the route.
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    flyTo(mid, Math.max(300, haversine(a, b) * 2.2));
  }

  function drawRoute(path) {
    if (state.mode === "2d") {
      state.route = new google.maps.Polyline({ path, map: state.map2d, strokeColor: "#f5a623", strokeWeight: 6 });
      return;
    }
    const { Polyline3DElement } = state.lib3d;
    const line = new Polyline3DElement({
      strokeColor: "#f5a623", strokeWidth: 10, outerColor: "#1a1a1a", outerWidth: 0.25,
      altitudeMode: "CLAMP_TO_GROUND", drawsOccludedSegments: true,
    });
    const coords = path.map((p) => ({ lat: p.lat, lng: p.lng }));
    if ("path" in line) line.path = coords; else line.coordinates = coords;
    state.map3d.append(line);
    state.route = line;
    state.routePath = path;
  }
  function clearRoute() {
    if (!state.route) return;
    if (state.route.setMap) state.route.setMap(null); else state.route.remove();
    state.route = null; state.routePath = null;
  }

  // ---------- 2D ----------
  async function toggleView() {
    stopTour();
    const path = state.routePath;
    clearRoute();
    if (state.mode === "3d") {
      if (!state.map2d) {
        const { Map } = await google.maps.importLibrary("maps");
        state.map2d = new Map($("map2d"), {
          center, zoom: 17, mapTypeId: "hybrid", tilt: 0, disableDefaultUI: true, zoomControl: true,
        });
      }
      state.mode = "2d"; $("map3d").hidden = true; $("map2d").hidden = false; $("btnView").textContent = "3D view";
    } else {
      state.map2dObjs.forEach((m) => m.setMap(null)); state.map2dObjs = [];
      state.mode = "3d"; $("map2d").hidden = true; $("map3d").hidden = false; $("btnView").textContent = "2D map";
    }
    renderMarkers();
    if (path) drawRoute(path);
  }
  function render2dMarkers() {
    state.map2dObjs.forEach((m) => m.setMap(null));
    state.map2dObjs = state.places.map((p) => {
      const m = new google.maps.Marker({ position: p, map: state.map2d, title: p.name });
      m.addListener("click", () => select(p));
      return m;
    });
  }

  // ---------- UI wiring ----------
  function wireUI() {
    $("btnHome").onclick = home;
    $("btnTour").onclick = tour;
    $("btnView").onclick = toggleView;
    $("btnDir").onclick = () => { $("dirBox").hidden = !$("dirBox").hidden; $("btnDir").classList.toggle("on", !$("dirBox").hidden); };
    $("btnRoute").onclick = showRoute;
    $("btnClear").onclick = () => { clearRoute(); $("dirInfo").textContent = ""; };
    $("infoClose").onclick = () => { $("info").hidden = true; };
    $("infoFly").onclick = () => state.selected && flyTo(state.selected, 180);
    const setDir = (id) => { const i = state.places.indexOf(state.selected); if (i < 0) return; $(id).value = i; $("dirBox").hidden = false; $("btnDir").classList.add("on"); };
    $("infoFrom").onclick = () => setDir("dirFrom");
    $("infoTo").onclick = () => setDir("dirTo");

    let t;
    $("q").addEventListener("input", (e) => {
      const q = e.target.value;
      renderResults(localMatch(q));
      clearTimeout(t);
    });
    $("q").addEventListener("keydown", async (e) => {
      const items = [...$("results").children];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        activeIdx = Math.max(0, Math.min(items.length - 1, activeIdx + (e.key === "ArrowDown" ? 1 : -1)));
        items.forEach((li, i) => li.classList.toggle("active", i === activeIdx));
      } else if (e.key === "Enter") {
        if (activeIdx >= 0 && lastResults[activeIdx]) return pick(lastResults[activeIdx]);
        const q = $("q").value.trim();
        if (!q) return;
        const local = localMatch(q);
        if (local.length === 1) return pick(local[0]);
        $("results").innerHTML = `<li class="muted">Searching Google…</li>`;
        try {
          const g = await textSearch(q);
          const merged = [...local, ...g];
          if (merged.length) renderResults(merged);
          else $("results").innerHTML = `<li class="muted">Nothing found. Add it to places.js.</li>`;
        } catch (err) {
          console.warn(err);
          $("results").innerHTML = `<li class="muted">Google search unavailable (is Places API (New) enabled?)</li>`;
        }
      } else if (e.key === "Escape") {
        $("results").innerHTML = "";
      }
    });

    document.querySelectorAll(".moods button").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll(".moods button").forEach((x) => x.classList.toggle("on", x === b));
        $("mood").dataset.mood = b.dataset.mood;
      };
    });
    // Stop the orbit tour as soon as the user grabs the map.
    $("map3d").addEventListener("pointerdown", stopTour);
  }

  // ---------- utils ----------
  function haversine(a, b) {
    const R = 6371000, toR = (d) => d * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  init().catch((e) => {
    console.error(e);
    showMsg(`<h2>Couldn't start the 3D map</h2><p>${escapeHtml(e.message || e)}</p><p class="muted">Check the browser console for details.</p>`);
  });
})();
