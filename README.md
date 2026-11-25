# DIT University in 3D

An interactive, stylised 3D map of DIT University, Dehradun, that runs in the browser (phones too).

- **index.html**: the main stylised 3D campus (Three.js). Search, walking directions, live sun and shadows for the real time in Dehradun, night lights, weather (clear, cloudy, fog, rain) and seasons.
  - **Walk mode** (walking-person button, or "Walk here" on any building): explore at eye level. WASD or arrow keys, Shift to run, drag to look, Q/E to turn, Esc to exit. On phones, use the on-screen joystick and drag to look. You can't walk through buildings.
- **2D map** button: a real Google Map (satellite) with the traced DIT buildings drawn on top. Needs your key.
- **Photo 3D** (`photo3d.html`): Google's photorealistic 3D tiles of the campus. Needs your key.

## Run locally
```
python3 tools/serve.py
```
Then open http://localhost:5173.

## Google Maps key
Put it in `config.js` (git-ignored). Enable: Maps JavaScript API, Map Tiles API, Places API (New), Routes API. Restrict the key by HTTP referrer (your site URL and `http://localhost:5173/*`) before publishing, because anyone can see a browser key.

## Fixing names and buildings
Building names other than Vedanta, VASTU and Mechanical are **placeholders**, because the outlines were traced from satellite imagery. To fix them:
1. Edit `data/buildings.json`: change `name`, `cat` (academic / hostel / food / admin / sports), `levels`, `style` (modern / brick / concrete / hostel / round), and set `"verified": true`.
2. Add gates, canteens, ATMs and similar to `data/places.json` (lat/lng: right-click in Google Maps to copy them).
3. Rebuild the data: `python3 tools/build.py`

## How it's made
- Roads: OpenStreetMap (ODbL), cached in `data/osm.json`.
- Building outlines, land cover, trees and surrounding houses: traced or derived from Esri World Imagery (`tools/build.py --imagery ...`).
- Rendering: Three.js with procedural facades, instanced trees, emissive night windows, and street-lamp glows instead of real-time lights.
- Google data (places, routes) is only shown on Google's own map views, as Google's terms require.

## Deploy (GitHub Pages)
Push the folder to a repo and enable Pages. `config.js` is git-ignored, so create it on the deployed branch or inject it in CI, with a referrer-restricted key.

## Deploying (fast loading)

```bash
npm install
npm run build
```

This writes `dist/`, a static site you upload as-is (Netlify, Vercel, Cloudflare Pages or GitHub Pages):

- The app and three.js are bundled into one minified file (~200 KB gzipped). That replaces the CDN three.js plus about 10 module requests that loaded one after another.
- File names carry a content hash, so `_headers` (Netlify, Cloudflare) and `vercel.json` cache them for a year. Only `index.html` and `config.js` are re-checked on each visit.
- The script, campus data and ground texture are preloaded, and Google Fonts no longer blocks the first paint.

`config.js` (your Google Maps key) is copied into `dist/`. Before going live, restrict the key to your site's domain in the Google Cloud console.

Run `npm run build` again after any change to `js/`, `css/` or `data/`.

## Multiplayer (🎮 Play)

2 to 4 players, each in their own browser. One person presses **Play → Create a room** and shares the 5-letter code or the invite link. The others join with it. Modes:

- **Shootout:** everyone for themselves. Most takedowns in 5 minutes wins (or first to 10).
- **Hide & Seek:** one seeker counts to 30 while everyone hides. Then the seeker has 3 minutes to find (shoot) them, and found players become seekers too.

Controls:
- **Desktop:** click to aim with the mouse, WASD to move, Shift to run, click or Space to shoot.
- **Phone:** joystick to move, drag to look, FIRE button to shoot.

The browsers connect directly to each other over WebRTC (PeerJS). The free PeerJS server is only used to introduce them, so no game server is needed. The room creator's tab runs the game, so if the host closes it, the round ends.
