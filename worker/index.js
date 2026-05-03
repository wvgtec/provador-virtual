// worker/index.js
// Worker desacoplado para processamento Vertex AI.
// Roda no Cloud Run com timeout de até 3600s.
// Chamado pelo QStash — mesma lógica do api/process.js do Vercel,
// sem o limite de 60s.

import express from 'express';
import { Redis } from '@upstash/redis';
import { Receiver, Client as QStashClient } from '@upstash/qstash';

const app    = express();
const PORT   = process.env.PORT || 8080;

const redis  = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const BUCKET = process.env.GCS_BUCKET || 'mirage-tryon';
const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN });
const APP_URL = process.env.APP_URL || 'https://app.mirageai.com.br';

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey:    process.env.QSTASH_NEXT_SIGNING_KEY,
});

// ─── Log estruturado ──────────────────────────────────────────────────────────
function log(event, data = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

// ─── Google Auth (com cache em memória por 55 min) ────────────────────────────
function pemToBuffer(pem) {
  return Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');
}

let _tokenCache = null; // { token, expiresAt }

async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000);

  // Retorna token em cache se ainda válido (margem de 5 min)
  if (_tokenCache && now < _tokenCache.expiresAt - 300) {
    return _tokenCache.token;
  }

  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

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

  _tokenCache = { token: tokenData.access_token, expiresAt: now + 3600 };
  return tokenData.access_token;
}

// ─── SSRF protection ──────────────────────────────────────────────────────────
function isSafeUrl(value) {
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fc00:|fd)/.test(host)) return false;
    return true;
  } catch { return false; }
}

// ─── GCS Upload ───────────────────────────────────────────────────────────────
async function uploadToGCS(accessToken, objectPath, buffer, contentType = 'image/png') {
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': contentType },
    body:    buffer,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GCS upload falhou: ${res.status} ${err}`);
  }
  return `https://storage.googleapis.com/${BUCKET}/${objectPath}`;
}

// ─── Vertex AI Virtual Try-On ─────────────────────────────────────────────────
async function callVertexTryOn({ projectId, personImageUrl, garmentImageUrl, category, accessToken }) {
  const LOCATION = 'us-central1';
  const MODEL    = 'virtual-try-on-001';
  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;

  const toBase64 = async (value) => {
    if (!value) throw new Error('Imagem não informada');
    if (!value.startsWith('http') && !value.startsWith('//')) {
      return value.includes(',') ? value.split(',')[1] : value;
    }
    if (!isSafeUrl(value)) throw new Error('URL de imagem não permitida.');
    const res = await fetch(value.startsWith('//') ? 'https:' + value : value);
    if (!res.ok) throw new Error(`Falha ao buscar imagem: ${res.status}`);
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  };

  const [personB64, productB64] = await Promise.all([
    toBase64(personImageUrl),
    toBase64(garmentImageUrl),
  ]);

  log('vertex_request', { category });

  const response = await fetch(endpoint, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{
        personImage:   { image: { bytesBase64Encoded: personB64 } },
        productImages: [{ image: { bytesBase64Encoded: productB64 } }],
      }],
      parameters: { sampleCount: 1, safetySetting: 'block_few', personGeneration: 'allow_all' },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vertex AI retornou ${response.status}: ${err}`);
  }

  const data = await response.json();
  // Vertex AI virtual-try-on-001 retorna JPEG, não PNG
  const imageBase64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!imageBase64) throw new Error('Vertex AI não retornou imagem: ' + JSON.stringify(data));
  return imageBase64;
}

// ─── Middleware — lê body raw para verificação QStash ─────────────────────────
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ ok: true, service: 'mirage-worker', ts: new Date().toISOString() }));

// ─── Endpoint principal ───────────────────────────────────────────────────────
app.post('/process', async (req, res) => {
  // Verifica assinatura QStash
  try {
    const signature = req.headers['upstash-signature'];
    if (!signature) return res.status(401).json({ error: 'Assinatura ausente.' });
    const isValid = await receiver.verify({
      signature,
      body:           JSON.stringify(req.body),
      clockTolerance: 60,
    });
    if (!isValid) return res.status(401).json({ error: 'Assinatura inválida.' });
  } catch (e) {
    return res.status(401).json({ error: 'Falha na verificação: ' + e.message });
  }

  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: 'jobId obrigatório' });

  const raw = await redis.get(`job:${jobId}`);
  if (!raw) return res.status(404).json({ error: 'Job não encontrado ou expirado' });
  const job = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Idempotência
  if (job.status === 'done') {
    log('process_idempotent', { jobId });
    return res.status(200).json({ jobId, status: 'done', idempotent: true });
  }

  // Circuit breaker
  const vertexPaused = await redis.get('vertex:paused');
  if (vertexPaused) {
    await redis.set(`job:${jobId}`, JSON.stringify({
      ...job, status: 'delayed', delayedAt: Date.now(), delayReason: 'vertex_paused',
    }), { ex: 3600 });
    log('process_delayed_vertex_paused', { jobId });
    return res.status(200).json({ jobId, status: 'delayed', reason: 'vertex_paused' });
  }

  const { personImageUrl, garmentImageUrl, category, projectId, clientKey, lead, productUrl, productName, hash } = job;
  const startedAt = Date.now();

  log('process_start', { jobId, clientKey, category });

  await Promise.all([
    redis.set(`job:${jobId}`, JSON.stringify({ status: 'processing', startedAt, hash, clientKey }), { ex: 300 }),
    ...(clientKey ? [
      redis.zrem(`jobs:${clientKey}:pending`, jobId),
      redis.zadd(`jobs:${clientKey}:processing`, { score: Date.now(), member: jobId }),
    ] : []),
  ]);

  try {
    const accessToken = await getGoogleAccessToken();
    const imageBase64 = await callVertexTryOn({ projectId, personImageUrl, garmentImageUrl, category, accessToken });

    // Vertex AI retorna JPEG — armazenado com content-type correto
    const outputPath = `outputs/${jobId}.jpg`;
    const resultUrl  = await uploadToGCS(accessToken, outputPath, Buffer.from(imageBase64, 'base64'), 'image/jpeg');
    const completedAt = Date.now();

    await Promise.all([
      redis.set(
        `job:${jobId}`,
        JSON.stringify({ status: 'done', resultImage: resultUrl, completedAt, clientKey, productUrl, productName, hash }),
        { ex: 3600 }
      ),
      ...(hash ? [redis.set(`cache:${hash}`, resultUrl, { ex: 86400 })] : []),
      ...(clientKey ? [
        redis.zrem(`jobs:${clientKey}:processing`, jobId),
        redis.zadd(`jobs:${clientKey}:done`, { score: completedAt, member: jobId }),
        redis.expire(`jobs:${clientKey}:done`, 60 * 60 * 24 * 90),
      ] : []),
    ]);

    const personPath = new URL(personImageUrl).pathname.replace(`/${BUCKET}/`, '');
    await Promise.all([
      qstash.publishJSON({
        url: `${APP_URL}/api/cleanup-person`, body: { jobId, personPath }, delay: 180,
      }).catch(e => log('cleanup_person_warn', { jobId, error: e.message })),
      qstash.publishJSON({
        url: `${APP_URL}/api/cleanup`, body: { jobId, objectPath: outputPath }, delay: 3600,
      }).catch(e => log('cleanup_result_warn', { jobId, error: e.message })),
    ]);

    const ts = Date.now();
    const finalProductUrl  = productUrl  || garmentImageUrl;
    const finalProductName = productName || finalProductUrl;

    if (clientKey && lead) {
      await Promise.all([
        redis.zadd(`leads:${clientKey}`, { score: ts, member: jobId }),
        redis.set(`lead:${jobId}`, JSON.stringify({
          name: lead.name, email: lead.email, whatsapp: lead.whatsapp,
          productUrl: finalProductUrl, productName: finalProductName,
          resultUrl, jobId, completedAt: ts, clientKey,
        }), { ex: 86400 * 90 }),
      ]);
    }

    if (clientKey) {
      await Promise.all([
        redis.zincrby(`products:${clientKey}`, 1, finalProductUrl),
        redis.hset(`product_names:${clientKey}`, { [finalProductUrl]: finalProductName }),
      ]);
    }

    const durationMs = Date.now() - startedAt;
    log('process_done', { jobId, clientKey, durationMs });

    // GA4 Measurement Protocol — evento server-side (não bloqueável por ad blocker)
    fetch(`https://www.google-analytics.com/mp/collect?measurement_id=G-3CTR9CDSX4&api_secret=G-W38t4oSGW8scDifAUq0Q`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: `server.${clientKey}`,
        events: [{
          name: 'tryon_completed',
          params: { client_key: clientKey, category: category || 'auto', duration_ms: durationMs, cached: false, engagement_time_msec: 1 },
        }],
      }),
    }).catch(() => {});

    return res.status(200).json({ jobId, status: 'done' });

  } catch (err) {
    const failedAt = Date.now();
    log('process_error', { jobId, clientKey, error: err.message, durationMs: failedAt - startedAt });

    await Promise.all([
      redis.set(`job:${jobId}`, JSON.stringify({
        status: 'error', error: err.message, failedAt, clientKey,
      }), { ex: 3600 }),
      ...(clientKey ? [
        redis.zrem(`jobs:${clientKey}:processing`, jobId),
        redis.zadd(`jobs:${clientKey}:error`, { score: failedAt, member: jobId }),
        redis.expire(`jobs:${clientKey}:error`, 60 * 60 * 24 * 90),
      ] : []),
    ]);

    return res.status(200).json({ jobId, status: 'error', error: 'Erro ao processar imagem.' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  log('worker_started', { port: PORT });
  // Pré-aquece o access token para a primeira requisição ser mais rápida
  getGoogleAccessToken()
    .then(() => log('token_prewarmed'))
    .catch(e => log('token_prewarm_error', { error: e.message }));
});
