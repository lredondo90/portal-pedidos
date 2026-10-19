# Web del Portal de Pedidos

Next.js (App Router) con React Server Components. Las páginas se generan en el servidor llamando a la API .NET;
el navegador nunca habla directamente con la API.

## Arrancar en local

Primero la API (desde la raíz del repositorio):

```bash
cd src/Portal.Api && dotnet run
```

Después la web:

```bash
cd web
npm install
npm run dev
```

Abre http://localhost:3000 y elige un usuario de ejemplo (cliente, comerciales o administración).
La dirección de la API se cambia con la variable `PORTAL_API_URL` (por defecto `http://127.0.0.1:5103`).

## Pantallas

| Ruta | Pantalla |
| --- | --- |
| `/` | Resumen con pedidos abiertos, en camino, facturas pendientes y vencidas |
| `/pedidos` | Lista con búsqueda, filtro por estado y por cliente |
| `/pedidos/{empresa}/{pedido}` | Detalle: líneas, entrega, seguimiento del transporte, factura y PDF |
| `/entregas` | Albaranes y último evento del transportista |
| `/facturas` | Facturas con vencimiento, estado de pago y PDF |
| `/clientes` | Cartera (comerciales) o todos los clientes (administración) |
| `/cuenta` | Datos del cliente (solo clientes) |
| `/sincronizacion` | Estado de la conexión con SAP y botón para sincronizar (solo administración) |
| `/documentos/...` | Descarga de PDF a través de la API, que comprueba permisos |

La selección de usuario es provisional: se sustituirá por el inicio de sesión con Keycloak.
