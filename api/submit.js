// api/submit.js
// Recebe a requisição do widget, cria um job na fila e retorna o jobId imediatamente.
// O processamento real (Vertex AI) acontece em api/process.js chamado pelo QStash.

import { Redis } from '@upstash/redis';
import { Client as QStashClient } from '@upstash/qstash';
import { randomUUID } from 'crypto';

// 🔧 ALTERAR: Project ID do Google Cloud
const PROJECT_ID = 'meu-projeto-tryon';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN });

export default async function handler(req, res) {
  // CORS — permite chamadas do widget em qualquer domínio
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { personImage, garmentImage, category } = req.body;

    if (!personImage || !garmentImage) {
      return res.status(400).json({ error: 'personImage e garmentImage são obrigatórios' });
    }

    // Gera ID único para este job
    const jobId = randomUUID();

    // Salva o job no Redis com status inicial "pending"
    // TTL de 1 hora — jobs antigos são descartados automaticamente
    await redis.set(
      `job:${jobId}`,
      JSON.stringify({
        status: 'pending',
        createdAt: Date.now(),
        projectId: PROJECT_ID,
      }),
      { ex: 3600 }
    );

    // Envia para a fila QStash — ele vai chamar /api/process com os dados do job
    // O QStash garante entrega mesmo que o worker esteja ocupado
    const callbackUrl = `${process.env.VERCEL_URL || process.env.APP_URL}/api/process`;

    await qstash.publishJSON({
      url: callbackUrl,
      body: {
        jobId,
        personImage,   // base64 da foto da pessoa
        garmentImage,  // URL ou base64 da roupa
        category: category || 'auto',
        projectId: PROJECT_ID,
      },
      // Retry automático: tenta até 3x com backoff exponencial em caso de falha
      retries: 3,
    });

    // Retorna o jobId imediatamente — o widget vai fazer polling em /api/result
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
