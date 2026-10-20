import { redirect } from "next/navigation";
import { InstallApp } from "@/components/InstallApp";
import { Nav } from "@/components/Nav";
import { logout } from "@/lib/actions";
import { apiGet, currentUserId, isAdmin, type Me } from "@/lib/api";
import { cartCount, readCart } from "@/lib/cart";

const ROLE_LABEL = { Customer: "Cliente", SalesRep: "Comercial", SalesManager: "Jefe de ventas", CompanyAdmin: "Administración", PlatformAdmin: "Plataforma" };

export default async function PortalLayout({ children }: LayoutProps<"/">) {
  if (!(await currentUserId())) redirect("/login");
  const me = await apiGet<Me>("/api/me");
  if (!me?.user) redirect("/login");
  const role = me.user.role;
  const inCart = cartCount(await readCart());

  const items = [
    { href: "/", label: "Resumen" },
    { href: "/pedidos", label: "Pedidos" },
    { href: "/catalogo", label: "Hacer pedido" },
    ...(inCart > 0 ? [{ href: "/carrito", label: "Carrito", count: inCart }] : []),
    { href: "/entregas", label: "Entregas" },
    { href: "/facturas", label: "Facturas y pagos" },
    role === "Customer" ? { href: "/cuenta", label: "Mi cuenta" } : { href: "/clientes", label: "Clientes" },
    ...(isAdmin(role) ? [{ href: "/sincronizacion", label: "Sincronización" }] : []),
  ];
  const name = me.name ?? me.user.userId;
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <b>Portal de Pedidos</b>
            <small>Empresa {me.user.tenantId}</small>
          </div>
        </div>
        <Nav items={items} />
        <div className="side-foot">
          <div className="who">
            <div className="avatar">{initials}</div>
            <span>
              <b>{name}</b>
              <br />
              <span className="sub">{ROLE_LABEL[role]}</span>
            </span>
          </div>
          <InstallApp />
          <form action={logout}>
            <button className="btn sm" type="submit">Cambiar de usuario</button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
