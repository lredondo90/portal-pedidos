using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Portal.Domain;

namespace Portal.Connectors.SapFiles;

public sealed class SapFileOptions
{
    /// <summary>Empresa a la que pertenecen los ficheros (cada empresa tiene su propio conector).</summary>
    public string TenantId { get; set; } = "demo";

    /// <summary>Carpeta donde el job de SAP deja los CSV. Los PDF van en la subcarpeta "pdf".</summary>
    public string InboxPath { get; set; } = "inbox";
}

/// <summary>
/// Conector SAP ECC por ficheros de exportación. Formato descrito en docs/formato-ficheros-sap.md.
/// Lee los ficheros con marca de tiempo posterior al cursor y devuelve un único lote.
/// </summary>
public sealed partial class SapFileConnector(SapFileOptions options) : IErpConnector
{
    public string Name => "SAP ECC · ficheros";

    [GeneratedRegex(@"^(CLIENTES|PEDIDOS|ENTREGAS|SEGUIMIENTO|FACTURAS|COBROS)_(\d{8}_\d{4})\.csv$", RegexOptions.IgnoreCase)]
    private static partial Regex FileName();

    private static readonly string[] Order = ["CLIENTES", "PEDIDOS", "ENTREGAS", "SEGUIMIENTO", "FACTURAS", "COBROS"];

    public Task<ErpBatch> FetchChangesAsync(string? cursor, CancellationToken ct)
    {
        var files = Directory.Exists(options.InboxPath)
            ? Directory.GetFiles(options.InboxPath, "*.csv")
                .Select(p => (path: p, m: FileName().Match(Path.GetFileName(p))))
                .Where(x => x.m.Success)
                .Select(x => (x.path, kind: x.m.Groups[1].Value.ToUpperInvariant(), stamp: x.m.Groups[2].Value))
                .Where(x => cursor is null || string.CompareOrdinal(x.stamp, cursor) > 0)
                .OrderBy(x => x.stamp).ThenBy(x => Array.IndexOf(Order, x.kind))
                .ToList()
            : [];

        var b = new Builder(options.TenantId);
        foreach (var f in files)
        {
            ct.ThrowIfCancellationRequested();
            var table = CsvTable.Parse(File.ReadAllText(f.path, Encoding.UTF8));
            var source = Path.GetFileName(f.path);
            switch (f.kind)
            {
                case "CLIENTES": b.Customers(table, source); break;
                case "PEDIDOS": b.Orders(table, source); break;
                case "ENTREGAS": b.Deliveries(table, source); break;
                case "SEGUIMIENTO": b.Tracking(table, source); break;
                case "FACTURAS": b.Invoices(table, source); break;
                case "COBROS": b.Payments(table, source); break;
            }
        }
        return Task.FromResult(b.Build(files.Count > 0 ? files[^1].stamp : cursor));
    }

    // Con ficheros no hay consulta en tiempo real: el refresco llega en la siguiente exportación.
    public Task<ErpBatch?> RefreshOrderAsync(string tenantId, string orderId, CancellationToken ct) => Task.FromResult<ErpBatch?>(null);

    public Task<Stream?> OpenDocumentAsync(string tenantId, DocumentKind kind, string erpId, string? fileName, CancellationToken ct)
    {
        var name = Path.GetFileName(fileName ?? (kind == DocumentKind.Invoice ? $"FACTURA_{erpId}.pdf" : $"ALBARAN_{erpId}.pdf"));
        var path = Path.Combine(options.InboxPath, "pdf", name);
        return Task.FromResult<Stream?>(File.Exists(path) ? File.OpenRead(path) : null);
    }

    public Task<ConnectorHealth> CheckHealthAsync(CancellationToken ct)
    {
        var ok = Directory.Exists(options.InboxPath);
        return Task.FromResult(new ConnectorHealth(ok, ok ? "Carpeta de entrada accesible" : $"No existe la carpeta {options.InboxPath}", DateTimeOffset.UtcNow));
    }

    /// <summary>
    /// Estado del pedido a partir de los estados de SAP (tabla VBUK):
    /// ABSTK = rechazo, FKSTK = facturación, WBSTK = salida de mercancías, LFSTK = entrega.
    /// </summary>
    public static OrderStatus MapStatus(string? lfstk, string? wbstk, string? fkstk, string? abstk) =>
        abstk == "C" ? OrderStatus.Anulado
        : fkstk == "C" ? OrderStatus.Facturado
        : wbstk == "C" ? OrderStatus.Enviado
        : lfstk is "B" or "C" ? OrderStatus.EnPreparacion
        : OrderStatus.Abierto;

    private sealed class Builder(string tenant)
    {
        private readonly Dictionary<string, SalesRep> _reps = [];
        private readonly List<Customer> _customers = [];
        private readonly List<Order> _orders = [];
        private readonly List<Delivery> _deliveries = [];
        private readonly List<TrackingUpdate> _tracking = [];
        private readonly List<Invoice> _invoices = [];
        private readonly List<PaymentUpdate> _payments = [];
        private readonly List<ImportIssue> _issues = [];

        private void Each(CsvTable t, string source, Action<CsvRow> action)
        {
            foreach (var r in t.Rows)
            {
                try { action(r); }
                catch (FormatException e) { _issues.Add(new ImportIssue(source, r.Line, e.Message)); }
            }
        }

        public void Customers(CsvTable t, string source) => Each(t, source, r =>
        {
            var repId = r.Get("VEND_ID");
            if (repId is not null) _reps[repId] = new SalesRep(tenant, repId, r.Get("VEND_NOMBRE") ?? repId, r.Get("VEND_EMAIL"));
            var addr = string.Join(", ", new[] { r.Get("STRAS"), string.Join(" ", new[] { r.Get("PSTLZ"), r.Get("ORT01") }.Where(x => x is not null)) }.Where(x => !string.IsNullOrEmpty(x)));
            _customers.Add(new Customer(tenant, r.Required("KUNNR"), r.Required("NAME1"), r.Get("STCD1"), addr.Length > 0 ? addr : null,
                r.Get("ORT01"), r.Get("ZTERM_TEXTO"), r.Decimal("KLIMK"), repId));
        });

        public void Orders(CsvTable t, string source)
        {
            // Una fila por posición: se agrupan por número de pedido (VBELN).
            foreach (var g in t.Rows.GroupBy(r => r.Get("VBELN") ?? ""))
            {
                if (g.Key.Length == 0) { foreach (var r in g) _issues.Add(new ImportIssue(source, r.Line, "Falta el valor de VBELN")); continue; }
                try
                {
                    var h = g.First();
                    var lines = g.Select(r => new OrderLine(int.Parse(r.Required("POSNR"), CultureInfo.InvariantCulture), r.Required("MATNR"), r.Get("ARKTX") ?? "",
                        r.RequiredDecimal("KWMENG"), r.Get("VRKME") ?? "UN", r.Decimal("NETPR") ?? 0, r.RequiredDecimal("NETWR"))).OrderBy(l => l.Position).ToList();
                    _orders.Add(new Order(tenant, g.Key, h.Required("KUNNR"), h.RequiredDate("ERDAT"), h.Get("BSTKD"), h.Date("VDATU"), h.Get("INCO1"),
                        h.Get("WAERK") ?? "EUR", MapStatus(h.Get("LFSTK"), h.Get("WBSTK"), h.Get("FKSTK"), h.Get("ABSTK")), lines,
                        lines.Sum(l => l.NetAmount), g.Sum(r => r.Decimal("MWSBP") ?? 0)));
                }
                catch (FormatException e) { _issues.Add(new ImportIssue(source, g.First().Line, $"Pedido {g.Key}: {e.Message}")); }
            }
        }

        public void Deliveries(CsvTable t, string source) => Each(t, source, r =>
            _deliveries.Add(new Delivery(tenant, r.Required("VBELN"), r.Required("VGBEL"), r.Date("WADAT_IST"), r.Get("TRANSPORTISTA"), r.Get("NUM_SEGUIMIENTO"),
                r.Decimal("BULTOS") is { } n ? (int)n : null, r.Decimal("BTGEW"), r.Get("PDF"))));

        public void Tracking(CsvTable t, string source)
        {
            var parsed = new List<(string num, TrackingEvent ev, bool delivered)>();
            Each(t, source, r =>
            {
                var date = r.RequiredDate("FECHA");
                var time = r.Get("HORA") is { } h && TimeOnly.TryParseExact(h.PadLeft(6, '0'), "HHmmss", out var tt) ? tt : TimeOnly.MinValue;
                var at = new DateTimeOffset(date.ToDateTime(time), TimeSpan.Zero);
                parsed.Add((r.Required("NUM_SEGUIMIENTO"), new TrackingEvent(at, r.Required("EVENTO"), r.Get("LUGAR")), r.Flag("ENTREGADO")));
            });
            foreach (var g in parsed.GroupBy(p => p.num))
                _tracking.Add(new TrackingUpdate(tenant, g.Key, g.Select(p => p.ev).OrderByDescending(e => e.At).ToList(), g.Any(p => p.delivered)));
        }

        public void Invoices(CsvTable t, string source) => Each(t, source, r =>
            _invoices.Add(new Invoice(tenant, r.Required("VBELN"), r.Required("KUNRG"), r.Get("AUBEL"), r.RequiredDate("FKDAT"), r.RequiredDate("VENCIMIENTO"),
                r.RequiredDecimal("NETWR"), r.Decimal("MWSBK") ?? 0, r.Get("WAERK") ?? "EUR", r.Get("ZLSCH_TEXTO"), r.Get("PDF"))));

        public void Payments(CsvTable t, string source) => Each(t, source, r =>
            _payments.Add(new PaymentUpdate(tenant, r.Required("VBELN_FACTURA"), r.Get("BELNR"), r.Date("AUGDT"), r.Decimal("IMPORTE") ?? 0, r.Flag("COMPENSADO"))));

        public ErpBatch Build(string? cursor) =>
            new(_reps.Values.ToList(), _customers, _orders, _deliveries, _tracking, _invoices, _payments, _issues, cursor);
    }
}
