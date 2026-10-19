using Portal.Connectors.SapFiles;
using Portal.Domain;

namespace Portal.Tests;

public class SapFileConnectorTests
{
    private static readonly DateOnly Today = new(2026, 10, 19);

    private static string SamplesPath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "samples"))) dir = dir.Parent;
        return Path.Combine(dir!.FullName, "samples", "sap-export");
    }

    private static async Task<(ErpBatch batch, InMemoryPortalStore store)> LoadSamples()
    {
        var connector = new SapFileConnector(new SapFileOptions { TenantId = "demo", InboxPath = SamplesPath() });
        var batch = await connector.FetchChangesAsync(null, CancellationToken.None);
        var store = new InMemoryPortalStore();
        store.Apply(batch);
        return (batch, store);
    }

    private static readonly UserContext Admin = new("marta", "demo", Role.CompanyAdmin);
    private static readonly UserContext Laura = new("laura", "demo", Role.SalesRep, SalesRepId: "E001");
    private static readonly UserContext Ana = new("ana", "demo", Role.Customer, CustomerIds: ["0000100231"]);

    [Fact]
    public async Task Imports_all_sample_files()
    {
        var (batch, _) = await LoadSamples();
        Assert.Equal(3, batch.Customers.Count);
        Assert.Equal(2, batch.SalesReps.Count);
        Assert.Equal(8, batch.Orders.Count);
        Assert.Equal(4, batch.Deliveries.Count);
        Assert.Equal(3, batch.Invoices.Count);
        Assert.Equal("20261019_1400", batch.Cursor);
    }

    [Fact]
    public async Task Reports_bad_rows_without_stopping_the_import()
    {
        var (batch, _) = await LoadSamples();
        var issue = Assert.Single(batch.Issues);
        Assert.Equal("COBROS_20261019_1400.csv", issue.Source);
        Assert.Equal(3, issue.Row);
        Assert.Single(batch.Payments);
    }

    [Fact]
    public async Task Groups_order_positions_and_keeps_leading_zeros()
    {
        var (batch, _) = await LoadSamples();
        var o = batch.Orders.Single(x => x.ErpId == "0000125529");
        Assert.Equal("0000100231", o.CustomerId);
        Assert.Equal([10, 20, 30], o.Lines.Select(l => l.Position));
        Assert.Equal(o.Lines.Sum(l => l.NetAmount), o.NetAmount);
        Assert.Equal(96m, o.Lines[0].Quantity);
    }

    [Theory]
    [InlineData(null, null, null, null, OrderStatus.Abierto)]
    [InlineData("B", null, null, null, OrderStatus.EnPreparacion)]
    [InlineData("C", "C", null, null, OrderStatus.Enviado)]
    [InlineData("C", "C", "C", null, OrderStatus.Facturado)]
    [InlineData(null, null, null, "C", OrderStatus.Anulado)]
    public void Maps_sap_status_flags(string? lfstk, string? wbstk, string? fkstk, string? abstk, OrderStatus expected) =>
        Assert.Equal(expected, SapFileConnector.MapStatus(lfstk, wbstk, fkstk, abstk));

    [Fact]
    public async Task Customer_sees_only_own_orders()
    {
        var (_, store) = await LoadSamples();
        var orders = store.Orders(Ana, new OrderQuery(), Today);
        Assert.Equal(4, orders.Count);
        Assert.All(orders, o => Assert.Equal("0000100231", o.Order.CustomerId));
        Assert.Null(store.Order(Ana, "demo", "0000125490", Today)); // pedido de otro cliente
    }

    [Fact]
    public async Task Sales_rep_sees_only_their_portfolio()
    {
        var (_, store) = await LoadSamples();
        Assert.Equal(["0000100231", "0000100488"], store.Customers(Laura).Select(c => c.ErpId));
        Assert.DoesNotContain(store.Orders(Laura, new OrderQuery(), Today), o => o.Order.CustomerId == "0000100679");
        Assert.Equal(8, store.Orders(Admin, new OrderQuery(), Today).Count);
    }

    [Fact]
    public async Task Other_tenant_sees_nothing()
    {
        var (_, store) = await LoadSamples();
        var otherAdmin = new UserContext("x", "otra-empresa", Role.CompanyAdmin);
        Assert.Empty(store.Orders(otherAdmin, new OrderQuery(), Today));
        Assert.Empty(store.Customers(otherAdmin));
    }

    [Fact]
    public async Task Tracking_marks_shipped_orders_as_delivered()
    {
        var (_, store) = await LoadSamples();
        Assert.Equal(OrderStatus.Enviado, store.Order(Admin, "demo", "0000125529", Today)!.Status);  // en tránsito
        var invoiced = store.Order(Admin, "demo", "0000125490", Today)!;
        Assert.Equal(OrderStatus.Facturado, invoiced.Status);
        Assert.True(invoiced.Deliveries.Single().Delivered);
        Assert.Equal(2, invoiced.Deliveries.Single().Events.Count);
    }

    [Fact]
    public async Task Invoice_status_uses_payments_and_due_date()
    {
        var (_, store) = await LoadSamples();
        var inv = store.Invoices(Admin, null, Today).ToDictionary(i => i.Invoice.ErpId);
        Assert.Equal(InvoiceStatus.Pendiente, inv["0090034111"].Status);
        Assert.Equal(InvoiceStatus.Vencida, inv["0090034100"].Status);
        Assert.Equal(InvoiceStatus.Pagada, inv["0090034089"].Status);
        Assert.Equal(new DateOnly(2026, 10, 10), inv["0090034089"].PaidDate);
    }

    [Fact]
    public async Task Cursor_skips_files_already_imported()
    {
        var connector = new SapFileConnector(new SapFileOptions { InboxPath = SamplesPath() });
        var again = await connector.FetchChangesAsync("20261019_1400", CancellationToken.None);
        Assert.Empty(again.Orders);
        Assert.Equal("20261019_1400", again.Cursor);
    }

    [Fact]
    public async Task Opens_invoice_pdf()
    {
        var connector = new SapFileConnector(new SapFileOptions { InboxPath = SamplesPath() });
        await using var pdf = await connector.OpenDocumentAsync("demo", DocumentKind.Invoice, "0090034111", null, CancellationToken.None);
        Assert.NotNull(pdf);
        var head = new byte[5];
        await pdf!.ReadExactlyAsync(head);
        Assert.Equal("%PDF-"u8.ToArray(), head);
    }

    [Theory]
    [InlineData("1234.56", 1234.56)]
    [InlineData("1.234,56", 1234.56)]
    [InlineData("150,00-", -150)]
    public void Parses_sap_numbers(string raw, decimal expected)
    {
        var row = CsvTable.Parse("N\n" + raw).Rows.Single();
        Assert.Equal(expected, row.Decimal("N"));
    }

    [Fact]
    public void Parses_quoted_fields_with_separator()
    {
        var t = CsvTable.Parse("A;B\n\"Martín; Hijos\";\"dice \"\"hola\"\"\"\n");
        Assert.Equal("Martín; Hijos", t.Rows[0].Get("A"));
        Assert.Equal("dice \"hola\"", t.Rows[0].Get("B"));
    }
}
