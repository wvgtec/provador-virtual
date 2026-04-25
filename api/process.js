// api/process.js
// Chamado pelo QStash (fila). Faz a chamada real ao Vertex AI e salva o resultado no Redis.
// NUNCA deve ser chamado diretamente pelo browser — só pelo QStash.

import { Redis } from '@upstash/redis';
import { Receiver } from '@upstash/qstash';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ─── Google Auth ─────────────────────────────────────────────────────────────

async function getGoogleAccessToken() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const unsignedToken = `${encode(header)}.${encode(payload)}`;

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    Buffer.from(unsignedToken)
  );

  const jwt = `${unsignedToken}.${Buffer.from(signature).toString('base64url')}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('Falha ao obter access token Google: ' + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

function pemToBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  return Buffer.from(b64, 'base64');
}

// Bloqueia SSRF: rejeita IPs privados, loopback e link-local
function isSafeUrl(value) {
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname;
    // Bloqueia loopback, privados e link-local
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fc00:|fd)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

// ─── Vertex AI Virtual Try-On ─────────────────────────────────────────────────

async function callVertexTryOn({ projectId, personImage, garmentImage, category }) {
  const accessToken = await getGoogleAccessToken();
  const LOCATION = 'us-central1';
  const MODEL = 'virtual-try-on-001';

  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;

  const stripPrefix = (value) => value.includes(',') ? value.split(',')[1] : value;

  const toBase64 = async (value) => {
    if (!value) throw new Error('Imagem não informada');
    if (!value.startsWith('http') && !value.startsWith('//')) {
      return stripPrefix(value);
    }
    if (!isSafeUrl(value)) throw new Error('URL de imagem não permitida.');
    const url = value.startsWith('//') ? 'https:' + value : value;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Falha ao buscar imagem: ${res.status}`);
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  };

  const personB64  = await toBase64(personImage);
  const productB64 = await toBase64(garmentImage);

  console.log('[Vertex] iniciando request | category:', category);

  const instance = {
    personImage:   { image: { bytesBase64Encoded: personB64 } },
    productImages: [{ image: { bytesBase64Encoded: productB64 } }],
  };

  const body = {
    instances: [instance],
    parameters: {
      sampleCount: 1,
      safetySetting: 'block_few',
      personGeneration: 'allow_all',
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vertex AI retornou ${response.status}: ${err}`);
  }

  const data = await response.json();
  const imageBase64 = data?.predictions?.[0]?.bytesBase64Encoded;

  if (!imageBase64) {
    throw new Error('Vertex AI não retornou imagem. Resposta: ' + JSON.stringify(data));
  }

  return `data:image/png;base64,${imageBase64}`;
}

// ─── Validação de assinatura QStash ──────────────────────────────────────────

const receiver = new Receiver({
  currentSigningKey:  process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey:     process.env.QSTASH_NEXT_SIGNING_KEY,
});

// ─── Handler principal ────────────────────────────────────────────────────────

async function processHandler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verifica que a chamada veio realmente do QStash
  try {
    const signature = req.headers['upstash-signature'];
    if (!signature) {
      return res.status(401).json({ error: 'Assinatura ausente.' });
    }
    const rawBody = JSON.stringify(req.body);
    const isValid = await receiver.verify({
      signature,
      body: rawBody,
      clockTolerance: 60,
    });
    if (!isValid) {
      return res.status(401).json({ error: 'Assinatura inválida.' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Falha na verificação: ' + e.message });
  }

  const { jobId } = req.body;

  if (!jobId) {
    return res.status(400).json({ error: 'jobId obrigatório' });
  }

  const raw = await redis.get(`job:${jobId}`);
  if (!raw) {
    return res.status(404).json({ error: 'Job não encontrado ou expirado' });
  }
  const job = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const { personImage, garmentImage, category, projectId } = job;

  await redis.set(
    `job:${jobId}`,
    JSON.stringify({ status: 'processing', startedAt: Date.now() }),
    { ex: 3600 }
  );

  try {
    const resultImage = await callVertexTryOn({
      projectId,
      personImage,
      garmentImage,
      category,
    });

    await redis.set(
      `job:${jobId}`,
      JSON.stringify({
        status: 'done',
        resultImage,
        completedAt: Date.now(),
      }),
      { ex: 3600 }
    );

    return res.status(200).json({ jobId, status: 'done' });

  } catch (err) {
    console.error(`[process] Erro no job ${jobId}:`, err);

    await redis.set(
      `job:${jobId}`,
      JSON.stringify({
        status: 'error',
        error: err.message,
        failedAt: Date.now(),
      }),
      { ex: 3600 }
    );

    return res.status(200).json({ jobId, status: 'error', error: 'Erro ao processar imagem.' });
  }
}

export default processHandler;
