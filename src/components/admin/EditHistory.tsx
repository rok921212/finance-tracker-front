import React, { useEffect, useState } from "react";
import { Card, Banner, Table, Th, Td, Pagination, Spinner } from "../ui/ui";
import { adminEdits, clean, EditChange, EditRow, Paged, paymentMethodLabel } from "../../lib/paymentsApi";
import { errorMessage } from "../../lib/http";
import { useDropTick } from "../../lib/cache";
import { formatCents, formatDay } from "../../utils/money";

const FIELD_LABELS: Record<string, string> = {
  date: "Date",
  game: "Game",
  player: "Player",
  paymentMethod: "Payment method",
  deposit: "Deposit",
  loaded: "Loaded",
  redeemed: "Redeemed",
  cashout: "Cashout",
  screenshot: "Screenshot",
  cashoutProof: "Cashout screenshot",
};
const MONEY = new Set(["deposit", "loaded", "redeemed", "cashout"]);
const IMAGES = new Set(["screenshot", "cashoutProof"]);

const formatValue = (field: string, v: EditChange["from"]): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (MONEY.has(field) && typeof v === "number") return formatCents(v);
  if (field === "date") return formatDay(String(v));
  if (field === "paymentMethod") return paymentMethodLabel(String(v));
  return String(v);
};

const ChangeLine: React.FC<{ c: EditChange }> = ({ c }) => {
  const label = FIELD_LABELS[c.field] || c.field;
  if (IMAGES.has(c.field)) {
    return (
      <li>
        <span className="text-gray-400">{label}</span> {c.to === "added" ? "added" : "replaced"}
      </li>
    );
  }
  return (
    <li>
      <span className="text-gray-400">{label}:</span> <span className="text-red-300 line-through">{formatValue(c.field, c.from)}</span>{" "}
      → <span className="text-green-300">{formatValue(c.field, c.to)}</span>
    </li>
  );
};

const Changes: React.FC<{ changes: EditChange[] }> = ({ changes }) => (
  <ul className="space-y-0.5">
    {changes.map((c, i) => (
      <ChangeLine key={i} c={c} />
    ))}
  </ul>
);

interface Props {
  userId?: string;
  paymentId?: string;
  /** Opens the entry's detail modal (table mode) */
  onOpen?: (paymentId: string) => void;
  /** Plain list for tight spaces (payment detail modal) instead of a card + table */
  compact?: boolean;
}

/** Users' edits to their entries: what was changed, from what to what, and when. */
const EditHistory: React.FC<Props> = ({ userId, paymentId, onOpen, compact }) => {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<EditRow> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => setPage(1), [userId, paymentId]);
  // Refetch when an edit is made anywhere (pushed by the server)
  const changed = useDropTick("/admin/edits", clean({ userId, paymentId, page }));

  useEffect(() => {
    let cancelled = false;
    setError("");
    adminEdits({ userId, paymentId }, page)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorMessage(e, "Could not load edit history")));
    return () => {
      cancelled = true;
    };
  }, [userId, paymentId, page, changed]);

  if (compact) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-white mb-2">Edit history</h3>
        {error && <Banner>{error}</Banner>}
        {!data && !error && <Spinner className="h-4 w-4 text-gray-400" />}
        {data && data.items.length === 0 && <p className="text-sm text-gray-500">No edits.</p>}
        <ol className="space-y-3">
          {data?.items.map((e) => (
            <li key={e.id} className="text-sm border-l-2 border-gray-700 pl-3">
              <p className="text-xs text-gray-400 mb-1">{new Date(e.createdAt).toLocaleString()}</p>
              <Changes changes={e.changes} />
            </li>
          ))}
        </ol>
        {data && data.pages > 1 && <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
      </div>
    );
  }

  return (
    <Card title="Edit History">
      {error && <Banner>{error}</Banner>}
      <Table
        loading={!data && !error}
        empty={!!data && data.items.length === 0}
        head={
          <>
            <Th>Edited at</Th>
            {!userId && <Th>User</Th>}
            <Th>Entry</Th>
            <Th>What changed</Th>
          </>
        }
      >
        {data?.items.map((e) => (
          <tr key={e.id} className="hover:bg-white/5 align-top">
            <Td className="whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</Td>
            {!userId && <Td>{e.user?.username || "—"}</Td>}
            <Td>
              {onOpen ? (
                <button type="button" className="text-left text-blue-300 hover:underline" onClick={() => onOpen(e.paymentId)}>
                  {e.paymentDate ? formatDay(e.paymentDate) : "—"} · {e.game || "—"}
                </button>
              ) : (
                <span>
                  {e.paymentDate ? formatDay(e.paymentDate) : "—"} · {e.game || "—"}
                </span>
              )}
            </Td>
            <Td>
              <Changes changes={e.changes} />
            </Td>
          </tr>
        ))}
      </Table>
      {data && data.total > 0 && <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
    </Card>
  );
};

export default EditHistory;
