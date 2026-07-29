export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { imageBase64, mimeType } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: 'Nenhuma imagem foi enviada.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Chave do Gemini não configurada no servidor.' });
    }

    const prompt = `Você recebe a foto de um cupom fiscal ou nota fiscal de mercado brasileiro.
Extraia todos os itens comprados e responda APENAS com um JSON válido, sem markdown, sem texto antes ou depois, neste formato exato:
{"mercado": "string ou null", "valorTotal": number ou null, "itens": [{"nome": "string", "quantidade": number, "precoUnitario": number, "precoTotal": number}]}
Regras: se não conseguir ler algum campo com confiança, use null nesse campo específico. Não invente valores. Quantidade deve ser numérica (ex: 1, 2, 0.5 para peso em kg).`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } }
            ]
          }]
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'Falha ao consultar o Gemini', details: errText });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      return res.status(502).json({ error: 'A IA não retornou um JSON válido.', raw: clean });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao processar o cupom.', details: err.message });
  }
}
