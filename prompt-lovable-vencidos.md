Corrige el Módulo de Vencidos para que use los datos reales de Metabase sin errores. NO cambies otros módulos, estilos ni la navegación: solo la lógica de datos del módulo de vencidos.

## 1. Fuente de datos
- Inventario completo EN VIVO: POST a `https://bia.metabaseapp.com/api/card/18021/query/json` con header `x-api-key` y body `{}`. Hazlo desde el backend/función del servidor (no desde el navegador) usando la API key de Metabase que ya existe en el proyecto.
- Metabase responde un array con estos nombres de columna EXACTOS (con mayúsculas y espacios): `Bia Code`, `Contract ID`, `Sku`, `Serial`, `Estado`, `Ubicacion`, `Marca`, `Sku ID`, `Tipo Sku`, `Certificado Conformidad`, `Vencimiento Certificado Conformidad`, `Certificado Calibracion`, `Vencimiento Certificado Calibracion`.
- Mapea por esos nombres. Para tolerar variaciones, normaliza cada llave antes de buscarla (quitar tildes, minúsculas, espacios → `_`): `Vencimiento Certificado Calibracion` → `vencimiento_certificado_calibracion`. Si buscas `row.serial` sin normalizar, todos los campos llegan vacíos (ese era el bug).
- En pantalla, indica claramente la fuente: "EN VIVO desde Metabase · N equipos" o, si falla, "Snapshot (no es en vivo)".

## 2. Fechas
- Formatos posibles: ISO (`2026-07-01` o `2026-07-01T00:00:00Z`), español (`febrero 17, 2028`, `17 de febrero de 2028`) y `dd/mm/yyyy`.
- Las fechas ISO se interpretan como fecha LOCAL: toma año, mes y día con regex y crea `new Date(año, mes-1, día)`. NO uses `new Date('2026-07-01')`, porque es medianoche UTC y en Colombia (UTC-5) queda en el día anterior.
- Días restantes = (fecha − hoy) en días, con ambas fechas a medianoche local.
- **Fechas de relleno:** si el año es < 2000 (Metabase usa `1960-01-01` cuando no hay dato) o ≥ 2060 (usa 2070–2100 para "no vence"), trata esa fecha como si no existiera. No la cuentes como vencida ni como vigente. Muestra en el Resumen: "X equipos traen fechas de relleno en Metabase (1960 = sin dato · 2070+ = no vence); se ignoran".

## 3. Vencimiento de cada equipo
- Usa la fecha más cercana entre calibración y conformidad, ignorando las de relleno, y guarda cuál de las dos fue.
- Semáforo: < 0 vencido · 0–7 crítico · 8–30 por vencer · > 30 vigente. Sin fecha válida: "sin fecha".

## 4. Población gestionable
- Estado (sin espacios, en mayúsculas) ∈ `DISPONIBLE`, `ASIGNADO`, `PENDIENTE CERTIFICADOS`.
- Que NO sea accesorio. Decide por la columna `Tipo Sku` cuando venga: es accesorio si contiene ANTENA, BLOQUE, ROUTER, MODEM, SIMCARD o CABLE. Solo si no viene `Tipo Sku`, usa el `Sku` con ANTENA|BLOQUE|ROUTER|MODEM. Importante: NO busques "CABLE" en el Sku, porque hay transformadores reales que se llaman "TC 100/5 Ventana Exterior **Con cable**".
- Que tenga al menos una fecha válida.

## 5. Limpieza
- Quita los espacios al inicio y al final, y colapsa los espacios dobles, en Serial, Sku, Marca, Ubicación, Estado y Bia Code (hay seriales como " 0101259025753").

## 6. KPIs
- Vencidos: muestra el total y, debajo, "N en stock/campo · M ya en pend. cert." (M = vencidos con estado PENDIENTE CERTIFICADOS).
- Desasignar = equipos ASIGNADO, no accesorios, vencidos.
- Calibrar ya = gestionables con ≤ 7 días que NO estén en laboratorio (ubicación con INPEL o METROBIT).

## 7. Prueba obligatoria
Agrega una función de prueba (o úsala temporalmente como fuente) con este JSON, que ya viene con los nombres de columna de Metabase:

```json
[
 {"Serial":"T1-RELLENO","Sku":"TC 100/5 Ventana Exterior Con cable C 0.5s","Tipo Sku":"Transformador de corriente","Estado":"PENDIENTE CERTIFICADOS","Ubicacion":"Bia Bogota","Vencimiento Certificado Calibracion":"1960-01-01","Vencimiento Certificado Conformidad":"2028-09-19"},
 {"Serial":"T2-SIM","Sku":"Simcard Claro","Tipo Sku":"Simcard / Línea de comunicación","Estado":"DISPONIBLE","Ubicacion":"Bia Bogota","Vencimiento Certificado Calibracion":"2024-01-01","Vencimiento Certificado Conformidad":null},
 {"Serial":"T3-DISP","Sku":"P2000DCor5 (100) AT","Tipo Sku":"Medidor","Estado":"DISPONIBLE","Ubicacion":"Bia Bogota","Vencimiento Certificado Calibracion":"2024-02-01","Vencimiento Certificado Conformidad":"2028-09-04"},
 {"Serial":"T4-PEND","Sku":"P2000DCor5 (100) AT","Tipo Sku":"Medidor","Estado":"PENDIENTE CERTIFICADOS","Ubicacion":"Bia Bogota","Vencimiento Certificado Calibracion":"2024-02-01","Vencimiento Certificado Conformidad":"2028-09-04"},
 {"Serial":"T5-ASIG","Sku":"TP 13200/120 V 10 VA Exterior","Tipo Sku":"Transformador de potencial","Estado":"ASIGNADO","Ubicacion":"SGE Bucaramanga","Bia Code":"CO0800005298","Vencimiento Certificado Calibracion":"2024-05-16","Vencimiento Certificado Conformidad":"2028-01-08"},
 {"Serial":"T6-INST","Sku":"INHEMETER i310","Tipo Sku":"Medidor","Estado":"INSTALADO","Ubicacion":"INSTALADO","Vencimiento Certificado Calibracion":"2024-03-01","Vencimiento Certificado Conformidad":"2028-02-17"},
 {"Serial":"T7-2100","Sku":"TP 34500/120 V 5 VA","Tipo Sku":"Transformador de potencial","Estado":"DISPONIBLE","Ubicacion":"Bia Barranquilla","Vencimiento Certificado Calibracion":"2028-06-07","Vencimiento Certificado Conformidad":"2100-12-31"},
 {"Serial":" T8-ESPACIOS ","Sku":"C2000Cor5 (100) AT","Tipo Sku":"Medidor","Estado":"DISPONIBLE ","Ubicacion":"Bia Bogota","Vencimiento Certificado Calibracion":"2028-06-07","Vencimiento Certificado Conformidad":null},
 {"Serial":"T9-ANTENA","Sku":"Antena GSM","Tipo Sku":"Antena de comunicaciones","Estado":"DISPONIBLE","Ubicacion":"Bia Bogota","Vencimiento Certificado Calibracion":"2024-01-01","Vencimiento Certificado Conformidad":"2076-01-02"},
 {"Serial":"T10-ES","Sku":"D2000Cor5(100) AT","Tipo Sku":"Medidor","Estado":"ASIGNADO","Ubicacion":"Bia Bogota","Bia Code":"CO0700006040","Vencimiento Certificado Calibracion":"febrero 17, 2028","Vencimiento Certificado Conformidad":null}
]
```

Resultado esperado con ese JSON (válido hasta enero de 2028):
- Gestionables = **7** (T1, T3, T4, T5, T7, T8, T10). T2 (simcard), T9 (antena) y T6 (instalado) quedan fuera.
- Vencidos = **3** → "**2** en stock/campo · **1** ya en pend. cert." (T3, T5 / T4).
- Desasignar = **1** (T5).
- Fechas de relleno = **3** (T1 calibración 1960, T7 conformidad 2100, T9 conformidad 2076).
- T1 NO aparece vencido: usa conformidad 2028-09-19 → vigente, y NO se marca como accesorio aunque el Sku dice "Con cable".
- T7 vence por calibración 2028-06-07 (el 2100 se ignora).
- T8 se muestra como "T8-ESPACIOS", sin espacios, y cuenta como DISPONIBLE.
- T10 parsea "febrero 17, 2028" correctamente.
- Una fecha `2026-07-01` debe mostrarse como 1 jul 2026, no como 30 jun.

Cuando la prueba dé exactamente esos números, déjala como test o elimínala, y deja la fuente EN VIVO de Metabase como la principal.
