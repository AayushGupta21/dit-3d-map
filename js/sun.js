// Solar position (simplified astronomical formulas, accurate to well under a degree).
const rad = Math.PI / 180;
const dayMs = 86400000, J1970 = 2440588, J2000 = 2451545;
const e = rad * 23.4397; // obliquity of the Earth

function toDays(date) { return date.valueOf() / dayMs - 0.5 + J1970 - J2000; }

/** Returns { altitude, azimuth } in radians. Azimuth is measured from south, positive towards west. */
export function sunPosition(date, lat, lng) {
  const d = toDays(date);
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const lw = rad * -lng, phi = rad * lat;
  const H = rad * (280.16 + 360.9856235 * d) - lw - ra;
  return {
    azimuth: Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)),
    altitude: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)),
  };
}

/** Unit vector towards the sun in scene space (x east, y up, z south). */
export function sunVector(pos) {
  const c = Math.cos(pos.altitude);
  return { x: -Math.sin(pos.azimuth) * c, y: Math.sin(pos.altitude), z: Math.cos(pos.azimuth) * c };
}

// ---- Indian Standard Time helpers (UTC+5:30, no DST) ----
const IST = 5.5 * 3600000;

/** Minutes past midnight in IST for a Date. */
export function istMinutes(date = new Date()) {
  const t = new Date(date.valueOf() + IST);
  return t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60;
}

/** Date for "today in IST" at the given minutes past IST midnight. */
export function istDateAt(minutes, ref = new Date()) {
  const t = new Date(ref.valueOf() + IST);
  const midnightUtc = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - IST;
  return new Date(midnightUtc + minutes * 60000);
}

export function istMonth(ref = new Date()) { return new Date(ref.valueOf() + IST).getUTCMonth(); }

/** Sunrise, solar noon and sunset (minutes past IST midnight) for today. */
export function sunTimes(lat, lng, ref = new Date()) {
  let rise = 360, set = 1080, noon = 720, best = -9;
  let prev = sunPosition(istDateAt(0, ref), lat, lng).altitude;
  for (let m = 2; m < 1440; m += 2) {
    const a = sunPosition(istDateAt(m, ref), lat, lng).altitude;
    if (prev < 0 && a >= 0) rise = m;
    if (prev >= 0 && a < 0) set = m;
    if (a > best) { best = a; noon = m; }
    prev = a;
  }
  return { rise, noon, set };
}

export function fmtTime(minutes) {
  const m = Math.round(minutes) % 1440;
  let h = Math.floor(m / 60); const mm = String(m % 60).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${mm} ${ap}`;
}
