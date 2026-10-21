// Pedidos sin cobertura. Corre en el navegador del móvil: guarda en IndexedDB los datos de la cartera
// (clientes, direcciones, artículos y precios) y los pedidos hechos sin conexión, y los envía cuando vuelve la señal.
//
// - Cada pedido lleva un id propio (clientId) desde que se crea. Si la conexión se corta a mitad del envío y se
//   repite, el portal lo reconoce y no lo duplica en SAP.
// - iPhone no tiene envío en segundo plano: se reintenta al abrir la app, al volver a ella y al recuperar la red.
//   Android, además, lo envía aunque la app esté cerrada (Background Sync, ver public/sw.js).
// - Los precios guardados son orientativos: el precio que vale lo calcula el portal al recibir el pedido.

import type { Customer, OrderRequest, Product, ShipTo } from "./api";

export interface OfflinePack {
  userId: string;
  tenantId: string;
  generatedAt: string;
  /** Última sincronización correcta con SAP: la antigüedad real de precios y stock. */
  dataAt: string | null;
  products: Product[];
  customers: { customer: Customer; shipTos: ShipTo[]; prices: { materialId: string; price: number }[] }[];
  /** Cuándo se guardó en el móvil. */
  savedAt: string;
}

export type QueuedStatus = "pendiente" | "enviando" | "enviado" | "revisar";

export interface QueuedLine { materialId: string; description: string; quantity: number; unit: string; price: number; taxRate: number }

export interface QueuedOrder {
  clientId: string;
  userId: string;
  customerId: string;
  customerName: string;
  capturedAt: string;
  customerReference: string | null;
  requestedDate: string;
  shipToId: string | null;
  notes: string | null;
  lines: QueuedLine[];
  status: QueuedStatus;
  attempts: number;
  lastTryAt?: string;
  /** Lo que tiene que saber el comercial: por qué no se ha enviado o qué hay que corregir. */
  message?: string;
  sentAt?: string;
  result?: { tenantId: string; id: string };
}

export interface Draft { customerId: string; lines: Record<string, number>; customerReference: string; requestedDate: string; shipToId: string; notes: string }

const DB = "portal-offline";
const PACKS = "packs", OUTBOX = "outbox", META = "meta";
export const SYNC_TAG = "enviar-pedidos";
export const CHANGED = "portal-offline-changed";
/** A partir de aquí se avisa de que los precios y el stock pueden haber cambiado. */
export const STALE_HOURS = 24;
const KEEP_SENT_DAYS = 14;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(PACKS, { keyPath: "userId" });
      db.createObjectStore(OUTBOX, { keyPath: "clientId" });
      db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => { db.close(); resolve((req ? req.result : undefined) as T); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

const changed = () => window.dispatchEvent(new Event(CHANGED));

// Usuario con el que se abrió el portal por última vez en este móvil. Sin conexión no se puede preguntar al servidor.
export const activeUser = () => tx<string | undefined>(META, "readonly", (s) => s.get("user")).then((u) => u ?? null);
export const setActiveUser = (user: string | null) => tx(META, "readwrite", (s) => (user ? s.put(user, "user") : s.delete("user")));

export const loadPack = (user: string) => tx<OfflinePack | undefined>(PACKS, "readonly", (s) => s.get(user)).then((p) => p ?? null);
export const deletePack = (user: string) => tx(PACKS, "readwrite", (s) => s.delete(user));

export const loadDraft = (user: string) => tx<Draft | undefined>(META, "readonly", (s) => s.get(`draft:${user}`)).then((d) => d ?? null);
export const saveDraft = (user: string, d: Draft | null) => tx(META, "readwrite", (s) => (d ? s.put(d, `draft:${user}`) : s.delete(`draft:${user}`)));

async function timedFetch(url: string, init: RequestInit = {}, ms = 25_000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, cache: "no-store", credentials: "same-origin", signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

/** Descarga los datos de la cartera y los guarda en el móvil. Devuelve null si no hay conexión o sesión. */
export async function refreshPack(): Promise<OfflinePack | null> {
  let res: Response;
  try { res = await timedFetch("/api/offline", {}, 60_000); } catch { return null; }
  if (!res.ok) return null;
  const pack = { ...(await res.json()), savedAt: new Date().toISOString() } as OfflinePack;
  await tx(PACKS, "readwrite", (s) => s.put(pack));
  await setActiveUser(pack.userId);
  changed();
  return pack;
}

export const hoursOld = (iso: string | null | undefined) => (iso ? (Date.now() - Date.parse(iso)) / 36e5 : Infinity);

export function priceOf(pack: OfflinePack, customerId: string, p: Product): { price: number; special: boolean } {
  const special = pack.customers.find((c) => c.customer.erpId === customerId)?.prices.find((x) => x.materialId === p.erpId);
  return special ? { price: special.price, special: true } : { price: p.basePrice, special: false };
}

const round = (n: number) => Math.round(n * 100) / 100;
export function totals(lines: QueuedLine[]) {
  const net = lines.reduce((s, l) => s + round(l.quantity * l.price), 0);
  const tax = lines.reduce((s, l) => s + round((round(l.quantity * l.price) * l.taxRate) / 100), 0);
  return { net: round(net), tax: round(tax), total: round(net + tax) };
}

export function newClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").replace(/^(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-");
}

export async function listOrders(user: string): Promise<QueuedOrder[]> {
  const all = await tx<QueuedOrder[]>(OUTBOX, "readonly", (s) => s.getAll());
  return all.filter((o) => o.userId === user).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export const unsent = (orders: QueuedOrder[]) => orders.filter((o) => o.status !== "enviado");

const putOrder = (o: QueuedOrder) => tx(OUTBOX, "readwrite", (s) => s.put(o));

export async function deleteOrder(clientId: string) {
  await tx(OUTBOX, "readwrite", (s) => s.delete(clientId));
  changed();
}

/** Guarda el pedido en el móvil y lo intenta enviar enseguida. */
export async function queueOrder(order: Omit<QueuedOrder, "clientId" | "status" | "attempts" | "capturedAt">): Promise<QueuedOrder> {
  const q: QueuedOrder = { ...order, clientId: newClientId(), capturedAt: new Date().toISOString(), status: "pendiente", attempts: 0 };
  await putOrder(q);
  changed();
  await askBackgroundSync();
  return q;
}

export async function updateOrder(clientId: string, patch: Partial<QueuedOrder>) {
  const o = await tx<QueuedOrder | undefined>(OUTBOX, "readonly", (s) => s.get(clientId));
  if (!o) return;
  await putOrder({ ...o, ...patch });
  changed();
}

// Android (Chrome) envía la cola aunque la app esté cerrada. En iPhone no existe y no pasa nada.
async function askBackgroundSync() {
  try {
    const reg = (await navigator.serviceWorker?.ready) as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } };
    await reg?.sync?.register(SYNC_TAG);
  } catch { /* sin Background Sync: se envía al abrir la app o al volver la red */ }
}

const DRAFT_KEYS = ["customerId", "customerReference", "requestedDate", "shipToId", "notes"] as const;

type SendResult = "ok" | "offline" | "login";

async function send(o: QueuedOrder): Promise<SendResult> {
  const body = { ...Object.fromEntries(DRAFT_KEYS.map((k) => [k, o[k]])), userId: o.userId, clientId: o.clientId, capturedAt: o.capturedAt, lines: o.lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity })) };
  const tryAt = new Date().toISOString();
  await putOrder({ ...o, status: "enviando", attempts: o.attempts + 1, lastTryAt: tryAt });
  let res: Response;
  try {
    res = await timedFetch("/api/offline/pedidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    await putOrder({ ...o, status: "pendiente", attempts: o.attempts + 1, lastTryAt: tryAt, message: "Sin cobertura. Se enviará solo cuando vuelva la señal." });
    return "offline";
  }
  const data = (await res.json().catch(() => null)) as (OrderRequest & { errors?: string[]; detail?: string; error?: string }) | null;
  const base = { ...o, attempts: o.attempts + 1, lastTryAt: tryAt };
  if ((res.status === 200 || res.status === 201) && data?.id) {
    await putOrder({ ...base, status: "enviado", sentAt: new Date().toISOString(), result: { tenantId: data.tenantId, id: data.id }, message: undefined });
    return "ok";
  }
  if (res.status === 401) {
    await putOrder({ ...base, status: "pendiente", message: "Tienes que volver a entrar en el portal para enviarlo." });
    return "login";
  }
  if (res.status === 403 && data?.error === "otro-usuario") {
    await putOrder({ ...base, status: "pendiente", message: "Lo hizo otro usuario en este móvil. Se enviará cuando entre con el suyo." });
    return "ok";
  }
  if (res.status === 400) {
    const why = Array.isArray(data?.errors) ? data.errors.join(" ") : "Revisa los datos del pedido.";
    await putOrder({ ...base, status: "revisar", message: why });
    return "ok";
  }
  if (res.status === 404) {
    await putOrder({ ...base, status: "revisar", message: "Este cliente ya no aparece en tu cartera." });
    return "ok";
  }
  // 409 (se está enviando desde otra pestaña), 502 (SAP no lo ha aceptado) o error del servidor: se reintenta más tarde.
  await putOrder({ ...base, status: "pendiente", message: data?.detail ?? "El portal no ha podido recibirlo ahora. Se reintentará solo." });
  return "offline";
}

let running: Promise<void> | null = null;

/** Envía los pedidos pendientes del usuario. Se puede llamar a menudo: si ya está enviando, espera a que acabe. */
export function flushOutbox(user: string): Promise<void> {
  running ??= (async () => {
    const run = async () => {
      const orders = await listOrders(user);
      const now = Date.now();
      // "enviando" de hace rato: la app se cerró a mitad. El id evita el duplicado, así que se puede repetir.
      const due = orders.filter((o) => o.status === "pendiente" || (o.status === "enviando" && now - Date.parse(o.lastTryAt ?? o.capturedAt) > 60_000));
      for (const o of due.reverse()) {
        const r = await send(o);
        changed();
        if (r !== "ok") break;
      }
      const old = orders.filter((o) => o.status === "enviado" && hoursOld(o.sentAt) > KEEP_SENT_DAYS * 24);
      for (const o of old) await tx(OUTBOX, "readwrite", (s) => s.delete(o.clientId));
    };
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    try { await (locks ? locks.request("portal-outbox", run) : run()); }
    finally { running = null; changed(); }
  })();
  return running;
}

/** Pide al service worker que guarde la página de pedidos sin cobertura para poder abrirla sin red. */
export async function keepOfflinePage() {
  try { (await navigator.serviceWorker?.ready)?.active?.postMessage({ type: "guardar-sin-conexion" }); } catch { /* sin service worker */ }
}
