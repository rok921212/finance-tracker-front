import React, { useEffect, useState } from "react";
import { Button, inputClass } from "../ui/ui";
import { EXPORT_COLUMNS, ExportFormat, GameOption, PAYMENT_METHODS, PaymentFilters } from "../../lib/paymentsApi";
import { toDayString } from "../../utils/money";

type Quick = "all" | "today" | "yesterday" | "7d" | "month" | "custom";

const quickRange = (q: Quick): Pick<PaymentFilters, "dateFrom" | "dateTo"> => {
  const now = new Date();
  const day = (offset: number) => toDayString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  switch (q) {
    case "today":
      return { dateFrom: day(0), dateTo: day(0) };
    case "yesterday":
      return { dateFrom: day(-1), dateTo: day(-1) };
    case "7d":
      return { dateFrom: day(-6), dateTo: day(0) };
    case "month":
      return { dateFrom: toDayString(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: day(0) };
    default:
      return { dateFrom: undefined, dateTo: undefined };
  }
};

const detectQuick = (f: PaymentFilters): Quick => {
  if (!f.dateFrom && !f.dateTo) return "all";
  for (const q of ["today", "yesterday", "7d", "month"] as Quick[]) {
    const r = quickRange(q);
    if (r.dateFrom === f.dateFrom && r.dateTo === f.dateTo) return q;
  }
  return "custom";
};

interface Props {
  filters: PaymentFilters;
  onChange: (f: PaymentFilters) => void;
  games: GameOption[];
  showUserSearch?: boolean;
  onExport?: (format: ExportFormat, columns: string[]) => void;
  /** Format currently being exported, if any */
  exporting?: ExportFormat | null;
}

const QUICK_LABELS: [Quick, string][] = [
  ["all", "All time"],
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 Days"],
  ["month", "This Month"],
  ["custom", "Custom"],
];

// The admin's export column choice is remembered in this browser
const COLUMNS_KEY = "exportColumns";
const ALL_COLUMNS = EXPORT_COLUMNS.map((c) => c.key);
const readColumns = (): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) || "null");
    if (Array.isArray(saved)) return ALL_COLUMNS.filter((k) => saved.includes(k));
  } catch {
    // unavailable or corrupt: default to every column
  }
  return ALL_COLUMNS;
};

const FilterBar: React.FC<Props> = ({ filters, onChange, games, showUserSearch = true, onExport, exporting }) => {
  const [quick, setQuick] = useState<Quick>(detectQuick(filters));
  const [search, setSearch] = useState(filters.search || "");
  const [player, setPlayer] = useState(filters.player || "");
  const [columns, setColumnsState] = useState<string[]>(readColumns);
  const [pickerOpen, setPickerOpen] = useState(false);
  const setColumns = (next: string[]) => {
    const ordered = ALL_COLUMNS.filter((k) => next.includes(k));
    setColumnsState(ordered);
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(ordered));
    } catch {
      // storage unavailable: kept for this visit only
    }
  };
  const toggleColumn = (key: string) => setColumns(columns.includes(key) ? columns.filter((k) => k !== key) : [...columns, key]);
  // The PDF leaves out CSV-only columns, so it needs at least one of the others
  const pdfColumns = columns.filter((k) => !EXPORT_COLUMNS.find((c) => c.key === k)?.csvOnly);

  // Debounce the user and player searches so each keystroke doesn't hit the API
  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.search || "") !== search || (filters.player || "") !== player) {
        onChange({ ...filters, search: search || undefined, player: player.trim() || undefined });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search, player]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {QUICK_LABELS.map(([q, label]) => (
          <button
            key={q}
            type="button"
            onClick={() => {
              setQuick(q);
              if (q !== "custom") onChange({ ...filters, ...quickRange(q) });
            }}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              quick === q ? "bg-red-600/30 border-red-500 text-white" : "bg-black/30 border-gray-700 text-gray-300 hover:border-gray-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
        <label className="text-xs text-gray-400">
          From
          <input
            type="date"
            className={inputClass}
            value={filters.dateFrom || ""}
            onChange={(e) => {
              setQuick("custom");
              onChange({ ...filters, dateFrom: e.target.value || undefined });
            }}
          />
        </label>
        <label className="text-xs text-gray-400">
          To
          <input
            type="date"
            className={inputClass}
            value={filters.dateTo || ""}
            onChange={(e) => {
              setQuick("custom");
              onChange({ ...filters, dateTo: e.target.value || undefined });
            }}
          />
        </label>
        {showUserSearch && (
          <label className="text-xs text-gray-400">
            User
            <input className={inputClass} placeholder="Search username" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        )}
        <label className="text-xs text-gray-400">
          Player
          <input className={inputClass} placeholder="Player name" value={player} onChange={(e) => setPlayer(e.target.value)} />
        </label>
        <label className="text-xs text-gray-400">
          Payment
          <select
            className={inputClass}
            value={filters.paymentMethod || ""}
            onChange={(e) => onChange({ ...filters, paymentMethod: e.target.value || undefined })}
          >
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-400">
          Game
          <select className={inputClass} value={filters.gameId || ""} onChange={(e) => onChange({ ...filters, gameId: e.target.value || undefined })}>
            <option value="">All games</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {/* Own full-width row that wraps, so no button is cut off on phones */}
        <div className="col-span-2 md:col-span-4 lg:col-span-7 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setQuick("all");
              setSearch("");
              setPlayer("");
              onChange({ userId: filters.userId });
            }}
          >
            Reset
          </Button>
          {onExport && (
            <>
              <Button
                variant="ghost"
                onClick={() => setPickerOpen((o) => !o)}
                aria-expanded={pickerOpen}
                aria-controls="export-columns"
                title="Choose which columns to export"
              >
                Columns ({columns.length}/{ALL_COLUMNS.length})
              </Button>
              <Button
                variant="ghost"
                onClick={() => onExport("csv", columns)}
                loading={exporting === "csv"}
                disabled={!!exporting || !columns.length}
                title="Export filtered rows as CSV"
              >
                CSV
              </Button>
              <Button
                variant="ghost"
                onClick={() => onExport("pdf", pdfColumns)}
                loading={exporting === "pdf"}
                disabled={!!exporting || !pdfColumns.length}
                title="Export filtered rows as PDF"
              >
                PDF
              </Button>
            </>
          )}
        </div>
      </div>
      {onExport && pickerOpen && (
        <div id="export-columns" className="anim-fade rounded-lg border border-gray-700 bg-black/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-sm text-gray-300">Columns to export</span>
            <div className="flex gap-3 text-xs">
              <button type="button" className="text-gray-400 hover:text-white" onClick={() => setColumns(ALL_COLUMNS)}>
                All
              </button>
              <button type="button" className="text-gray-400 hover:text-white" onClick={() => setColumns([])}>
                None
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {EXPORT_COLUMNS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" className="accent-red-600" checked={columns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                {c.label}
                {c.csvOnly && <span className="text-xs text-gray-500">(CSV)</span>}
              </label>
            ))}
          </div>
          {!pdfColumns.length && columns.length > 0 && <p className="text-xs text-yellow-400 mt-2">Pick at least one non-CSV column for the PDF.</p>}
        </div>
      )}
    </div>
  );
};

export default FilterBar;
