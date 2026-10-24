import React, { useEffect, useRef, useState } from "react";
import { Button, inputClass } from "../ui/ui";
import {
  defaultExportName,
  EXPORT_COLUMNS,
  ExportFormat,
  GAME_USERNAMES_URL,
  GameOption,
  GameUsernameRow,
  gameUsernamesParams,
  joinList,
  PAYMENT_METHODS,
  PaymentFilters,
  splitList,
} from "../../lib/paymentsApi";
import { useCachedGet } from "../../lib/cache";
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
  /** Filters the backend-username list is built from, when they differ from `filters` (e.g. scoped to one user) */
  namesScope?: PaymentFilters;
  onExport?: (format: ExportFormat, columns: string[], filename?: string) => void;
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

const chipClass = (on: boolean) =>
  `px-3 py-1.5 rounded-lg text-sm border transition-colors ${
    on ? "bg-red-600/30 border-red-500 text-white" : "bg-black/30 border-gray-700 text-gray-300 hover:border-gray-500"
  }`;

// Long username lists are cut to this many chips until "Show all"
const NAMES_SHOWN = 20;

// The admin's export column choice is remembered in this browser, with the columns that existed then:
// columns added later start out picked
const COLUMNS_KEY = "exportColumns";
const ALL_COLUMNS = EXPORT_COLUMNS.map((c) => c.key);
// Added after choices were saved as a plain list (no `known`)
const ADDED_AFTER_LIST = ["screenshotUrl", "cashoutProofUrl", "links"];
const readColumns = (): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) || "null");
    if (Array.isArray(saved)) return ALL_COLUMNS.filter((k) => saved.includes(k) || ADDED_AFTER_LIST.includes(k));
    if (saved && Array.isArray(saved.picked) && Array.isArray(saved.known)) {
      return ALL_COLUMNS.filter((k) => saved.picked.includes(k) || !saved.known.includes(k));
    }
  } catch {
    // unavailable or corrupt: default to every column
  }
  return ALL_COLUMNS;
};
const columnOf = (k: string) => EXPORT_COLUMNS.find((c) => c.key === k);

const FilterBar: React.FC<Props> = ({ filters, onChange, games, showUserSearch = true, namesScope, onExport, exporting }) => {
  const [quick, setQuick] = useState<Quick>(detectQuick(filters));
  const [search, setSearch] = useState(filters.search || "");
  const [player, setPlayer] = useState(filters.player || "");
  const [columns, setColumnsState] = useState<string[]>(readColumns);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [nameSearch, setNameSearch] = useState("");
  const [showAllNames, setShowAllNames] = useState(false);
  const [fileName, setFileName] = useState("");
  const setColumns = (next: string[]) => {
    const ordered = ALL_COLUMNS.filter((k) => next.includes(k));
    setColumnsState(ordered);
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify({ picked: ordered, known: ALL_COLUMNS }));
    } catch {
      // storage unavailable: kept for this visit only
    }
  };
  const toggleColumn = (key: string) => setColumns(columns.includes(key) ? columns.filter((k) => k !== key) : [...columns, key]);
  // Each format leaves out the other's only columns
  const csvColumns = columns.filter((k) => !columnOf(k)?.pdfOnly);
  const pdfColumns = columns.filter((k) => !columnOf(k)?.csvOnly);

  const methods = splitList(filters.paymentMethod);
  const toggleMethod = (m: string) =>
    onChange({ ...filters, paymentMethod: joinList(methods.includes(m) ? methods.filter((x) => x !== m) : [...methods, m]) });

  // Backend usernames in use under the other filters; the last list stays up while a new one loads
  const namesQuery = useCachedGet<GameUsernameRow[]>(GAME_USERNAMES_URL, gameUsernamesParams(namesScope || filters));
  const lastNames = useRef<GameUsernameRow[]>([]);
  if (namesQuery.data) lastNames.current = namesQuery.data;
  const names = namesQuery.data || lastNames.current;
  const picked = splitList(filters.gameUsername);
  const isPicked = (n: string) => picked.some((p) => p.toLowerCase() === n.toLowerCase());
  const toggleName = (n: string) =>
    onChange({
      ...filters,
      gameUsername: joinList(isPicked(n) ? picked.filter((p) => p.toLowerCase() !== n.toLowerCase()) : [...picked, n]),
    });
  const needle = nameSearch.trim().toLowerCase();
  // Picked names first (even ones outside the current list), then the rest, narrowed by the search box
  const nameChips: GameUsernameRow[] = [
    ...picked.map((p) => names.find((n) => n.name.toLowerCase() === p.toLowerCase()) || { name: p, count: 0 }),
    ...names.filter((n) => !isPicked(n.name) && (!needle || n.name.toLowerCase().includes(needle))),
  ];
  const visibleChips = showAllNames || needle ? nameChips : nameChips.slice(0, Math.max(NAMES_SHOWN, picked.length));

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
            className={chipClass(quick === q)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 items-end">
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
      </div>

      <div>
        <span className="block text-xs text-gray-400 mb-1">Payment method</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chipClass(!methods.length)} onClick={() => onChange({ ...filters, paymentMethod: undefined })}>
            All
          </button>
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              className={chipClass(methods.includes(m.value))}
              aria-pressed={methods.includes(m.value)}
              onClick={() => toggleMethod(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-xs text-gray-400">Backend username</span>
          <input
            className={`${inputClass} max-w-[12rem] !py-1`}
            placeholder="Find a name"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
          />
          {picked.length > 0 && (
            <button type="button" className="text-xs text-gray-400 hover:text-white" onClick={() => onChange({ ...filters, gameUsername: undefined })}>
              Clear ({picked.length})
            </button>
          )}
        </div>
        {nameChips.length ? (
          <div className="flex flex-wrap gap-2">
            {visibleChips.map((n) => (
              <button
                key={n.name.toLowerCase()}
                type="button"
                className={chipClass(isPicked(n.name))}
                aria-pressed={isPicked(n.name)}
                onClick={() => toggleName(n.name)}
              >
                {n.name}
                {n.count > 0 && <span className="ml-1 text-xs text-gray-400">({n.count})</span>}
              </button>
            ))}
            {visibleChips.length < nameChips.length && (
              <button type="button" className="text-xs text-gray-400 hover:text-white" onClick={() => setShowAllNames(true)}>
                Show all {nameChips.length}
              </button>
            )}
            {showAllNames && !needle && nameChips.length > NAMES_SHOWN && (
              <button type="button" className="text-xs text-gray-400 hover:text-white" onClick={() => setShowAllNames(false)}>
                Show less
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-500">{namesQuery.loading ? "Loading names…" : needle ? "No matching names" : "No backend usernames for these filters"}</p>
        )}
      </div>

      {/* Own full-width row that wraps, so no button is cut off on phones */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setQuick("all");
            setSearch("");
            setPlayer("");
            setNameSearch("");
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
            <input
              className={`${inputClass} max-w-[14rem]`}
              placeholder={defaultExportName()}
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              aria-label="Export file name"
              title="File name for the download (without .csv / .pdf)"
              maxLength={80}
            />
            <Button
              variant="ghost"
              onClick={() => onExport("csv", csvColumns, fileName.trim() || undefined)}
              loading={exporting === "csv"}
              disabled={!!exporting || !csvColumns.length}
              title="Export filtered rows as CSV"
            >
              CSV
            </Button>
            <Button
              variant="ghost"
              onClick={() => onExport("pdf", pdfColumns, fileName.trim() || undefined)}
              loading={exporting === "pdf"}
              disabled={!!exporting || !pdfColumns.length}
              title="Export filtered rows as PDF, grouped by payment method"
            >
              PDF
            </Button>
          </>
        )}
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
                {c.pdfOnly && <span className="text-xs text-gray-500">(PDF)</span>}
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
