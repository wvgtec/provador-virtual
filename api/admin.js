// api/admin.js
// Endpoints protegidos para gerenciar clientes do Provador Virtual.
// Requer header: Authorization: Bearer {ADMIN_SECRET}

import { Redis } from '@upstash/redis';
import { randomBytes } from 'crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function authorized(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${secret}`;
}

function generateKey() {
  return 'pvk_' + randomBytes(12).toString('hex');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!authorized(req)) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const { action } = req.method === 'GET' ? req.query : req.body;

  try {
    // ── Listar todos os clientes ──────────────────────────────────────────────
    if (req.method === 'GET' && action === 'list') {
      const raw = await redis.get('clients:index');
      const keys = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];

      const clients = await Promise.all(
        keys.map(async (key) => {
          const data = await redis.get(`client:${key}`);
          if (!data) return null;
          const client = typeof data === 'string' ? JSON.parse(data) : data;
          return { key, ...client };
        })
      );

      return res.status(200).json({ clients: clients.filter(Boolean) });
    }

    // ── Criar novo cliente ────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'create') {
      const { name, email, store, plan } = req.body;
      if (!name || !email) {
        return res.status(400).json({ error: 'name e email são obrigatórios' });
      }

      const key = generateKey();
      const client = {
        name,
        email,
        store: store || '',
        plan: plan || 'starter',
        active: true,
        usageCount: 0,
        createdAt: Date.now(),
      };

      await redis.set(`client:${key}`, JSON.stringify(client));

      // Adiciona à lista de índice
      const raw = await redis.get('clients:index');
      const keys = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      keys.push(key);
      await redis.set('clients:index', JSON.stringify(keys));

      return res.status(201).json({ key, ...client });
    }

    // ── Ativar / Desativar cliente ────────────────────────────────────────────
    if (req.method === 'POST' && action === 'toggle') {
      const { key } = req.body;
      if (!key) return res.status(400).json({ error: 'key é obrigatório' });

      const raw = await redis.get(`client:${key}`);
      if (!raw) return res.status(404).json({ error: 'Cliente não encontrado' });

      const client = typeof raw === 'string' ? JSON.parse(raw) : raw;
      client.active = !client.active;
      await redis.set(`client:${key}`, JSON.stringify(client));

      return res.status(200).json({ key, active: client.active });
    }

    // ── Deletar cliente ───────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'delete') {
      const { key } = req.body;
      if (!key) return res.status(400).json({ error: 'key é obrigatório' });

      await redis.del(`client:${key}`);

      const raw = await redis.get('clients:index');
      const keys = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      const updated = keys.filter((k) => k !== key);
      await redis.set('clients:index', JSON.stringify(updated));

      return res.status(200).json({ deleted: key });
    }

    return res.status(400).json({ error: 'Ação inválida' });

  } catch (err) {
    console.error('[admin] Erro:', err);
    return res.status(500).json({ error: 'Erro interno', detail: err.message });
  }
}
