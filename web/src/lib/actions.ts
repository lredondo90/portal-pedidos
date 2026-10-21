"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { USER_COOKIE, apiPost, apiSend, type OrderRequest } from "./api";
import { readCart, writeCart } from "./cart";

const DEMO_USERS = ["ana", "laura", "javier", "marta"];

export async function loginDemo(formData: FormData) {
  const user = String(formData.get("user") ?? "");
  if (!DEMO_USERS.includes(user)) redirect("/login");
  // Persistente: en el móvil la app se cierra a menudo y los pedidos guardados sin cobertura necesitan la sesión para salir.
  (await cookies()).set(USER_COOKIE, user, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(USER_COOKIE);
  redirect("/login");
}

export async function runSync() {
  await apiPost("/api/sync");
  revalidatePath("/sincronizacion");
}

// Solo se vuelve a rutas internas del portal.
const local = (v: FormDataEntryValue | null, fallback: string) => {
  const s = String(v ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
};

const qty = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : 0;
};

const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

export async function addToCart(formData: FormData) {
  const customer = String(formData.get("customer") ?? "");
  const material = String(formData.get("material") ?? "");
  const n = qty(formData.get("qty"));
  const back = local(formData.get("back"), "/catalogo");
  if (!customer || !material || !n) redirect(back);
  const cart = await readCart();
  // Un carrito es de un solo cliente: si el comercial cambia de cliente, empieza uno nuevo.
  const lines = cart.customerId === customer ? cart.lines : {};
  lines[material] = (lines[material] ?? 0) + n;
  await writeCart({ customerId: customer, lines });
  redirect(withParam(back, "anadido", material));
}

export async function updateCartLine(formData: FormData) {
  const material = String(formData.get("material") ?? "");
  const cart = await readCart();
  if (material in cart.lines) {
    cart.lines[material] = formData.get("remove") ? 0 : qty(formData.get("qty"));
    await writeCart(cart);
  }
  redirect("/carrito");
}

export async function clearCart() {
  await writeCart({ customerId: null, lines: {} });
  redirect("/catalogo");
}

export async function placeOrder(formData: FormData) {
  const cart = await readCart();
  if (!cart.customerId || Object.keys(cart.lines).length === 0) redirect("/carrito");
  const field = (k: string) => String(formData.get(k) ?? "").trim();
  const draft = {
    customerId: cart.customerId,
    customerReference: field("reference") || null,
    requestedDate: field("date"),
    shipToId: field("shipTo") || null,
    notes: field("notes") || null,
    lines: Object.entries(cart.lines).map(([materialId, quantity]) => ({ materialId, quantity })),
  };
  const res = await apiSend<OrderRequest & { errors?: unknown; detail?: string }>("POST", "/api/order-requests", draft);
  if (res.status === 201 && res.data) {
    await writeCart({ customerId: null, lines: {} });
    redirect(`/pedidos-web/${encodeURIComponent(res.data.tenantId)}/${encodeURIComponent(res.data.id)}?nuevo=1`);
  }
  // Se devuelven los datos del formulario para no obligar a escribirlos otra vez.
  // Los errores de negocio llegan como lista; si el JSON no se puede leer (p. ej. una fecha vacía) ASP.NET devuelve otro formato.
  const errors = Array.isArray(res.data?.errors) ? (res.data!.errors as string[]).join(" ") : null;
  const error = errors ?? (res.status === 502 ? res.data?.detail : null) ?? (res.status === 400 ? "Revisa los datos del pedido." : "No se ha podido enviar el pedido a SAP. Inténtalo de nuevo en unos minutos.");
  const p = new URLSearchParams({ error, ref: draft.customerReference ?? "", fecha: draft.requestedDate, destino: draft.shipToId ?? "", obs: draft.notes ?? "" });
  redirect(`/carrito?${p}`);
}
