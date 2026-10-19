import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/Pills";
import { apiGet, isStaff, type Customer, type InvoiceView, type Me, type OrderSummary } from "@/lib/api";
import { eur } from "@/lib/format";

export default async function ClientesPage() {
  const [me, customers, orders, invoices] = await Promise.all([
    apiGet<Me>("/api/me"),
    apiGet<Customer[]>("/api/customers"),
    apiGet<OrderSummary[]>("/api/orders"),
    apiGet<InvoiceView[]>("/api/invoices"),
  ]);
  if (!isStaff(me!.user.role)) redirect("/cuenta");
  const os = orders ?? [], inv = invoices ?? [];

  return (
    <>
      <PageHeader title="Clientes" sub={me!.user.role === "SalesRep" ? "Tu cartera de clientes" : "Todos los clientes de la empresa"} />
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Cliente</th><th className="hide-m">Nº SAP</th><th className="r">Pedidos abiertos</th><th className="r">Pendiente</th><th>Riesgo usado</th></tr></thead>
            <tbody>
              {(customers ?? []).map((c) => {
                const mine = os.filter((o) => o.customerId === c.erpId);
                const pendingInv = inv.filter((i) => i.invoice.customerId === c.erpId && i.status !== "Pagada");
                const pending = pendingInv.reduce((s, i) => s + i.invoice.total, 0);
                const notInvoiced = mine.filter((o) => o.status !== "Facturado" && o.status !== "Anulado").reduce((s, o) => s + o.total, 0);
                const pct = c.creditLimit ? Math.min(100, ((pending + notInvoiced) / c.creditLimit) * 100) : 0;
                const late = pendingInv.some((i) => i.status === "Vencida");
                return (
                  <tr key={c.erpId}>
                    <td>
                      <Link className="link" href={`/pedidos?cliente=${c.erpId}`}>{c.name}</Link>
                      <div className="sub">{c.city}{late && <> · <span style={{ color: "var(--bad)" }}>con vencidos</span></>}</div>
                    </td>
                    <td className="mono hide-m">{c.erpId}</td>
                    <td className="r num">{mine.filter((o) => ["Abierto", "EnPreparacion", "Enviado"].includes(o.status)).length}</td>
                    <td className="r num">{eur(pending)}</td>
                    <td>
                      {c.creditLimit ? (
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <div className={`meter ${pct > 75 ? "hi" : ""}`} style={{ flex: 1 }}><i style={{ width: `${pct}%` }} /></div>
                          <span className="sub num">{Math.round(pct)}%</span>
                        </div>
                      ) : <span className="sub">Sin límite</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
