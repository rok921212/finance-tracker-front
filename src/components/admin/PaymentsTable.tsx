import React from "react";
import { Table, Th, Td, Pagination } from "../ui/ui";
import { Paged, PaymentRow, paymentMethodLabel } from "../../lib/paymentsApi";
import { formatCents, formatDay } from "../../utils/money";

interface Props {
  data: Paged<PaymentRow> | null;
  loading: boolean;
  onOpen: (id: string) => void;
  onPage: (page: number) => void;
  showUser?: boolean;
}

const PaymentsTable: React.FC<Props> = ({ data, loading, onOpen, onPage, showUser = true }) => (
  <>
    <Table
      loading={loading}
      empty={!!data && data.items.length === 0}
      head={
        <>
          {showUser && <Th>User</Th>}
          <Th>Date</Th>
          <Th>Game</Th>
          <Th>Player</Th>
          <Th>Method</Th>
          <Th right>Deposit</Th>
          <Th right>Loaded</Th>
          <Th right>Redeemed</Th>
          <Th right>Cashout</Th>
          <Th>Edited</Th>
          <Th>Screenshot</Th>
        </>
      }
    >
      {!loading &&
        data?.items.map((p) => (
          <tr key={p.id} className="hover:bg-white/5 cursor-pointer" onClick={() => onOpen(p.id)}>
            {showUser && <Td className="font-medium text-white">{p.user?.username || "—"}</Td>}
            <Td>{formatDay(p.date)}</Td>
            <Td>{p.game || "—"}</Td>
            <Td>{p.player || "—"}</Td>
            <Td>{paymentMethodLabel(p.paymentMethod)}</Td>
            <Td right>{formatCents(p.deposit)}</Td>
            <Td right>{formatCents(p.loaded)}</Td>
            <Td right>{formatCents(p.redeemed || 0)}</Td>
            <Td right>
              {p.cashout || p.cashoutThumb ? (
                <span className="inline-flex items-center gap-2 justify-end">
                  {p.cashoutThumb && (
                    <img src={p.cashoutThumb} alt="Cashout screenshot" loading="lazy" className="w-8 h-8 rounded object-cover border border-yellow-500/40" />
                  )}
                  {formatCents(p.cashout || 0)}
                </span>
              ) : (
                "—"
              )}
            </Td>
            <Td>
              {p.editedAt ? (
                <span
                  className="inline-block text-xs px-2 py-0.5 rounded-full border border-yellow-500/50 text-yellow-300 whitespace-nowrap"
                  title={`Last edited by the user on ${new Date(p.editedAt).toLocaleString()}`}
                >
                  Edited {new Date(p.editedAt).toLocaleDateString()}
                </span>
              ) : (
                <span className="text-gray-500">—</span>
              )}
              {p.userDeletedAt && (
                <span
                  className="ml-1 inline-block text-xs px-2 py-0.5 rounded-full border border-red-500/50 text-red-300 whitespace-nowrap"
                  title={`Deleted by the user on ${new Date(p.userDeletedAt).toLocaleString()}`}
                >
                  Deleted by user
                </span>
              )}
            </Td>
            <Td>
              {p.thumb && (
                <img src={p.thumb} alt="" loading="lazy" className="w-10 h-10 rounded object-cover border border-gray-700" />
              )}
            </Td>
          </tr>
        ))}
    </Table>
    {data && data.total > 0 && <Pagination page={data.page} pages={data.pages} total={data.total} onChange={onPage} />}
  </>
);

export default PaymentsTable;
