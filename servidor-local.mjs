// servidor-local.mjs — Corre el Módulo de Vencidos EN VIVO en tu máquina,
// sin Vercel ni Netlify. Sirve los archivos del repo y hace de proxy a Metabase
// (la misma lógica que api/metabase.js). Tu máquina sí tiene red a Metabase.
//
//   1) node servidor-local.mjs
//   2) abre  http://localhost:8787/certcontrol.html
//   3) pega tu API key en Inventario → Admin (se guarda solo en tu navegador)
//
// La API key NO se guarda en este archivo: el navegador la envía en cada
// petición y el servidor solo la reenvía a Metabase. Ctrl+C para detener.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = 8787;
const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.css': 'text/css', '.webmanifest': 'application/manifest+json'
};

// Proxy a Metabase: serial === '*' → inventario completo (card 18021);
// cualquier otro → detalle de un serial (card 18922).
async function proxyMetabase(req, res) {
  let raw = '';
  for await (const c of req) raw += c;
  let body; try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
  const { serial, apiKey } = body;
  if (!serial || !apiKey) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Faltan parámetros' }));
  }
  const full = serial === '*';
  const card = full ? 18021 : 18922;
  const mbBody = full ? {} : { parameters: [{ type: 'category', target: ['variable', ['template-tag', 'serial']], value: serial }] };
  try {
    const r = await fetch(`https://bia.metabaseapp.com/api/card/${card}/query/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(mbBody)
    });
    const text = await r.text();
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && (req.url === '/api/vencidos' || req.url === '/api/metabase')) return proxyMetabase(req, res);
  let path = decodeURIComponent((req.url || '/').split('?')[0]);
  if (path === '/') path = '/certcontrol.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('no encontrado');
  }
});

server.listen(PORT, () => {
  console.log(`\n  Módulo de Vencidos EN VIVO → http://localhost:${PORT}/certcontrol.html`);
  console.log(`  (pega tu API key en Inventario → Admin · Ctrl+C para detener)\n`);
});
