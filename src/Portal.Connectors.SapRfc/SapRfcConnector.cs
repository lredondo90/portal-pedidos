using Portal.Domain;

namespace Portal.Connectors.SapRfc;

public sealed class SapRfcOptions
{
    public string TenantId { get; set; } = "demo";
    public string? AppServerHost { get; set; }
    public string? SystemNumber { get; set; }   // p. ej. "00"
    public string? Client { get; set; }         // mandante, p. ej. "100"
    public string? User { get; set; }           // usuario técnico RFC (lectura, y alta de pedidos si se usan pedidos desde el portal)
    public string? Password { get; set; }
    public string Language { get; set; } = "ES";
}

/// <summary>
/// Conector SAP ECC en tiempo real por RFC/BAPI. Preparado, todavía no activo.
///
/// Requiere SAP .NET Connector 3.1 (sapnco.dll, sapnco_utils.dll), que se descarga del
/// SAP Support Portal con vuestro usuario S y no se puede publicar en NuGet ni en el repositorio.
///
/// Mapeo previsto al mismo modelo común que usa el conector por ficheros:
///   Clientes   → BAPI_CUSTOMER_GETDETAIL2 + lectura de KNVP (interlocutor VE) por RFC_READ_TABLE o función Z
///   Pedidos    → BAPI_SALESORDER_GETLIST (lista por cliente y fechas) + BAPISDORDER_GETDETAILEDLIST (detalle y estados)
///   Entregas   → función Z sobre LIKP/LIPS (no hay BAPI estándar de lectura cómoda)
///   Facturas   → BAPI_BILLINGDOC_GETDETAIL / BAPI_BILLINGDOC_GETLIST
///   Cobros     → BAPI_AR_ACC_GETOPENITEMS y BAPI_AR_ACC_GETSTATEMENT
///   PDF        → función Z que devuelve el formulario Smartforms/SAPscript en OTF convertido a PDF
///   Alta pedido→ BAPI_SALESDOCUMENT_CREATEFROMDAT2 (antes, BAPI_SALESORDER_SIMULATE para enseñar precio y disponibilidad
///                exactos) + BAPI_TRANSACTION_COMMIT; el VBELN devuelto se convierte en OrderConfirmation al momento.
///                Necesita un usuario RFC con permiso de creación en VA01, no solo de lectura.
/// </summary>
public sealed class SapRfcConnector(SapRfcOptions options) : IErpConnector
{
    public string Name => "SAP ECC · RFC/BAPI";

    private bool Configured => options.AppServerHost is not null && options.User is not null;

    public Task<ErpBatch> FetchChangesAsync(string? cursor, CancellationToken ct) =>
        throw new NotSupportedException("El conector RFC/BAPI aún no está activado. Usa el conector por ficheros.");

    public Task<ErpBatch?> RefreshOrderAsync(string tenantId, string orderId, CancellationToken ct) => Task.FromResult<ErpBatch?>(null);

    public Task<Stream?> OpenDocumentAsync(string tenantId, DocumentKind kind, string erpId, string? fileName, CancellationToken ct) => Task.FromResult<Stream?>(null);

    public Task<OrderSubmission> SubmitOrderAsync(OrderRequest request, Customer customer, CancellationToken ct) =>
        Task.FromResult(new OrderSubmission(false, "El conector RFC/BAPI aún no está activado."));

    public Task<ConnectorHealth> CheckHealthAsync(CancellationToken ct) =>
        Task.FromResult(new ConnectorHealth(false, Configured ? "Pendiente de instalar SAP .NET Connector" : "Sin configurar", DateTimeOffset.UtcNow));
}
