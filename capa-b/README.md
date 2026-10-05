# Módulo de Vencidos · Capa B — Correo diario automático

El módulo en Lovable **muestra** qué hacer. La Capa B hace que esa lista
**llegue sola por correo** cada mañana, sin que nadie tenga que abrir la app.

Corre en **Google Apps Script** (gratis) con una **Google Sheet** y no toca el
código de Lovable. Usa las mismas reglas que el módulo (`src/lib/certificados.ts`):
con el inventario del 2 oct 2026 da exactamente los mismos equipos, serial por
serial, en Bloquear (13), Desasignar (8), Enviar a laboratorio (113) y Esperan
recertificación (876). El reporte de calidad de datos también cuenta lo mismo que
el panel del módulo, categoría por categoría.

```
Metabase (card 18021) ──► Apps Script (7 AM, días hábiles) ──► Gmail
  inventario en vivo            │                                ├─ Resumen a Supply (3 acciones + CSV)
                                │                                ├─ Aviso a cada contratista (solo sus equipos)
Supabase (opcional) ────────────┤                                └─ Lunes: calidad de datos al equipo del WMS
  ⚙ Alertas, envíos, gestión    │
                                └──► Google Sheet: "Contactos" y "Log" (para no repetir avisos)
```

## Qué llega

| Correo | A quién | Cuándo |
|---|---|---|
| **Resumen del día**: Bloquear, Desasignar y Enviar a laboratorio, el backlog, los pendientes con certificado vigente y quiénes no tienen correo. Con CSV adjunto. | `SUPPLY_EMAIL` | Cada día hábil, si hay algo pendiente |
| **Aviso al contratista**: solo sus equipos disponibles o asignados, con "No instalar" si el certificado está vencido o con la fecha si vence en 30, 15 o 7 días. Copia a Supply; las respuestas le llegan a Supply. | Correos de la hoja `Contactos` | Una vez por equipo y por plazo |
| **Calidad de datos** (opcional): fechas de relleno, seriales con errores, estados que se contradicen, etc., con CSV. | `WMS_EMAIL` | Los lunes |

Ejemplos: `correo-resumen-supply.png` y `correo-contratista.png` en esta carpeta.

## Instalación (≈10 min)

1. **Crea una Google Sheet** nueva, por ejemplo `Vencidos · correo diario`.
2. **Importa los contactos:** Archivo › Importar › sube `rediseno/contactos-alertas-plantilla.csv` › *Insertar hojas nuevas*. Renombra la pestaña a **`Contactos`** y llena la columna `correos (separados por ;)` de cada contratista. Varios correos van separados por `;`.
3. **Extensiones › Apps Script.** Borra lo que haya, pega todo `Codigo.gs` y guarda.
4. **Configuración del proyecto** (⚙ a la izquierda):
   - **Zona horaria:** `(GMT-05:00) Bogotá`.
   - **Propiedades del script › Agregar:** clave `MB_KEY`, valor tu API key de Metabase.
5. En el bloque `CONFIG`, al inicio del script, cambia **`SUPPLY_EMAIL`** por el correo real de Supply. Si quieres el reporte semanal, pon **`WMS_EMAIL`**. Deja `MODO_PRUEBA: true`.
6. **Ejecuta `previsualizar`** (menú ▶) y autoriza los permisos (Gmail, la Sheet y conexión externa). En *Registro de ejecución* revisa los números: deben coincidir con la pestaña Hoy del módulo.
7. **Ejecuta `probar`:** te llega **a ti** todo, marcado **[PRUEBA]**, con el destinatario real indicado arriba.
8. **Ejecuta `instalarTrigger`** una sola vez. Mientras `MODO_PRUEBA` siga en `true`, el envío diario te llega solo a ti.
9. Para producción, cambia **`MODO_PRUEBA: false`** y guarda.

## Conectar el correo con el módulo (recomendado)

Sin esto, el correo usa solo los datos del WMS. Con esto, dice lo mismo que la pantalla:
- Toma las ventanas de **⚙ Alertas**.
- **Descuenta los equipos ya enviados a laboratorio** y los **marcados como gestionados**.
- Muestra los chips "N gestionados · esperando WMS", "sin efecto" y "ya enviados".

1. En la app, pestaña **Admin**, crea un usuario solo para esto, por ejemplo `correo-vencidos`, con rol **operario** y una contraseña larga. Desactívale "requiere pistoleo". El rol operario solo puede **leer** las tablas del módulo: no puede escribir.
2. En **Propiedades del script**, agrega:

   | Clave | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://ycbvwcjzgwfidyixtjrm.supabase.co` |
   | `SUPABASE_ANON_KEY` | la clave *anon public* (Supabase › Project Settings › API) |
   | `SUPABASE_USUARIO` | `correo-vencidos@bia.local` (el usuario + `@bia.local`) |
   | `SUPABASE_CLAVE` | la contraseña del paso 1 |
3. Ejecuta `previsualizar`: debe decir `"conectadoAlModulo": true`.

Si la conexión falla (por ejemplo, porque cambiaron la contraseña), **el correo sale igual** con los datos del WMS. El registro de ejecución dice "Sin conexión con el módulo" y el pie del correo también lo indica.

## Cómo evita repetir avisos

Cada aviso real a un contratista se guarda en la pestaña `Log` como `serial + plazo`: `30`, `15`, `7` o `vencido`. Un equipo se avisa una vez cuando entra a 30 días, otra a 15, otra a 7 y otra si vence estando con el contratista.

- Las corridas de **prueba** quedan como `prueba` y **no cuentan**.
- El **resumen a Supply** sí sale todos los días hábiles, porque es la lista de trabajo del día.
- Con la conexión al módulo, no se avisa a contratistas de equipos ya enviados a laboratorio ni de los que Supply marcó como gestionados.

## Funciones

| Función | Para qué |
|---|---|
| `previsualizar` | Calcula y muestra los números en el registro. **No envía nada.** |
| `probar` | Envía todo **solo a ti** (`TEST_EMAIL`), incluido el reporte del WMS si `WMS_EMAIL` está configurado. |
| `enviarReporteWms` | Envía ya el reporte de calidad de datos (respeta `MODO_PRUEBA`). |
| `instalarTrigger` | Crea el envío diario a la hora `HORA_ENVIO`. Se ejecuta una sola vez. |
| `tareaDiaria` | La que corre el disparador: no envía sábados ni domingos, y los lunes agrega el reporte del WMS. |

## Notas

- **Cuota de Gmail:** Google Workspace permite unos 1.500 destinatarios al día. Esto envía 1 resumen, 1 correo por contratista con avisos nuevos y, los lunes, 1 al WMS.
- **Seguridad:** la API key de Metabase y la clave del usuario quedan en las *propiedades del script*, no en el código ni en la Sheet. Usa una contraseña larga para el usuario del correo: también sirve para entrar a la app como operario.
- Se quitó el *endpoint* web público de la primera versión (`doPost` con acceso "cualquiera").
- Esta carpeta es independiente: no toca el código de Lovable ni otros módulos.
