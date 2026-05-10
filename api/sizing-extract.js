// api/sizing-extract.js
// Endpoint autenticado do painel. Extrai tabela de medidas via Gemini 2.0 Flash.

import { Redis } from '@upstash/redis';
import { createHash, timingSafeEqual, scryptSync } from 'crypto';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`;

function isValidClientKey(key) {
  return typeof key === 'string' && /^pvk_[a-f0-9]{32}$/.test(key);
}

function verifyPassword(input, stored) {
  if (!stored || !input) return false;
  if (stored.includes(':') && stored.length > 60) {
    try {
      const [salt, hash] = stored.split(':');
      const inputHash = scryptSync(String(input), salt, 64).toString('hex');
      return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(inputHash, 'hex'));
    } catch { return false; }
  }
  try {
    const a = Buffer.from(String(input));
    const b = Buffer.from(String(stored));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch { return false; }
}

// ─── Google Auth (copiado de api/process.js) ──────────────────────────────────

function pemToBuffer(pem) {
  return Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');
}

async function getGoogleAccessToken() {
  const sa  = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsignedToken = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })}`;
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', pemToBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, Buffer.from(unsignedToken));
  const jwt = `${unsignedToken}.${Buffer.from(signature).toString('base64url')}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Falha ao obter access token: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function productIdFromUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return createHash('sha256').update(hostname + pathname).digest('hex').slice(0, 32);
  } catch { return null; }
}

function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 12000);
}

const EXTRACTION_PROMPT = `Extraia a tabela de medidas desta página/imagem de produto.
Retorne JSON com o formato:
{
  "sizes": {
    "P": { "bust": [min, max], "waist": [min, max], "hip": [min, max] },
    "M": { "bust": [min, max], "waist": [min, max], "hip": [min, max] }
  },
  "unit": "cm",
  "confidence": "high",
  "notes": null
}
Regras: tamanhos podem ser PP/P/M/G/GG/XGG ou numéricos (34-48).
Se a tabela estiver em polegadas, converter para cm (× 2,54).
Retornar APENAS o JSON, sem markdown.`;

async function callGemini(textContent, imageBase64, imageMimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurado nas variáveis de ambiente.');

  const parts = [];
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: imageMimeType || 'image/jpeg', data: imageBase64 } });
  } else {
    parts.push({ text: textContent });
  }
  parts.push({ text: EXTRACTION_PROMPT });

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents:         [{ role: 'user', parts }],
      generationConfig: { temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini retornou ${res.status}: ${err}`);
  }

  const data = await res.json();
  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini não retornou conteúdo: ' + JSON.stringify(data));
  // Remove markdown code fences se presentes
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return JSON.parse(text);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { clientKey, password, productUrl, imageBase64, imageMimeType, productId: externalProductId, productName } = req.body || {};

  if (!isValidClientKey(clientKey)) return res.status(400).json({ error: 'clientKey inválido.' });
  if (!password) return res.status(400).json({ error: 'password é obrigatório.' });
  if (!productUrl && !imageBase64) return res.status(400).json({ error: 'Informe productUrl ou imageBase64.' });

  // Autenticação
  const clientRaw = await redis.get(`client:${clientKey}`);
  if (!clientRaw) return res.status(401).json({ error: 'Não autorizado.' });
  const client = typeof clientRaw === 'string' ? JSON.parse(clientRaw) : clientRaw;
  if (!client.active) return res.status(403).json({ error: 'Conta inativa.' });
  const stored = client.passwordHash || client.secret || '';
  if (!verifyPassword(password, stored)) return res.status(401).json({ error: 'Não autorizado.' });

  // Determina productId
  const productId = externalProductId || (productUrl ? productIdFromUrl(productUrl) : null);
  if (!productId) return res.status(400).json({ error: 'Não foi possível determinar o productId.' });

  try {
    let textContent = null;
    let imgData     = imageBase64 || null;

    // Busca e limpa a página se veio URL
    if (productUrl && !imageBase64) {
      const pageRes = await fetch(productUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MirageFit/1.0)' },
      });
      if (!pageRes.ok) throw new Error(`Falha ao buscar página: ${pageRes.status}`);
      textContent = cleanHtml(await pageRes.text());
    }

    // Remove prefixo data URI se presente
    if (imgData && imgData.includes(',')) imgData = imgData.split(',')[1];

    const extracted = await callGemini(textContent, imgData, imageMimeType);

    const now     = new Date().toISOString();
    const product = {
      productId,
      productName:  productName || null,
      productUrl:   productUrl  || null,
      extractedAt:  now,
      createdAt:    now,
      updatedAt:    now,
      source:       'auto',
      confidence:   extracted.confidence || 'medium',
      sizes:        extracted.sizes      || {},
      unit:         extracted.unit       || 'cm',
      notes:        extracted.notes      || null,
    };

    await Promise.all([
      redis.set(`fit:product:${clientKey}:${productId}`, JSON.stringify(product)),
      redis.zadd(`fit:products:${clientKey}`, { score: Date.now(), member: productId }),
    ]);

    return res.json({ success: true, productId, product });

  } catch (err) {
    console.error('[sizing-extract] Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
