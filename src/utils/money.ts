const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/;

export const isValidAmount = (value: string): boolean => AMOUNT_RE.test(value.trim());

/** "450.5" -> 45050 using string math only (no floating point). */
export const parseToCents = (value: string): number | null => {
  const str = value.trim();
  if (!AMOUNT_RE.test(str)) return null;
  const [whole, frac = ""] = str.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
};

/** 45050 -> "450.50" with thousands separators. */
export const formatCents = (cents: number): string => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100).toLocaleString("en-US");
  return `${sign}${whole}.${String(abs % 100).padStart(2, "0")}`;
};

/** Payment dates are stored as UTC midnight; format them without timezone drift. */
export const formatDay = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });

/** Local calendar day as YYYY-MM-DD. */
export const toDayString = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
