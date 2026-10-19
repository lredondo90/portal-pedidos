namespace Portal.Domain;

public enum Role { PlatformAdmin, CompanyAdmin, SalesManager, SalesRep, Customer }

/// <summary>Quién hace la petición y qué parte de los datos puede ver.</summary>
public sealed record UserContext(
    string UserId,
    string TenantId,
    Role Role,
    string? SalesRepId = null,
    IReadOnlyCollection<string>? CustomerIds = null,
    IReadOnlyCollection<string>? TeamSalesRepIds = null);

public static class AccessPolicy
{
    public static bool CanSeeTenant(UserContext user, string tenantId) =>
        user.Role == Role.PlatformAdmin || user.TenantId == tenantId;

    public static bool CanSeeCustomer(UserContext user, Customer customer)
    {
        if (!CanSeeTenant(user, customer.TenantId)) return false;
        return user.Role switch
        {
            Role.PlatformAdmin or Role.CompanyAdmin => true,
            Role.SalesManager => customer.SalesRepId is not null
                && (customer.SalesRepId == user.SalesRepId || (user.TeamSalesRepIds?.Contains(customer.SalesRepId) ?? false)),
            Role.SalesRep => customer.SalesRepId is not null && customer.SalesRepId == user.SalesRepId,
            Role.Customer => user.CustomerIds?.Contains(customer.ErpId) ?? false,
            _ => false,
        };
    }

    public static bool IsAdmin(UserContext user) => user.Role is Role.PlatformAdmin or Role.CompanyAdmin;
}

public static class InvoiceRules
{
    public static InvoiceStatus StatusOf(Invoice invoice, PaymentUpdate? payment, DateOnly today) =>
        payment is { Cleared: true } ? InvoiceStatus.Pagada
        : invoice.DueDate < today ? InvoiceStatus.Vencida
        : InvoiceStatus.Pendiente;
}
