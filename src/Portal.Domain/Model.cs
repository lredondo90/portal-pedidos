namespace Portal.Domain;

// Modelo común: todo conector (SAP por ficheros, SAP RFC, otros ERP) traduce sus datos a estos tipos.
// ErpId es siempre el identificador original en el ERP (en SAP, VBELN, KUNNR...).

public enum OrderStatus { Abierto, EnPreparacion, Enviado, Entregado, Facturado, Anulado }

public enum InvoiceStatus { Pendiente, Vencida, Pagada }

public sealed record SalesRep(string TenantId, string ErpId, string Name, string? Email);

public sealed record Customer(
    string TenantId,
    string ErpId,
    string Name,
    string? TaxId,
    string? Address,
    string? City,
    string? PaymentTerms,
    decimal? CreditLimit,
    string? SalesRepId);

public sealed record OrderLine(
    int Position,
    string MaterialId,
    string Description,
    decimal Quantity,
    string Unit,
    decimal UnitPrice,
    decimal NetAmount);

public sealed record Order(
    string TenantId,
    string ErpId,
    string CustomerId,
    DateOnly OrderDate,
    string? CustomerReference,
    DateOnly? RequestedDate,
    string? Incoterm,
    string Currency,
    OrderStatus Status,
    IReadOnlyList<OrderLine> Lines,
    decimal NetAmount,
    decimal TaxAmount)
{
    public decimal Total => NetAmount + TaxAmount;
}

public sealed record TrackingEvent(DateTimeOffset At, string Description, string? Location);

public sealed record Delivery(
    string TenantId,
    string ErpId,
    string OrderId,
    DateOnly? GoodsIssueDate,
    string? Carrier,
    string? TrackingNumber,
    int? Packages,
    decimal? WeightKg,
    string? PdfFile);

public sealed record TrackingUpdate(string TenantId, string TrackingNumber, IReadOnlyList<TrackingEvent> Events, bool Delivered);

public sealed record Invoice(
    string TenantId,
    string ErpId,
    string CustomerId,
    string? OrderId,
    DateOnly Date,
    DateOnly DueDate,
    decimal NetAmount,
    decimal TaxAmount,
    string Currency,
    string? PaymentMethod,
    string? PdfFile)
{
    public decimal Total => NetAmount + TaxAmount;
}

public sealed record PaymentUpdate(string TenantId, string InvoiceId, string? ErpDocument, DateOnly? ClearedDate, decimal Amount, bool Cleared);

/// <summary>Lote de cambios que devuelve un conector en cada sincronización.</summary>
public sealed record ErpBatch(
    IReadOnlyList<SalesRep> SalesReps,
    IReadOnlyList<Customer> Customers,
    IReadOnlyList<Order> Orders,
    IReadOnlyList<Delivery> Deliveries,
    IReadOnlyList<TrackingUpdate> Tracking,
    IReadOnlyList<Invoice> Invoices,
    IReadOnlyList<PaymentUpdate> Payments,
    IReadOnlyList<Product> Products,
    IReadOnlyList<CustomerPrice> Prices,
    IReadOnlyList<ShipTo> ShipTos,
    IReadOnlyList<OrderConfirmation> Confirmations,
    IReadOnlyList<ImportIssue> Issues,
    string? Cursor)
{
    public static ErpBatch Empty(string? cursor = null) => new([], [], [], [], [], [], [], [], [], [], [], [], cursor);
}

public sealed record ImportIssue(string Source, int? Row, string Message);
