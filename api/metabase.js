export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { serial, apiKey } = req.body;
  if (!serial || !apiKey) return res.status(400).json({ error: 'Faltan parámetros' });

  try {
    const response = await fetch('https://bia.metabaseapp.com/api/card/18922/query/json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({
        parameters: [
          {
            type: 'category',
            target: ['variable', ['template-tag', 'serial']],
            value: serial
          }
        ]
      })
    });
    const data = await response.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
