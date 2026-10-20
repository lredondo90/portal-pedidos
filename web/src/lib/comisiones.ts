"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { apiSend } from "./api";

// Acciones de administración sobre comisiones. La API comprueba el rol: un comercial recibe 403.

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => Number(text(f, k).replace(",", "."));

async function send(method: "POST" | "PUT" | "DELETE", path: string, body: unknown, back: string) {
  const res = await apiSend<{ errors?: string[] }>(method, path, body);
  revalidatePath("/ventas");
  revalidatePath("/comisiones");
  if (res.status >= 400) {
    const error = res.data?.errors?.join(" ") ?? "No se ha podido guardar. Revisa los datos.";
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);
  }
  redirect(back);
}

export async function saveSettings(f: FormData) {
  await send("PUT", "/api/commissions/settings", { tenantId: "", basis: text(f, "basis"), defaultRate: num(f, "defaultRate"), bonusRate: num(f, "bonusRate") }, "/comisiones?ok=ajustes");
}

export async function saveRule(f: FormData) {
  await send("POST", "/api/commissions/rules", {
    id: text(f, "id") || null,
    salesRepId: text(f, "salesRepId") || null,
    customerId: text(f, "customerId") || null,
    category: text(f, "category") || null,
    rate: num(f, "rate"),
    validFrom: text(f, "validFrom") || null,
    validTo: text(f, "validTo") || null,
    note: text(f, "note") || null,
  }, "/comisiones?ok=regla");
}

export async function deleteRule(f: FormData) {
  await send("DELETE", `/api/commissions/rules/${encodeURIComponent(text(f, "id"))}`, undefined, "/comisiones?ok=borrada");
}

export async function saveTarget(f: FormData) {
  const month = text(f, "month");
  await send("PUT", "/api/commissions/targets", { salesRepId: text(f, "salesRepId"), year: num(f, "year"), month: month ? Number(month) : null, amount: num(f, "amount") },
    `/comisiones?anio=${num(f, "year")}&ok=objetivo`);
}

const settlementBack = (f: FormData) => {
  const back = text(f, "back");
  return back.startsWith("/") && !back.startsWith("//") ? back : "/ventas";
};

export async function closeMonth(f: FormData) {
  await send("POST", "/api/commissions/settlements", { salesRepId: text(f, "rep"), year: num(f, "year"), month: num(f, "month") }, settlementBack(f));
}

export async function reopenMonth(f: FormData) {
  await send("DELETE", `/api/commissions/settlements/${encodeURIComponent(text(f, "rep"))}/${num(f, "year")}/${num(f, "month")}`, undefined, settlementBack(f));
}

export async function markPaid(f: FormData) {
  await send("POST", `/api/commissions/settlements/${encodeURIComponent(text(f, "rep"))}/${num(f, "year")}/${num(f, "month")}/paid`, {}, settlementBack(f));
}
