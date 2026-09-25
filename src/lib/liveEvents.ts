import { API_BASE_URL, handleExpiredSession } from "./http";
import { applyVersions, cachedDeps, setLive } from "./cache";

/**
 * Keeps one stream to /api/events open per tab. The server pushes data-version bumps
 * ("payments moved to 13"), so the cache can serve everything without asking the server
 * whether it changed. Only dep names and numbers come over it, never data.
 *
 * Uses fetch (not EventSource) so the token travels in the Authorization header, never in a URL.
 * Reconnects with backoff; every (re)connect sends the deps the cache holds and gets their current
 * versions back (`hello`), so a change made while disconnected is never missed.
 */

const MAX_DEPS_IN_URL = 100;
const MAX_BACKOFF_MS = 30000;

let running = false;
let controller: AbortController | null = null;
let retryTimer: number | undefined;
let attempt = 0;

const handle = (block: string) => {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return; // heartbeat comment
  let versions: Record<string, number>;
  try {
    versions = JSON.parse(data);
  } catch {
    return;
  }
  if (event === "hello") {
    applyVersions(versions, true);
    attempt = 0;
    setLive(true);
  } else if (event === "bump") {
    applyVersions(versions);
  }
};

const schedule = () => {
  window.clearTimeout(retryTimer);
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
  attempt += 1;
  retryTimer = window.setTimeout(connect, delay);
};

async function connect() {
  const token = localStorage.getItem("token");
  if (!running || !token) return;
  controller = new AbortController();
  const deps = cachedDeps().slice(0, MAX_DEPS_IN_URL).join(",");
  try {
    const res = await fetch(`${API_BASE_URL}/events?deps=${encodeURIComponent(deps)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 401) {
      stopLiveEvents();
      handleExpiredSession();
      return;
    }
    if (!res.ok || !res.body) throw new Error(`events: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        handle(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
    }
  } catch {
    // aborted, offline or server restarting: fall back to revalidation until reconnected
  }
  setLive(false);
  if (running) schedule();
}

// Back online: reconnect right away instead of waiting out the backoff
window.addEventListener("online", () => {
  if (running) {
    attempt = 0;
    controller?.abort();
  }
});

/** Open the stream (after sign-in / on load with a stored token). Safe to call repeatedly. */
export function startLiveEvents() {
  if (running) return;
  running = true;
  attempt = 0;
  connect();
}

/** Close the stream (on logout). Cached data is then revalidated as before. */
export function stopLiveEvents() {
  running = false;
  window.clearTimeout(retryTimer);
  controller?.abort();
  controller = null;
  setLive(false);
}
