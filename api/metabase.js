export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { serial, apiKey } = req.body || {};
  if (!serial || !apiKey) return res.status(400).json({ error: 'Faltan parámetros' });

  // serial === '*'  → inventario completo (card 18021 "Inventario WMS")
  // cualquier otro  → detalle de un serial            (card 18922)
  const full = serial === '*';
  const card = full ? 18021 : 18922;
  const body = full
    ? {}
    : { parameters: [{ type: 'category', target: ['variable', ['template-tag', 'serial']], value: serial }] };

  try {
    const response = await fetch(`https://bia.metabaseapp.com/api/card/${card}/query/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const detail = await response.text();
      return res.status(response.status).json({ error: `Metabase ${response.status}`, detail: detail.slice(0, 300) });
    }
    const data = await response.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
