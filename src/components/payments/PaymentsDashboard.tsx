import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AppHeader from "./AppHeader";
import { Page, Card, StatCard, Banner, Pagination, Spinner, inputClass } from "../ui/ui";
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

const SORTS: MySort[] = ["date", "deposit", "loaded", "redeemed", "cashout", "player"];

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
  view.sort ? `${view.sort}:${view.order || (view.sort === "player" ? "asc" : "desc")}` : view.order === "asc" ? "date:asc" : "";

const PaymentsDashboard: React.FC = () => {
  const [page, setPage] = useState(1);
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
    setPage(1);
  };
  // Back/forward can change the view too: always start it on page 1
  const viewKey = JSON.stringify(view);
  useEffect(() => setPage(1), [viewKey]);

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

  // The page/view whose rows are on screen: refetching that same page (after a delete, or a pushed
  // change) keeps the cards visible instead of blanking the list behind a spinner
  const shownKey = useRef("");
  const loadPage = useCallback(() => {
    let cancelled = false;
    const key = JSON.stringify(myPaymentsParams(page, view));
    const cached = peekCached<Paged<PaymentRow>>("/payments", myPaymentsParams(page, view));
    if (cached) setData(cached);
    setLoading(!cached && shownKey.current !== key);
    getMyPayments(page, view)
      .then((d) => {
        if (cancelled) return;
        shownKey.current = key;
        setData(d);
      })
      .catch((e) => !cancelled && setError(errorMessage(e, "Could not load entries")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, view]);
  useEffect(loadPage, [loadPage]);

  // Delta sync: every 30s ask only for rows changed since the last sync (204 when nothing did)
  useDeltaSync<PaymentRow>({
    url: "/payments/changes",
    list: { url: "/payments", params: myPaymentsParams(page, view) },
    params: {},
    sync: data?.sync,
    onChanges: (changes) => {
      // New rows are merged in by date; any other order or a player filter reloads the page instead
      if (!isDefaultView(view)) {
        loadPage();
        loadSummary();
        return;
      }
      setData((prev) => {
        if (!prev) return prev;
        const merged = mergeChanges(prev, changes, { limit: MY_PAGE_SIZE, loadedAt: prev.sync?.cursor });
        const next = { ...prev, ...merged, pages: Math.max(1, Math.ceil(merged.total / MY_PAGE_SIZE)) };
        updateCached("/payments", myPaymentsParams(page, view), () => next);
        return next;
      });
      loadSummary(); // tiny; returns fresh totals
    },
    onReset: () => {
      loadPage();
      loadSummary();
    },
  });

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

  // Remove the card at once; put it back if the server refuses
  const [deleting, setDeleting] = useState<string | null>(null);
  const onDelete = async (p: PaymentRow) => {
    if (deleting) return;
    if (!window.confirm("Delete this entry? It will be removed from your list.")) return;
    const before = data;
    setDeleting(p.id);
    setError("");
    setData((prev) =>
      prev ? { ...prev, items: prev.items.filter((x) => x.id !== p.id), total: Math.max(0, prev.total - 1) } : prev
    );
    try {
      // Only a page with rows after it needs refilling from the server; otherwise the card is simply
      // gone and just the totals are refetched (both refetches are triggered by the cache drop)
      const complete = !!before && before.pages <= 1;
      await deleteMyPayment(p.id, { params: myPaymentsParams(page, view), complete });
    } catch (e) {
      setData(before);
      setError(errorMessage(e, "Could not delete the entry"));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Page>
      <AppHeader />
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-6">
        {error && <Banner>{error}</Banner>}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-start">
          <StatCard label="Total Deposit" tone="green" value={summary ? formatCents(summary.totalDeposit) : "—"} />
          <StatCard label="Total Loaded" tone="blue" value={summary ? formatCents(summary.totalLoaded) : "—"} />
          <StatCard label="Total Redeemed" tone="purple" value={summary ? formatCents(summary.totalRedeemed || 0) : "—"}>
            {!!summary?.redeemedByGame?.length && (
              <ul className="mt-3 pt-3 border-t border-purple-500/20 space-y-1 text-sm max-h-40 overflow-y-auto">
                {summary.redeemedByGame.map((g) => (
                  <li key={g.gameId} className="flex justify-between gap-2">
                    <span className="text-gray-300 truncate">{g.game || "Unknown game"}</span>
                    <span className="text-white tabular-nums">{formatCents(g.redeemed)}</span>
                  </li>
                ))}
              </ul>
            )}
          </StatCard>
          <StatCard label="Total Cashout" tone="yellow" value={summary ? formatCents(summary.totalCashout || 0) : "—"} />
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
              {data && !loading ? ` · ${data.total} ${data.total === 1 ? "entry" : "entries"}` : ""} (totals above are for this player)
            </p>
          )}
          {/* Cards instead of a table: stacked on phones, 2 across on tablets, 3 across on desktop */}
          {loading && (
            <div className="flex justify-center py-8 text-gray-400">
              <Spinner className="h-6 w-6" />
            </div>
          )}
          {!loading && data && data.items.length === 0 && <p className="text-center text-gray-500 py-8">{view.player ? "No entries for this player" : "No records found"}</p>}
          {!loading && !!data?.items.length && (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.items.map((p) => (
                <li key={p.id} className="rounded-xl border border-gray-700/60 bg-black/30 p-4 hover:border-gray-600">
                  <div className="flex items-start gap-3">
                    {p.thumb ? (
                      <button
                        type="button"
                        onClick={() => openPreview(p)}
                        onPointerEnter={() => preloadImage(p.shot)}
                        onFocus={() => preloadImage(p.shot)}
                        title="View screenshot"
                        aria-label="View screenshot"
                        className="shrink-0 rounded-lg cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-red-500 hover:opacity-80"
                      >
                        <img
                          src={p.thumb}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          width={80}
                          height={80}
                          className="w-20 h-20 rounded-lg object-cover border border-gray-700"
                        />
                      </button>
                    ) : (
                      <div className="shrink-0 w-20 h-20 rounded-lg border border-dashed border-gray-700 flex items-center justify-center text-xs text-gray-500">
                        No image
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white truncate">{p.game || "—"}</p>
                      <p className="text-sm text-gray-400">{formatDay(p.date)}</p>
                      {(p.gameUsername || p.paymentTag) && (
                        <p className="text-xs text-gray-400 truncate">
                          {p.gameUsername && <>Backend username: <span className="text-gray-200">{p.gameUsername}</span></>}
                          {p.gameUsername && p.paymentTag && " · "}
                          {p.paymentTag && <>Tag: <span className="text-gray-200">{p.paymentTag}</span></>}
                        </p>
                      )}
                      {(p.player || p.paymentMethod) && (
                        <p className="text-sm text-gray-300 truncate" title={p.player || undefined}>
                          {p.player || "—"} · {paymentMethodLabel(p.paymentMethod)}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col gap-2">
                      <Link
                        to={`/payments/${p.id}/edit`}
                        className="px-3 py-1 rounded-lg text-sm text-center bg-gray-700/60 border border-gray-600 text-gray-200 hover:bg-gray-700"
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        onClick={() => onDelete(p)}
                        disabled={!!deleting}
                        className="px-3 py-1 rounded-lg text-sm bg-red-900/40 border border-red-700/60 text-red-200 hover:bg-red-800/60 disabled:opacity-50"
                      >
                        {deleting === p.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-sm">
                    <div>
                      <dt className="text-xs uppercase tracking-wider text-gray-500">Deposit</dt>
                      <dd className="text-green-400 font-medium tabular-nums break-all">{formatCents(p.deposit)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wider text-gray-500">Loaded</dt>
                      <dd className="text-blue-400 font-medium tabular-nums break-all">{formatCents(p.loaded)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wider text-gray-500">Redeemed</dt>
                      <dd className="text-purple-400 font-medium tabular-nums break-all">{formatCents(p.redeemed || 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wider text-gray-500">Cashout</dt>
                      <dd className="text-yellow-400 font-medium tabular-nums break-all">
                        {formatCents(p.cashout || 0)}
                        {p.cashoutThumb && (
                          <button
                            type="button"
                            onClick={() => openPreview(p, "cashoutProof")}
                            onPointerEnter={() => preloadImage(p.cashoutShot)}
                            onFocus={() => preloadImage(p.cashoutShot)}
                            title="View cashout screenshot"
                            aria-label="View cashout screenshot"
                            className="block mt-1 rounded cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-yellow-500 hover:opacity-80"
                          >
                            <img
                              src={p.cashoutThumb}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              width={40}
                              height={40}
                              className="w-10 h-10 rounded object-cover border border-yellow-500/40"
                            />
                          </button>
                        )}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
          {data && data.total > 0 && <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
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
