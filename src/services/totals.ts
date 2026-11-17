import type { OrdersRepository } from "../repositories/orders.js";
import { fromKop } from "../utils/money.js";
import { dateInTimeZone, datesBetween } from "../utils/time.js";
import type { CustomersService } from "./customers.js";

export interface DailyTotal {
  date: string;
  total: number;
  gross: number;
  discount: number;
  net: number;
}

const DAY = 86_400_000;

export class TotalsService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly customers: CustomersService,
  ) {}

  /**
   * Сумма оплаченных заказов клиента по дням в его таймзоне, from..to включительно.
   * Дни без оплат — с нулём.
   */
  async daily(customerId: string, from: string, to: string): Promise<DailyTotal[]> {
    const timezone = await this.customers.timezone(customerId);

    // Смещения таймзон в пределах ±14 ч: берём с запасом в сутки с каждой стороны
    const rows = await this.orders.paidCreatedBetween(
      customerId,
      new Date(Date.parse(`${from}T00:00:00Z`) - DAY),
      new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY),
    );

    const dates = datesBetween(from, to);
    const gross = new Map(dates.map((d) => [d, 0]));
    const net = new Map(dates.map((d) => [d, 0]));
    for (const o of rows) {
      // DST: смещение надо брать на момент creation заказа. Фиксированное смещение
      // «на сейчас» раскладывает заказы вокруг перевода часов по неверным дням.
      const date = dateInTimeZone(o.createdAt, timezone);
      const g = gross.get(date);
      const n = net.get(date);
      if (g !== undefined && n !== undefined) {
        gross.set(date, g + o.amountKop);
        net.set(date, n + o.amountPaidKop);
      }
    }
    return dates.map((date) => {
      const g = gross.get(date)!;
      const n = net.get(date)!;
      return {
        date,
        total: fromKop(g),
        gross: fromKop(g),
        discount: fromKop(g - n),
        net: fromKop(n),
      };
    });
  }
}
