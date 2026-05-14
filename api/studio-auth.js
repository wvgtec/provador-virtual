// api/studio-auth.js
// Valida STUDIO_SECRET — usado pela UI para confirmar senha antes de exibir a interface.

import { timingSafeEqual } from 'crypto';

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!isAuthorized(req)) return res.status(401).json({ error: 'Senha incorreta.' });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
