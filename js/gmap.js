// 2D mode: a real Google Map (satellite + labels) with our traced DIT buildings drawn on top.
let loading = null, map = null, polys = [], info = null;

function loadGoogle(key) {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    window.__ditGmapReady = () => resolve(window.google);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=__ditGmapReady`;
    s.async = true;
    s.onerror = () => reject(new Error("Google Maps could not load"));
    document.head.append(s);
  });
  return loading;
}

const M_LAT = 110574;
export function toLatLng(origin, p) {
  const mLng = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  return { lat: origin.lat + p[1] / M_LAT, lng: origin.lng + p[0] / mLng };
}

const CAT_COLORS = { academic: "#2bb39a", hostel: "#5b8def", food: "#f39c3c", admin: "#b07fe0", sports: "#74c44c", other: "#9aa6b6" };

export async function openGMap(el, data, key, focus) {
  if (!key || key.startsWith("PASTE_")) throw new Error("Add your Google Maps API key in config.js to use the 2D map.");
  const g = await loadGoogle(key);
  const o = data.origin;
  if (!map) {
    map = new g.maps.Map(el, {
      center: toLatLng(o, [0, 0]), zoom: 17, mapTypeId: "hybrid", tilt: 0,
      fullscreenControl: false, streetViewControl: false, mapTypeControl: true, clickableIcons: true,
    });
    info = new g.maps.InfoWindow();
    for (const b of [...data.buildings, ...data.features]) {
      const color = CAT_COLORS[b.cat] || CAT_COLORS.other;
      const poly = new g.maps.Polygon({
        paths: b.pts.map((p) => toLatLng(o, p)), map,
        strokeColor: color, strokeWeight: 2, fillColor: color, fillOpacity: 0.28,
      });
      poly.addListener("click", () => {
        info.setContent(`<b>${b.name.replace(/</g, "&lt;")}</b>`);
        info.setPosition(toLatLng(o, b.c));
        info.open(map);
      });
      polys.push(poly);
    }
  }
  if (focus) { map.panTo(toLatLng(o, focus)); map.setZoom(19); }
  return map;
}
