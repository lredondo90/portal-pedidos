using Microsoft.Extensions.Logging.Abstractions;
using Portal.Api;
using Portal.Connectors.SapFiles;
using Portal.Domain;

namespace Portal.Tests;

public sealed class OrderingTests : IDisposable
{
    private static readonly DateOnly Today = new(2026, 10, 20);
    private static readonly UserContext Ana = new("ana", "demo", Role.Customer, CustomerIds: ["0000100231"]);
    private static readonly UserContext Laura = new("laura", "demo", Role.SalesRep, SalesRepId: "E001");

    // Copia de los ejemplos en una carpeta temporal: el SAP simulado escribe en la carpeta de entrada.
    private readonly string _root = Directory.CreateTempSubdirectory("portal-tests-").FullName;
    private readonly SapFileOptions _options;

    public OrderingTests()
    {
        var samples = new DirectoryInfo(AppContext.BaseDirectory);
        while (!Directory.Exists(Path.Combine(samples.FullName, "samples"))) samples = samples.Parent!;
        var inbox = Directory.CreateDirectory(Path.Combine(_root, "inbox")).FullName;
        foreach (var f in Directory.GetFiles(Path.Combine(samples.FullName, "samples", "sap-export"), "*.csv"))
            if (Path.GetFileNameWithoutExtension(f).Split('_')[^1].Length == 4) File.Copy(f, Path.Combine(inbox, Path.GetFileName(f)));
        _options = new SapFileOptions { TenantId = "demo", InboxPath = inbox, OutboxPath = Path.Combine(_root, "outbox") };
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private async Task<(SapFileConnector connector, InMemoryPortalStore store)> Load()
    {
        var connector = new SapFileConnector(_options);
        var store = new InMemoryPortalStore();
        store.Apply(await connector.FetchChangesAsync(null, CancellationToken.None));
        return (connector, store);
    }

    private static OrderDraft Draft(params (string material, decimal qty)[] lines) =>
        new("0000100231", "OC-PRUEBA-1", Today.AddDays(3), "0000100232", "Llamar antes; muelle 2", lines.Select(l => new OrderDraftLine(l.material, l.qty)).ToList());

    private static OrderRequest Request(Customer c, OrderDraft d, IReadOnlyList<OrderRequestLine> lines, ShipTo? shipTo) =>
        new(c.TenantId, "W261020-TEST1", c.ErpId, "ana", "Ana Martín", new DateTimeOffset(2026, 10, 20, 9, 0, 0, TimeSpan.Zero),
            d.CustomerReference, d.RequestedDate, shipTo, d.Notes, "EUR", lines);

    [Fact]
    public async Task Catalog_uses_the_customer_price_list_and_falls_back_to_base_price()
    {
        var (_, store) = await Load();
        var ana = store.FindCustomer(Ana, "demo", "0000100231")!;
        var items = store.Catalog(ana);
        Assert.Equal(15, items.Count);
        var special = items.Single(i => i.Product.ErpId == "10004512");
        Assert.True(special.SpecialPrice);
        Assert.Equal(18.40m, special.Price);
        var standard = items.Single(i => i.Product.ErpId == "10004530");
        Assert.False(standard.SpecialPrice);
        Assert.Equal(21.50m, standard.Price);
        Assert.Equal(["0000100231", "0000100232"], store.ShipTos(ana).Select(s => s.ErpId));
        Assert.Equal(2, store.Catalog(ana, "broca").Count);
        Assert.Equal(2, store.Catalog(ana, category: "Escaleras").Count);
    }

    [Fact]
    public async Task Sales_rep_cannot_order_for_another_portfolio()
    {
        var (_, store) = await Load();
        Assert.NotNull(store.FindCustomer(Laura, "demo", "0000100488"));
        Assert.Null(store.FindCustomer(Laura, "demo", "0000100679"));
        Assert.Null(store.FindCustomer(Ana, "demo", "0000100488"));
    }

    [Fact]
    public async Task Prices_lines_on_the_server()
    {
        var (_, store) = await Load();
        var ana = store.FindCustomer(Ana, "demo", "0000100231")!;
        var (lines, errors) = OrderRules.Price(Draft(("10004512", 3), ("10007120", 12), ("10004512", 2)), m => store.CatalogItem(ana, m), Today, true);
        Assert.Empty(errors);
        Assert.Equal(2, lines.Count);
        Assert.Equal((10, 5m, 92.00m, 19.32m), (lines[0].Position, lines[0].Quantity, lines[0].NetAmount, lines[0].TaxAmount));
        Assert.Equal((20, 117.00m), (lines[1].Position, lines[1].NetAmount));
    }

    [Fact]
    public async Task Rejects_invalid_drafts()
    {
        var (_, store) = await Load();
        var ana = store.FindCustomer(Ana, "demo", "0000100231")!;
        var (_, errors) = OrderRules.Price(Draft(("10007120", 6), ("99999999", 1), ("10004512", 0)) with { RequestedDate = Today },
            m => store.CatalogItem(ana, m), Today, false);
        Assert.Contains(errors, e => e.Contains("posterior a hoy"));
        Assert.Contains(errors, e => e.Contains("cantidad mínima es 12"));
        Assert.Contains(errors, e => e.Contains("99999999"));
        Assert.Contains(errors, e => e.Contains("Cantidad no válida"));
        Assert.Contains(errors, e => e.Contains("dirección de entrega"));
        Assert.Contains("El pedido no tiene artículos.", OrderRules.Price(Draft(), _ => null, Today, true).Errors);
    }

    [Fact]
    public async Task Writes_the_order_file_for_sap()
    {
        var (connector, store) = await Load();
        var ana = store.FindCustomer(Ana, "demo", "0000100231")!;
        var draft = Draft(("10004512", 5), ("10007120", 12));
        var (lines, _) = OrderRules.Price(draft, m => store.CatalogItem(ana, m), Today, true);
        var request = Request(ana, draft, lines, store.ShipTos(ana)[1]);

        Assert.True((await connector.SubmitOrderAsync(request, ana, CancellationToken.None)).Accepted);
        Assert.False((await connector.SubmitOrderAsync(request, ana, CancellationToken.None)).Accepted);

        var file = Path.Combine(_options.OutboxPath, "PEDIDO_ENTRADA_W261020-TEST1.csv");
        var table = CsvTable.Parse(File.ReadAllText(file));
        Assert.Equal(2, table.Rows.Count);
        var r = table.Rows[0];
        Assert.Equal(("W261020-TEST1", "0000100231", "0000100232", "20261023", "000010", "10004512", 5m, 18.40m),
            (r.Get("ID_PORTAL"), r.Get("KUNNR"), r.Get("KUNWE"), r.Get("VDATU"), r.Get("POSNR"), r.Get("MATNR"), r.Decimal("KWMENG"), r.Decimal("NETPR")));
        Assert.Equal("Llamar antes; muelle 2", r.Get("TEXTO"));
        Assert.Empty(Directory.GetFiles(_options.OutboxPath, "*.tmp"));
    }

    [Fact]
    public async Task Demo_sap_creates_the_order_and_confirms_it()
    {
        var (connector, store) = await Load();
        var ana = store.FindCustomer(Ana, "demo", "0000100231")!;
        var draft = Draft(("10004512", 5), ("10020455", 24));
        var (lines, _) = OrderRules.Price(draft, m => store.CatalogItem(ana, m), Today, true);
        var request = Request(ana, draft, lines, null);
        await connector.SubmitOrderAsync(request, ana, CancellationToken.None);
        store.AddRequest(request);

        var sync = new SyncService(connector, store, NullLogger<SyncService>.Instance);
        await sync.RunAsync(CancellationToken.None);
        var simulator = new DemoSapSimulator(_options, store, sync, TimeProvider.System, NullLogger<DemoSapSimulator>.Instance);
        Assert.True(simulator.Process());
        Assert.False(simulator.Process());
        var run = await sync.RunAsync(CancellationToken.None);
        Assert.Empty(run.Issues);

        var confirmed = store.Request(Ana, "demo", "W261020-TEST1")!;
        Assert.Equal(OrderRequestStatus.Creado, confirmed.Status);
        Assert.Equal("0000126000", confirmed.ErpOrderId);
        var order = store.Order(Ana, "demo", "0000126000", Today)!;
        Assert.Equal(OrderStatus.Abierto, order.Status);
        Assert.Equal(request.Total, order.Order.Total);
        Assert.Equal("OC-PRUEBA-1", order.Order.CustomerReference);
        Assert.Single(Directory.GetFiles(Path.Combine(_options.OutboxPath, "procesados")));
    }

    [Fact]
    public async Task Rejected_confirmation_keeps_the_reason_and_unknown_ones_are_ignored()
    {
        var (connector, store) = await Load();
        var ana = store.FindCustomer(Ana, "demo", "0000100231")!;
        store.AddRequest(Request(ana, Draft(), [], null));
        File.WriteAllText(Path.Combine(_options.InboxPath, "CONFIRMACIONES_20261020_101500.csv"),
            "ID_PORTAL;VBELN;RESULTADO;MENSAJE\nW261020-TEST1;;ERROR;Cliente bloqueado por crédito\nW261020-OTRO1;0000126500;OK;\nW261020-MAL01;;QUIZA;\n");
        var batch = await connector.FetchChangesAsync("20261019_1400", CancellationToken.None);
        store.Apply(batch);

        Assert.Equal("20261020_101500", batch.Cursor);
        Assert.Single(batch.Issues);
        var r = store.Request(Ana, "demo", "W261020-TEST1")!;
        Assert.Equal((OrderRequestStatus.Rechazado, "Cliente bloqueado por crédito"), (r.Status, r.Message));
        Assert.Single(store.Requests(Ana));
    }
}
