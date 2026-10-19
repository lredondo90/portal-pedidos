import Link from "next/link";
import { OrdersTable } from "@/components/OrdersTable";
import { PageHeader } from "@/components/Pills";
import { apiGet, isStaff, type Customer, type Me, type OrderStatus, type OrderSummary } from "@/lib/api";
import { ORDER_LABEL, STEPS } from "@/lib/format";

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
  const [me, orders, customers] = await Promise.all([
    apiGet<Me>("/api/me"),
    apiGet<OrderSummary[]>(`/api/orders?${qs}`),
    apiGet<Customer[]>("/api/customers"),
  ]);
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
      <PageHeader title="Pedidos" sub={`Pedidos de venta${staff ? " de tus clientes" : ""}, con su estado en SAP`} />
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
