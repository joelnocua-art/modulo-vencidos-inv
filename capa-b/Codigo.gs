/**
 * ============================================================================
 *  CertControl · CAPA B — Envío automático de alertas de vencimiento
 *  Google Apps Script (runtime V8) · sin Supabase · sin servidores propios
 * ============================================================================
 *
 *  QUÉ HACE
 *    Cada mañana (disparador horario) lee el inventario, calcula qué equipos
 *    entran en las ventanas de aviso (30/15/7 días), arma los correos y los
 *    envía con Gmail. Lleva un registro en la misma Google Sheet para NO
 *    repetir un aviso ya enviado (dedupe por serial + ventana).
 *
 *  USA LA MISMA LÓGICA QUE EL MÓDULO (certcontrol.html):
 *    parseFecha (meses en español), población gestionable, semáforo y ruteo
 *    Bia / contratista / laboratorio. Así los números del correo coinciden
 *    exactamente con lo que se ve en la página.
 *
 *  INSTALACIÓN: ver capa-b/README.md (8 pasos, ~10 minutos).
 * ============================================================================
 */

/* ============================ CONFIGURACIÓN ============================== */
const CONFIG = {
  // URL pública del snapshot del inventario (el mismo mb-data.json del repo).
  // Ej. GitHub Pages: 'https://joelnocua-art.github.io/modulo-vencidos-inv/mb-data.json'
  //     Netlify:      'https://TU-SITIO.netlify.app/mb-data.json'
  DATA_URL: 'https://TU-SITIO/mb-data.json',

  // Ventanas de aviso en días (escalonadas). Cada equipo se avisa una vez por ventana.
  VENTANAS: [30, 15, 7],

  // Correo del equipo de Supply: recibe los equipos de Bia y de laboratorio,
  // y va en copia (CC) de los correos a contratistas.
  SUPPLY_EMAIL: 'supply@bia.app',

  // A quién avisar
  AVISAR_BIA: true,          // equipos en sedes Bia -> SUPPLY_EMAIL
  AVISAR_CONTRATISTA: true,  // equipos en contratista -> correo del contratista (hoja "Contactos")
  AVISAR_LAB: true,          // equipos en METROBIT/INPEL -> SUPPLY_EMAIL

  // No reenviar el mismo (serial + ventana) si ya se avisó. Pon 0 para no deduplicar.
  DEDUPE: true,

  // Modo prueba: cuando es true, TODO se envía solo a TEST_EMAIL (no a los reales).
  // Úsalo para validar antes de activar el disparador. Pon false para producción.
  MODO_PRUEBA: true,
  TEST_EMAIL: Session.getActiveUser().getEmail(),

  // Hora del disparador diario (0-23). Se usa al ejecutar instalarTrigger().
  HORA_ENVIO: 7,

  // Nombre de la pestaña-registro dentro de la Sheet.
  HOJA_LOG: 'Log',
  HOJA_CONTACTOS: 'Contactos' // columnas: Ubicación | Correo
};

/* ===================== LÓGICA COMPARTIDA CON EL MÓDULO =================== */
const MES = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };

/** Parser de fechas robusto: ISO, "diciembre 10, 2028", "10 de mayo de 2026", dd/mm/yyyy. */
function parseFecha(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
  let m = s.toLowerCase().match(/([a-záéíóú]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MES[m[1]] !== undefined) return new Date(+m[3], MES[m[1]], +m[2]);
  m = s.toLowerCase().match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/);
  if (m && MES[m[2]] !== undefined) return new Date(+m[3], MES[m[2]], +m[1]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s); return isNaN(d) ? null : d;
}

function diasA(s) {
  const d = parseFecha(s); if (!d) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
  return Math.round((d - hoy) / 86400000);
}

const ES_ACCESORIO = sku => /ANTENA|BLOQUE|ROUTER|MODEM/i.test(sku || '');

/** Segmenta la ubicación igual que el módulo. */
function seg(u) {
  u = u || '';
  if (/^bia/i.test(u)) return 'Bia';
  if (/METROBIT|INPEL/i.test(u)) return 'Lab';
  if (u === 'INSTALADO' || !u) return 'Otro';
  return 'Contratista';
}

/** Normaliza un registro crudo del inventario al modelo del módulo. */
function norm(e) {
  const dCal = diasA(e.venc_calib), dConf = diasA(e.venc_conf);
  const cand = [];
  if (dCal !== null) cand.push({ d: dCal, tipo: 'Calibración', date: e.venc_calib });
  if (dConf !== null) cand.push({ d: dConf, tipo: 'Conformidad', date: e.venc_conf });
  cand.sort((a, b) => a.d - b.d);
  return {
    serial: e.serial, sku: e.sku, estado: e.estado, marca: e.marca,
    ubic: e.ubicacion || '', _acc: ES_ACCESORIO(e.sku),
    _n: cand[0] || null, _d: cand.length ? cand[0].d : null
  };
}

/** ¿Pertenece a la población gestionable? (igual que la pestaña "Equipos Vencidos"). */
function esGestionable(e) {
  return ['DISPONIBLE', 'ASIGNADO', 'PENDIENTE CERTIFICADOS'].indexOf(e.estado) >= 0
    && !e._acc && e._d !== null;
}

/* ============================ FUENTE DE DATOS =========================== */
/**
 * Devuelve el inventario completo EN VIVO desde Metabase.
 * Usa la card 18021 "Inventario WMS" que devuelve todos los equipos.
 * Requiere: PropertiesService.getScriptProperties().setProperty('MB_KEY', 'tu-api-key')
 */
function obtenerInventario() {
  const MB_KEY = PropertiesService.getScriptProperties().getProperty('MB_KEY');
  if (!MB_KEY) throw new Error('Falta la API key de Metabase. Configúrala así:\n  PropertiesService.getScriptProperties().setProperty("MB_KEY", "tu-api-key-aquí")');

  const CARD = 18021; // "Inventario WMS" — datos EN VIVO del inventario completo
  const r = UrlFetchApp.fetch('https://bia.metabaseapp.com/api/card/' + CARD + '/query/json', {
    method: 'post', contentType: 'application/json',
    headers: { 'x-api-key': MB_KEY },
    payload: JSON.stringify({}), muteHttpExceptions: true
  });

  if (r.getResponseCode() !== 200) {
    throw new Error('Error consultando Metabase card ' + CARD + ': ' + r.getResponseCode() + ' ' + r.getContentText());
  }

  return JSON.parse(r.getContentText()).map(row => ({
    serial: row.serial, sku: row.sku, estado: row.estado, marca: row.marca,
    ubicacion: row.ubicacion, venc_conf: row.venc_conf, venc_calib: row.venc_calib
  }));
}

/* ============================ CÁLCULO DE ALERTAS ======================== */
/**
 * Devuelve los equipos que entran en alerta hoy, agrupados por ventana.
 * Cada equipo cae en su ventana MÁS PEQUEÑA aplicable (exclusivo), igual
 * que el módulo. Los ya vencidos se excluyen del aviso preventivo.
 */
function calcularAlertas() {
  const inv = obtenerInventario().map(norm).filter(esGestionable);
  const wins = CONFIG.VENTANAS.slice().sort((a, b) => a - b);
  const buckets = {}; wins.forEach(w => buckets[w] = []);
  inv.forEach(e => {
    if (e._d < 0) return;                 // ya vencido: fuera de preventivo
    const w = wins.find(w => e._d <= w);
    if (w !== undefined) buckets[w].push(e);
  });
  return { wins: wins, buckets: buckets };
}

/* ============================ DEDUPE (Sheet) ============================ */
function getSheet_(nombre, encabezados) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    if (encabezados) sh.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold');
  }
  return sh;
}

/** Set de claves "serial||ventana" ya enviadas (para no repetir). */
function clavesEnviadas_() {
  const sh = getSheet_(CONFIG.HOJA_LOG, ['Fecha', 'Serial', 'SKU', 'Ubicación', 'Ventana', 'Días', 'Destinatario', 'Estado']);
  const set = {};
  const last = sh.getLastRow();
  if (last < 2) return set;
  const vals = sh.getRange(2, 2, last - 1, 4).getValues(); // Serial(B) .. Ventana(E)
  vals.forEach(r => { set[r[0] + '||' + r[3]] = true; });
  return set;
}

function registrarEnvios_(filas) {
  if (!filas.length) return;
  const sh = getSheet_(CONFIG.HOJA_LOG, ['Fecha', 'Serial', 'SKU', 'Ubicación', 'Ventana', 'Días', 'Destinatario', 'Estado']);
  sh.getRange(sh.getLastRow() + 1, 1, filas.length, 8).setValues(filas);
}

/** Mapa Ubicación -> Correo desde la pestaña "Contactos". */
function mapaContactos_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.HOJA_CONTACTOS);
  const mapa = {};
  if (!sh || sh.getLastRow() < 2) return mapa;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    if (r[0] && r[1]) mapa[String(r[0]).trim()] = String(r[1]).trim();
  });
  return mapa;
}

/* ============================ ENVÍO DE CORREOS ========================== */
/**
 * Punto de entrada del disparador diario.
 * @param {boolean} dryRun  si true, no envía: solo devuelve el resumen.
 */
function enviarAlertasDiarias(dryRun) {
  const { wins, buckets } = calcularAlertas();
  const yaEnviadas = CONFIG.DEDUPE ? clavesEnviadas_() : {};
  const contactos = mapaContactos_();
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Agrupa por destinatario: { correo: { nombre, items: [{e, win}] } }
  const porDest = {};
  const nuevasFilas = [];
  let totalElegibles = 0, totalNuevos = 0;

  wins.forEach(w => {
    buckets[w].forEach(e => {
      totalElegibles++;
      const sg = seg(e.ubic);
      let correo = null, etiqueta = null;
      if (sg === 'Bia' && CONFIG.AVISAR_BIA) { correo = CONFIG.SUPPLY_EMAIL; etiqueta = 'Supply (Bia)'; }
      else if (sg === 'Lab' && CONFIG.AVISAR_LAB) { correo = CONFIG.SUPPLY_EMAIL; etiqueta = 'Supply (lab)'; }
      else if (sg === 'Contratista' && CONFIG.AVISAR_CONTRATISTA) { correo = contactos[e.ubic] || CONFIG.SUPPLY_EMAIL; etiqueta = correo === CONFIG.SUPPLY_EMAIL ? 'Supply (falta correo contratista)' : e.ubic; }
      if (!correo) return;

      const clave = e.serial + '||' + w;
      if (yaEnviadas[clave]) return;       // ya se avisó esta ventana
      yaEnviadas[clave] = true;
      totalNuevos++;

      const destino = CONFIG.MODO_PRUEBA ? CONFIG.TEST_EMAIL : correo;
      (porDest[destino] = porDest[destino] || { items: [] }).items.push({ e: e, w: w });
      nuevasFilas.push([hoy, e.serial, e.sku, e.ubic, w, e._d, etiqueta + (CONFIG.MODO_PRUEBA ? ' [PRUEBA]' : ''), 'enviado']);
    });
  });

  if (dryRun) {
    Logger.log('DRY RUN · elegibles=%s nuevos=%s destinatarios=%s', totalElegibles, totalNuevos, Object.keys(porDest).length);
    return { elegibles: totalElegibles, nuevos: totalNuevos, destinatarios: Object.keys(porDest) };
  }

  // Envía un correo por destinatario
  Object.keys(porDest).forEach(correo => {
    const items = porDest[correo].items.sort((a, b) => a.e._d - b.e._d);
    const html = construirCorreo_(items);
    MailApp.sendEmail({
      to: correo,
      cc: (!CONFIG.MODO_PRUEBA && correo !== CONFIG.SUPPLY_EMAIL) ? CONFIG.SUPPLY_EMAIL : '',
      subject: '⚠️ CertControl · ' + items.length + ' equipo(s) por vencer certificación',
      htmlBody: html
    });
  });

  registrarEnvios_(nuevasFilas);
  Logger.log('Enviados: %s correos · %s avisos nuevos', Object.keys(porDest).length, totalNuevos);
  return { elegibles: totalElegibles, nuevos: totalNuevos, destinatarios: Object.keys(porDest) };
}

/** Cuerpo HTML del correo de alerta. */
function construirCorreo_(items) {
  const filas = items.map(it => {
    const e = it.e, col = e._d <= 7 ? '#dc2626' : e._d <= 15 ? '#d97706' : '#2563eb';
    return '<tr>' +
      '<td style="padding:6px 10px;font-family:monospace">' + e.serial + '</td>' +
      '<td style="padding:6px 10px">' + e.sku + '</td>' +
      '<td style="padding:6px 10px">' + e.ubic + '</td>' +
      '<td style="padding:6px 10px">' + (e._n ? e._n.tipo : '') + '</td>' +
      '<td style="padding:6px 10px;text-align:center;font-weight:700;color:' + col + '">' + e._d + ' d</td>' +
      '</tr>';
  }).join('');
  return '' +
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:720px">' +
    '<h2 style="color:#0f766e;margin:0 0 4px">CertControl · Alerta de vencimientos</h2>' +
    '<p style="color:#475569;margin:0 0 16px">Estos equipos necesitan renovar su certificación dentro de la ventana de aviso. Programa su envío a calibración.</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #e2e8f0">' +
    '<thead><tr style="background:#f1f5f9;text-align:left">' +
    '<th style="padding:8px 10px">Serial</th><th style="padding:8px 10px">SKU</th>' +
    '<th style="padding:8px 10px">Ubicación</th><th style="padding:8px 10px">Certificado</th>' +
    '<th style="padding:8px 10px;text-align:center">Días</th></tr></thead>' +
    '<tbody>' + filas + '</tbody></table>' +
    '<p style="color:#94a3b8;font-size:11px;margin-top:16px">Enviado automáticamente por CertControl (Capa B · Apps Script). ' +
    (CONFIG.MODO_PRUEBA ? '<b>MODO PRUEBA</b> — destinatarios reales desactivados.' : '') + '</p></div>';
}

/* ============================ UTILIDADES ================================ */
/** Ejecuta una vez para validar: corre en MODO_PRUEBA y te manda el correo a ti. */
function probar() {
  const r = enviarAlertasDiarias(false);
  Logger.log('Prueba completada: %s avisos a %s', r.nuevos, JSON.stringify(r.destinatarios));
}

/** Solo calcula y registra en el Log, sin enviar (para revisar números). */
function previsualizar() {
  const r = enviarAlertasDiarias(true);
  Logger.log(JSON.stringify(r));
  return r;
}

/** Instala el disparador diario a la hora configurada. Ejecuta una sola vez. */
function instalarTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'tareaDiaria') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tareaDiaria').timeBased().atHour(CONFIG.HORA_ENVIO).everyDays(1).create();
  Logger.log('Disparador diario instalado a las %s:00.', CONFIG.HORA_ENVIO);
}

/** La función que llama el disparador (envío real). */
function tareaDiaria() {
  enviarAlertasDiarias(false);
}

/* ===================== ENDPOINT WEB APP (opcional) =====================
 * Permite que el botón del módulo dispare un envío/preview bajo demanda.
 * Deploy > New deployment > Web app > Execute as: me > Access: Anyone.
 * Pega la URL resultante en el módulo (Config → URL de Apps Script).
 */
function doPost(e) {
  let accion = 'preview';
  try { accion = (JSON.parse(e.postData.contents) || {}).accion || 'preview'; } catch (_) { }
  const r = enviarAlertasDiarias(accion !== 'enviar');
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}
