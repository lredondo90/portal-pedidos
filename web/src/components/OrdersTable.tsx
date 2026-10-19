import Link from "next/link";
import type { OrderSummary } from "@/lib/api";
import { eur, fecha } from "@/lib/format";
import { OrderPill } from "./Pills";

export function OrdersTable({ orders, showCustomer, compact }: { orders: OrderSummary[]; showCustomer: boolean; compact?: boolean }) {
  if (!orders.length) return <div className="empty">No hay pedidos con estos filtros.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Fecha</th>
            {showCustomer && <th>Cliente</th>}
            {!compact && <th className="hide-m">Su referencia</th>}
            {!compact && <th className="hide-m">Entrega solicitada</th>}
            <th>Estado</th>
            <th className="r">Importe</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.tenantId + o.id}>
              <td>
                <Link className="link mono" href={`/pedidos/${o.tenantId}/${o.id}`}>{o.id}</Link>
              </td>
              <td className="num">{fecha(o.date)}</td>
              {showCustomer && <td>{o.customerName}</td>}
              {!compact && <td className="hide-m mono">{o.customerReference}</td>}
              {!compact && <td className="hide-m num">{fecha(o.requestedDate)}</td>}
              <td><OrderPill status={o.status} /></td>
              <td className="r num">{eur(o.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
