import { apiRaw, currentUserId } from "@/lib/api";

// Datos de la cartera para guardarlos en el móvil (pedidos sin cobertura). La API solo devuelve lo que el usuario puede ver.
export async function GET() {
  if (!(await currentUserId())) return Response.json({ error: "sesion" }, { status: 401 });
  const res = await apiRaw("/api/offline-pack");
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
