// Proxy a Metabase para el Módulo de Vencidos (función serverless de Vercel).
//
//   POST { serial: '*' }             -> inventario completo  (card 18021 "Inventario WMS")
//   POST { serial: '037295672366' }  -> detalle de un serial (card 18922)
//
// La API key se resuelve en este orden:
//   1) variable de entorno de Vercel  (METABASE_API_KEY / MB_API_KEY / MB_KEY / METABASE_KEY)
//   2) el cuerpo de la petición        (apiKey, que el navegador toma de localStorage bia_mb_key)
// Así el módulo funciona "solo" tanto si el repo guarda la key en el servidor
// como si la guarda en el navegador. Este archivo es nuevo y no toca a /api/metabase.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { serial, apiKey } = req.body || {};
  if (!serial) return res.status(400).json({ error: 'Falta el parámetro serial' });

  const key = process.env.METABASE_API_KEY || process.env.MB_API_KEY
    || process.env.MB_KEY || process.env.METABASE_KEY || apiKey;
  if (!key) return res.status(400).json({ error: 'No hay API key (ni en variable de entorno ni en la petición)' });

  // serial === '*' → inventario completo (18021); cualquier otro → detalle (18922)
  const full = serial === '*';
  const card = full ? 18021 : 18922;
  const body = full
    ? {}
    : { parameters: [{ type: 'category', target: ['variable', ['template-tag', 'serial']], value: serial }] };

  try {
    const r = await fetch(`https://bia.metabaseapp.com/api/card/${card}/query/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(r.status).json({ error: `Metabase ${r.status}`, detail: detail.slice(0, 300) });
    }
    return res.status(200).json(await r.json());
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
