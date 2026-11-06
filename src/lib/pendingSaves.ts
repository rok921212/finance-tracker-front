import { useSyncExternalStore } from "react";
import { createPayment } from "./paymentsApi";
import { errorCode, errorMessage } from "./http";

/**
 * New entries saved in the background: the form is free for the next entry at once, and the upload
 * carries on even if the user moves to another page. A save that fails stays listed with its data,
 * so it can be retried; nothing is dropped silently.
 */
export interface EntrySave {
  key: number;
  player: string;
  deposit: string;
  game: string;
  gameUsername: string;
  at: Date;
  status: "saving" | "saved" | "failed";
  /** Set once saved */
  id?: string;
  error?: string;
  /** Failed because this screenshot was already used: it can be saved anyway */
  duplicate?: boolean;
}

let saves: EntrySave[] = []; // newest first
let nextKey = 1;
const forms = new Map<number, Promise<FormData>>(); // kept until saved, for retries
const listeners = new Set<() => void>();

const publish = (next: EntrySave[]) => {
  saves = next;
  listeners.forEach((fn) => fn());
};
const patch = (key: number, change: Partial<EntrySave>) => publish(saves.map((s) => (s.key === key ? { ...s, ...change } : s)));

const run = async (key: number, allowDuplicate = false) => {
  const pending = forms.get(key);
  if (!pending) return;
  patch(key, { status: "saving", error: undefined, duplicate: undefined });
  try {
    const form = await pending;
    if (allowDuplicate) form.set("allowDuplicate", "true");
    const res = await createPayment(form);
    forms.delete(key);
    patch(key, { status: "saved", id: res.payment.id });
  } catch (e) {
    const duplicate = errorCode(e) === "DUPLICATE_SCREENSHOT";
    patch(key, {
      status: "failed",
      duplicate,
      error: duplicate ? "You already used this screenshot." : errorMessage(e, "Could not save this entry."),
    });
  }
};

export const startSave = (entry: Pick<EntrySave, "player" | "deposit" | "game" | "gameUsername">, form: Promise<FormData>) => {
  const key = nextKey++;
  forms.set(key, form);
  publish([{ ...entry, key, at: new Date(), status: "saving" }, ...saves]);
  run(key);
};

export const retrySave = (key: number, allowDuplicate = false) => run(key, allowDuplicate);

export const dismissSave = (key: number) => {
  forms.delete(key);
  publish(saves.filter((s) => s.key !== key));
};

/** On logout: the next account must not see these. */
export const clearSaves = () => {
  forms.clear();
  publish([]);
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const useSaves = () => useSyncExternalStore(subscribe, () => saves);

// Closing or reloading the tab would lose entries that are not on the server yet
window.addEventListener("beforeunload", (e) => {
  if (saves.some((s) => s.status !== "saved")) e.preventDefault();
});
