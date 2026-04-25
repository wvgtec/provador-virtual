// api/result.js
// SSE: mantém a conexão aberta, faz poll no Redis a cada 1.5s e empurra o resultado quando pronto.
// Substitui o polling do widget — uma única conexão até o job terminar (max 55s).

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function isRateLimited(ip, prefix, maxRequests, windowSeconds) {
  const key = `${prefix}:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count > maxRequests;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const POLL_INTERVAL_MS = 1500;
const MAX_DURATION_MS  = 55000; // 55s — margem antes do timeout do Vercel (60s)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  // 20 conexões SSE por minuto por IP (menor que antes pois cada uma dura até 55s)
  if (await isRateLimited(ip, 'rl:result', 20, 60)) {
    return res.status(429).json({ error: 'Muitas conexões. Aguarde.' });
  }

  const { jobId } = req.query;

  if (!jobId) {
    return res.status(400).json({ error: 'jobId obrigatório' });
  }

  if (!UUID_REGEX.test(jobId)) {
    return res.status(400).json({ error: 'jobId inválido.' });
  }

  // ─── Cabeçalhos SSE ────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // desativa buffer do nginx/Vercel

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Detecta se o cliente fechou a conexão
  let closed = false;
  req.on('close', () => { closed = true; });

  const deadline = Date.now() + MAX_DURATION_MS;

  // ─── Loop de polling interno ───────────────────────────────────────────────
  while (!closed && Date.now() < deadline) {
    const raw = await redis.get(`job:${jobId}`);

    if (!raw) {
      send({ status: 'error', error: 'Job não encontrado ou expirado.' });
      return res.end();
    }

    const job = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (job.status === 'done') {
      send({
        status: 'done',
        resultImage: job.resultImage,
        completedAt: job.completedAt,
      });
      return res.end();
    }

    if (job.status === 'error') {
      send({ status: 'error', error: 'Erro ao processar imagem.' });
      return res.end();
    }

    // pending ou processing: envia heartbeat e aguarda
    send({ status: job.status });

    await sleep(POLL_INTERVAL_MS);
  }

  // Timeout: cliente ficou esperando demais
  if (!closed) {
    send({ status: 'error', error: 'Timeout. Tente novamente.' });
    res.end();
  }
}
