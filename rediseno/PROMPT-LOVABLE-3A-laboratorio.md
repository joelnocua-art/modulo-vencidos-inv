Agrega al módulo **Vencidos** el registro de envíos a laboratorio, el seguimiento del SLA por proveedor y el lote de envío priorizado. Sigue los pasos en orden y verifica cada uno antes de pasar al siguiente.

**Alcance estricto.** Solo puedes modificar:
- `src/components/tabs/Vencidos.tsx`
- `src/lib/certificados.ts`
- `src/lib/certificados.test.ts` (solo para AGREGAR pruebas; no cambies las existentes)

Y crear:
- `supabase/sql/2026-10-06-vencidos-mejoras.sql`

Puedes usar los componentes de `src/components/ui` (dialog, checkbox, input, etc.) y leer la sesión con `getSession()` de `@/lib/auth`, pero sin modificar esos archivos. NO toques `App.tsx`, las otras pestañas, `metabase-proxy`, `src/lib/supabase.ts`, `src/lib/auth.ts` ni tablas que no sean del módulo.

**Estado de la base (ya hecho, no lo repitas):** este SQL YA se ejecutó en Supabase. `vencidos_envios_lab` ahora tiene `fecha_retorno`, `remision`, `nota`, `vence_al_enviar`, `actualizado_en` y `actualizado_por`. También existen `vencidos_gestion` y `vencidos_historial`, que se usan en el próximo prompt. RLS: leer requiere sesión iniciada; escribir requiere ser admin. No ejecutes SQL. Solo crea `supabase/sql/2026-10-06-vencidos-mejoras.sql` con este contenido, como registro:
```sql
-- ============================================================
-- Módulo de Vencidos — mejoras: envíos con retorno, gestión e historial
-- Solo toca tablas DEL MÓDULO: amplía vencidos_envios_lab (creada el 5 oct)
-- y crea vencidos_gestion y vencidos_historial. No modifica ninguna otra.
--
-- Aplicar en el SQL editor del dashboard de Supabase
-- (proyecto ycbvwcjzgwfidyixtjrm). Se puede correr más de una vez.
-- Requiere 2026-10-02-vencidos-modulo.sql y public.has_role(uuid, app_role).
-- ============================================================

-- 1) Envíos a laboratorio: retorno, remisión, nota y vencimiento al enviar
alter table public.vencidos_envios_lab add column if not exists fecha_retorno date;
alter table public.vencidos_envios_lab add column if not exists remision text;
alter table public.vencidos_envios_lab add column if not exists nota text;
alter table public.vencidos_envios_lab add column if not exists vence_al_enviar date;
alter table public.vencidos_envios_lab add column if not exists actualizado_en timestamptz;
alter table public.vencidos_envios_lab add column if not exists actualizado_por uuid references auth.users(id);

do $$ begin
  alter table public.vencidos_envios_lab
    add constraint vencidos_envios_lab_retorno_ck check (fecha_retorno is null or fecha_retorno >= fecha_envio);
exception when duplicate_object then null; end $$;

-- 2) Marcas de "gestionado" (Bloquear, Desasignar y revisión de estado)
create table if not exists public.vencidos_gestion (
  id uuid primary key default gen_random_uuid(),
  serial text not null,
  accion text not null check (accion in ('bloquear', 'desasignar', 'revisar_estado')),
  vence_ref date not null,
  nota text,
  gestionado_por uuid references auth.users(id) default auth.uid(),
  gestionado_por_nombre text,
  gestionado_en timestamptz not null default now()
);

create index if not exists vencidos_gestion_serial_idx
  on public.vencidos_gestion (serial, accion, gestionado_en desc);

grant select, insert, delete on public.vencidos_gestion to authenticated;
grant all on public.vencidos_gestion to service_role;
alter table public.vencidos_gestion enable row level security;

drop policy if exists "vencidos_gestion leer" on public.vencidos_gestion;
create policy "vencidos_gestion leer"
  on public.vencidos_gestion for select to authenticated
  using (true);

drop policy if exists "vencidos_gestion insertar admin" on public.vencidos_gestion;
create policy "vencidos_gestion insertar admin"
  on public.vencidos_gestion for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "vencidos_gestion borrar admin" on public.vencidos_gestion;
create policy "vencidos_gestion borrar admin"
  on public.vencidos_gestion for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- 3) Historial diario de indicadores (una foto por día)
create table if not exists public.vencidos_historial (
  fecha date primary key,
  certificables int not null,
  al_dia int not null,
  vencidos int not null,
  vence_7 int not null,
  vence_30 int not null,
  bloquear int not null,
  desasignar int not null,
  enviar_lab int not null,
  esperan_recert int not null,
  recert_6m int not null,
  vigentes_en_pendiente int not null,
  en_lab int not null,
  exceden_sla int,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references auth.users(id)
);

grant select, insert, update on public.vencidos_historial to authenticated;
grant all on public.vencidos_historial to service_role;
alter table public.vencidos_historial enable row level security;

drop policy if exists "vencidos_historial leer" on public.vencidos_historial;
create policy "vencidos_historial leer"
  on public.vencidos_historial for select to authenticated
  using (true);

drop policy if exists "vencidos_historial insertar admin" on public.vencidos_historial;
create policy "vencidos_historial insertar admin"
  on public.vencidos_historial for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "vencidos_historial editar admin" on public.vencidos_historial;
create policy "vencidos_historial editar admin"
  on public.vencidos_historial for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Línea base: export de Metabase del 2 oct 2026, con las mismas reglas del módulo
insert into public.vencidos_historial
  (fecha, certificables, al_dia, vencidos, vence_7, vence_30, bloquear, desasignar, enviar_lab,
   esperan_recert, recert_6m, vigentes_en_pendiente, en_lab, exceden_sla)
values
  ('2026-10-02', 1781, 771, 889, 60, 61, 13, 8, 113, 876, 159, 23, 6, null)
on conflict (fecha) do nothing;

-- 4) Las tablas del módulo no se exponen al rol anónimo (la app siempre entra con sesión)
revoke all on public.vencidos_config, public.vencidos_envios_lab,
  public.vencidos_gestion, public.vencidos_historial from anon;
```

**Ojo con Supabase:** cada consulta devuelve como máximo 1000 filas. Para leer una tabla completa, pagina con `.range(desde, desde + 999)` hasta que lleguen menos de 1000.

---

## Paso 1 — Lógica pura en `src/lib/certificados.ts`
Reemplaza TODO el bloque `/* ───────────── laboratorio externo ───────────── */` (las interfaces `EnvioLab` y `FilaLab` y la función `filasLaboratorio`) por este código. Pégalo al final del archivo, con este contenido exacto:
```ts
/* ───────────── laboratorio externo ───────────── */

/** Fecha local → "yyyy-mm-dd". */
export function isoDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface EnvioLab {
  id?: string;
  serial: string;
  proveedor: string; // INPEL | METROBIT
  fecha_envio: string; // yyyy-mm-dd
  fecha_retorno?: string | null; // yyyy-mm-dd · vacío = sigue en el laboratorio
  remision?: string | null;
  nota?: string | null;
  vence_al_enviar?: string | null; // vencimiento del equipo cuando se envió (yyyy-mm-dd)
}

/** Último envío de cada serial con fecha ≤ ref, solo si sigue abierto (sin fecha de retorno). */
export function enviosAbiertos(envios: EnvioLab[], ref: Date = hoy0()): Map<string, EnvioLab> {
  const ultimo = new Map<string, { envio: EnvioLab; f: Date }>();
  for (const x of envios) {
    const f = parseFechaLocal(x.fecha_envio);
    const k = limpiar(x.serial);
    if (!f || !k || f > ref) continue;
    const prev = ultimo.get(k);
    if (!prev || f > prev.f) ultimo.set(k, { envio: x, f });
  }
  const abiertos = new Map<string, EnvioLab>();
  for (const [k, v] of ultimo) if (!limpiar(v.envio.fecha_retorno)) abiertos.set(k, v.envio);
  return abiertos;
}

export interface FilaLab {
  e: Equipo;
  envio: EnvioLab | null; // envío abierto, si lo hay
  proveedor: string | null; // del envío o, si no hay, de la ubicación en el WMS
  enviado: Date | null;
  dias: number | null; // días en laboratorio
  exceso: number | null; // días sobre el SLA (> 0 = excede)
  enLabWms: boolean; // el WMS lo ubica en INPEL/METROBIT
  posibleRetorno: boolean; // el certificado se renovó después del envío
}

/** Equipos en laboratorio: los que el WMS ubica en INPEL/METROBIT y los que tienen un envío abierto. */
export function filasLaboratorio(
  todos: Equipo[],
  envios: EnvioLab[],
  sla: { METROBIT: number; INPEL: number },
  ref: Date = hoy0(),
): FilaLab[] {
  const abiertos = enviosAbiertos(envios, ref);
  return todos
    .filter((e) => !e.accesorio && (e.lab || abiertos.has(e.serial)))
    .map((e) => {
      const envio = abiertos.get(e.serial) ?? null;
      const enviado = envio ? parseFechaLocal(envio.fecha_envio) : null;
      const proveedor = envio?.proveedor || e.lab || null;
      const dias = enviado ? diasEntre(ref, enviado) : null;
      const limite = proveedor === "INPEL" || proveedor === "METROBIT" ? sla[proveedor] : 0;
      const antes = envio?.vence_al_enviar ? parseFechaLocal(envio.vence_al_enviar) : null;
      return {
        e,
        envio,
        proveedor,
        enviado,
        dias,
        exceso: dias !== null && limite ? dias - limite : null,
        enLabWms: !!e.lab,
        posibleRetorno: !!(envio && antes && e.vence && e.vence > antes),
      };
    });
}

export interface DesempenoProveedor {
  proveedor: "INPEL" | "METROBIT";
  sla: number;
  abiertos: number;
  excedidos: number; // abiertos que ya superan el SLA
  recibidos: number; // recibidos en los últimos `ventana` días
  promedioDias: number | null; // días promedio entre envío y retorno
  aTiempoPct: number | null; // % de recibidos dentro del SLA
}

export function desempenoProveedores(
  envios: EnvioLab[],
  sla: { METROBIT: number; INPEL: number },
  ref: Date = hoy0(),
  ventana = 90,
): DesempenoProveedor[] {
  const abiertos = [...enviosAbiertos(envios, ref).values()];
  return (["INPEL", "METROBIT"] as const).map((p) => {
    const ab = abiertos.filter((x) => x.proveedor === p);
    const excedidos = ab.filter((x) => {
      const f = parseFechaLocal(x.fecha_envio);
      return !!f && diasEntre(ref, f) > sla[p];
    }).length;
    const duraciones: number[] = [];
    for (const x of envios) {
      if (x.proveedor !== p) continue;
      const fe = parseFechaLocal(x.fecha_envio);
      const fr = parseFechaLocal(x.fecha_retorno);
      if (!fe || !fr) continue;
      const hace = diasEntre(ref, fr);
      if (hace < 0 || hace > ventana) continue;
      duraciones.push(diasEntre(fr, fe));
    }
    const n = duraciones.length;
    return {
      proveedor: p,
      sla: sla[p],
      abiertos: ab.length,
      excedidos,
      recibidos: n,
      promedioDias: n ? Math.round(duraciones.reduce((s, d) => s + d, 0) / n) : null,
      aTiempoPct: n ? Math.round((duraciones.filter((d) => d <= sla[p]).length / n) * 100) : null,
    };
  });
}

/* ───────────── lote de envío ───────────── */

/** Tipos con poco stock listo para instalar frente a lo que espera certificado (igual que "¿Qué recertificar primero?"). */
export function tiposCuello(a: Analisis): Set<string> {
  const out = new Set<string>();
  for (const t of ["TC", "TP", "Medidor"]) {
    const listos = a.certificables.filter((e) => e.tipoCorto === t && e.estado === "DISPONIBLE" && e.rango === "vigente").length;
    const esperan = a.recert.filter((e) => e.tipoCorto === t).length;
    if (esperan > 0 && listos < esperan / 2) out.add(t);
  }
  return out;
}

export interface OpcionesLote {
  tamano: number;
  incluirPorVencer?: boolean; // Enviar a laboratorio (por defecto sí)
  incluirBacklog?: boolean; // Esperan recertificación (por defecto sí)
  excluir?: Set<string>; // seriales con envío abierto
}

export interface ItemLote {
  e: Equipo;
  grupo: 1 | 2 | 3;
  motivo: string;
}

/**
 * Prioridad: 1) disponibles que vencen en ≤ 7 días; 2) tipos cuello de botella;
 * 3) el resto. Dentro de cada grupo, del más vencido al que vence más tarde.
 */
export function armarLote(a: Analisis, op: OpcionesLote): ItemLote[] {
  const excluir = op.excluir ?? new Set<string>();
  const cuello = tiposCuello(a);
  const pool = [
    ...(op.incluirPorVencer === false ? [] : a.enviarLab),
    ...(op.incluirBacklog === false ? [] : a.recert),
  ].filter((e) => !e.lab && !excluir.has(e.serial));
  const items: ItemLote[] = pool.map((e) => {
    const d = e.dias as number;
    if (d >= 0 && d <= 7) return { e, grupo: 1, motivo: `vence en ${d} d` };
    if (cuello.has(e.tipoCorto)) return { e, grupo: 2, motivo: `${e.tipoCorto}: poco stock listo` };
    return { e, grupo: 3, motivo: d < 0 ? `vencido hace ${-d} d` : `vence en ${d} d` };
  });
  items.sort((x, y) => x.grupo - y.grupo || (x.e.dias as number) - (y.e.dias as number));
  return items.slice(0, Math.max(0, op.tamano));
}
```
`filasLaboratorio` mantiene su firma y los campos de antes (`e`, `enviado`, `dias`, `exceso`), así que el código actual sigue funcionando. Ahora también incluye los equipos con un envío abierto aunque el WMS todavía no los muestre en el laboratorio.

## Paso 2 — Envíos leídos una sola vez
- En el componente principal `Vencidos`, lee `vencidos_envios_lab` completo (paginando) con todas sus columnas, guárdalo en estado y crea `recargarEnvios()`. Quita la lectura que hoy hace `TabLab` y pásale los envíos como prop.
- Calcula `abiertos = enviosAbiertos(envios)` y pásalo a las pestañas que lo necesiten.

## Paso 3 — Hoy: "Enviar a laboratorio" sin los ya enviados
- La tarjeta usa `a.enviarLab.filter((e) => !abiertos.has(e.serial))`. El número grande, las filas y los chips de ventanas (≤ 7 d, 8–15 d, 16–30 d) salen de esa lista.
- Si hay equipos ya enviados, agrega el chip "N ya enviados".

## Paso 4 — Equipos: seleccionar y registrar el envío
- Agrega una columna de casilla al inicio de la tabla y, en el encabezado, una casilla para seleccionar toda la página. La selección se guarda por serial y se limpia al cambiar de filtro.
- Con 1 o más seleccionados, muestra una barra de acciones encima de la tabla: "N seleccionados · **Registrar envío a laboratorio** · Exportar selección (CSV) · Limpiar".
- En el CSV de Equipos, arma la fecha `vence` con `isoDia(e.vence)` en lugar de `toISOString()`.

## Paso 5 — Diálogo "Registrar envío a laboratorio" (reutilizable)
- Campos: Laboratorio (INPEL o METROBIT), Fecha de envío (por defecto hoy; no se permite una fecha futura), Remisión o guía (opcional) y Nota (opcional).
- Al guardar, para cada equipo que no tenga un envío abierto, haz `upsert` en `vencidos_envios_lab` con `{ serial, proveedor, fecha_envio, remision, nota, vence_al_enviar: e.vence ? isoDia(e.vence) : null }` y `onConflict: "serial,fecha_envio"`.
- Toast: "N registrados como enviados a INPEL · M ya tenían envío abierto". Luego `recargarEnvios()` y limpia la selección.
- El diálogo se abre desde: la barra de Equipos, el panel de Detalle, la tabla de Laboratorio y el lote (paso 8).

## Paso 6 — Detalle: tarjeta "Laboratorio"
- **Si el equipo tiene un envío abierto**, muestra "Enviado a {proveedor} el {fecha} · {días} d · SLA {n} d", y en rojo "+N d sobre SLA" si lo excede. Debajo, la remisión y la nota. Agrega dos botones:
  - **"Marcar recibido":** pide la fecha de retorno (por defecto hoy, no anterior a la de envío) y hace `update` de `fecha_retorno`, `actualizado_en` y `actualizado_por` (id del usuario) por `id`.
  - **"Anular envío":** pide confirmación y hace `delete` por `id`.
- **Si no tiene envío abierto**, muestra el botón "Registrar envío".
- Debajo, los últimos 3 envíos cerrados del serial, así: "INPEL · 1 ago → 15 ago 2026 (14 d)".

## Paso 7 — Pestaña Laboratorio
- Arma las filas con `filasLaboratorio(a.todos, envios, { METROBIT: cfg.slaMetrobit, INPEL: cfg.slaInpel })`.
- **KPI "En laboratorio":** total de filas, con el subtexto "INPEL x · METROBIT y · z sin registro de envío".
- **KPI "Exceden SLA":** filas con `exceso > 0`. Si ninguna fila tiene fecha de envío, muestra "—" con el texto "falta la fecha de envío".
- **Tarjeta nueva "Desempeño de proveedores · últimos 90 días"** (va antes de la tabla), con `desempenoProveedores(envios, sla)`. Una fila por proveedor: SLA · En laboratorio (abiertos) · Excedidos · Recibidos · Días promedio · % a tiempo. Si no hay recibidos, muestra "—" y la nota "Se calcula cuando se marcan envíos como recibidos".
- **Tabla "En laboratorio externo":**
  - Columnas: Serial · Equipo · Laboratorio · Enviado (fecha y remisión en pequeño) · Días en lab (con "+N d sobre SLA" en rojo) · Estado en el WMS · Acción.
  - Estado en el WMS: "En {lab}" si `enLabWms`; si no, "No figura en laboratorio en el WMS" en ámbar.
  - Acción: "Marcar recibido" si hay envío; "Registrar envío" si no.
  - Si `posibleRetorno`, agrega el chip verde "Certificado renovado · ¿recibido?".
  - Orden: primero las que más exceden el SLA, después las demás con envío y al final las que no tienen envío.
- Conserva la carga por CSV, que ahora también acepta las columnas opcionales `fecha_retorno`, `remision` y `nota`.

## Paso 8 — Tarjeta "Armar lote de envío" (en Laboratorio)
- Controles: Tamaño del lote (número, por defecto 50) y dos casillas: "Por vencer (Enviar a laboratorio)" y "Esperan recertificación", las dos marcadas.
- Calcula `armarLote(a, { tamano, incluirPorVencer, incluirBacklog, excluir: new Set(abiertos.keys()) })`.
- Muestra el resumen "≤ 7 días: x · {tipo} (cuello de botella): y · resto: z" y una vista previa de las primeras 10 filas (serial, tipo, ubicación, motivo), con "y N más".
- Botones:
  - **"Registrar envío de los N":** abre el diálogo del paso 5 con el lote.
  - **"Exportar lote (CSV)":** columnas prioridad, serial, tipo, sku, estado, ubicacion, vence, motivo.

## Pruebas
En `src/lib/certificados.test.ts`, agrega al `import` las funciones `enviosAbiertos`, `desempenoProveedores`, `tiposCuello` y `armarLote`, y pega este bloque al final. No cambies las pruebas existentes:
```ts
describe("Laboratorio: envíos, desempeño y lote", () => {
  const ref = new Date(2026, 9, 2);
  const s = (l: { serial: string }[]) => l.map((e) => e.serial).sort();
  const eq = (serial: string, estado: string, tipo: string, ubic: string, cal: string, conf = "2028-12-10") => ({
    Serial: serial, Sku: tipo === "Transformador de potencial" ? "TP 13200/120 V 5 VA" : "TC 100/5 Ventana Interior", "Tipo Sku": tipo,
    Estado: estado, Ubicacion: ubic, "Vencimiento Certificado Calibracion": cal, "Vencimiento Certificado Conformidad": conf,
  });
  const TP = "Transformador de potencial", TC = "Transformador de corriente";
  const L3 = [
    eq("IN-1", "PENDIENTE CERTIFICADOS", TP, "INPEL", "2026-09-16"),
    eq("BB-ENV", "DISPONIBLE", TC, "Bia Bogota", "2026-10-20", "2028-01-23"),
    eq("RET-1", "DISPONIBLE", TC, "Bia Bogota", "2027-09-30", "2028-01-23"),
    eq("CERR-1", "DISPONIBLE", TC, "Bia Bogota", "2027-08-01", "2028-01-23"),
  ];
  const envios = [
    { serial: "IN-1", proveedor: "INPEL", fecha_envio: "2026-09-01" },
    { serial: "BB-ENV", proveedor: "INPEL", fecha_envio: "2026-09-28", vence_al_enviar: "2026-10-20" },
    { serial: "RET-1", proveedor: "METROBIT", fecha_envio: "2026-09-10", vence_al_enviar: "2026-09-25" },
    { serial: "CERR-1", proveedor: "INPEL", fecha_envio: "2026-08-01", fecha_retorno: "2026-08-15" },
    { serial: "X-OLD", proveedor: "INPEL", fecha_envio: "2026-07-01", fecha_retorno: "2026-08-10" },
    { serial: "FUT-1", proveedor: "INPEL", fecha_envio: "2026-10-10" },
  ];
  const sla = { METROBIT: 15, INPEL: 20 };

  it("envíos abiertos: el último de cada serial, sin retorno y no futuro", () => {
    expect([...enviosAbiertos(envios, ref).keys()].sort()).toEqual(["BB-ENV", "IN-1", "RET-1"]);
  });

  it("en laboratorio = ubicación del WMS + envíos abiertos", () => {
    const f = filasLaboratorio(analizar(L3, ref).todos, envios, sla, ref);
    const por = (k: string) => f.find((x) => x.e.serial === k)!;
    expect(s(f.map((x) => x.e))).toEqual(["BB-ENV", "IN-1", "RET-1"]);
    expect([por("IN-1").enLabWms, por("IN-1").dias, por("IN-1").exceso]).toEqual([true, 31, 11]);
    expect([por("BB-ENV").enLabWms, por("BB-ENV").dias, por("BB-ENV").proveedor]).toEqual([false, 4, "INPEL"]);
    expect([por("RET-1").exceso, por("RET-1").posibleRetorno, por("BB-ENV").posibleRetorno]).toEqual([7, true, false]);
  });

  it("desempeño por proveedor (últimos 90 días)", () => {
    const [inpel, metrobit] = desempenoProveedores(envios, sla, ref);
    expect(inpel).toEqual({ proveedor: "INPEL", sla: 20, abiertos: 2, excedidos: 1, recibidos: 2, promedioDias: 27, aTiempoPct: 50 });
    expect(metrobit).toEqual({ proveedor: "METROBIT", sla: 15, abiertos: 1, excedidos: 1, recibidos: 0, promedioDias: null, aTiempoPct: null });
  });

  it("lote priorizado: ≤ 7 días, luego tipo cuello de botella, luego el resto", () => {
    const LT = [
      eq("D4", "DISPONIBLE", TC, "Bia Bogota", "2026-10-06", "2028-01-23"),
      eq("D20", "DISPONIBLE", TC, "Bia Bogota", "2026-10-22", "2028-01-23"),
      eq("D5-ENV", "DISPONIBLE", TC, "Bia Bogota", "2026-10-07", "2028-01-23"),
      eq("P-TP", "PENDIENTE CERTIFICADOS", TP, "Bia Bogota", "2026-06-24"),
      eq("P-TC", "PENDIENTE CERTIFICADOS", TC, "Bia Bogota", "2026-03-16"),
      eq("P-LAB", "PENDIENTE CERTIFICADOS", TP, "INPEL", "2026-09-16"),
      eq("TCOK1", "DISPONIBLE", TC, "Bia Bogota", "2028-03-01", "2028-01-23"),
      eq("TCOK2", "DISPONIBLE", TC, "Bia Bogota", "2028-03-01", "2028-01-23"),
    ];
    const a = analizar(LT, ref);
    expect([...tiposCuello(a)]).toEqual(["TP"]);
    const lote = armarLote(a, { tamano: 10, excluir: new Set(["D5-ENV"]) });
    expect(lote.map((x) => x.e.serial)).toEqual(["D4", "P-TP", "P-TC", "D20"]);
    expect(lote.map((x) => x.motivo)).toEqual(["vence en 4 d", "TP: poco stock listo", "vencido hace 200 d", "vence en 20 d"]);
    expect(armarLote(a, { tamano: 2, excluir: new Set(["D5-ENV"]) }).map((x) => x.e.serial)).toEqual(["D4", "P-TP"]);
    expect(armarLote(a, { tamano: 10, incluirBacklog: false, excluir: new Set(["D5-ENV"]) }).map((x) => x.e.serial)).toEqual(["D4", "D20"]);
  });
});
```
Corre `npm test`: deben pasar todas, las anteriores y estas 4.

## Checklist
- [ ] Registra el envío de 2 equipos de "Enviar a laboratorio": la tarjeta baja en 2 y muestra el chip "2 ya enviados". En Laboratorio aparecen con "No figura en laboratorio en el WMS".
- [ ] "Marcar recibido" en uno: sale de "En laboratorio" y entra en "Desempeño" como recibido, con sus días.
- [ ] "Anular envío" en el otro: vuelve a "Enviar a laboratorio".
- [ ] Lote de 100: primero salen los que vencen en ≤ 7 días y después los TP. Con los datos del 5 oct y sin cambios en el WMS serían 64 y luego 36.
- [ ] Otro admin ve los mismos envíos.
- [ ] Las otras pestañas de la app no cambiaron.
