using Portal.Connectors.SapFiles;
using Portal.Domain;

namespace Portal.Tests;

public class CommissionTests
{
    private static readonly DateOnly Today = new(2026, 10, 20);
    private static readonly CommissionSettings Settings = new("demo", CommissionBasis.Cobrado, 3m, 1m);
    private static readonly SalesRep[] Reps = [new("demo", "E001", "Laura Gómez", null), new("demo", "E002", "Javier Ortega", null)];
    private static readonly Customer Ferreteria = new("demo", "C1", "Ferretería", null, null, null, null, null, "E001");
    private static readonly Customer Albia = new("demo", "C3", "Albia", null, null, null, null, null, "E002");

    private static SaleView Sale(string id, Customer c, DateOnly date, DateOnly? paid, params (string? category, decimal net)[] shares)
    {
        var net = shares.Sum(s => s.net);
        var invoice = new Invoice("demo", id, c.ErpId, null, date, date.AddDays(30), net, net * 0.21m, "EUR", null, null);
        var status = paid is null ? (invoice.DueDate < Today ? InvoiceStatus.Vencida : InvoiceStatus.Pendiente) : InvoiceStatus.Pagada;
        return new SaleView(invoice, c, status, paid, shares.Select(s => new SaleShare(s.category, s.net)).ToList());
    }

    private static SalesDashboard Run(IReadOnlyList<SaleView> sales, CommissionSettings? settings = null, IReadOnlyList<CommissionRule>? rules = null,
        IReadOnlyList<SalesTarget>? targets = null, IReadOnlyList<CommissionSettlement>? settlements = null) =>
        CommissionCalculator.Dashboard(2026, sales, Reps, settings ?? Settings, rules ?? [], targets ?? [], settlements ?? []);

    [Fact]
    public void Most_specific_rule_wins()
    {
        CommissionRule[] rules =
        [
            new("demo", "rep", "E001", null, null, 3.5m),
            new("demo", "fam", null, null, "Escaleras", 2m),
            new("demo", "cli", null, "C2", null, 2.5m),
            new("demo", "old", null, null, "Herramientas", 9m, ValidTo: new DateOnly(2025, 12, 31)),
        ];
        var d = new DateOnly(2026, 5, 1);
        Assert.Equal(3.5m, CommissionCalculator.RateFor(rules, Settings, "E001", "C1", "Fijación", d));
        Assert.Equal(2m, CommissionCalculator.RateFor(rules, Settings, "E001", "C1", "Escaleras", d));
        Assert.Equal(2.5m, CommissionCalculator.RateFor(rules, Settings, "E001", "C2", "Escaleras", d));
        Assert.Equal(3m, CommissionCalculator.RateFor(rules, Settings, "E002", "C3", "Herramientas", d)); // regla caducada: tasa general
    }

    [Fact]
    public void Collected_basis_counts_sales_in_the_month_they_are_paid()
    {
        SaleView[] sales =
        [
            Sale("F1", Ferreteria, new(2026, 8, 20), new(2026, 9, 19), ("Fijación", 1000m)),
            Sale("F2", Ferreteria, new(2026, 9, 5), null, ("Fijación", 500m)),
        ];
        var dash = Run(sales);
        var laura = dash.Reps.Single(r => r.SalesRepId == "E001");
        Assert.Equal(1000m, laura.Months[7].Invoiced);
        Assert.Equal(0m, laura.Months[7].Base);
        Assert.Equal(1000m, laura.Months[8].Base);
        Assert.Equal(30m, laura.Months[8].Commission);
        Assert.Equal(500m, laura.PendingCollection);
        Assert.Single(dash.Lines);

        var invoicedBasis = Run(sales, Settings with { Basis = CommissionBasis.Facturado });
        Assert.Equal(1000m, invoicedBasis.Reps.Single(r => r.SalesRepId == "E001").Months[7].Base);
        Assert.Equal(500m, invoicedBasis.Reps.Single(r => r.SalesRepId == "E001").Months[8].Base);
    }

    [Fact]
    public void Bonus_applies_to_the_part_above_target()
    {
        var dash = Run(
            [Sale("F1", Albia, new(2026, 3, 1), new(2026, 3, 30), ("Fijación", 6000m))],
            targets: [new SalesTarget("demo", "E002", 2026, 3, 4000m)]);
        var march = dash.Reps.Single(r => r.SalesRepId == "E002").Months[2];
        Assert.Equal(180m, march.Commission);
        Assert.Equal(20m, march.Bonus);   // 1 % de 2.000 € por encima del objetivo
        Assert.Equal(200m, march.Total);
    }

    [Fact]
    public void Closed_month_keeps_the_settled_amount()
    {
        var settled = new CommissionSettlement("demo", "E001", 2026, 4, 1000m, 30m, DateTimeOffset.UnixEpoch, "Marta");
        var dash = Run([Sale("F1", Ferreteria, new(2026, 4, 1), new(2026, 4, 20), ("Fijación", 2000m))], settlements: [settled]);
        var april = dash.Reps.Single(r => r.SalesRepId == "E001").Months[3];
        Assert.Equal(60m, april.Commission);
        Assert.Equal(30m, april.Total);
    }

    [Fact]
    public void Split_shares_invoice_by_family_without_losing_cents()
    {
        var shares = CommissionCalculator.Split(100m, [("A", 1m), ("B", 1m), ("C", 1m)]);
        Assert.Equal(100m, shares.Sum(s => s.NetAmount));
        Assert.Equal([33.33m, 33.33m, 33.34m], shares.Select(s => s.NetAmount));
        Assert.Equal([new SaleShare(null, 50m)], CommissionCalculator.Split(50m, []));
    }

    [Fact]
    public void Store_rejects_double_close_and_reopening_paid_months()
    {
        var store = new InMemoryCommissionStore();
        var s = new CommissionSettlement("demo", "E001", 2026, 9, 1m, 1m, DateTimeOffset.UnixEpoch, "Marta");
        Assert.True(store.Close(s));
        Assert.False(store.Close(s));
        Assert.True(store.MarkPaid("demo", "E001", 2026, 9, DateTimeOffset.UnixEpoch));
        Assert.False(store.Reopen("demo", "E001", 2026, 9));
    }

    [Fact]
    public async Task Sales_rep_only_gets_their_own_sales_from_the_samples()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (!Directory.Exists(Path.Combine(dir.FullName, "samples"))) dir = dir.Parent!;
        var connector = new SapFileConnector(new SapFileOptions { TenantId = "demo", InboxPath = Path.Combine(dir.FullName, "samples", "sap-export") });
        var store = new InMemoryPortalStore();
        store.Apply(await connector.FetchChangesAsync(null, CancellationToken.None));

        var laura = new UserContext("laura", "demo", Role.SalesRep, SalesRepId: "E001");
        Assert.Equal(["E001"], store.SalesReps(laura).Select(r => r.ErpId));
        var sales = store.Sales(laura, Today);
        Assert.NotEmpty(sales);
        Assert.All(sales, s => Assert.Equal("E001", s.Customer.SalesRepId));
        Assert.All(sales, s => Assert.Equal(s.Invoice.NetAmount, s.Shares.Sum(x => x.NetAmount)));
        Assert.Contains(sales.SelectMany(s => s.Shares), x => x.Category == "Herramientas");

        var ana = new UserContext("ana", "demo", Role.Customer, CustomerIds: ["0000100231"]);
        Assert.Empty(store.SalesReps(ana));
        Assert.Equal(2, store.SalesReps(new UserContext("marta", "demo", Role.CompanyAdmin)).Count);
    }
}
