import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Cliente de la API .NET. Solo se usa en el servidor: el navegador nunca habla directamente con la API.
// En desarrollo el usuario se identifica con la cookie del selector de usuarios de ejemplo;
// con Keycloak esta cabecera se sustituye por el token de acceso.

export const API_URL = process.env.PORTAL_API_URL ?? "http://127.0.0.1:5103";
export const USER_COOKIE = "portal_user";

export type Role = "PlatformAdmin" | "CompanyAdmin" | "SalesManager" | "SalesRep" | "Customer";
export type OrderStatus = "Abierto" | "EnPreparacion" | "Enviado" | "Entregado" | "Facturado" | "Anulado";
export type InvoiceStatus = "Pendiente" | "Vencida" | "Pagada";

export interface UserContext {
  userId: string;
  tenantId: string;
  role: Role;
  salesRepId?: string | null;
  customerIds?: string[] | null;
}

export interface Me { user: UserContext; name: string | null }

export interface Customer {
  tenantId: string;
  erpId: string;
  name: string;
  taxId?: string | null;
  address?: string | null;
  city?: string | null;
  paymentTerms?: string | null;
  creditLimit?: number | null;
  salesRepId?: string | null;
}

export interface OrderSummary {
  tenantId: string;
  id: string;
  date: string;
  customerId: string;
  customerName?: string | null;
  customerReference?: string | null;
  requestedDate?: string | null;
  status: OrderStatus;
  total: number;
  currency: string;
}

export interface OrderLine { position: number; materialId: string; description: string; quantity: number; unit: string; unitPrice: number; netAmount: number }
export interface TrackingEvent { at: string; description: string; location?: string | null }

export interface Delivery {
  tenantId: string;
  erpId: string;
  orderId: string;
  goodsIssueDate?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  packages?: number | null;
  weightKg?: number | null;
  pdfFile?: string | null;
}

export interface Invoice {
  tenantId: string;
  erpId: string;
  customerId: string;
  orderId?: string | null;
  date: string;
  dueDate: string;
  netAmount: number;
  taxAmount: number;
  total: number;
  currency: string;
  paymentMethod?: string | null;
  pdfFile?: string | null;
}

export interface InvoiceView { invoice: Invoice; status: InvoiceStatus; paidDate?: string | null }

export interface OrderView {
  order: {
    tenantId: string;
    erpId: string;
    customerId: string;
    orderDate: string;
    customerReference?: string | null;
    requestedDate?: string | null;
    incoterm?: string | null;
    currency: string;
    lines: OrderLine[];
    netAmount: number;
    taxAmount: number;
    total: number;
  };
  status: OrderStatus;
  customer?: Customer | null;
  deliveries: { delivery: Delivery; events: TrackingEvent[]; delivered: boolean }[];
  invoices: InvoiceView[];
}

export interface DeliverySummary {
  tenantId: string;
  id: string;
  orderId: string;
  customerId: string;
  customerName?: string | null;
  goodsIssueDate?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  packages?: number | null;
  weightKg?: number | null;
  delivered: boolean;
  lastEvent?: TrackingEvent | null;
}

export interface SyncInfo {
  connector: string;
  health: { ok: boolean; message: string; checkedAt: string };
  counts: { customers: number; orders: number; deliveries: number; invoices: number };
  runs: { at: string; ok: boolean; cursor?: string | null; orders: number; invoices: number; issues: { source: string; row?: number | null; message: string }[]; error?: string | null }[];
}

export interface Product {
  tenantId: string;
  erpId: string;
  description: string;
  unit: string;
  category?: string | null;
  basePrice: number;
  taxRate: number;
  stock?: number | null;
  minQuantity: number;
}

export interface CatalogItem { product: Product; price: number; specialPrice: boolean }
export interface ShipTo { tenantId: string; customerId: string; erpId: string; name: string; address: string }
export interface Catalog { customer: Customer | null; categories: string[]; items: CatalogItem[]; shipTos: ShipTo[] }

export type OrderRequestStatus = "PendienteErp" | "Creado" | "Rechazado";

export interface OrderRequest {
  tenantId: string;
  id: string;
  customerId: string;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
  customerReference?: string | null;
  requestedDate: string;
  shipTo?: ShipTo | null;
  notes?: string | null;
  currency: string;
  lines: { position: number; materialId: string; description: string; quantity: number; unit: string; unitPrice: number; netAmount: number; taxAmount: number }[];
  status: OrderRequestStatus;
  erpOrderId?: string | null;
  message?: string | null;
  netAmount: number;
  taxAmount: number;
  total: number;
}

// Ventas y comisiones: las ventas salen de SAP; reglas, objetivos y liquidaciones son datos propios del portal.

export type CommissionBasis = "Cobrado" | "Facturado";
export interface SalesRep { tenantId: string; erpId: string; name: string; email?: string | null }
export interface CommissionSettings { tenantId: string; basis: CommissionBasis; defaultRate: number; bonusRate: number }
export interface CommissionRule {
  tenantId: string;
  id: string;
  salesRepId?: string | null;
  customerId?: string | null;
  category?: string | null;
  rate: number;
  validFrom?: string | null;
  validTo?: string | null;
  note?: string | null;
}
export interface SalesTarget { tenantId: string; salesRepId: string; year: number; month: number; amount: number }
export interface CommissionSettlement { tenantId: string; salesRepId: string; year: number; month: number; base: number; commission: number; closedAt: string; closedBy: string; paidAt?: string | null }
export interface MonthFigures { month: number; invoiced: number; collected: number; base: number; commission: number; bonus: number; target?: number | null; settlement?: CommissionSettlement | null; total: number }
export interface RepSales { salesRepId: string; name: string; months: MonthFigures[]; invoiced: number; collected: number; commission: number; target?: number | null; pendingCollection: number; overdue: number }
export interface Ranked { id: string; name: string; amount: number }
export interface CommissionLine { salesRepId: string; invoiceId: string; customerId: string; customerName: string; category?: string | null; date: string; base: number; rate: number; commission: number }
export interface SalesDashboard { year: number; basis: CommissionBasis; reps: RepSales[]; months: MonthFigures[]; topCustomers: Ranked[]; categories: Ranked[]; lines: CommissionLine[] }
export interface CommissionConfig { settings: CommissionSettings; rules: CommissionRule[]; targets: SalesTarget[]; salesReps: SalesRep[]; customers: Customer[]; categories: string[] }

export async function currentUserId(): Promise<string | null> {
  return (await cookies()).get(USER_COOKIE)?.value ?? null;
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const user = await currentUserId();
  if (!user) redirect("/login");
  const res = await fetch(API_URL + path, { ...init, cache: "no-store", headers: { ...init?.headers, "X-Demo-User": user } });
  if (res.status === 401) redirect("/login");
  return res;
}

export async function apiGet<T>(path: string): Promise<T | null> {
  const res = await call(path);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`La API respondió ${res.status} en ${path}`);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string): Promise<T | null> {
  const res = await call(path, { method: "POST" });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** Envía JSON a la API y devuelve el código y el cuerpo, también en los errores (400 trae { errors }). */
export async function apiSend<T>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
  const res = await call(path, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
}

export async function apiRaw(path: string): Promise<Response> {
  return call(path);
}

export const isStaff = (r: Role) => r !== "Customer";
export const isAdmin = (r: Role) => r === "CompanyAdmin" || r === "PlatformAdmin";
