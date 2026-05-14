// api/studio-adjust-model.js
// Ajusta o ambiente/fundo da foto da modelo usando EDIT_MODE_BGSWAP do Imagen 3.
// POST /api/studio-adjust-model
// Body: { modelGcsUrl, prompt }
// Returns: { adjustedImageUrl }

import { timingSafeEqual } from 'crypto';

const BUCKET     = process.env.GCS_BUCKET || 'mirage-tryon';
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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Não autorizado.' });

  const { modelGcsUrl, prompt } = req.body || {};

  if (!modelGcsUrl || !String(modelGcsUrl).startsWith('https://storage.googleapis.com/')) {
    return res.status(400).json({ error: 'modelGcsUrl inválida.' });
  }
  if (!prompt || typeof prompt !== 'string' || prompt.length < 5 || prompt.length > 1000) {
    return res.status(400).json({ error: 'prompt deve ter entre 5 e 1000 caracteres.' });
  }

  try {
    const accessToken = await getGoogleAccessToken();

    const modelRes = await fetch(modelGcsUrl);
    if (!modelRes.ok) throw new Error(`Falha ao buscar modelo do GCS: ${modelRes.status}`);
    const modelBase64 = Buffer.from(await modelRes.arrayBuffer()).toString('base64');

    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/imagen-3.0-capability-001:predict`;

    const apiRes = await fetch(endpoint, {
      method:  'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{
          prompt,
          referenceImages: [{
            referenceType:  'REFERENCE_TYPE_RAW',
            referenceId:    1,
            referenceImage: { bytesBase64Encoded: modelBase64 },
          }],
          editConfig: { editMode: 'EDIT_MODE_BGSWAP' },
        }],
        parameters: {
          sampleCount:      1,
          safetySetting:    'block_few',
          personGeneration: 'allow_all',
        },
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.text();
      throw new Error(`Imagen 3 BgSwap retornou ${apiRes.status}: ${err}`);
    }

    const data = await apiRes.json();
    const imageBase64 = data?.predictions?.[0]?.bytesBase64Encoded;
    if (!imageBase64) throw new Error('Imagen 3 não retornou imagem: ' + JSON.stringify(data));

    const outputPath    = `studio/adjusted/${Date.now()}.jpg`;
    const adjustedImageUrl = await uploadToGCS(accessToken, outputPath, Buffer.from(imageBase64, 'base64'), 'image/jpeg');

    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'studio_adjust_done' }));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ adjustedImageUrl });

  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'studio_adjust_error', error: err.message }));
    return res.status(500).json({ error: err.message });
  }
}
