namespace Portal.Domain;

public enum DocumentKind { Invoice, DeliveryNote }

public sealed record ConnectorHealth(bool Ok, string Message, DateTimeOffset CheckedAt);

/// <summary>
/// Contrato que implementa cada ERP. El portal solo habla con esta interfaz,
/// así que pasar de ficheros a RFC/BAPI (o a otro ERP) es cambiar de implementación.
/// </summary>
public interface IErpConnector
{
    string Name { get; }

    /// <summary>Cambios desde el cursor de la última sincronización (null = carga completa).</summary>
    Task<ErpBatch> FetchChangesAsync(string? cursor, CancellationToken ct);

    /// <summary>Refresco de un pedido concreto bajo demanda. Puede devolver null si el conector no lo soporta.</summary>
    Task<ErpBatch?> RefreshOrderAsync(string tenantId, string orderId, CancellationToken ct);

    /// <summary>PDF de factura o albarán, o null si no existe.</summary>
    Task<Stream?> OpenDocumentAsync(string tenantId, DocumentKind kind, string erpId, string? fileName, CancellationToken ct);

    /// <summary>
    /// Entrega al ERP un pedido hecho en el portal. Accepted indica que el ERP lo ha recibido;
    /// el número de pedido llega después como OrderConfirmation en un lote de cambios.
    /// </summary>
    Task<OrderSubmission> SubmitOrderAsync(OrderRequest request, Customer customer, CancellationToken ct);

    Task<ConnectorHealth> CheckHealthAsync(CancellationToken ct);
}
