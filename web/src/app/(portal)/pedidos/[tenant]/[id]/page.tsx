import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoicePill } from "@/components/Pills";
import { apiGet, type OrderView } from "@/lib/api";
import { eur, fecha, hora, ORDER_LABEL, STEPS } from "@/lib/format";

export default async function PedidoPage({ params }: PageProps<"/pedidos/[tenant]/[id]">) {
  const { tenant, id } = await params;
  const v = await apiGet<OrderView>(`/api/orders/${encodeURIComponent(tenant)}/${encodeURIComponent(id)}`);
  if (!v) notFound();
  const o = v.order;
  const step = STEPS.indexOf(v.status);

  return (
    <div className="detail">
      <Link className="back" href="/pedidos">← Pedidos</Link>
      <div className="drawer-h">
        <div>
          <div className="label">Pedido de venta</div>
          <h2 className="mono">{o.erpId}</h2>
          <div className="sub">
            {v.customer?.name}
            {o.customerReference && <> · su referencia <span className="mono">{o.customerReference}</span></>}
          </div>
        </div>
      </div>

      {v.status === "Anulado" ? (
        <p><span className="pill p-bad">Anulado</span></p>
      ) : (
        <ol className="steps">
          {STEPS.map((s, k) => (
            <li key={s} className={`${k <= step ? "on" : ""} ${k === step ? "now" : ""}`}>{ORDER_LABEL[s]}</li>
          ))}
        </ol>
      )}

      <section className="panel">
        <div className="panel-b">
          <dl className="kv">
            <dt>Fecha de pedido</dt><dd className="num">{fecha(o.orderDate)}</dd>
            <dt>Entrega solicitada</dt><dd className="num">{fecha(o.requestedDate)}</dd>
            {o.incoterm && <><dt>Incoterm</dt><dd>{o.incoterm}</dd></>}
            {v.customer?.address && <><dt>Dirección</dt><dd>{v.customer.address}</dd></>}
          </dl>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Líneas</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Pos.</th><th>Material</th><th className="r">Cant.</th><th className="r hide-m">Precio</th><th className="r">Importe</th></tr></thead>
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.position}>
                  <td className="mono">{String(l.position).padStart(6, "0")}</td>
                  <td>{l.description}<div className="sub mono">{l.materialId}</div></td>
                  <td className="r num">{Number(l.quantity).toLocaleString("es-ES")} {l.unit}</td>
                  <td className="r num hide-m">{eur(l.unitPrice)}</td>
                  <td className="r num">{eur(l.netAmount)}</td>
                </tr>
              ))}
              <tr><td colSpan={3} /><td className="r sub hide-m">Base</td><td className="r num">{eur(o.netAmount)}</td></tr>
              <tr><td colSpan={3} /><td className="r sub hide-m">IVA</td><td className="r num">{eur(o.taxAmount)}</td></tr>
              <tr><td colSpan={3} /><td className="r hide-m"><b>Total</b></td><td className="r num"><b>{eur(o.total)}</b></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Entrega y transporte</h2></div>
        <div className="panel-b grid" style={{ gap: 16 }}>
          {v.deliveries.length === 0 && (
            <p className="sub" style={{ margin: 0 }}>El pedido aún no ha salido del almacén. Verás aquí el transportista y el seguimiento en cuanto se cree la entrega en SAP.</p>
          )}
          {v.deliveries.map(({ delivery: d, events, delivered }) => (
            <div key={d.erpId} className="grid" style={{ gap: 12 }}>
              <dl className="kv">
                <dt>Albarán</dt><dd className="mono">{d.erpId}</dd>
                {d.carrier && <><dt>Transportista</dt><dd>{d.carrier}</dd></>}
                {d.trackingNumber && <><dt>Nº de seguimiento</dt><dd className="mono">{d.trackingNumber}</dd></>}
                {d.packages != null && <><dt>Bultos</dt><dd className="num">{d.packages}{d.weightKg != null ? ` · ${Number(d.weightKg).toLocaleString("es-ES")} kg` : ""}</dd></>}
                <dt>Salida de almacén</dt><dd className="num">{fecha(d.goodsIssueDate)}</dd>
                <dt>Estado</dt><dd>{delivered ? <span className="pill p-done">Entregado</span> : <span className="pill p-ship">En camino</span>}</dd>
              </dl>
              {events.length > 0 && (
                <ol className="track">
                  {events.map((e) => (
                    <li key={e.at + e.description}>
                      <div><b>{e.description}</b><div className="sub">{fecha(e.at)} {hora(e.at)}{e.location ? ` · ${e.location}` : ""}</div></div>
                    </li>
                  ))}
                </ol>
              )}
              <div className="doc">
                <div className="doc-ic">PDF</div>
                <div className="grow"><b>Albarán {d.erpId}</b></div>
                <a className="btn sm" href={`/documentos/${d.tenantId}/DeliveryNote/${d.erpId}`}>Descargar</a>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Factura y pago</h2></div>
        <div className="panel-b grid" style={{ gap: 10 }}>
          {v.invoices.length === 0 && <p className="sub" style={{ margin: 0 }}>Se facturará tras la entrega.</p>}
          {v.invoices.map(({ invoice: i, status, paidDate }) => (
            <div className="doc" key={i.erpId}>
              <div className="doc-ic">PDF</div>
              <div className="grow">
                <b className="mono">Factura {i.erpId}</b>
                <div className="sub">{fecha(i.date)} · vence {fecha(i.dueDate)}{i.paymentMethod ? ` · ${i.paymentMethod}` : ""}{paidDate ? ` · pagada el ${fecha(paidDate)}` : ""}</div>
              </div>
              <InvoicePill status={status} />
              <b className="num">{eur(i.total)}</b>
              <a className="btn sm" href={`/documentos/${i.tenantId}/Invoice/${i.erpId}`}>Descargar</a>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
