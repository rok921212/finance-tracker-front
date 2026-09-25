import React, { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AxiosError } from "axios";
import AppHeader from "./AppHeader";
import ScreenshotDropzone, { MAX_CASHOUT_PROOF_BYTES } from "./ScreenshotDropzone";
import { Page, Card, Button, Field, Banner, Modal, Spinner, inputClass } from "../ui/ui";
import {
  createPayment,
  updatePayment,
  getActiveGames,
  getMyPayment,
  GameOption,
  PaymentDetail,
  PaymentMethod,
  PAYMENT_METHODS,
} from "../../lib/paymentsApi";
import { errorCode, errorMessage } from "../../lib/http";
import { useDropTick } from "../../lib/cache";
import { formatCents, formatDay, isValidAmount, toDayString } from "../../utils/money";
import { compressCashoutProof, compressScreenshot } from "../../lib/compressImage";

type Errors = Partial<
  Record<
    | "date"
    | "deposit"
    | "loaded"
    | "redeemed"
    | "cashout"
    | "gameId"
    | "paymentMethod"
    | "player"
    | "screenshot",
    string
  >
>;

/** 45050 -> "450.50" for prefilling inputs (no thousands separators). */
const centsToInput = (cents: number) => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

/** Serves both /payments/new and /payments/:id/edit. */
const AddPaymentForm: React.FC = () => {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id: string }>();
  const isEdit = !!editId;

  const [games, setGames] = useState<GameOption[] | null>(null);
  const [gamesError, setGamesError] = useState("");
  const [date, setDate] = useState(toDayString(new Date()));
  const [deposit, setDeposit] = useState("");
  const [loaded, setLoaded] = useState("");
  const [redeemed, setRedeemed] = useState("");
  const [cashout, setCashout] = useState("");
  const [cashoutProof, setCashoutProof] = useState<File | null>(null);
  const [gameId, setGameId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [player, setPlayer] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // Edit mode: the entry as it is now (current images, possibly-disabled game)
  const [original, setOriginal] = useState<PaymentDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duplicate, setDuplicate] = useState<{ date: string } | null>(null);
  // Synchronous lock: blocks a second submit before React re-renders the disabled button
  const inFlight = useRef(false);

  // Start shrinking picked images right away, so submit does not wait for it (results are memoized)
  useEffect(() => {
    if (file) compressScreenshot(file);
  }, [file]);
  useEffect(() => {
    if (cashoutProof) compressCashoutProof(cashoutProof);
  }, [cashoutProof]);

  // Points left change as entries come in: refetched when the server pushes a change to the games.
  // (The entry being edited is loaded once, so a change elsewhere never overwrites the form.)
  const gamesChanged = useDropTick("/games");
  useEffect(() => {
    getActiveGames()
      .then(setGames)
      .catch((e) => setGamesError(errorMessage(e, "Could not load games")));
  }, [gamesChanged]);

  useEffect(() => {
    if (!editId) return;
    getMyPayment(editId)
      .then((p) => {
        setOriginal(p);
        setDate(p.date.slice(0, 10));
        setDeposit(centsToInput(p.deposit));
        setLoaded(centsToInput(p.loaded));
        setRedeemed(centsToInput(p.redeemed || 0));
        setCashout(p.cashout ? centsToInput(p.cashout) : "");
        setGameId(p.gameId ? String(p.gameId) : "");
        setPaymentMethod(p.paymentMethod || "");
        setPlayer(p.player || "");
      })
      .catch((e) => setLoadError(errorMessage(e, "Could not load this entry")));
  }, [editId]);

  const existingProof = isEdit ? original?.cashoutProof : null;
  // An entry whose game was disabled later can keep it; it just isn't offered for new entries
  const gameOptions =
    original && original.gameId && games && !games.some((g) => g.id === String(original.gameId))
      ? [...games, { id: String(original.gameId), name: `${original.game || "Unknown game"} (disabled)` }]
      : games;

  const validate = (): boolean => {
    const next: Errors = {};
    if (!date) next.date = "Date is required";
    else if (date > toDayString(new Date(Date.now() + 86400000))) next.date = "Date cannot be in the future";
    if (!player.trim()) next.player = "Player is required";
    if (!paymentMethod) next.paymentMethod = "Select a payment method";
    if (!deposit.trim()) next.deposit = "Deposit is required";
    else if (!isValidAmount(deposit)) next.deposit = "Enter a valid amount (up to 2 decimals)";
    if (!loaded.trim()) next.loaded = "Loaded is required";
    else if (!isValidAmount(loaded)) next.loaded = "Enter a valid amount (up to 2 decimals)";
    if (!redeemed.trim()) next.redeemed = "Redeemed is required (enter 0 if nothing was redeemed)";
    else if (!isValidAmount(redeemed)) next.redeemed = "Enter a valid amount (up to 2 decimals)";
    // Optional: left empty means no cashout
    if (cashout.trim() && !isValidAmount(cashout)) next.cashout = "Enter a valid amount (up to 2 decimals)";
    if (!gameId) next.gameId = "Select a game";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (allowDuplicate = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError("");
    setProgress(0);

    const form = new FormData();
    form.append("date", date);
    form.append("player", player.trim());
    form.append("paymentMethod", paymentMethod);
    form.append("deposit", deposit.trim());
    form.append("loaded", loaded.trim());
    form.append("redeemed", redeemed.trim());
    if (cashout.trim()) form.append("cashout", cashout.trim());
    form.append("gameId", gameId);
    if (allowDuplicate) form.append("allowDuplicate", "true");
    // On edit, omitted files keep the entry's current images. Images are shrunk in the browser first
    // (already started when they were picked), so only a few hundred KB go over the network.
    const [shot, proof] = await Promise.all([
      file ? compressScreenshot(file) : null,
      cashoutProof ? compressCashoutProof(cashoutProof) : null,
    ]);
    if (shot) form.append("screenshot", shot);
    if (proof) form.append("cashoutProof", proof);

    try {
      if (editId) await updatePayment(editId, form, setProgress);
      else await createPayment(form, setProgress);
      navigate("/payments");
    } catch (e) {
      if (errorCode(e) === "DUPLICATE_SCREENSHOT") {
        const existing = (e as AxiosError<{ existing?: { date: string } }>).response?.data?.existing;
        setDuplicate({ date: existing?.date || "" });
      } else {
        setSubmitError(errorMessage(e, isEdit ? "Could not save changes. Please try again." : "Payment creation failed. Please try again."));
        if (errorCode(e) === "GAME_UNAVAILABLE") {
          setGameId("");
          getActiveGames().then(setGames).catch(() => {});
        }
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (validate()) submit(false);
  };

  const disabled = submitting;

  if (isEdit && !original) {
    return (
      <Page>
        <AppHeader />
        <div className="max-w-2xl mx-auto px-4 md:px-8 py-8">
          <Card title="Edit Payment Entry">
            {loadError ? (
              <div className="space-y-4">
                <Banner>{loadError}</Banner>
                <Button variant="ghost" onClick={() => navigate("/payments")}>
                  Back to entries
                </Button>
              </div>
            ) : (
              <div className="flex justify-center py-10 text-gray-400">
                <Spinner className="h-6 w-6" />
              </div>
            )}
          </Card>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <AppHeader />
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-8">
        <Card title={isEdit ? "Edit Payment Entry" : "Add Payment Entry"}>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            {gamesError && <Banner>{gamesError}</Banner>}
            {submitError && <Banner>{submitError}</Banner>}
            {isEdit && <Banner tone="info">Changes you save are recorded with the time of the edit.</Banner>}
            <div role="note" className="p-3 rounded-lg border border-amber-400/60 bg-amber-500/15 text-amber-100 text-sm space-y-1">
              <p className="font-semibold text-amber-300">Important</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  You must submit the <strong className="text-white">deposit screenshot</strong>, or this entry will not be
                  validated.
                </li>
                <li>
                  If there is a cashout, you must submit a valid{" "}
                  <strong className="text-white">cashout request screenshot from the player</strong>.
                </li>
              </ul>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Date" error={errors.date} htmlFor="pay-date">
                <input
                  id="pay-date"
                  type="date"
                  value={date}
                  max={toDayString(new Date())}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputClass}
                  disabled={disabled}
                />
              </Field>
              <Field label="Game" error={errors.gameId} htmlFor="pay-game">
                <select
                  id="pay-game"
                  value={gameId}
                  onChange={(e) => setGameId(e.target.value)}
                  className={inputClass}
                  disabled={disabled || !gameOptions?.length}
                >
                  <option value="">
                    {!gameOptions
                      ? gamesError
                        ? "Games unavailable"
                        : "Loading games..."
                      : gameOptions.length
                        ? "Select a game"
                        : "No games available"}
                  </option>
                  {gameOptions?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.remaining != null ? ` — ${formatCents(Math.max(0, g.remaining))} points left` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Player" error={errors.player} htmlFor="pay-player">
                <input
                  id="pay-player"
                  placeholder="Name used to load points"
                  value={player}
                  maxLength={60}
                  autoComplete="off"
                  onChange={(e) => setPlayer(e.target.value)}
                  className={inputClass}
                  disabled={disabled}
                />
              </Field>
              <Field label="Payment Method" error={errors.paymentMethod} htmlFor="pay-method">
                <select
                  id="pay-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | "")}
                  className={inputClass}
                  disabled={disabled}
                >
                  <option value="">Select a payment method</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Deposit" error={errors.deposit} htmlFor="pay-deposit">
                <input
                  id="pay-deposit"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value.replace(/[^\d.]/g, ""))}
                  className={inputClass}
                  disabled={disabled}
                />
              </Field>
              <Field label="Loaded" error={errors.loaded} htmlFor="pay-loaded">
                <input
                  id="pay-loaded"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={loaded}
                  onChange={(e) => setLoaded(e.target.value.replace(/[^\d.]/g, ""))}
                  className={inputClass}
                  disabled={disabled}
                />
              </Field>
              <Field label="Redeemed" error={errors.redeemed} htmlFor="pay-redeemed">
                <input
                  id="pay-redeemed"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={redeemed}
                  onChange={(e) => setRedeemed(e.target.value.replace(/[^\d.]/g, ""))}
                  className={inputClass}
                  disabled={disabled}
                />
              </Field>
              <Field label="Cashout (optional)" error={errors.cashout} htmlFor="pay-cashout">
                <input
                  id="pay-cashout"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={cashout}
                  onChange={(e) => setCashout(e.target.value.replace(/[^\d.]/g, ""))}
                  className={inputClass}
                  disabled={disabled}
                />
              </Field>
            </div>

            <Field
              label={isEdit ? "Deposit screenshot (upload to replace)" : "Deposit screenshot (needed for validation)"}
              error={errors.screenshot}
            >
              {isEdit && original?.screenshot && !file && (
                <div className="mb-2 flex items-center gap-3 text-xs text-gray-400">
                  <a href={original.screenshot} target="_blank" rel="noopener noreferrer">
                    <img
                      src={original.thumb || original.screenshot}
                      alt="Current screenshot"
                      className="w-16 h-16 rounded object-cover border border-gray-700"
                    />
                  </a>
                  <span>Current screenshot. It is kept unless you upload a new one.</span>
                </div>
              )}
              <ScreenshotDropzone
                file={file}
                onChange={(f) => {
                  setFile(f);
                  setErrors((prev) => ({ ...prev, screenshot: undefined }));
                }}
                disabled={disabled}
              />
            </Field>

            <Field label="Cashout request screenshot from the player (required if there is a cashout)">
              {existingProof && !cashoutProof && (
                <p className="mb-2 text-xs text-gray-400">
                  A cashout screenshot is already attached (
                  <a href={existingProof} target="_blank" rel="noopener noreferrer" className="text-yellow-300 underline">
                    view
                  </a>
                  ). It is kept unless you upload a new one.
                </p>
              )}
              <ScreenshotDropzone
                file={cashoutProof}
                onChange={setCashoutProof}
                disabled={disabled}
                maxBytes={MAX_CASHOUT_PROOF_BYTES}
                prompt="Drop the player's cashout request screenshot here or click to browse"
                hint="Required if there is a cashout · AVIF, JPG, PNG or WebP · max 10MB"
                tall
              />
              </Field>

            {submitting && (
              <div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-red-500 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-xs text-gray-400 mt-1">{progress < 100 ? `Uploading... ${progress}%` : "Saving..."}</p>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <Button type="button" variant="ghost" onClick={() => navigate("/payments")} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                {submitting ? (isEdit ? "Saving..." : "Submitting...") : isEdit ? "Save Changes" : "Submit Entry"}
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <Modal open={!!duplicate} onClose={() => setDuplicate(null)} title="Screenshot already used">
        <p className="text-gray-300 text-sm">
          You already submitted this exact screenshot
          {duplicate?.date ? ` for the entry dated ${formatDay(duplicate.date)}` : ""}. Use it again for this entry
          anyway?
        </p>
        <div className="flex justify-end gap-3 mt-5">
          <Button variant="ghost" onClick={() => setDuplicate(null)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setDuplicate(null);
              submit(true);
            }}
          >
            Use anyway
          </Button>
        </div>
      </Modal>
    </Page>
  );
};

export default AddPaymentForm;
