using Portal.Domain;

namespace Portal.Api;

public sealed class DemoUser
{
    public string Name { get; set; } = "";
    public string TenantId { get; set; } = "demo";
    public Role Role { get; set; }
    public string? SalesRepId { get; set; }
    public List<string> CustomerIds { get; set; } = [];
    public List<string> TeamSalesRepIds { get; set; } = [];
}

/// <summary>
/// Resuelve quién hace la petición. En desarrollo se usa la cabecera X-Demo-User con los usuarios
/// de appsettings (DemoUsers). En producción esto se sustituye por el token de Keycloak (OpenID Connect),
/// cuyas claims traerán empresa, rol, comercial y clientes.
/// </summary>
public sealed class CurrentUser(IHttpContextAccessor http, IConfiguration config)
{
    public UserContext? Get()
    {
        var id = http.HttpContext?.Request.Headers["X-Demo-User"].ToString();
        if (string.IsNullOrEmpty(id)) return null;
        var u = config.GetSection($"DemoUsers:{id}").Get<DemoUser>();
        return u is null ? null : new UserContext(id, u.TenantId, u.Role, u.SalesRepId, u.CustomerIds, u.TeamSalesRepIds);
    }

    public string? Name()
    {
        var id = http.HttpContext?.Request.Headers["X-Demo-User"].ToString();
        return string.IsNullOrEmpty(id) ? null : config[$"DemoUsers:{id}:Name"];
    }
}
