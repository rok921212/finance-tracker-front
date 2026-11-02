// Pulls entry fields out of the text OCR read from a payment screenshot (Cash App, Venmo, Zelle,
// PayPal, Apple Pay, Chime). Heuristic: every field is optional and the form only fills fields that
// are still empty, marked "auto", so the user can check them.
import type { PaymentMethod } from "./paymentsApi";
import { toDayString } from "../utils/money";

export interface ReceiptFields {
  /** Plain amount for the input, e.g. "50.00" */
  amount?: string;
  /** YYYY-MM-DD */
  date?: string;
  method?: PaymentMethod;
  player?: string;
  tag?: string;
}

const METHOD_PATTERNS: [PaymentMethod, RegExp][] = [
  ["chime", /\bchime\b|chimesign|spotme/i],
  ["venmo", /\bvenmo\b/i],
  ["zelle", /\bzelle\b/i],
  ["paypal", /\bpay\s?pal\b/i],
  ["applepay", /\bapple\s*(pay|cash)\b/i],
  ["cashapp", /\bcash\s*app\b|\bcash\s*card\b|\$cashtag/i],
];

// Amounts on these lines are not the payment itself
const NOT_AMOUNT_LINE = /\b(fee|fees|balance|available|limit|reward|boost|cashback|instant transfer)\b/i;
const MONEY = /([+-])?\s*[$S]\s?(\d{1,3}(?:,\d{3})+|\d{1,7})(?:[.,](\d{2}))?(?!\d)/;
const MONEY_G = new RegExp(MONEY.source, "g");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const toAmount = (whole: string, cents?: string) => {
  const n = whole.replace(/,/g, "");
  if (!/^\d+$/.test(n) || (Number(n) === 0 && !Number(cents))) return undefined;
  return `${Number(n)}.${cents || "00"}`;
};

const findAmount = (lines: string[]): string | undefined => {
  // 1) A line that is just an amount ("$50", "+ $1,250.00"): the big headline number in every app
  for (const line of lines) {
    if (NOT_AMOUNT_LINE.test(line)) continue;
    const m = line.trim().match(new RegExp(`^${MONEY.source}$`));
    // Only accept "S50" (a misread $) on a line of its own
    if (m) {
      const a = toAmount(m[2], m[3]);
      if (a) return a;
    }
  }
  // 2) First "$" amount anywhere else (never an "S" lookalike inside text)
  for (const line of lines) {
    if (NOT_AMOUNT_LINE.test(line)) continue;
    for (const m of Array.from(line.matchAll(MONEY_G))) {
      if (!m[0].includes("$")) continue;
      const a = toAmount(m[2], m[3]);
      if (a) return a;
    }
  }
  return undefined;
};

/** A date no later than `now`: a month/day without a year that would be in the future means last year. */
const pastDate = (y: number | undefined, month: number, dayOfMonth: number, now: Date): string | undefined => {
  if (month < 0 || month > 11 || dayOfMonth < 1 || dayOfMonth > 31) return undefined;
  let year = y ?? now.getFullYear();
  if (year < 100) year += 2000;
  let d = new Date(year, month, dayOfMonth);
  if (d.getMonth() !== month) return undefined; // e.g. Feb 31
  if (y == null && d.getTime() > now.getTime() + 86400000) d = new Date(year - 1, month, dayOfMonth);
  if (d.getTime() > now.getTime() + 86400000) return undefined;
  return toDayString(d);
};

const findDate = (text: string, now: Date): string | undefined => {
  const named = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i);
  if (named) {
    const d = pastDate(named[3] ? Number(named[3]) : undefined, MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()), Number(named[2]), now);
    if (d) return d;
  }
  // "31 Oct 2026"
  const dayFirst = text.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/i);
  if (dayFirst) {
    const d = pastDate(Number(dayFirst[3]), MONTHS.indexOf(dayFirst[2].toLowerCase()), Number(dayFirst[1]), now);
    if (d) return d;
  }
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = pastDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), now);
    if (d) return d;
  }
  // US style 10/31/26 or 10/31/2026
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (us) {
    const d = pastDate(Number(us[3]), Number(us[1]) - 1, Number(us[2]), now);
    if (d) return d;
  }
  if (/\btoday\b/i.test(text)) return toDayString(now);
  if (/\byesterday\b/i.test(text)) return toDayString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  // Venmo/Cash App recent activity: "5m", "2h", "just now" -> today
  if (/\b(just now|\d{1,2}\s?(m|min|mins|h|hr|hrs) ago)\b/i.test(text)) return toDayString(now);
  return undefined;
};

// Capitalised words on one line (a name never continues onto the next line)
const NAME = "([A-Z][A-Za-z'.-]*(?:[ \\t]+[A-Z][A-Za-z'.-]*){0,3})";
const NOT_A_NAME = /^(you|your|bank|cash|card|balance|account|chime|venmo|zelle|paypal|apple|today|yesterday|me|the)$/i;

const cleanName = (s?: string) => {
  const name = (s || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name || name.length < 2 || NOT_A_NAME.test(name.split(" ")[0])) return undefined;
  return name;
};

const findPlayer = (text: string): string | undefined => {
  const patterns = [
    new RegExp(`\\bfrom[ \\t]*:?[ \\t]+${NAME}`),
    new RegExp(`(?:^|\\n)[ \\t]*${NAME}[ \\t]+(?:paid|sent)[ \\t]+you\\b`),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    const name = cleanName(m?.[1]);
    if (name) return name;
  }
  return undefined;
};

const HANDLE = "(\\$[A-Za-z][\\w-]{1,20}|@[A-Za-z0-9][\\w-]{2,30})";

const findTag = (text: string): string | undefined => {
  // The account the money went to: "To $tag", "Paid to @handle", "Sent to $tag"
  const to = text.match(new RegExp(`\\bto\\s*:?\\s*${HANDLE}`, "i"));
  if (to) return to[1];
  const any = text.match(new RegExp(HANDLE));
  return any ? any[1] : undefined;
};

export const parseReceipt = (text: string, now: Date = new Date()): ReceiptFields => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const joined = lines.join("\n");
  const out: ReceiptFields = {};

  const method = METHOD_PATTERNS.find(([, re]) => re.test(joined))?.[0] ?? (/\$[A-Za-z][\w-]{1,20}/.test(joined) ? "cashapp" : undefined);
  if (method) out.method = method;
  const amount = findAmount(lines);
  if (amount) out.amount = amount;
  const date = findDate(joined, now);
  if (date) out.date = date;
  const player = findPlayer(joined);
  if (player) out.player = player;
  const tag = findTag(joined);
  if (tag) out.tag = tag;
  return out;
};
