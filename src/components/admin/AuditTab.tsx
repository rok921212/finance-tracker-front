import React, { useEffect, useState } from "react";
import { Card, Banner, Table, Th, Td, Pagination } from "../ui/ui";
import { adminAudit, AuditRow, Paged } from "../../lib/paymentsApi";
import { errorMessage } from "../../lib/http";
import { useDropTick } from "../../lib/cache";
import { formatCents } from "../../utils/money";

const ACTION_LABELS: Record<string, string> = {
  "payment.verify": "Payment verified",
  "payment.reject": "Payment rejected",
  "payment.delete": "Entry permanently deleted",
  "game.create": "Game created",
  "game.update": "Game updated",
  "game.toggle": "Game enabled/disabled",
  "user.create": "User created",
  "user.role": "Role changed",
  "user.update": "User edited",
  "user.delete": "User deleted",
};

const points = (c: unknown) => (typeof c === "number" ? formatCents(c) : "unlimited");

const describe = (a: AuditRow): string => {
  const m = a.metadata || {};
  if (a.action === "payment.reject" && m.reason) return `Reason: ${m.reason}`;
  if (a.action === "payment.delete") {
    const amount = typeof m.deposit === "number" ? `Deposit ${formatCents(m.deposit)}` : "Entry";
    // Older rows carry the entry's review status; newer ones whether the user had edited it
    const notes = [m.status ? `was ${m.status}` : "", m.edited ? "had been edited" : "", m.userDeleted ? "user had deleted it" : ""];
    return [amount, ...notes.filter(Boolean)].join(", ");
  }
  if (a.action === "game.create" && m.name) return String(m.name);
  if (a.action === "game.toggle") return m.active ? "Enabled" : "Disabled";
  if (a.action === "game.update") {
    const n = m.name as { from?: string; to?: string } | undefined;
    const t = m.totalPoints as { from?: number | null; to?: number | null } | undefined;
    return [n && `${n.from} → ${n.to}`, t && `Total points ${points(t.from)} → ${points(t.to)}`].filter(Boolean).join("; ");
  }
  if (a.action === "user.create" && m.username) return `${m.username} (${m.role})`;
  if (a.action === "user.role" && m.username) return `${m.username}: ${m.from} → ${m.to}`;
  if (a.action === "user.update") {
    const n = m.username as { from?: string; to?: string } | string | undefined;
    const name = typeof n === "object" && n ? `Renamed ${n.from} → ${n.to}` : "";
    return [name, m.password ? "Password reset" : ""].filter(Boolean).join("; ");
  }
  if (a.action === "user.delete" && m.username) {
    const entries = typeof m.entries === "number" ? m.entries : 0;
    return `${m.username} (${m.role}), ${entries} ${entries === 1 ? "entry" : "entries"} removed`;
  }
  return "";
};

const AuditTab: React.FC = () => {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AuditRow> | null>(null);
  const [error, setError] = useState("");

  // Refetch when the log changes (pushed by the server); a page change shows a loader meanwhile
  const changed = useDropTick("/admin/audit", { page });
  useEffect(() => setData(null), [page]);
  useEffect(() => {
    adminAudit(page)
      .then(setData)
      .catch((e) => setError(errorMessage(e, "Could not load audit log")));
  }, [page, changed]);

  return (
    <Card title="Audit Log">
      {error && <Banner>{error}</Banner>}
      <Table
        loading={!data && !error}
        empty={!!data && data.items.length === 0}
        head={
          <>
            <Th>When</Th>
            <Th>Admin</Th>
            <Th>Action</Th>
            <Th>Target</Th>
            <Th>Details</Th>
          </>
        }
      >
        {data?.items.map((a) => (
          <tr key={a.id} className="hover:bg-white/5">
            <Td>{new Date(a.createdAt).toLocaleString()}</Td>
            <Td>{a.admin || "—"}</Td>
            <Td className="text-white">{ACTION_LABELS[a.action] || a.action}</Td>
            <Td>
              <span className="font-mono text-xs text-gray-400">
                {a.targetType}:{a.targetId.slice(-6)}
              </span>
            </Td>
            <Td className="text-gray-300">{describe(a)}</Td>
          </tr>
        ))}
      </Table>
      {data && data.total > 0 && <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
    </Card>
  );
};

export default AuditTab;
