using System.Collections.Concurrent;
using System.Text.Json.Serialization;

namespace Portal.Domain;

// Ventas y comisiones. Las ventas salen de las facturas y cobros que ya llegan del ERP;
// las reglas de comisión, los objetivos y las liquidaciones son datos propios del portal
// (no existen en SAP) y los gestiona administración desde la web.

/// <summary>Sobre qué se calcula la comisión: lo cobrado (fecha de cobro) o lo facturado (fecha de factura).</summary>
public enum CommissionBasis { Cobrado, Facturado }

/// <summary>
/// Configuración de la empresa. DefaultRate se aplica cuando ninguna regla encaja.
/// BonusRate es un % extra sobre la parte de la base del mes que supera el objetivo del comercial.
/// </summary>
public sealed record CommissionSettings(string TenantId, CommissionBasis Basis, decimal DefaultRate, decimal BonusRate);

/// <summary>
/// Porcentaje de comisión. Los campos vacíos valen para todos; gana la regla más concreta
/// (cliente, después familia, después comercial) vigente en la fecha de la venta.
/// </summary>
public sealed record CommissionRule(
    string TenantId,
    string Id,
    string? SalesRepId,
    string? CustomerId,
    string? Category,
    decimal Rate,
    DateOnly? ValidFrom = null,
    DateOnly? ValidTo = null,
    string? Note = null)
{
    public bool Matches(string salesRepId, string customerId, string? category, DateOnly date) =>
        (SalesRepId is null || SalesRepId == salesRepId)
        && (CustomerId is null || CustomerId == customerId)
        && (Category is null || Category == category)
        && (ValidFrom is null || date >= ValidFrom)
        && (ValidTo is null || date <= ValidTo);

    [JsonIgnore]
    public int Specificity => (CustomerId is null ? 0 : 4) + (Category is null ? 0 : 2) + (SalesRepId is null ? 0 : 1);
}

/// <summary>Objetivo de ventas (base de comisión) de un comercial en un mes.</summary>
public sealed record SalesTarget(string TenantId, string SalesRepId, int Year, int Month, decimal Amount);

/// <summary>Liquidación de un mes cerrado: congela la base y la comisión aunque luego cambien reglas o datos.</summary>
public sealed record CommissionSettlement(
    string TenantId,
    string SalesRepId,
    int Year,
    int Month,
    decimal Base,
    decimal Commission,
    DateTimeOffset ClosedAt,
    string ClosedBy,
    DateTimeOffset? PaidAt = null);

/// <summary>Parte de una factura que corresponde a una familia de artículos (la comisión puede variar por familia).</summary>
public sealed record SaleShare(string? Category, decimal NetAmount);

/// <summary>Factura vista como venta: su cliente, si está cobrada y cómo se reparte por familias.</summary>
public sealed record SaleView(Invoice Invoice, Customer Customer, InvoiceStatus Status, DateOnly? PaidDate, IReadOnlyList<SaleShare> Shares);

public sealed record CommissionLine(
    string SalesRepId,
    string InvoiceId,
    string CustomerId,
    string CustomerName,
    string? Category,
    DateOnly Date,
    decimal Base,
    decimal Rate,
    decimal Commission);

public sealed record MonthFigures(
    int Month,
    decimal Invoiced,
    decimal Collected,
    decimal Base,
    decimal Commission,
    decimal Bonus,
    decimal? Target,
    CommissionSettlement? Settlement)
{
    /// <summary>Lo que se paga: lo liquidado si el mes está cerrado, si no el cálculo actual.</summary>
    public decimal Total => Settlement?.Commission ?? Commission + Bonus;
}

public sealed record RepSales(
    string SalesRepId,
    string Name,
    IReadOnlyList<MonthFigures> Months,
    decimal Invoiced,
    decimal Collected,
    decimal Commission,
    decimal? Target,
    decimal PendingCollection,
    decimal Overdue);

public sealed record Ranked(string Id, string Name, decimal Amount);

public sealed record SalesDashboard(
    int Year,
    CommissionBasis Basis,
    IReadOnlyList<RepSales> Reps,
    IReadOnlyList<MonthFigures> Months,
    IReadOnlyList<Ranked> TopCustomers,
    IReadOnlyList<Ranked> Categories,
    IReadOnlyList<CommissionLine> Lines);

public static class CommissionCalculator
{
    public static decimal Round(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    public static decimal RateFor(IEnumerable<CommissionRule> rules, CommissionSettings settings, string salesRepId, string customerId, string? category, DateOnly date) =>
        rules.Where(r => r.Matches(salesRepId, customerId, category, date))
            .OrderByDescending(r => r.Specificity).ThenByDescending(r => r.ValidFrom ?? DateOnly.MinValue)
            .Select(r => (decimal?)r.Rate).FirstOrDefault() ?? settings.DefaultRate;

    /// <summary>
    /// Ventas, comisiones y objetivos del año. Cada venta cuenta para el comercial actual del cliente.
    /// Con base "Cobrado" una factura entra en el mes en que se cobra y solo si está cobrada.
    /// </summary>
    public static SalesDashboard Dashboard(
        int year,
        IReadOnlyList<SaleView> sales,
        IReadOnlyList<SalesRep> reps,
        CommissionSettings settings,
        IReadOnlyList<CommissionRule> rules,
        IReadOnlyList<SalesTarget> targets,
        IReadOnlyList<CommissionSettlement> settlements)
    {
        var mine = sales.Where(s => s.Customer.SalesRepId is not null).ToList();
        DateOnly? BaseDate(SaleView s) => settings.Basis == CommissionBasis.Cobrado ? s.PaidDate : s.Invoice.Date;

        var lines = mine
            .Where(s => BaseDate(s) is { } d && d.Year == year)
            .SelectMany(s => s.Shares.Select(sh =>
            {
                var date = BaseDate(s)!.Value;
                var rate = RateFor(rules, settings, s.Customer.SalesRepId!, s.Customer.ErpId, sh.Category, date);
                return new CommissionLine(s.Customer.SalesRepId!, s.Invoice.ErpId, s.Customer.ErpId, s.Customer.Name, sh.Category, date, sh.NetAmount, rate, Round(sh.NetAmount * rate / 100m));
            }))
            .OrderByDescending(l => l.Date).ThenBy(l => l.InvoiceId)
            .ToList();

        var repIds = reps.Select(r => r.ErpId).Union(mine.Select(s => s.Customer.SalesRepId!)).Distinct().ToList();
        var repSales = repIds.Select(id =>
        {
            var months = Enumerable.Range(1, 12).Select(m =>
            {
                var monthLines = lines.Where(l => l.SalesRepId == id && l.Date.Month == m).ToList();
                var b = monthLines.Sum(l => l.Base);
                var target = targets.FirstOrDefault(t => t.SalesRepId == id && t.Year == year && t.Month == m)?.Amount;
                var bonus = target is { } t && b > t ? Round((b - t) * settings.BonusRate / 100m) : 0m;
                return new MonthFigures(m,
                    Invoiced: mine.Where(s => s.Customer.SalesRepId == id && s.Invoice.Date.Year == year && s.Invoice.Date.Month == m).Sum(s => s.Invoice.NetAmount),
                    Collected: mine.Where(s => s.Customer.SalesRepId == id && s.PaidDate is { } p && p.Year == year && p.Month == m).Sum(s => s.Invoice.NetAmount),
                    Base: b,
                    Commission: monthLines.Sum(l => l.Commission),
                    Bonus: bonus,
                    Target: target,
                    Settlement: settlements.FirstOrDefault(x => x.SalesRepId == id && x.Year == year && x.Month == m));
            }).ToList();
            var open = mine.Where(s => s.Customer.SalesRepId == id && s.Status != InvoiceStatus.Pagada).ToList();
            var yearTargets = targets.Where(t => t.SalesRepId == id && t.Year == year).ToList();
            return new RepSales(id, reps.FirstOrDefault(r => r.ErpId == id)?.Name ?? id, months,
                months.Sum(m => m.Invoiced), months.Sum(m => m.Collected), months.Sum(m => m.Total),
                yearTargets.Count > 0 ? yearTargets.Sum(t => t.Amount) : null,
                open.Sum(s => s.Invoice.NetAmount), open.Where(s => s.Status == InvoiceStatus.Vencida).Sum(s => s.Invoice.NetAmount));
        }).OrderBy(r => r.Name).ToList();

        var totals = Enumerable.Range(1, 12).Select(m =>
        {
            var ms = repSales.Select(r => r.Months[m - 1]).ToList();
            var withTarget = ms.Where(x => x.Target is not null).ToList();
            return new MonthFigures(m, ms.Sum(x => x.Invoiced), ms.Sum(x => x.Collected), ms.Sum(x => x.Base), ms.Sum(x => x.Commission), ms.Sum(x => x.Bonus),
                withTarget.Count > 0 ? withTarget.Sum(x => x.Target!.Value) : null, null);
        }).ToList();

        var invoicedThisYear = mine.Where(s => s.Invoice.Date.Year == year).ToList();
        var topCustomers = invoicedThisYear.GroupBy(s => s.Customer.ErpId)
            .Select(g => new Ranked(g.Key, g.First().Customer.Name, g.Sum(s => s.Invoice.NetAmount)))
            .OrderByDescending(r => r.Amount).Take(10).ToList();
        var categories = invoicedThisYear.SelectMany(s => s.Shares).GroupBy(sh => sh.Category ?? "Sin familia")
            .Select(g => new Ranked(g.Key, g.Key, g.Sum(sh => sh.NetAmount)))
            .OrderByDescending(r => r.Amount).ToList();

        return new SalesDashboard(year, settings.Basis, repSales, totals, topCustomers, categories, lines);
    }

    /// <summary>Reparte el neto de una factura entre las familias de los artículos de su pedido, cuadrando el redondeo en la última.</summary>
    public static IReadOnlyList<SaleShare> Split(decimal invoiceNet, IReadOnlyList<(string? Category, decimal Net)> lines)
    {
        var groups = lines.GroupBy(l => l.Category).Select(g => (Category: g.Key, Net: g.Sum(l => l.Net))).OrderByDescending(g => g.Net).ToList();
        var orderNet = groups.Sum(g => g.Net);
        if (groups.Count == 0 || orderNet == 0) return [new SaleShare(null, invoiceNet)];
        var shares = new List<SaleShare>();
        var left = invoiceNet;
        for (var i = 0; i < groups.Count; i++)
        {
            var amount = i == groups.Count - 1 ? left : Round(invoiceNet * groups[i].Net / orderNet);
            shares.Add(new SaleShare(groups[i].Category, amount));
            left -= amount;
        }
        return shares;
    }
}

/// <summary>Reglas, objetivos y liquidaciones de comisiones. Esta versión vive en memoria; en producción, tablas de db/schema.sql.</summary>
public interface ICommissionStore
{
    CommissionSettings Settings(string tenantId);
    void SaveSettings(CommissionSettings settings);
    IReadOnlyList<CommissionRule> Rules(string tenantId);
    void SaveRule(CommissionRule rule);
    bool DeleteRule(string tenantId, string id);
    IReadOnlyList<SalesTarget> Targets(string tenantId, int year);
    void SaveTarget(SalesTarget target);
    IReadOnlyList<CommissionSettlement> Settlements(string tenantId, int year);
    /// <summary>Cierra un mes. Devuelve false si ya estaba cerrado.</summary>
    bool Close(CommissionSettlement settlement);
    bool Reopen(string tenantId, string salesRepId, int year, int month);
    bool MarkPaid(string tenantId, string salesRepId, int year, int month, DateTimeOffset at);
}

public sealed class InMemoryCommissionStore : ICommissionStore
{
    private readonly ConcurrentDictionary<string, CommissionSettings> _settings = new();
    private readonly ConcurrentDictionary<string, CommissionRule> _rules = new();
    private readonly ConcurrentDictionary<string, SalesTarget> _targets = new();
    private readonly ConcurrentDictionary<string, CommissionSettlement> _settlements = new();

    private static string MonthKey(string tenant, string rep, int year, int month) => $"{tenant}|{rep}|{year}|{month}";

    public CommissionSettings Settings(string tenantId) =>
        _settings.GetValueOrDefault(tenantId) ?? new CommissionSettings(tenantId, CommissionBasis.Cobrado, 0m, 0m);

    public void SaveSettings(CommissionSettings settings) => _settings[settings.TenantId] = settings;

    public IReadOnlyList<CommissionRule> Rules(string tenantId) =>
        _rules.Values.Where(r => r.TenantId == tenantId).OrderBy(r => r.Specificity).ThenBy(r => r.SalesRepId).ThenBy(r => r.Category).ThenBy(r => r.CustomerId).ToList();

    public void SaveRule(CommissionRule rule) => _rules[rule.TenantId + "|" + rule.Id] = rule;

    public bool DeleteRule(string tenantId, string id) => _rules.TryRemove(tenantId + "|" + id, out _);

    public IReadOnlyList<SalesTarget> Targets(string tenantId, int year) =>
        _targets.Values.Where(t => t.TenantId == tenantId && t.Year == year).OrderBy(t => t.SalesRepId).ThenBy(t => t.Month).ToList();

    public void SaveTarget(SalesTarget target)
    {
        var k = MonthKey(target.TenantId, target.SalesRepId, target.Year, target.Month);
        if (target.Amount <= 0) _targets.TryRemove(k, out _);
        else _targets[k] = target;
    }

    public IReadOnlyList<CommissionSettlement> Settlements(string tenantId, int year) =>
        _settlements.Values.Where(s => s.TenantId == tenantId && s.Year == year).OrderBy(s => s.SalesRepId).ThenBy(s => s.Month).ToList();

    public bool Close(CommissionSettlement settlement) =>
        _settlements.TryAdd(MonthKey(settlement.TenantId, settlement.SalesRepId, settlement.Year, settlement.Month), settlement);

    // Un mes ya pagado no se reabre: el pago está hecho.
    public bool Reopen(string tenantId, string salesRepId, int year, int month)
    {
        var k = MonthKey(tenantId, salesRepId, year, month);
        return _settlements.TryGetValue(k, out var s) && s.PaidAt is null && _settlements.TryRemove(k, out _);
    }

    public bool MarkPaid(string tenantId, string salesRepId, int year, int month, DateTimeOffset at)
    {
        var k = MonthKey(tenantId, salesRepId, year, month);
        return _settlements.TryGetValue(k, out var s) && s.PaidAt is null && _settlements.TryUpdate(k, s with { PaidAt = at }, s);
    }
}
