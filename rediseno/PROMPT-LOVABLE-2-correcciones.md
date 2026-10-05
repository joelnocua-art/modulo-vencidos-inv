Corrige 4 problemas del módulo **Vencidos**, en este orden. Termina y verifica cada paso antes de pasar al siguiente.

**Alcance estricto.** Solo puedes modificar:
- `src/components/tabs/Vencidos.tsx`
- `src/lib/certificados.ts`
- `src/lib/certificados.test.ts` (solo para AGREGAR pruebas; no cambies las que ya existen)
- `src/lib/vencidos.ts`

Y crear estos archivos nuevos:
- `src/lib/vencidos-snapshot.ts`
- `src/lib/vencidos-config.ts`
- `supabase/sql/2026-10-02-vencidos-modulo.sql`

NO toques `App.tsx`, las otras pestañas (Conteo, Pistolear, Buscar, Inventarios, Admin, About, Racks, Comparar), `supabase/functions/metabase-proxy`, `src/lib/supabase.ts`, `src/lib/auth.ts` ni ninguna tabla existente. Las otras pestañas deben verse y funcionar exactamente igual.

**Estado de la base (ya hecho, no lo repitas):** el SQL del paso 2 YA se ejecutó en Supabase (proyecto ycbvwcjzgwfidyixtjrm). Existen `public.vencidos_config` (1 fila: ventanas {30,15,7}, desasignación 30, SLA METROBIT 15 e INPEL 20) y `public.vencidos_envios_lab`, con RLS: lectura para usuarios autenticados y escritura solo para admins, vía `public.has_role`. No ejecutes SQL ni pidas ejecutarlo; solo crea el archivo del paso 2 como registro.

---

## Paso 1 — El respaldo (snapshot) nunca se guarda

**Problema:** en `cargar()` se hace `localStorage.setItem("cc_snapshot_18021", …)` con las ~13.852 filas (≈ 6,8 MB). localStorage admite ~5 MB, así que lanza `QuotaExceededError`, el `catch` lo ignora y, si Metabase falla, no hay respaldo.

**Solución:**
1. Crea `src/lib/vencidos-snapshot.ts` con este contenido exacto:
```ts
// Respaldo local del inventario de Metabase en IndexedDB.
// localStorage no alcanza: 13.852 filas ≈ 6,8 MB y su límite es ~5 MB.
const DB = "bia_vencidos";
const STORE = "snapshot";
const KEY = "card_18021";

export interface Snapshot {
  ts: number;
  rows: Record<string, unknown>[];
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function guardarSnapshot(snap: Snapshot): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await abrir();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(snap, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function leerSnapshot(): Promise<Snapshot | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await abrir();
  try {
    return await new Promise<Snapshot | null>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as Snapshot | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
```
2. En `Vencidos.tsx`, dentro de `cargar()`:
   - Después de una carga en vivo exitosa: `guardarSnapshot({ ts, rows: arr }).catch((e) => console.warn("No se pudo guardar el respaldo", e))`, sin `await`, para no frenar la pantalla.
   - En el `catch`: usa `await leerSnapshot()` en lugar de localStorage. Si hay snapshot, muéstralo con el chip gris "Snapshot · {fecha y hora}" y el toast "{error}. Mostrando el respaldo del {fecha y hora}".
   - Al montar el módulo, ejecuta una vez `localStorage.removeItem("cc_snapshot_18021")` para limpiar la clave vieja.
   - Elimina la constante `SNAP_KEY` y todo uso de localStorage para el snapshot.

**Verificación:** carga en vivo → en DevTools › Application › IndexedDB › `bia_vencidos` › `snapshot` aparece `card_18021` con ~13.852 filas. Luego bloquea la petición a `metabase-proxy` (DevTools › Network › Block request URL) y pulsa Recargar → se ven los mismos números con el chip gris "Snapshot".

---

## Paso 2 — La configuración de alertas no se usa y vive en un solo navegador

**Problema:** `CCConfig` (`src/lib/vencidos.ts`) tiene `ventanas`, `ventanaDesasignacion`, `avisarBia`, `avisarContratistas`, `correos` y `appsScriptUrl`, pero solo `sla` se usa, y todo se guarda en localStorage (`cc_cfg`), así que cada navegador tiene su propia configuración.

**Solución:**
1. Crea `supabase/sql/2026-10-02-vencidos-modulo.sql` con este contenido exacto, **solo como registro**: ya está ejecutado en Supabase, así que no lo ejecutes.
```sql
-- ============================================================
-- Módulo de Vencidos — configuración compartida y envíos a laboratorio
-- Solo crea tablas NUEVAS del módulo; no modifica ninguna existente.
--
-- Aplicar en el SQL editor del dashboard de Supabase
-- (proyecto ycbvwcjzgwfidyixtjrm). Se puede correr más de una vez.
-- Requiere public.has_role(uuid, app_role) de 2026-07-21-auth-migration.sql.
-- ============================================================

-- 1) Configuración del módulo (una sola fila, compartida por todos los admins)
create table if not exists public.vencidos_config (
  id smallint primary key default 1 check (id = 1),
  ventanas int[] not null default '{30,15,7}',
  ventana_desasignacion int not null default 30 check (ventana_desasignacion between 1 and 365),
  sla_metrobit int not null default 15 check (sla_metrobit between 1 and 365),
  sla_inpel int not null default 20 check (sla_inpel between 1 and 365),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.vencidos_config (id) values (1) on conflict (id) do nothing;

grant select, update on public.vencidos_config to authenticated;
grant all on public.vencidos_config to service_role;
alter table public.vencidos_config enable row level security;

drop policy if exists "vencidos_config leer" on public.vencidos_config;
create policy "vencidos_config leer"
  on public.vencidos_config for select to authenticated
  using (true);

drop policy if exists "vencidos_config editar admin" on public.vencidos_config;
create policy "vencidos_config editar admin"
  on public.vencidos_config for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 2) Envíos a laboratorio externo (reemplaza el CSV guardado en el navegador)
create table if not exists public.vencidos_envios_lab (
  id uuid primary key default gen_random_uuid(),
  serial text not null,
  proveedor text not null check (proveedor in ('INPEL', 'METROBIT')),
  fecha_envio date not null,
  creado_por uuid references auth.users(id) default auth.uid(),
  creado_en timestamptz not null default now(),
  unique (serial, fecha_envio)
);

create index if not exists vencidos_envios_lab_serial_idx
  on public.vencidos_envios_lab (serial, fecha_envio desc);

grant select, insert, update, delete on public.vencidos_envios_lab to authenticated;
grant all on public.vencidos_envios_lab to service_role;
alter table public.vencidos_envios_lab enable row level security;

drop policy if exists "vencidos_envios leer" on public.vencidos_envios_lab;
create policy "vencidos_envios leer"
  on public.vencidos_envios_lab for select to authenticated
  using (true);

drop policy if exists "vencidos_envios insertar admin" on public.vencidos_envios_lab;
create policy "vencidos_envios insertar admin"
  on public.vencidos_envios_lab for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "vencidos_envios editar admin" on public.vencidos_envios_lab;
create policy "vencidos_envios editar admin"
  on public.vencidos_envios_lab for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "vencidos_envios borrar admin" on public.vencidos_envios_lab;
create policy "vencidos_envios borrar admin"
  on public.vencidos_envios_lab for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));
```
2. Crea `src/lib/vencidos-config.ts` con:
   - El tipo `ConfigVencidos { ventanas: number[]; ventanaDesasignacion: number; slaMetrobit: number; slaInpel: number }`, con defaults `[30, 15, 7]`, `30`, `15` y `20`.
   - `leerConfig()`: hace `select` a `vencidos_config` donde `id = 1`. Si la lectura falla (por ejemplo, sin conexión), devuelve los defaults y una bandera `remota: false`.
   - `guardarConfig(cfg)`: hace `update` donde `id = 1`, con `updated_at` = ahora y `updated_by` = id del usuario actual.
   - Valida que las ventanas sean 3 enteros entre 1 y 365, sin repetir, y guárdalas ordenadas de mayor a menor.
3. En el encabezado del módulo, junto a "↻ Recargar", agrega el botón **"⚙ Alertas"**. Abre un panel lateral, con el mismo estilo del panel de Detalle, que contiene:
   - Ventanas de aviso: 3 campos numéricos (30 / 15 / 7).
   - Ventana de desasignación (días).
   - SLA METROBIT (días) y SLA INPEL (días).
   - Botón Guardar, con toast de éxito o de error.
   - Si `remota` es `false`, un aviso ámbar: "No se pudo leer la configuración compartida; se usan los valores por defecto". En ese caso, deshabilita Guardar.
4. Quita los inputs de SLA de la tarjeta "En laboratorio externo". En su lugar muestra el texto "SLA METROBIT {n} d · INPEL {n} d" y un link "editar" que abre el panel ⚙ Alertas.
5. **Usa la configuración en el cálculo.** En `src/lib/certificados.ts`, cambia la firma a:
```ts
export interface OpcionesAnalisis {
  ventanaDesasignacion?: number; // días; por defecto 30
  horizonteEnvio?: number; // mayor ventana de aviso; por defecto 30
}

export function analizar(
  rows: Record<string, unknown>[],
  ref: Date = hoy0(),
  opciones: OpcionesAnalisis = {},
): Analisis {
  const vDes = opciones.ventanaDesasignacion ?? 30;
  const hEnv = opciones.horizonteEnvio ?? 30;
```
   - Luego, en `desasignar`, reemplaza el `<= 30` fijo por `<= vDes`.
   - En `enviarLab`, reemplaza el `<= 30` fijo por `<= hEnv`.
   - En `Vencidos.tsx` llama a `analizar(rows, hoy0(), { ventanaDesasignacion: cfg.ventanaDesasignacion, horizonteEnvio: Math.max(...cfg.ventanas) })`.
   - Los chips de "Enviar a laboratorio" se arman con las ventanas ordenadas de menor a mayor: con [7, 15, 30] quedan "≤ 7 d", "8–15 d" y "16–30 d".
   - Los textos de las tarjetas usan los valores: "Asignados que vencen en ≤ {ventanaDesasignacion} días" y "Disponibles que vencen en ≤ {horizonteEnvio} días".
   - El semáforo (Vencido / ≤ 7 d / 8–30 d / Vigente) y `rangoDe()` NO cambian: son fijos.
6. **Limpieza de `src/lib/vencidos.ts`.** Elimina `CCConfig`, `CFG_DEFAULT`, `loadCfg`/`saveCfg` y los campos sin uso (`avisarBia`, `avisarContratistas`, `correos`, `appsScriptUrl`); volverán con el correo diario. Elimina también el código duplicado que ya vive en `certificados.ts`: `parseFecha`, `normalizarEquipo`, `construirEquipos`, `RANGOS`, `segmentoDe`, `discoverDateColumns`, `SESSIONLOG` y `registrarAccion`. Antes de borrar, confirma con una búsqueda que ningún otro archivo los importa (hoy solo los importa `Vencidos.tsx`). Deja `parseCSV`. Al montar el módulo, ejecuta `localStorage.removeItem("cc_cfg")`.

**Verificación:** en ⚙ Alertas, cambia la ventana de desasignación a 7 → la tarjeta Desasignar pasa de **8 a 5** (si esos equipos no se han movido en el WMS). Vuelve a 30 → **8**. Entra con otro usuario admin → ve la misma configuración.

---

## Paso 3 — Los envíos a laboratorio viven en un solo navegador

**Problema:** las fechas de envío que se cargan por CSV se guardan en localStorage (`cc_envios`): solo las ve quien las cargó y se pierden al cambiar de equipo.

**Solución:**
1. Usa la tabla `vencidos_envios_lab` del SQL del paso 2.
2. Mueve el cálculo a una función pura en `src/lib/certificados.ts` (agrégala al final, con este contenido):
```ts
/* ───────────── laboratorio externo ───────────── */

export interface EnvioLab {
  serial: string;
  proveedor: string; // INPEL | METROBIT
  fecha_envio: string; // ISO yyyy-mm-dd
}

export interface FilaLab {
  e: Equipo;
  enviado: Date | null;
  dias: number | null; // días en laboratorio
  exceso: number | null; // días sobre el SLA (> 0 = excede)
}

/** Para cada equipo en laboratorio toma el envío más reciente con fecha ≤ ref. */
export function filasLaboratorio(
  todos: Equipo[],
  envios: EnvioLab[],
  sla: { METROBIT: number; INPEL: number },
  ref: Date = hoy0(),
): FilaLab[] {
  const ultimo = new Map<string, Date>();
  for (const x of envios) {
    const f = parseFechaLocal(x.fecha_envio);
    const k = limpiar(x.serial);
    if (!f || !k || f > ref) continue;
    const prev = ultimo.get(k);
    if (!prev || f > prev) ultimo.set(k, f);
  }
  return todos
    .filter((e) => e.lab && !e.accesorio)
    .map((e) => {
      const enviado = ultimo.get(e.serial) ?? null;
      const dias = enviado ? diasEntre(ref, enviado) : null;
      const limite = e.lab ? sla[e.lab] : 0;
      return { e, enviado, dias, exceso: dias !== null && limite ? dias - limite : null };
    });
}
```
3. En `TabLab`:
   - Lee los envíos con `select serial, proveedor, fecha_envio` de `vencidos_envios_lab`.
   - Arma la tabla con `filasLaboratorio(a.todos, envios, { METROBIT: cfg.slaMetrobit, INPEL: cfg.slaInpel })`.
   - "Exceden SLA" = filas con `exceso > 0`. Si no hay ningún envío cargado, deja "—" con el texto "falta la fecha de envío".
4. "Cargar fechas de envío (CSV)", con columnas `serial, proveedor, fecha`:
   - Normaliza el proveedor a `INPEL` o `METROBIT` y convierte la fecha con `parseFechaLocal` a `yyyy-mm-dd`.
   - Haz `upsert` en `vencidos_envios_lab` con `onConflict: "serial,fecha_envio"`.
   - Rechaza las filas con proveedor o fecha inválidos, y muestra el toast "N cargadas · M rechazadas (proveedor o fecha inválida)".
   - Luego vuelve a leer la tabla.
5. Agrega el botón **"Plantilla"**: descarga un CSV con el encabezado `serial,proveedor,fecha` y una fila por cada equipo que hoy está en laboratorio (con serial y proveedor ya llenos, y la fecha vacía).
6. Migración automática: al abrir Laboratorio, si `localStorage["cc_envios"]` tiene filas, súbelas una sola vez (con el mismo `upsert`), borra la clave y muestra el toast "Se pasaron N fechas de envío a la base de datos".
7. Si la lectura de envíos falla: muestra el aviso ámbar "No se pudieron leer los envíos a laboratorio", deshabilita la carga y NO vuelvas a usar localStorage. Elimina `loadEnvios`/`saveEnvios` y `ENVIOS_KEY` de `vencidos.ts`.

**Verificación:** carga un CSV con `859272,INPEL,{fecha de hace 31 días}` → en la fila 859272 aparece Enviado con esa fecha, "31 d" y "+11 d sobre SLA" (SLA INPEL 20). "Exceden SLA" queda en **1**. Otro usuario admin ve lo mismo.

---

## Paso 4 — Números que no cuadran

**Problemas:**
- El contador de la pestaña Laboratorio y el subtítulo del módulo usan `a.pendientes.length` (**899**, todos los Pendiente certificados), mientras que el backlog usa `a.recert.length` (**876**, los ya vencidos).
- La diferencia de 23 no se explica en ninguna parte.
- (La ventana de desasignación, que decía 7 en la config y 30 en el cálculo, ya quedó resuelta en el paso 2.)

**Solución:**
1. El contador de la pestaña Laboratorio pasa a ser `a.recert.length`.
2. El subtítulo vuelve a "{N} equipos certificables · disponibles, asignados y pendientes de certificado". Quita el "· 899 pendientes de certificado".
3. El primer KPI de Laboratorio queda así: título **"Esperan recertificación"**, valor `a.recert.length`, subtexto "de {a.pendientes.length} en pendiente certificados · {k} con certificado vigente".
4. En `analizar()`, agrega a `calidad.problemas`, antes de "Instalado sin Bia Code":
```ts
    {
      label: "Pendiente certificados con certificado vigente (¿pasar a Disponible?)",
      items: certificables.filter((e) => e.estado === "PENDIENTE CERTIFICADOS" && e.rango === "vigente"),
    },
```
   Ese es el `{k}` del KPI. Con el inventario del 2 oct son **23**: 10 TP, 8 medidores y 5 TC, todos con certificado vigente por 463 días o más. Probablemente ya se recertificaron y el estado nunca se actualizó. El chip "⚠ N con datos incompletos" NO cambia (sigue en 17).
5. Debajo de la tabla "¿Qué recertificar primero?", cuando `k > 0`, muestra la nota: "{k} equipos en Pendiente certificados ya tienen certificado vigente (TP: {x}). Si pasan a Disponible, el stock listo sube." Agrega un link "Ver" que abre Equipos con un filtro nuevo, "Vigentes en pendiente" (agrégalo a `Preset` y a `PRESET_LABEL`).

---

## Pruebas

En `src/lib/certificados.test.ts`, **no modifiques** el `describe` existente: debe seguir pasando igual. Agrega este bloque al final:
```ts
describe("Configuración, laboratorio y consistencia", () => {
  const ref = new Date(2026, 9, 2);
  const s = (l: { serial: string }[]) => l.map((e) => e.serial).sort();
  const D2 = [
    { Serial: "A1-11D", Sku: "D2000Cor5(100) AT", "Tipo Sku": "Medidor", Estado: "ASIGNADO", Ubicacion: "Bia Bogota", "Bia Code": "CO0400006538", "Vencimiento Certificado Calibracion": "2026-10-13", "Vencimiento Certificado Conformidad": "2028-02-17" },
    { Serial: "A2-4D", Sku: "D2000Cor5(100) AT", "Tipo Sku": "Medidor", Estado: "ASIGNADO", Ubicacion: "Bia Bogota", "Bia Code": "CO0400006538", "Vencimiento Certificado Calibracion": "2026-10-06", "Vencimiento Certificado Conformidad": "2028-02-17" },
    { Serial: "D1-49D", Sku: "TC 5/5 Exterior C 0.5s B 5 VA T 17,5 kV", "Tipo Sku": "Transformador de corriente", Estado: "DISPONIBLE", Ubicacion: "Bia Bogota", "Vencimiento Certificado Calibracion": "2026-11-20", "Vencimiento Certificado Conformidad": "2028-01-23" },
    { Serial: "P1-VIGENTE", Sku: "TP 13200/120 V 5 VA Exterior", "Tipo Sku": "Transformador de potencial", Estado: "PENDIENTE CERTIFICADOS", Ubicacion: "Bia Bogota", "Vencimiento Certificado Calibracion": "2028-01-01", "Vencimiento Certificado Conformidad": "2028-12-10" },
    { Serial: "P2-VENCIDO", Sku: "TP 13200/120 V 5 VA Exterior", "Tipo Sku": "Transformador de potencial", Estado: "PENDIENTE CERTIFICADOS", Ubicacion: "Bia Bogota", "Vencimiento Certificado Calibracion": "2026-01-01", "Vencimiento Certificado Conformidad": "2028-12-10" },
    { Serial: "859272", Sku: "TP 13200/120 V 5 VA Exterior", "Tipo Sku": "Transformador de potencial", Estado: "PENDIENTE CERTIFICADOS", Ubicacion: "INPEL", "Vencimiento Certificado Calibracion": "2026-09-16", "Vencimiento Certificado Conformidad": "2028-12-10" },
  ];
  const vigentes = (a: ReturnType<typeof analizar>) =>
    a.calidad.problemas.find((p) => p.label.startsWith("Pendiente certificados con certificado vigente"))!.items;

  it("valores por defecto (30 días)", () => {
    const a = analizar(D2, ref);
    expect(s(a.desasignar)).toEqual(["A1-11D", "A2-4D"]);
    expect(a.enviarLab.length).toBe(0);
    expect(s(a.recert)).toEqual(["859272", "P2-VENCIDO"]);
    expect(s(vigentes(a))).toEqual(["P1-VIGENTE"]);
    expect(a.calidad.total).toBe(0);
  });

  it("ventana de desasignación configurable", () => {
    expect(s(analizar(D2, ref, { ventanaDesasignacion: 7 }).desasignar)).toEqual(["A2-4D"]);
  });

  it("horizonte de envío = mayor ventana de aviso", () => {
    expect(s(analizar(D2, ref, { horizonteEnvio: 60 }).enviarLab)).toEqual(["D1-49D"]);
  });

  it("SLA de laboratorio con el envío más reciente que no sea futuro", () => {
    const envios = [
      { serial: "859272", proveedor: "INPEL", fecha_envio: "2026-07-01" },
      { serial: "859272", proveedor: "INPEL", fecha_envio: "2026-09-01" },
      { serial: "859272", proveedor: "INPEL", fecha_envio: "2026-10-10" },
    ];
    const f = filasLaboratorio(analizar(D2, ref).todos, envios, { METROBIT: 15, INPEL: 20 }, ref);
    expect(f).toHaveLength(1);
    expect(f[0].enviado).toEqual(new Date(2026, 8, 1));
    expect(f[0].dias).toBe(31);
    expect(f[0].exceso).toBe(11);
  });
});
```
(Agrega `filasLaboratorio` al `import` del archivo de pruebas.) Corre `npm test`: deben pasar las pruebas viejas y las nuevas.

## Checklist final
Referencia: export de Metabase del 2 oct recalculado al 5 oct. Con datos en vivo los números se mueven cada día (equipos que vencen y cambios en el WMS).
- [ ] Respaldo en IndexedDB funciona (verificación del paso 1).
- [ ] ⚙ Alertas guarda en Supabase. Desasignar: 8 con 30 días, 5 con 7 días. Enviar a laboratorio: 121 (≤ 7 d · 64 · 8–15 d · 29 · 16–30 d · 28).
- [ ] Envíos por CSV quedan en la base y los ve cualquier admin; el SLA se calcula.
- [ ] La pestaña Laboratorio muestra **876**; el subtítulo ya no dice 899; el KPI dice "Esperan recertificación 876 · de 899 en pendiente certificados · 23 con certificado vigente".
- [ ] Calidad de datos lista "Pendiente certificados con certificado vigente: 23" y el chip sigue en **17**.
- [ ] Ya no hay `cc_cfg`, `cc_envios` ni `cc_snapshot_18021` en localStorage.
- [ ] Las otras pestañas de la app no cambiaron.
