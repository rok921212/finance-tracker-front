import { parseReceipt } from "./parseReceipt";

const NOW = new Date(2026, 10, 2, 15, 0); // Nov 2, 2026

describe("parseReceipt", () => {
  test("Cash App payment", () => {
    const text = `Cash App
$50
Payment from John Smith
To $LuckyTag
Oct 31, 2026 at 4:12 PM
Completed`;
    expect(parseReceipt(text, NOW)).toEqual({ method: "cashapp", amount: "50.00", date: "2026-10-31", player: "John Smith", tag: "$LuckyTag" });
  });

  test("Venmo with a fee line and no year", () => {
    const text = `venmo
Maria Lopez paid you
+ $1,250.00
Fee $0.00
Nov 1
@gamehouse-pay`;
    expect(parseReceipt(text, NOW)).toEqual({ method: "venmo", amount: "1250.00", date: "2026-11-01", player: "Maria Lopez", tag: "@gamehouse-pay" });
  });

  test("Zelle numeric date, 'sent you'", () => {
    const text = `Zelle
Alex Ray sent you $75.50
10/30/26`;
    const r = parseReceipt(text, NOW);
    expect(r).toMatchObject({ method: "zelle", amount: "75.50", date: "2026-10-30", player: "Alex Ray" });
  });

  test("Chime, yesterday, balance ignored", () => {
    const text = `Chime
Available balance $900.00
Received from Tom Hanks
$20.00
Yesterday`;
    expect(parseReceipt(text, NOW)).toMatchObject({ method: "chime", amount: "20.00", date: "2026-11-01", player: "Tom Hanks" });
  });

  test("Apple Pay / PayPal detection; month without year in the future means last year", () => {
    expect(parseReceipt("Apple Cash\n$10\nDec 30", NOW)).toMatchObject({ method: "applepay", amount: "10.00", date: "2025-12-30" });
    expect(parseReceipt("PayPal\nYou received $15.00\n2026-10-01", NOW)).toMatchObject({ method: "paypal", amount: "15.00", date: "2026-10-01" });
  });

  test("garbage text gives nothing", () => {
    expect(parseReceipt("lorem ipsum", NOW)).toEqual({});
  });
});
