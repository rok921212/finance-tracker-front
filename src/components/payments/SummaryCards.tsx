import React from "react";
import { StatCard } from "../ui/ui";
import { paymentMethodLabel, SummaryBreakdowns } from "../../lib/paymentsApi";
import { formatCents } from "../../utils/money";

type Row = { key: string; label: string; amount: number };

const DIVIDERS = {
  green: "border-green-500/20",
  blue: "border-blue-500/20",
  purple: "border-purple-500/20",
  yellow: "border-yellow-500/20",
};

const Breakdown: React.FC<{ rows: Row[]; tone: keyof typeof DIVIDERS }> = ({ rows, tone }) =>
  rows.length ? (
    <ul className={`mt-3 pt-3 border-t ${DIVIDERS[tone]} space-y-1 text-sm max-h-40 overflow-y-auto`}>
      {rows.map((r) => (
        <li key={r.key} className="flex justify-between gap-2">
          <span className="text-gray-300 truncate">{r.label}</span>
          <span className="text-white tabular-nums">{formatCents(r.amount)}</span>
        </li>
      ))}
    </ul>
  ) : null;

const byMethod = (list: SummaryBreakdowns["depositByMethod"] = []): Row[] =>
  list.map((m) => ({ key: m.method || "none", label: m.method ? paymentMethodLabel(m.method) : "No method", amount: m.amount }));

const byGame = (list: SummaryBreakdowns["loadedByGame"] = []): Row[] =>
  list.map((g) => ({ key: String(g.gameId), label: g.game || "Unknown game", amount: g.amount }));

/** Deposit / Loaded / Redeemed / Cashout cards, each split by payment method or game */
const SummaryCards: React.FC<{ summary: SummaryBreakdowns | null }> = ({ summary }) => {
  const total = (n?: number) => (summary ? formatCents(n || 0) : "—");
  return (
    <>
      <StatCard label="Total Deposit" tone="green" value={total(summary?.totalDeposit)}>
        <Breakdown tone="green" rows={byMethod(summary?.depositByMethod)} />
      </StatCard>
      <StatCard label="Total Loaded" tone="blue" value={total(summary?.totalLoaded)}>
        <Breakdown tone="blue" rows={byGame(summary?.loadedByGame)} />
      </StatCard>
      <StatCard label="Total Redeemed" tone="purple" value={total(summary?.totalRedeemed)}>
        <Breakdown tone="purple" rows={byGame(summary?.redeemedByGame)} />
      </StatCard>
      <StatCard label="Total Cashout" tone="yellow" value={total(summary?.totalCashout)}>
        <Breakdown tone="yellow" rows={byMethod(summary?.cashoutByMethod)} />
      </StatCard>
    </>
  );
};

export default SummaryCards;
