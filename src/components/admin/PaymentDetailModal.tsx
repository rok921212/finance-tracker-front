import React, { useEffect, useState } from "react";
import { Modal, Button, Banner, Spinner } from "../ui/ui";
import { adminDeletePayment, adminPayment, PaymentDetail, paymentMethodLabel } from "../../lib/paymentsApi";
import { errorMessage } from "../../lib/http";
import { useDropTick } from "../../lib/cache";
import { formatCents, formatDay } from "../../utils/money";
import EditHistory from "./EditHistory";

interface Props {
  paymentId: string | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-2 border-b border-gray-800 text-sm">
    <span className="text-gray-400">{label}</span>
    <span className="text-white text-right break-all">{children}</span>
  </div>
);

const PaymentDetailModal: React.FC<Props> = ({ paymentId, onClose, onDeleted }) => {
  const [detail, setDetail] = useState<PaymentDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError("");
  }, [paymentId]);
  // Refetched while open if the entry changes (pushed by the server)
  const changed = useDropTick(paymentId ? `/admin/payments/${paymentId}` : null);
  useEffect(() => {
    if (!paymentId) return;
    adminPayment(paymentId)
      .then(setDetail)
      .catch((e) => setError(errorMessage(e, "Could not load payment")));
  }, [paymentId, changed]);

  const onDelete = async () => {
    if (!detail || busy) return;
    const who = detail.user?.username ? ` from ${detail.user.username}` : "";
    if (!window.confirm(`Permanently delete this ${formatCents(detail.deposit)} entry${who}? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      await adminDeletePayment(detail.id);
      onDeleted(detail.id);
      onClose();
    } catch (e) {
      setError(errorMessage(e, "Could not delete the entry"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!paymentId} onClose={onClose} title="Payment Details" wide>
      {error && <div className="mb-4"><Banner>{error}</Banner></div>}
      {!detail && !error && (
        <div className="flex justify-center py-10 text-gray-400">
          <Spinner className="h-6 w-6" />
        </div>
      )}
      {detail && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            {detail.userDeletedAt && (
              <div className="mb-3">
                <Banner>
                  The user deleted this entry on {new Date(detail.userDeletedAt).toLocaleString()}. It is hidden from them
                  but kept here until you delete it permanently.
                </Banner>
              </div>
            )}
            <Row label="Payment ID"><span className="font-mono text-xs">{detail.id}</span></Row>
            <Row label="User">{detail.user?.username || "—"}</Row>
            <Row label="Date">{formatDay(detail.date)}</Row>
            <Row label="Game">{detail.game || "—"}</Row>
            <Row label="Player">{detail.player || "—"}</Row>
            <Row label="Payment method">{paymentMethodLabel(detail.paymentMethod)}</Row>
            <Row label="Deposit">{formatCents(detail.deposit)}</Row>
            <Row label="Loaded">{formatCents(detail.loaded)}</Row>
            <Row label="Redeemed">{formatCents(detail.redeemed || 0)}</Row>
            <Row label="Cashout">{formatCents(detail.cashout || 0)}</Row>
            <Row label="Created at">{new Date(detail.createdAt).toLocaleString()}</Row>
            <Row label="Last edited">{detail.editedAt ? new Date(detail.editedAt).toLocaleString() : "Never"}</Row>
            {!!detail.sameScreenshot?.length && (
              <div className="mt-3">
                <Banner tone="info">
                  This screenshot is also attached to {detail.sameScreenshot.length} other entr
                  {detail.sameScreenshot.length === 1 ? "y" : "ies"} (
                  {detail.sameScreenshot.map((s) => formatDay(s.date)).join(", ")}).
                </Banner>
              </div>
            )}

            {detail.editedAt && (
              <div className="mt-5">
                <EditHistory paymentId={detail.id} compact />
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <Button variant="ghost" className="text-red-300" onClick={onDelete} loading={busy} disabled={busy}>
                Delete permanently
              </Button>
            </div>
          </div>
          <div>
            {detail.screenshot ? (
              <a href={detail.screenshot} target="_blank" rel="noopener noreferrer" title="Open full size">
                <img
                  src={detail.screenshot}
                  alt="Payment screenshot"
                  className="w-full max-h-[70vh] object-contain rounded-lg border border-gray-700 bg-black"
                />
              </a>
            ) : (
              <p className="text-gray-500">No screenshot</p>
            )}
            {detail.screenshot && <p className="text-xs text-gray-500 mt-2">Click the image to open it full size.</p>}
          </div>
          {detail.cashoutProof && (
            <div className="md:col-span-2">
              <h3 className="text-sm font-semibold text-white mb-2">Cashout screenshot · {formatCents(detail.cashout || 0)}</h3>
              {/* Shown at full length (no height cap) so nothing is hidden */}
              <a href={detail.cashoutProof} target="_blank" rel="noopener noreferrer" title="Open full size">
                <img
                  src={detail.cashoutProof}
                  alt="Cashout screenshot"
                  className="w-full h-auto rounded-lg border border-yellow-500/40 bg-black"
                />
              </a>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default PaymentDetailModal;
