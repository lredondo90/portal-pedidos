using System.Collections.Concurrent;

namespace Portal.Domain;

public sealed record OrderView(Order Order, OrderStatus Status, Customer? Customer, IReadOnlyList<DeliveryView> Deliveries, IReadOnlyList<InvoiceView> Invoices);

public sealed record DeliveryView(Delivery Delivery, IReadOnlyList<TrackingEvent> Events, bool Delivered);

public sealed record InvoiceView(Invoice Invoice, InvoiceStatus Status, DateOnly? PaidDate);

public sealed record OrderQuery(OrderStatus? Status = null, string? CustomerId = null, string? Text = null);

/// <summary>
/// Almacén del portal (modelo de lectura). Esta versión vive en memoria;
/// la de producción será PostgreSQL con seguridad a nivel de fila (ver db/schema.sql).
/// </summary>
public interface IPortalStore
{
    void Apply(ErpBatch batch);
    IReadOnlyList<Customer> Customers(UserContext user);
    IReadOnlyList<OrderView> Orders(UserContext user, OrderQuery query, DateOnly today);
    OrderView? Order(UserContext user, string tenantId, string orderId, DateOnly today);
    IReadOnlyList<InvoiceView> Invoices(UserContext user, InvoiceStatus? status, DateOnly today);
    Invoice? FindInvoice(UserContext user, string tenantId, string invoiceId);
    Delivery? FindDelivery(UserContext user, string tenantId, string deliveryId);
    StoreCounts Counts();
}

public sealed record StoreCounts(int Customers, int Orders, int Deliveries, int Invoices);

public sealed class InMemoryPortalStore : IPortalStore
{
    private static string Key(string tenant, string id) => tenant + "|" + id;

    private readonly ConcurrentDictionary<string, SalesRep> _reps = new();
    private readonly ConcurrentDictionary<string, Customer> _customers = new();
    private readonly ConcurrentDictionary<string, Order> _orders = new();
    private readonly ConcurrentDictionary<string, Delivery> _deliveries = new();
    private readonly ConcurrentDictionary<string, TrackingUpdate> _tracking = new();
    private readonly ConcurrentDictionary<string, Invoice> _invoices = new();
    private readonly ConcurrentDictionary<string, PaymentUpdate> _payments = new();

    public void Apply(ErpBatch batch)
    {
        foreach (var r in batch.SalesReps) _reps[Key(r.TenantId, r.ErpId)] = r;
        foreach (var c in batch.Customers) _customers[Key(c.TenantId, c.ErpId)] = c;
        foreach (var o in batch.Orders) _orders[Key(o.TenantId, o.ErpId)] = o;
        foreach (var d in batch.Deliveries) _deliveries[Key(d.TenantId, d.ErpId)] = d;
        foreach (var t in batch.Tracking)
        {
            var k = Key(t.TenantId, t.TrackingNumber);
            _tracking.AddOrUpdate(k, t, (_, old) => t with
            {
                Events = old.Events.Concat(t.Events).DistinctBy(e => (e.At, e.Description)).OrderByDescending(e => e.At).ToList(),
                Delivered = old.Delivered || t.Delivered,
            });
        }
        foreach (var i in batch.Invoices) _invoices[Key(i.TenantId, i.ErpId)] = i;
        foreach (var p in batch.Payments) _payments[Key(p.TenantId, p.InvoiceId)] = p;
    }

    public IReadOnlyList<Customer> Customers(UserContext user) =>
        _customers.Values.Where(c => AccessPolicy.CanSeeCustomer(user, c)).OrderBy(c => c.Name).ToList();

    public IReadOnlyList<OrderView> Orders(UserContext user, OrderQuery query, DateOnly today)
    {
        var text = query.Text?.Trim();
        return _orders.Values
            .Where(o => Visible(user, o.TenantId, o.CustomerId))
            .Where(o => query.CustomerId is null || o.CustomerId == query.CustomerId)
            .Select(o => View(o, today))
            .Where(v => query.Status is null || v.Status == query.Status)
            .Where(v => string.IsNullOrEmpty(text)
                || v.Order.ErpId.Contains(text, StringComparison.OrdinalIgnoreCase)
                || (v.Order.CustomerReference?.Contains(text, StringComparison.OrdinalIgnoreCase) ?? false)
                || (v.Customer?.Name.Contains(text, StringComparison.OrdinalIgnoreCase) ?? false)
                || v.Order.Lines.Any(l => l.Description.Contains(text, StringComparison.OrdinalIgnoreCase) || l.MaterialId.Contains(text, StringComparison.OrdinalIgnoreCase)))
            .OrderByDescending(v => v.Order.OrderDate).ThenByDescending(v => v.Order.ErpId)
            .ToList();
    }

    public OrderView? Order(UserContext user, string tenantId, string orderId, DateOnly today) =>
        _orders.TryGetValue(Key(tenantId, orderId), out var o) && Visible(user, o.TenantId, o.CustomerId) ? View(o, today) : null;

    public IReadOnlyList<InvoiceView> Invoices(UserContext user, InvoiceStatus? status, DateOnly today) =>
        _invoices.Values
            .Where(i => Visible(user, i.TenantId, i.CustomerId))
            .Select(i => InvoiceViewOf(i, today))
            .Where(v => status is null || v.Status == status)
            .OrderBy(v => v.Status == InvoiceStatus.Pagada).ThenBy(v => v.Invoice.DueDate)
            .ToList();

    public Invoice? FindInvoice(UserContext user, string tenantId, string invoiceId) =>
        _invoices.TryGetValue(Key(tenantId, invoiceId), out var i) && Visible(user, i.TenantId, i.CustomerId) ? i : null;

    public Delivery? FindDelivery(UserContext user, string tenantId, string deliveryId)
    {
        if (!_deliveries.TryGetValue(Key(tenantId, deliveryId), out var d)) return null;
        return _orders.TryGetValue(Key(tenantId, d.OrderId), out var o) && Visible(user, o.TenantId, o.CustomerId) ? d : null;
    }

    public StoreCounts Counts() => new(_customers.Count, _orders.Count, _deliveries.Count, _invoices.Count);

    private bool Visible(UserContext user, string tenantId, string customerId) =>
        _customers.TryGetValue(Key(tenantId, customerId), out var c) && AccessPolicy.CanSeeCustomer(user, c);

    private OrderView View(Order o, DateOnly today)
    {
        _customers.TryGetValue(Key(o.TenantId, o.CustomerId), out var customer);
        var deliveries = _deliveries.Values.Where(d => d.TenantId == o.TenantId && d.OrderId == o.ErpId)
            .Select(d =>
            {
                TrackingUpdate? t = null;
                if (d.TrackingNumber is not null) _tracking.TryGetValue(Key(d.TenantId, d.TrackingNumber), out t);
                return new DeliveryView(d, t?.Events ?? [], t?.Delivered ?? false);
            }).ToList();
        var invoices = _invoices.Values.Where(i => i.TenantId == o.TenantId && i.OrderId == o.ErpId).Select(i => InvoiceViewOf(i, today)).ToList();

        // SAP marca el pedido como enviado al contabilizar la salida de mercancías;
        // "Entregado" llega del seguimiento del transportista.
        var status = o.Status == OrderStatus.Enviado && deliveries.Count > 0 && deliveries.All(d => d.Delivered)
            ? OrderStatus.Entregado
            : o.Status;
        return new OrderView(o, status, customer, deliveries, invoices);
    }

    private InvoiceView InvoiceViewOf(Invoice i, DateOnly today)
    {
        _payments.TryGetValue(Key(i.TenantId, i.ErpId), out var p);
        return new InvoiceView(i, InvoiceRules.StatusOf(i, p, today), p is { Cleared: true } ? p.ClearedDate : null);
    }
}
