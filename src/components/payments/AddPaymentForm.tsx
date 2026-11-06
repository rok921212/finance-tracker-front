import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AxiosError } from "axios";
import AppHeader from "./AppHeader";
import ScreenshotDropzone, { MAX_CASHOUT_PROOF_BYTES } from "./ScreenshotDropzone";
import { Page, Card, Button, Field, Banner, Modal, Spinner, inputClass } from "../ui/ui";
import {
  updatePayment,
  getActiveGames,
  peekActiveGames,
  getMyPayment,
  getMyGameUsernames,
  GameOption,
  PaymentDetail,
  PaymentMethod,
  PAYMENT_METHODS,
  paymentMethodLabel,
} from "../../lib/paymentsApi";
import { errorCode, errorMessage } from "../../lib/http";
import { useDropTick } from "../../lib/cache";
import { formatDay, isValidAmount, toDayString } from "../../utils/money";
import { compressCashoutProof, compressScreenshot } from "../../lib/compressImage";
import { preloadOcr, readScreenshotText } from "../../lib/ocr";
import { parseReceipt } from "../../lib/parseReceipt";
import SuggestInput from "../ui/SuggestInput";
import { startSave, useSaves } from "../../lib/pendingSaves";
import SaveRows from "./SaveRows";

type Errors = Partial<
  Record<
    | "date"
    | "deposit"
    | "loaded"
    | "redeemed"
    | "cashout"
    | "cashoutProof"
    | "cashoutMethod"
    | "notes"
    | "gameId"
    | "customGame"
    | "paymentMethod"
    | "player"
    | "gameUsername"
    | "paymentTag"
    | "screenshot",
    string
  >
>;

const MAX_NOTES = 500;

/** Dropdown value for "Custom game": the name is typed in a box that appears below */
const CUSTOM_GAME = "__custom__";

/** 45050 -> "450.50" for prefilling inputs (no thousands separators). */
const centsToInput = (cents: number) => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

/** Fields the screenshot reader can fill in */
type AutoField = "date" | "deposit" | "paymentMethod" | "player" | "paymentTag";

/** Marks a field filled in from the screenshot, until the user changes it */
const AutoBadge: React.FC<{ on: boolean }> = ({ on }) =>
  on ? (
    <span className="inline-block rounded bg-sky-500/20 border border-sky-400/50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
      auto · check
    </span>
  ) : null;

/** Serves both /payments/new and /payments/:id/edit. */
const AddPaymentForm: React.FC = () => {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id: string }>();
  const isEdit = !!editId;

  const [games, setGames] = useState<GameOption[] | null>(() => peekActiveGames() ?? null);
  const [date, setDate] = useState(toDayString(new Date()));
  const [deposit, setDeposit] = useState("");
  const [loaded, setLoaded] = useState("");
  // Nothing redeemed is the common case: starts at 0 (an emptied box is also saved as 0)
  const [redeemed, setRedeemed] = useState("0");
  const [cashout, setCashout] = useState("");
  const [cashoutProof, setCashoutProof] = useState<File | null>(null);
  const [cashoutMethod, setCashoutMethod] = useState<PaymentMethod | "">("");
  const [notes, setNotes] = useState("");
  const [gamesError, setGamesError] = useState("");
  const [gameId, setGameId] = useState("");
  // Name typed after choosing "Custom game" in the dropdown
  const [customGame, setCustomGame] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [player, setPlayer] = useState("");
  const [gameUsername, setGameUsername] = useState("");
  const [paymentTag, setPaymentTag] = useState("");
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
  // Screenshot reading: fields it filled (until edited), whether it is running, and whether the
  // user picked the date themselves (then it is never overwritten)
  const [autoFilled, setAutoFilled] = useState<Set<AutoField>>(new Set());
  const [scanning, setScanning] = useState(false);
  const dateTouched = useRef(false);
  const scanId = useRef(0);
  // Previous backend usernames: this game's first, then the user's others
  const [gameNames, setGameNames] = useState<string[]>([]);
  const [allNames, setAllNames] = useState<string[]>([]);
  const saves = useSaves();
  const topRef = useRef<HTMLDivElement>(null);

  const clearAuto = (field: AutoField) =>
    setAutoFilled((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });

  // Load the OCR engine while the user fills the form, so reading a screenshot is quick
  useEffect(() => {
    if (!isEdit) preloadOcr();
  }, [isEdit]);

  useEffect(() => {
    getMyGameUsernames()
      .then((rows) => setAllNames(rows.map((r) => r.name)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!gameId || gameId === CUSTOM_GAME) {
      setGameNames([]);
      return;
    }
    let cancelled = false;
    getMyGameUsernames(gameId)
      .then((rows) => !cancelled && setGameNames(rows.map((r) => r.name)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gameId]);
  const usernameSuggestions = useMemo(() => {
    const seen = new Set<string>();
    return [...gameNames, ...allNames].filter((n) => {
      const k = n.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [gameNames, allNames]);

  // Read the deposit screenshot and fill the fields that are still empty. A newer screenshot
  // (or a removed one) discards an older scan's result.
  useEffect(() => {
    const id = ++scanId.current;
    if (!file || isEdit) {
      setScanning(false);
      return;
    }
    setScanning(true);
    readScreenshotText(file)
      .then((text) => {
        if (id !== scanId.current) return;
        const r = parseReceipt(text);
        const filled: AutoField[] = [];
        const fill = (field: AutoField, value: string | undefined, current: string, set: (v: string) => void) => {
          if (value && !current.trim()) {
            set(value);
            filled.push(field);
          }
        };
        fill("deposit", r.amount, valuesRef.current.deposit, setDeposit);
        fill("player", r.player, valuesRef.current.player, setPlayer);
        fill("paymentMethod", r.method, valuesRef.current.paymentMethod, (v) => setPaymentMethod(v as PaymentMethod));
        fill("paymentTag", r.tag, valuesRef.current.paymentTag, setPaymentTag);
        if (r.date && !dateTouched.current && r.date <= toDayString(new Date())) {
          setDate(r.date);
          filled.push("date");
        }
        setAutoFilled(new Set(filled));
      })
      .catch(() => {
        // Reading is a convenience: on any failure the user just types the fields
      })
      .finally(() => {
        if (id === scanId.current) setScanning(false);
      });
  }, [file, isEdit]);

  // Start shrinking picked images right away, so submit does not wait for it (results are memoized)
  useEffect(() => {
    if (file) compressScreenshot(file);
  }, [file]);
  useEffect(() => {
    if (cashoutProof) compressCashoutProof(cashoutProof);
  }, [cashoutProof]);

  // Active games for the dropdown: refetched when the server pushes a change to the games.
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
        setGameUsername(p.gameUsername || "");
        setPaymentTag(p.paymentTag || "");
        setCashoutMethod(p.cashoutMethod || "");
        setNotes(p.notes || "");
      })
      .catch((e) => setLoadError(errorMessage(e, "Could not load this entry")));
  }, [editId]);

  // Current values, read by the screenshot scan when it finishes (it only fills empty fields)
  const valuesRef = useRef({ deposit, player, paymentMethod: paymentMethod as string, paymentTag });
  valuesRef.current = { deposit, player, paymentMethod, paymentTag };

  const existingProof = isEdit ? original?.cashoutProof : null;
  // An entry whose game was disabled later can keep it; it just isn't offered for new entries
  const gameOptions =
    original && original.gameId && games && !games.some((g) => g.id === String(original.gameId))
      ? [...games, { id: String(original.gameId), name: `${original.game || "Unknown game"} (disabled)` }]
      : games;
  const isCustomGame = gameId === CUSTOM_GAME;
  // The cashout screenshot upload only appears once a cashout amount is entered
  const hasCashout = parseFloat(cashout) > 0;

  const validate = (): boolean => {
    const next: Errors = {};
    if (!date) next.date = "Date is required";
    else if (date > toDayString(new Date(Date.now() + 86400000))) next.date = "Date cannot be in the future";
    if (!player.trim()) next.player = "Player is required";
    if (!paymentMethod) next.paymentMethod = "Select a payment method";
    else if (!paymentTag.trim()) next.paymentTag = "Enter the tag the money was sent to";
    if (!deposit.trim()) next.deposit = "Deposit is required";
    else if (!isValidAmount(deposit)) next.deposit = "Enter a valid amount (up to 2 decimals)";
    if (!loaded.trim()) next.loaded = "Loaded is required";
    else if (!isValidAmount(loaded)) next.loaded = "Enter a valid amount (up to 2 decimals)";
    if (redeemed.trim() && !isValidAmount(redeemed)) next.redeemed = "Enter a valid amount (up to 2 decimals)";
    // Left empty means no cashout; a cashout needs its screenshot (a new one, or the one already attached)
    if (cashout.trim() && !isValidAmount(cashout)) next.cashout = "Enter a valid amount (up to 2 decimals)";
    else if (hasCashout && !cashoutMethod) next.cashoutMethod = "Select how the cashout was paid";
    else if (hasCashout && !cashoutProof && !existingProof) next.cashoutProof = "Upload the cashout screenshot for this cashout";
    if (notes.trim().length > MAX_NOTES) next.notes = `Notes must be at most ${MAX_NOTES} characters`;
    if (!gameId) next.gameId = "Select a game";
    else if (isCustomGame && !customGame.trim()) next.customGame = "Enter the game name";
    else if (isCustomGame && !/[a-z0-9]/i.test(customGame)) next.customGame = "Game name must contain letters or numbers";
    else if (!gameUsername.trim()) next.gameUsername = "Enter the backend username used to load the points";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (allowDuplicate = false) => {
    if (inFlight.current) return;
    setSubmitError("");

    const form = new FormData();
    form.append("date", date);
    form.append("player", player.trim());
    form.append("gameUsername", gameUsername.trim());
    form.append("paymentTag", paymentTag.trim());
    form.append("paymentMethod", paymentMethod);
    form.append("deposit", deposit.trim());
    form.append("loaded", loaded.trim());
    form.append("redeemed", redeemed.trim() || "0");
    if (cashout.trim()) form.append("cashout", cashout.trim());
    if (hasCashout) form.append("cashoutMethod", cashoutMethod);
    form.append("notes", notes.trim());
    if (isCustomGame) form.append("customGame", customGame.trim());
    else form.append("gameId", gameId);
    if (allowDuplicate) form.append("allowDuplicate", "true");
    // On edit, omitted files keep the entry's current images. Images are shrunk in the browser first
    // (already started when they were picked), so only a few hundred KB go over the network.
    const withImages = Promise.all([
      file ? compressScreenshot(file) : null,
      // A screenshot picked before the cashout amount was cleared is not sent
      cashoutProof && hasCashout ? compressCashoutProof(cashoutProof) : null,
    ]).then(([shot, proof]) => {
      if (shot) form.append("screenshot", shot);
      if (proof) form.append("cashoutProof", proof);
      return form;
    });

    if (!editId) {
      // New entry: saved in the background, so the form is ready for the next one at once. Game,
      // backend username and date are kept; the rest is cleared for the next screenshot.
      const gameName = isCustomGame ? customGame.trim() : games?.find((g) => g.id === gameId)?.name || "";
      startSave({ player: player.trim(), deposit: deposit.trim(), game: gameName, gameUsername: gameUsername.trim() }, withImages);
      const name = gameUsername.trim();
      const withName = (list: string[]) => [name, ...list.filter((n) => n.toLowerCase() !== name.toLowerCase())];
      if (name) {
        setGameNames(withName);
        setAllNames(withName);
      }
      scanId.current++; // drop any scan still running for the saved screenshot
      setFile(null);
      setCashoutProof(null);
      setDeposit("");
      setLoaded("");
      setRedeemed("0");
      setCashout("");
      setCashoutMethod("");
      setNotes("");
      setPlayer("");
      setPaymentTag("");
      setPaymentMethod("");
      setErrors({});
      setAutoFilled(new Set());
      dateTouched.current = false;
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setProgress(0);
    try {
      await updatePayment(editId, await withImages, setProgress);
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
        <div ref={topRef} className="scroll-mt-20" />
        <Card title={isEdit ? "Edit Payment Entry" : "Add Payment Entry"}>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            {gamesError && <Banner>{gamesError}</Banner>}
            {!isEdit && saves.length > 0 && (
              <Banner tone={saves[0].status === "failed" ? "error" : "ok"}>
                {saves[0].status === "failed"
                  ? `Could not save ${saves[0].player}. See the list below.`
                  : `${saves[0].status === "saved" ? "Saved ✓" : "Saving"} ${saves[0].player} · $${saves[0].deposit}. Drop or paste (Ctrl+V) the next screenshot.`}
              </Banner>
            )}
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
              <Field label="Date" error={errors.date} htmlFor="pay-date" hint={<AutoBadge on={autoFilled.has("date")} />}>
                <input
                  id="pay-date"
                  type="date"
                  value={date}
                  max={toDayString(new Date())}
                  onChange={(e) => {
                    dateTouched.current = true;
                    clearAuto("date");
                    setDate(e.target.value);
                  }}
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
                  // "Custom game" works even when the list could not be loaded
                  disabled={disabled || (!gameOptions && !gamesError)}
                >
                  <option value="" disabled hidden>
                    {!gameOptions && !gamesError ? "Loading games..." : "Select a game"}
                  </option>
                  {gameOptions?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                  <option value={CUSTOM_GAME}>Custom game…</option>
                </select>
              </Field>
              {isCustomGame && (
                <div className="anim-fade">
                  <Field label="Custom Game Name" error={errors.customGame} htmlFor="pay-custom-game">
                    <input
                      id="pay-custom-game"
                      placeholder="Type the game name"
                      value={customGame}
                      maxLength={60}
                      autoComplete="off"
                      autoFocus
                      onChange={(e) => setCustomGame(e.target.value)}
                      className={inputClass}
                      disabled={disabled}
                    />
                  </Field>
                </div>
              )}
              {gameId && (
                <div className="anim-fade">
                  <Field label="Backend Username" error={errors.gameUsername} htmlFor="pay-game-username">
                    <SuggestInput
                      id="pay-game-username"
                      placeholder="Backend username used to load the points"
                      value={gameUsername}
                      maxLength={60}
                      onChange={setGameUsername}
                      suggestions={usernameSuggestions}
                      className={inputClass}
                      disabled={disabled}
                    />
                  </Field>
                </div>
              )}
              <Field label="Player" error={errors.player} htmlFor="pay-player" hint={<AutoBadge on={autoFilled.has("player")} />}>
                <input
                  id="pay-player"
                  placeholder="Name used to load points"
                  value={player}
                  maxLength={60}
                  autoComplete="off"
                  onChange={(e) => {
                    clearAuto("player");
                    setPlayer(e.target.value);
                  }}
                  className={inputClass}
                  disabled={disabled}
                />
              </Field>
              <Field
                label="Payment Method"
                error={errors.paymentMethod}
                htmlFor="pay-method"
                hint={<AutoBadge on={autoFilled.has("paymentMethod")} />}
              >
                <select
                  id="pay-method"
                  value={paymentMethod}
                  onChange={(e) => {
                    clearAuto("paymentMethod");
                    setPaymentMethod(e.target.value as PaymentMethod | "");
                  }}
                  className={inputClass}
                  disabled={disabled}
                >
                  <option value="" disabled hidden>
                    Select a payment method
                  </option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              {paymentMethod && (
                <div className="anim-fade">
                  <Field
                    label={`${paymentMethodLabel(paymentMethod)} Tag`}
                    error={errors.paymentTag}
                    htmlFor="pay-tag"
                    hint={<AutoBadge on={autoFilled.has("paymentTag")} />}
                  >
                    <input
                      id="pay-tag"
                      placeholder="Tag the money was sent to, e.g. $yourtag"
                      value={paymentTag}
                      maxLength={60}
                      autoComplete="off"
                      onChange={(e) => {
                        clearAuto("paymentTag");
                        setPaymentTag(e.target.value);
                      }}
                      className={inputClass}
                      disabled={disabled}
                    />
                  </Field>
                </div>
              )}
              <Field label="Deposit" error={errors.deposit} htmlFor="pay-deposit" hint={<AutoBadge on={autoFilled.has("deposit")} />}>
                <input
                  id="pay-deposit"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={deposit}
                  onChange={(e) => {
                    clearAuto("deposit");
                    setDeposit(e.target.value.replace(/[^\d.]/g, ""));
                  }}
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
              <Field
                label="Cashout"
                hint="If there is a cashout, enter the amount and upload the cashout screenshot"
                error={errors.cashout}
                htmlFor="pay-cashout"
              >
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
              {hasCashout && (
                <div className="anim-fade">
                  <Field label="Cashout Method" error={errors.cashoutMethod} htmlFor="pay-cashout-method">
                    <select
                      id="pay-cashout-method"
                      value={cashoutMethod}
                      onChange={(e) => setCashoutMethod(e.target.value as PaymentMethod | "")}
                      className={inputClass}
                      disabled={disabled}
                    >
                      <option value="" disabled hidden>
                        How was the cashout paid?
                      </option>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
            </div>

            <Field label="Notes (optional)" error={errors.notes} htmlFor="pay-notes" hint={`${notes.length}/${MAX_NOTES}`}>
              <textarea
                id="pay-notes"
                rows={3}
                placeholder="Anything worth remembering about this entry"
                value={notes}
                maxLength={MAX_NOTES}
                onChange={(e) => setNotes(e.target.value)}
                className={`${inputClass} resize-y`}
                disabled={disabled}
              />
            </Field>

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
                acceptPaste
                prompt="Drop, paste (Ctrl+V) or click to add the screenshot"
              />
              {!isEdit && scanning && (
                <p className="mt-2 flex items-center gap-2 text-xs text-sky-300" aria-live="polite">
                  <Spinner className="h-3 w-3" /> Reading screenshot…
                </p>
              )}
              {!isEdit && !scanning && autoFilled.size > 0 && (
                <p className="mt-2 text-xs text-sky-300" aria-live="polite">
                  Filled {autoFilled.size} field{autoFilled.size === 1 ? "" : "s"} from the screenshot. Check the ones marked “auto”.
                </p>
              )}
            </Field>

            {hasCashout && (
            <div className="anim-fade">
            <Field label="Cashout request screenshot from the player (required)" error={errors.cashoutProof}>
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
                onChange={(f) => {
                  setCashoutProof(f);
                  setErrors((prev) => ({ ...prev, cashoutProof: undefined }));
                }}
                disabled={disabled}
                maxBytes={MAX_CASHOUT_PROOF_BYTES}
                prompt="Drop the player's cashout request screenshot here or click to browse"
                hint="Required for a cashout · AVIF, JPG, PNG or WebP · max 10MB"
                tall
              />
              </Field>
            </div>
            )}

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

        {!isEdit && saves.length > 0 && (
          <Card title={`Added this session (${saves.length})`} className="mt-6">
            <SaveRows saves={saves} />
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" onClick={() => navigate("/payments")}>
                Done, view all entries
              </Button>
            </div>
          </Card>
        )}
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
