// Every game sound is synthesised with the Web Audio API: no files to download, so the game
// starts instantly. World sounds are 3D (PannerNode) and can be muffled when a wall is in the way.
// Music is a small step sequencer with an "intensity" layer that rises in fights and final seconds.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// gunshot recipes: crack (supersonic snap), body (muzzle blast), thump (low punch), reverb send
const GUNS = {
  pistol: { crackF: 3200, crackD: 0.05, crackG: 0.55, bodyF: 2600, bodyD: 0.16, bodyG: 0.8, thumpF: 170, thumpD: 0.1, thumpG: 0.5, verb: 0.25 },
  rifle: { crackF: 2600, crackD: 0.06, crackG: 0.7, bodyF: 2100, bodyD: 0.15, bodyG: 0.95, thumpF: 120, thumpD: 0.12, thumpG: 0.75, verb: 0.3 },
  shotgun: { crackF: 1800, crackD: 0.08, crackG: 0.6, bodyF: 1400, bodyD: 0.36, bodyG: 1.15, thumpF: 85, thumpD: 0.26, thumpG: 1.0, verb: 0.42, rack: 0.42 },
  sniper: { crackF: 3600, crackD: 0.07, crackG: 0.95, bodyF: 1800, bodyD: 0.48, bodyG: 1.15, thumpF: 70, thumpD: 0.3, thumpG: 1.0, verb: 0.6, rack: 0.55 },
};

export function createAudio({ isTouch = false } = {}) {
  let ctx = null, master, sfx, musicBus, reverb, noiseBuf;
  const vol = { master: 0.8, music: 0.35, sfx: 0.9 };

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ctx.createGain(); sfx = ctx.createGain(); musicBus = ctx.createGain();
    sfx.connect(master); musicBus.connect(master); master.connect(comp).connect(ctx.destination);
    // white noise, reused by every noisy sound
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // synthetic room/outdoor reverb: decaying stereo noise
    const len = Math.floor(ctx.sampleRate * 1.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    reverb = ctx.createConvolver(); reverb.buffer = ir;
    const rg = ctx.createGain(); rg.gain.value = 0.35;
    reverb.connect(rg).connect(sfx);
    setVolumes(vol);
    return ctx;
  }
  function resume() { if (init() && ctx.state === "suspended") ctx.resume(); }
  function setVolumes(v) {
    Object.assign(vol, v);
    if (!ctx) return;
    master.gain.value = vol.master; sfx.gain.value = vol.sfx; musicBus.gain.value = vol.music;
  }

  // ---------- routing ----------
  const listener = { x: 0, y: 0, z: 0 };
  function setListener(cam) {
    if (!ctx) return;
    const L = ctx.listener, p = cam.position;
    const f = cam.getWorldDirection(cam.userData._fwd || (cam.userData._fwd = p.clone()));
    listener.x = p.x; listener.y = p.y; listener.z = p.z;
    if (L.positionX) {
      const t = ctx.currentTime;
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }
  /** An input node for one sound: optional 3D position, wall muffling and reverb send. */
  function out(pos, { occluded = false, verb = 0.15, ref = 3 } = {}) {
    const inp = ctx.createGain();
    let node = inp;
    if (occluded) {
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600; lp.Q.value = 0.5;
      node.connect(lp); node = lp;
    }
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = isTouch ? "equalpower" : "HRTF";
      p.distanceModel = "inverse"; p.refDistance = ref; p.rolloffFactor = 1.1; p.maxDistance = 800;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      node.connect(p); node = p;
    }
    node.connect(sfx);
    if (verb > 0) { const s = ctx.createGain(); s.gain.value = verb; node.connect(s); s.connect(reverb); }
    return inp;
  }

  // ---------- building blocks ----------
  function noise(t, dest, { type = "bandpass", f = 1000, f2 = 0, q = 1, gain = 0.5, attack = 0.002, decay = 0.1 }) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    s.connect(fl).connect(g).connect(dest);
    s.start(t, Math.random() * 0.8);
    s.stop(t + attack + decay + 0.05);
  }
  function tone(t, dest, { type = "sine", f = 440, f2 = 0, gain = 0.3, attack = 0.004, decay = 0.2, lp = 0 }) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    let n = o;
    if (lp) { const fl = ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = lp; o.connect(fl); n = fl; }
    n.connect(g).connect(dest);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }
  const click = (t, dest, f = 3000, gain = 0.35) => {
    noise(t, dest, { type: "highpass", f, q: 0.7, gain, decay: 0.018 });
    tone(t, dest, { type: "square", f: f / 3, gain: gain * 0.25, decay: 0.012 });
  };

  // ---------- sound effects ----------
  const ready = () => !!ctx && ctx.state !== "closed";
  const S = {
    /** kind: pistol | rifle | shotgun | sniper. pos: THREE.Vector3 or null for your own gun. */
    gunshot(kind, pos = null, { distant = false, occluded = false } = {}) {
      if (!ready()) return;
      const P = GUNS[kind] || GUNS.rifle, t = ctx.currentTime;
      const o = out(pos, { occluded, verb: distant ? P.verb + 0.35 : P.verb, ref: 6 });
      const k = distant ? 0.55 : 1;
      if (!distant) noise(t, o, { type: "highpass", f: P.crackF, q: 0.6, gain: P.crackG, decay: P.crackD });
      noise(t, o, { type: "lowpass", f: distant ? 1100 : P.bodyF, f2: 180, q: 0.9, gain: P.bodyG * k, decay: P.bodyD * (distant ? 1.5 : 1) });
      tone(t, o, { f: P.thumpF, f2: 38, gain: P.thumpG * k, decay: P.thumpD });
      if (P.rack && !pos) { // pump / bolt after the shot, own gun only
        click(t + P.rack, o, 1500, 0.25);
        noise(t + P.rack + 0.03, o, { f: 900, f2: 2600, q: 2, gain: 0.18, decay: 0.12 });
        click(t + P.rack + 0.18, o, 2200, 0.3);
      }
    },
    reload(kind, dur) {
      if (!ready()) return;
      const t = ctx.currentTime, o = out(null, { verb: 0.05 });
      click(t + 0.12, o, 1700, 0.3);                                       // mag release
      noise(t + 0.18, o, { f: 600, f2: 300, q: 1, gain: 0.12, decay: 0.15 }); // mag slides out
      click(t + dur * 0.55, o, 1300, 0.4); click(t + dur * 0.55 + 0.05, o, 2400, 0.3); // mag in
      noise(t + dur * 0.8, o, { f: 900, f2: 3000, q: 2, gain: 0.2, decay: 0.1 });       // rack
      click(t + dur * 0.8 + 0.1, o, 2600, 0.4);
    },
    empty() { if (ready()) click(ctx.currentTime, out(null, { verb: 0 }), 4200, 0.3); },
    swap() {
      if (!ready()) return;
      const t = ctx.currentTime, o = out(null, { verb: 0 });
      noise(t, o, { f: 700, f2: 1800, q: 1.2, gain: 0.14, decay: 0.16 });
      click(t + 0.2, o, 2000, 0.3);
    },
    footstep(pos, { run = false, crouch = false, grass = false } = {}) {
      if (!ready()) return;
      const t = ctx.currentTime, o = out(pos, { verb: 0.05, ref: 2 });
      const g = crouch ? 0.05 : run ? 0.26 : 0.15;
      noise(t, o, { type: "lowpass", f: grass ? 520 : 1100, q: 0.8, gain: g, decay: grass ? 0.09 : 0.06 });
      tone(t, o, { f: 90 + Math.random() * 20, f2: 50, gain: g * 0.6, decay: 0.06 });
    },
    land() { if (!ready()) return; const t = ctx.currentTime, o = out(null); tone(t, o, { f: 100, f2: 40, gain: 0.35, decay: 0.12 }); noise(t, o, { type: "lowpass", f: 600, gain: 0.2, decay: 0.08 }); },
    hit() { if (!ready()) return; const t = ctx.currentTime, o = out(null, { verb: 0 }); tone(t, o, { type: "triangle", f: 1900, gain: 0.18, decay: 0.05 }); noise(t, o, { type: "highpass", f: 5000, gain: 0.12, decay: 0.03 }); },
    headshot() { if (!ready()) return; const t = ctx.currentTime, o = out(null, { verb: 0.2 }); tone(t, o, { f: 1250, gain: 0.3, decay: 0.5 }); tone(t, o, { f: 2500, gain: 0.12, decay: 0.35 }); tone(t, o, { f: 3760, gain: 0.05, decay: 0.25 }); },
    hurt() { if (!ready()) return; const t = ctx.currentTime, o = out(null, { verb: 0 }); tone(t, o, { f: 120, f2: 50, gain: 0.5, decay: 0.25 }); noise(t, o, { type: "lowpass", f: 380, gain: 0.3, decay: 0.2 }); },
    kill() { if (!ready()) return; const t = ctx.currentTime, o = out(null, { verb: 0.2 }); tone(t, o, { type: "triangle", f: 880, gain: 0.25, decay: 0.12 }); tone(t + 0.09, o, { type: "triangle", f: 1320, gain: 0.25, decay: 0.25 }); },
    beep(high = false) { if (!ready()) return; tone(ctx.currentTime, out(null, { verb: 0.05 }), { type: "square", f: high ? 1320 : 880, gain: 0.12, decay: high ? 0.35 : 0.1, lp: 3000 }); },
    horn() {
      if (!ready()) return;
      const t = ctx.currentTime, o = out(null, { verb: 0.3 });
      for (const n of [57, 61, 64, 69]) tone(t, o, { type: "sawtooth", f: midi(n), gain: 0.07, attack: 0.03, decay: 0.8, lp: 1800 });
    },
    fanfare(win = true) {
      if (!ready()) return;
      const t = ctx.currentTime, o = out(null, { verb: 0.3 });
      const notes = win ? [60, 64, 67, 72, 76] : [64, 60, 57, 52];
      notes.forEach((n, i) => tone(t + i * 0.13, o, { type: "triangle", f: midi(n), gain: 0.2, decay: i === notes.length - 1 ? 0.8 : 0.18 }));
    },
    ping() { if (!ready()) return; const t = ctx.currentTime, o = out(null, { verb: 0.8 }); tone(t, o, { f: 1500, f2: 900, gain: 0.25, decay: 0.7 }); },
    taunt(pos) {
      if (!ready()) return;
      const t = ctx.currentTime, o = out(pos, { verb: 0.3, ref: 8 });
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.frequency.setValueAtTime(900, t); osc.frequency.linearRampToValueAtTime(1900, t + 0.25); osc.frequency.linearRampToValueAtTime(700, t + 0.6);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
      osc.connect(g).connect(o); osc.start(t); osc.stop(t + 0.7);
    },
    flag(good = true) {
      if (!ready()) return;
      const t = ctx.currentTime, o = out(null, { verb: 0.2 });
      const ns = good ? [72, 79] : [67, 60];
      ns.forEach((n, i) => tone(t + i * 0.1, o, { type: "square", f: midi(n), gain: 0.12, decay: 0.2, lp: 2500 }));
    },
    impact(pos, surface) {
      if (!ready()) return;
      const t = ctx.currentTime, o = out(pos, { verb: 0.05, ref: 2 });
      if (surface === "ground") noise(t, o, { type: "lowpass", f: 700, gain: 0.25, decay: 0.08 });
      else noise(t, o, { type: "bandpass", f: surface === "metal" ? 4200 : 2400, q: 3, gain: 0.25, decay: 0.05 });
    },
  };

  // ---------- music ----------
  const M = { song: null, step: 0, bar: 0, next: 0, timer: 0, intensity: 0, target: 0, gain: null };
  const SONGS = {
    // calm lobby: A minor, F, C, G; soft pad, plucked arpeggio, light hats
    lobby: {
      bpm: 84, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
      step(t, s, ch, I, d) {
        if (s === 0) for (const n of ch) tone(t, d, { type: "sawtooth", f: midi(n), gain: 0.025, attack: 0.6, decay: 2.2, lp: 900 });
        if (s % 2 === 0) tone(t, d, { type: "triangle", f: midi(ch[(s / 2) % 3] + 12), gain: 0.05, decay: 0.35 });
        if (s % 4 === 2) noise(t, d, { type: "highpass", f: 7000, gain: 0.02, decay: 0.03 });
        if (s === 0 || s === 8) tone(t, d, { f: midi(ch[0] - 12), gain: 0.08, decay: 0.6 });
      },
    },
    // tense fight: driving kick, offbeat bass, snare, hats; intensity adds stabs and a lead arp
    fight: {
      bpm: 126, chords: [[45, 48, 52], [45, 48, 52], [41, 45, 48], [43, 47, 50]],
      step(t, s, ch, I, d) {
        if (s % 4 === 0) { tone(t, d, { f: 150, f2: 42, gain: 0.32, decay: 0.22 }); }
        if (s % 8 === 4) { noise(t, d, { f: 1800, q: 0.8, gain: 0.14, decay: 0.14 }); tone(t, d, { type: "triangle", f: 190, gain: 0.08, decay: 0.07 }); }
        noise(t, d, { type: "highpass", f: 8000, gain: s % 2 ? 0.03 : 0.015, decay: 0.025 });
        if ([0, 3, 6, 8, 11, 14].includes(s)) tone(t, d, { type: "sawtooth", f: midi(ch[0]), gain: 0.07, decay: 0.16, lp: 520 + I * 900 });
        if (I > 0.3 && (s === 0 || s === 10)) for (const n of ch) tone(t, d, { type: "square", f: midi(n + 12), gain: 0.022 * I, decay: 0.14, lp: 1800 });
        if (I > 0.6) tone(t, d, { type: "square", f: midi(ch[[0, 1, 2, 1][s % 4]] + 24), gain: 0.022 * I, decay: 0.08, lp: 2600 });
      },
    },
    // sneaky hide & seek: staccato plucks on a chromatic line; intensity adds a heartbeat and tension
    hide: {
      bpm: 96, chords: [[50], [50], [46], [45]], line: [50, 53, 54, 55, 57, 56, 55, 53],
      step(t, s, ch, I, d, bar) {
        if ([0, 3, 6, 8, 10, 12, 14].includes(s)) tone(t, d, { type: "triangle", f: midi(this.line[(s + bar * 3) % 8]), gain: 0.07, decay: 0.09 });
        if (s % 8 === 0) tone(t, d, { f: 110, f2: 45, gain: 0.16, decay: 0.2 });
        if (s % 2) noise(t, d, { type: "highpass", f: 6000, gain: 0.012, decay: 0.04 });
        if (s === 0) tone(t, d, { type: "sawtooth", f: midi(ch[0] - 12), gain: 0.03, attack: 0.3, decay: 2.2, lp: 400 });
        if (I > 0.4 && (s === 0 || s === 2)) tone(t, d, { f: 60, f2: 40, gain: 0.25 * I, decay: 0.12 });
        if (I > 0.5 && s === 0) { tone(t, d, { type: "sawtooth", f: midi(62), gain: 0.012 * I, attack: 0.5, decay: 2, lp: 1200 }); tone(t, d, { type: "sawtooth", f: midi(68), gain: 0.012 * I, attack: 0.5, decay: 2, lp: 1200 }); }
      },
    },
  };
  function music(name) {
    if (!init()) return;
    if (M.song === name) return;
    if (!M.gain) { M.gain = ctx.createGain(); M.gain.connect(musicBus); }
    M.song = name;
    if (!name) { M.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4); return; }
    M.gain.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    M.step = 0; M.bar = 0; M.next = ctx.currentTime + 0.1;
    if (!M.timer) M.timer = setInterval(schedule, 25);
  }
  function schedule() {
    if (!ctx || !M.song) return;
    const song = SONGS[M.song];
    M.intensity += (M.target - M.intensity) * 0.05;
    const stepDur = 60 / song.bpm / 4;
    if (M.next < ctx.currentTime - 0.5) M.next = ctx.currentTime + 0.05; // tab was in background
    while (M.next < ctx.currentTime + 0.12) {
      song.step(M.next, M.step, song.chords[M.bar % song.chords.length], M.intensity, M.gain, M.bar);
      M.step = (M.step + 1) % 16;
      if (M.step === 0) M.bar++;
      M.next += stepDur;
    }
  }
  function stop() {
    music(null);
    if (M.timer) { clearInterval(M.timer); M.timer = 0; }
  }

  return {
    init, resume, setVolumes, setListener, music, stop,
    set intensity(v) { M.target = Math.max(0, Math.min(1, v)); },
    get ctx() { return ctx; },
    listener,
    ...S,
  };
}
