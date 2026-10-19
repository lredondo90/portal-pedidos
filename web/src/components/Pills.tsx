import type { InvoiceStatus, OrderStatus } from "@/lib/api";
import { INVOICE_PILL, ORDER_LABEL, ORDER_PILL } from "@/lib/format";

export function OrderPill({ status }: { status: OrderStatus }) {
  return <span className={`pill ${ORDER_PILL[status]}`}>{ORDER_LABEL[status]}</span>;
}

export function InvoicePill({ status }: { status: InvoiceStatus }) {
  return <span className={`pill ${INVOICE_PILL[status]}`}>{status}</span>;
}

export function PageHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="topbar">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
    </div>
  );
}
