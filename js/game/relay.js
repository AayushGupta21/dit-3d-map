// Fallback transport through Supabase Realtime (broadcast channels). Used when two browsers can't
// open a direct WebRTC connection (mobile data, strict college / office wifi). Every player has an
// inbox channel; the host's inbox is "<room>-h". Messages are plain JSON objects.
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";

function loadScript(src) {
  if (window.supabase && window.supabase.createClient) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => { s.remove(); rej(new Error("relay library failed to load")); };
    document.head.append(s);
  });
}

export function relayConfigured() {
  const c = window.DIT_CONFIG || {};
  return !!(c.SUPABASE_URL && c.SUPABASE_KEY && !String(c.SUPABASE_KEY).startsWith("PASTE_"));
}

export async function createRelay() {
  const c = window.DIT_CONFIG || {};
  await loadScript(SUPABASE_JS);
  const client = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_KEY, {
    realtime: { params: { eventsPerSecond: 60 } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const outs = new Map();

  function join(name, onMsg) {
    return new Promise((resolve, reject) => {
      const ch = client.channel(name, { config: { broadcast: { self: false, ack: false } } });
      if (onMsg) ch.on("broadcast", { event: "m" }, ({ payload }) => { if (payload && typeof payload === "object") onMsg(payload); });
      const to = setTimeout(() => reject(new Error("relay timeout")), 9000);
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") { clearTimeout(to); resolve(ch); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(to); reject(new Error("relay " + status)); }
      });
    });
  }
  /** Listen on an inbox. */
  const listen = (name, onMsg) => join(name, onMsg);
  /** A send function for someone else's inbox (joined once, then reused). */
  async function to(name) {
    let p = outs.get(name);
    if (!p) { p = join(name, null); outs.set(name, p); }
    const ch = await p;
    return (msg) => ch.send({ type: "broadcast", event: "m", payload: msg });
  }
  function drop(name) {
    const p = outs.get(name);
    outs.delete(name);
    if (p) p.then((ch) => client.removeChannel(ch)).catch(() => {});
  }
  function close() { try { client.removeAllChannels(); } catch { /* already closed */ } }
  return { listen, to, drop, close };
}
