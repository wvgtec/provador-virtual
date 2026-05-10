// api/sizing.js
// Endpoint público chamado pelo widget. Sem senha — só clientKey.
// Actions: recommend, getProduct, saveOutcome

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function isValidClientKey(key) {
  return typeof key === 'string' && /^pvk_[a-f0-9]{32}$/.test(key);
}

async function isRateLimited(ip, prefix, maxRequests, windowSeconds) {
  const key = `${prefix}:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count > maxRequests;
}

// ─── Algoritmo antropométrico ─────────────────────────────────────────────────

const BIOTYPE_COEFF = {
  hourglass:   { bust: 0.530, waist: 0.395, hip: 0.550, shoulder: 0.228 },
  pear:        { bust: 0.500, waist: 0.408, hip: 0.580, shoulder: 0.220 },
  apple:       { bust: 0.550, waist: 0.458, hip: 0.530, shoulder: 0.238 },
  rectangle:   { bust: 0.520, waist: 0.438, hip: 0.520, shoulder: 0.230 },
  invertedTri: { bust: 0.560, waist: 0.418, hip: 0.510, shoulder: 0.252 },
};

function bmiAdjust(weight, height) {
  const bmi = weight / ((height / 100) ** 2);
  return bmi < 18.5 ? 0.97 : bmi < 25 ? 1.00 : bmi < 30 ? 1.03 : 1.06;
}

function estimateMeasurements({ height, weight, biotype }) {
  const c   = BIOTYPE_COEFF[biotype] || BIOTYPE_COEFF.rectangle;
  const adj = bmiAdjust(weight, height);
  return {
    bust:     Math.round(height * c.bust * adj),
    waist:    Math.round(height * c.waist * adj),
    hip:      Math.round(height * c.hip * adj),
    shoulder: Math.round(height * c.shoulder),
    inseam:   Math.round(height * 0.47),
  };
}

// ─── Algoritmo de matching ────────────────────────────────────────────────────

function recommendSize(measurements, productSizes) {
  if (!productSizes || Object.keys(productSizes).length === 0) return null;
  const scores = {};
  for (const [size, ranges] of Object.entries(productSizes)) {
    let score = 0, checks = 0;
    const check = (measured, range) => {
      if (!range || range.length < 2) return;
      const mid  = (range[0] + range[1]) / 2;
      const span = Math.max(range[1] - range[0], 4);
      score += Math.max(0, 1 - Math.abs(measured - mid) / span);
      checks++;
    };
    check(measurements.bust,  ranges.bust);
    check(measurements.waist, ranges.waist);
    check(measurements.hip,   ranges.hip);
    scores[size] = checks > 0 ? score / checks : 0;
  }
  const [bestSize, bestScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return {
    size:       bestSize,
    confidence: bestScore > 0.75 ? 'high' : bestScore > 0.45 ? 'medium' : 'low',
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (await isRateLimited(ip, 'rl:sizing', 60, 60)) {
    return res.status(429).json({ error: 'Muitas requisições. Aguarde 1 minuto.' });
  }

  // Suporta GET (getProduct) e POST (recommend, saveOutcome)
  const params = req.method === 'GET' ? req.query : (req.body || {});
  const { action, clientKey } = params;

  if (!action) return res.status(400).json({ error: 'action é obrigatório.' });
  if (!isValidClientKey(clientKey)) return res.status(400).json({ error: 'clientKey inválido.' });

  // ─── getProduct — retorna tabela de medidas de um produto ─────────────────
  if (action === 'getProduct') {
    const { productId } = params;
    if (!productId) return res.status(400).json({ error: 'productId é obrigatório.' });

    const raw = await redis.get(`fit:product:${clientKey}:${productId}`);
    if (raw) {
      const product = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return res.json({ found: true, product });
    }
    // Fallback: tabela padrão da loja
    const defRaw = await redis.get(`fit:product:${clientKey}:__default__`);
    if (!defRaw) return res.json({ found: false });
    const product = typeof defRaw === 'string' ? JSON.parse(defRaw) : defRaw;
    return res.json({ found: true, product, isDefault: true });
  }

  // Demais actions requerem POST e cliente ativo
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const clientRaw = await redis.get(`client:${clientKey}`);
  if (!clientRaw) return res.status(401).json({ error: 'clientKey inválido.' });
  const client = typeof clientRaw === 'string' ? JSON.parse(clientRaw) : clientRaw;
  if (!client.active) return res.status(403).json({ error: 'Conta inativa.' });

  // ─── recommend — estima medidas e recomenda tamanho ───────────────────────
  if (action === 'recommend') {
    const { height, weight, biotype, productId } = params;

    const h = Number(height);
    const w = Number(weight);
    if (!h || h < 120 || h > 220) return res.status(400).json({ error: 'Altura inválida. Informe entre 120 e 220 cm.' });
    if (!w || w < 30  || w > 250) return res.status(400).json({ error: 'Peso inválido. Informe entre 30 e 250 kg.' });
    if (!biotype || !BIOTYPE_COEFF[biotype]) return res.status(400).json({ error: 'Biotipo inválido.' });

    const measurements = estimateMeasurements({ height: h, weight: w, biotype });
    let recommendation = null;

    if (productId) {
      const prodRaw = await redis.get(`fit:product:${clientKey}:${productId}`);
      if (prodRaw) {
        const product = typeof prodRaw === 'string' ? JSON.parse(prodRaw) : prodRaw;
        recommendation = recommendSize(measurements, product.sizes);
      }
    }

    return res.json({ measurements, recommendation, unit: 'cm' });
  }

  // ─── saveOutcome — registra resultado de uma sessão ───────────────────────
  if (action === 'saveOutcome') {
    const { sessionId, productId, recommendedSize, confidence, method, inputs } = params;
    if (!sessionId || typeof sessionId !== 'string') return res.status(400).json({ error: 'sessionId é obrigatório.' });

    const outcome = {
      sessionId,
      productId:       productId       || null,
      recommendedSize: recommendedSize || null,
      confidence:      confidence      || null,
      method:          method          || 'anthropometric',
      inputs:          inputs          || {},
      ts:              Date.now(),
    };

    // TTL: 180 dias
    await redis.set(
      `fit:outcome:${clientKey}:${sessionId}`,
      JSON.stringify(outcome),
      { ex: 180 * 24 * 3600 }
    );

    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'Ação inválida.' });
}
