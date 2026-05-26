// api/studio-generate.js
// Fluxo em 2 etapas:
//   1. Imagen 3 gera foto do modelo a partir do prompt de texto
//   2. Virtual Try-On (virtual-try-on-001) aplica a peça exata no modelo gerado
// Roda direto no Vercel (limite 60s).

import { Redis } from '@upstash/redis';
import { randomUUID, timingSafeEqual } from 'crypto';

const redis  = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const BUCKET = process.env.GCS_BUCKET || 'mirage-tryon';
const PROJECT_ID = 'provador-virtual-494213';
const LOCATION   = 'us-central1';

function isAuthorized(req) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token || !process.env.STUDIO_SECRET) return false;
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(process.env.STUDIO_SECRET);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch { return false; }
}

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

async function uploadToGCS(accessToken, objectPath, buffer, contentType = 'image/jpeg') {
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

// Etapa 1a: Gera modelo do zero com Imagen 3 (sem foto de referência)
async function callImagen3({ prompt, accessToken }) {
  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-generate-001:predict`;

  const res = await fetch(endpoint, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount:      1,
        aspectRatio:      '3:4',
        safetySetting:    'block_few',
        personGeneration: 'allow_all',
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Imagen 3 retornou ${res.status}: ${err}`);
  }

  const data = await res.json();
  const imageBase64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!imageBase64) throw new Error('Imagen 3 não retornou imagem: ' + JSON.stringify(data));
  return imageBase64;
}


// Etapa 2: Aplica a peça exata no modelo gerado via Virtual Try-On
async function callVirtualTryOn({ personBase64, garmentBase64, category, accessToken }) {
  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/virtual-try-on-001:predict`;

  const res = await fetch(endpoint, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{
        personImage:   { image: { bytesBase64Encoded: personBase64 } },
        productImages: [{ image: { bytesBase64Encoded: garmentBase64 } }],
      }],
      parameters: {
        sampleCount:      1,
        safetySetting:    'block_few',
        personGeneration: 'allow_all',
        ...(category && category !== 'auto' ? { category } : {}),
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Virtual Try-On retornou ${res.status}: ${err}`);
  }

  const data = await res.json();
  const imageBase64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!imageBase64) throw new Error('Virtual Try-On não retornou imagem: ' + JSON.stringify(data));
  return imageBase64;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });


  const { garmentGcsUrl, prompt, category, modelGcsUrl } = req.body || {};

  if (!garmentGcsUrl || !String(garmentGcsUrl).startsWith('https://storage.googleapis.com/')) {
    return res.status(400).json({ error: 'garmentGcsUrl inválida.' });
  }
  const hasModel = modelGcsUrl && String(modelGcsUrl).startsWith('https://storage.googleapis.com/');
  if (!hasModel) {
    if (!prompt || typeof prompt !== 'string' || prompt.length < 10 || prompt.length > 1000) {
      return res.status(400).json({ error: 'prompt deve ter entre 10 e 1000 caracteres.' });
    }
  }

  const jobId     = randomUUID();
  const createdAt = Date.now();

  await redis.set(`studio:job:${jobId}`, JSON.stringify({
    jobId, type: 'image', status: 'processing',
    prompt, garmentUrl: garmentGcsUrl, category: category || 'auto',
    resultImage: null, resultVideo: null,
    videoPrompt: null, sourceJobId: null, error: null,
    createdAt, startedAt: createdAt, completedAt: null,
  }), { ex: 86400 });

  try {
    const accessToken = await getGoogleAccessToken();

    // Busca peça de roupa do GCS
    const garmentRes = await fetch(garmentGcsUrl);
    if (!garmentRes.ok) throw new Error(`Falha ao buscar peça do GCS: ${garmentRes.status}`);
    const garmentBase64 = Buffer.from(await garmentRes.arrayBuffer()).toString('base64');

    let personBase64;

    if (modelGcsUrl && String(modelGcsUrl).startsWith('https://storage.googleapis.com/')) {
      // Modelo fornecida (original ou já ajustada pelo studio-adjust-model) — usa direto
      console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'studio_model_provided', jobId }));
      const modelRes = await fetch(modelGcsUrl);
      if (!modelRes.ok) throw new Error(`Falha ao buscar foto da modelo: ${modelRes.status}`);
      personBase64 = Buffer.from(await modelRes.arrayBuffer()).toString('base64');
    } else {
      // Sem modelo: gera do zero com Imagen 3
      console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'studio_imagen3_start', jobId }));
      personBase64 = await callImagen3({ prompt, accessToken });
    }

    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'studio_tryon_start', jobId, category: category || 'auto' }));

    // Etapa 2: aplica a peça no modelo
    const finalBase64 = await callVirtualTryOn({ personBase64, garmentBase64, category, accessToken });

    const outputPath  = `studio/images/${jobId}.jpg`;
    const resultImage = await uploadToGCS(accessToken, outputPath, Buffer.from(finalBase64, 'base64'), 'image/jpeg');
    const completedAt = Date.now();

    await redis.set(`studio:job:${jobId}`, JSON.stringify({
      jobId, type: 'image', status: 'done',
      prompt, garmentUrl: garmentGcsUrl, category: category || 'auto',
      resultImage, resultVideo: null,
      videoPrompt: null, sourceJobId: null, error: null,
      createdAt, startedAt: createdAt, completedAt,
    }), { ex: 86400 });

    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'studio_image_done', jobId, durationMs: completedAt - createdAt }));

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ jobId, resultImage });

  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'studio_image_error', jobId, error: err.message }));
    await redis.set(`studio:job:${jobId}`, JSON.stringify({
      jobId, type: 'image', status: 'error', error: err.message,
      prompt, garmentUrl: garmentGcsUrl,
      resultImage: null, resultVideo: null,
      videoPrompt: null, sourceJobId: null,
      createdAt, startedAt: createdAt, completedAt: null,
    }), { ex: 3600 });
    return res.status(500).json({ error: err.message });
  }
}
