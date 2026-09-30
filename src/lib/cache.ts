import { useEffect, useRef, useState } from "react";
import http from "./http";

/**
 * Browser-side response cache for GET requests: fresh until the server says otherwise.
 *
 * - Every cached API response carries `X-Cache-Versions` ("payments=12,games=3"): the data
 *   versions it reflects. The server pushes version bumps over /api/events (see liveEvents.ts).
 * - While that stream is live, a cached entry is served with NO request at all until a pushed
 *   bump moves one of its versions; then it is dropped and views showing it refetch once.
 * - While the stream is down, it falls back to revalidating with If-None-Match (a bodiless 304).
 * - Entries survive a reload of this tab (sessionStorage), are tied to the signed-in token, and
 *   are wiped on logout. They are never shared with other tabs or kept after the tab closes.
 * - Identical concurrent requests share one network call.
 *
 * Invalidation is strict:
 * - A request that was in flight when its URL was invalidated is never stored or returned: the
 *   caller transparently gets a fresh fetch instead (no stale write-back).
 * - A response older than a version this tab already heard about is treated the same way.
 * - This tab's own writes invalidate by URL prefix at once, and are broadcast to other open tabs.
 */

type Versions = Record<string, number>;

interface Entry {
  etag?: string;
  data: unknown;
  at: number;
  /** Data versions this body reflects; entries without them are always revalidated */
  versions?: Versions;
  /** Deps a delta-synced list brings up to date itself (only changed rows are fetched, then `markVersions`) */
  deltaDeps?: string[];
}

interface Pending {
  promise: Promise<unknown>;
  /** Set when the URL was invalidated while this request was running */
  stale: boolean;
}

/** Fired with `{ prefixes }` (own writes) or `{ deps }` (pushed bumps) whenever cached data is dropped. */
export const DATA_CHANGED_EVENT = "data-changed";
export interface DataChangedDetail {
  prefixes?: string[];
  /** Deps whose version moved, with their new version */
  deps?: Versions;
}

const MAX_ENTRIES = 200;
const STORAGE_KEY = "app-cache:v1";
const store = new Map<string, Entry>();
const inFlight = new Map<string, Pending>();
const listeners = new Map<string, Set<() => void>>();
/** Latest version heard for each dep (from the stream or from responses) */
const known = new Map<string, number>();
const writing = new Map<string, number>(); // dep prefix -> own writes in flight
const deferred = new Map<string, number>(); // bumps held back until those writes answer

export const keyOf = (url: string, params?: Record<string, unknown>) => {
  const q = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("&");
  return q ? `${url}?${q}` : url;
};

export const parseVersions = (header?: string | null): Versions | undefined => {
  if (!header) return undefined;
  const out: Versions = {};
  for (const part of header.split(",")) {
    const i = part.lastIndexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = Number(part.slice(i + 1));
  }
  return Object.keys(out).length ? out : undefined;
};

// ---- Persistence (this tab only) ------------------------------------------------

// Identifies the signed-in session without storing the token itself
const ownerOf = (token: string | null) => {
  if (!token) return "";
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (Math.imul(31, h) + token.charCodeAt(i)) | 0;
  return `${token.length}:${h}`;
};

let saveTimer: number | undefined;
const persist = () => {
  if (saveTimer !== undefined) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    let entries = Array.from(store.entries()).filter(([, e]) => e.versions);
    while (entries.length) {
      try {
        const owner = ownerOf(localStorage.getItem("token"));
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ owner, entries }));
        return;
      } catch {
        entries = entries.slice(Math.ceil(entries.length / 2)); // quota: keep the most recent half
      }
    }
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable: memory-only cache
    }
  }, 300);
};

const restore = () => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { owner: string; entries: [string, Entry][] };
    const owner = ownerOf(localStorage.getItem("token"));
    if (!owner || saved.owner !== owner) {
      sessionStorage.removeItem(STORAGE_KEY); // another session's data: never show it
      return;
    }
    for (const [key, entry] of saved.entries) store.set(key, entry);
  } catch {
    // corrupt or unavailable: start empty
  }
};
restore();

const remember = (key: string, entry: Entry) => {
  store.delete(key); // re-insert to keep Map order = recency
  store.set(key, entry);
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
  persist();
};

const notify = (keys: string[], detail: DataChangedDetail) => {
  keys.forEach((k) => listeners.get(k)?.forEach((fn) => fn()));
  window.dispatchEvent(new CustomEvent<DataChangedDetail>(DATA_CHANGED_EVENT, { detail }));
};

// ---- Live stream state -----------------------------------------------------------

let live = false;
let waitingForLive: (() => void)[] = [];
// On a fresh load with a token, give the stream a moment before falling back to revalidation
let startupDeadline = localStorage.getItem("token") ? Date.now() + 3000 : 0;

/** Set by liveEvents.ts: true once the stream is connected and its `hello` was applied. */
export function setLive(value: boolean) {
  live = value;
  if (value) {
    waitingForLive.forEach((fn) => fn());
    waitingForLive = [];
  }
}

const whenLiveOrTimeout = () =>
  new Promise<void>((resolve) => {
    const wait = startupDeadline - Date.now();
    if (live || wait <= 0) return resolve();
    waitingForLive.push(resolve);
    window.setTimeout(resolve, wait);
  });

/** Deps the cache currently holds, so a (re)connecting stream can report which of them moved. */
export function cachedDeps(): string[] {
  const deps = new Set<string>();
  store.forEach((e) => e.versions && Object.keys(e.versions).forEach((d) => deps.add(d)));
  return Array.from(deps);
}

/**
 * Apply versions pushed by the server: drop every entry built from a different version of any of
 * these deps, then tell views showing them to refetch.
 * `complete` (the stream's `hello`): the map covers every dep the stream vouches for, so entries
 * depending on a dep it left out can't be proven current and are dropped too.
 */
export function applyVersions(versions: Versions, complete = false) {
  // Bumps for data this tab is writing right now wait for the write's response (see trackedWrite)
  if (writing.size) {
    const now: Versions = {};
    for (const [d, v] of Object.entries(versions)) {
      if (Array.from(writing.keys()).some((p) => d.startsWith(p))) deferred.set(d, Math.max(v, deferred.get(d) ?? v));
      else now[d] = v;
    }
    versions = now;
  }
  const moved: Versions = {};
  for (const [dep, v] of Object.entries(versions)) {
    if (known.get(dep) !== v) moved[dep] = v;
    known.set(dep, v);
  }
  const dropped: string[] = [];
  store.forEach((e, key) => {
    // A mounted delta-synced list catches up on its own (only changed rows); anything else is dropped
    const catchesUp = (d: string) => !!e.deltaDeps?.includes(d) && listeners.has(key);
    const stale = Object.entries(e.versions || {}).some(
      ([d, v]) => !catchesUp(d) && (versions[d] === undefined ? complete : versions[d] !== v)
    );
    if (stale) dropped.push(key);
  });
  dropped.forEach((k) => store.delete(k));
  // (A request already in flight is checked when it lands: see `mismatched`)
  if (dropped.length) persist();
  if (dropped.length || Object.keys(moved).length) notify(dropped, { deps: moved });
}

// True when a response reflects a different version than the latest this tab heard pushed.
// Compared for equality only: counters are labels, and after a server-side store switch they may
// not be ordered. Such a body is still used, just not trusted to stay current (see cachedGet).
const mismatched = (versions?: Versions) =>
  !!versions && Object.entries(versions).some(([d, v]) => known.has(d) && known.get(d) !== v);

// Deps first seen in a response (not yet pushed) start from the response's version
const learn = (versions?: Versions) => {
  if (!versions) return;
  for (const [d, v] of Object.entries(versions)) if (!known.has(d)) known.set(d, v);
};

// ---- Reads -------------------------------------------------------------------

export interface CacheOptions {
  /** Seconds during which the cached body is returned without any request, even without the stream. */
  maxAge?: number;
  /**
   * For delta-synced lists: deps starting with this prefix are not dropped when bumped. The list's
   * `useDeltaSync` fetches only the changed rows instead and then marks the entry current.
   */
  deltaPrefix?: string;
}

export async function cachedGet<T>(url: string, params?: Record<string, unknown>, opts: CacheOptions = {}): Promise<T> {
  const key = keyOf(url, params);
  if (!live && store.get(key)?.versions) await whenLiveOrTimeout();

  const cached = store.get(key);
  // Pushed versions keep this entry current: no request needed
  if (cached && cached.versions && live) return cached.data as T;
  if (cached && opts.maxAge && Date.now() - cached.at < opts.maxAge * 1000) return cached.data as T;

  const existing = inFlight.get(key);
  if (existing) return existing.promise as Promise<T>;

  const pending: Pending = { promise: Promise.resolve(), stale: false };
  pending.promise = http
    .get(url, {
      params,
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
      validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
    })
    .then(async (res) => {
      if (pending.stale) return undefined;
      let versions = parseVersions(res.headers["x-cache-versions"]);
      if (res.status === 304) {
        if (cached && store.get(key) === cached) {
          cached.at = Date.now();
          cached.versions = mismatched(versions) ? undefined : versions ?? cached.versions;
          learn(versions);
          persist();
          return cached.data;
        }
        // 304 with nothing to reuse (e.g. browser-cache revalidation): fetch the full body
        res = await http.get(url, { params, headers: { "Cache-Control": "no-cache" } });
        if (pending.stale) return undefined;
        versions = parseVersions(res.headers["x-cache-versions"]);
      }
      // Raced with a pushed change: use this body, but revalidate it next time instead of trusting it
      if (mismatched(versions)) versions = undefined;
      learn(versions);
      const deltaDeps = opts.deltaPrefix && versions ? Object.keys(versions).filter((d) => d.startsWith(opts.deltaPrefix!)) : undefined;
      remember(key, { etag: res.headers.etag, data: res.data, at: Date.now(), versions, deltaDeps });
      return res.data;
    })
    .finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });

  inFlight.set(key, pending);
  const data = await pending.promise;
  // Invalidated mid-flight: the response may predate the write, so fetch again
  return (pending.stale ? cachedGet<T>(url, params, opts) : data) as T;
}

/** Last known body for a URL, for instant rendering while revalidating. */
export function peekCached<T>(url: string, params?: Record<string, unknown>): T | undefined {
  return store.get(keyOf(url, params))?.data as T | undefined;
}

/**
 * Update a cached body in place (after applying a delta). `versions` (from a write response's
 * `X-Data-Versions`) marks the patched body as current, so the pushed bump for this very write
 * does not trigger a refetch.
 */
export function updateCached<T>(url: string, params: Record<string, unknown> | undefined, fn: (data: T) => T, versions?: Versions) {
  const e = store.get(keyOf(url, params));
  if (!e) return;
  e.data = fn(e.data as T);
  if (versions && e.versions) {
    e.versions = { ...e.versions, ...versions };
    learn(versions);
  }
  persist();
}

/** A delta-synced list applied every change up to these versions: its cached copy is current again. */
export function markVersions(url: string, params: Record<string, unknown> | undefined, versions: Versions) {
  const e = store.get(keyOf(url, params));
  if (!e?.versions) return;
  for (const [d, v] of Object.entries(versions)) if (d in e.versions) e.versions[d] = v;
  persist();
}

/** Whether pushed versions currently keep the cache current (else it revalidates / polls). */
export const isLive = () => live;

/**
 * An own write whose result the caller patches into the cached `list` itself (instead of
 * refetching). The response's `X-Data-Versions` marks that entry current, so the pushed bump for
 * this very write costs nothing, while a bump from someone else's write in the meantime still
 * drops it. Works whichever arrives first, the response or the pushed bump.
 */
export async function trackedWrite<R extends { headers: Record<string, unknown> }>(
  depPrefix: string,
  list: { url: string; params?: Record<string, unknown> },
  send: () => Promise<R>
): Promise<R> {
  writing.set(depPrefix, (writing.get(depPrefix) || 0) + 1);
  try {
    const res = await send();
    const own = parseVersions(res.headers["x-data-versions"] as string | undefined);
    if (own) {
      const e = store.get(keyOf(list.url, list.params));
      // Only a copy that was current up to just before this write can be carried forward
      if (e?.versions) {
        for (const [d, v] of Object.entries(own)) if (d in e.versions && e.versions[d] === v - 1) e.versions[d] = v;
      }
      Object.entries(own).forEach(([d, v]) => known.set(d, v)); // straight from the server, just now
      persist();
    }
    return res;
  } finally {
    const left = (writing.get(depPrefix) || 1) - 1;
    if (left) writing.set(depPrefix, left);
    else {
      writing.delete(depPrefix);
      const held: Versions = {};
      deferred.forEach((v, d) => {
        if (d.startsWith(depPrefix)) {
          held[d] = v;
          deferred.delete(d);
        }
      });
      if (Object.keys(held).length) applyVersions(held);
    }
  }
}

/** Call `fn` whenever the entry for this URL is dropped (so a mounted view can refetch it). */
export function subscribe(url: string, params: Record<string, unknown> | undefined, fn: () => void): () => void {
  const key = keyOf(url, params);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(fn);
  return () => {
    const set = listeners.get(key);
    set?.delete(fn);
    if (set && !set.size) {
      listeners.delete(key);
      // A list that left the screen before catching up must not be served stale later
      const e = store.get(key);
      if (e?.versions && Object.entries(e.versions).some(([d, v]) => known.has(d) && known.get(d) !== v)) {
        store.delete(key);
        persist();
      }
    }
  };
}

/**
 * For loaders that keep their own state (e.g. patch rows locally): a number that goes up whenever
 * the cached entry for this request is dropped because its data changed. Put it in the loader's
 * effect deps to refetch exactly then.
 */
export function useDropTick(url: string | null, params?: Record<string, unknown>): number {
  const key = url ? keyOf(url, params) : "";
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    return subscribe(url, paramsRef.current, () => setTick((t) => t + 1));
  }, [url, key]);
  return tick;
}

/**
 * Cached GET as React state: renders the cached copy at once, fetches only when there is no
 * current copy, and refetches by itself whenever the server pushes a change to its data.
 * `url = null` skips loading.
 */
export function useCachedGet<T>(url: string | null, params?: Record<string, unknown>) {
  const key = url ? keyOf(url, params) : "";
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean; key: string }>(() => ({
    data: url ? peekCached<T>(url, params) : undefined,
    loading: !!url,
    key,
  }));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) return;
    return subscribe(url, paramsRef.current, () => setTick((t) => t + 1));
  }, [url, key]);

  useEffect(() => {
    if (!url) {
      setState({ loading: false, key: "" }); // e.g. signed out: forget the last body entirely
      return;
    }
    let cancelled = false;
    const peek = peekCached<T>(url, paramsRef.current);
    // Keep showing the previous data for this same query while it refetches
    setState((s) => ({ data: peek ?? (s.key === key ? s.data : undefined), loading: true, key }));
    cachedGet<T>(url, paramsRef.current)
      .then((data) => !cancelled && setState({ data, loading: false, key }))
      .catch((error) => !cancelled && setState((s) => ({ ...s, error, loading: false })));
    return () => {
      cancelled = true;
    };
  }, [url, key, tick]);

  return {
    data: state.key === key ? state.data : undefined,
    error: state.error,
    loading: state.loading,
    reload: () => setTick((t) => t + 1),
  };
}

// ---- Own writes --------------------------------------------------------------

const channel: BroadcastChannel | null = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("app-cache") : null;

const dropLocal = (prefixes: string[]) => {
  const hit = (key: string) => prefixes.some((p) => key.startsWith(p));
  const dropped: string[] = [];
  for (const key of Array.from(store.keys())) {
    if (hit(key)) {
      store.delete(key);
      dropped.push(key);
    }
  }
  for (const [key, p] of Array.from(inFlight.entries())) {
    if (hit(key)) {
      p.stale = true;
      inFlight.delete(key);
      if (!dropped.includes(key)) dropped.push(key);
    }
  }
  persist();
  notify(dropped, { prefixes });
};

/** Drop cached entries (and in-flight requests) whose URL starts with any of the prefixes, in every tab. */
export function invalidateCached(...prefixes: string[]) {
  dropLocal(prefixes);
  channel?.postMessage({ prefixes });
}

// Another tab wrote something: drop our copies too
channel?.addEventListener("message", (e: MessageEvent<{ prefixes?: string[] }>) => {
  if (Array.isArray(e.data?.prefixes)) dropLocal(e.data.prefixes);
});

/** Forget everything, e.g. on logout or login so the next user never sees cached data. */
export function clearCache() {
  store.clear();
  known.clear();
  inFlight.forEach((p) => (p.stale = true));
  inFlight.clear();
  startupDeadline = 0;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable
  }
}
