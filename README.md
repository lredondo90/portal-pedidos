# Portal de Pedidos

Portal web donde clientes, comerciales y administración consultan pedidos, entregas, seguimiento del transporte,
facturas en PDF y pagos. Hoy se alimenta de SAP R/3 ECC por ficheros de exportación y está preparado para
RFC/BAPI y para otros ERP mediante conectores.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `src/Portal.Domain` | Modelo común (cliente, pedido, entrega, factura, cobro), contrato `IErpConnector`, reglas de visibilidad por rol |
| `src/Portal.Connectors.SapFiles` | Conector SAP ECC por ficheros CSV (activo) |
| `src/Portal.Connectors.SapRfc` | Conector SAP ECC por RFC/BAPI (preparado, pendiente de SAP .NET Connector) |
| `src/Portal.Api` | API ASP.NET Core (.NET 10) con sincronización periódica |
| `web` | Web Next.js para clientes, comerciales y administración (ver `web/README.md`) |
| `tests/Portal.Tests` | Pruebas de importación, estados y permisos |
| `db/schema.sql` | Esquema PostgreSQL con seguridad a nivel de fila por empresa, cartera y cliente |
| `docs/formato-ficheros-sap.md` | Especificación de los ficheros que debe exportar SAP |
| `samples/sap-export` | Ficheros de ejemplo con el formato real |

## Arrancar en local

Requiere el SDK de .NET 10.

```bash
dotnet test
cd src/Portal.Api && dotnet run
```

La API importa al arrancar los ficheros de `samples/sap-export` y vuelve a mirar cada 5 minutos (`Erp:SyncMinutes`).
En desarrollo el usuario se indica con la cabecera `X-Demo-User` (`ana` cliente, `laura` y `javier` comerciales, `marta` administración):

```bash
curl -H "X-Demo-User: laura" http://localhost:5103/api/orders
curl -H "X-Demo-User: ana" http://localhost:5103/api/orders/demo/0000125529
curl -H "X-Demo-User: marta" http://localhost:5103/api/sync
```

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/me` | Usuario actual y su alcance |
| GET | `/api/customers` | Clientes visibles |
| GET | `/api/orders?status=&customer=&q=` | Pedidos visibles, con filtros |
| GET | `/api/orders/{empresa}/{pedido}` | Detalle con líneas, entregas, seguimiento y facturas |
| GET | `/api/deliveries?customer=` | Entregas visibles con su último evento de seguimiento |
| GET | `/api/invoices?status=` | Facturas con estado Pendiente, Vencida o Pagada |
| GET | `/api/documents/{empresa}/{Invoice\|DeliveryNote}/{id}` | PDF de factura o albarán |
| GET | `/api/catalog?customer=&q=&category=` | Catálogo con los precios del cliente y sus direcciones de entrega |
| POST | `/api/order-requests` | Hacer un pedido: cliente, referencia, fecha, dirección y líneas (artículo y cantidad). Los precios los calcula la API |
| GET | `/api/order-requests?customer=` | Pedidos hechos en el portal y su estado (pendiente de SAP, creado o rechazado) |
| GET / POST | `/api/sync` | Estado de la conexión con el ERP / sincronizar ahora (solo administración) |

## Cambiar de ficheros a RFC/BAPI

1. Descargar SAP .NET Connector 3.1 del SAP Support Portal y añadirlo a `Portal.Connectors.SapRfc`.
2. Implementar `SapRfcConnector` con las BAPI indicadas en su cabecera.
3. Poner `Erp:Connector = SapRfc` y los datos de conexión en `Erp:SapRfc`.

El resto del portal no cambia: los dos conectores devuelven el mismo modelo común.

## Pedidos desde el portal

El cliente (o su comercial) elige artículos del catálogo, los añade al carrito y envía el pedido.
La API calcula precios e IVA con la tarifa del cliente y deja el fichero `PEDIDO_ENTRADA_<id>.csv` en `Erp:SapFiles:OutboxPath`.
Un programa ABAP lo convierte en pedido de venta y responde con un fichero `CONFIRMACIONES` (formato en `docs/formato-ficheros-sap.md`).

En local y en la demo está activado un SAP simulado (`Erp:SapFiles:SimulateSap = true`) que crea el pedido a los pocos segundos.
Escribe sus ficheros en la carpeta de ejemplos con segundos en el nombre (no se suben a git); bórralos para volver a los datos iniciales.

## Ventas y comisiones

Página «Ventas y comisiones» para comerciales (solo lo suyo) y administración (todos, con filtro por comercial).
Las ventas salen de las facturas y cobros de SAP; las reglas de comisión, los objetivos y las liquidaciones son datos propios
del portal (tablas `commission_*` y `sales_target` en `db/schema.sql`) y se gestionan en «Reglas y objetivos».

- Comisión sobre lo cobrado (fecha de cobro) o lo facturado (fecha de factura), a elegir.
- Porcentaje por comercial, familia de artículo o cliente, con vigencia opcional. Gana la regla más concreta: cliente > familia > comercial > general.
- Objetivo mensual por comercial y % extra sobre lo que lo supere.
- Liquidar un mes congela su comisión; después se marca como pagada.

Los datos iniciales de la demo están en `Commissions:Seed` (appsettings) y el histórico de ventas de 2026 en los ficheros `*_20260101_*` y `*_20261015_*`
de `samples/sap-export`. Mientras el almacén sea en memoria, los cambios en reglas y liquidaciones se pierden al reiniciar la API.

## App en el móvil y Google Play

La web es una app instalable (PWA): `web/src/app/manifest.ts`, iconos en `web/public` y un service worker (`web/public/sw.js`)
que guarda los ficheros estáticos, la página `offline.html` y la de pedidos sin cobertura.
En Android y en el ordenador aparece el botón «Instalar la app»; en iPhone se indica Compartir → «Añadir a pantalla de inicio».

Para publicarla en Google Play se empaqueta como Trusted Web Activity, sin código Android propio:

1. Crear la cuenta de desarrollador en Google Play Console (pago único de 25 $).
2. En https://www.pwabuilder.com escribir la dirección del portal y generar el paquete Android (id propuesto: `es.portalpedidos.app`).
3. Subir el `.aab` a Play Console. En «Integridad de la app» copiar la huella SHA-256 de la firma.
4. Poner en la app web `ANDROID_PACKAGE` y `ANDROID_SHA256` (varias huellas separadas por comas, incluida la de la clave de subida).
   `/.well-known/assetlinks.json` las publica y la app abre a pantalla completa, sin barra del navegador.

Las cuentas personales nuevas deben pasar una prueba cerrada con 12 personas durante 14 días antes de publicar; las de empresa no.

## Pedidos sin cobertura

Pensado para zonas con mala señal. Al abrir el portal con conexión, el móvil guarda en IndexedDB los datos de la cartera
del usuario (`GET /api/offline-pack`: sus clientes, direcciones, artículos y precios especiales; administración no lo usa).
En `/sin-conexion` (página estática que el service worker sirve sin red) el comercial hace el pedido; se guarda en el móvil
y se envía solo al volver la señal: al abrir la app, al volver a ella, al recuperar la red y cada 30 s; en Android también
con la app cerrada (Background Sync). iPhone no tiene envío en segundo plano.

- Cada pedido lleva un id del móvil (`clientId`). Si se reenvía porque se cortó la conexión, la API devuelve el que ya
  existe (200) en lugar de crear otro; dos envíos simultáneos del mismo id se frenan con 409.
- Los precios del móvil son orientativos: la API vuelve a calcular el precio al recibir el pedido. La pantalla muestra la
  fecha de la última sincronización con SAP y avisa pasadas 24 h.
- Si al llegar el pedido ya no es válido (p. ej. la fecha de entrega ya pasó) queda en «Revisar» para cambiar la fecha o borrarlo.
- Cada pedido solo se envía con la sesión de quien lo hizo; al cambiar de usuario se borran los datos de la cartera del móvil.
  La sesión dura 30 días para que los pedidos guardados puedan salir aunque la app se cierre.
- Código: `web/src/lib/offline.ts`, `web/src/components/OfflineOrders.tsx`, `web/public/sw.js`.

## Próximos pasos

- Almacén PostgreSQL (sustituye al almacén en memoria) usando `db/schema.sql`.
- Inicio de sesión con Keycloak (sustituye a `X-Demo-User`).
- Pasarela de pago (Redsys o Stripe) y avisos por correo.
- Despliegue en contenedores en la nube.
