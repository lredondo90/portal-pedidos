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
| Nombre del fichero | `<TIPO>_<AAAAMMDD>_<HHMM>.csv`, por ejemplo `PEDIDOS_20261019_1400.csv` |
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

## PDF de facturas y albaranes

El job puede generar el PDF del formulario (Smartforms o SAPscript, convirtiendo el OTF con `CONVERT_OTF`)
y dejarlo en `pdf/` con el nombre indicado en la columna `PDF`. El portal solo lo muestra a quien puede ver esa factura o entrega.
