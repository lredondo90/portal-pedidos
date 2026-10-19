import Link from "next/link";
import { InvoicePill, PageHeader } from "@/components/Pills";
import { apiGet, isStaff, type Customer, type InvoiceStatus, type InvoiceView, type Me } from "@/lib/api";
import { diasEntre, eur, fecha, fechaCorta, hoy } from "@/lib/format";

const FILTERS: { v: InvoiceStatus | ""; l: string }[] = [
  { v: "", l: "Todas" }, { v: "Pendiente", l: "Pendientes" }, { v: "Vencida", l: "Vencidas" }, { v: "Pagada", l: "Pagadas" },
];

export default async function FacturasPage({ searchParams }: PageProps<"/facturas">) {
  const sp = await searchParams;
  const status = ((Array.isArray(sp.estado) ? sp.estado[0] : sp.estado) ?? "") as InvoiceStatus | "";
  const [me, all, customers] = await Promise.all([
    apiGet<Me>("/api/me"),
    apiGet<InvoiceView[]>("/api/invoices"),
    apiGet<Customer[]>("/api/customers"),
  ]);
  const staff = isStaff(me!.user.role);
  const names = new Map((customers ?? []).map((c) => [c.erpId, c.name]));
  const inv = all ?? [];
  const sum = (a: InvoiceView[]) => a.reduce((s, i) => s + i.invoice.total, 0);
  const pend = inv.filter((i) => i.status === "Pendiente"), late = inv.filter((i) => i.status === "Vencida"), paid = inv.filter((i) => i.status === "Pagada");
  const shown = status ? inv.filter((i) => i.status === status) : inv;
  const today = hoy();

  return (
    <>
      <PageHeader title="Facturas y pagos" sub="Descarga las facturas en PDF y consulta vencimientos y cobros" />
      <div className="grid kpis three">
        <div className="kpi"><span className="label">Pendiente de pago</span><span className="v num">{eur(sum(pend))}</span><span className="s">{pend.length} sin vencer</span></div>
        <div className={`kpi ${late.length ? "alert" : ""}`}><span className="label">Vencido</span><span className="v num">{eur(sum(late))}</span><span className="s">{late.length} facturas</span></div>
        <div className="kpi"><span className="label">Pagado</span><span className="v num">{eur(sum(paid))}</span><span className="s">{paid.length} cobros</span></div>
      </div>
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h">
          <div className="chips">
            {FILTERS.map((f) => (
              <Link key={f.l} className="chip" href={f.v ? `/facturas?estado=${f.v}` : "/facturas"} aria-current={status === f.v ? "true" : undefined}>{f.l}</Link>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Factura</th><th>Fecha</th>{staff && <th>Cliente</th>}<th>Vencimiento</th><th>Estado</th><th className="r">Importe</th><th /></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={7}><div className="empty">No hay facturas en este estado.</div></td></tr>}
              {shown.map(({ invoice: i, status: s, paidDate }) => (
                <tr key={i.erpId}>
                  <td className="mono">{i.orderId ? <Link className="link" href={`/pedidos/${i.tenantId}/${i.orderId}`}>{i.erpId}</Link> : i.erpId}</td>
                  <td className="num">{fecha(i.date)}</td>
                  {staff && <td>{names.get(i.customerId) ?? i.customerId}</td>}
                  <td className="num">
                    {fecha(i.dueDate)}
                    <div className="sub" style={s === "Vencida" ? { color: "var(--bad)" } : undefined}>
                      {s === "Pagada" ? `Pagada ${fechaCorta(paidDate)}` : s === "Vencida" ? `${diasEntre(i.dueDate, today)} días` : `en ${diasEntre(today, i.dueDate)} días`}
                    </div>
                  </td>
                  <td><InvoicePill status={s} /></td>
                  <td className="r num">{eur(i.total)}</td>
                  <td><a className="btn sm" href={`/documentos/${i.tenantId}/Invoice/${i.erpId}`}>PDF</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
