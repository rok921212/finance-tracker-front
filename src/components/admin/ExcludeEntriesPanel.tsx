import React, { useState } from "react";
import { Button, inputClass } from "../ui/ui";
import { ExportExclusion, GameUsernameRow, PAYMENT_METHODS, PaymentMethod, paymentMethodLabel } from "../../lib/paymentsApi";
import { chip } from "./MergeUsernamesPanel";

const lower = (s: string) => s.toLowerCase();

interface Props {
  rules: ExportExclusion[];
  onChange: (rules: ExportExclusion[]) => void;
  /** Backend usernames in use under the current filters */
  names: GameUsernameRow[];
}

/** Adds rules for these names: a name that already has a rule gains the methods (no methods means all of them). */
const addRules = (rules: ExportExclusion[], names: string[], methods: PaymentMethod[]) => {
  const next = [...rules];
  for (const name of names) {
    const at = next.findIndex((r) => lower(r.name) === lower(name));
    if (at < 0) next.push({ name, methods });
    else if (!next[at].methods.length || !methods.length) next[at] = { ...next[at], methods: [] };
    else next[at] = { ...next[at], methods: Array.from(new Set([...next[at].methods, ...methods])) };
  }
  return next;
};

/** Leave chosen backend usernames out of the PDF, on chosen payment methods or on all of them. */
const ExcludeEntriesPanel: React.FC<Props> = ({ rules, onChange, names }) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [find, setFind] = useState("");

  const isSelected = (n: string) => selected.some((s) => lower(s) === lower(n));
  const toggleName = (n: string) => setSelected(isSelected(n) ? selected.filter((s) => lower(s) !== lower(n)) : [...selected, n]);
  const toggleMethod = (m: PaymentMethod) => setMethods(methods.includes(m) ? methods.filter((x) => x !== m) : [...methods, m]);

  const needle = lower(find.trim());
  const options = names.filter((n) => !needle || lower(n.name).includes(needle)).slice(0, 60);

  const add = () => {
    onChange(addRules(rules, selected, methods));
    setSelected([]);
    setMethods([]);
    setFind("");
  };

  return (
    <div id="export-excludes" className="anim-fade rounded-lg border border-gray-700 bg-black/40 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-gray-300">Exclude from PDF</span>
        {rules.length > 0 && (
          <button type="button" className="text-xs text-gray-400 hover:text-white" onClick={() => onChange([])}>
            Clear all
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Matching entries are left out of the PDF and its totals. The report does not mention them. The CSV and the saved entries are not changed, and
        these rules are forgotten when the page is reloaded.
      </p>

      {rules.length > 0 && (
        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={lower(r.name)} className="flex flex-wrap items-center gap-2 rounded border border-gray-800 bg-black/30 p-2">
              <span className="font-semibold text-sm text-white">{r.name}</span>
              <span className="text-xs text-gray-400">{r.methods.length ? r.methods.map(paymentMethodLabel).join(", ") : "All payment methods"}</span>
              <button type="button" className="ml-auto text-xs text-red-400 hover:text-red-300" onClick={() => onChange(rules.filter((x) => x !== r))}>
                Remove
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
            aria-label="Find a backend username to exclude"
          />
          <span className="text-xs text-gray-500">Pick one or more backend usernames</span>
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
          {options.map((n) => (
            <button key={lower(n.name)} type="button" className={chip(isSelected(n.name))} aria-pressed={isSelected(n.name)} onClick={() => toggleName(n.name)}>
              {n.name}
              {n.count > 0 && <span className="ml-1 text-gray-500">({n.count})</span>}
            </button>
          ))}
          {!options.length && <span className="text-xs text-gray-500">No matching names</span>}
        </div>
        <span className="block text-xs text-gray-500">Payment methods to exclude them on (none picked means all methods)</span>
        <div className="flex flex-wrap gap-1.5">
          {PAYMENT_METHODS.map((m) => (
            <button key={m.value} type="button" className={chip(methods.includes(m.value))} aria-pressed={methods.includes(m.value)} onClick={() => toggleMethod(m.value)}>
              {m.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={add} disabled={!selected.length}>
          {selected.length ? `Exclude ${selected.length === 1 ? selected[0] : `${selected.length} names`} on ${methods.length ? methods.map(paymentMethodLabel).join(", ") : "all methods"}` : "Exclude"}
        </Button>
      </div>
    </div>
  );
};

export default ExcludeEntriesPanel;
