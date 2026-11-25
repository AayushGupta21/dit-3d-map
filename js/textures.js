// Procedural facade textures drawn on canvases: one colour map and one night-glow map per style.
import * as THREE from "three";

export const BAY = 3.2;     // metres per window bay
export const FLOOR = 3.6;   // metres per storey
export const TILE_BAYS = 8; // texture covers 8 bays x 8 floors so lit windows look random
export const TILE_FLOORS = 8;

export const STYLES = {
  modern:   { wall: "#e3e6ea", band: "#c9ced6", glass: "#3f5a78", frame: "#f4f6f8", roof: "#b9c0c9", winW: 0.78, winH: 0.55 },
  brick:    { wall: "#b4563d", band: "#e2d8c9", glass: "#33414f", frame: "#efe6da", roof: "#9f4a33", winW: 0.42, winH: 0.5, bricky: true },
  // DIT look from the campus videos: red-brick piers, tall glass, white slab bands
  brickglass: { wall: "#ab5138", band: "#ebe4d8", glass: "#3a4f68", frame: "#e9e2d6", roof: "#bdb6ab", winW: 0.62, winH: 0.66, bricky: true, bandH: 9 },
  brickround: { wall: "#b0533a", band: "#ece5da", glass: "#3c5470", frame: "#efe8de", roof: "#c4bdb2", winW: 0.7, winH: 0.55, bricky: true, bandH: 10 },
  concrete: { wall: "#dcd3c2", band: "#c8bea9", glass: "#3b4b5c", frame: "#ece6da", roof: "#c4bcae", winW: 0.55, winH: 0.5 },
  hostel:   { wall: "#b65b41", band: "#efe8dc", glass: "#3d4c5d", frame: "#f2ece2", roof: "#cfc6b6", winW: 0.4, winH: 0.46, balcony: true, bricky: true, bandH: 12 },
  // From the campus videos:
  stone:      { wall: "#6e5a50", band: "#86756a", glass: "#2c3845", frame: "#9a8a7f", roof: "#7a3b30", winW: 0.36, winH: 0.74, piers: "#5c4a42", bandH: 6 },      // Chanakya
  brickcream: { wall: "#eadfc6", band: "#efe7d6", glass: "#3c4b5c", frame: "#f5efe2", roof: "#c9c0b0", winW: 0.4, winH: 0.5, piers: "#ad5038", bandH: 8 },      // Visvesvaraya
  hostelyellow: { wall: "#ecd9a3", band: "#f1e5c2", glass: "#3f4d5d", frame: "#f7efd8", roof: "#d3c7a8", winW: 0.38, winH: 0.48, piers: "#b45a3f", balcony: true, bandH: 8 }, // boys hostels
  brickgrid:  { wall: "#b5583e", band: "#f1ebe1", glass: "#3a4859", frame: "#efe8dc", roof: "#c7beb0", winW: 0.4, winH: 0.46, bricky: true, grid: true, bandH: 7 }, // Kasturba
  creamstep:  { wall: "#efe3cf", band: "#d9a9a0", glass: "#45525f", frame: "#f6efe4", roof: "#d8cfc0", winW: 0.44, winH: 0.5, balcony: true, bandH: 6 }, // Raman / Bhabha
  house:    { wall: "#ece4d4", band: "#d9cfbb", glass: "#4a5a6c", frame: "#f6f1e6", roof: "#c9c2b5", winW: 0.4, winH: 0.45 },
  round:    { wall: "#e8e3da", band: "#d3ccbf", glass: "#41566d", frame: "#f6f3ee", roof: "#c7c1b6", winW: 0.6, winH: 0.35 },
};

const PX_BAY = 64, PX_FLOOR = 72;

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function makeFacade(styleName, maxAniso = 4) {
  const st = STYLES[styleName] || STYLES.concrete;
  const W = PX_BAY * TILE_BAYS, H = PX_FLOOR * TILE_FLOORS;
  const col = document.createElement("canvas"); col.width = W; col.height = H;
  const glow = document.createElement("canvas"); glow.width = W; glow.height = H;
  const c = col.getContext("2d"), g = glow.getContext("2d");
  c.fillStyle = st.wall; c.fillRect(0, 0, W, H);
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const rnd = seeded(styleName.length * 977 + 13);

  if (st.bricky) { // faint brick courses
    c.globalAlpha = 0.12; c.fillStyle = "#5a2414";
    for (let y = 0; y < H; y += 6) c.fillRect(0, y, W, 1);
    c.globalAlpha = 1;
  }
  if (st.piers) { // brick piers between window bays
    c.fillStyle = st.piers;
    for (let b = 0; b < TILE_BAYS; b += 1) c.fillRect(b * PX_BAY - 7, 0, 14, H);
  }
  for (let f = 0; f < TILE_FLOORS; f++) {
    const y0 = f * PX_FLOOR;
    // floor slab band
    const bh = st.bandH || 7;
    c.fillStyle = st.band; c.fillRect(0, y0 + PX_FLOOR - bh, W, bh);
    if (st.grid) { // white grid lines (Kasturba-style facade)
      c.fillStyle = st.band;
      for (let b = 0; b < TILE_BAYS; b++) c.fillRect(b * PX_BAY - 2, y0, 4, PX_FLOOR);
    }
    for (let b = 0; b < TILE_BAYS; b++) {
      const x0 = b * PX_BAY;
      const ww = PX_BAY * st.winW, wh = PX_FLOOR * st.winH;
      const wx = x0 + (PX_BAY - ww) / 2, wy = y0 + (PX_FLOOR - (st.bandH || 7) - wh) / 2 + 2;
      if (styleName === "modern") { // continuous glass band
        c.fillStyle = st.glass; c.fillRect(x0, wy, PX_BAY, wh);
        c.fillStyle = st.frame; c.fillRect(x0, wy, 3, wh);
        c.fillStyle = "rgba(255,255,255,0.18)"; c.fillRect(x0 + 6, wy + 3, PX_BAY * 0.3, 3);
      } else {
        c.fillStyle = st.frame; c.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
        c.fillStyle = st.glass; c.fillRect(wx, wy, ww, wh);
        c.fillStyle = st.frame; c.fillRect(wx + ww / 2 - 1, wy, 2, wh);
        if (st.balcony && b % 2 === 0) { c.fillStyle = "rgba(0,0,0,0.12)"; c.fillRect(x0 + 4, wy + wh + 1, PX_BAY - 8, 5); }
      }
      // night glow: about 55% of windows lit, warm or cool
      if (rnd() < 0.55) {
        const warm = rnd() < 0.75;
        g.fillStyle = warm ? `rgb(255,${200 + Math.floor(rnd() * 30)},${120 + Math.floor(rnd() * 40)})` : "rgb(200,225,255)";
        if (styleName === "modern") g.fillRect(x0 + 3, wy, PX_BAY - 3, wh);
        else g.fillRect(wx, wy, ww, wh);
      }
    }
  }
  const mk = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(col, true), emissiveMap: mk(glow, true), style: st };
}

/** Soft round glow used for street-lamp light pools. */
export function makeGlow() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const c = cv.getContext("2d");
  const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,214,150,1)");
  gr.addColorStop(0.35, "rgba(255,190,110,0.45)");
  gr.addColorStop(1, "rgba(255,170,80,0)");
  c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
