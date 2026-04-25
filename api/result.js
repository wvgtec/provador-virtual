// api/result.js
// Consultado pelo widget via polling para verificar o status do job.
// Retorna: pending | processing | done (+ imagem) | error

import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Rate limit: máximo 30 polls por IP por minuto (1 a cada 2s por até 5 jobs simultâneos)
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '60 s'),
  prefix: 'rl:result',
});

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ─── Rate limiting por IP ────────────────────────────────────────────────────
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  const { success } = await ratelimit.limit(ip);
  if (!success) {
    return res.status(429).json({ error: 'Polling muito frequente. Aguarde.' });
  }

  const { jobId } = req.query;

  if (!jobId) {
    return res.status(400).json({ error: 'jobId obrigatório' });
  }

  // Valida formato UUID para evitar enumeração
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(jobId)) {
    return res.status(400).json({ error: 'jobId inválido.' });
  }

  const raw = await redis.get(`job:${jobId}`);

  if (!raw) {
    return res.status(404).json({ error: 'Job não encontrado ou expirado' });
  }

  const job = typeof raw === 'string' ? JSON.parse(raw) : raw;

  res.setHeader('Cache-Control', 'no-store');

  return res.status(200).json(job);
}
