using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Portal.Connectors.SapFiles;
using Portal.Domain;

namespace Portal.Api;

public sealed record CatalogResponse(Customer? Customer, IReadOnlyList<string> Categories, IReadOnlyList<CatalogItem> Items, IReadOnlyList<ShipTo> ShipTos);

/// <summary>Evita que dos envíos del mismo pedido del móvil (mismo id) se procesen a la vez y lleguen dos veces a SAP.</summary>
public sealed class ClientOrderGate
{
    private readonly ConcurrentDictionary<string, byte> _inFlight = new();

    public bool TryEnter(string tenantId, string clientId) => _inFlight.TryAdd(tenantId + "|" + clientId, 0);

    public void Exit(string tenantId, string clientId) => _inFlight.TryRemove(tenantId + "|" + clientId, out _);
}

public sealed record OfflinePrice(string MaterialId, decimal Price);

public sealed record OfflineCustomer(Customer Customer, IReadOnlyList<ShipTo> ShipTos, IReadOnlyList<OfflinePrice> Prices);

/// <summary>Lo que el móvil guarda para pedir sin cobertura. DataAt es la última sincronización correcta con el ERP: la antigüedad de precios y stock.</summary>
public sealed record OfflinePack(string UserId, string TenantId, DateTimeOffset GeneratedAt, DateTimeOffset? DataAt, IReadOnlyList<Product> Products, IReadOnlyList<OfflineCustomer> Customers)
{
    public static OfflinePack Build(UserContext user, IPortalStore store, DateTimeOffset? dataAt, DateTimeOffset now)
    {
        var customers = store.Customers(user);
        var products = customers.Count == 0 ? [] : store.Catalog(customers[0]).Select(i => i.Product).ToList();
        var list = customers
            .Select(c => new OfflineCustomer(c, store.ShipTos(c),
                store.Catalog(c).Where(i => i.SpecialPrice).Select(i => new OfflinePrice(i.Product.ErpId, i.Price)).ToList()))
            .ToList();
        return new OfflinePack(user.UserId, user.TenantId, now, dataAt, products, list);
    }
}

public static class OrderRequestIds
{
    private const string Alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

    /// <summary>Identificador del pedido en el portal, p. ej. W261020-7KQ4M. Cabe en BSTKD (35) por si SAP lo guarda ahí.</summary>
    public static string New(DateTimeOffset now) =>
        "W" + now.ToString("yyMMdd", CultureInfo.InvariantCulture) + "-" + RandomNumberGenerator.GetString(Alphabet, 5);
}

/// <summary>
/// SAP simulado para la demo (Erp:SapFiles:SimulateSap). Hace lo que hará el programa ABAP real:
/// recoge PEDIDO_ENTRADA_*.csv de la carpeta de salida, "crea" el pedido con un número nuevo y deja
/// PEDIDOS_* y CONFIRMACIONES_* en la carpeta de entrada, como si viniera de la exportación de SAP.
/// </summary>
public sealed class DemoSapSimulator(SapFileOptions options, IPortalStore store, SyncService sync, TimeProvider time, ILogger<DemoSapSimulator> log) : BackgroundService
{
    private static readonly UserContext System = new("sap-simulado", "", Role.PlatformAdmin);
    private long _last;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { if (Process()) await sync.RunAsync(stoppingToken); }
            catch (Exception e) when (e is not OperationCanceledException) { log.LogError(e, "Fallo en el SAP simulado"); }
        }
    }

    /// <summary>Procesa los pedidos pendientes. Devuelve true si ha dejado ficheros nuevos en la carpeta de entrada.</summary>
    public bool Process()
    {
        if (!Directory.Exists(options.OutboxPath)) return false;
        var files = Directory.GetFiles(options.OutboxPath, SapFileConnector.OrderFilePrefix + "*.csv").Order().ToList();
        if (files.Count == 0) return false;

        var now = time.GetLocalNow();
        var orders = new List<string?[]>();
        var confirmations = new List<string?[]>();
        foreach (var f in files)
        {
            foreach (var g in CsvTable.Parse(File.ReadAllText(f, Encoding.UTF8)).Rows.GroupBy(r => r.Required("ID_PORTAL")))
            {
                var h = g.First();
                var customer = store.FindCustomer(System, options.TenantId, h.Required("KUNNR"));
                if (customer is null)
                {
                    confirmations.Add([g.Key, null, "ERROR", "Cliente desconocido en SAP"]);
                    continue;
                }
                var vbeln = NextOrderNumber().ToString("D10", CultureInfo.InvariantCulture);
                foreach (var r in g)
                {
                    var qty = r.RequiredDecimal("KWMENG");
                    var price = r.RequiredDecimal("NETPR");
                    var item = store.CatalogItem(customer, r.Required("MATNR"));
                    var net = OrderRules.Round(qty * price);
                    orders.Add([vbeln, r.Required("POSNR"), Csv.Date(DateOnly.FromDateTime(now.DateTime)), customer.ErpId, h.Get("BSTKD"), h.Get("VDATU"), "DAP", h.Get("WAERK") ?? "EUR",
                        r.Required("MATNR"), item?.Product.Description ?? r.Required("MATNR"), Csv.Decimal(qty), r.Get("VRKME"), Csv.Decimal(price), Csv.Decimal(net),
                        Csv.Decimal(OrderRules.Round(net * (item?.Product.TaxRate ?? 21m) / 100m)), null, null, null, null]);
                }
                confirmations.Add([g.Key, vbeln, "OK", null]);
            }
        }

        var stamp = now.ToString("yyyyMMdd_HHmmss", CultureInfo.InvariantCulture);
        if (orders.Count > 0)
            WriteInbox($"PEDIDOS_{stamp}.csv", ["VBELN", "POSNR", "ERDAT", "KUNNR", "BSTKD", "VDATU", "INCO1", "WAERK", "MATNR", "ARKTX", "KWMENG", "VRKME", "NETPR", "NETWR", "MWSBP", "LFSTK", "WBSTK", "FKSTK", "ABSTK"], orders);
        WriteInbox($"CONFIRMACIONES_{stamp}.csv", ["ID_PORTAL", "VBELN", "RESULTADO", "MENSAJE"], confirmations);

        var done = Directory.CreateDirectory(Path.Combine(options.OutboxPath, "procesados")).FullName;
        foreach (var f in files) File.Move(f, Path.Combine(done, Path.GetFileName(f)), overwrite: true);
        log.LogInformation("SAP simulado: {Count} pedidos del portal procesados", confirmations.Count);
        return true;
    }

    private long NextOrderNumber()
    {
        var max = store.Orders(System, new OrderQuery(), DateOnly.MinValue)
            .Select(o => long.TryParse(o.Order.ErpId, out var n) ? n : 0).DefaultIfEmpty(0).Max();
        _last = Math.Max(Math.Max(max, _last), 125999) + 1;
        return _last;
    }

    private void WriteInbox(string name, IReadOnlyList<string> headers, IEnumerable<string?[]> rows)
    {
        var path = Path.Combine(options.InboxPath, name);
        File.WriteAllText(path + ".tmp", Csv.Write(headers, rows), new UTF8Encoding(false));
        File.Move(path + ".tmp", path, overwrite: true);
    }
}
