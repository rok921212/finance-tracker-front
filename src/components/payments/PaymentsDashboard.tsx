import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AppHeader from "./AppHeader";
import SummaryCards from "./SummaryCards";
import { Page, Card, Banner, Spinner, inputClass } from "../ui/ui";
import ImageViewer from "../ui/ImageViewer";
import {
  deleteMyPayment,
  getMyPayment,
  getMyPayments,
  getMySummary,
  isDefaultView,
  MyListView,
  MySort,
  myPaymentsParams,
  MY_PAGE_SIZE,
  MySummary,
  Paged,
  PaymentRow,
  paymentMethodLabel,
} from "../../lib/paymentsApi";
import { peekCached, updateCached, useDropTick } from "../../lib/cache";
import { mergeChanges, useDeltaSync } from "../../lib/deltaSync";
import { errorMessage } from "../../lib/http";
import { preloadImage } from "../../lib/preloadImage";
import { formatCents, formatDay } from "../../utils/money";

const SORTS: MySort[] = ["date", "deposit", "loaded", "redeemed", "cashout", "player", "gameUsername", "paymentMethod"];
// Text columns sort A-Z first; dates and amounts start with the highest
const TEXT_SORTS: MySort[] = ["player", "gameUsername", "paymentMethod"];
const defaultOrder = (sort: MySort): "asc" | "desc" => (TEXT_SORTS.includes(sort) ? "asc" : "desc");

const SORT_OPTIONS = [
  { value: "", label: "Newest first" },
  { value: "date:asc", label: "Oldest first" },
  { value: "deposit:desc", label: "Deposit: highest first" },
  { value: "deposit:asc", label: "Deposit: lowest first" },
  { value: "loaded:desc", label: "Loaded: highest first" },
  { value: "loaded:asc", label: "Loaded: lowest first" },
  { value: "redeemed:desc", label: "Redeemed: highest first" },
  { value: "redeemed:asc", label: "Redeemed: lowest first" },
  { value: "cashout:desc", label: "Cashout: highest first" },
  { value: "cashout:asc", label: "Cashout: lowest first" },
  { value: "player:asc", label: "Player: A → Z" },
  { value: "player:desc", label: "Player: Z → A" },
  { value: "gameUsername:asc", label: "Backend username: A → Z" },
  { value: "gameUsername:desc", label: "Backend username: Z → A" },
  { value: "paymentMethod:asc", label: "Payment method: A → Z" },
  { value: "paymentMethod:desc", label: "Payment method: Z → A" },
];

// Sort and player filter live in the URL (?sort=deposit&order=desc&player=superman), so refresh/back keep them
const readView = (sp: URLSearchParams): MyListView => {
  const sort = sp.get("sort") as MySort | null;
  const order = sp.get("order");
  const player = (sp.get("player") || "").trim();
  return {
    ...(sort && SORTS.includes(sort) && sort !== "date" ? { sort } : {}),
    ...(order === "asc" || order === "desc" ? { order } : {}),
    ...(player ? { player } : {}),
  };
};

const sortValue = (view: MyListView) =>
  view.sort ? `${view.sort}:${view.order || defaultOrder(view.sort)}` : view.order === "asc" ? "date:asc" : "";

// Current sort as [column, direction] ("date" / "desc" for the default view)
const currentSort = (view: MyListView): [MySort, "asc" | "desc"] => {
  const sort = view.sort || "date";
  return [sort, view.order || defaultOrder(sort)];
};

const MONEY_COLS = [
  { key: "deposit", label: "Deposit", tone: "text-green-400" },
  { key: "loaded", label: "Loaded", tone: "text-blue-400" },
  { key: "redeemed", label: "Redeemed", tone: "text-purple-400" },
  { key: "cashout", label: "Cashout", tone: "text-yellow-400" },
] as const;
type MoneyKey = (typeof MONEY_COLS)[number]["key"];
const amountOf = (p: PaymentRow, k: MoneyKey) => p[k] || 0;
const SUMMARY_TOTALS: Record<MoneyKey, keyof MySummary> = {
  deposit: "totalDeposit",
  loaded: "totalLoaded",
  redeemed: "totalRedeemed",
  cashout: "totalCashout",
};

// Pages 2..n of the current view, loaded as the user scrolls (page 1 is `data`, kept live by delta sync)
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

const PaymentsDashboard: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = useMemo(() => readView(searchParams), [searchParams]);
  // Applies a change on top of the latest URL (so a debounced player update can't undo a sort change)
  const setView = (patch: Partial<MyListView>) => {
    setSearchParams(
      (prev) => {
        const next = { ...readView(prev), ...patch };
        const sp = new URLSearchParams(prev);
        for (const k of ["sort", "order", "player"] as const) {
          const v = next[k];
          if (v) sp.set(k, v);
          else sp.delete(k);
        }
        return sp;
      },
      { replace: true }
    );
  };
  const viewKey = JSON.stringify(view);

  // Clicking a column header sorts by it; clicking again flips the direction
  const sortBy = (col: MySort) => {
    const [cur, dir] = currentSort(view);
    const order: "asc" | "desc" = cur === col ? (dir === "asc" ? "desc" : "asc") : defaultOrder(col);
    if (col === "date") setView({ sort: undefined, order: order === "asc" ? "asc" : undefined });
    else setView({ sort: col, order });
  };

  // Player box: typed text is applied after a short pause
  const [playerInput, setPlayerInput] = useState(view.player || "");
  useEffect(() => {
    setPlayerInput((cur) => (cur.trim() === (view.player || "") ? cur : view.player || ""));
  }, [view.player]);
  useEffect(() => {
    const t = setTimeout(() => {
      const player = playerInput.trim();
      if (player !== (view.player || "")) setView({ player: player || undefined });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerInput]);
  // Render the last cached copy immediately; revalidation (ETag) happens in the background
  const [summary, setSummary] = useState<MySummary | null>(
    () => peekCached<MySummary>("/payments/summary", view.player ? { player: view.player } : undefined) || null
  );
  const [data, setData] = useState<Paged<PaymentRow> | null>(
    () => peekCached<Paged<PaymentRow>>("/payments", myPaymentsParams(1, view)) || null
  );
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState("");
  // Screenshot / cashout screenshot preview: the thumbnail shows at once, the full-size URL is fetched on open
  const [preview, setPreview] = useState<{
    id: string;
    kind: "screenshot" | "cashoutProof";
    thumb: string | null;
    full: string | null;
  } | null>(null);

  const loadSummary = useCallback(() => {
    getMySummary(view.player)
      .then(setSummary)
      .catch((e) => setError(errorMessage(e, "Could not load summary")));
  }, [view.player]);
  // Refetched only when the server pushes a change to the totals
  const summaryChanged = useDropTick("/payments/summary", view.player ? { player: view.player } : undefined);
  useEffect(loadSummary, [loadSummary, summaryChanged]);

  // ---- rows beyond page 1 (infinite scroll: no page switching) ----
  const [more, setMore] = useState<PaymentRow[]>([]);
  const pagesLoaded = useRef(1);
  const moreSeq = useRef(0); // bumped to drop in-flight loads that belong to an older list
  const loadingMoreRef = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // A new sort / player filter starts again from the first rows
  useEffect(() => {
    pagesLoaded.current = 1;
    moreSeq.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setMore([]);
  }, [viewKey]);

  // Reload the extra pages already shown (after a change, their offsets may have moved)
  const refreshMore = useCallback(() => {
    const n = pagesLoaded.current;
    if (n <= 1) return;
    const seq = ++moreSeq.current;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    Promise.all(range(2, n).map((p) => getMyPayments(p, view)))
      .then((pages) => seq === moreSeq.current && setMore(pages.flatMap((d) => d.items)))
      .catch((e) => seq === moreSeq.current && setError(errorMessage(e, "Could not load entries")));
  }, [view]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !data || pagesLoaded.current >= data.pages) return;
    const next = pagesLoaded.current + 1;
    const seq = moreSeq.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    getMyPayments(next, view)
      .then((d) => {
        if (seq !== moreSeq.current) return;
        pagesLoaded.current = next;
        setMore((prev) => [...prev, ...d.items]);
      })
      .catch((e) => seq === moreSeq.current && setError(errorMessage(e, "Could not load more entries")))
      .finally(() => {
        if (seq !== moreSeq.current) return;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [data, view]);

  // The view whose rows are on screen: refetching that same view (after a delete, or a pushed
  // change) keeps the rows visible instead of blanking the list behind a spinner
  const shownKey = useRef("");
  const loadPage = useCallback(() => {
    let cancelled = false;
    const key = JSON.stringify(myPaymentsParams(1, view));
    const cached = peekCached<Paged<PaymentRow>>("/payments", myPaymentsParams(1, view));
    if (cached) setData(cached);
    setLoading(!cached && shownKey.current !== key);
    getMyPayments(1, view)
      .then((d) => {
        if (cancelled) return;
        shownKey.current = key;
        setData(d);
        refreshMore();
      })
      .catch((e) => !cancelled && setError(errorMessage(e, "Could not load entries")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [view, refreshMore]);
  useEffect(loadPage, [loadPage]);

  // Delta sync: only rows changed since the last sync are fetched
  useDeltaSync<PaymentRow>({
    url: "/payments/changes",
    list: { url: "/payments", params: myPaymentsParams(1, view) },
    params: {},
    sync: data?.sync,
    onChanges: (changes) => {
      // New rows are merged in by date; any other order or a player filter reloads instead
      if (!isDefaultView(view)) {
        loadPage();
        loadSummary();
        return;
      }
      setData((prev) => {
        if (!prev) return prev;
        const merged = mergeChanges(prev, changes, { limit: MY_PAGE_SIZE, loadedAt: prev.sync?.cursor });
        const next = { ...prev, ...merged, pages: Math.max(1, Math.ceil(merged.total / MY_PAGE_SIZE)) };
        updateCached("/payments", myPaymentsParams(1, view), () => next);
        return next;
      });
      refreshMore();
      loadSummary(); // tiny; returns fresh totals
    },
    onReset: () => {
      loadPage();
      loadSummary();
    },
  });

  // Every loaded row, in order (an id can briefly appear on two pages after a change: keep the first)
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return [...(data?.items || []), ...more].filter((p) => !seen.has(p.id) && !!seen.add(p.id));
  }, [data, more]);
  const total = data?.total || 0;
  const hasMore = !!data && rows.length < total && pagesLoaded.current < data.pages;

  // Load the next rows when the end of the list scrolls into view
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, rows.length]);

  const openPreview = (p: PaymentRow, kind: "screenshot" | "cashoutProof" = "screenshot") => {
    const thumb = kind === "cashoutProof" ? p.cashoutThumb || null : p.thumb;
    // The row already carries the full-size URL: open it straight away (usually already preloaded)
    const full = kind === "cashoutProof" ? p.cashoutShot : p.shot;
    if (full) {
      setPreview({ id: p.id, kind, thumb, full });
      return;
    }
    setPreview({ id: p.id, kind, thumb, full: null });
    getMyPayment(p.id)
      .then((d) =>
        setPreview((cur) =>
          cur && cur.id === p.id && cur.kind === kind ? { ...cur, full: (kind === "cashoutProof" ? d.cashoutProof : d.screenshot) || cur.thumb } : cur
        )
      )
      .catch((e) => {
        setPreview(null);
        setError(errorMessage(e, "Could not load screenshot"));
      });
  };
  const closePreview = useCallback(() => setPreview(null), []);

  // Remove the row at once; put it back if the server refuses
  const [deleting, setDeleting] = useState<string | null>(null);
  const onDelete = async (p: PaymentRow) => {
    if (deleting) return;
    if (!window.confirm("Delete this entry? It will be removed from your list.")) return;
    const before = data;
    const beforeMore = more;
    setDeleting(p.id);
    setError("");
    setData((prev) =>
      prev ? { ...prev, items: prev.items.filter((x) => x.id !== p.id), total: Math.max(0, prev.total - 1) } : prev
    );
    setMore((prev) => prev.filter((x) => x.id !== p.id));
    try {
      // Only a list with rows after it needs refilling from the server; otherwise the row is simply
      // gone and just the totals are refetched (both refetches are triggered by the cache drop)
      const complete = !!before && before.pages <= 1;
      await deleteMyPayment(p.id, { params: myPaymentsParams(1, view), complete });
    } catch (e) {
      setData(before);
      setMore(beforeMore);
      setError(errorMessage(e, "Could not delete the entry"));
    } finally {
      setDeleting(null);
    }
  };

  const [sortCol, sortDir] = currentSort(view);
  // Called as a function (not <SortHead/>) so the header cells are not remounted on every render
  const sortHead = (col: MySort, children: string, right = false) => (
    <th
      scope="col"
      aria-sort={sortCol === col ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-3 py-2.5 font-semibold ${right ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => sortBy(col)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-white ${sortCol === col ? "text-white" : ""}`}
        title={`Sort by ${children.toLowerCase()}`}
      >
        {children}
        <span className="text-[10px] w-2">{sortCol === col ? (sortDir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );

  const thumbButton = (p: PaymentRow, kind: "screenshot" | "cashoutProof", size: "sm" | "md") => {
    const src = kind === "cashoutProof" ? p.cashoutThumb : p.thumb;
    if (!src) return null;
    const full = kind === "cashoutProof" ? p.cashoutShot : p.shot;
    const label = kind === "cashoutProof" ? "View cashout screenshot" : "View screenshot";
    const box = size === "md" ? "w-12 h-12" : "w-9 h-9";
    return (
      <button
        type="button"
        onClick={() => openPreview(p, kind)}
        onPointerEnter={() => preloadImage(full)}
        onFocus={() => preloadImage(full)}
        title={label}
        aria-label={label}
        className="shrink-0 rounded-md cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-red-500 hover:opacity-80"
      >
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          width={48}
          height={48}
          className={`${box} rounded-md object-cover border ${kind === "cashoutProof" ? "border-yellow-500/50" : "border-gray-700"}`}
        />
      </button>
    );
  };

  const actions = (p: PaymentRow) => (
    <div className="flex gap-1.5 justify-end">
      <Link
        to={`/payments/${p.id}/edit`}
        className="px-2.5 py-1 rounded-md text-xs bg-gray-700/60 border border-gray-600 text-gray-200 hover:bg-gray-700"
      >
        Edit
      </Link>
      <button
        type="button"
        onClick={() => onDelete(p)}
        disabled={!!deleting}
        className="px-2.5 py-1 rounded-md text-xs bg-red-900/40 border border-red-700/60 text-red-200 hover:bg-red-800/60 disabled:opacity-50"
      >
        {deleting === p.id ? "…" : "Delete"}
      </button>
    </div>
  );

  return (
    <Page>
      <AppHeader />
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8 space-y-6">
        {error && <Banner>{error}</Banner>}

        {/* Overview: each total with its split by payment method or game */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 items-start">
          <SummaryCards summary={summary} />
        </div>

        <Card
          title="My Entries"
          actions={
            <Link
              to="/payments/new"
              className="inline-flex items-center px-4 py-2 rounded-lg font-semibold bg-gradient-to-r from-red-600 to-red-700 text-white border border-red-500 hover:from-red-700 hover:to-red-800"
            >
              + Add Entry
            </Link>
          }
        >
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <label className="flex-1 min-w-0">
              <span className="block text-xs text-gray-400 mb-1">Player</span>
              <div className="relative">
                <input
                  className={`${inputClass} pr-9`}
                  placeholder="Show only one player, e.g. superman"
                  value={playerInput}
                  maxLength={60}
                  onChange={(e) => setPlayerInput(e.target.value)}
                />
                {playerInput && (
                  <button
                    type="button"
                    aria-label="Clear player filter"
                    onClick={() => setPlayerInput("")}
                    className="absolute inset-y-0 right-0 px-3 text-gray-400 hover:text-white text-lg leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
            </label>
            <label className="sm:w-64">
              <span className="block text-xs text-gray-400 mb-1">Sort by</span>
              <select
                className={inputClass}
                value={sortValue(view)}
                onChange={(e) => {
                  const [sort, order] = e.target.value.split(":") as [MySort | "", "asc" | "desc" | undefined];
                  setView({ sort: sort && sort !== "date" ? sort : undefined, order: sort ? order : undefined });
                }}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {view.player && (
            <p className="text-sm text-gray-400 mb-4">
              Showing entries for player <span className="text-white font-semibold">{view.player}</span>
              {data && !loading ? ` · ${total} ${total === 1 ? "entry" : "entries"}` : ""} (totals above are for this player)
            </p>
          )}

          {loading && (
            <div className="flex justify-center py-8 text-gray-400">
              <Spinner className="h-6 w-6" />
            </div>
          )}
          {!loading && data && rows.length === 0 && (
            <p className="text-center text-gray-500 py-8">{view.player ? "No entries for this player" : "No records found"}</p>
          )}

          {!loading && rows.length > 0 && (
            <>
              {/* Desktop / tablet: one table, every column visible */}
              <div className="hidden md:block -mx-4 md:-mx-6 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-xs text-gray-400 border-y border-gray-700/70 bg-black/30">
                      {sortHead("date", "Date")}
                      <th scope="col" className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider">Game</th>
                      {sortHead("player", "Player")}
                      {sortHead("gameUsername", "Backend User")}
                      {sortHead("paymentMethod", "Method")}
                      {MONEY_COLS.map((c) => (
                        <React.Fragment key={c.key}>{sortHead(c.key, c.label, true)}</React.Fragment>
                      ))}
                      <th scope="col" className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider">Proof</th>
                      <th scope="col" className="px-3 py-2.5">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className="border-b border-gray-800 hover:bg-white/[0.03] align-top">
                        <td className="px-3 py-2.5 whitespace-nowrap text-gray-300">{formatDay(p.date)}</td>
                        <td className="px-3 py-2.5 max-w-[11rem]">
                          <p className="font-medium text-white truncate" title={p.game || undefined}>
                            {p.game || "—"}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 max-w-[10rem]">
                          <p className="text-gray-200 truncate" title={p.player || undefined}>
                            {p.player || "—"}
                          </p>
                          {p.notes && (
                            <p className="text-xs text-gray-500 truncate" title={p.notes}>
                              📝 {p.notes}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 max-w-[9rem]">
                          <p className="text-gray-300 truncate" title={p.gameUsername || undefined}>
                            {p.gameUsername || "—"}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 max-w-[9rem]">
                          <p className="text-gray-300 whitespace-nowrap">{paymentMethodLabel(p.paymentMethod)}</p>
                          {p.paymentTag && (
                            <p className="text-xs text-gray-500 truncate" title={`Tag: ${p.paymentTag}`}>
                              {p.paymentTag}
                            </p>
                          )}
                        </td>
                        {MONEY_COLS.map((c) => {
                          const v = amountOf(p, c.key);
                          return (
                            <td key={c.key} className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                              <span className={v ? `${c.tone} font-medium` : "text-gray-600"}>{formatCents(v)}</span>
                              {c.key === "cashout" && !!p.cashout && p.cashoutMethod && (
                                <span className="block text-xs text-gray-500">via {paymentMethodLabel(p.cashoutMethod)}</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2">
                          <div className="flex gap-1.5">
                            {thumbButton(p, "screenshot", "sm")}
                            {thumbButton(p, "cashoutProof", "sm")}
                            {!p.thumb && !p.cashoutThumb && <span className="text-gray-600">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">{actions(p)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {summary && (
                    <tfoot>
                      <tr className="bg-black/40 border-t-2 border-gray-600 font-semibold">
                        <td colSpan={5} className="px-3 py-3 text-gray-300">
                          Total · {total.toLocaleString()} {total === 1 ? "entry" : "entries"}
                        </td>
                        {MONEY_COLS.map((c) => (
                          <td key={c.key} className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${c.tone}`}>
                            {formatCents(summary[SUMMARY_TOTALS[c.key]] as number)}
                          </td>
                        ))}
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Phones: compact rows in the same order, amounts in a 4-column strip */}
              <ul className="md:hidden -mx-4 divide-y divide-gray-800 border-y border-gray-800">
                {rows.map((p) => (
                  <li key={p.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      {thumbButton(p, "screenshot", "md") || (
                        <div className="shrink-0 w-12 h-12 rounded-md border border-dashed border-gray-700 flex items-center justify-center text-[10px] text-gray-500">
                          No img
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-semibold text-white truncate">{p.game || "—"}</p>
                          <p className="text-xs text-gray-400 whitespace-nowrap">{formatDay(p.date)}</p>
                        </div>
                        <p className="text-sm text-gray-300 truncate">
                          {p.player || "—"} · {paymentMethodLabel(p.paymentMethod)}
                        </p>
                        {(p.gameUsername || p.paymentTag) && (
                          <p className="text-xs text-gray-500 truncate">
                            {p.gameUsername}
                            {p.gameUsername && p.paymentTag && " · "}
                            {p.paymentTag}
                          </p>
                        )}
                      </div>
                    </div>
                    <dl className="grid grid-cols-4 gap-1 mt-2 rounded-lg bg-black/30 border border-gray-800 px-2 py-1.5">
                      {MONEY_COLS.map((c) => {
                        const v = amountOf(p, c.key);
                        return (
                          <div key={c.key} className="min-w-0">
                            <dt className="text-[10px] uppercase tracking-wider text-gray-500">{c.label}</dt>
                            <dd className={`text-sm tabular-nums truncate ${v ? `${c.tone} font-medium` : "text-gray-600"}`}>{formatCents(v)}</dd>
                          </div>
                        );
                      })}
                    </dl>
                    <div className="flex items-center gap-2 mt-2">
                      {thumbButton(p, "cashoutProof", "sm")}
                      <p className="flex-1 min-w-0 text-xs text-gray-400 truncate" title={p.notes || undefined}>
                        {!!p.cashout && p.cashoutMethod && <>Cashout via {paymentMethodLabel(p.cashoutMethod)}</>}
                        {!!p.cashout && p.cashoutMethod && p.notes && " · "}
                        {p.notes && <>📝 {p.notes}</>}
                      </p>
                      {actions(p)}
                    </div>
                  </li>
                ))}
              </ul>
              {summary && (
                <dl className="md:hidden grid grid-cols-4 gap-1 mt-3 rounded-lg bg-black/40 border border-gray-600 px-2 py-2">
                  {MONEY_COLS.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-[10px] uppercase tracking-wider text-gray-400">Total {c.label}</dt>
                      <dd className={`text-sm font-semibold tabular-nums truncate ${c.tone}`}>
                        {formatCents(summary[SUMMARY_TOTALS[c.key]] as number)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {/* More rows load automatically as this comes into view; the button is a fallback */}
              <div ref={sentinel} className="flex flex-col items-center gap-2 pt-4 text-sm text-gray-400">
                <span>
                  Showing {rows.length.toLocaleString()} of {total.toLocaleString()}
                </span>
                {hasMore && (
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gray-700/50 border border-gray-600 text-gray-200 hover:bg-gray-700 disabled:opacity-60"
                  >
                    {loadingMore && <Spinner />}
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      {preview && (
        <ImageViewer
          key={`${preview.id}-${preview.kind}`}
          src={preview.full}
          placeholder={preview.thumb}
          alt={preview.kind === "cashoutProof" ? "Cashout screenshot" : "Screenshot"}
          onClose={closePreview}
        />
      )}
    </Page>
  );
};

export default PaymentsDashboard;
