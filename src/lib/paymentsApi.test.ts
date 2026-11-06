import http from "./http";
import { clearCache, peekCached } from "./cache";
import { createPayment, getMyPayments, getMySummary, myPaymentsParams, Paged, PaymentRow, updatePayment } from "./paymentsApi";

jest.mock("./http", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));

const api = http as unknown as { get: jest.Mock; post: jest.Mock; patch: jest.Mock };
const DEP = "payments:u:1";
const row = (id: string, date: string, player = id) => ({ id, date, player, deposit: 100 } as unknown as PaymentRow);
const list = () => peekCached<Paged<PaymentRow>>("/payments", myPaymentsParams(1));
const written = (payment: PaymentRow, version: number) => ({
  data: { message: "ok", payment },
  headers: { "x-data-versions": `payments=${version},${DEP}=${version}` },
});

// Loads the default list and the summary into the cache at data version 5
const seed = async (items: PaymentRow[], total = items.length) => {
  const headers = { "x-cache-versions": `${DEP}=5,games=1` };
  api.get.mockImplementation(async (url: string) => ({
    status: 200,
    headers,
    data: url === "/payments" ? { items, total, page: 1, pages: 1 } : { totalDeposit: 0 },
  }));
  await getMyPayments(1);
  await getMySummary();
  api.get.mockClear();
};

beforeEach(() => {
  clearCache();
  jest.clearAllMocks();
});

describe("own writes patch the list instead of reloading it", () => {
  test("a new entry is added to the cached list, and only the totals are dropped", async () => {
    await seed([row("a", "2026-11-05"), row("b", "2026-11-04")]);
    api.post.mockResolvedValue(written(row("new", "2026-11-05"), 6));

    await createPayment(new FormData());

    expect(list()?.items.map((r) => r.id)).toEqual(["new", "a", "b"]);
    expect(list()?.total).toBe(3);
    expect(peekCached("/payments/summary")).toBeUndefined();
    expect(api.get).not.toHaveBeenCalled();
  });

  test("a new entry older than the whole page still counts in the total", async () => {
    const full = Array.from({ length: 18 }, (_, i) => row(`r${i}`, "2026-11-05"));
    await seed(full, 18);
    api.post.mockResolvedValue(written(row("old", "2026-01-01"), 6));

    await createPayment(new FormData());

    expect(list()?.items).toHaveLength(18);
    expect(list()?.items.some((r) => r.id === "old")).toBe(false);
    expect(list()?.total).toBe(19);
    expect(list()?.pages).toBe(2);
  });

  test("an edit replaces its row in place", async () => {
    await seed([row("a", "2026-11-05"), row("b", "2026-11-04")]);
    api.patch.mockResolvedValue(written(row("b", "2026-11-04", "renamed"), 6));

    await updatePayment("b", new FormData());

    expect(list()?.items.map((r) => r.player)).toEqual(["a", "renamed"]);
  });

  test("an edit that moves the entry to another day drops the list, since its order changed", async () => {
    await seed([row("a", "2026-11-05"), row("b", "2026-11-04")]);
    api.patch.mockResolvedValue(written(row("b", "2026-11-06"), 6));

    await updatePayment("b", new FormData());

    expect(list()).toBeUndefined();
  });

  test("a write without data versions can't be trusted to leave the list current", async () => {
    await seed([row("a", "2026-11-05")]);
    api.post.mockResolvedValue({ data: { message: "ok", payment: row("new", "2026-11-05") }, headers: {} });

    await createPayment(new FormData());

    expect(list()).toBeUndefined();
  });
});
