// api/studio-video.js
// Recebe sourceJobId (jobId da imagem gerada) + videoPrompt,
// enfileira job de vídeo no QStash para o Cloud Run processar com Veo 3.

import { Redis } from '@upstash/redis';
import { Client as QStashClient } from '@upstash/qstash';
import { randomUUID, timingSafeEqual } from 'crypto';

const redis   = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const qstash  = new QStashClient({ token: process.env.QSTASH_TOKEN });
const APP_URL = process.env.APP_URL || 'https://provador-virtual-brown.vercel.app';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  if (!isAuthorized(req)) return res.status(401).json({ error: 'Não autorizado.' });

  const { sourceJobId, videoPrompt } = req.body || {};

  if (!sourceJobId || !uuidRegex.test(sourceJobId)) {
    return res.status(400).json({ error: 'sourceJobId inválido.' });
  }
  if (!videoPrompt || typeof videoPrompt !== 'string' || videoPrompt.length < 5 || videoPrompt.length > 500) {
    return res.status(400).json({ error: 'videoPrompt deve ter entre 5 e 500 caracteres.' });
  }

  // Confirma que a imagem de origem existe e está pronta
  const raw = await redis.get(`studio:job:${sourceJobId}`);
  if (!raw) return res.status(404).json({ error: 'Job de imagem não encontrado ou expirado.' });

  const sourceJob = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (sourceJob.status !== 'done' || !sourceJob.resultImage) {
    return res.status(400).json({ error: 'Imagem de origem não está pronta.' });
  }

  const jobId     = randomUUID();
  const createdAt = Date.now();

  const WORKER_URL = process.env.WORKER_URL || `${APP_URL}/process`;

  await redis.set(`studio:job:${jobId}`, JSON.stringify({
    jobId, type: 'video', status: 'pending',
    prompt: sourceJob.prompt, garmentUrl: sourceJob.garmentUrl,
    resultImage: sourceJob.resultImage, resultVideo: null,
    videoPrompt, sourceJobId, error: null,
    createdAt, startedAt: null, completedAt: null,
  }), { ex: 172800 }); // 48h

  await qstash.publishJSON({
    url:  WORKER_URL,
    body: { jobId },
  });

  console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'studio_video_enqueued', jobId, sourceJobId }));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ jobId, status: 'pending' });
}
