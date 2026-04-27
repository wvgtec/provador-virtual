// api/submit.js
// Recebe a requisição do widget, valida cliente, lead e cria job na fila.
// Imagens chegam como URLs do GCS — nunca mais base64 no Redis.

import { Redis } from '@upstash/redis';
import { Client as QStashClient } from '@upstash/qstash';
import { randomUUID, createHash } from 'crypto';
import { sendQuotaWarningEmail, sendQuotaSuspendedEmail } from './emails.js';

const PROJECT_ID       = 'provador-virtual-494213';
const VALID_CATEGORIES = ['tops', 'bottoms', 'one-pieces', 'auto'];

// ─── Planos e limites ─────────────────────────────────────────────────────────
const PLAN_LIMITS = {
  starter:    100,
  pro:        500,
  growth:     1000,
  scale:      5000,
  enterprise: Infinity,
};

const redis  = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN });

function log(event, data = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

async function isRateLimited(ip, prefix, maxRequests, windowSeconds) {
  const key = `${prefix}:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count > maxRequests;
}

function isValidClientKey(key) {
  return typeof key === 'string' && /^pvk_[a-f0-9]{32}$/.test(key);
}

function isSafeUrl(value) {
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fc00:|fd)/.test(host)) return false;
    return true;
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  const {
    personImageUrl,  // URL do GCS — obrigatório
    garmentImage,    // URL da peça (loja ou GCS)
    garmentImageUrl, // alias para garmentImage
    category,
    clientKey,
    lead,            // { name, email, whatsapp }
    productUrl,      // URL da página do produto (analytics)
    productName,     // Título da página do produto
  } = req.body || {};

  // ─── clientKey obrigatório ────────────────────────────────────────────────
  if (!clientKey || !isValidClientKey(clientKey)) {
    return res.status(400).json({ error: 'clientKey obrigatório.' });
  }

  if (await isRateLimited(ip, 'rl:client', 20, 60)) {
    return res.status(429).json({ error: 'Muitas requisições. Aguarde alguns segundos.' });
  }

  // ─── Rate limit por clientKey (além do IP) ────────────────────────────────
  const rlCkKey   = `rl:ck:${clientKey}:${Math.floor(Date.now() / 60000)}`;
  const rlCkCount = await redis.incr(rlCkKey);
  if (rlCkCount === 1) await redis.expire(rlCkKey, 60);
  if (rlCkCount > 20) {
    return res.status(429).json({ error: 'Limite por chave atingido. Aguarde 1 minuto.' });
  }

  const raw = await redis.get(`client:${clientKey}`);
  if (!raw) return res.status(403).json({ error: 'Chave de cliente inválida.' });
  const client = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!client.active) return res.status(403).json({ error: 'Acesso suspenso. Entre em contato com o suporte.' });

  // ─── Status Stripe — defesa extra (webhook pode estar atrasado) ───────────
  if (client.stripeSubscriptionId && ['canceled', 'unpaid'].includes(client.stripeStatus)) {
    return res.status(403).json({
      error:    'Assinatura inativa. Acesse o painel para regularizar.',
      code:     'SUBSCRIPTION_INACTIVE',
      stripeStatus: client.stripeStatus,
    });
  }

  // ─── Validação de domínio (obrigatória quando store está configurado) ────────
  // Origin é sempre enviado pelo browser em requests cross-origin.
  // Ausência de Origin com store configurado = request server-side suspeito.
  if (client.store) {
    const origin = req.headers.origin || req.headers.referer || '';
    const normalize = (s) =>
      s.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0].replace(/^www\./, '');
    const allowed = normalize(client.store);
    if (!origin) {
      log('submit_origin_missing', { clientKey, ip });
      return res.status(403).json({ error: 'Origem obrigatória para esta chave.' });
    }
    const incoming  = normalize(origin);
    const isAllowed = incoming === allowed || incoming.endsWith('.' + allowed);
    if (allowed && !isAllowed) {
      log('submit_origin_blocked', { clientKey, incoming, allowed });
      return res.status(403).json({ error: 'Origem não autorizada para esta chave.' });
    }
  }

  // ─── Imagens ──────────────────────────────────────────────────────────────
  const finalPersonUrl  = personImageUrl;
  const finalGarmentUrl = garmentImageUrl || garmentImage;

  if (!finalPersonUrl || !finalPersonUrl.startsWith('https://storage.googleapis.com/')) {
    return res.status(400).json({ error: 'personImageUrl inválida. Use /api/upload-url primeiro.' });
  }
  if (!finalGarmentUrl) {
    return res.status(400).json({ error: 'garmentImage obrigatório.' });
  }
  if (!isSafeUrl(finalGarmentUrl)) {
    return res.status(400).json({ error: 'URL da peça não permitida.' });
  }

  // ─── Lead (opcional — pode ser enviado depois via /api/save-lead) ─────────
  const leadName     = lead?.name?.trim()     || '';
  const leadEmail    = lead?.email?.trim()    || '';
  const leadWhatsapp = lead?.whatsapp?.trim() || '';
  const hasLead      = !!(leadName && leadEmail && leadWhatsapp);

  if (hasLead && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadEmail)) {
    return res.status(400).json({ error: 'Formato de email inválido.' });
  }

  const safeCategory    = VALID_CATEGORIES.includes(category) ? category : 'auto';
  const finalProductUrl = productUrl || finalGarmentUrl;

  // ─── Hash para cache por par (pessoa, roupa) ──────────────────────────────
  const garmentHash = createHash('sha256')
    .update(finalPersonUrl + '|' + finalGarmentUrl)
    .digest('hex');

  // Verifica cache antes de criar job — retorno imediato sem chamar Vertex
  const cached = await redis.get(`cache:${garmentHash}`);
  if (cached) {
    log('submit_cache_hit', { clientKey });
    return res.status(200).json({
      jobId:       `cached_${garmentHash.slice(0, 8)}`,
      status:      'done',
      cached:      true,
      resultImage: cached,
      message:     'Resultado recuperado do cache.',
    });
  }

  // ─── Cota atômica — sem race condition ───────────────────────────────────
  // Garante que usage:${clientKey} existe e não está atrás do objeto do cliente.
  // Necessário para clientes criados antes da cota atômica ou após reset de billing.
  // Limite base do plano + gerações extras compradas
  const planLimit = (PLAN_LIMITS[client.plan] ?? PLAN_LIMITS.starter) + (Number(client.extraTryons) || 0);
  const rawUsage  = await redis.get(`usage:${clientKey}`);
  if (rawUsage === null || Number(rawUsage) < Number(client.usageCount || 0)) {
    await redis.set(`usage:${clientKey}`, String(Number(client.usageCount) || 0));
  }

  // INCR é atômico: apenas um request ganha o slot exato do limite.
  const newCount = await redis.incr(`usage:${clientKey}`);
  const APP_URL  = process.env.APP_URL || 'https://app.mirageai.com.br';
  const panelUrl = `${APP_URL}/painel-cliente.html`;

  if (newCount > planLimit) {
    // Reverte o incremento e rejeita — nenhum job é criado
    await redis.decr(`usage:${clientKey}`);

    // ── Suspende e notifica UMA vez (evita spam) ─────────────────────────────
    const wasAlreadySuspended = client.suspendedReason === 'quota_exceeded';
    if (!wasAlreadySuspended) {
      const suspended = { ...client, active: false, suspendedReason: 'quota_exceeded' };
      await redis.set(`client:${clientKey}`, JSON.stringify(suspended));

      const planName = client.plan || 'starter';
      const clientName = client.name || client.email || clientKey;

      // Email ao CLIENTE — plano suspenso
      if (client.email) {
        sendQuotaSuspendedEmail({
          name:     clientName,
          email:    client.email,
          planName,
          usage:    planLimit,
          limit:    planLimit,
          panelUrl,
        }).catch(e => log('email_quota_suspended_error', { error: e.message }));
      }

      // Email ao ADMIN
      const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'wlissesv@gmail.com';
      const RESEND_KEY  = process.env.RESEND_API_KEY;
      if (RESEND_KEY) {
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from:    'Mirage Sistema <pagamentos@mirageai.com.br>',
            to:      [ADMIN_EMAIL],
            subject: `🔴 Plano bloqueado — ${clientName} atingiu a cota`,
            html: `<div style="font-family:sans-serif;max-width:520px">
              <div style="background:#0a0a0a;padding:20px 28px;border-radius:12px 12px 0 0">
                <img src="${APP_URL}/logo-mirage.png" alt="Mirage" height="28" style="filter:invert(1)">
              </div>
              <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px">
                <h2 style="margin:0 0 16px;font-size:18px;color:#dc2626">🔴 Plano suspenso automaticamente</h2>
                <table style="width:100%;border-collapse:collapse">
                  <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;width:120px">Cliente</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${clientName}</td></tr>
                  <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Email</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px">${client.email || '—'}</td></tr>
                  <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Plano</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${planName}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Limite</td><td style="padding:8px 0;font-size:13px;font-weight:600;color:#dc2626">${planLimit} tryons esgotados</td></tr>
                </table>
                <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">
                  Cliente notificado por email. <a href="${APP_URL}/painel-admin.html" style="color:#635bff">Ver no admin →</a>
                </p>
              </div>
            </div>`,
          }),
        }).catch(() => {});
      }

      log('submit_quota_exceeded_suspended', { clientKey, plan: client.plan, limit: planLimit });
    } else {
      log('submit_quota_exceeded_already_suspended', { clientKey });
    }

    return res.status(429).json({
      error:     `Limite do plano atingido (${planLimit} tryons). Acesse seu painel para regularizar.`,
      code:      'QUOTA_EXCEEDED',
      limit:     planLimit,
      usage:     newCount - 1,
      plan:      client.plan || 'starter',
      panelUrl,
      suspended: true,
    });
  }

  // ── Atualiza uso e salva ───────────────────────────────────────────────────
  await redis.set(`client:${clientKey}`, JSON.stringify({ ...client, usageCount: newCount }));

  // ── Alerta de 80% da cota (enviado uma única vez por ciclo) ───────────────
  const warn80Threshold = Math.ceil(planLimit * 0.8);
  if (newCount >= warn80Threshold && newCount < planLimit && client.email) {
    const warn80Key  = `warn80:${clientKey}`;
    const alreadySent = await redis.get(warn80Key);
    if (!alreadySent) {
      // TTL de 35 dias — cobre um ciclo mensal inteiro
      await redis.set(warn80Key, '1', { ex: 35 * 86400 });
      const planName = client.plan || 'starter';
      sendQuotaWarningEmail({
        name:     client.name || client.email,
        email:    client.email,
        planName,
        usage:    newCount,
        limit:    planLimit,
        panelUrl: `${APP_URL}/painel-cliente.html`,
      }).catch(e => log('email_warn80_error', { error: e.message }));
      log('submit_warn80_sent', { clientKey, usage: newCount, limit: planLimit });
    }
  }

  // Contador diário para rate limit e analytics por dia
  const dayKey   = `usage:${clientKey}:${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const dayCount = await redis.incr(dayKey);
  if (dayCount === 1) await redis.expire(dayKey, 86400);

  // ─── Cria job — só metadados, sem imagens inline ──────────────────────────
  const jobId    = randomUUID();
  const now      = Date.now();

  await Promise.all([
    redis.set(
      `job:${jobId}`,
      JSON.stringify({
        status:          'pending',
        createdAt:       now,
        projectId:       PROJECT_ID,
        personImageUrl:  finalPersonUrl,
        garmentImageUrl: finalGarmentUrl,
        category:        safeCategory,
        clientKey,
        lead:            hasLead ? { name: leadName, email: leadEmail, whatsapp: leadWhatsapp } : null,
        productUrl:      finalProductUrl,
        productName:     productName ? String(productName).slice(0, 200) : '',
        hash:            garmentHash,  // usado pelo process.js para salvar cache
      }),
      { ex: 3600 }
    ),
    // Índice global por cliente (O(log n))
    redis.zadd(`jobs:${clientKey}`, { score: now, member: jobId }),
    redis.expire(`jobs:${clientKey}`, 60 * 60 * 24 * 90),
    // Índice por status — permite filtrar sem scan em memória
    redis.zadd(`jobs:${clientKey}:pending`, { score: now, member: jobId }),
    redis.expire(`jobs:${clientKey}:pending`, 60 * 60 * 24 * 90),
  ]);

  await qstash.publishJSON({
    url:     process.env.WORKER_URL || `${process.env.APP_URL}/api/process`,
    body:    { jobId },
    retries: 3,
  });

  log('submit_job_created', { jobId, clientKey, category: safeCategory });
  return res.status(202).json({
    jobId,
    status:  'pending',
    message: 'Job criado. Use /api/result?jobId=' + jobId + ' para acompanhar.',
  });
}
