import { InstallApp } from "@/components/InstallApp";
import { loginDemo } from "@/lib/actions";

const USERS = [
  { id: "ana", ini: "AM", name: "Ana Martín", role: "Cliente · Ferretería Martín S.L." },
  { id: "laura", ini: "LG", name: "Laura Gómez", role: "Comercial · 2 clientes" },
  { id: "javier", ini: "JO", name: "Javier Ortega", role: "Comercial · 1 cliente" },
  { id: "marta", ini: "MD", name: "Marta Díez", role: "Administración · toda la empresa" },
];

export default function LoginPage() {
  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <b>Portal de Pedidos</b>
            <small>Entorno de demostración</small>
          </div>
        </div>
        <section className="panel">
          <div className="panel-h">
            <h2>Entrar como</h2>
          </div>
          <form action={loginDemo} className="panel-b grid" style={{ gap: 8 }}>
            {USERS.map((u) => (
              <button key={u.id} name="user" value={u.id} className="login-opt" type="submit">
                <span className="avatar">{u.ini}</span>
                <span>
                  <b>{u.name}</b>
                  <br />
                  <span className="sub">{u.role}</span>
                </span>
              </button>
            ))}
          </form>
        </section>
        <InstallApp />
        <p className="sub">Usuarios de ejemplo. En producción se entrará con correo y contraseña o con la cuenta corporativa.</p>
      </div>
    </main>
  );
}
