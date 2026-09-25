import { useEffect, useRef } from "react";
import http from "./http";
import { DATA_CHANGED_EVENT, DataChangedDetail, isLive, keyOf, markVersions, subscribe } from "./cache";

export interface SyncToken {
  version: string;
  cursor: string;
}

export interface ChangedRow {
  id: string;
  date: string;
  createdAt: string;
  /** Set on rows that were permanently deleted (tombstones carry only the id) */
  deleted?: boolean;
  /** false when the row no longer belongs in the list (e.g. the user deleted it on their side) */
  match: boolean;
}

interface ChangesResponse<T> {
  version: string;
  cursor: string;
  reset?: boolean;
  items?: (T & ChangedRow)[];
}

// Only while the push stream is down: fall back to checking now and then
const FALLBACK_POLL_MS = 60000;
// Deps whose bumps mean "rows of a payment list may have changed"
const LIST_DEP_PREFIX = "payments";

/**
 * Fetches only the changed rows of a list from its `/changes` endpoint and hands them to `onChanges`.
 * - Triggered by the server: runs when a pushed bump touches the list's data, or right after a write
 *   in this or another tab. Nothing is requested while nothing changes.
 * - Afterwards the list's cached copy (`list`) is marked current, so it is served without requests.
 * - Only while the push stream is down does it poll (every 60s, visible tabs only).
 * - `onReset` is called when too much changed to send as a delta (refetch the page instead).
 */
export function useDeltaSync<T>(opts: {
  url: string;
  params?: Record<string, unknown>;
  sync?: SyncToken;
  /** The cached list request this syncs (its entry is kept instead of dropped, then marked current) */
  list: { url: string; params?: Record<string, unknown> };
  onChanges: (items: (T & ChangedRow)[]) => void;
  onReset: () => void;
}) {
  const { url, params, sync, list } = opts;
  const syncRef = useRef<SyncToken | undefined>(sync);
  const handlers = useRef(opts);
  handlers.current = opts;
  const paramsKey = JSON.stringify(params || {});
  const listKey = keyOf(list.url, list.params);
  const listRef = useRef(list);
  listRef.current = list;

  // Keep the list's cache entry through pushed bumps while mounted (see cache.applyVersions);
  // if the entry is dropped anyway (e.g. a game was renamed), reload the page
  useEffect(() => subscribe(listRef.current.url, listRef.current.params, () => handlers.current.onReset()), [listKey]);

  // A fresh list load brings a fresh token
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  useEffect(() => {
    let stopped = false;
    let busy = false;
    let again = false; // a change arrived while polling: poll once more afterwards
    let pendingVersions: Record<string, number> = {}; // pushed versions this poll will bring us to

    const poll = async () => {
      const token = syncRef.current;
      if (busy) {
        again = true;
        return;
      }
      if (!token || stopped) return;
      busy = true;
      const target = pendingVersions;
      pendingVersions = {};
      try {
        const res = await http.get<ChangesResponse<T>>(url, {
          params: { ...JSON.parse(paramsKey), since: token.cursor, v: token.version },
          validateStatus: (s) => s === 200 || s === 204,
        });
        if (stopped) return;
        if (res.status !== 204) {
          syncRef.current = { version: res.data.version, cursor: res.data.cursor };
          if (res.data.reset) return handlers.current.onReset();
          if (res.data.items?.length) handlers.current.onChanges(res.data.items);
        }
        // Every change up to the pushed versions is applied: the cached list is current again
        if (Object.keys(target).length) markVersions(listRef.current.url, listRef.current.params, target);
      } catch {
        pendingVersions = { ...target, ...pendingVersions }; // retried on the next trigger
      } finally {
        busy = false;
        if (again) {
          again = false;
          poll();
        }
      }
    };

    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<DataChangedDetail>).detail || {};
      // (A write in this or another tab drops the list's entry: the subscription above reloads it)
      const moved = Object.entries(detail.deps || {}).filter(([d]) => d.startsWith(LIST_DEP_PREFIX));
      if (!moved.length) return;
      pendingVersions = { ...pendingVersions, ...Object.fromEntries(moved) };
      poll();
    };
    // Fallback while the push stream is down
    const timer = window.setInterval(() => !isLive() && !document.hidden && poll(), FALLBACK_POLL_MS);
    const onVisible = () => !isLive() && !document.hidden && poll();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(DATA_CHANGED_EVENT, onChanged);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(DATA_CHANGED_EVENT, onChanged);
    };
  }, [url, paramsKey]);
}

/**
 * Apply changed rows to a page of results (sorted by date desc):
 * replace rows we have, drop rows that left the filter, and insert brand-new rows on page 1.
 */
export function mergeChanges<R extends { id: string; date: string }>(
  page: { items: R[]; total: number; page: number },
  changes: (R & ChangedRow)[],
  opts: { limit: number; loadedAt?: string }
): { items: R[]; total: number } {
  let items = [...page.items];
  let total = page.total;
  for (const ch of changes) {
    const { match, createdAt, ...row } = ch;
    const idx = items.findIndex((r) => r.id === ch.id);
    if (idx >= 0) {
      if (match) items[idx] = { ...items[idx], ...(row as unknown as R) };
      else {
        items.splice(idx, 1);
        total -= 1;
      }
    } else if (match && page.page === 1 && (!opts.loadedAt || createdAt > opts.loadedAt)) {
      // New since this page was loaded: insert in date order
      const pos = items.findIndex((r) => r.date < ch.date);
      const at = pos === -1 ? items.length : pos;
      if (at < opts.limit) {
        items.splice(at, 0, row as unknown as R);
        total += 1;
      }
    }
  }
  if (items.length > opts.limit) items = items.slice(0, opts.limit);
  return { items, total };
}
