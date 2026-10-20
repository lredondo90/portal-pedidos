using Portal.Domain;

namespace Portal.Api;

public sealed record RuleDraft(string? Id, string? SalesRepId, string? CustomerId, string? Category, decimal Rate, DateOnly? ValidFrom, DateOnly? ValidTo, string? Note);

/// <summary>Objetivo de un comercial. Sin mes, se aplica el mismo importe a los doce meses del año.</summary>
public sealed record TargetDraft(string SalesRepId, int Year, int? Month, decimal Amount);

public sealed record SettlementDraft(string SalesRepId, int Year, int Month);

public sealed record CommissionConfig(
    CommissionSettings Settings,
    IReadOnlyList<CommissionRule> Rules,
    IReadOnlyList<SalesTarget> Targets,
    IReadOnlyList<SalesRep> SalesReps,
    IReadOnlyList<Customer> Customers,
    IReadOnlyList<string> Categories);

/// <summary>Datos iniciales de comisiones (appsettings, sección Commissions:Seed). En la demo dan contenido al dashboard.</summary>
public sealed class CommissionSeed
{
    public string TenantId { get; set; } = "demo";
    public CommissionBasis Basis { get; set; } = CommissionBasis.Cobrado;
    public decimal DefaultRate { get; set; }
    public decimal BonusRate { get; set; }
    public List<SeedRule> Rules { get; set; } = [];
    /// <summary>Objetivo mensual por comercial para el año en curso.</summary>
    public Dictionary<string, decimal> MonthlyTargets { get; set; } = [];
    /// <summary>Solo demo: deja liquidados y pagados los meses del año en curso hasta este (0 = ninguno).</summary>
    public int PaidThroughMonth { get; set; }

    // El enlazado de configuración necesita propiedades con set; los records posicionales no se rellenan.
    public sealed class SeedRule
    {
        public string? Id { get; set; }
        public string? SalesRepId { get; set; }
        public string? CustomerId { get; set; }
        public string? Category { get; set; }
        public decimal Rate { get; set; }
        public DateOnly? ValidFrom { get; set; }
        public DateOnly? ValidTo { get; set; }
        public string? Note { get; set; }
    }

    public void ApplyTo(ICommissionStore store, int year)
    {
        store.SaveSettings(new CommissionSettings(TenantId, Basis, DefaultRate, BonusRate));
        for (var i = 0; i < Rules.Count; i++)
        {
            var r = Rules[i];
            store.SaveRule(new CommissionRule(TenantId, r.Id ?? $"R{i + 1:D3}", r.SalesRepId, r.CustomerId, r.Category, r.Rate, r.ValidFrom, r.ValidTo, r.Note));
        }
        foreach (var (rep, amount) in MonthlyTargets)
            for (var m = 1; m <= 12; m++) store.SaveTarget(new SalesTarget(TenantId, rep, year, m, amount));
    }
}

/// <summary>
/// Solo demo: cuando llega la primera sincronización con facturas, liquida y marca como pagados los meses
/// indicados en Commissions:Seed:PaidThroughMonth, para que el dashboard tenga historial.
/// </summary>
public sealed class DemoSettlementSeeder(IPortalStore store, ICommissionStore commissions, CommissionSeed seed, TimeProvider time, ILogger<DemoSettlementSeeder> log) : BackgroundService
{
    private static readonly UserContext System = new("demo-comisiones", "", Role.PlatformAdmin);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (seed.PaidThroughMonth <= 0) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        while (store.Counts().Invoices == 0 && await timer.WaitForNextTickAsync(stoppingToken)) { }
        var now = time.GetLocalNow();
        var today = DateOnly.FromDateTime(now.DateTime);
        var user = System with { TenantId = seed.TenantId };
        var reps = store.SalesReps(user).Where(r => r.TenantId == seed.TenantId).ToList();
        var dash = CommissionCalculator.Dashboard(now.Year, store.Sales(user, today).Where(s => s.Invoice.TenantId == seed.TenantId).ToList(), reps,
            commissions.Settings(seed.TenantId), commissions.Rules(seed.TenantId), commissions.Targets(seed.TenantId, now.Year), []);
        foreach (var rep in dash.Reps)
            foreach (var m in rep.Months.Where(m => m.Month <= Math.Min(seed.PaidThroughMonth, now.Month - 1)))
            {
                var paid = new DateTimeOffset(new DateTime(now.Year, m.Month, 1).AddMonths(1).AddDays(9), now.Offset);
                commissions.Close(new CommissionSettlement(seed.TenantId, rep.SalesRepId, now.Year, m.Month, m.Base, m.Commission + m.Bonus, paid.AddDays(-5), "Marta Díez", paid));
            }
        log.LogInformation("Demo: comisiones liquidadas hasta el mes {Month}", seed.PaidThroughMonth);
    }
}

public static class CommissionEndpoints
{
    public static void MapCommissions(this RouteGroupBuilder api)
    {
        static DateOnly Today(TimeProvider t) => DateOnly.FromDateTime(t.GetLocalNow().DateTime);
        static IResult Forbidden() => Results.StatusCode(StatusCodes.Status403Forbidden);

        SalesDashboard Build(UserContext user, IPortalStore store, ICommissionStore commissions, int year, string? rep, DateOnly today)
        {
            var reps = store.SalesReps(user).Where(r => rep is null || r.ErpId == rep).ToList();
            var ids = reps.Select(r => r.ErpId).ToHashSet();
            var sales = store.Sales(user, today).Where(s => s.Customer.SalesRepId is { } id && ids.Contains(id)).ToList();
            return CommissionCalculator.Dashboard(year, sales, reps, commissions.Settings(user.TenantId), commissions.Rules(user.TenantId),
                commissions.Targets(user.TenantId, year), commissions.Settlements(user.TenantId, year));
        }

        // Cada comercial ve solo lo suyo; administración ve a todos y puede filtrar por comercial.
        api.MapGet("/sales", (CurrentUser cu, IPortalStore store, ICommissionStore commissions, TimeProvider t, int? year, string? rep) =>
        {
            var user = cu.Get()!;
            if (user.Role == Role.Customer) return Forbidden();
            var today = Today(t);
            if (rep is not null && store.SalesReps(user).All(r => r.ErpId != rep)) return Results.NotFound();
            return Results.Ok(Build(user, store, commissions, year ?? today.Year, rep, today));
        });

        var admin = api.MapGroup("/commissions").AddEndpointFilter(async (ctx, next) =>
            AccessPolicy.IsAdmin(ctx.HttpContext.RequestServices.GetRequiredService<CurrentUser>().Get()!) ? await next(ctx) : Forbidden());

        admin.MapGet("/config", (CurrentUser cu, IPortalStore store, ICommissionStore commissions, TimeProvider t, int? year) =>
        {
            var user = cu.Get()!;
            var customers = store.Customers(user);
            var categories = customers.Count == 0 ? [] : store.Catalog(customers[0]).Select(i => i.Product.Category).OfType<string>().Distinct().Order().ToList();
            return new CommissionConfig(commissions.Settings(user.TenantId), commissions.Rules(user.TenantId), commissions.Targets(user.TenantId, year ?? Today(t).Year),
                store.SalesReps(user), customers, categories);
        });

        admin.MapPut("/settings", (CommissionSettings draft, CurrentUser cu, ICommissionStore commissions) =>
        {
            if (draft.DefaultRate is < 0 or > 100 || draft.BonusRate is < 0 or > 100) return Results.BadRequest(new { errors = new[] { "Los porcentajes van de 0 a 100." } });
            var settings = draft with { TenantId = cu.Get()!.TenantId };
            commissions.SaveSettings(settings);
            return Results.Ok(settings);
        });

        admin.MapPost("/rules", (RuleDraft draft, CurrentUser cu, ICommissionStore commissions) =>
        {
            var errors = new List<string>();
            if (draft.Rate is < 0 or > 100) errors.Add("El porcentaje va de 0 a 100.");
            if (draft.ValidFrom is { } f && draft.ValidTo is { } to && to < f) errors.Add("La fecha de fin es anterior a la de inicio.");
            if (errors.Count > 0) return Results.BadRequest(new { errors });
            static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
            var rule = new CommissionRule(cu.Get()!.TenantId, Clean(draft.Id) ?? "R" + Guid.NewGuid().ToString("N")[..8].ToUpperInvariant(),
                Clean(draft.SalesRepId), Clean(draft.CustomerId), Clean(draft.Category), draft.Rate, draft.ValidFrom, draft.ValidTo, Clean(draft.Note));
            commissions.SaveRule(rule);
            return Results.Ok(rule);
        });

        admin.MapDelete("/rules/{id}", (string id, CurrentUser cu, ICommissionStore commissions) =>
            commissions.DeleteRule(cu.Get()!.TenantId, id) ? Results.NoContent() : Results.NotFound());

        admin.MapPut("/targets", (TargetDraft draft, CurrentUser cu, ICommissionStore commissions) =>
        {
            if (draft.Amount < 0 || draft.Month is < 1 or > 12) return Results.BadRequest(new { errors = new[] { "Objetivo no válido." } });
            var tenant = cu.Get()!.TenantId;
            foreach (var m in draft.Month is { } one ? [one] : Enumerable.Range(1, 12))
                commissions.SaveTarget(new SalesTarget(tenant, draft.SalesRepId, draft.Year, m, draft.Amount));
            return Results.Ok(commissions.Targets(tenant, draft.Year));
        });

        // Cerrar un mes congela la comisión calculada en ese momento. Solo meses ya terminados.
        admin.MapPost("/settlements", (SettlementDraft draft, CurrentUser cu, IPortalStore store, ICommissionStore commissions, TimeProvider t) =>
        {
            var user = cu.Get()!;
            var today = Today(t);
            if (draft.Month is < 1 or > 12 || new DateOnly(draft.Year, draft.Month, 1) > new DateOnly(today.Year, today.Month, 1).AddMonths(-1))
                return Results.BadRequest(new { errors = new[] { "Solo se pueden cerrar meses ya terminados." } });
            if (store.SalesReps(user).All(r => r.ErpId != draft.SalesRepId)) return Results.NotFound();
            var month = Build(user, store, commissions, draft.Year, draft.SalesRepId, today).Reps.Single().Months[draft.Month - 1];
            var settlement = new CommissionSettlement(user.TenantId, draft.SalesRepId, draft.Year, draft.Month, month.Base, month.Commission + month.Bonus, t.GetUtcNow(), cu.Name() ?? user.UserId);
            return commissions.Close(settlement) ? Results.Ok(settlement) : Results.Conflict(new { errors = new[] { "Ese mes ya está cerrado." } });
        });

        admin.MapDelete("/settlements/{rep}/{year:int}/{month:int}", (string rep, int year, int month, CurrentUser cu, ICommissionStore commissions) =>
            commissions.Reopen(cu.Get()!.TenantId, rep, year, month) ? Results.NoContent() : Results.Conflict(new { errors = new[] { "No se puede reabrir: no está cerrado o ya está pagado." } }));

        admin.MapPost("/settlements/{rep}/{year:int}/{month:int}/paid", (string rep, int year, int month, CurrentUser cu, ICommissionStore commissions, TimeProvider t) =>
            commissions.MarkPaid(cu.Get()!.TenantId, rep, year, month, t.GetUtcNow()) ? Results.NoContent() : Results.Conflict(new { errors = new[] { "El mes no está cerrado o ya está pagado." } }));
    }
}
