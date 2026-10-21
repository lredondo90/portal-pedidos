import { apiSend, currentUserId, type OrderRequest } from "@/lib/api";

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// Recibe un pedido que el móvil tenía guardado sin cobertura y lo pasa a la API.
// El clientId hace que repetir el envío no cree un pedido nuevo.
export async function POST(req: Request) {
  const user = await currentUserId();
  if (!user) return Response.json({ error: "sesion" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ errors: ["El pedido no se ha podido leer."] }, { status: 400 });
  // Si el móvil lo comparten dos personas, cada pedido se envía solo con la sesión de quien lo hizo.
  if (body.userId !== user) return Response.json({ error: "otro-usuario" }, { status: 403 });

  const lines = Array.isArray(body.lines) ? body.lines : [];
  const draft = {
    customerId: text(body.customerId, 20) ?? "",
    customerReference: text(body.customerReference, 35),
    requestedDate: text(body.requestedDate, 10),
    shipToId: text(body.shipToId, 20),
    notes: text(body.notes, 500),
    lines: lines.slice(0, 200).map((l: { materialId?: unknown; quantity?: unknown }) => ({ materialId: String(l?.materialId ?? ""), quantity: Number(l?.quantity) || 0 })),
    clientId: text(body.clientId, 64),
    capturedAt: text(body.capturedAt, 40),
  };
  const res = await apiSend<OrderRequest>("POST", "/api/order-requests", draft);
  return Response.json(res.data, { status: res.status, headers: { "cache-control": "no-store" } });
}
