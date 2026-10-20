import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OrdersTable } from "@/components/OrdersTable";
import { OrderPill, PageHeader } from "@/components/Pills";
import { apiGet, isStaff, type Customer, type InvoiceView, type Me, type OrderSummary } from "@/lib/api";
import { eur, fechaCorta } from "@/lib/format";

export default async function ResumenPage() {
  const [me, orders, invoices, customers] = await Promise.all([
    apiGet<Me>("/api/me"),
    apiGet<OrderSummary[]>("/api/orders"),
    apiGet<InvoiceView[]>("/api/invoices"),
    apiGet<Customer[]>("/api/customers"),
  ]);
  const os = orders ?? [], inv = invoices ?? [], cs = customers ?? [];
  const staff = isStaff(me!.user.role);
  const sum = (a: InvoiceView[]) => a.reduce((s, i) => s + i.invoice.total, 0);
  const open = os.filter((o) => o.status === "Abierto" || o.status === "EnPreparacion");
  const transit = os.filter((o) => o.status === "Enviado");
  const pending = inv.filter((i) => i.status !== "Pagada");
  const late = inv.filter((i) => i.status === "Vencida");
  const upcoming = os.filter((o) => o.status === "EnPreparacion" || o.status === "Enviado").slice(0, 5);

  let sub: string;
  if (!staff) sub = cs[0] ? `${cs[0].name} · cliente ${cs[0].erpId}` : "";
  else sub = `${cs.length} cliente${cs.length === 1 ? "" : "s"}`;

  return (
    <>
      <AutoRefresh />
      <PageHeader title={staff ? "Visión general" : `Hola, ${me!.name?.split(" ")[0] ?? ""}`} sub={sub} />
      <div className="grid kpis">
        <div className="kpi"><span className="label">Pedidos abiertos</span><span className="v num">{open.length}</span><span className="s">{eur(open.reduce((s, o) => s + o.total, 0))}</span></div>
        <div className="kpi"><span className="label">En camino</span><span className="v num">{transit.length}</span><span className="s">{transit.length ? "Con seguimiento en Entregas" : "Nada en tránsito"}</span></div>
        <div className="kpi"><span className="label">Facturas pendientes</span><span className="v num">{pending.length}</span><span className="s">{eur(sum(pending))}</span></div>
        <div className={`kpi ${late.length ? "alert" : ""}`}><span className="label">Vencido</span><span className="v num">{eur(sum(late))}</span><span className="s">{late.length} factura{late.length === 1 ? "" : "s"}</span></div>
      </div>
      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="grid" style={{ alignContent: "start" }}>
          <section className="panel">
            <div className="panel-h"><h2>En curso</h2><Link className="btn sm" href="/entregas">Ver entregas</Link></div>
            <div className="list">
              {upcoming.length ? upcoming.map((o) => (
                <div className="li" key={o.id}>
                  <div style={{ minWidth: 0 }}>
                    <Link className="link mono" href={`/pedidos/${o.tenantId}/${o.id}`}>{o.id}</Link> <OrderPill status={o.status} />
                    <div className="sub">{staff ? `${o.customerName} · ` : ""}Fecha solicitada {fechaCorta(o.requestedDate)}</div>
                  </div>
                  <b className="num">{eur(o.total)}</b>
                </div>
              )) : <div className="empty">No hay pedidos en preparación ni en camino.</div>}
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Últimos pedidos</h2><Link className="btn sm" href="/pedidos">Ver todos</Link></div>
            <OrdersTable orders={os.slice(0, 6)} showCustomer={staff} compact />
          </section>
        </div>
        <div className="grid" style={{ alignContent: "start" }}>
          {staff ? (
            <section className="panel">
              <div className="panel-h"><h2>Cobros por cliente</h2></div>
              <div className="list">
                {cs.map((c) => {
                  const p = sum(pending.filter((i) => i.invoice.customerId === c.erpId));
                  const l = sum(late.filter((i) => i.invoice.customerId === c.erpId));
                  return (
                    <div className="li" key={c.erpId}>
                      <div style={{ minWidth: 0 }}><b>{c.name}</b><div className="sub">{c.city}</div></div>
                      <div style={{ textAlign: "right" }} className="num">
                        {eur(p)}
                        <div className="sub" style={l ? { color: "var(--bad)" } : undefined}>{l ? `${eur(l)} vencido` : "al día"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : cs[0] && (
            <section className="panel">
              <div className="panel-h"><h2>Tu cuenta</h2></div>
              <div className="panel-b grid" style={{ gap: 14 }}>
                {cs[0].creditLimit != null && (() => {
                  const used = sum(pending) + open.reduce((s, o) => s + o.total, 0);
                  const pct = Math.min(100, (used / cs[0].creditLimit!) * 100);
                  return (
                    <div>
                      <div className="label">Crédito disponible</div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, margin: "4px 0 6px" }}>
                        <b className="num">{eur(cs[0].creditLimit! - used)}</b><span className="sub num">de {eur(cs[0].creditLimit)}</span>
                      </div>
                      <div className={`meter ${pct > 75 ? "hi" : ""}`}><i style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })()}
                <div><div className="label">Condiciones de pago</div><p style={{ margin: "4px 0 0" }}>{cs[0].paymentTerms}</p></div>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
