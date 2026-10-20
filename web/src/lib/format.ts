import type { InvoiceStatus, OrderRequestStatus, OrderStatus } from "./api";

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

export const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
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

export const REQUEST_LABEL: Record<OrderRequestStatus, string> = { PendienteErp: "Pendiente de SAP", Creado: "Creado en SAP", Rechazado: "Rechazado" };
export const REQUEST_PILL: Record<OrderRequestStatus, string> = { PendienteErp: "p-prep", Creado: "p-done", Rechazado: "p-bad" };

export const cantidad = (n: number) => Number(n).toLocaleString("es-ES", { maximumFractionDigits: 3 });

export function manana(): string {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Primer día laborable a partir de mañana más `dias` laborables: fecha de entrega propuesta por defecto. */
export function diaLaborable(dias: number, desde = new Date()): string {
  const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  let n = 0;
  while (n < dias) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) n++;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const pctFmt = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
export const porcentaje = (n: number | null | undefined) => (n == null ? "" : `${pctFmt.format(n)} %`);

/** Importe sin decimales, para gráficos y totales grandes. */
export const eurRedondo = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
