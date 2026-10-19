import { apiRaw } from "@/lib/api";

// Pasa el PDF de la API al navegador. La API comprueba que el usuario puede ver ese documento.
export async function GET(_req: Request, ctx: RouteContext<"/documentos/[tenant]/[kind]/[id]">) {
  const { tenant, kind, id } = await ctx.params;
  if (kind !== "Invoice" && kind !== "DeliveryNote") return new Response("Documento no válido", { status: 400 });
  const res = await apiRaw(`/api/documents/${encodeURIComponent(tenant)}/${kind}/${encodeURIComponent(id)}`);
  if (!res.ok) return new Response("Este documento todavía no está disponible.", { status: res.status === 404 ? 404 : 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(res.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": res.headers.get("content-disposition") ?? `inline; filename="${id}.pdf"`,
    },
  });
}
