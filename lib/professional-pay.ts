import type { ProfessionalAttendancePriceItem, ProfessionalAttendanceStatus, ProfessionalServiceKind } from "@/lib/supabase/database.types";

export const attendanceLabels: Record<ProfessionalAttendanceStatus, string> = {
  pending: "Pendente",
  validated: "A pagar",
  paid: "Pago",
  cancelled: "Cancelado",
};

export const serviceLabels: Record<ProfessionalServiceKind, string> = {
  daily: "Diária comum",
  planning: "Planejamento",
  saturday: "Diária de sábado",
  procedure: "Por procedimento",
  delivery: "Por entrega",
  fixed_day: "Valor fixo por serviço do dia",
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", dateStyle: "short" });
const dayLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", weekday: "short" });
export const MAX_PAY_CENTS = 2_147_483_647;

export const formatPayAmount = (cents: number) => currency.format(cents / 100);
export const payToday = () => localDate.format(new Date());
export const formatAttendanceDay = (date: string) => dayLabel.format(new Date(date + "T12:00:00Z"));

export function payMonthDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: days }, (_, index) => month + "-" + String(index + 1).padStart(2, "0"));
}

export function payCents(input: string) {
  const value = input.trim();
  if (!/^(?:\d{1,8}|\d{1,3}(?:\.\d{3}){1,2})(?:,\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(",");
  const cents = Number(whole.replaceAll(".", "")) * 100 + Number(fraction.padEnd(2, "0"));
  return cents > 0 && cents <= MAX_PAY_CENTS ? cents : null;
}

export function pricedAttendanceTotal(items: ProfessionalAttendancePriceItem[]) {
  return items.reduce((total, item) => total + item.unit_cents * item.quantity, 0);
}

export function isAttendanceSaturday(date: string) {
  return new Date(date + "T12:00:00Z").getUTCDay() === 6;
}
