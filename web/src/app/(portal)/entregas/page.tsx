import Link from "next/link";
import { PageHeader } from "@/components/Pills";
import { apiGet, isStaff, type DeliverySummary, type Me } from "@/lib/api";
import { fecha, fechaCorta } from "@/lib/format";

export default async function EntregasPage() {
  const [me, deliveries] = await Promise.all([apiGet<Me>("/api/me"), apiGet<DeliverySummary[]>("/api/deliveries")]);
  const staff = isStaff(me!.user.role);
  const ds = deliveries ?? [];
  return (
    <>
      <PageHeader title="Entregas" sub="Albaranes y seguimiento del transporte" />
      <section className="panel">
        {ds.length === 0 ? <div className="empty">Todavía no hay entregas.</div> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Entrega</th><th>Pedido</th>{staff && <th>Cliente</th>}<th>Transportista</th><th className="hide-m">Seguimiento</th><th>Último evento</th><th className="r hide-m">Bultos</th></tr>
              </thead>
              <tbody>
                {ds.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.id}</td>
                    <td><Link className="link mono" href={`/pedidos/${d.tenantId}/${d.orderId}`}>{d.orderId}</Link></td>
                    {staff && <td>{d.customerName}</td>}
                    <td>{d.carrier}</td>
                    <td className="hide-m mono">{d.trackingNumber}</td>
                    <td>
                      <span className={`pill ${d.delivered ? "p-done" : "p-ship"}`}>{d.delivered ? "Entregado" : d.lastEvent?.description ?? "Salida de almacén"}</span>
                      <div className="sub">{d.lastEvent ? `${fechaCorta(d.lastEvent.at)}${d.lastEvent.location ? ` · ${d.lastEvent.location}` : ""}` : fecha(d.goodsIssueDate)}</div>
                    </td>
                    <td className="r num hide-m">{d.packages ?? ""}{d.weightKg != null ? ` · ${Number(d.weightKg).toLocaleString("es-ES")} kg` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
