import React, { useEffect, useState } from "react";
import { Button, inputClass } from "../ui/ui";
import { ExportFormat, GameOption, PAYMENT_METHODS, PaymentFilters } from "../../lib/paymentsApi";
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
  onExport?: (format: ExportFormat) => void;
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

const FilterBar: React.FC<Props> = ({ filters, onChange, games, showUserSearch = true, onExport, exporting }) => {
  const [quick, setQuick] = useState<Quick>(detectQuick(filters));
  const [search, setSearch] = useState(filters.search || "");
  const [player, setPlayer] = useState(filters.player || "");

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
        <div className="flex gap-2">
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
              <Button variant="ghost" onClick={() => onExport("csv")} loading={exporting === "csv"} disabled={!!exporting} title="Export filtered rows as CSV">
                CSV
              </Button>
              <Button variant="ghost" onClick={() => onExport("pdf")} loading={exporting === "pdf"} disabled={!!exporting} title="Export filtered rows as PDF">
                PDF
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default FilterBar;
