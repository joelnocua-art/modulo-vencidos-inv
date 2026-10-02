# Módulo de Vencidos · Capa B — Correo diario automático

El módulo en Lovable **muestra** qué hacer. La Capa B hace que esa lista
**llegue sola por correo** cada mañana, sin que nadie tenga que abrir la app.

Corre en **Google Apps Script** (gratis) con una **Google Sheet**. **No necesita
Supabase** ni tocar el código de Lovable. Usa las mismas reglas que el módulo
(`src/lib/certificados.ts`): con el inventario del 2 oct 2026 da exactamente los
mismos equipos, serial por serial, en Bloquear (13), Desasignar (8), Enviar a
laboratorio (113) y Esperan recertificación (876).

```
Metabase (card 18021) ──► Apps Script (7 AM, días hábiles) ──► Gmail
  inventario en vivo            │                                ├─ Resumen a Supply (3 acciones + CSV)
                                │                                └─ Aviso a cada contratista (solo sus equipos)
                                └──► Google Sheet: "Contactos" y "Log" (para no repetir avisos)
```

## Qué llega

| Correo | A quién | Cuándo |
|---|---|---|
| **Resumen del día**: Bloquear, Desasignar y Enviar a laboratorio, el backlog, los pendientes con certificado vigente y quiénes no tienen correo. Con CSV adjunto. | `SUPPLY_EMAIL` | Cada día hábil, si hay algo pendiente |
| **Aviso al contratista**: solo sus equipos disponibles o asignados, con "No instalar" si el certificado está vencido o con la fecha si vence en 30, 15 o 7 días. Copia a Supply; las respuestas le llegan a Supply. | Correos de la hoja `Contactos` | Una vez por equipo y por plazo |

Ejemplos: `correo-resumen-supply.png` y `correo-contratista.png` en esta carpeta.

## Lo que necesitas

1. Una cuenta de Google de Bia (desde ella salen los correos).
2. Tu API key de Metabase.
3. La hoja de contactos: parte de `rediseno/contactos-alertas-plantilla.csv` y llena la columna de correos.

## Instalación (≈10 min)

1. **Crea una Google Sheet** nueva, por ejemplo `Vencidos · correo diario`.
2. **Importa los contactos:** Archivo › Importar › sube `contactos-alertas-plantilla.csv` › *Insertar hojas nuevas*. Renombra la pestaña a **`Contactos`**. Llena la columna `correos (separados por ;)` de cada contratista. Varios correos van separados por `;`. Las filas de bodegas Bia e INPEL se pueden dejar vacías: esos equipos van en el resumen a Supply.
3. **Extensiones › Apps Script.** Borra lo que haya, pega todo `Codigo.gs` y guarda.
4. **Configuración del proyecto** (⚙ a la izquierda):
   - **Zona horaria:** `(GMT-05:00) Bogotá`.
   - **Propiedades del script › Agregar:** clave `MB_KEY`, valor tu API key de Metabase.
5. En el bloque `CONFIG`, al inicio del script, cambia **`SUPPLY_EMAIL`** por el correo real de Supply. Deja `MODO_PRUEBA: true`.
6. **Ejecuta `previsualizar`** (menú ▶). Google pide autorizar permisos (Gmail, la Sheet y conexión externa a Metabase): acéptalos. En *Registro de ejecución* revisa los números. Deben coincidir con la pestaña Hoy del módulo.
7. **Ejecuta `probar`:** te llegan **a ti** el resumen y un aviso por cada contratista con correo, marcados **[PRUEBA]**, con el destinatario real indicado arriba.
8. Si todo se ve bien, **ejecuta `instalarTrigger`** una sola vez. Mientras `MODO_PRUEBA` siga en `true`, el envío diario te llega solo a ti. Es útil dejarlo así unos días.
9. Para producción, cambia **`MODO_PRUEBA: false`** y guarda. Desde el día siguiente, los correos van a Supply y a los contratistas.

## Cómo evita repetir avisos

Cada aviso real a un contratista se guarda en la pestaña `Log` como `serial + plazo`: `30`, `15`, `7` o `vencido`. Un equipo se avisa una vez cuando entra a 30 días, otra a 15, otra a 7 y otra si vence estando con el contratista. Es una escalada, no un duplicado.

- Las corridas de **prueba** quedan en el Log como `prueba` y **no cuentan**. Al pasar a producción, los contratistas reciben su primer aviso aunque ya lo hayas probado.
- El **resumen a Supply** sí sale todos los días hábiles, porque es la lista de trabajo del día.

## Funciones

| Función | Para qué |
|---|---|
| `previsualizar` | Calcula y muestra los números en el registro. **No envía nada.** |
| `probar` | Envía todo **solo a ti** (`TEST_EMAIL`), sin importar `MODO_PRUEBA`. |
| `instalarTrigger` | Crea el envío diario a la hora `HORA_ENVIO`. Se ejecuta una sola vez. |
| `tareaDiaria` | La que corre el disparador. No envía sábados ni domingos (`SOLO_DIAS_HABILES`). |

## Notas

- **Mismos valores que el módulo:** `VENTANAS` y `VENTANA_DESASIGNACION` deben coincidir con ⚙ Alertas del módulo. El script todavía no los lee de Supabase.
- **Cuota de Gmail:** Google Workspace permite unos 1.500 destinatarios al día. Esto envía 1 resumen más 1 correo por contratista con avisos nuevos. Hoy son 7 contratistas con algo pendiente.
- **Seguridad:** se quitó el *endpoint* web público de la versión anterior (`doPost` con acceso "cualquiera"), porque cualquiera con la URL podía disparar envíos y ver datos del inventario.
- La API key queda en las *propiedades del script*, no en el código ni en la Sheet.
- Esta carpeta es independiente: no toca el código de Lovable ni otros módulos.
