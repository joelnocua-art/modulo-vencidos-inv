# Módulo de Vencidos · Capa B — Envío automático de alertas

La **Capa A** (el módulo `certcontrol.html`) ya calcula y muestra todo con datos
reales en el navegador. La **Capa B** es lo único que faltaba para que las
alertas **salgan solas por correo** cada mañana, sin que nadie abra la página.

No usa Supabase ni servidores propios: corre en **Google Apps Script** (gratis)
y guarda el registro en una **Google Sheet**. Usa exactamente la misma lógica
que el módulo (parser de fechas en español, población gestionable, semáforo y
ruteo Bia/contratista/lab), así que los números del correo coinciden con la web.

**Datos EN VIVO:** se conecta directamente a Metabase (card 18021 "Inventario WMS")
cada vez que corre. No depende de snapshots desactualizados.

```
Metabase (card 18021)  ──►  Apps Script (cron 7 AM)  ──►  Gmail
  Inventario EN VIVO            │
                                └──►  Google Sheet (Log + Contactos, dedupe)
```

---

## Instalación (≈10 min)

1. **Crea una Google Sheet** nueva y nómbrala, p. ej., `Alertas Vencidos`.
   Será el registro de envíos (dedupe) y la libreta de contactos.

2. En esa Sheet: **Extensiones → Apps Script**. Borra lo que haya y **pega el
   contenido de `Codigo.gs`**. Guarda (💾).

3. **Configura la API key de Metabase** (para que lea datos EN VIVO):
   - En el editor de Apps Script: **Proyecto → Configuración del proyecto**
   - En **Propiedades** (parte izquierda): agrega una nueva propiedad
     - Clave: `MB_KEY`
     - Valor: tu API key de Metabase (puedes generarla en Metabase → Admin → Settings → Authentication → API keys)

4. **Edita el bloque `CONFIG`** al inicio del script:
   - `SUPPLY_EMAIL`: el correo del equipo de Supply.
   - `VENTANAS`: deja `[30, 15, 7]` o ajústalas.
   - Deja `MODO_PRUEBA: true` por ahora (envía todo solo a ti para validar).

4. *(Opcional pero recomendado)* Crea una pestaña llamada **`Contactos`** con
   dos columnas en la fila 1: **`Ubicación`** y **`Correo`**. Debajo, una fila
   por contratista (la `Ubicación` debe coincidir con la del inventario):

   | Ubicación          | Correo                |
   |--------------------|-----------------------|
   | SGE Bucaramanga    | contacto@sge.com      |
   | JEM                | avisos@jem.com        |

   Si un contratista no está en la lista, su aviso se manda a `SUPPLY_EMAIL`.

5. **Ejecuta la función `probar`** una vez (menú ▶ arriba). Google te pedirá
   **autorizar permisos** (Gmail, leer URLs y la Sheet): acéptalos. Revisa que
   te llegue el correo de prueba y que la pestaña `Log` se llene.

6. Cuando los números se vean bien, cambia **`MODO_PRUEBA: false`** y ejecuta
   **`instalarTrigger`** una sola vez. Eso crea el disparador **diario a las
   7 AM** (cambia `HORA_ENVIO` si quieres otra hora).

7. *(Opcional)* Para disparar un envío desde el botón del módulo:
   **Implementar → Nueva implementación → App web** · *Ejecutar como:* yo ·
   *Quién tiene acceso:* cualquiera. Copia la URL y pégala en el módulo
   (**Configuración → URL de Apps Script**). El botón "Enviar ahora" hará un
   `POST` a esa URL.

8. **Mantén `mb-data.json` actualizado** (es la fuente). Cuando tengas una card
   de Metabase que devuelva el inventario completo, descomenta el bloque
   *ALTERNATIVA EN VIVO* dentro de `obtenerInventario()` y pon su ID — así las
   alertas usan datos en vivo en lugar del snapshot.

---

## Cómo funciona el dedupe

Cada aviso se registra en la pestaña `Log` con la clave `serial + ventana`.
Un equipo se avisa **una vez por ventana**: entra en la de 30 días → un correo;
días después cruza a la de 15 → otro correo (es una escalación, no un duplicado);
y así con la de 7. Nunca se repite el mismo serial dentro de la misma ventana.
Para desactivarlo, pon `DEDUPE: false` en `CONFIG`.

## Funciones del script

| Función             | Para qué                                                        |
|---------------------|-----------------------------------------------------------------|
| `probar`            | Envío de prueba (respeta `MODO_PRUEBA`). Úsala para validar.     |
| `previsualizar`     | Solo calcula y registra números en el `Log`; **no envía**.       |
| `instalarTrigger`   | Crea el disparador diario. Ejecutar una sola vez.                |
| `tareaDiaria`       | La que corre el disparador (envío real). No la ejecutes a mano.  |
| `enviarAlertasDiarias(dryRun)` | Núcleo: si `dryRun=true` calcula sin enviar.          |

## Notas

- **Cuota de Gmail**: cuentas gratuitas envían ~100 correos/día; Workspace
  ~1.500. El dedupe mantiene el volumen bajo (solo equipos que *cambian* de
  ventana cada día).
- **Zona horaria**: el disparador usa la zona del proyecto Apps Script
  (Configuración del proyecto → Zona horaria). Ponla en `America/Bogota`.
- Esta carpeta es independiente: **no afecta** a `index.html` ni a
  `certcontrol.html`. Puedes copiarla al repo original tal cual.
