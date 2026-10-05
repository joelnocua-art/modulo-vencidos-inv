Rediseña el módulo de vencimientos (hoy con las pestañas Hoy, Resumen, Equipos, Laboratorio, Análisis y Auditoría) para que sea más limpio, muestre solo lo que lleva a una acción y use los datos reales de Metabase sin errores. Te adjunto 5 pantallas de referencia: síguelas en estructura, jerarquía y textos. Mantén el header de la app (logo INVENTARIO BIA, usuario, Salir), el login y el tema oscuro. No toques otros módulos.

# 1. Qué se elimina
- Las pestañas **Resumen**, **Análisis** y **Auditoría**. La salud del inventario pasa a la parte de arriba de "Hoy"; "Top marcas", "Top ubicaciones", "Por estado" y "¿Qué certificación vence primero?" no llevan a ninguna acción, así que se quitan.
- La barra "Diagnóstico de datos · 13.852 filas · Re-consultar" que aparece arriba de cada pestaña. Se reemplaza por un chip pequeño en el encabezado del módulo (ver punto 4).
- El contador "3.298 gestionables / 12.824" del encabezado: los dos números están mal calculados.
- La lista "Calibrar ya (950)". Mezclaba 876 equipos que ya están en Pendiente certificados con los que de verdad requieren acción hoy.

# 2. Estructura nueva: 3 pestañas
Encabezado del módulo: título **"Vencimientos de certificados"**, subtítulo "N equipos certificables · disponibles, asignados y pendientes de certificado"; a la derecha, el chip de fuente ("● En vivo · Metabase · hh:mm", o "Snapshot · fecha" si falla), el chip de calidad de datos y el botón Recargar.

Pestañas: **Hoy · Equipos (N) · Laboratorio (N)**.

## 2.1 Hoy (pantallas 01 y 05)
**a) Tarjeta de salud.** A la izquierda, un número grande: "% al día" = vigentes (> 30 días) / certificables, con el texto "al día: vigentes a más de 30 días (X de N)". A la derecha, una barra apilada de 4 segmentos: **Vencido** (rojo `#d03b3b`), **Vence ≤ 7 d** (`#ec835a`), **8–30 d** (`#fab219`) y **Vigente** (verde `#0ca30c`). Debajo, una leyenda con el conteo de cada uno; bajo "Vencido", en gris: "M ya marcados pendiente cert.". Nota al pie: "Vence = el certificado más próximo entre calibración y conformidad. Fechas de relleno (1960 / 2070+) se ignoran."

**b) Tres tarjetas de acción**, cada una con verbo, número grande, una frase de qué hacer, chips de contexto, las 4 primeras filas (serial, tipo · ubicación, badge de días) y "Ver los N →" (abre Equipos con ese filtro):
1. **Bloquear**: estado DISPONIBLE con vencimiento < 0. Texto: "Disponibles con certificado vencido. Pásalos a Pendiente certificados para que no se despachen." Chips: "X en contratistas · Y en bodegas Bia" (es bodega Bia si la ubicación empieza por "Bia").
2. **Desasignar**: estado ASIGNADO con vencimiento ≤ 30 días (incluye los ya vencidos). Texto: "Asignados que vencen en ≤ 30 días. Afecta K Bia Codes." Chips: cada Bia Code afectado con su conteo. En las filas, agrega el Bia Code. (Esta es la "alerta de desasignación con reporte de impacto".)
3. **Enviar a laboratorio**: estado DISPONIBLE con vencimiento entre 0 y 30 días, que no esté ya en un laboratorio. Texto: "Disponibles que vencen en ≤ 30 días. Envíalos antes de que venzan." Chips por ventana: "≤ 7 d · a", "8–15 d · b", "16–30 d · c". (Esta es la "alerta de vencimiento configurable": las ventanas 7/15/30 son las mismas de los correos.)

Las tres tarjetas son mutuamente excluyentes: un equipo nunca aparece en dos.

**c) Franja de backlog** (una sola línea): "**N equipos esperan recertificación** (pendiente certificados, ya vencidos) · M llevan más de 6 meses" + botón "Ver en Laboratorio →".

## 2.2 Equipos (pantallas 02 y 03)
- Fila de filtros: buscador (serial, SKU, ubicación, Bia Code) · selector segmentado **Todos / Vencidos / ≤ 7 d / 8–30 d / Vigentes**, con el conteo en cada opción · Tipo · Estado · botón CSV. Nada más.
- Tabla de 6 columnas: **Serial** (monoespaciada) · **Equipo** (SKU y, debajo, en gris: tipo corto TC/TP/Medidor · marca) · **Estado** · **Ubicación** · **Vence** (fecha y, debajo, "Calibración" o "Conformidad") · **Días** (badge). Orden por defecto: el que vence primero. Pagina de a 50. No pongas columnas separadas para calibración y conformidad.
- Al hacer clic en una fila se abre un panel lateral derecho con: serial, SKU, tipo, estado, ubicación, Bia Code y marca, y dos tarjetas, **Calibración** y **Conformidad**. Cada una muestra la fecha, el badge de días y el link **"Ver PDF ↗"** a la URL del certificado (columnas `Certificado Calibracion` / `Certificado Conformidad`; reemplaza `//media` por `/media`). La tarjeta que define el vencimiento lleva el texto "· define el vencimiento" y un borde rojo suave. Si la fecha es de relleno, muestra "Fecha de relleno · ignorada".
- Badge de días: vencido → "venció hace N d" en rojo; ≤ 7 → naranja; 8–30 → amarillo; > 30 → verde; sin fecha → gris "sin fecha".

## 2.3 Laboratorio (pantalla 04)
- 4 KPIs: **Esperan recertificación** (PENDIENTE CERTIFICADOS ya vencidos) · **Más de 6 meses esperando** (vencidos hace más de 180 días) · **En laboratorio** (ubicación con INPEL o METROBIT, con el desglose "INPEL x · METROBIT y") · **Exceden SLA** ("—" y "falta la fecha de envío" si no hay fechas cargadas).
- **Antigüedad del backlog**: 4 barras horizontales (0–30, 31–90, 91–180 y más de 180 días desde que venció) y, al pie, las 3 sedes con más equipos pendientes.
- **¿Qué recertificar primero?**: tabla por tipo (TC, TP, Medidor) con **Listos para instalar** (DISPONIBLE y vigente > 30 d) · **Vencen ≤ 30 d** · **Esperan certificado**. Marca "· cuello de botella" cuando los listos para instalar sean menos de la mitad de los que esperan certificado (hoy le pasa a TP: 14 listos contra 144 esperando).
- **En laboratorio externo**: tabla con Serial, Equipo, Laboratorio, Estado ("Disponible (ya certificado)" o "Pend. certificado"), Enviado y Días en lab. SLA: METROBIT 15 d e INPEL 20 d, editables. Metabase no trae la fecha de envío; deja el aviso "Metabase no trae la fecha de envío al laboratorio, así que el SLA no se puede medir todavía" con el botón "Cargar fechas de envío (CSV)" (columnas: serial, proveedor, fecha). Cuando haya fecha: Días en lab = hoy − fecha; si supera el SLA, muestra en rojo "+N d sobre SLA" y cuéntalo en "Exceden SLA". (Este es el "seguimiento a SLA de proveedores".)

# 3. Reglas de datos (obligatorias)
1. **Fuente**: POST `https://bia.metabaseapp.com/api/card/18021/query/json` con header `x-api-key` y body `{}`, desde el servidor/edge function con la key que ya existe. Columnas exactas: `Bia Code`, `Contract ID`, `Sku`, `Serial`, `Estado`, `Ubicacion`, `Marca`, `Sku ID`, `Tipo Sku`, `Certificado Conformidad`, `Vencimiento Certificado Conformidad`, `Certificado Calibracion`, `Vencimiento Certificado Calibracion`. Antes de leer, normaliza cada llave (sin tildes, en minúsculas, espacios → `_`).
2. **Limpieza**: quita los espacios al inicio y al final, y colapsa los espacios dobles, en todos los textos. Estado en mayúsculas.
3. **Fechas**: acepta ISO, "febrero 17, 2028", "17 de febrero de 2028" y dd/mm/yyyy. Las fechas ISO se arman como fecha LOCAL con `new Date(año, mes-1, día)`; nunca con `new Date('2026-07-01')`, porque en Colombia queda en el día anterior. Una fecha con año < 2000 o ≥ 2060 es **de relleno**: se ignora (no cuenta ni como vencida ni como vigente).
4. **Vencimiento del equipo** = el más próximo entre calibración y conformidad válidas. Días = fecha − hoy, ambas a medianoche local.
5. **Accesorio**: si viene `Tipo Sku`, es accesorio cuando contiene ANTENA, BLOQUE, ROUTER, MODEM, SIMCARD o CABLE. Solo si no viene, usa el Sku con ANTENA|BLOQUE|ROUTER|MODEM. Nunca busques "CABLE" en el Sku: existen TC llamados "… Con cable".
6. **Certificables (denominador único en todo el módulo)** = estado ∈ {DISPONIBLE, ASIGNADO, PENDIENTE CERTIFICADOS}, no accesorio y con al menos una fecha válida. Esto corrige el 3.298 actual, que contaba 1.491 simcards y 19 módems "sin fecha".
7. **Laboratorio** = ubicación con INPEL o METROBIT.

# 4. Chip de calidad de datos
En el encabezado, en ámbar: "⚠ N con datos incompletos", donde N = certificables candidatos (estado y no accesorio) sin ninguna fecha válida + los que tienen alguna fecha de relleno. Al hacer clic se abre un panel (pantalla 03) con "Afecta este módulo: X sin fecha de certificado · Y con fecha de relleno ignorada" y una lista de problemas de todo el inventario, para corregir en el WMS/Metabase: calibración 1960, conformidad 2070–2100, serial con coma o espacios, serial repetido, instalado sin Bia Code, y estado y ubicación que se contradicen. Incluye el botón "Reporte completo" (CSV).

# 5. Estilo
- Fondo `#0b0d10`, tarjetas `#12161b` con borde `rgba(255,255,255,.07)`, radio 14px, mucho aire (gap 16px, padding 20px).
- El verde de marca `#2fe07a` solo va en la pestaña activa, los links y el punto "en vivo". Los colores de estado (rojo, naranja, amarillo, verde) solo se usan para el vencimiento, y siempre acompañados del texto.
- Tipografía sans (Inter o system-ui). Monoespaciada solo en los seriales. Números grandes en peso 650, sin monoespaciada.
- Mobile: las tarjetas se apilan en una columna; en la tabla se ocultan Estado y Ubicación; el panel de detalle ocupa el ancho completo.

# 6. Prueba de aceptación
Agrega una prueba con este JSON (mismos nombres de columna de Metabase):
```json
[
 {"Serial":"T1-RELLENO","Sku":"TC 100/5 Ventana Exterior Con cable C 0.5s","Tipo Sku":"Transformador de corriente","Estado":"PENDIENTE CERTIFICADOS","Ubicacion":"Bia Bogota","Vencimiento Certificado Calibracion":"1960-01-01","Vencimiento Certificado Conformidad":"2028-09-19"},
 {"Serial":"T2-SIM","Sku":"Simcard Claro","Tipo Sku":"Simcard / Línea de comunicación","Estado":"DISPONIBLE","Ubicacion":"Bia Bogota","Vencimiento Certificado Calibracion":"2024-01-01","Vencimiento Certificado Conformidad":null},
 {"Serial":"T3-DISP","Sku":"P2000DCor5 (100) AT","Tipo Sku":"Medidor","Estado":"DISPONIBLE","Ubicacion":"GMAS","Vencimiento Certificado Calibracion":"2024-02-01","Vencimiento Certificado Conformidad":"2028-09-04"},
 {"Serial":"T4-PEND","Sku":"P2000DCor5 (100) AT","Tipo Sku":"Medidor","Estado":"PENDIENTE CERTIFICADOS","Ubicacion":"Bia Bogota","Vencimiento Certificado Calibracion":"2024-02-01","Vencimiento Certificado Conformidad":"2028-09-04"},
 {"Serial":"T5-ASIG","Sku":"TP 13200/120 V 10 VA Exterior","Tipo Sku":"Transformador de potencial","Estado":"ASIGNADO","Ubicacion":"SGE Bucaramanga","Bia Code":"CO0800005298","Vencimiento Certificado Calibracion":"2024-05-16","Vencimiento Certificado Conformidad":"2028-01-08"},
 {"Serial":"T6-INST","Sku":"INHEMETER i310","Tipo Sku":"Medidor","Estado":"INSTALADO","Ubicacion":"INSTALADO","Vencimiento Certificado Calibracion":"2024-03-01","Vencimiento Certificado Conformidad":"2028-02-17"},
 {"Serial":"T7-2100","Sku":"TP 34500/120 V 5 VA","Tipo Sku":"Transformador de potencial","Estado":"DISPONIBLE","Ubicacion":"Bia Barranquilla","Vencimiento Certificado Calibracion":"2028-06-07","Vencimiento Certificado Conformidad":"2100-12-31"},
 {"Serial":" T8-ESPACIOS ","Sku":"C2000Cor5 (100) AT","Tipo Sku":"Medidor","Estado":"DISPONIBLE ","Ubicacion":"Bia Bogota","Vencimiento Certificado Calibracion":"2028-06-07","Vencimiento Certificado Conformidad":null},
 {"Serial":"T9-ANTENA","Sku":"Antena GSM","Tipo Sku":"Antena de comunicaciones","Estado":"DISPONIBLE","Ubicacion":"Bia Bogota","Vencimiento Certificado Calibracion":"2024-01-01","Vencimiento Certificado Conformidad":"2076-01-02"},
 {"Serial":"T10-ES","Sku":"D2000Cor5(100) AT","Tipo Sku":"Medidor","Estado":"ASIGNADO","Ubicacion":"Bia Bogota","Bia Code":"CO0700006040","Vencimiento Certificado Calibracion":"febrero 17, 2028","Vencimiento Certificado Conformidad":null}
]
```
Resultado esperado (válido hasta enero de 2028):
- Certificables **7** (T1, T3, T4, T5, T7, T8, T10) · Vencidos **3** · Vigentes **4** · % al día **57%**.
- Bloquear **1** (T3, "1 en contratistas") · Desasignar **1** (T5, Bia Code CO0800005298) · Enviar a laboratorio **0** · Esperan recertificación **1** (T4).
- Chip de calidad de datos: **2** (T1 y T7 tienen fechas de relleno; T9 no cuenta porque es accesorio).
- T1 vence por Conformidad 19 sep 2028 y no es accesorio, aunque su Sku dice "Con cable". T8 se muestra como "T8-ESPACIOS". T10 se lee como 17 feb 2028. `2026-07-01` se muestra como 1 jul 2026.

Con el inventario real del 2 oct 2026 (13.852 filas) la referencia da: certificables **1.781** · al día **43%** (771) · vencidos **889** (876 ya en pendiente cert.) · ≤ 7 d **60** · 8–30 d **61** · Bloquear **13** · Desasignar **8** (3 Bia Codes) · Enviar a laboratorio **113** (55 / 27 / 31) · esperan recertificación **876** (159 > 6 meses) · en laboratorio **6** (INPEL). Con datos en vivo de otro día, los números cambian, pero **nunca** debe aparecer el serial 1806210055 como vencido (su calibración es 1960) ni simcards en ningún conteo.
