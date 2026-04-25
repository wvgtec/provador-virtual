// api/submit.js
// Recebe a requisição do widget, salva as imagens no Redis e envia só o jobId para a fila.
// O processamento real (Vertex AI) acontece em api/process.js chamado pelo QStash.

import { Redis } from '@upstash/redis';
import { Client as QStashClient } from '@upstash/qstash';
import { randomUUID } from 'crypto';

const PROJECT_ID = 'provador-virtual-494213';

// Tamanho máximo aceito para imagens em base64 (~2MB → ~1.5MB de imagem real)
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;

// Categorias permitidas
const VALID_CATEGORIES = ['tops', 'bottoms', 'one-pieces', 'auto'];

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN });

async function isRateLimited(ip, prefix, maxRequests, windowSeconds) {
  const key = `${prefix}:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count > maxRequests;
}

function isValidClientKey(key) {
  return typeof key === 'string' && /^pvk_[a-f0-9]{32}$/.test(key);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  try {
    const { personImage, garmentImage, category, clientKey } = req.body;

    // ─── Validação de campos obrigatórios ────────────────────────────────────
    if (!personImage || !garmentImage) {
      return res.status(400).json({ error: 'personImage e garmentImage são obrigatórios' });
    }

    // ─── Validação de tamanho de imagem ──────────────────────────────────────
    if (personImage.length > MAX_IMAGE_SIZE) {
      return res.status(413).json({ error: 'Foto da pessoa muito grande. Máximo 2MB.' });
    }
    if (garmentImage.length > MAX_IMAGE_SIZE) {
      return res.status(413).json({ error: 'Foto da peça muito grande. Máximo 2MB.' });
    }

    // ─── Sanitização de category ─────────────────────────────────────────────
    const safeCategory = VALID_CATEGORIES.includes(category) ? category : 'auto';

    // ─── Validação de clientKey ───────────────────────────────────────────────
    if (clientKey) {
      if (!isValidClientKey(clientKey)) {
        return res.status(400).json({ error: 'Formato de chave inválido.' });
      }

      // Cliente com chave: 20 requests por minuto por IP
      if (await isRateLimited(ip, 'rl:client', 20, 60)) {
        return res.status(429).json({ error: 'Muitas requisições. Aguarde alguns segundos.' });
      }

      const raw = await redis.get(`client:${clientKey}`);
      if (!raw) {
        return res.status(403).json({ error: 'Chave de cliente inválida.' });
      }
      const client = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!client.active) {
        return res.status(403).json({ error: 'Acesso suspenso. Entre em contato com o suporte.' });
      }

      // Valida domínio de origem contra o store cadastrado
      if (client.store) {
        const origin = req.headers.origin || req.headers.referer || '';
        const allowed = client.store.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const incoming = origin.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
        if (incoming && allowed && !incoming.endsWith(allowed)) {
          return res.status(403).json({ error: 'Origem não autorizada para esta chave.' });
        }
      }

      // Incremento atômico do contador de uso
      await redis.incr(`usage:${clientKey}`);
      const usageTotal = await redis.get(`usage:${clientKey}`);
      const clientObj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      await redis.set(
        `client:${clientKey}`,
        JSON.stringify({ ...clientObj, usageCount: Number(usageTotal) || 0 })
      );

    } else {
      // Modo demo (sem chave): 2 requests por minuto por IP
      if (await isRateLimited(ip, 'rl:demo', 2, 60)) {
        return res.status(429).json({ error: 'Limite do modo demo atingido. Aguarde 1 minuto.' });
      }
    }

    const jobId = randomUUID();

    await redis.set(
      `job:${jobId}`,
      JSON.stringify({
        status: 'pending',
        createdAt: Date.now(),
        projectId: PROJECT_ID,
        personImage,
        garmentImage,
        category: safeCategory,
        clientKey: clientKey || null,
      }),
      { ex: 3600 }
    );

    const callbackUrl = `${process.env.APP_URL}/api/process`;

    await qstash.publishJSON({
      url: callbackUrl,
      body: { jobId },
      retries: 3,
    });

    return res.status(202).json({
      jobId,
      status: 'pending',
      message: 'Job criado. Use /api/result?jobId=' + jobId + ' para acompanhar.',
    });

  } catch (err) {
    console.error('[submit] Erro:', err);
    return res.status(500).json({ error: 'Erro interno ao criar job.' });
  }
}
