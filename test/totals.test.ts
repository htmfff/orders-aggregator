import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: "2026-02-09", total: 0, gross: 0, discount: 0, net: 0 },
      { date: "2026-02-10", total: 1000, gross: 1000, discount: 0, net: 1000 },
      { date: "2026-02-11", total: 349, gross: 349, discount: 0, net: 349 },
    ]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 500, gross: 500, discount: 0, net: 500 }]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 800, gross: 800, discount: 0, net: 800 }]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });

  it("считает gross, net и discount по amountPaid; total = gross", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1000, amountPaid: 850, discountPercent: 15 }));
    await postWebhook(ctx.app, apiOrder({ amount: "500.00", amountPaid: "412.50", discountPercent: 17.5 }));
    // Заказ старого формата: поля скидки нет, значит скидки не было
    await postWebhook(ctx.app, apiOrder({ amount: 99 }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([
      { date: "2026-02-10", total: 1599, gross: 1599, discount: 237.5, net: 1361.5 },
    ]);
  });

  it("суммы в копейках, без ошибок округления", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 0.29, amountPaid: 0.1 }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([
      { date: "2026-02-10", total: 0.29, gross: 0.29, discount: 0.19, net: 0.1 },
    ]);
  });

  it("учитывает переход на летнее время: дата считается по смещению в момент заказа", async () => {
    ctx.api.customers.set("c_7", "Europe/Berlin");
    // 29.03.2026 в 01:00 UTC Europe/Berlin переходит с UTC+1 на UTC+2
    await postWebhook(ctx.app, apiOrder({ customerId: "c_7", amount: 1000, createdAt: "2026-03-28T23:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ customerId: "c_7", amount: 2000, createdAt: "2026-03-29T12:00:00Z" }));
    await postWebhook(ctx.app, apiOrder({ customerId: "c_7", amount: 3000, createdAt: "2026-03-29T22:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ customerId: "c_7", amount: 4000, createdAt: "2026-03-30T22:30:00Z" }));

    const res = await dailyTotals(ctx.app, "c_7", "2026-03-28", "2026-03-31");
    expect(res.json()).toEqual([
      { date: "2026-03-28", total: 0, gross: 0, discount: 0, net: 0 },
      { date: "2026-03-29", total: 3000, gross: 3000, discount: 0, net: 3000 },
      { date: "2026-03-30", total: 3000, gross: 3000, discount: 0, net: 3000 },
      { date: "2026-03-31", total: 4000, gross: 4000, discount: 0, net: 4000 },
    ]);
  });
});
