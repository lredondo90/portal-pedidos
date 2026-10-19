using System.Text.Json.Serialization;
using Portal.Api;
using Portal.Connectors.SapFiles;
using Portal.Connectors.SapRfc;
using Portal.Domain;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IPortalStore, InMemoryPortalStore>();
builder.Services.AddScoped<CurrentUser>();

// Conector activo: "SapFiles" hoy, "SapRfc" cuando se instale SAP .NET Connector.
var connector = builder.Configuration.GetValue("Erp:Connector", "SapFiles");
if (connector == "SapRfc")
{
    builder.Services.AddSingleton(builder.Configuration.GetSection("Erp:SapRfc").Get<SapRfcOptions>() ?? new());
    builder.Services.AddSingleton<IErpConnector, SapRfcConnector>();
}
else
{
    var files = builder.Configuration.GetSection("Erp:SapFiles").Get<SapFileOptions>() ?? new();
    files.InboxPath = Path.GetFullPath(files.InboxPath, builder.Environment.ContentRootPath);
    builder.Services.AddSingleton(files);
    builder.Services.AddSingleton<IErpConnector, SapFileConnector>();
}
builder.Services.AddSingleton<SyncService>();
builder.Services.AddHostedService<SyncWorker>();

var app = builder.Build();

DateOnly Today(TimeProvider t) => DateOnly.FromDateTime(t.GetLocalNow().DateTime);

var api = app.MapGroup("/api").AddEndpointFilter(async (ctx, next) =>
{
    var user = ctx.HttpContext.RequestServices.GetRequiredService<CurrentUser>().Get();
    return user is null ? Results.Unauthorized() : await next(ctx);
});

api.MapGet("/me", (CurrentUser cu) => new { user = cu.Get(), name = cu.Name() });

api.MapGet("/customers", (CurrentUser cu, IPortalStore store) => store.Customers(cu.Get()!));

api.MapGet("/orders", (CurrentUser cu, IPortalStore store, TimeProvider t, OrderStatus? status, string? customer, string? q) =>
    store.Orders(cu.Get()!, new OrderQuery(status, customer, q), Today(t)).Select(OrderSummary.From));

api.MapGet("/orders/{tenant}/{id}", (string tenant, string id, CurrentUser cu, IPortalStore store, TimeProvider t) =>
    store.Order(cu.Get()!, tenant, id, Today(t)) is { } o ? Results.Ok(o) : Results.NotFound());

api.MapGet("/deliveries", (CurrentUser cu, IPortalStore store, TimeProvider t, string? customer) =>
    store.Orders(cu.Get()!, new OrderQuery(CustomerId: customer), Today(t))
        .SelectMany(o => o.Deliveries.Select(d => new DeliverySummary(o.Order.TenantId, d.Delivery.ErpId, o.Order.ErpId, o.Order.CustomerId, o.Customer?.Name,
            d.Delivery.GoodsIssueDate, d.Delivery.Carrier, d.Delivery.TrackingNumber, d.Delivery.Packages, d.Delivery.WeightKg, d.Delivered, d.Events.FirstOrDefault())))
        .OrderByDescending(d => d.GoodsIssueDate));

api.MapGet("/invoices", (CurrentUser cu, IPortalStore store, TimeProvider t, InvoiceStatus? status) =>
    store.Invoices(cu.Get()!, status, Today(t)));

api.MapGet("/documents/{tenant}/{kind}/{id}", async (string tenant, DocumentKind kind, string id, CurrentUser cu, IPortalStore store, IErpConnector erp, CancellationToken ct) =>
{
    var user = cu.Get()!;
    string? file;
    if (kind == DocumentKind.Invoice) { if (store.FindInvoice(user, tenant, id) is not { } inv) return Results.NotFound(); file = inv.PdfFile; }
    else { if (store.FindDelivery(user, tenant, id) is not { } del) return Results.NotFound(); file = del.PdfFile; }
    var stream = await erp.OpenDocumentAsync(tenant, kind, id, file, ct);
    return stream is null ? Results.NotFound() : Results.File(stream, "application/pdf", $"{(kind == DocumentKind.Invoice ? "Factura" : "Albaran")}_{id}.pdf");
});

api.MapGet("/sync", async (CurrentUser cu, SyncService sync, IErpConnector erp, IPortalStore store, CancellationToken ct) =>
    AccessPolicy.IsAdmin(cu.Get()!)
        ? Results.Ok(new { connector = sync.ConnectorName, health = await erp.CheckHealthAsync(ct), counts = store.Counts(), runs = sync.History })
        : Results.StatusCode(StatusCodes.Status403Forbidden));

api.MapPost("/sync", async (CurrentUser cu, SyncService sync, CancellationToken ct) =>
    AccessPolicy.IsAdmin(cu.Get()!) ? Results.Ok(await sync.RunAsync(ct)) : Results.StatusCode(StatusCodes.Status403Forbidden));

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();

public sealed record OrderSummary(string TenantId, string Id, DateOnly Date, string CustomerId, string? CustomerName, string? CustomerReference, DateOnly? RequestedDate, OrderStatus Status, decimal Total, string Currency)
{
    public static OrderSummary From(OrderView v) =>
        new(v.Order.TenantId, v.Order.ErpId, v.Order.OrderDate, v.Order.CustomerId, v.Customer?.Name, v.Order.CustomerReference, v.Order.RequestedDate, v.Status, v.Order.Total, v.Order.Currency);
}

public sealed record DeliverySummary(string TenantId, string Id, string OrderId, string CustomerId, string? CustomerName, DateOnly? GoodsIssueDate,
    string? Carrier, string? TrackingNumber, int? Packages, decimal? WeightKg, bool Delivered, TrackingEvent? LastEvent);

public partial class Program;
