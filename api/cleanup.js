// api/cleanup.js
// Chamado pelo QStash 3 minutos após geração.
// Deleta a imagem do GCS e expira o job do Redis.

import { Receiver } from '@upstash/qstash';
import { Redis } from '@upstash/redis';

const redis   = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const BUCKET  = process.env.GCS_BUCKET || 'mirage-tryon';

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey:    process.env.QSTASH_NEXT_SIGNING_KEY,
});

function pemToBuffer(pem) {
  return Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');
}

async function getGoogleAccessToken() {
  const sa  = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/devstorage.read_write',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })).toString('base64url');
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(pemToBuffer(sa.private_key)).toString('base64url');
  const jwt = `${header}.${payload}.${signature}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token GCS falhou: ' + JSON.stringify(data));
  return data.access_token;
}

async function deleteFromGCS(accessToken, objectPath) {
  const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(objectPath)}`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status !== 204 && res.status !== 404) {
    console.warn(`[cleanup] GCS delete status ${res.status} for ${objectPath}`);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verifica assinatura QStash
  try {
    const signature = req.headers['upstash-signature'];
    if (!signature) return res.status(401).json({ error: 'Assinatura ausente.' });
    const isValid = await receiver.verify({ signature, body: JSON.stringify(req.body), clockTolerance: 60 });
    if (!isValid) return res.status(401).json({ error: 'Assinatura inválida.' });
  } catch (e) {
    return res.status(401).json({ error: 'Falha na verificação: ' + e.message });
  }

  const { jobId, objectPath } = req.body || {};
  if (!jobId || !objectPath) return res.status(400).json({ error: 'jobId e objectPath obrigatórios.' });

  try {
    const accessToken = await getGoogleAccessToken();
    await deleteFromGCS(accessToken, objectPath);

    // Expira o job imediatamente no Redis
    await redis.expire(`job:${jobId}`, 1);

    console.log(`[cleanup] Imagem deletada: ${objectPath} (job: ${jobId})`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[cleanup] Erro:', err);
    return res.status(500).json({ error: 'Erro ao limpar imagem.' });
  }
}
