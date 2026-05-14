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
const APP_URL    = process.env.APP_URL    || 'https://app.mirageai.com.br';
const WORKER_URL = process.env.WORKER_URL || 'https://mirage-worker-783972783230.us-central1.run.app/process';

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

// ─── GCS helper — baixa arquivo por URI gs:// ────────────────────────────────
async function fetchGcsFile(gcsUri, accessToken) {
  const withoutScheme = gcsUri.replace('gs://', '');
  const slashIdx      = withoutScheme.indexOf('/');
  const bucket        = withoutScheme.slice(0, slashIdx);
  const objectPath    = withoutScheme.slice(slashIdx + 1);
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Falha ao baixar do GCS: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ─── Veo 3 — Inicia LRO (retorna operationName imediatamente) ────────────────
// Vertex AI predictLongRunning exige OAuth2 Bearer token — API keys não são aceitas.
async function callVeo3Start({ imageBase64, prompt, accessToken }) {
  const PROJECT_ID = 'provador-virtual-494213';
  const LOCATION   = 'us-central1';
  const endpoint   = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/veo-2.0-generate-001:predictLongRunning`;

  const startRes = await fetch(endpoint, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt, image: { bytesBase64Encoded: imageBase64, mimeType: 'image/jpeg' } }],
      parameters: { aspectRatio: '9:16', sampleCount: 1, durationSeconds: 5 },
    }),
  });

  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Veo 3 start falhou ${startRes.status}: ${err}`);
  }

  const lro = await startRes.json();
  const operationName = lro.name;
  if (!operationName) throw new Error('Veo 3 não retornou operationName: ' + JSON.stringify(lro));
  log('veo3_lro_started', { operationName });
  return operationName;
}

// ─── Veo 3 — Verifica LRO uma vez (não bloqueia) ─────────────────────────────
async function checkVeo3LRO({ operationName, accessToken }) {
  const LOCATION     = 'us-central1';
  const pollEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/${operationName}`;

  const pollRes = await fetch(pollEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!pollRes.ok) {
    // Loga o erro real para diagnóstico — não engole silenciosamente
    const errText = await pollRes.text().catch(() => '');
    log('veo3_lro_poll_error', { operationName, httpStatus: pollRes.status, body: errText.slice(0, 300) });
    // Erro 4xx permanente → lança para salvar como error no Redis
    if (pollRes.status >= 400 && pollRes.status < 500) {
      throw new Error(`LRO poll retornou ${pollRes.status}: ${errText.slice(0, 200)}`);
    }
    // Erro 5xx transitório → re-enfileira
    return { done: false };
  }

  const status = await pollRes.json();
  if (!status.done) return { done: false };
  if (status.error) throw new Error('Veo 3 erro: ' + JSON.stringify(status.error));

  const gcsUri = status.response?.videos?.[0]?.gcsUri
              || status.response?.predictions?.[0]?.gcsUri
              || status.response?.generatedSamples?.[0]?.video?.uri;

  log('veo3_done_response', { response: JSON.stringify(status.response) });
  if (!gcsUri) throw new Error('Veo 3 done mas sem gcsUri: ' + JSON.stringify(status));
  return { done: true, gcsUri };
}

// ─── Studio Video — padrão re-enqueue assíncrono ─────────────────────────────
// Cada chamada do worker faz no máximo 1 poll do LRO e retorna rapidamente,
// evitando o timeout do QStash (30 s). O job re-enfileira a si mesmo a cada
// 30 s até o Veo 3 concluir (máx 40 tentativas ≈ 20 min).
async function processStudioVideo(job) {
  const { jobId, resultImage, videoPrompt } = job;
  const operationName = job.operationName || null;
  const pollAttempts  = job.pollAttempts  || 0;
  const MAX_POLLS     = 80; // 80 × 15s ≈ 20 min máximo

  const accessToken = await getGoogleAccessToken();

  // ── Etapa 1: Sem LRO ainda — inicia Veo 3 ──────────────────────────────
  if (!operationName) {
    await redis.set(`studio:job:${jobId}`, JSON.stringify({
      ...job, status: 'processing', startedAt: Date.now(),
    }), { ex: 172800 });

    const imgRes = await fetch(resultImage);
    if (!imgRes.ok) throw new Error(`Falha ao buscar imagem base: ${imgRes.status}`);
    const imgB64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');

    const newOpName = await callVeo3Start({ imageBase64: imgB64, prompt: videoPrompt, accessToken });

    await redis.set(`studio:job:${jobId}`, JSON.stringify({
      ...job, status: 'processing', startedAt: job.startedAt || Date.now(),
      operationName: newOpName, pollAttempts: 0,
    }), { ex: 172800 });

    // Re-enfileira para checar status em 30s
    await qstash.publishJSON({ url: WORKER_URL, body: { jobId }, delay: 15 });
    log('veo3_lro_enqueued_poll', { jobId, operationName: newOpName });
    return;
  }

  // ── Etapa 2: Timeout — muitas tentativas sem conclusão ─────────────────
  if (pollAttempts >= MAX_POLLS) {
    throw new Error(`Veo 3 timeout após ${MAX_POLLS} tentativas (~${Math.round(MAX_POLLS * 30 / 60)} min)`);
  }

  // ── Etapa 3: Verifica LRO uma vez ──────────────────────────────────────
  const result = await checkVeo3LRO({ operationName, accessToken });

  if (!result.done) {
    // Ainda processando — atualiza contador e re-enfileira
    await redis.set(`studio:job:${jobId}`, JSON.stringify({
      ...job, pollAttempts: pollAttempts + 1,
    }), { ex: 172800 });
    await qstash.publishJSON({ url: WORKER_URL, body: { jobId }, delay: 15 });
    log('veo3_lro_polling', { jobId, operationName, pollAttempts: pollAttempts + 1 });
    return;
  }

  // ── Etapa 4: LRO concluído — baixa e salva vídeo ───────────────────────
  const videoBuffer = await fetchGcsFile(result.gcsUri, accessToken);
  const outputPath  = `studio/videos/${jobId}.mp4`;
  const finalUrl    = await uploadToGCS(accessToken, outputPath, videoBuffer, 'video/mp4');
  const completedAt = Date.now();

  await redis.set(`studio:job:${jobId}`, JSON.stringify({
    ...job, status: 'done', resultVideo: finalUrl, completedAt,
  }), { ex: 172800 });

  log('studio_video_done', { jobId, durationMs: completedAt - (job.startedAt || job.createdAt) });
}

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

  // Detecta se é um job do Studio (Veo 3) pelo prefixo studio:
  const studioRaw = await redis.get(`studio:job:${jobId}`);
  if (studioRaw) {
    const studioJob = typeof studioRaw === 'string' ? JSON.parse(studioRaw) : studioRaw;

    // Idempotência — job já finalizado (sucesso ou erro permanente)
    if (studioJob.status === 'done') {
      log('studio_video_idempotent', { jobId });
      return res.status(200).json({ jobId, status: 'done', idempotent: true });
    }
    if (studioJob.status === 'error') {
      log('studio_video_idempotent_error', { jobId });
      return res.status(200).json({ jobId, status: 'error', idempotent: true });
    }

    try {
      await processStudioVideo(studioJob);
      return res.status(200).json({ ok: true });
    } catch (err) {
      log('studio_video_error', { jobId, error: err.message });
      // Salva erro no Redis para o cliente exibir
      await redis.set(`studio:job:${jobId}`, JSON.stringify({
        ...studioJob, status: 'error', error: err.message,
      }), { ex: 3600 });
      // Retorna 200 para o QStash não retentar (erro já tratado)
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

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
