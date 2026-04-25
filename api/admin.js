// api/admin.js
// Gerencia clientes do Provador Virtual via Redis (Upstash).
// CORS tratado globalmente pelo vercel.json — sem headers CORS aqui para evitar duplicatas.

import { Redis } from '@upstash/redis';
import { randomBytes, timingSafeEqual } from 'crypto';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function generateKey() {
  return 'pvk_' + randomBytes(16).toString('hex');
}

function generateSecret() {
  return randomBytes(20).toString('base64url'); // ~27 chars, URL-safe
}

function getSecret(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

// Comparação segura contra timing attack
function safeCompare(a, b) {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// Rate limiting simples via Redis
async function isRateLimited(ip, prefix, maxRequests, windowSeconds) {
  const key = `${prefix}:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count > maxRequests;
}

// Validação de formato de chave pvk_
function isValidClientKey(key) {
  return typeof key === 'string' && /^pvk_[a-f0-9]{32}$/.test(key);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ─── Rate limiting no admin: 10 tentativas por minuto por IP ─────────────
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (await isRateLimited(ip, 'rl:admin', 10, 60)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 1 minuto.' });
  }

  // ─── Autenticação com comparação segura ──────────────────────────────────
  const secret = getSecret(req);
  const expected = process.env.ADMIN_SECRET || '';
  if (!secret || !safeCompare(secret, expected)) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }

  const action = req.query.action || req.body?.action;

  try {
    // LIST
    if (action === 'list') {
      // Usa SCAN em vez de KEYS para não bloquear o Redis em bases grandes
      const redisKeys = [];
      let cursor = 0;
      do {
        const [nextCursor, keys] = await redis.scan(cursor, { match: 'client:*', count: 100 });
        cursor = Number(nextCursor);
        redisKeys.push(...keys);
      } while (cursor !== 0);
      if (!redisKeys.length) return res.json({ clients: [] });
      const raws = await Promise.all(redisKeys.map(k => redis.get(k)));
      const clients = raws
        .map((r, i) => {
          const obj = typeof r === 'string' ? JSON.parse(r) : r;
          if (!obj) return null;
          if (!obj.key) obj.key = redisKeys[i].replace('client:', '');
          return obj;
        })
        .filter(Boolean)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      return res.json({ clients });
    }

    // CREATE
    if (action === 'create') {
      const { name, email, store, plan } = req.body || {};
      if (!name || !email) return res.status(400).json({ error: 'name e email são obrigatórios' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Formato de email inválido.' });
      const key    = generateKey();
      const secret = generateSecret();
      const client = {
        key, secret, name, email,
        store: store || '',
        plan: plan || 'starter',
        active: true,
        usageCount: 0,
        createdAt: Date.now(),
      };
      await redis.set(`client:${key}`, JSON.stringify(client));
      // Retorna o secret apenas neste momento — não é recuperável depois
      return res.status(201).json({ ok: true, key, secret, client });
    }

    // TOGGLE
    if (action === 'toggle') {
      const { key } = req.body || {};
      if (!key) return res.status(400).json({ error: 'key é obrigatório' });
      if (!isValidClientKey(key)) return res.status(400).json({ error: 'Formato de key inválido.' });
      const raw = await redis.get(`client:${key}`);
      if (!raw) return res.status(404).json({ error: 'Cliente não encontrado' });
      const client = typeof raw === 'string' ? JSON.parse(raw) : raw;
      client.active = !client.active;
      await redis.set(`client:${key}`, JSON.stringify(client));
      return res.json({ ok: true, active: client.active });
    }

    // DELETE
    if (action === 'delete') {
      const { key } = req.body || {};
      if (!key) return res.status(400).json({ error: 'key é obrigatório' });
      if (!isValidClientKey(key)) return res.status(400).json({ error: 'Formato de key inválido.' });
      await redis.del(`client:${key}`);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Ação inválida.' });

  } catch (err) {
    console.error('[admin] Erro:', err);
    return res.status(500).json({ error: 'Erro interno no servidor.' });
  }
}
