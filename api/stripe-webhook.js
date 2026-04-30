// api/stripe-webhook.js
// Recebe eventos do Stripe e sincroniza plano, status e uso no Redis.
// Chamado diretamente pelo Stripe — não passa pelo QStash.
// IMPORTANTE: lê o body bruto do stream (sem body parser) para verificar a assinatura.

import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import {
  sendInvoicePaidEmail,
  sendInvoiceFailedEmail,
} from './emails.js';

const ADMIN_EMAIL  = process.env.ADMIN_NOTIFY_EMAIL || 'wlissesv@gmail.com';
const RESEND_KEY   = process.env.RESEND_API_KEY;
const APP_URL      = process.env.APP_URL || 'https://app.mirageai.com.br';

async function notifyAdmin(subject, html) {
  if (!RESEND_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Mirage Sistema <pagamentos@mirageai.com.br>',
        to:   [ADMIN_EMAIL],
        subject,
        html,
      }),
    });
  } catch (e) {
    log('webhook_admin_email_error', { error: e.message });
  }
}

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Planos hardcoded como fallback — limites em try-ons por ciclo
const PLAN_LIMITS = {
  starter:    100,
  pro:        500,
  growth:     1000,
  scale:      5000,
  enterprise: Infinity,
};

// ─── Log estruturado ─────────────────────────────────────────────────────────

function log(event, data = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

// ─── Mapeamento priceId → plano ────────────────────────────────────────────
// Configure as variáveis de ambiente no Vercel com os price IDs do Stripe.

function mapPriceToPlan(priceId) {
  const map = {};
  if (process.env.STRIPE_PRICE_STARTER)    map[process.env.STRIPE_PRICE_STARTER]    = 'starter';
  if (process.env.STRIPE_PRICE_PRO)        map[process.env.STRIPE_PRICE_PRO]        = 'pro';
  if (process.env.STRIPE_PRICE_GROWTH)     map[process.env.STRIPE_PRICE_GROWTH]     = 'growth';
  if (process.env.STRIPE_PRICE_SCALE)      map[process.env.STRIPE_PRICE_SCALE]      = 'scale';
  if (process.env.STRIPE_PRICE_ENTERPRISE) map[process.env.STRIPE_PRICE_ENTERPRISE] = 'enterprise';
  return map[priceId] || null;
}

// ─── Leitura do body bruto (necessário para verificar assinatura Stripe) ────

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─── Helpers Redis ────────────────────────────────────────────────────────────

async function getClientKey(stripe, customerId) {
  // Tenta o índice rápido primeiro
  const found = await redis.get(`stripe:customer:${customerId}`);
  if (found) return String(found);

  // Fallback: busca nos metadados do customer no Stripe
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted && customer.metadata?.clientKey) {
      // Reconstrói o índice silenciosamente
      await redis.set(`stripe:customer:${customerId}`, customer.metadata.clientKey);
      return customer.metadata.clientKey;
    }
  } catch (e) {
    log('webhook_customer_lookup_error', { customerId, error: e.message });
  }
  return null;
}

async function getClient(clientKey) {
  const raw = await redis.get(`client:${clientKey}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function saveClient(clientKey, client) {
  await redis.set(`client:${clientKey}`, JSON.stringify(client));
}

// ─── Handlers de evento ────────────────────────────────────────────────────

// invoice.paid — pagamento confirmado: ativa conta e zera contador mensal
async function handleInvoicePaid(stripe, invoice) {
  const clientKey = await getClientKey(stripe, invoice.customer);
  if (!clientKey) {
    log('webhook_invoice_paid_no_client', { customerId: invoice.customer });
    return;
  }

  const client = await getClient(clientKey);
  if (!client) return;

  // Atualiza plano com base na assinatura vinculada à fatura
  // API 2026-04-22: subscription moveu de invoice.subscription para invoice.parent.subscription_details.subscription
  let plan = client.plan || 'starter';
  const subId = invoice.subscription
    || invoice.parent?.subscription_details?.subscription
    || null;
  if (subId) {
    try {
      const sub     = await stripe.subscriptions.retrieve(subId);
      const subItem = sub.items.data[0];
      const priceId = subItem?.price?.id || subItem?.pricing?.price_details?.price || null;
      const mapped  = priceId ? mapPriceToPlan(priceId) : null;
      if (mapped) plan = mapped;
    } catch (e) { /* mantém plano atual se não conseguir ler a assinatura */ }
  }

  client.plan             = plan;
  client.stripeStatus     = 'active';
  client.active           = true;
  client.suspendedReason  = null;
  client.usageCount       = 0;      // reset mensal
  client.extraTryons      = 0;      // extras não acumulam para o próximo mês
  if (subId) client.stripeSubscriptionId = subId;

  // Zera cota, warn80 e flags de suspensão — novo ciclo mensal
  await Promise.all([
    saveClient(clientKey, client),
    redis.set(`usage:${clientKey}`, '0'),
    redis.del(`warn80:${clientKey}`),
  ]);
  log('webhook_invoice_paid', { clientKey, plan });

  // Notificação ao admin — plano ativado
  const valorPago = invoice.amount_paid ? `R$ ${(invoice.amount_paid / 100).toFixed(2).replace('.', ',')}` : '';
  await notifyAdmin(
    `✅ Plano ativado — ${client.name || client.email}`,
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <div style="background:#0a0a0a;padding:20px 28px;border-radius:12px 12px 0 0">
        <img src="${APP_URL}/logo-mirage.png" alt="Mirage" height="28" style="filter:invert(1)">
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px">
        <h2 style="margin:0 0 16px;font-size:18px;color:#16a34a">✅ Plano liberado</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;width:120px">Cliente</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${client.name || '—'}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Email</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px">${client.email || '—'}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Plano</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${plan}</td></tr>
          ${valorPago ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Valor pago</td><td style="padding:8px 0;font-size:13px;font-weight:600;color:#16a34a">${valorPago}</td></tr>` : ''}
        </table>
        <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">
          Acesso ao provador virtual ativado automaticamente.
          <a href="${APP_URL}/painel-admin.html" style="color:#635bff">Ver admin →</a>
        </p>
      </div>
    </div>`
  ).catch(() => {});

  // Email de confirmação de pagamento
  if (client.email) {
    try {
      await sendInvoicePaidEmail({
        name:         client.name  || client.email,
        email:        client.email,
        planName:     plan,
        amount:       invoice.amount_paid || 0,
        invoiceNumber: invoice.number || null,
        periodEnd:    invoice.period_end   || null,
        invoiceUrl:   invoice.hosted_invoice_url || null,
      });
    } catch (e) {
      log('webhook_email_error', { event: 'invoice_paid', error: e.message });
    }
  }
}

// customer.subscription.updated — troca de plano, renovação, inadimplência
async function handleSubscriptionUpdated(stripe, subscription) {
  const clientKey = await getClientKey(stripe, subscription.customer);
  if (!clientKey) {
    log('webhook_sub_updated_no_client', { customerId: subscription.customer });
    return;
  }

  const client = await getClient(clientKey);
  if (!client) return;

  // API 2026-04-22: price pode estar em price.id (antigo) ou pricing.price_details.price (novo)
  const item0   = subscription.items.data[0];
  const priceId = item0?.price?.id || item0?.pricing?.price_details?.price || null;
  const plan    = (priceId ? mapPriceToPlan(priceId) : null) || client.plan || 'starter';

  client.plan                 = plan;
  client.stripeStatus         = subscription.status;
  client.stripeSubscriptionId = subscription.id;
  client.currentPeriodEnd     = subscription.current_period_end;

  // Bloqueia só nos status terminais — past_due tem período de graça
  if (['canceled', 'unpaid'].includes(subscription.status)) {
    client.active = false;
  }
  if (subscription.status === 'active') {
    client.active = true;
  }

  await saveClient(clientKey, client);
  log('webhook_sub_updated', { clientKey, plan, status: subscription.status });
}

// customer.subscription.deleted — assinatura encerrada
async function handleSubscriptionDeleted(stripe, subscription) {
  const clientKey = await getClientKey(stripe, subscription.customer);
  if (!clientKey) {
    log('webhook_sub_deleted_no_client', { customerId: subscription.customer });
    return;
  }

  const client = await getClient(clientKey);
  if (!client) return;

  client.stripeStatus         = 'canceled';
  client.stripeSubscriptionId = subscription.id;
  client.currentPeriodEnd     = subscription.current_period_end;
  client.plan                 = 'starter';
  client.active               = false;

  await saveClient(clientKey, client);
  log('webhook_sub_deleted', { clientKey });
}

// invoice.payment_failed — suspende conta e envia email de aviso
async function handleInvoicePaymentFailed(stripe, invoice) {
  const clientKey = await getClientKey(stripe, invoice.customer);
  if (!clientKey) {
    log('webhook_invoice_failed_no_client', { customerId: invoice.customer });
    return;
  }

  const client = await getClient(clientKey);
  if (!client) return;

  // Suspende a conta
  client.stripeStatus = 'past_due';
  client.active       = false;
  await saveClient(clientKey, client);
  log('webhook_invoice_payment_failed', { clientKey, attempt: invoice.attempt_count });

  // Email de aviso
  if (client.email) {
    try {
      // Tenta descobrir o nome do plano
      let planName = client.plan || 'starter';
      try {
        const planRaw = await redis.get(`plan:${client.plan}`);
        if (planRaw) {
          const p = typeof planRaw === 'string' ? JSON.parse(planRaw) : planRaw;
          planName = p.name || planName;
        }
      } catch (_) {}

      await sendInvoiceFailedEmail({
        name:         client.name  || client.email,
        email:        client.email,
        planName,
        amount:       invoice.amount_due || 0,
        invoiceUrl:   invoice.hosted_invoice_url || null,
        attemptCount: invoice.attempt_count || 1,
      });
    } catch (e) {
      log('webhook_email_error', { event: 'invoice_failed', error: e.message });
    }
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Stripe não configurado.' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });

  // Lê o body bruto antes de qualquer parsing — obrigatório para verificar assinatura
  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Falha ao ler body: ' + e.message });
  }

  // Verifica assinatura Stripe
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    if (!sig) return res.status(400).json({ error: 'stripe-signature ausente.' });
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    log('webhook_signature_error', { error: err.message });
    return res.status(400).json({ error: 'Assinatura inválida: ' + err.message });
  }

  log('webhook_received', { type: event.type, id: event.id });

  try {
    switch (event.type) {
      case 'invoice.paid':
        await handleInvoicePaid(stripe, event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(stripe, event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(stripe, event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(stripe, event.data.object);
        break;

      default:
        // Eventos não tratados são ignorados silenciosamente
        break;
    }

    return res.json({ received: true });
  } catch (err) {
    log('webhook_handler_error', { type: event.type, error: err.message });
    return res.status(500).json({ error: 'Erro interno ao processar evento.' });
  }
}
