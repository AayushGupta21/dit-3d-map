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

Any number of players (2 or more), each in their own browser. The host's connection carries everyone, so very big games (10+) play best when the host is on good wifi. One person presses **Play → Create a room** and shares the 5-letter code or the invite link; the others join with it. While waiting in the lobby you can walk around and try the guns.

**Modes**
- **Shootout:** everyone for themselves. Most takedowns in 5 minutes wins, or first to 10.
- **Team Deathmatch:** Red vs Blue, first team to 25. No friendly fire.
- **Capture the Flag:** the Red base is the Chanakya Flag Lawn and the Blue base is the Boys Hostel Sports Ground. Grab their flag and bring it home while yours is safe; first to 3 wins. Carrying a flag slows you down. A dropped flag goes home after 20 s.
- **Hide & Seek:** one seeker counts to 30, then has 3 minutes. The seeker gets a radar ping every 30 s. Found hiders become seekers. Hiders can taunt (T) for points.

**Weapons:** pistol, rifle (auto), shotgun (8 pellets) and sniper (scope). Each has its own damage, headshot multiplier, range falloff, spread, recoil, magazine and reload.

**Controls**
- **Desktop:**
  - Click to lock the mouse.
  - WASD to move, Shift to sprint (uses stamina), Space to jump, C to crouch.
  - Left-click to fire (hold for the rifle), right-click to aim down sights, R to reload.
  - 1 to 4 or the mouse wheel to switch weapons, Tab for scores, T to taunt.
- **Phone:** joystick, drag to look, plus FIRE, AIM, R, JUMP, DUCK, SWAP and Scores buttons. Aim assist slows the look slightly over enemies.

**How it works**
- **Code:** `js/game/`:
  - `index.js`: rooms, netcode and modes.
  - `weapons.js`: stats, first-person models and animation.
  - `fx.js`: tracers, sparks, dust, bullet holes, casings and muzzle flash.
  - `audio.js`: synthesized 3D sound and music.
  - `avatar.js`: animated players.
  - `hud.js`: UI and minimap.
- **Loading:** all of it is loaded only when someone presses Play, about 29 KB gzipped.
- **Networking:** each guest first tries a direct WebRTC connection to the host (PeerJS). If their network blocks that (common on mobile data and college wifi), the game switches that guest to a relay through Supabase Realtime within a few seconds. The lobby shows "via relay" for those players. Set `SUPABASE_URL` and `SUPABASE_KEY` (the project's publishable key) in `config.js`. Add `?relay` to the URL to test the relay path.
- **Host authority:** the room creator's tab is the host. It owns health, scores, timers and flags. It checks every hit with lag compensation (where the target really was when the shooter fired, line of sight, range and fire rate). Other players are drawn 100 ms in the past and interpolated, so movement looks smooth.
- **Sound:** every sound and the music for each mode are synthesized with the Web Audio API, so there are no audio files to download. Shots and footsteps come from where they happen, and walls muffle them.
- **Settings (⚙):** look speed, field of view, volumes, invert Y and low graphics.

**Use button (E, or ✋ on phones):** take the enemy flag or send your dropped flag home in Capture the Flag, and use the glowing green stair doors on hostels in Hide & Seek. Those doors lead to hidden rooms on floors 1–3; five random hostels are open each round. In Shootout and Team Deathmatch you come back 12–25 m from where you went down, away from enemies.
