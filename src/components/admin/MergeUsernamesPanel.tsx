import React, { useState } from "react";
import { Button, inputClass } from "../ui/ui";
import type { GameUsernameRow, UsernameMerge } from "../../lib/paymentsApi";

// Merge groups are remembered in this browser (they only shape exports; stored entries never change)
const MERGES_KEY = "exportMerges";

export const readMerges = (): UsernameMerge[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(MERGES_KEY) || "[]");
    if (Array.isArray(saved)) {
      return saved
        .filter((g) => g && typeof g.name === "string" && Array.isArray(g.members))
        .map((g) => ({ name: g.name, members: g.members.filter((m: unknown) => typeof m === "string") }));
    }
  } catch {
    // unavailable or corrupt: start empty
  }
  return [];
};

export const saveMerges = (merges: UsernameMerge[]) => {
  try {
    localStorage.setItem(MERGES_KEY, JSON.stringify(merges));
  } catch {
    // storage unavailable: kept for this visit only
  }
};

const lower = (s: string) => s.toLowerCase();

interface Props {
  merges: UsernameMerge[];
  onChange: (merges: UsernameMerge[]) => void;
  /** Backend usernames in use under the current filters */
  names: GameUsernameRow[];
}

export const chip = (on: boolean, off = false) =>
  `px-2.5 py-1 rounded-lg text-xs border transition-colors ${
    off
      ? "border-gray-800 text-gray-600 cursor-not-allowed"
      : on
        ? "bg-red-600/30 border-red-500 text-white"
        : "bg-black/30 border-gray-700 text-gray-300 hover:border-gray-500"
  }`;

/** Combine alias spellings (john1, John_1, johnny) into one backend username for the CSV / PDF. */
const MergeUsernamesPanel: React.FC<Props> = ({ merges, onChange, names }) => {
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [find, setFind] = useState("");

  // A name can be in one group only
  const groupOf = (n: string) => merges.find((g) => g.members.some((m) => lower(m) === lower(n)) || lower(g.name) === lower(n));
  const isSelected = (n: string) => selected.some((s) => lower(s) === lower(n));
  const toggle = (n: string) => setSelected(isSelected(n) ? selected.filter((s) => lower(s) !== lower(n)) : [...selected, n]);

  const needle = lower(find.trim());
  const options = names.filter((n) => !needle || lower(n.name).includes(needle)).slice(0, 60);

  const name = groupName.trim() || selected[0] || "";
  const canAdd = !!name && selected.length >= 1 && (selected.length > 1 || lower(selected[0]) !== lower(name));

  const addGroup = () => {
    if (!canAdd) return;
    const existing = merges.find((g) => lower(g.name) === lower(name));
    const next = existing
      ? merges.map((g) => (g === existing ? { ...g, members: Array.from(new Set([...g.members, ...selected])) } : g))
      : [...merges, { name: name.slice(0, 60), members: selected }];
    onChange(next);
    setSelected([]);
    setGroupName("");
    setFind("");
  };

  const removeMember = (g: UsernameMerge, m: string) =>
    onChange(merges.map((x) => (x === g ? { ...x, members: x.members.filter((y) => y !== m) } : x)).filter((x) => x.members.length > 0));

  return (
    <div id="export-merges" className="anim-fade rounded-lg border border-gray-700 bg-black/40 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-gray-300">Merge backend usernames</span>
        {merges.length > 0 && (
          <button type="button" className="text-xs text-gray-400 hover:text-white" onClick={() => onChange([])}>
            Clear all
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Entries under merged names are reported as one backend username in the CSV and PDF, with combined subtotals. The saved entries are not
        changed.
      </p>

      {merges.length > 0 && (
        <ul className="space-y-2">
          {merges.map((g) => (
            <li key={g.name} className="flex flex-wrap items-center gap-2 rounded border border-gray-800 bg-black/30 p-2">
              <span className="font-semibold text-sm text-white">{g.name}</span>
              <span className="text-gray-500 text-xs">←</span>
              {g.members.map((m) => (
                <span key={m} className="inline-flex items-center gap-1 rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">
                  {m}
                  <button type="button" aria-label={`Remove ${m} from ${g.name}`} className="text-gray-500 hover:text-red-400" onClick={() => removeMember(g, m)}>
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="ml-auto text-xs text-red-400 hover:text-red-300"
                onClick={() => onChange(merges.filter((x) => x !== g))}
              >
                Remove group
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputClass} max-w-[12rem] !py-1`}
            placeholder="Find a name"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            aria-label="Find a backend username to merge"
          />
          <span className="text-xs text-gray-500">Pick two or more names to merge</span>
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
          {options.map((n) => {
            const taken = groupOf(n.name);
            return (
              <button
                key={lower(n.name)}
                type="button"
                disabled={!!taken}
                title={taken ? `Already merged into ${taken.name}` : undefined}
                className={chip(isSelected(n.name), !!taken)}
                aria-pressed={isSelected(n.name)}
                onClick={() => toggle(n.name)}
              >
                {n.name}
                {n.count > 0 && <span className="ml-1 text-gray-500">({n.count})</span>}
              </button>
            );
          })}
          {!options.length && <span className="text-xs text-gray-500">No matching names</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputClass} max-w-[14rem] !py-1`}
            placeholder={selected[0] ? `Merged name (default: ${selected[0]})` : "Merged name"}
            value={groupName}
            maxLength={60}
            onChange={(e) => setGroupName(e.target.value)}
            aria-label="Name for the merged group"
          />
          <Button variant="ghost" onClick={addGroup} disabled={!canAdd}>
            Add group{selected.length ? ` (${selected.length})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MergeUsernamesPanel;
