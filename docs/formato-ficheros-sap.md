# Formato de los ficheros de exportación desde SAP ECC

Este documento es para quien programe el job de exportación en SAP (ABAP). El portal importa estos ficheros
cada pocos minutos; cuando se active el conector RFC/BAPI, los mismos datos llegarán por esa vía y el portal no cambia.

Hay ejemplos completos en [`samples/sap-export`](../samples/sap-export).

## Reglas generales

| Regla | Valor |
| --- | --- |
| Codificación | UTF-8 (con o sin BOM) |
| Separador | Punto y coma `;` |
| Cabecera | Primera fila con los nombres de columna. El orden de columnas no importa; las columnas que sobren se ignoran |
| Comillas | Opcionales. Obligatorias si el texto contiene `;`. Una comilla dentro del texto se escribe `""` |
| Fechas | Formato interno SAP `AAAAMMDD`. `00000000` o vacío = sin fecha |
| Horas | `HHMMSS` |
| Importes y cantidades | Punto decimal y sin separador de miles (`1234.56`). También se acepta `1.234,56`. Signo negativo al final como en SAP (`150,00-`) |
| Números de documento | Con ceros a la izquierda tal como están en SAP (`0000125529`) |
| Nombre del fichero | `<TIPO>_<AAAAMMDD>_<HHMM>.csv`, por ejemplo `PEDIDOS_20261019_1400.csv`. Se pueden añadir los segundos (`_HHMMSS`) si se generan varios ficheros en el mismo minuto |
| Contenido | Cambios desde la exportación anterior (o todo, si es más sencillo). El portal actualiza por clave, así que repetir filas no duplica nada |
| Carpeta | Una carpeta de entrada por empresa (SFTP o carpeta compartida). Los PDF van en la subcarpeta `pdf/` |
| Frecuencia recomendada | Cada hora en horario laboral (cada 15 minutos si el sistema lo permite) |

El portal procesa los ficheros en orden de marca de tiempo y, dentro de la misma marca, en el orden de la tabla siguiente.
Una fila con errores se registra en la pantalla de Sincronización y no detiene el resto de la importación.

## Ficheros

### CLIENTES

Una fila por cliente. Origen: KNA1, KNVV, KNKK y KNVP (interlocutor empleado de ventas, normalmente función `VE`).

| Columna | Obligatoria | Origen SAP | Descripción |
| --- | --- | --- | --- |
| KUNNR | Sí | KNA1-KUNNR | Número de cliente |
| NAME1 | Sí | KNA1-NAME1 | Razón social |
| STCD1 | | KNA1-STCD1 | NIF |
| STRAS, PSTLZ, ORT01 | | KNA1 | Calle, código postal y población |
| ZTERM_TEXTO | | KNVV-ZTERM + texto (TVZBT) | Condiciones de pago en texto, por ejemplo `Transferencia 30 días` |
| KLIMK | | KNKK-KLIMK | Límite de crédito |
| VEND_ID | | KNVP-PERNR (PARVW = VE) | Código del comercial. Define su cartera en el portal |
| VEND_NOMBRE | | PA0002 o tabla propia | Nombre del comercial |
| VEND_EMAIL | | PA0105 o tabla propia | Correo del comercial (lo usa para entrar al portal) |

### PEDIDOS

Una fila por posición de pedido; el portal agrupa por `VBELN`. Origen: VBAK, VBAP, VBKD, VBEP y VBUK.

| Columna | Obligatoria | Origen SAP | Descripción |
| --- | --- | --- | --- |
| VBELN | Sí | VBAK-VBELN | Número de pedido |
| POSNR | Sí | VBAP-POSNR | Posición |
| ERDAT | Sí | VBAK-ERDAT | Fecha de creación |
| KUNNR | Sí | VBAK-KUNNR | Solicitante |
| BSTKD | | VBKD-BSTKD | Referencia de pedido del cliente |
| VDATU | | VBAK-VDATU | Fecha de entrega solicitada |
| INCO1 | | VBKD-INCO1 | Incoterm |
| WAERK | | VBAK-WAERK | Moneda (por defecto EUR) |
| MATNR | Sí | VBAP-MATNR | Material |
| ARKTX | | VBAP-ARKTX | Descripción de la posición |
| KWMENG | Sí | VBAP-KWMENG | Cantidad |
| VRKME | | VBAP-VRKME | Unidad de venta |
| NETPR | | VBAP-NETPR / KPEIN | Precio neto por unidad |
| NETWR | Sí | VBAP-NETWR | Importe neto de la posición |
| MWSBP | | VBAP-MWSBP | IVA de la posición |
| LFSTK | | VBUK-LFSTK | Estado de entrega (A, B, C) |
| WBSTK | | VBUK-WBSTK | Estado de salida de mercancías |
| FKSTK | | VBUK-FKSTK | Estado de facturación |
| ABSTK | | VBUK-ABSTK | Estado de rechazo (C = pedido anulado) |

Estado que ve el usuario, de mayor a menor prioridad:

| Condición | Estado en el portal |
| --- | --- |
| ABSTK = C | Anulado |
| FKSTK = C | Facturado |
| WBSTK = C | Enviado (pasa a Entregado cuando el seguimiento marca la entrega) |
| LFSTK = B o C | En preparación |
| Resto | Abierto |

### ENTREGAS

Una fila por entrega. Origen: LIKP, VBFA (pedido de referencia) y datos de transporte (VTTK o campos propios).

| Columna | Obligatoria | Origen SAP | Descripción |
| --- | --- | --- | --- |
| VBELN | Sí | LIKP-VBELN | Número de entrega (albarán) |
| VGBEL | Sí | LIPS-VGBEL | Pedido de origen |
| WADAT_IST | | LIKP-WADAT_IST | Fecha real de salida de mercancías |
| TRANSPORTISTA | | LIKP-ROUTE / VTTK-TDLNR (nombre) | Transportista |
| NUM_SEGUIMIENTO | | LIKP-BOLNR o VTTK-EXTI1 | Número de seguimiento |
| BULTOS | | LIKP-ANZPK | Número de bultos |
| BTGEW | | LIKP-BTGEW | Peso bruto en kg |
| PDF | | | Nombre del PDF del albarán en `pdf/` (por defecto `ALBARAN_<VBELN>.pdf`) |

### SEGUIMIENTO

Opcional. Eventos del transportista, si SAP los recibe. Si no, el portal podrá consultarlos directamente al transportista más adelante.

| Columna | Obligatoria | Descripción |
| --- | --- | --- |
| NUM_SEGUIMIENTO | Sí | Mismo valor que en ENTREGAS |
| FECHA | Sí | Fecha del evento |
| HORA | | Hora del evento |
| EVENTO | Sí | Texto, por ejemplo `En reparto` |
| LUGAR | | Población o plataforma |
| ENTREGADO | | `X` si este evento es la entrega final |

### FACTURAS

Una fila por factura. Origen: VBRK, VBRP (pedido de referencia) y BSID/BSAD (vencimiento).

| Columna | Obligatoria | Origen SAP | Descripción |
| --- | --- | --- | --- |
| VBELN | Sí | VBRK-VBELN | Número de factura |
| FKDAT | Sí | VBRK-FKDAT | Fecha de factura |
| KUNRG | Sí | VBRK-KUNRG | Pagador |
| AUBEL | | VBRP-AUBEL | Pedido de origen |
| NETWR | Sí | VBRK-NETWR | Base imponible |
| MWSBK | | VBRK-MWSBK | IVA |
| WAERK | | VBRK-WAERK | Moneda |
| VENCIMIENTO | Sí | BSID-ZFBDT + días de ZTERM | Fecha de vencimiento |
| ZLSCH_TEXTO | | VBRK-ZLSCH (texto) | Forma de pago |
| PDF | | | Nombre del PDF en `pdf/` (por defecto `FACTURA_<VBELN>.pdf`) |

### COBROS

Una fila por factura cobrada o con cobro parcial. Origen: BSAD (partidas compensadas) y BSID.

| Columna | Obligatoria | Origen SAP | Descripción |
| --- | --- | --- | --- |
| VBELN_FACTURA | Sí | BSAD-VBELN | Factura |
| BELNR | | BSAD-AUGBL | Documento de compensación |
| AUGDT | | BSAD-AUGDT | Fecha de cobro |
| IMPORTE | | BSAD-WRBTR | Importe cobrado |
| COMPENSADO | | | `X` si la factura está totalmente pagada |

Una factura sin cobro compensado aparece como Pendiente hasta su vencimiento y como Vencida después.

### DESTINOS

Direcciones de entrega de cada cliente, para que elija una al hacer el pedido. Origen: KNVP (PARVW = WE) y KNA1 del destinatario.

| Columna | Obligatoria | Origen SAP | Descripción |
| --- | --- | --- | --- |
| KUNNR | Sí | KNVP-KUNNR | Cliente solicitante |
| KUNWE | Sí | KNVP-KUNN2 | Destinatario de mercancías |
| NAME1 | | KNA1-NAME1 (del destinatario) | Nombre que verá el cliente |
| STRAS, PSTLZ, ORT01 | | KNA1 (del destinatario) | Calle, código postal y población |

### ARTICULOS

Catálogo que se puede pedir desde el portal. Origen: MARA, MAKT, MVKE (organización de ventas) y la condición de precio general (por ejemplo PR00 sin cliente, en A304/KONP).

| Columna | Obligatoria | Origen SAP | Descripción |
| --- | --- | --- | --- |
| MATNR | Sí | MARA-MATNR | Material |
| MAKTX | Sí | MAKT-MAKTX | Descripción en español |
| MEINS | | MVKE-VRKME o MARA-MEINS | Unidad de venta |
| CATEGORIA | | MVKE-PRODH o MATKL (texto) | Familia para los filtros del catálogo |
| PRECIO | Sí | KONP-KBETR | Precio de tarifa por unidad |
| IVA | | Indicador de impuestos | Porcentaje de IVA (por defecto 21) |
| STOCK | | MARD-LABST o disponibilidad ATP | Cantidad disponible. 0 se muestra como "Bajo pedido"; vacío no muestra nada |
| MINIMO | | MVKE-AUMNG | Cantidad mínima de pedido (por defecto 1) |

### TARIFAS

Precios especiales por cliente (por ejemplo PR00 con cliente, A305/KONP). Si un artículo no tiene fila aquí, el cliente ve el precio de ARTICULOS.

| Columna | Obligatoria | Origen SAP | Descripción |
| --- | --- | --- | --- |
| KUNNR | Sí | A305-KUNNR | Cliente |
| MATNR | Sí | A305-MATNR | Material |
| NETPR | Sí | KONP-KBETR | Precio neto por unidad para ese cliente |

### CONFIRMACIONES

Respuesta de SAP a cada pedido hecho en el portal (ver la sección siguiente). Una fila por pedido del portal.

| Columna | Obligatoria | Descripción |
| --- | --- | --- |
| ID_PORTAL | Sí | Identificador del pedido en el portal (columna ID_PORTAL del fichero de entrada) |
| VBELN | Si es OK | Número del pedido de venta creado |
| RESULTADO | Sí | `OK` o `ERROR` |
| MENSAJE | | Motivo del error, tal como lo verá el cliente (por ejemplo `Cliente bloqueado por crédito`) |

El pedido creado llega además en el siguiente fichero PEDIDOS, como cualquier otro.

## Pedidos desde el portal (fichero de entrada a SAP)

Cuando un cliente o un comercial confirma un pedido, el portal deja en su carpeta de salida el fichero
`PEDIDO_ENTRADA_<ID_PORTAL>.csv` (mismas reglas: UTF-8, `;`, fechas `AAAAMMDD`, punto decimal). Lo escribe primero como `.tmp`
y luego lo renombra, así que el programa de SAP nunca encuentra un fichero a medias.

| Columna | Descripción | Campo de la BAPI |
| --- | --- | --- |
| ID_PORTAL | Identificador del pedido en el portal, p. ej. `W261020-7KQ4M` | Guardarlo para la confirmación (por ejemplo en VBAK-BSTKD_E o un campo Z) |
| KUNNR | Cliente solicitante | ORDER_PARTNERS, PARTN_ROLE = AG |
| KUNWE | Destinatario de mercancías (vacío = el solicitante) | ORDER_PARTNERS, PARTN_ROLE = WE |
| BSTKD | Referencia del cliente | ORDER_HEADER_IN-PURCH_NO_C |
| VDATU | Fecha de entrega deseada | ORDER_HEADER_IN-REQ_DATE_H |
| WAERK | Moneda | ORDER_HEADER_IN-CURRENCY |
| POSNR | Posición (10, 20…) | ORDER_ITEMS_IN-ITM_NUMBER |
| MATNR | Material | ORDER_ITEMS_IN-MATERIAL |
| KWMENG | Cantidad | ORDER_SCHEDULES_IN-REQ_QTY |
| VRKME | Unidad | ORDER_ITEMS_IN-SALES_UNIT |
| NETPR | Precio que vio el cliente | Solo para comparar: SAP calcula el precio con su determinación de precios |
| TEXTO | Observaciones del cliente | ORDER_TEXT (texto de cabecera) |
| USUARIO | Quién lo hizo en el portal | Texto o campo Z, para auditoría |
| FECHA_ALTA | Fecha en que se hizo | |

Programa ABAP propuesto (job cada 5 o 10 minutos):

1. Leer los `PEDIDO_ENTRADA_*.csv` de la carpeta (por ejemplo con `OPEN DATASET` sobre una carpeta compartida o SFTP montado en el servidor de aplicaciones).
2. Por cada ID_PORTAL, llamar a `BAPI_SALESDOCUMENT_CREATEFROMDAT2` (clase de pedido, organización de ventas, canal y sector fijos por empresa) y después a `BAPI_TRANSACTION_COMMIT`.
3. Escribir una fila en `CONFIRMACIONES_<AAAAMMDD>_<HHMMSS>.csv` con el VBELN o el mensaje de error de la tabla RETURN.
4. Mover el fichero procesado a una subcarpeta `procesados/` para no crearlo dos veces.

En la demo, un SAP simulado hace estos cuatro pasos (opción `Erp:SapFiles:SimulateSap`). Hay que desactivarlo al conectar el SAP real.

## PDF de facturas y albaranes

El job puede generar el PDF del formulario (Smartforms o SAPscript, convirtiendo el OTF con `CONVERT_OTF`)
y dejarlo en `pdf/` con el nombre indicado en la columna `PDF`. El portal solo lo muestra a quien puede ver esa factura o entrega.
