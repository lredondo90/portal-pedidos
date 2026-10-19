import type { InvoiceStatus, OrderStatus } from "./api";

const eurFmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
export const eur = (n: number | null | undefined) => (n == null ? "" : eurFmt.format(n));

// Las fechas de la API llegan como AAAA-MM-DD (DateOnly) o ISO con hora. Se leen sin zona horaria
// para que el día no cambie al formatear.
const parts = (d: string) => d.slice(0, 10).split("-").map(Number);

export function fecha(d: string | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = parts(d);
  return `${String(day).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
export function fechaCorta(d: string | null | undefined): string {
  if (!d) return "";
  const [, m, day] = parts(d);
  return `${day} ${MESES[m - 1]}`;
}

export const hora = (d: string) => d.slice(11, 16);

export function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(...(parts(desde) as [number, number, number]));
  const b = Date.UTC(...(parts(hasta) as [number, number, number]));
  return Math.round((b - a) / 864e5);
}

export function hoy(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export const STEPS: OrderStatus[] = ["Abierto", "EnPreparacion", "Enviado", "Entregado", "Facturado"];

export const ORDER_LABEL: Record<OrderStatus, string> = {
  Abierto: "Abierto",
  EnPreparacion: "En preparación",
  Enviado: "Enviado",
  Entregado: "Entregado",
  Facturado: "Facturado",
  Anulado: "Anulado",
};

export const ORDER_PILL: Record<OrderStatus, string> = {
  Abierto: "p-open",
  EnPreparacion: "p-prep",
  Enviado: "p-ship",
  Entregado: "p-done",
  Facturado: "p-inv",
  Anulado: "p-bad",
};

export const INVOICE_PILL: Record<InvoiceStatus, string> = { Pendiente: "p-prep", Vencida: "p-bad", Pagada: "p-done" };
