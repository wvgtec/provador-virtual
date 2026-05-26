// api/studio-upload-url.js
// URL assinada V4 do GCS para upload direto da peça de roupa do Studio.
// Requer STUDIO_SECRET no header Authorization.

import { randomUUID, timingSafeEqual } from 'crypto';

const BUCKET  = process.env.GCS_BUCKET || 'mirage-tryon';
const EXPIRES = 300; // 5 minutos

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

async function signedPutUrl(objectPath, contentType) {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const datetime =
    now.getUTCFullYear() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    'T' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds()) + 'Z';
  const date = datetime.slice(0, 8);

  const credentialScope  = `${date}/auto/storage/goog4_request`;
  const credential       = `${sa.client_email}/${credentialScope}`;
  const signedHeaders    = 'content-type;host';
  const canonicalHeaders = `content-type:${contentType}\nhost:storage.googleapis.com\n`;

  const qParams = [
    ['X-Goog-Algorithm',     'GOOG4-RSA-SHA256'],
    ['X-Goog-Credential',    credential],
    ['X-Goog-Date',          datetime],
    ['X-Goog-Expires',       String(EXPIRES)],
    ['X-Goog-SignedHeaders', signedHeaders],
  ].sort(([a], [b]) => a.localeCompare(b));

  const canonicalQS = qParams
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    'PUT',
    `/${BUCKET}/${objectPath}`,
    canonicalQS,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest));
  const hashHex = Buffer.from(hashBuf).toString('hex');

  const stringToSign = ['GOOG4-RSA-SHA256', datetime, credentialScope, hashHex].join('\n');

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(stringToSign));
  const sigHex = Buffer.from(sigBuf).toString('hex');

  return `https://storage.googleapis.com/${BUCKET}/${objectPath}?${canonicalQS}&X-Goog-Signature=${sigHex}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });


  const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const { contentType: rawContentType } = req.body || {};
  const contentType = ALLOWED_TYPES.includes(rawContentType) ? rawContentType : 'image/jpeg';

  const fileId     = randomUUID();
  const objectPath = `studio/inputs/${fileId}.jpg`;
  const gcsUrl     = `https://storage.googleapis.com/${BUCKET}/${objectPath}`;
  const signedUrl  = await signedPutUrl(objectPath, contentType);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ signedUrl, gcsUrl, fileId });
}
