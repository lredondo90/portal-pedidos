import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OrdersTable } from "@/components/OrdersTable";
import { PageHeader, RequestPill } from "@/components/Pills";
import { apiGet, isStaff, type Customer, type Me, type OrderRequest, type OrderStatus, type OrderSummary } from "@/lib/api";
import { eur, fecha, ORDER_LABEL, STEPS } from "@/lib/format";

const FILTERS: (OrderStatus | "")[] = ["", ...STEPS, "Anulado"];

export default async function PedidosPage({ searchParams }: PageProps<"/pedidos">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = one(sp.estado) as OrderStatus | "";
  const q = one(sp.q);
  const customer = one(sp.cliente);

  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (q) qs.set("q", q);
  if (customer) qs.set("customer", customer);
  const [me, orders, customers, requests] = await Promise.all([
    apiGet<Me>("/api/me"),
    apiGet<OrderSummary[]>(`/api/orders?${qs}`),
    apiGet<Customer[]>("/api/customers"),
    apiGet<OrderRequest[]>(`/api/order-requests${customer ? `?customer=${encodeURIComponent(customer)}` : ""}`),
  ]);
  // Pedidos del portal que SAP aún no ha creado (o ha rechazado). Los creados ya salen en la lista normal.
  const waiting = (requests ?? []).filter((r) => r.status !== "Creado");
  const names = new Map((customers ?? []).map((c) => [c.erpId, c.name]));
  const staff = isStaff(me!.user.role);
  const os = orders ?? [];
  const link = (estado: string) => {
    const p = new URLSearchParams();
    if (estado) p.set("estado", estado);
    if (q) p.set("q", q);
    if (customer) p.set("cliente", customer);
    const s = p.toString();
    return s ? `/pedidos?${s}` : "/pedidos";
  };

  return (
    <>
      <AutoRefresh />
      <PageHeader title="Pedidos" sub={`Pedidos de venta${staff ? " de tus clientes" : ""}, con su estado en SAP`}>
        <Link className="btn primary" href={customer ? `/catalogo?cliente=${customer}` : "/catalogo"}>Hacer un pedido</Link>
      </PageHeader>
      {waiting.length > 0 && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-h"><h2>Enviados desde el portal</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pedido</th><th>Enviado</th>{staff && <th>Cliente</th>}<th className="hide-m">Su referencia</th><th>Estado</th><th className="r">Importe</th></tr></thead>
              <tbody>
                {waiting.map((r) => (
                  <tr key={r.tenantId + r.id}>
                    <td><Link className="link mono" href={`/pedidos-web/${r.tenantId}/${r.id}`}>{r.id}</Link></td>
                    <td className="num">{fecha(r.createdAt)}</td>
                    {staff && <td>{names.get(r.customerId) ?? r.customerId}</td>}
                    <td className="hide-m mono">{r.customerReference}</td>
                    <td><RequestPill status={r.status} /></td>
                    <td className="r num">{eur(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-h" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
          <form className="toolbar" action="/pedidos">
            {status && <input type="hidden" name="estado" value={status} />}
            <input id="q" name="q" className="search" type="search" defaultValue={q} placeholder="Buscar por nº de pedido, su referencia, material o cliente" />
            {staff && (
              <select id="cliente" name="cliente" className="search" style={{ flex: "0 1 260px" }} defaultValue={customer} aria-label="Filtrar por cliente">
                <option value="">Todos los clientes</option>
                {(customers ?? []).map((c) => <option key={c.erpId} value={c.erpId}>{c.name}</option>)}
              </select>
            )}
            <button className="btn" type="submit">Buscar</button>
          </form>
          <div className="chips" role="group" aria-label="Estado">
            {FILTERS.map((s) => (
              <Link key={s || "todos"} className="chip" href={link(s)} aria-current={status === s ? "true" : undefined}>{s ? ORDER_LABEL[s] : "Todos"}</Link>
            ))}
          </div>
        </div>
        <OrdersTable orders={os} showCustomer={staff} />
        <div className="panel-b sub">{os.length} pedido{os.length === 1 ? "" : "s"}</div>
      </section>
    </>
  );
}
