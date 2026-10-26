import { z } from "zod";

const count = z.number().int().nonnegative();
const amount = z.number().finite().nonnegative();

export const collectionAnalyticsSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  generatedAt: z.string(),
  pending: z.object({ amount, count, unverifiedCount: count, oldestVerifiedAt: z.string().nullable() }),
  renegotiated: z.object({ amount, count, historicalCount: count }),
  received: z.object({ amount, count, unverifiedCount: count }),
  monthly: z.array(z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    pending: amount, pendingCount: count,
    renegotiated: amount, renegotiatedCount: count,
    received: amount, receivedCount: count,
  })),
  aging: z.array(z.object({ label: z.string(), amount, count })),
});

export type CollectionAnalytics = z.infer<typeof collectionAnalyticsSchema>;
export type AnalyticsMonths = 1 | 3 | 6 | 12;

export function analyticsDateRange(endMonth: string, months: AnalyticsMonths) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(endMonth) || ![1, 3, 6, 12].includes(months)) {
    throw new Error("Período inválido.");
  }
  const [year, month] = endMonth.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - months, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export function analyticsUnitCode(unit: string) {
  if (unit === "salto") return "salto_de_pirapora";
  if (unit === "todas") return null;
  return unit;
}

export function analyticsMonthLabel(month: string) {
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(`${month}-01T12:00:00Z`));
}
