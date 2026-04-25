// api/submit.js
// Recebe a requisição do widget, salva as imagens no Redis e envia só o jobId para a fila.
// O processamento real (Vertex AI) acontece em api/process.js chamado pelo QStash.

import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { Client as QStashClient } from '@upstash/qstash';
import { randomUUID } from 'crypto';

const PROJECT_ID = 'provador-virtual-494213';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Rate limit: máximo 5 requests por IP a cada 60 segundos
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '60 s'),
  prefix: 'rl:submit',
});

const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN });

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ─── Rate limiting por IP ────────────────────────────────────────────────────
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  const { success, limit, remaining, reset } = await ratelimit.limit(ip);

  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', reset);

  if (!success) {
    return res.status(429).json({
      error: 'Muitas requisições. Aguarde alguns segundos e tente novamente.',
    });
  }

  try {
    const { personImage, garmentImage, category, clientKey } = req.body;

    if (!personImage || !garmentImage) {
      return res.status(400).json({ error: 'personImage e garmentImage são obrigatórios' });
    }

    // ─── Validação de clientKey (obrigatória fora do demo) ───────────────────
    let clientDomain = null;

    if (clientKey) {
      const raw = await redis.get(`client:${clientKey}`);
      if (!raw) {
        return res.status(403).json({ error: 'Chave de cliente inválida.' });
      }
      const client = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!client.active) {
        return res.status(403).json({ error: 'Acesso suspenso. Entre em contato com o suporte.' });
      }

      // Valida o domínio de origem contra o domínio cadastrado no cliente
      if (client.store) {
        const origin = req.headers.origin || req.headers.referer || '';
        const allowed = client.store.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const incoming = origin.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
        if (incoming && allowed && !incoming.endsWith(allowed)) {
          return res.status(403).json({ error: 'Origem não autorizada para esta chave.' });
        }
        clientDomain = allowed;
      }

      // Incremento atômico — sem race condition em alta concorrência
      await redis.incr(`usage:${clientKey}`);

      // Mantém usageCount sincronizado no objeto principal (leitura eventual)
      const usageTotal = await redis.get(`usage:${clientKey}`);
      await redis.set(
        `client:${clientKey}`,
        JSON.stringify({ ...client, usageCount: Number(usageTotal) || 0 })
      );
    } else {
      // Sem clientKey: modo demo — rate limit mais restrito (2 por minuto por IP)
      const demoLimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(2, '60 s'),
        prefix: 'rl:demo',
      });
      const demoCheck = await demoLimit.limit(ip);
      if (!demoCheck.success) {
        return res.status(429).json({ error: 'Limite do modo demo atingido. Aguarde.' });
      }
    }

    const jobId = randomUUID();

    // Salva as imagens no Redis — o QStash tem limite de 1MB por mensagem,
    // então as imagens ficam aqui e o process.js as busca pelo jobId
    await redis.set(
      `job:${jobId}`,
      JSON.stringify({
        status: 'pending',
        createdAt: Date.now(),
        projectId: PROJECT_ID,
        personImage,
        garmentImage,
        category: category || 'auto',
        clientKey: clientKey || null,
      }),
      { ex: 3600 }
    );

    // Envia só o jobId para a fila — mensagem pequena, sem imagens
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
    return res.status(500).json({ error: 'Erro interno ao criar job', detail: err.message });
  }
}
