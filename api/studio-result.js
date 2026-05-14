// api/studio-result.js
// Polling de status para jobs do Studio (imagem e vídeo).
// GET /api/studio-result?jobId=xxx

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function isRateLimited(ip) {
  const key   = `rl:studio-result:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60);
  return count > 60; // 60 polls por minuto
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (await isRateLimited(ip)) {
    return res.status(429).json({ error: 'Polling muito frequente. Aguarde.' });
  }

  const { jobId } = req.query;

  if (!jobId || !uuidRegex.test(jobId)) {
    return res.status(400).json({ error: 'jobId inválido.' });
  }

  const raw = await redis.get(`studio:job:${jobId}`);
  if (!raw) return res.status(404).json({ error: 'Job não encontrado ou expirado.' });

  const job = typeof raw === 'string' ? JSON.parse(raw) : raw;

  const payload = {
    status: job.status,
    type:   job.type,
    ...(job.status === 'done' && {
      resultImage:  job.resultImage  || null,
      resultVideo:  job.resultVideo  || null,
      completedAt:  job.completedAt,
    }),
    ...(job.status === 'processing' && { startedAt: job.startedAt }),
    ...(job.status === 'pending'    && { createdAt: job.createdAt }),
    ...(job.status === 'error'      && { error: job.error }),
  };

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(payload);
}
