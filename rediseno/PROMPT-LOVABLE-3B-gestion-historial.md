Agrega al módulo **Vencidos** las marcas de "gestionado" y el historial diario con su tendencia. Este prompt va después del de laboratorio (3A). Sigue los pasos en orden.

**Alcance estricto.** Solo puedes modificar:
- `src/components/tabs/Vencidos.tsx`
- `src/lib/certificados.ts`
- `src/lib/certificados.test.ts` (solo para AGREGAR pruebas)

Puedes usar los componentes de `src/components/ui` y `getSession()` de `@/lib/auth` sin modificarlos. NO toques `App.tsx`, las otras pestañas, `metabase-proxy`, `src/lib/supabase.ts` ni `src/lib/auth.ts`.

**Estado de la base (ya hecho):** ya existen `vencidos_gestion` (id, serial, accion, vence_ref, nota, gestionado_por, gestionado_por_nombre, gestionado_en) y `vencidos_historial` (una fila por `fecha`), y el historial ya trae la línea base del 2 oct 2026. RLS: leer requiere sesión iniciada; escribir requiere ser admin. No ejecutes SQL. Recuerda que Supabase devuelve como máximo 1000 filas por consulta: pagina con `.range()`.

---

## Paso 0 — Laboratorio: abrir el Detalle desde la tabla y anular
Hoy "Anular envío" solo existe en el panel de Detalle (tarjeta `LabCard`), y la tabla de Laboratorio no abre ese panel.
- Pasa `onSel={setSel}` a `TabLab`; hoy solo recibe `a`, `abrirAlertas` y `abrir`.
- En la tabla "En laboratorio externo", cada fila abre el Detalle al hacer clic (cursor de mano y resaltado al pasar). Haz lo mismo con las filas de la vista previa del lote.
- En la columna Acción, cuando la fila tiene envío, agrega junto a "Marcar recibido" el botón secundario **"Anular"**. Llama al mismo `anular(x.envio)` de `useLab()`, que ya pide confirmación.
- Los botones dentro de una fila usan `e.stopPropagation()` para no abrir el Detalle.

## Paso 1 — Lógica pura en `src/lib/certificados.ts`
Agrega al final del archivo este código exacto:
```ts
/* ───────────── gestión ───────────── */

export type AccionGestion = "bloquear" | "desasignar" | "revisar_estado";

export interface MarcaGestion {
  id?: string;
  serial: string;
  accion: AccionGestion;
  vence_ref: string; // vencimiento del equipo cuando se marcó (yyyy-mm-dd)
  gestionado_en: string; // timestamp ISO
  gestionado_por_nombre?: string | null;
  nota?: string | null;
}

export const DIAS_ESPERA_WMS = 7;

export interface ItemGestion {
  e: Equipo;
  marca: MarcaGestion | null;
  estado: "pendiente" | "gestionado" | "sin_efecto";
  dias: number | null; // días desde la marca
}

/**
 * Cruza una lista de acción con las marcas de "gestionado". Una marca aplica solo
 * mientras el equipo tenga el mismo vencimiento que cuando se marcó. En Bloquear y
 * Desasignar, si a los 7 días el WMS sigue igual, vuelve a pendientes como "sin efecto".
 * En "revisar_estado" la marca no vence.
 */
export function aplicarGestion(lista: Equipo[], accion: AccionGestion, marcas: MarcaGestion[], ref: Date = hoy0()) {
  const espera = accion === "revisar_estado" ? Infinity : DIAS_ESPERA_WMS;
  const ultima = new Map<string, MarcaGestion>();
  for (const m of marcas) {
    if (m.accion !== accion) continue;
    const k = `${limpiar(m.serial)}|${m.vence_ref}`;
    const prev = ultima.get(k);
    if (!prev || Date.parse(m.gestionado_en) > Date.parse(prev.gestionado_en)) ultima.set(k, m);
  }
  const items: ItemGestion[] = lista.map((e) => {
    const marca = e.vence ? ultima.get(`${e.serial}|${isoDia(e.vence)}`) ?? null : null;
    if (!marca) return { e, marca: null, estado: "pendiente", dias: null };
    const dias = diasEntre(ref, new Date(Date.parse(marca.gestionado_en)));
    return { e, marca, estado: dias <= espera ? "gestionado" : "sin_efecto", dias };
  });
  return {
    pendientes: items.filter((i) => i.estado !== "gestionado"),
    gestionados: items.filter((i) => i.estado === "gestionado"),
    sinEfecto: items.filter((i) => i.estado === "sin_efecto"),
  };
}

/* ───────────── historial ───────────── */

export interface FilaHistorial {
  fecha: string; // yyyy-mm-dd
  certificables: number;
  al_dia: number;
  vencidos: number;
  vence_7: number;
  vence_30: number;
  bloquear: number;
  desasignar: number;
  enviar_lab: number;
  esperan_recert: number;
  recert_6m: number;
  vigentes_en_pendiente: number;
  en_lab: number;
  exceden_sla: number | null;
}

/** Foto del día con los conteos del WMS (antes de descontar gestionados o envíos). */
export function filaHistorial(a: Analisis, lab: FilaLab[], ref: Date = hoy0()): FilaHistorial {
  return {
    fecha: isoDia(ref),
    certificables: a.certificables.length,
    al_dia: a.conteo.vigente,
    vencidos: a.conteo.vencido,
    vence_7: a.conteo.d7,
    vence_30: a.conteo.d30,
    bloquear: a.bloquear.length,
    desasignar: a.desasignar.length,
    enviar_lab: a.enviarLab.length,
    esperan_recert: a.recert.length,
    recert_6m: a.recert6m,
    vigentes_en_pendiente: a.certificables.filter((e) => e.estado === "PENDIENTE CERTIFICADOS" && e.rango === "vigente").length,
    en_lab: lab.length,
    exceden_sla: lab.some((f) => f.enviado) ? lab.filter((f) => (f.exceso ?? 0) > 0).length : null,
  };
}

/** Valor de un indicador hace `dias` días: la foto más reciente con fecha ≤ (ref − dias). */
export function valorHace(
  historial: FilaHistorial[],
  campo: Exclude<keyof FilaHistorial, "fecha">,
  dias: number,
  ref: Date = hoy0(),
): number | null {
  const objetivo = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - dias);
  let mejor: { f: Date; v: number | null } | null = null;
  for (const h of historial) {
    const f = parseFechaLocal(h.fecha);
    if (!f || f > objetivo) continue;
    if (!mejor || f > mejor.f) mejor = { f, v: h[campo] };
  }
  return mejor ? mejor.v : null;
}
```

## Paso 2 — Marcas de "gestionado"
- En el componente principal, lee `vencidos_gestion` completo, paginando igual que `recargarEnvios`. Guárdalo en estado y crea `recargarMarcas()`. Comparte `marcas` y `recargarMarcas` agregándolos al contexto que ya existe (`LabCtx` / `useLab()`), así Hoy, Equipos y Detalle los leen sin pasar props.
- Calcula estas tres listas y úsalas en todo el módulo:
  - `gBloquear = aplicarGestion(a.bloquear, "bloquear", marcas)`
  - `gDesasignar = aplicarGestion(a.desasignar, "desasignar", marcas)`
  - `gVigentes = aplicarGestion(vigentesEnPendiente, "revisar_estado", marcas)`, donde `vigentesEnPendiente` son los certificables en PENDIENTE CERTIFICADOS con rango vigente.

## Paso 3 — Hoy: contar solo lo pendiente
- **Bloquear y Desasignar.** El número grande y las filas salen de `pendientes`. A las filas "sin efecto" agrégales debajo, en ámbar: "marcado hace N d · el WMS sigue igual". Chips nuevos, solo si son mayores que 0:
  - "N gestionados · esperando WMS": abre Equipos con ese filtro y los gestionados visibles.
  - "M sin efecto en el WMS (+7 d)", en ámbar.
  - Los chips actuales (contratistas, bodegas y Bia Codes) se calculan sobre `pendientes`.
- **Pendientes con certificado vigente** (nota de Laboratorio y filtro `vigpend`): usa `gVigentes.pendientes` y agrega "· N ya revisados".

## Paso 4 — Detalle: sección "Gestión"
Aparece cuando el equipo está en Bloquear, Desasignar o Vigentes en pendiente.
- **Sin marca**, muestra un botón según la lista:
  - Bloquear: "Marcar: ya se pasó a Pendiente certificados".
  - Desasignar: "Marcar: ya se desasignó".
  - Vigentes en pendiente: "Marcar como revisado".

  Debajo va un campo de nota opcional. Al guardar, inserta `{ serial, accion, vence_ref: isoDia(e.vence), nota, gestionado_por_nombre }`, luego `recargarMarcas()` y un toast. El nombre sale de `getSession()?.nombre` de `@/lib/auth`; impórtalo con otro nombre, por ejemplo `getAppSession`, para no confundirlo con `supabase.auth.getSession()`.
- **Gestionado:** "✓ Gestionado por {nombre} hace N d", con la nota y el botón "Deshacer", que borra la marca por `id`.
- **Sin efecto:** en ámbar, "Marcado hace N d, pero el WMS sigue igual", y el botón "Marcar de nuevo".

## Paso 5 — Equipos: gestionar en bloque
- Con los filtros `bloquear`, `desasignar` o `vigpend`, la tabla muestra por defecto los `pendientes`. Agrega el interruptor "Mostrar gestionados (N)".
- En la barra de selección (la de `selec`), agrega "Marcar como gestionado (N)" para esos tres filtros, con una nota opcional. Inserta una marca por equipo y limpia la selección.

## Paso 6 — Historial diario
- Después de una carga EN VIVO exitosa (nunca desde el respaldo) y con los envíos ya leídos:
  - Calcula `filaHistorial(a, filasLaboratorio(a.todos, envios, sla))`.
  - Haz `upsert` en `vencidos_historial` con `onConflict: "fecha"`, más `actualizado_en` (ahora) y `actualizado_por`. El id del usuario se obtiene con `supabase.auth.getUser()`, como en "Marcar recibido".
  - Hazlo una vez por carga. Si falla, `console.warn` y sin toast.
  - La foto guarda los números del WMS, antes de descontar gestionados o envíos.
- Lee los últimos 180 días de `vencidos_historial`, ordenados por fecha.

## Paso 7 — Tendencia en Hoy (debajo de la tarjeta de salud)
- Tres tarjetas pequeñas en una fila (una columna en móvil): **Esperan recertificación**, **% al día** (al_dia / certificables) y **Bloquear** (según el WMS). Cada una lleva:
  - El valor actual.
  - Un sparkline en SVG: línea gris `#71717a` de 1,5 px y el último punto en verde `#2fe07a`.
  - Las diferencias "vs hace 7 d" y "vs hace 30 d", calculadas con `valorHace`. Para el %, usa `valorHace(al_dia) / valorHace(certificables)`.
- Cada diferencia lleva signo y flecha (↑ ↓): verde si mejora (backlog y Bloquear bajan, % al día sube), roja si empeora y gris si no cambia. Si no hay foto de esa fecha, muestra "—".
- Si hay menos de 2 fotos, muestra en su lugar: "La tendencia se arma con una foto por día. Línea base: 2 oct 2026 (876 esperando recertificación)."
- Agrega el link "Exportar historial (CSV)".

## Pruebas
En `src/lib/certificados.test.ts`, agrega al `import` las funciones `aplicarGestion`, `filaHistorial` y `valorHace`, y el tipo `AccionGestion`. Pega este bloque al final:
```ts
describe("Gestión e historial", () => {
  const ref = new Date(2026, 9, 2);
  const a = analizar(DATA, ref);
  const marca = (serial: string, accion: AccionGestion, vence_ref: string, gestionado_en: string) => ({ serial, accion, vence_ref, gestionado_en });

  it("bloquear: gestionado ≤ 7 días, después vuelve como 'sin efecto'", () => {
    const g1 = aplicarGestion(a.bloquear, "bloquear", [marca("T3-DISP", "bloquear", "2024-02-01", "2026-09-30T15:00:00Z")], ref);
    expect([g1.pendientes.length, g1.gestionados.length, g1.gestionados[0].dias]).toEqual([0, 1, 2]);
    const g2 = aplicarGestion(a.bloquear, "bloquear", [marca("T3-DISP", "bloquear", "2024-02-01", "2026-09-20T15:00:00Z")], ref);
    expect([g2.pendientes.length, g2.sinEfecto.length, g2.sinEfecto[0].dias]).toEqual([1, 1, 12]);
  });

  it("la marca solo aplica al mismo vencimiento y gana la más reciente", () => {
    const otra = aplicarGestion(a.bloquear, "bloquear", [marca("T3-DISP", "bloquear", "2023-01-01", "2026-09-30T15:00:00Z")], ref);
    expect(otra.pendientes[0].estado).toBe("pendiente");
    const dos = aplicarGestion(a.bloquear, "bloquear", [
      marca("T3-DISP", "bloquear", "2024-02-01", "2026-09-20T15:00:00Z"),
      marca("T3-DISP", "bloquear", "2024-02-01", "2026-09-30T15:00:00Z"),
    ], ref);
    expect(dos.gestionados.length).toBe(1);
  });

  it("revisar estado: la marca no vence", () => {
    const vig = a.certificables.filter((e) => e.estado === "PENDIENTE CERTIFICADOS" && e.rango === "vigente");
    const g = aplicarGestion(vig, "revisar_estado", [marca("T1-RELLENO", "revisar_estado", "2028-09-19", "2026-06-01T12:00:00Z")], ref);
    expect([g.gestionados.length, g.gestionados[0].dias]).toEqual([1, 123]);
  });

  it("foto diaria del historial", () => {
    expect(filaHistorial(a, [], ref)).toEqual({
      fecha: "2026-10-02", certificables: 7, al_dia: 4, vencidos: 3, vence_7: 0, vence_30: 0,
      bloquear: 1, desasignar: 1, enviar_lab: 0, esperan_recert: 1, recert_6m: 1,
      vigentes_en_pendiente: 1, en_lab: 0, exceden_sla: null,
    });
  });

  it("valor de hace N días", () => {
    const base = filaHistorial(a, [], ref);
    const h = [{ ...base, fecha: "2026-10-02", esperan_recert: 876 }, { ...base, fecha: "2026-10-05", esperan_recert: 870 }];
    const hoy = new Date(2026, 9, 5);
    expect(valorHace(h, "esperan_recert", 3, hoy)).toBe(876);
    expect(valorHace(h, "esperan_recert", 0, hoy)).toBe(870);
    expect(valorHace(h, "esperan_recert", 7, hoy)).toBe(null);
  });
});
```
Corre `npm test`: deben pasar las 16 (las 11 actuales y estas 5).

## Checklist
- [ ] En Laboratorio, clic en una fila abre el Detalle; el botón "Anular" de la tabla borra el envío (con confirmación) y el equipo vuelve a su lista.
- [ ] Marca un equipo de Bloquear como gestionado: el número baja en 1 y aparece "1 gestionados · esperando WMS". Otro admin lo ve. "Deshacer" lo devuelve.
- [ ] Marca 1 de los vigentes en pendiente como revisado: la nota pasa a "22 … · 1 ya revisados" (con los datos del 5 oct).
- [ ] Al abrir el módulo con datos en vivo, la tabla `vencidos_historial` en Supabase muestra la fila de hoy, además de la línea base del 2 oct.
- [ ] La tendencia ya se ve con 2 puntos (línea base y hoy). "vs hace 7 d" muestra "—" hasta que exista una foto de hace 7 días.
- [ ] Las otras pestañas de la app no cambiaron.
