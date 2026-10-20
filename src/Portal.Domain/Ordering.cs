namespace Portal.Domain;

// Pedidos que el cliente (o su comercial) hace desde el portal. El portal no crea el pedido de venta:
// se lo pasa al ERP y espera la confirmación con el número real (en SAP, el VBELN).

/// <summary>Artículo del catálogo. BasePrice es el precio de tarifa general; TaxRate va en porcentaje.</summary>
public sealed record Product(
    string TenantId,
    string ErpId,
    string Description,
    string Unit,
    string? Category,
    decimal BasePrice,
    decimal TaxRate,
    decimal? Stock,
    decimal MinQuantity);

/// <summary>Precio especial de un artículo para un cliente concreto.</summary>
public sealed record CustomerPrice(string TenantId, string CustomerId, string MaterialId, decimal Price);

/// <summary>Dirección de entrega de un cliente (en SAP, interlocutor destinatario de mercancías).</summary>
public sealed record ShipTo(string TenantId, string CustomerId, string ErpId, string Name, string Address);

public enum OrderRequestStatus { PendienteErp, Creado, Rechazado }

public sealed record OrderRequestLine(
    int Position,
    string MaterialId,
    string Description,
    decimal Quantity,
    string Unit,
    decimal UnitPrice,
    decimal NetAmount,
    decimal TaxAmount);

public sealed record OrderRequest(
    string TenantId,
    string Id,
    string CustomerId,
    string CreatedBy,
    string? CreatedByName,
    DateTimeOffset CreatedAt,
    string? CustomerReference,
    DateOnly RequestedDate,
    ShipTo? ShipTo,
    string? Notes,
    string Currency,
    IReadOnlyList<OrderRequestLine> Lines,
    OrderRequestStatus Status = OrderRequestStatus.PendienteErp,
    string? ErpOrderId = null,
    string? Message = null)
{
    public decimal NetAmount => Lines.Sum(l => l.NetAmount);
    public decimal TaxAmount => Lines.Sum(l => l.TaxAmount);
    public decimal Total => NetAmount + TaxAmount;
}

/// <summary>Respuesta del ERP a un pedido del portal: creado con su número, o rechazado con el motivo.</summary>
public sealed record OrderConfirmation(string TenantId, string RequestId, bool Ok, string? ErpOrderId, string? Message);

public sealed record OrderSubmission(bool Accepted, string? Message);

public sealed record CatalogItem(Product Product, decimal Price, bool SpecialPrice);

public sealed record OrderDraftLine(string MaterialId, decimal Quantity);

public sealed record OrderDraft(
    string CustomerId,
    string? CustomerReference,
    DateOnly RequestedDate,
    string? ShipToId,
    string? Notes,
    IReadOnlyList<OrderDraftLine> Lines);

public static class OrderRules
{
    public const int MaxReference = 35;   // longitud de BSTKD en SAP
    public const int MaxNotes = 500;
    public const int MaxLines = 200;

    public static decimal Round(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// Comprueba el borrador y calcula precios e impuestos en el servidor: el navegador solo manda artículos y cantidades.
    /// Devuelve las líneas o la lista de errores para el usuario.
    /// </summary>
    public static (IReadOnlyList<OrderRequestLine> Lines, IReadOnlyList<string> Errors) Price(
        OrderDraft draft, Func<string, CatalogItem?> find, DateOnly today, bool shipToValid)
    {
        var errors = new List<string>();
        var lines = new List<OrderRequestLine>();
        if (draft.Lines.Count == 0) errors.Add("El pedido no tiene artículos.");
        if (draft.Lines.Count > MaxLines) errors.Add($"Un pedido admite como máximo {MaxLines} líneas.");
        if (draft.RequestedDate <= today) errors.Add("La fecha de entrega tiene que ser posterior a hoy.");
        if (draft.RequestedDate > today.AddYears(1)) errors.Add("La fecha de entrega no puede pasar de un año.");
        if (draft.CustomerReference?.Length > MaxReference) errors.Add($"Su referencia admite como máximo {MaxReference} caracteres.");
        if (draft.Notes?.Length > MaxNotes) errors.Add($"Las observaciones admiten como máximo {MaxNotes} caracteres.");
        if (!shipToValid) errors.Add("La dirección de entrega no es de este cliente.");

        foreach (var g in draft.Lines.GroupBy(l => l.MaterialId))
        {
            var qty = g.Sum(l => l.Quantity);
            if (find(g.Key) is not { } item) { errors.Add($"El artículo {g.Key} no está en el catálogo."); continue; }
            var p = item.Product;
            if (qty <= 0 || qty > 1_000_000) { errors.Add($"Cantidad no válida para {p.Description}."); continue; }
            if (qty < p.MinQuantity) { errors.Add($"{p.Description}: la cantidad mínima es {p.MinQuantity:0.###} {p.Unit}."); continue; }
            var net = Round(qty * item.Price);
            lines.Add(new OrderRequestLine((lines.Count + 1) * 10, p.ErpId, p.Description, qty, p.Unit, item.Price, net, Round(net * p.TaxRate / 100m)));
        }
        return (lines, errors);
    }
}
