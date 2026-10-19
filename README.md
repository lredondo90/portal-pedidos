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
| GET / POST | `/api/sync` | Estado de la conexión con el ERP / sincronizar ahora (solo administración) |

## Cambiar de ficheros a RFC/BAPI

1. Descargar SAP .NET Connector 3.1 del SAP Support Portal y añadirlo a `Portal.Connectors.SapRfc`.
2. Implementar `SapRfcConnector` con las BAPI indicadas en su cabecera.
3. Poner `Erp:Connector = SapRfc` y los datos de conexión en `Erp:SapRfc`.

El resto del portal no cambia: los dos conectores devuelven el mismo modelo común.

## Próximos pasos

- Almacén PostgreSQL (sustituye al almacén en memoria) usando `db/schema.sql`.
- Inicio de sesión con Keycloak (sustituye a `X-Demo-User`).
- Pasarela de pago (Redsys o Stripe) y avisos por correo.
- Despliegue en contenedores en la nube.
