// Função serverless do Vercel. Roda no servidor, nunca no navegador —
// por isso a chave do Gemini (GEMINI_API_KEY) fica protegida em variável de ambiente.

const MODELO = 'gemini-3.5-flash-lite';

const PROMPT = `Você recebe uma ou mais imagens de UM MESMO comprovante de compra brasileiro. Pode ser:
(a) foto de cupom fiscal / nota fiscal de mercado; ou
(b) print de tela de um app de pedidos (iFood, 99Food, Rappi, Keeta etc.) mostrando o pedido, o resumo ou o recibo. Se houver várias imagens, elas são partes do mesmo pedido (ex: print rolando a tela): junte os itens sem duplicar.

Extraia os dados e responda APENAS com um JSON válido, sem markdown e sem texto antes ou depois, neste formato exato:
{"tipoDocumento": "cupom_fiscal" | "app_delivery" | "outro", "mercado": "string ou null", "dataCompra": "AAAA-MM-DD ou null", "taxaEntrega": number ou null, "desconto": number ou null, "valorTotal": number ou null, "itens": [{"nomeGenerico": "string", "marca": "string ou null", "quantidade": number, "precoUnitario": number, "precoTotal": number}]}

Regras:
- "mercado" é o nome do estabelecimento/loja/restaurante (ex: "Extra", "Mercado do Zé"). Em print de app, é o nome da loja do pedido, não o nome do app.
- "nomeGenerico" é o nome comum do produto, sem marca, sem tamanho/peso e sem código (ex: "Detergente", "Arroz", "Refrigerante"). Normalize abreviações do cupom (ex: "DETERG YPE NEUTRO 500ML" vira nomeGenerico "Detergente", marca "Ypê"). Para pratos de restaurante, use o nome do prato.
- "marca" só se for identificável com confiança; senão null.
- Quantidade numérica (1, 2, 0.5 para peso em kg). Em app, "2x Item" significa quantidade 2.
- Se a imagem mostra só o valor da linha (quantidade x preço), preencha "precoTotal" com o da linha e "precoUnitario" = precoTotal / quantidade.
- Em print de app: "taxaEntrega" é a taxa de entrega (0 se "grátis"), "desconto" é a soma positiva de cupons/descontos/promoções aplicados, "valorTotal" é o total final pago. Não inclua taxa, desconto, gorjeta ou taxa de serviço como itens.
- Em cupom fiscal: "desconto" é o desconto total, se houver; "taxaEntrega" é null.
- "dataCompra" só se a data estiver visível na imagem; converta para AAAA-MM-DD.
- Se não conseguir ler algum campo com confiança, use null nesse campo. Não invente valores.`;

function extrairJSON(texto) {
  const limpo = (texto || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(limpo); } catch (_) { /* tenta recortar */ }
  const ini = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (ini !== -1 && fim > ini) {
    try { return JSON.parse(limpo.slice(ini, fim + 1)); } catch (_) { /* segue */ }
  }
  return null;
}

async function chamarGemini(apiKey, parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;
  let ultima;
  // Tenta de novo em sobrecarga/limite (503/429), que são comuns e passam sozinhos.
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192 }
      })
    });
    if (r.ok) return { ok: true, data: await r.json() };
    ultima = { ok: false, status: r.status, texto: await r.text() };
    if (r.status !== 429 && r.status !== 503) break;
    await new Promise(res => setTimeout(res, 1200 * (tentativa + 1)));
  }
  return ultima;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const body = req.body || {};
    // Aceita várias imagens (images[]) ou o formato antigo (imageBase64 + mimeType).
    const imagens = Array.isArray(body.images) && body.images.length
      ? body.images
      : (body.imageBase64 ? [{ imageBase64: body.imageBase64, mimeType: body.mimeType }] : []);
    if (!imagens.length) {
      return res.status(400).json({ error: 'Nenhuma imagem foi enviada.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'A chave GEMINI_API_KEY não está configurada no Vercel (Settings > Environment Variables).' });
    }

    const parts = [{ text: PROMPT }, ...imagens.map(i => ({ inline_data: { mime_type: i.mimeType || 'image/jpeg', data: i.imageBase64 } }))];
    const resp = await chamarGemini(apiKey, parts);

    if (!resp.ok) {
      console.error('Gemini falhou', resp.status, resp.texto);
      let motivo = '';
      try { motivo = JSON.parse(resp.texto)?.error?.message || ''; } catch (_) { motivo = (resp.texto || '').slice(0, 300); }
      return res.status(502).json({ error: `O Gemini recusou a requisição (HTTP ${resp.status}).`, details: motivo });
    }

    const cand = resp.data?.candidates?.[0];
    const texto = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    if (!texto) {
      const bloqueio = resp.data?.promptFeedback?.blockReason || cand?.finishReason || 'resposta vazia';
      console.error('Gemini sem texto', JSON.stringify(resp.data).slice(0, 500));
      return res.status(502).json({ error: 'O Gemini não devolveu texto.', details: `Motivo: ${bloqueio}` });
    }

    const parsed = extrairJSON(texto);
    if (!parsed) {
      console.error('JSON inválido', cand?.finishReason, texto.slice(0, 500));
      return res.status(502).json({
        error: 'A IA devolveu uma resposta que não consegui interpretar.',
        details: cand?.finishReason === 'MAX_TOKENS' ? 'A resposta foi cortada (cupom muito longo).' : texto.slice(0, 200)
      });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Erro no scan-cupom', err);
    return res.status(500).json({ error: 'Erro interno ao processar o cupom.', details: err.message });
  }
}
