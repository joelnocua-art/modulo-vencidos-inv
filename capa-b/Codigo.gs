/**
 * ============================================================================
 *  Módulo de Vencidos · CAPA B — Correo diario automático
 *  Google Apps Script (runtime V8) · no necesita Supabase ni servidores
 * ============================================================================
 *
 *  QUÉ HACE (cada mañana, en días hábiles)
 *    1. Lee el inventario EN VIVO de Metabase (card 18021).
 *    2. Calcula lo mismo que la pestaña "Hoy" del módulo:
 *       Bloquear · Desasignar · Enviar a laboratorio, más el backlog.
 *    3. Envía a Supply un resumen con las 3 acciones (y un CSV con todas).
 *    4. Avisa a cada contratista SOLO de sus equipos (hoja "Contactos"):
 *         · certificado vencido    → "no instalar, devolver"  (una vez por equipo)
 *         · vence en 30 / 15 / 7 d → aviso escalonado         (una vez por ventana)
 *       La hoja "Log" registra lo enviado para no repetir avisos.
 *
 *  Usa las mismas reglas que el módulo (src/lib/certificados.ts): fechas de
 *  relleno ignoradas, accesorios por "Tipo Sku", fechas ISO como fecha local
 *  y vencimiento = el certificado más próximo.
 *
 *  INSTALACIÓN: capa-b/README.md
 * ============================================================================
 */

/* ============================ CONFIGURACIÓN ============================== */
const CONFIG = {
  // Recibe el resumen diario y va en copia de los avisos a contratistas. ← CÁMBIALO
  SUPPLY_EMAIL: 'supply@bia.app',

  // Link del módulo que aparece en los correos.
  URL_MODULO: 'https://inventario-bia.lovable.app',

  // Mismos valores que ⚙ Alertas del módulo.
  VENTANAS: [30, 15, 7],
  VENTANA_DESASIGNACION: 30,

  // false = solo se envía el resumen a Supply (no se escribe a contratistas).
  AVISAR_CONTRATISTAS: true,

  // true = TODO llega solo a TEST_EMAIL (con el destinatario real indicado en el
  // correo) y nada cuenta como enviado en el Log. Pon false para producción.
  MODO_PRUEBA: true,
  TEST_EMAIL: Session.getEffectiveUser().getEmail(),

  ZONA_HORARIA: 'America/Bogota',
  HORA_ENVIO: 7,            // hora del disparador diario (0-23)
  SOLO_DIAS_HABILES: true,  // no envía sábados ni domingos

  MAX_FILAS_CORREO: 20,     // filas por tabla en el correo (el CSV adjunto trae todas)

  HOJA_LOG: 'Log',
  HOJA_CONTACTOS: 'Contactos', // columnas: ubicacion | … | correos (separados por ;)

  // Opcional: URL pública de un snapshot (mb-data.json) para cuando no hay MB_KEY.
  DATA_URL: ''
};

/* ================ REGLAS (iguales a src/lib/certificados.ts) ================ */
const ESTADOS = ['DISPONIBLE', 'ASIGNADO', 'PENDIENTE CERTIFICADOS'];
const ACC_TIPO = /ANTENA|BLOQUE|ROUTER|MODEM|SIMCARD|CABLE/;
const ACC_SKU = /ANTENA|BLOQUE|ROUTER|MODEM/;
const MESES = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6,
  agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, sept: 8,
  oct: 9, nov: 10, dic: 11
};
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function limpiar(v) {
  return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
}

function sinTildes(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** "Vencimiento Certificado Calibracion" → "vencimiento_certificado_calibracion". */
function normalizarLlaves(r) {
  const out = {};
  Object.keys(r).forEach(k => { out[sinTildes(k.trim().toLowerCase()).replace(/\s+/g, '_')] = r[k]; });
  return out;
}

function mk(y, m, d) {
  const dt = new Date(y, m, d);
  return isNaN(dt.getTime()) || dt.getMonth() !== m ? null : dt;
}

/** Fechas ISO, dd/mm/yyyy, "17 de febrero de 2028" o "febrero 17, 2028", como fecha LOCAL. */
function parseFechaLocal(value) {
  const raw = limpiar(value);
  if (!raw || /^(null|n\/a|na|-|—)$/i.test(raw) || /^https?:\/\//i.test(raw)) return null;
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return mk(+iso[1], +iso[2] - 1, +iso[3]);
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const y = +dmy[3] < 100 ? 2000 + +dmy[3] : +dmy[3];
    return mk(y, +dmy[2] - 1, +dmy[1]);
  }
  const t = sinTildes(raw.toLowerCase()).replace(/,/g, ' ').replace(/\s+/g, ' ');
  const dm = t.match(/^(\d{1,2}) (?:de )?([a-z]+)\.? (?:de )?(\d{4})/);
  if (dm && MESES[dm[2]] !== undefined) return mk(+dm[3], MESES[dm[2]], +dm[1]);
  const md = t.match(/^([a-z]+)\.? (\d{1,2}) (\d{4})/);
  if (md && MESES[md[1]] !== undefined) return mk(+md[3], MESES[md[1]], +md[2]);
  return null;
}

/** Hoy a las 00:00 en la zona horaria del módulo, como fecha local. */
function hoy0() {
  const p = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd').split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function diasEntre(d, ref) {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

/** Fecha de un certificado. Las de relleno (año < 2000 o ≥ 2060) se ignoran. */
function leerFecha(raw, url, ref) {
  const r = limpiar(raw);
  const d = parseFechaLocal(r);
  const relleno = !!d && (d.getFullYear() < 2000 || d.getFullYear() >= 2060);
  const fecha = d && !relleno ? d : null;
  const u = limpiar(url);
  return {
    fecha: fecha,
    relleno: relleno,
    url: /^https?:\/\//i.test(u) ? u.replace(/([^:])\/\/media/g, '$1/media') : '',
    dias: fecha ? diasEntre(fecha, ref) : null
  };
}

function esAccesorio(tipoSku, sku) {
  if (tipoSku) return ACC_TIPO.test(sinTildes(tipoSku.toUpperCase()));
  return ACC_SKU.test(sinTildes(sku.toUpperCase()));
}

function tipoCortoDe(tipoSku, sku) {
  const t = sinTildes(tipoSku.toLowerCase());
  if (t.indexOf('corriente') >= 0) return 'TC';
  if (t.indexOf('potencial') >= 0 || t.indexOf('tension') >= 0) return 'TP';
  if (t.indexOf('medidor') >= 0) return 'Medidor';
  const s = sku.toUpperCase();
  if (/^TC\b/.test(s)) return 'TC';
  if (/^TP\b/.test(s)) return 'TP';
  return tipoSku || '—';
}

function pick(r, keys) {
  for (let i = 0; i < keys.length; i++) {
    const v = r[keys[i]];
    if (v !== null && v !== undefined && String(v).trim() !== '') return v;
  }
  return '';
}

function construirEquipo(row, ref) {
  const r = normalizarLlaves(row);
  const sku = limpiar(r.sku);
  const tipoSku = limpiar(r.tipo_sku);
  const estado = limpiar(r.estado).toUpperCase();
  const ubicacion = limpiar(r.ubicacion);
  const cal = leerFecha(pick(r, ['vencimiento_certificado_calibracion', 'venc_calibracion', 'venc_calib']), r.certificado_calibracion, ref);
  const conf = leerFecha(pick(r, ['vencimiento_certificado_conformidad', 'venc_conformidad', 'venc_conf']), r.certificado_conformidad, ref);
  let vence = null, define = null;
  if (cal.fecha && (!conf.fecha || cal.fecha <= conf.fecha)) { vence = cal.fecha; define = 'Calibración'; }
  else if (conf.fecha) { vence = conf.fecha; define = 'Conformidad'; }
  const accesorio = esAccesorio(tipoSku, sku);
  const U = ubicacion.toUpperCase();
  return {
    serial: limpiar(r.serial),
    sku: sku,
    tipoCorto: tipoCortoDe(tipoSku, sku),
    estado: estado,
    ubicacion: ubicacion,
    biaCode: limpiar(pick(r, ['bia_code', 'codigo_bia'])),
    cal: cal,
    conf: conf,
    vence: vence,
    define: define,
    dias: vence ? diasEntre(vence, ref) : null,
    accesorio: accesorio,
    certificable: ESTADOS.indexOf(estado) >= 0 && !accesorio && !!vence,
    lab: U.indexOf('INPEL') >= 0 ? 'INPEL' : U.indexOf('METROBIT') >= 0 ? 'METROBIT' : null,
    bodegaBia: /^bia\b/i.test(ubicacion)
  };
}

const porDias = (a, b) => (a.dias === null ? 1e9 : a.dias) - (b.dias === null ? 1e9 : b.dias);

/** Las mismas listas que la pestaña "Hoy" del módulo. */
function analizar(rows, ref) {
  const todos = rows.map(r => construirEquipo(r, ref));
  const cert = todos.filter(e => e.certificable).sort(porDias);
  const horizonte = Math.max.apply(null, CONFIG.VENTANAS);
  const recert = cert.filter(e => e.estado === 'PENDIENTE CERTIFICADOS' && e.dias < 0);
  return {
    certificables: cert,
    alDia: cert.filter(e => e.dias > 30).length,
    bloquear: cert.filter(e => e.estado === 'DISPONIBLE' && e.dias < 0),
    desasignar: cert.filter(e => e.estado === 'ASIGNADO' && e.dias <= CONFIG.VENTANA_DESASIGNACION),
    enviarLab: cert.filter(e => e.estado === 'DISPONIBLE' && e.dias >= 0 && e.dias <= horizonte && !e.lab),
    recert: recert,
    recert6m: recert.filter(e => e.dias < -180).length,
    vigentesEnPendiente: cert.filter(e => e.estado === 'PENDIENTE CERTIFICADOS' && e.dias > 30)
  };
}

/* ============================ FUENTE DE DATOS =========================== */
/**
 * Inventario completo EN VIVO desde Metabase (card 18021).
 * Requiere la propiedad del script MB_KEY (Configuración del proyecto › Propiedades del script).
 */
function obtenerInventario() {
  const key = PropertiesService.getScriptProperties().getProperty('MB_KEY');
  if (key) {
    const r = UrlFetchApp.fetch('https://bia.metabaseapp.com/api/card/18021/query/json', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': key },
      payload: JSON.stringify({ parameters: [], constraints: { 'max-results': 50000 }, ignore_cache: true }),
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) {
      throw new Error('Metabase respondió ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
    }
    const data = JSON.parse(r.getContentText());
    if (!Array.isArray(data)) throw new Error('Metabase no devolvió filas: ' + JSON.stringify(data).slice(0, 300));
    return data;
  }
  if (CONFIG.DATA_URL) {
    const resp = UrlFetchApp.fetch(CONFIG.DATA_URL, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error('No se pudo leer DATA_URL (' + resp.getResponseCode() + ').');
    return JSON.parse(resp.getContentText());
  }
  throw new Error('Falta la API key de Metabase: agrega la propiedad MB_KEY en Configuración del proyecto › Propiedades del script.');
}

/* ======================= CONTACTOS Y REGISTRO (Sheet) ===================== */
const ENCABEZADOS_LOG = ['Fecha', 'Serial', 'SKU', 'Ubicación', 'Aviso', 'Días', 'Destinatario', 'Estado'];

function getSheet_(nombre, encabezados) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    if (encabezados) sh.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold');
  }
  return sh;
}

const claveUbic = u => sinTildes(limpiar(u).toUpperCase());

/** Ubicación → correos, desde la hoja "Contactos" (busca las columnas por su nombre). */
function mapaContactos_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.HOJA_CONTACTOS);
  const mapa = {};
  if (!sh || sh.getLastRow() < 2) return mapa;
  const datos = sh.getDataRange().getValues();
  const enc = datos[0].map(h => sinTildes(String(h).toLowerCase()));
  const cU = enc.findIndex(h => h.indexOf('ubicacion') >= 0);
  const cC = enc.findIndex(h => h.indexOf('correo') >= 0);
  if (cU < 0 || cC < 0) throw new Error('La hoja "' + CONFIG.HOJA_CONTACTOS + '" necesita las columnas "ubicacion" y "correos".');
  datos.slice(1).forEach(f => {
    const correos = String(f[cC] || '').split(/[;,\s]+/)
      .map(s => s.trim()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
    if (limpiar(f[cU]) && correos.length) mapa[claveUbic(f[cU])] = correos;
  });
  return mapa;
}

/** Avisos ya enviados ("serial||aviso"). Las corridas de prueba no cuentan. */
function clavesEnviadas_() {
  const sh = getSheet_(CONFIG.HOJA_LOG, ENCABEZADOS_LOG);
  const set = {};
  if (sh.getLastRow() < 2) return set;
  sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().forEach(f => {
    if (f[7] === 'enviado' && String(f[6]).indexOf('[PRUEBA]') < 0) set[f[1] + '||' + f[4]] = true;
  });
  return set;
}

function registrarLog_(filas) {
  if (!filas.length) return;
  const sh = getSheet_(CONFIG.HOJA_LOG, ENCABEZADOS_LOG);
  sh.getRange(sh.getLastRow() + 1, 1, filas.length, 8).setValues(filas);
}

/* ============================ AVISOS A CONTRATISTAS ====================== */
/** 'vencido', o la ventana más pequeña que contiene al equipo ('7', '15', '30'). */
function avisoDe(e) {
  if (e.dias < 0) return 'vencido';
  const w = CONFIG.VENTANAS.slice().sort((a, b) => a - b).filter(v => e.dias <= v)[0];
  return w === undefined ? null : String(w);
}

/** Equipos (disponibles o asignados) en contratistas que hay que avisar hoy, por ubicación. */
function avisosContratistas_(a, contactos, yaEnviados) {
  const porUbic = {};
  a.certificables.forEach(e => {
    if (e.bodegaBia || e.lab || !e.ubicacion || e.ubicacion.toUpperCase() === 'INSTALADO') return;
    if (e.estado !== 'DISPONIBLE' && e.estado !== 'ASIGNADO') return;
    const aviso = avisoDe(e);
    if (!aviso || yaEnviados[e.serial + '||' + aviso]) return;
    const k = claveUbic(e.ubicacion);
    if (!porUbic[k]) porUbic[k] = { ubicacion: e.ubicacion, correos: contactos[k] || [], items: [] };
    porUbic[k].items.push({ e: e, aviso: aviso });
  });
  return Object.keys(porUbic).map(k => porUbic[k]).sort((x, y) => y.items.length - x.items.length);
}

/* ================================ ENVÍO ================================= */
/**
 * @param {{prueba: boolean, soloCalcular?: boolean}} op
 *   prueba: todo llega a TEST_EMAIL y el Log marca "prueba" (no cuenta como enviado).
 *   soloCalcular: no envía ni registra; devuelve el resumen.
 */
function ejecutar_(op) {
  const ref = hoy0();
  const a = analizar(obtenerInventario(), ref);
  const grupos = CONFIG.AVISAR_CONTRATISTAS ? avisosContratistas_(a, mapaContactos_(), clavesEnviadas_()) : [];
  const conCorreo = grupos.filter(g => g.correos.length);
  const sinCorreo = grupos.filter(g => !g.correos.length);
  const resumen = {
    certificables: a.certificables.length,
    bloquear: a.bloquear.length,
    desasignar: a.desasignar.length,
    enviarLab: a.enviarLab.length,
    esperanRecertificacion: a.recert.length,
    masDe6Meses: a.recert6m,
    vigentesEnPendiente: a.vigentesEnPendiente.length,
    contratistasAvisados: conCorreo.map(g => g.ubicacion + ' (' + g.items.length + ')'),
    contratistasSinCorreo: sinCorreo.map(g => g.ubicacion + ' (' + g.items.length + ')')
  };
  if (op.soloCalcular) {
    Logger.log(JSON.stringify(resumen, null, 2));
    return resumen;
  }

  const necesarios = conCorreo.length + 1;
  if (MailApp.getRemainingDailyQuota() < necesarios) {
    throw new Error('Cuota diaria de correo insuficiente: se necesitan ' + necesarios + ' envíos.');
  }
  const fecha = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
  const filasLog = [];

  conCorreo.forEach(g => {
    g.items.sort((x, y) => x.e.dias - y.e.dias);
    const msg = {
      to: op.prueba ? CONFIG.TEST_EMAIL : g.correos.join(','),
      replyTo: CONFIG.SUPPLY_EMAIL,
      name: 'Bia · Vencimientos',
      subject: (op.prueba ? '[PRUEBA] ' : '') + 'Bia · ' + g.items.length + ' equipo(s) con certificado vencido o por vencer · ' + g.ubicacion,
      body: textoContratista_(g),
      htmlBody: correoContratista_(g, op.prueba)
    };
    if (!op.prueba) msg.cc = CONFIG.SUPPLY_EMAIL;
    MailApp.sendEmail(msg);
    g.items.forEach(it => filasLog.push([fecha, it.e.serial, it.e.sku, g.ubicacion, it.aviso, it.e.dias,
      g.correos.join(', '), op.prueba ? 'prueba' : 'enviado']));
  });

  if (a.bloquear.length || a.desasignar.length || a.enviarLab.length || grupos.length) {
    MailApp.sendEmail({
      to: op.prueba ? CONFIG.TEST_EMAIL : CONFIG.SUPPLY_EMAIL,
      name: 'Bia · Vencimientos',
      subject: (op.prueba ? '[PRUEBA] ' : '') + 'Vencimientos · Bloquear ' + a.bloquear.length +
        ' · Desasignar ' + a.desasignar.length + ' · Enviar a laboratorio ' + a.enviarLab.length,
      body: textoSupply_(a),
      htmlBody: correoSupply_(a, conCorreo, sinCorreo, op.prueba),
      attachments: [csvAcciones_(a, fecha)]
    });
  }

  registrarLog_(filasLog);
  Logger.log(JSON.stringify(resumen, null, 2));
  return resumen;
}

/* ============================ CORREOS (HTML) ============================ */
const C = { texto: '#1f2328', suave: '#57606a', linea: '#e5e7eb', fondo: '#f6f8fa', verde: '#1a7f37' };
const BARRA = { bloquear: '#d03b3b', desasignar: '#ec835a', enviar: '#fab219' };

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const nf = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fFecha = d => d ? d.getDate() + ' ' + MES_CORTO[d.getMonth()] + ' ' + d.getFullYear() : '—';
const fIso = d => d ? d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) : '';

function badgeDias(d) {
  let bg = '#e7f6e7', fg = '#1e7a1e', txt = nf(d) + ' d';
  if (d < 0) { bg = '#fde8e8'; fg = '#b42318'; txt = 'venció hace ' + nf(-d) + ' d'; }
  else if (d <= 7) { bg = '#fdeee6'; fg = '#b54708'; }
  else if (d <= 30) { bg = '#fef6dc'; fg = '#8a6100'; }
  return '<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:' + bg + ';color:' + fg +
    ';font-weight:600;font-size:12px;white-space:nowrap">' + txt + '</span>';
}

const TH = 'padding:8px 10px;text-align:left;font-weight:600;color:' + C.suave + ';font-size:12px;border-bottom:1px solid ' + C.linea;
const TD = 'padding:8px 10px;border-bottom:1px solid ' + C.linea + ';font-size:13px;color:' + C.texto + ';vertical-align:top';

function tablaEquipos_(lista, conBiaCode) {
  const max = CONFIG.MAX_FILAS_CORREO;
  const filas = lista.slice(0, max).map(e =>
    '<tr><td style="' + TD + ';font-family:Menlo,Consolas,monospace">' + esc(e.serial) + '</td>' +
    '<td style="' + TD + '">' + esc(e.tipoCorto) + '<div style="color:' + C.suave + ';font-size:12px">' + esc(e.sku) + '</div></td>' +
    '<td style="' + TD + '">' + esc(e.ubicacion) + (conBiaCode && e.biaCode ? '<div style="color:' + C.suave + ';font-size:12px">' + esc(e.biaCode) + '</div>' : '') + '</td>' +
    '<td style="' + TD + ';white-space:nowrap">' + fFecha(e.vence) + '<div style="color:' + C.suave + ';font-size:12px">' + esc(e.define) + '</div></td>' +
    '<td style="' + TD + ';text-align:right">' + badgeDias(e.dias) + '</td></tr>').join('');
  const mas = lista.length > max
    ? '<p style="margin:8px 0 0;color:' + C.suave + ';font-size:12px">… y ' + nf(lista.length - max) + ' más en el CSV adjunto y en el módulo.</p>' : '';
  return '<table role="presentation" style="border-collapse:collapse;width:100%;margin-top:10px">' +
    '<tr><th style="' + TH + '">Serial</th><th style="' + TH + '">Equipo</th><th style="' + TH + '">Ubicación</th>' +
    '<th style="' + TH + '">Vence</th><th style="' + TH + ';text-align:right">Días</th></tr>' + filas + '</table>' + mas;
}

function chip_(t) {
  return '<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 8px;border-radius:6px;background:' + C.fondo +
    ';border:1px solid ' + C.linea + ';font-size:12px;color:' + C.suave + '">' + esc(t) + '</span>';
}

function bloqueAccion_(color, titulo, n, texto, chips, lista, conBiaCode) {
  return '<div style="margin:16px 0;padding:16px 18px;border:1px solid ' + C.linea + ';border-left:4px solid ' + color + ';border-radius:10px">' +
    '<div style="font-size:15px;font-weight:600;color:' + C.texto + '">' + esc(titulo) +
    ' <span style="font-size:22px;margin-left:6px">' + nf(n) + '</span></div>' +
    '<p style="margin:4px 0 10px;color:' + C.suave + ';font-size:13px">' + esc(texto) + '</p>' +
    chips.map(chip_).join('') + (n ? tablaEquipos_(lista, conBiaCode) : '') + '</div>';
}

function contar_(lista, f) {
  const m = {};
  lista.forEach(e => { const k = f(e); if (k) m[k] = (m[k] || 0) + 1; });
  return Object.keys(m).map(k => [k, m[k]]).sort((x, y) => y[1] - x[1]);
}

function envolver_(contenido, prueba, avisoPrueba) {
  return '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:760px;margin:0 auto;color:' + C.texto + '">' +
    (prueba ? '<div style="margin-bottom:14px;padding:10px 12px;border-radius:8px;background:#fff8e1;border:1px solid #f5d77a;font-size:13px">' +
      '<b>MODO PRUEBA</b> · ' + avisoPrueba + '</div>' : '') +
    contenido + '</div>';
}

function correoSupply_(a, conCorreo, sinCorreo, prueba) {
  const n = a.certificables.length;
  const pct = n ? Math.round(a.alDia / n * 100) : 0;
  const enContr = a.bloquear.filter(e => !e.bodegaBia).length;
  const codes = contar_(a.desasignar, e => e.biaCode);
  const vs = CONFIG.VENTANAS.slice().sort((x, y) => x - y);
  const chipsEnvio = vs.map((v, i) => {
    const desde = i ? vs[i - 1] + 1 : 0;
    const k = a.enviarLab.filter(e => e.dias >= desde && e.dias <= v).length;
    return (i ? desde + '–' + v + ' d' : '≤ ' + v + ' d') + ' · ' + k;
  });
  const tiposVig = contar_(a.vigentesEnPendiente, e => e.tipoCorto).map(t => t[0] + ' ' + t[1]).join(', ');
  const hoy = new Date();
  const contenido =
    '<h2 style="margin:0;font-size:20px">Vencimientos de certificados · ' + fFecha(hoy0()) + '</h2>' +
    '<p style="margin:4px 0 0;color:' + C.suave + ';font-size:13px">' + nf(n) + ' equipos certificables · <b style="color:' + C.verde + '">' + pct + '% al día</b> (vigentes a más de 30 días)</p>' +
    bloqueAccion_(BARRA.bloquear, 'Bloquear', a.bloquear.length,
      'Disponibles con certificado vencido. Pásalos a Pendiente certificados para que no se despachen.',
      [enContr + ' en contratistas', (a.bloquear.length - enContr) + ' en bodegas Bia'], a.bloquear, false) +
    bloqueAccion_(BARRA.desasignar, 'Desasignar', a.desasignar.length,
      'Asignados que vencen en ≤ ' + CONFIG.VENTANA_DESASIGNACION + ' días. Afecta ' + codes.length + ' Bia Codes.',
      codes.map(c => c[0] + ' · ' + c[1]), a.desasignar, true) +
    bloqueAccion_(BARRA.enviar, 'Enviar a laboratorio', a.enviarLab.length,
      'Disponibles que vencen en ≤ ' + vs[vs.length - 1] + ' días. Envíalos antes de que venzan.',
      chipsEnvio, a.enviarLab, false) +
    '<div style="margin:16px 0;padding:12px 16px;border-radius:10px;background:' + C.fondo + ';font-size:13px;line-height:1.6">' +
    '⏳ <b>' + nf(a.recert.length) + ' equipos esperan recertificación</b> (pendiente certificados, ya vencidos) · ' + nf(a.recert6m) + ' llevan más de 6 meses.' +
    (a.vigentesEnPendiente.length ? '<br>🔎 <b>' + nf(a.vigentesEnPendiente.length) + ' equipos en Pendiente certificados ya tienen certificado vigente</b> (' + esc(tiposVig) + '): revisar si pasan a Disponible.' : '') +
    '</div>' +
    (conCorreo.length || sinCorreo.length ?
      '<div style="margin:16px 0;font-size:13px;line-height:1.6">' +
      (conCorreo.length ? '<b>Avisos enviados hoy a contratistas:</b> ' + conCorreo.map(g => esc(g.ubicacion) + ' (' + g.items.length + ')').join(' · ') + '<br>' : '') +
      (sinCorreo.length ? '<b style="color:#b54708">Sin correo en la hoja Contactos (no se les avisó):</b> ' + sinCorreo.map(g => esc(g.ubicacion) + ' (' + g.items.length + ')').join(' · ') : '') +
      '</div>' : '') +
    '<p style="margin:20px 0 0"><a href="' + esc(CONFIG.URL_MODULO) + '" style="display:inline-block;padding:9px 14px;border-radius:8px;background:' + C.verde + ';color:#fff;text-decoration:none;font-size:13px;font-weight:600">Abrir el módulo de Vencidos</a></p>' +
    '<p style="margin:14px 0 0;color:#8c959f;font-size:11px">Datos en vivo de Metabase (card 18021) · generado ' +
    Utilities.formatDate(hoy, CONFIG.ZONA_HORARIA, 'HH:mm') + ' · CSV adjunto con todas las acciones.</p>';
  return envolver_(contenido, prueba, 'este resumen normalmente le llega a ' + esc(CONFIG.SUPPLY_EMAIL) + '.');
}

function correoContratista_(g, prueba) {
  const filas = g.items.map(it => {
    const e = it.e;
    const accion = it.aviso === 'vencido'
      ? '<b style="color:#b42318">No instalar.</b> Certificado vencido: coordinar con Bia su devolución.'
      : 'Vence el ' + fFecha(e.vence) + '. Coordinar con Bia su devolución para recalibración.';
    return '<tr><td style="' + TD + ';font-family:Menlo,Consolas,monospace">' + esc(e.serial) + '</td>' +
      '<td style="' + TD + '">' + esc(e.tipoCorto) + '<div style="color:' + C.suave + ';font-size:12px">' + esc(e.sku) + '</div></td>' +
      '<td style="' + TD + ';text-align:right">' + badgeDias(e.dias) + '</td>' +
      '<td style="' + TD + '">' + accion + '</td></tr>';
  }).join('');
  const contenido =
    '<h2 style="margin:0;font-size:18px">Hola, equipo de ' + esc(g.ubicacion) + ':</h2>' +
    '<p style="margin:8px 0 0;font-size:14px;line-height:1.5">Estos equipos de Bia que están con ustedes necesitan atención por el vencimiento de su certificado:</p>' +
    '<table role="presentation" style="border-collapse:collapse;width:100%;margin-top:12px">' +
    '<tr><th style="' + TH + '">Serial</th><th style="' + TH + '">Equipo</th><th style="' + TH + ';text-align:right">Días</th><th style="' + TH + '">Qué hacer</th></tr>' +
    filas + '</table>' +
    '<p style="margin:16px 0 0;font-size:14px;line-height:1.5">Para coordinar la devolución, responde este correo (le llega a Supply: ' + esc(CONFIG.SUPPLY_EMAIL) + ').</p>' +
    '<p style="margin:14px 0 0;color:#8c959f;font-size:11px">Aviso automático de Bia. No vuelve a llegar para el mismo equipo y el mismo plazo.</p>';
  return envolver_(contenido, prueba, 'el destinatario real sería ' + esc(g.correos.join(', ')) + ' (con copia a Supply).');
}

function textoSupply_(a) {
  return 'Vencimientos de certificados · ' + fFecha(hoy0()) + '\n' +
    'Bloquear: ' + a.bloquear.length + ' · Desasignar: ' + a.desasignar.length + ' · Enviar a laboratorio: ' + a.enviarLab.length + '\n' +
    'Esperan recertificación: ' + a.recert.length + ' (' + a.recert6m + ' con más de 6 meses)\n' +
    'Detalle en el CSV adjunto y en ' + CONFIG.URL_MODULO;
}

function textoContratista_(g) {
  return 'Hola, equipo de ' + g.ubicacion + ':\n\n' + g.items.map(it =>
    '- ' + it.e.serial + ' (' + it.e.tipoCorto + '): ' + (it.aviso === 'vencido'
      ? 'certificado vencido, no instalar.' : 'vence el ' + fFecha(it.e.vence) + '.')).join('\n') +
    '\n\nPara coordinar la devolución, responde este correo (le llega a Supply).';
}

function csvAcciones_(a, fecha) {
  const celda = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const filas = [['accion', 'serial', 'tipo', 'sku', 'estado', 'ubicacion', 'bia_code', 'vence', 'certificado', 'dias']];
  const add = (accion, lista) => lista.forEach(e => filas.push([accion, e.serial, e.tipoCorto, e.sku, e.estado, e.ubicacion, e.biaCode, fIso(e.vence), e.define, e.dias]));
  add('Bloquear', a.bloquear);
  add('Desasignar', a.desasignar);
  add('Enviar a laboratorio', a.enviarLab);
  add('Pendiente con certificado vigente', a.vigentesEnPendiente);
  return Utilities.newBlob('﻿' + filas.map(f => f.map(celda).join(',')).join('\r\n'), 'text/csv', 'vencimientos-' + fecha + '.csv');
}

/* ======================= FUNCIONES PARA EJECUTAR ========================= */
/** 1) Revisa los números sin enviar nada (ver › Registro de ejecución). */
function previsualizar() {
  return ejecutar_({ prueba: true, soloCalcular: true });
}

/** 2) Envía TODO solo a ti (TEST_EMAIL) para revisar cómo llegan los correos. */
function probar() {
  return ejecutar_({ prueba: true });
}

/** 3) Instala el envío diario a la hora configurada. Ejecútalo una sola vez. */
function instalarTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'tareaDiaria') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tareaDiaria').timeBased().atHour(CONFIG.HORA_ENVIO).everyDays(1).create();
  Logger.log('Envío diario instalado a las %s:00 (zona horaria del proyecto).', CONFIG.HORA_ENVIO);
}

/** La llama el disparador. Mientras MODO_PRUEBA sea true, todo te llega solo a ti. */
function tareaDiaria() {
  if (CONFIG.SOLO_DIAS_HABILES) {
    const dia = Number(Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'u')); // 1 = lunes … 7 = domingo
    if (dia >= 6) return;
  }
  ejecutar_({ prueba: CONFIG.MODO_PRUEBA });
}
