// All game UI: start dialog, lobby, in-game HUD, scoreboard, settings, minimap and phone buttons.
// Injected on first use so the map page stays light until someone presses Play.

const CSS = `
.gm-modal{position:fixed;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.5);padding:16px;z-index:30}
.gm-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 8px 30px rgba(0,0,0,.25)}
.gm-start{position:relative;width:min(420px,100%);padding:22px;display:flex;flex-direction:column;gap:12px}
.gm-start h2{margin:0}.gm-start p{margin:0}
.gm-field{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted)}
.gm-start input,.gm-set input[type=text]{height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.06);font-size:16px}
.gm-start input:focus{outline:2px solid var(--accent)}
.gm-or{text-align:center;font-size:12px;color:var(--muted)}
.gm-join{display:flex;gap:8px}.gm-join input{flex:1;min-width:0;text-transform:uppercase;letter-spacing:.2em}
.gm-start .pill,.gm-lobby .pill,.gm-set .pill{height:42px;padding:0 16px}
.gm-big-btn{font-weight:700;font-size:16px}
.gm-x{position:absolute;top:10px;right:10px}
.gm-lobby{position:fixed;top:72px;right:14px;width:320px;max-height:calc(100vh - 150px);overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px;z-index:6}
.gm-lobby p{margin:0}
.gm-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.gm-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.gm-code{font-size:26px;font-weight:700;letter-spacing:.18em;color:var(--accent)}
.gm-players{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;font-size:14px}
.gm-players li{display:flex;align-items:center;gap:8px}
.gm-dot{width:10px;height:10px;border-radius:50%;flex:none;display:inline-block}
.gm-team{font-size:11px;font-weight:700;padding:1px 7px;border-radius:99px}
.gm-team.r{background:#e5483b33;color:#ff8a80}.gm-team.b{background:#3b82f633;color:#8ab4ff}
.gm-modes{display:grid;grid-template-columns:1fr 1fr;gap:6px}.gm-modes .pill{height:38px;padding:0 10px;font-size:13px}
.gm-lobby .pill:disabled{opacity:.5;cursor:default}
.gm-muted{color:var(--muted);font-size:12px;margin:0}
.gm-top{position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:6px 14px;font-weight:700;font-size:18px;font-variant-numeric:tabular-nums;z-index:5}
.gm-ts{display:flex;gap:6px;font-size:16px}.gm-ts b{padding:0 8px;border-radius:8px}.gm-ts .r{background:#e5483b}.gm-ts .b{background:#3b82f6}
.gm-feed{position:fixed;top:72px;right:14px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;pointer-events:none;z-index:5}
.gm-feed div{background:var(--panel);padding:5px 12px;border-radius:10px;font-size:13px}
.gm-big{position:fixed;top:28%;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:12px 22px;border-radius:16px;background:rgba(18,26,38,.85);font-size:22px;font-weight:700;text-align:center;pointer-events:none;z-index:7}
.gm-mini{position:fixed;top:62px;left:14px;width:150px;height:150px;border-radius:14px;overflow:hidden;z-index:5;border:1px solid var(--line);background:#121a26}
.gm-mini canvas{width:100%;height:100%;display:block}
.gm-left{position:fixed;left:14px;bottom:18px;width:230px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;z-index:5}
.gm-bar{height:9px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}
.gm-bar i{display:block;height:100%;width:100%;transition:width .2s,background .2s}
.gm-bar.st{height:5px}.gm-bar.st i{background:#f2c062;transition:none}
.gm-hp-row{display:flex;justify-content:space-between;font-size:13px;font-weight:600}
.gm-right{position:fixed;right:14px;bottom:18px;padding:10px 14px;text-align:right;z-index:5;min-width:170px}
.gm-ammo{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}.gm-ammo small{font-size:15px;color:var(--muted);font-weight:500}
.gm-wname{font-size:13px;color:var(--muted)}
.gm-slots{display:flex;gap:4px;justify-content:flex-end;margin-top:6px}
.gm-slots span{font-size:11px;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,.08);color:var(--muted)}
.gm-slots span.on{background:var(--accent);color:var(--accent-ink);font-weight:700}
.gm-cross{position:fixed;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:4}
.gm-cross i{position:absolute;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.45)}
.gm-cross .t,.gm-cross .b{width:2px;height:8px;left:-1px}.gm-cross .l,.gm-cross .r{height:2px;width:8px;top:-1px}
.gm-cross .d{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:50%}
.gm-hit{position:fixed;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;pointer-events:none;opacity:0;z-index:4;
 background:linear-gradient(45deg,transparent 46%,#fff 46%,#fff 54%,transparent 54%),linear-gradient(-45deg,transparent 46%,#fff 46%,#fff 54%,transparent 54%);
 -webkit-mask:radial-gradient(circle,transparent 6px,#000 7px);mask:radial-gradient(circle,transparent 6px,#000 7px)}
.gm-hit.on{animation:gmhit .3s ease-out}.gm-hit.head{filter:sepia(1) saturate(9) hue-rotate(-50deg)}.gm-hit.kill{filter:sepia(1) saturate(12) hue-rotate(-30deg);animation-duration:.6s}
@keyframes gmhit{from{opacity:1;transform:scale(1.35)}to{opacity:0;transform:scale(1)}}
.gm-dmg{position:fixed;inset:0;pointer-events:none;z-index:3}
.gm-arc{position:absolute;left:50%;top:50%;width:240px;height:240px;margin:-120px 0 0 -120px;border-radius:50%;border-top:6px solid rgba(255,50,40,.85);filter:blur(1px);opacity:0;transition:opacity .6s}
.gm-vig{position:absolute;inset:0;box-shadow:inset 0 0 140px 40px rgba(200,20,20,.6);opacity:0;transition:opacity .4s}
.gm-scope{position:fixed;inset:0;pointer-events:none;z-index:3;background:radial-gradient(circle at 50% 50%,transparent 0,transparent min(36vh,36vw),#000 calc(min(36vh,36vw) + 2px))}
.gm-scope:before,.gm-scope:after{content:"";position:absolute;background:#000}
.gm-scope:before{left:50%;top:14%;bottom:14%;width:2px;margin-left:-1px}.gm-scope:after{top:50%;left:20%;right:20%;height:2px;margin-top:-1px}
.gm-radar{position:fixed;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:4;transition:opacity .5s}
.gm-radar i{position:absolute;left:-14px;top:-150px;width:0;height:0;border-left:14px solid transparent;border-right:14px solid transparent;border-bottom:26px solid #f2c062;filter:drop-shadow(0 0 6px #f2c062)}
.gm-flagst{position:fixed;top:62px;left:50%;transform:translateX(-50%);padding:6px 14px;font-size:13px;font-weight:600;z-index:5}
.gm-board{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(520px,calc(100vw - 32px));padding:16px;z-index:8}
.gm-board table{width:100%;border-collapse:collapse;font-size:14px}.gm-board th{color:var(--muted);font-weight:500;text-align:right;padding:4px 8px}
.gm-board td{padding:6px 8px;text-align:right;border-top:1px solid var(--line)}.gm-board td:first-child,.gm-board th:first-child{text-align:left}
.gm-board tr.me td{color:var(--accent)}
.gm-set{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(380px,calc(100vw - 32px));padding:18px;z-index:31;display:flex;flex-direction:column;gap:10px}
.gm-set h3{margin:0}.gm-set label{display:grid;grid-template-columns:120px 1fr 40px;align-items:center;gap:8px;font-size:13px}
.gm-set label.ck{grid-template-columns:auto 1fr}
.gm-set output{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.gm-tools{position:fixed;top:12px;left:14px;display:flex;gap:8px;z-index:6}
.gm-tools .pill{height:42px;padding:0 14px;font-weight:600}
.gm-aim{position:fixed;top:60%;left:50%;transform:translateX(-50%);padding:8px 14px;font-size:13px;color:var(--muted);pointer-events:none;z-index:4}
.gm-blind{position:fixed;inset:0;display:grid;place-items:center;text-align:center;background:rgba(8,12,18,.95);z-index:9}
.gm-blind p{margin:4px 0;font-size:18px}.gm-blind b{font-size:96px;color:var(--accent);font-variant-numeric:tabular-nums}
.gm-down{position:fixed;inset:0;pointer-events:none;z-index:3;background:radial-gradient(circle,transparent 30%,rgba(0,0,0,.65));}
.gm-tb{position:fixed;z-index:6;border-radius:50%;border:2px solid rgba(255,255,255,.4);background:rgba(22,30,44,.6);color:#fff;font-weight:700;font-size:12px;
 touch-action:none;user-select:none;-webkit-user-select:none;display:grid;place-items:center;backdrop-filter:blur(6px)}
.gm-tb:active,.gm-tb.on{background:rgba(242,192,98,.85);color:#1d1a12}
.gm-fire{right:22px;bottom:110px;width:92px;height:92px;background:rgba(229,72,59,.85);font-size:15px}
.gm-adsb{right:128px;bottom:150px;width:60px;height:60px}
.gm-rl{right:128px;bottom:80px;width:52px;height:52px}
.gm-jp{right:30px;bottom:212px;width:56px;height:56px}
.gm-cr{right:96px;bottom:222px;width:52px;height:52px}
.gm-sw{right:22px;bottom:24px;width:72px;height:44px;border-radius:14px}
.gm-tt{right:100px;bottom:24px;width:72px;height:44px;border-radius:14px}
.gm-sb{right:14px;top:60px;width:auto;height:36px;padding:0 12px;border-radius:12px;font-size:12px}
body.gaming .crosshair,body.gaming .walkexit,body.gaming .info,body.gaming .walkhint,body.gaming #labels{display:none!important}
body.gaming:not(.gm-touch) .joystick{display:none}
body.gm-touch .gm-right{right:auto;left:50%;transform:translateX(-50%);bottom:12px;text-align:center;padding:6px 12px;min-width:0}
body.gm-touch .gm-ammo{font-size:22px}body.gm-touch .gm-slots{display:none}
body.gm-touch .gm-left{left:auto;right:auto;top:12px;bottom:auto;left:50%;transform:translateX(-50%);width:200px;padding:6px 10px;margin-top:44px}
body.gm-touch .gm-top{font-size:15px;padding:4px 12px}
body.gm-touch .gm-mini{width:110px;height:110px}
body.gm-touch .gm-feed{top:104px}
body.gm-touch .gm-lobby{top:auto;bottom:12px;left:12px;right:12px;width:auto;max-height:55vh}
@media (max-width:720px){.gm-lobby{top:auto;bottom:12px;left:12px;right:12px;width:auto;max-height:55vh}.gm-big{font-size:18px}}
`;

const HTML = `
<section id="gmStart" class="gm-modal" hidden><div class="gm-card gm-start">
  <button class="iconbtn gm-x" id="gmClose" aria-label="Close">×</button>
  <h2>Play with friends</h2>
  <p class="gm-muted" style="font-size:13px">2 to 4 players, each in their own browser, anywhere on campus. Shootout, Team Deathmatch, Capture the Flag or Hide &amp; Seek.</p>
  <label class="gm-field">Your name<input id="gmName" maxlength="14" placeholder="e.g. Aayush" autocomplete="nickname" /></label>
  <button class="pill accent gm-big-btn" id="gmCreate">Create a room</button>
  <div class="gm-or">or join a friend</div>
  <div class="gm-join"><input id="gmCode" maxlength="5" placeholder="Room code" autocomplete="off" autocapitalize="characters" /><button class="pill" id="gmJoin">Join</button></div>
  <p class="gm-muted" id="gmStatus"></p>
</div></section>

<section id="gmLobby" class="gm-card gm-lobby" hidden>
  <div class="gm-head"><div><span class="gm-muted">ROOM CODE</span><div class="gm-code" id="gmRoom"></div></div><button class="pill" id="gmCopy">Copy invite link</button></div>
  <ul class="gm-players" id="gmPlayers"></ul>
  <div class="gm-modes" id="gmModes">
    <button class="pill" data-mode="dm">Shootout</button><button class="pill" data-mode="tdm">Team Deathmatch</button>
    <button class="pill" data-mode="ctf">Capture the Flag</button><button class="pill" data-mode="hs">Hide &amp; Seek</button>
  </div>
  <p class="gm-muted" id="gmModeInfo"></p>
  <div class="gm-row"><button class="pill accent" id="gmStartBtn">Start game</button><button class="pill" id="gmLeave">Leave</button></div>
  <p class="gm-muted" id="gmWait"></p>
  <p class="gm-muted" id="gmKeys"></p>
</section>

<div id="gmHud" hidden>
  <div class="gm-tools"><button class="gm-card pill" id="gmLeave2">Leave</button><button class="gm-card pill" id="gmSetBtn" aria-label="Settings">⚙</button></div>
  <div class="gm-card gm-top"><span id="gmTimer">Lobby</span><span class="gm-ts" id="gmTS" hidden><b class="r" id="gmTR">0</b><b class="b" id="gmTB">0</b></span></div>
  <div class="gm-card gm-flagst" id="gmFlagSt" hidden></div>
  <div class="gm-mini"><canvas id="gmMini" width="300" height="300"></canvas></div>
  <div class="gm-feed" id="gmFeed"></div>
  <div class="gm-big" id="gmBig" hidden></div>
  <div class="gm-cross" id="gmCross"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="d"></i></div>
  <div class="gm-hit" id="gmHit"></div>
  <div class="gm-dmg"><div class="gm-vig" id="gmVig"></div><div class="gm-arc" id="gmArc"></div></div>
  <div class="gm-scope" id="gmScope" hidden></div>
  <div class="gm-radar" id="gmRadar" style="opacity:0"><i></i></div>
  <div class="gm-down" id="gmDown" hidden></div>
  <div class="gm-card gm-left" id="gmLeft" hidden>
    <div class="gm-hp-row"><span id="gmHpT">100</span><span id="gmRole"></span></div>
    <div class="gm-bar"><i id="gmHp"></i></div>
    <div class="gm-bar st"><i id="gmSt"></i></div>
  </div>
  <div class="gm-card gm-right" id="gmRight">
    <div class="gm-wname" id="gmWName">Rifle</div>
    <div class="gm-ammo" id="gmAmmo">30 <small>/ 120</small></div>
    <div class="gm-slots" id="gmSlots"></div>
  </div>
  <div class="gm-card gm-aim" id="gmAim" hidden>Click the map to aim with your mouse</div>
  <button class="gm-tb gm-fire" id="gmFire" hidden>FIRE</button>
  <button class="gm-tb gm-adsb" id="gmAds" hidden>AIM</button>
  <button class="gm-tb gm-rl" id="gmRl" hidden>R</button>
  <button class="gm-tb gm-jp" id="gmJp" hidden>JUMP</button>
  <button class="gm-tb gm-cr" id="gmCr" hidden>DUCK</button>
  <button class="gm-tb gm-sw" id="gmSw" hidden>SWAP</button>
  <button class="gm-tb gm-tt" id="gmTt" hidden>TAUNT</button>
  <button class="gm-tb gm-sb" id="gmSb" hidden>Scores</button>
</div>
<div class="gm-card gm-board" id="gmBoard" hidden></div>
<div class="gm-card gm-set" id="gmSet" hidden>
  <h3>Settings</h3>
  <label>Look speed<input type="range" id="gsSens" min="0.3" max="2.5" step="0.05" /><output id="goSens"></output></label>
  <label>Field of view<input type="range" id="gsFov" min="60" max="95" step="1" /><output id="goFov"></output></label>
  <label>Master volume<input type="range" id="gsMaster" min="0" max="1" step="0.05" /><output id="goMaster"></output></label>
  <label>Music<input type="range" id="gsMusic" min="0" max="1" step="0.05" /><output id="goMusic"></output></label>
  <label>Effects<input type="range" id="gsSfx" min="0" max="1" step="0.05" /><output id="goSfx"></output></label>
  <label class="ck"><input type="checkbox" id="gsInv" /> Invert look up / down</label>
  <label class="ck"><input type="checkbox" id="gsLow" /> Low graphics (fewer effects)</label>
  <div class="gm-row"><button class="pill accent" id="gsDone">Done</button></div>
</div>
<div id="gmBlind" class="gm-blind" hidden><div><p>You're the seeker</p><b id="gmBlindT">30</b><p class="gm-muted" style="font-size:15px">Everyone else is hiding…</p></div></div>
`;

export const COLORS = ["#e5483b", "#3b82f6", "#22c55e", "#f5b800"];
export const TEAM_COLORS = { r: "#e5483b", b: "#3b82f6" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function createHUD() {
  if (!document.getElementById("gmStyle")) {
    const st = document.createElement("style"); st.id = "gmStyle"; st.textContent = CSS; document.head.append(st);
    const wrap = document.createElement("div"); wrap.id = "gmRoot"; wrap.innerHTML = HTML; document.body.append(wrap);
  }
  const $ = (id) => document.getElementById(id);
  let bigT = 0, arcT = 0, radarT = 0;

  const api = {
    $,
    big(text, ms = 2200) { const el = $("gmBig"); el.textContent = text; el.hidden = false; clearTimeout(bigT); bigT = setTimeout(() => (el.hidden = true), ms); },
    feed(text) {
      const f = $("gmFeed"), li = document.createElement("div");
      li.textContent = text; f.prepend(li);
      setTimeout(() => li.remove(), 6000);
      while (f.children.length > 4) f.lastChild.remove();
    },
    hit(kind = "") { const el = $("gmHit"); el.className = "gm-hit"; void el.offsetWidth; el.className = "gm-hit on " + kind; },
    /** angle: direction of the attacker relative to where you look (radians, 0 = ahead). */
    damage(angle) {
      const a = $("gmArc"), v = $("gmVig");
      a.style.transform = `rotate(${angle}rad)`; a.style.transition = "none"; a.style.opacity = 1;
      v.style.transition = "none"; v.style.opacity = 0.9;
      void a.offsetWidth;
      a.style.transition = "opacity .9s"; v.style.transition = "opacity .5s";
      clearTimeout(arcT); arcT = setTimeout(() => { a.style.opacity = 0; v.style.opacity = 0; }, 60);
    },
    radar(angle, show) {
      const r = $("gmRadar");
      r.style.transform = `rotate(${angle}rad)`;
      if (show) { r.style.opacity = 1; clearTimeout(radarT); radarT = setTimeout(() => (r.style.opacity = 0), 4000); }
    },
    crosshair(px, visible = true) {
      const c = $("gmCross"); c.style.display = visible ? "" : "none";
      const g = 4 + px;
      c.children[0].style.top = `${-g - 8}px`; c.children[1].style.top = `${g}px`;
      c.children[2].style.left = `${-g - 8}px`; c.children[3].style.left = `${g}px`;
    },
    ammo(w, mag, reserve, reloading) {
      $("gmWName").textContent = reloading ? `${w.name} · reloading…` : w.name;
      $("gmAmmo").innerHTML = `${mag} <small>/ ${reserve}</small>`;
      $("gmAmmo").style.color = mag === 0 ? "#ff6b5e" : "";
    },
    slots(weapons, cur) { $("gmSlots").innerHTML = weapons.map((w, i) => `<span class="${i === cur ? "on" : ""}">${w.key} ${w.name}</span>`).join(""); },
    health(hp, stamina, role) {
      $("gmHpT").textContent = role === null ? `${Math.max(0, Math.round(hp))} HP` : "";
      $("gmHp").style.width = Math.max(0, hp) + "%";
      $("gmHp").style.background = hp > 50 ? "#22c55e" : hp > 25 ? "#f5b800" : "#e5483b";
      $("gmSt").style.width = Math.round(stamina * 100) + "%";
      $("gmRole").textContent = role || "";
    },
    board(G, myId, show) {
      const b = $("gmBoard");
      b.hidden = !show;
      if (!show || !G) return;
      const ids = Object.keys(G.players).sort((a, c) => G.players[c].score - G.players[a].score);
      const team = G.mode === "tdm" || G.mode === "ctf";
      b.innerHTML = `<table><tr><th>Player</th>${team ? "<th>Team</th>" : ""}<th>Score</th><th>Takedowns</th><th>Downs</th></tr>` +
        ids.map((id) => {
          const p = G.players[id];
          return `<tr class="${id === myId ? "me" : ""}"><td><span class="gm-dot" style="background:${COLORS[p.slot]}"></span> ${esc(p.name)}</td>${team ? `<td><span class="gm-team ${p.team}">${p.team === "r" ? "RED" : "BLUE"}</span></td>` : ""}<td>${p.score}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`;
        }).join("") + "</table>";
    },
    lobby(G, { code, myId, isHost, modes, maxPlayers }) {
      $("gmLobby").hidden = G.phase !== "lobby";
      $("gmRoom").textContent = code;
      const ids = Object.keys(G.players);
      const team = G.mode === "tdm" || G.mode === "ctf";
      $("gmPlayers").innerHTML = ids.map((id) => {
        const p = G.players[id];
        return `<li><span class="gm-dot" style="background:${COLORS[p.slot]}"></span>${esc(p.name)}${id === myId ? " <span class='gm-muted'>(you)</span>" : ""}${isHost && id === myId ? " <span class='gm-muted'>· host</span>" : ""}${team ? ` <span class="gm-team ${p.team}">${p.team === "r" ? "RED" : "BLUE"}</span>` : ""}</li>`;
      }).join("") + (ids.length < maxPlayers ? `<li class="gm-muted">${maxPlayers - ids.length} more can join</li>` : "");
      for (const b of $("gmModes").children) { b.classList.toggle("on", b.dataset.mode === G.mode); b.disabled = !isHost; }
      $("gmModeInfo").textContent = modes[G.mode].info;
      $("gmStartBtn").hidden = !isHost;
      $("gmStartBtn").disabled = ids.length < 2;
      $("gmWait").textContent = isHost ? (ids.length < 2 ? "Waiting for friends to join. Walk around and try the guns meanwhile!" : "") : "Waiting for the host to start. Try the guns meanwhile!";
    },
    teamScore(G) {
      const team = G.mode === "tdm" || G.mode === "ctf";
      $("gmTS").hidden = !team || G.phase === "lobby";
      if (team) { $("gmTR").textContent = G.ts.r; $("gmTB").textContent = G.ts.b; }
    },
    settings(s, onChange) {
      const pairs = [["gsSens", "goSens", "sens", (v) => v.toFixed(2)], ["gsFov", "goFov", "fov", (v) => v + "°"], ["gsMaster", "goMaster", "master", (v) => Math.round(v * 100)],
        ["gsMusic", "goMusic", "music", (v) => Math.round(v * 100)], ["gsSfx", "goSfx", "sfx", (v) => Math.round(v * 100)]];
      for (const [i, o, k, f] of pairs) {
        const el = $(i); el.value = s[k]; $(o).textContent = f(+s[k]);
        el.oninput = () => { s[k] = +el.value; $(o).textContent = f(s[k]); onChange(s); };
      }
      $("gsInv").checked = s.invert; $("gsInv").onchange = (e) => { s.invert = e.target.checked; onChange(s); };
      $("gsLow").checked = s.low; $("gsLow").onchange = (e) => { s.low = e.target.checked; onChange(s); };
    },
  };
  return api;
}

/** Minimap: the campus drawn once, with players, flags and pings on top. */
export function createMinimap(canvas, data) {
  const B = data.boundary && data.boundary.length > 2 ? data.boundary : null;
  const pts = B || data.buildings.flatMap((b) => b.pts);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = 25;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const S = canvas.width, span = Math.max(maxX - minX, maxY - minY), k = S / span;
  const ox = (S - (maxX - minX) * k) / 2, oy = (S - (maxY - minY) * k) / 2;
  const toC = ([x, y]) => [ox + (x - minX) * k, S - (oy + (y - minY) * k)];
  const base = document.createElement("canvas"); base.width = base.height = S;
  const g = base.getContext("2d");
  g.fillStyle = "#16202e"; g.fillRect(0, 0, S, S);
  const poly = (p, fill, stroke, lw = 1) => {
    g.beginPath(); p.forEach((q, i) => { const [a, b] = toC(q); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
  };
  if (B) poly(B, "#22324a", "#b03a26", 2);
  for (const f of data.features) poly(f.pts, f.kind === "parking" ? "#3a4352" : "#2f5a2f");
  g.strokeStyle = "#556377"; g.lineCap = "round";
  for (const r of data.roads) {
    g.lineWidth = Math.max(1, r.w * k * 0.8);
    g.beginPath(); r.pts.forEach((q, i) => { const [a, b] = toC(q); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.stroke();
  }
  for (const b of data.buildings) poly(b.pts, "#8b95a5");
  const ctx = canvas.getContext("2d");

  /** items: [{x, y, color, kind: "me"|"dot"|"flag"|"ping", yaw}] */
  function draw(items) {
    ctx.drawImage(base, 0, 0);
    for (const it of items) {
      const [a, b] = toC([it.x, it.y]);
      ctx.save(); ctx.translate(a, b);
      if (it.kind === "me") {
        ctx.rotate(-it.yaw);
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.stroke(); ctx.fill();
      } else if (it.kind === "flag") {
        ctx.fillStyle = it.color; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-2, 10); ctx.lineTo(-2, -12); ctx.lineTo(12, -6); ctx.lineTo(-2, 0); ctx.stroke(); ctx.fill();
      } else if (it.kind === "ping") {
        ctx.strokeStyle = it.color; ctx.lineWidth = 3; ctx.globalAlpha = it.alpha ?? 1;
        ctx.beginPath(); ctx.arc(0, 0, 10 + (1 - (it.alpha ?? 1)) * 14, 0, 7); ctx.stroke();
      } else {
        ctx.fillStyle = it.color; ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); ctx.stroke(); ctx.fill();
      }
      ctx.restore();
    }
  }
  return { draw };
}
