// api/billing.js
// Faturamento do cliente: resumo, faturas, checkout Stripe, portal Stripe.
// Se STRIPE_SECRET_KEY não estiver definido, retorna dados mock / Redis only.

import { Redis } from '@upstash/redis';
import { timingSafeEqual, scryptSync } from 'crypto';
import Stripe from 'stripe';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const PLAN_LIMITS = {
  starter:    { limit: 100,      price: 49,   overage: 0.75 },
  pro:        { limit: 500,      price: 149,  overage: 0.40 },
  growth:     { limit: 1000,     price: 249,  overage: 0.20 },
  scale:      { limit: 5000,     price: 749,  overage: 0.10 },
  enterprise: { limit: Infinity, price: 2499, overage: 0    },
};

// Stripe — ativo somente se a chave estiver configurada
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' })
  : null;

function safeCompare(a, b) {
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch { return false; }
}

function verifyPassword(input, stored) {
  if (!stored || !input) return false;
  // Formato scrypt: "salt:hash"
  if (stored.includes(':') && stored.length > 60) {
    try {
      const [salt, hash] = stored.split(':');
      const inputHash = scryptSync(String(input), salt, 64).toString('hex');
      return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(inputHash, 'hex'));
    } catch { return false; }
  }
  // Legado: secret base64url
  return safeCompare(input, stored);
}

function isValidClientKey(key) {
  return typeof key === 'string' && /^pvk_[a-f0-9]{32}$/.test(key);
}

async function authenticate(clientKey, password) {
  if (!clientKey || !isValidClientKey(clientKey)) return null;
  if (!password || typeof password !== 'string') return null;
  const raw = await redis.get(`client:${clientKey}`);
  if (!raw) return null;
  const client = typeof raw === 'string' ? JSON.parse(raw) : raw;
  // Billing é sempre permitido — cliente precisa ver faturas e pagar mesmo suspenso
  const stored = client.passwordHash || client.secret || '';
  if (!verifyPassword(password, stored)) return null;
  return client;
}

const PLAN_NAMES = { starter:'Starter', pro:'Pro', growth:'Growth', scale:'Scale', enterprise:'Enterprise' };

async function getPlanLimits(planId) {
  // Tenta buscar plano customizado do Redis por ID exato
  const raw = await redis.get(`plan:${planId}`).catch(() => null);
  if (raw) {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { name: p.name || planId, limit: p.tryons === 0 ? Infinity : (Number(p.tryons) || 100), price: Number(p.price) || 0, overage: Number(p.overage) || 0 };
  }
  // Se nao encontrou por ID exato, varre o indice de planos buscando por nome
  try {
    const ids = await redis.smembers('plans:index').catch(() => []);
    if (ids && ids.length) {
      const raws = await Promise.all(ids.map(id => redis.get(`plan:${id}`).catch(() => null)));
      for (const r of raws) {
        if (!r) continue;
        const p = typeof r === 'string' ? JSON.parse(r) : r;
        if (
          p.id === planId ||
          p.name?.toLowerCase().replace(/[^a-z0-9]/g, '') === planId?.toLowerCase().replace(/[^a-z0-9]/g, '')
        ) {
          return { name: p.name || planId, limit: p.tryons === 0 ? Infinity : (Number(p.tryons) || 100), price: Number(p.price) || 0, overage: Number(p.overage) || 0 };
        }
      }
    }
  } catch (_) {}
  // Fallback para planos hardcoded
  const fp = PLAN_LIMITS[planId] ?? PLAN_LIMITS.starter;
  return { name: PLAN_NAMES[planId] || planId, ...fp };
}

async function calcBilling(client) {
  const plan       = await getPlanLimits(client.plan || 'starter');
  const extraTryons = Number(client.extraTryons) || 0;
  const baseLimit  = plan.limit;
  const totalLimit = baseLimit === Infinity ? Infinity : baseLimit + extraTryons;
  const usage      = Number(client.usageCount) || 0;
  const excess     = totalLimit === Infinity ? 0 : Math.max(0, usage - totalLimit);
  const overageAmt = +(excess * plan.overage).toFixed(2);
  const total      = +(plan.price + overageAmt).toFixed(2);
  return { planName: plan.name, planPrice: plan.price, limit: totalLimit, overage: plan.overage, usage, excess, overageAmt, total };
}

// Gera data da próxima cobrança (5 de cada mês)
function nextBillingDate() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + (now.getDate() >= 5 ? 1 : 0), 5);
  return next.toISOString().split('T')[0];
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, clientKey, password, ...params } = req.body || {};

  const client = await authenticate(clientKey, password);
  if (!client) return res.status(401).json({ error: 'Credenciais inválidas.' });

  const stripeEnabled = !!stripe;

  try {
    // SUMMARY — resumo de billing do mês atual
    if (action === 'summary') {
      const billing = await calcBilling(client);
      const nextDate = nextBillingDate();

      let paymentMethod = null;
      let subscriptionStatus = 'active';

      if (stripe && client.stripeCustomerId) {
        try {
          const methods = await stripe.paymentMethods.list({
            customer: client.stripeCustomerId,
            type: 'card',
            limit: 1,
          });
          if (methods.data.length) {
            const pm   = methods.data[0];
            const card = pm.card;
            paymentMethod = { id: pm.id, brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year };
          }
          const subs = await stripe.subscriptions.list({ customer: client.stripeCustomerId, limit: 1 });
          if (subs.data.length) subscriptionStatus = subs.data[0].status;
        } catch (e) {
          console.warn('[billing] Stripe summary error:', e.message);
        }
      }

      // Redis é a fonte da verdade — se o admin suspendeu, prevalece sobre o Stripe
      if (!client.active) {
        subscriptionStatus = client.suspendedReason === 'quota_exceeded'
          ? 'quota_exceeded'
          : 'suspended';
      }

      return res.json({
        ok: true,
        stripeEnabled,
        plan:       client.plan || 'starter',
        active:     !!client.active,
        suspendedReason: client.suspendedReason || null,
        ...billing,
        nextDate,
        paymentMethod,
        subscriptionStatus,
      });
    }

    // INVOICES — lista faturas
    if (action === 'invoices') {
      if (stripe && client.stripeCustomerId) {
        const invoices = await stripe.invoices.list({
          customer: client.stripeCustomerId,
          limit: 24,
        });
        const items = invoices.data.map(inv => ({
          id:        inv.id,
          number:    inv.number,
          date:      new Date(inv.created * 1000).toISOString().split('T')[0],
          amount:    +(inv.amount_due / 100).toFixed(2),
          amountPaid: +(inv.amount_paid / 100).toFixed(2),
          status:    inv.status,
          pdfUrl:    inv.invoice_pdf,
          hostedUrl: inv.hosted_invoice_url,
          periodStart: inv.period_start ? new Date(inv.period_start * 1000).toISOString().split('T')[0] : null,
          periodEnd:   inv.period_end   ? new Date(inv.period_end   * 1000).toISOString().split('T')[0] : null,
          lines: inv.lines?.data?.map(l => ({
            description: l.description,
            amount: +(l.amount / 100).toFixed(2),
          })) || [],
        }));
        return res.json({ ok: true, invoices: items });
      }

      // Sem Stripe: gera histórico mock baseado em Redis
      const billing = await calcBilling(client);
      const mock = [];
      const now = new Date();
      for (let i = 0; i < 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 5);
        mock.push({
          id:      `mock_${i}`,
          number:  null,
          date:    d.toISOString().split('T')[0],
          amount:  billing.total,
          amountPaid: i === 0 ? 0 : billing.total,
          status:  i === 0 ? 'pending' : 'paid',
          pdfUrl:  null,
          hostedUrl: null,
          periodStart: new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().split('T')[0],
          periodEnd:   new Date(d.getFullYear(), d.getMonth(), 0).toISOString().split('T')[0],
          lines: [
            { description: `Plano ${client.plan || 'starter'}`, amount: billing.planPrice },
            ...(billing.overageAmt > 0 ? [{ description: `${billing.excess} gerações excedentes × $${billing.overage}`, amount: billing.overageAmt }] : []),
          ],
        });
      }
      return res.json({ ok: true, invoices: mock, isMock: true });
    }

    // Helper: garante customer Stripe e mantém o índice stripe:customer: → clientKey
    async function ensureCustomer() {
      if (client.stripeCustomerId) {
        // Garante que o índice existe (migração silenciosa)
        await redis.set(`stripe:customer:${client.stripeCustomerId}`, clientKey);
        return client.stripeCustomerId;
      }
      const customer = await stripe.customers.create({
        email: client.email, name: client.name, metadata: { clientKey },
      });
      client.stripeCustomerId = customer.id;
      await Promise.all([
        redis.set(`client:${clientKey}`, JSON.stringify(client)),
        redis.set(`stripe:customer:${customer.id}`, clientKey),
      ]);
      return customer.id;
    }

    const pubKey = process.env.STRIPE_PUBLISHABLE_KEY || '';

    // SETUP_INTENT — salvar/trocar cartão inline
    if (action === 'setup_intent') {
      if (!stripe) return res.status(503).json({ error: 'Stripe não configurado.' });
      const customerId = await ensureCustomer();
      const si = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
      });
      return res.json({ ok: true, clientSecret: si.client_secret, publishableKey: pubKey });
    }

    // PAY_INVOICE — pagar fatura inline
    if (action === 'pay_invoice') {
      if (!stripe) return res.status(503).json({ error: 'Stripe não configurado.' });
      const { invoiceId } = params;
      const customerId = await ensureCustomer();

      // Fatura real do Stripe
      if (invoiceId && !invoiceId.startsWith('mock_')) {
        const inv = await stripe.invoices.retrieve(invoiceId);
        if (inv.payment_intent) {
          const pi = await stripe.paymentIntents.retrieve(inv.payment_intent);
          return res.json({ ok: true, clientSecret: pi.client_secret, publishableKey: pubKey, amount: inv.amount_due / 100 });
        }
      }

      // Sem fatura real: cria PaymentIntent avulso com boleto + cartão
      const billing = await calcBilling(client);
      const amountCents = Math.round(billing.total * 100) || 100;
      const pi = await stripe.paymentIntents.create({
        amount:   amountCents,
        currency: 'brl',
        customer: customerId,
        payment_method_types: ['card', 'boleto'],
        metadata: { clientKey, plan: client.plan || 'starter' },
      });
      return res.json({ ok: true, clientSecret: pi.client_secret, publishableKey: pubKey, amount: billing.total });
    }

    // PAYMENT_LINK — cria link de pagamento Stripe (boleto / pix / cartão)
    if (action === 'payment_link') {
      if (!stripe) return res.status(503).json({ error: 'Stripe não configurado.' });
      const { invoiceId } = params;

      // Se tem fatura real com hosted URL, retorna direto
      if (invoiceId && !invoiceId.startsWith('mock_')) {
        try {
          const inv = await stripe.invoices.retrieve(invoiceId);
          if (inv.hosted_invoice_url) {
            return res.json({ ok: true, url: inv.hosted_invoice_url });
          }
        } catch (e) { /* continua */ }
      }

      // Cria payment link avulso
      const customerId2 = await ensureCustomer();
      const billing = await calcBilling(client);
      const amountCents = Math.round(billing.total * 100) || 100;
      const product = await stripe.products.create({
        name: `Mirage Provador Virtual — ${client.plan || 'starter'}`,
      });
      const price = await stripe.prices.create({
        unit_amount: amountCents,
        currency:    'brl',
        product:     product.id,
      });
      const link = await stripe.paymentLinks.create({
        line_items: [{ price: price.id, quantity: 1 }],
        customer_creation: 'always',
        metadata: { clientKey },
      });
      return res.json({ ok: true, url: link.url });
    }

    // PAY_WITH_SAVED — paga fatura usando o cartão já salvo e ativa a conta imediatamente
    if (action === 'pay_with_saved') {
      if (!stripe) return res.status(503).json({ error: 'Stripe não configurado.' });
      const { invoiceId } = params;
      if (!invoiceId) return res.status(400).json({ error: 'invoiceId obrigatório.' });
      if (!client.stripeCustomerId) return res.json({ ok: false, error: 'Nenhum cliente Stripe associado.' });
      try {
        // Busca o payment method do customer
        const methods = await stripe.paymentMethods.list({
          customer: client.stripeCustomerId,
          type: 'card',
          limit: 1,
        });
        if (!methods.data.length) return res.json({ ok: false, error: 'Nenhum cartão cadastrado.' });
        const pmId = methods.data[0].id;

        // Define como default no customer
        await stripe.customers.update(client.stripeCustomerId, {
          invoice_settings: { default_payment_method: pmId },
        });

        // Paga a fatura
        const inv = await stripe.invoices.pay(invoiceId, { payment_method: pmId });

        if (inv.paid) {
          // ── Ativa a conta IMEDIATAMENTE — não espera o webhook ──────────────
          client.active       = true;
          client.stripeStatus = 'active';
          client.usageCount   = 0;
          await Promise.all([
            redis.set(`client:${client.key}`, JSON.stringify(client)),
            redis.set(`usage:${client.key}`, '0'),
          ]);

          // Notificação ao admin
          const RESEND_KEY   = process.env.RESEND_API_KEY;
          const ADMIN_EMAIL  = process.env.ADMIN_NOTIFY_EMAIL || 'wlissesv@gmail.com';
          const APP_URL      = process.env.APP_URL || 'https://app.mirageai.com.br';
          const valorPago    = `R$ ${(inv.amount_paid / 100).toFixed(2).replace('.', ',')}`;
          if (RESEND_KEY) {
            fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from:    'Mirage Sistema <pagamentos@mirageai.com.br>',
                to:      [ADMIN_EMAIL],
                subject: `✅ Pagamento recebido — ${client.name || client.email}`,
                html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
                  <div style="background:#0a0a0a;padding:20px 28px;border-radius:12px 12px 0 0">
                    <img src="${APP_URL}/logo-mirage.png" alt="Mirage" height="28" style="filter:invert(1)">
                  </div>
                  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px">
                    <h2 style="margin:0 0 16px;font-size:18px;color:#16a34a">✅ Plano ativado automaticamente</h2>
                    <table style="width:100%;border-collapse:collapse">
                      <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;width:120px">Cliente</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${client.name || '—'}</td></tr>
                      <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Email</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px">${client.email || '—'}</td></tr>
                      <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Plano</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${client.plan || '—'}</td></tr>
                      <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Valor pago</td><td style="padding:8px 0;font-size:13px;font-weight:600;color:#16a34a">${valorPago}</td></tr>
                    </table>
                    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">
                      Acesso liberado automaticamente. <a href="${APP_URL}/painel-admin.html" style="color:#635bff">Ver admin →</a>
                    </p>
                  </div>
                </div>`,
              }),
            }).catch(() => {});
          }
        }

        return res.json({ ok: true, status: inv.status, paid: inv.paid });
      } catch (e) {
        return res.json({ ok: false, error: e.message });
      }
    }

    // ── OVERAGE — Gerações excedentes ─────────────────────────────────────────

    // OVERAGE_INFO — retorna dados para a calculadora no painel
    if (action === 'overage_info') {
      const billing     = await calcBilling(client);
      const planData    = await getPlanLimits(client.plan || 'starter');
      const extraTryons = Number(client.extraTryons) || 0;
      return res.json({
        ok:           true,
        plan:         client.plan || 'starter',
        planName:     planData.name,
        limit:        planData.limit,
        extraTryons,
        totalLimit:   planData.limit === Infinity ? Infinity : planData.limit + extraTryons,
        usage:        billing.usage,
        overageRate:  planData.overage,
        hasSavedCard: !!(stripe && client.stripeCustomerId),
      });
    }

    // BUY_OVERAGE_SAVED — compra gerações extras com cartão salvo
    if (action === 'buy_overage_saved') {
      if (!stripe) return res.status(503).json({ error: 'Stripe não configurado.' });
      const { quantity } = params;
      const qty = parseInt(quantity);
      if (!qty || qty < 1 || qty > 10000) return res.status(400).json({ error: 'Quantidade inválida (1–10.000).' });

      const planData   = await getPlanLimits(client.plan || 'starter');
      const overageRate = planData.overage;
      if (!overageRate) return res.status(400).json({ error: 'Este plano não possui cobrança por excedente.' });

      const amountBRL   = +(qty * overageRate).toFixed(2);
      const amountCents = Math.round(amountBRL * 100);

      // Busca e define payment method padrão
      const methods = await stripe.paymentMethods.list({ customer: client.stripeCustomerId, type: 'card', limit: 1 });
      if (!methods.data.length) return res.json({ ok: false, error: 'Nenhum cartão cadastrado.' });
      const pmId = methods.data[0].id;
      await stripe.customers.update(client.stripeCustomerId, { invoice_settings: { default_payment_method: pmId } });

      // Cria e confirma PaymentIntent
      const pi = await stripe.paymentIntents.create({
        amount:   amountCents,
        currency: 'brl',
        customer: client.stripeCustomerId,
        payment_method: pmId,
        confirm:  true,
        description: `Mirage — ${qty} gerações excedentes (${planData.name})`,
        metadata: { clientKey: client.key, type: 'overage', quantity: String(qty) },
        off_session: true,
      });

      if (pi.status === 'succeeded') {
        const newExtra = (Number(client.extraTryons) || 0) + qty;
        client.extraTryons     = newExtra;
        client.active          = true;   // reativa conta suspensa por cota
        client.suspendedReason = null;
        await redis.set(`client:${client.key}`, JSON.stringify(client));

        // Notifica admin
        const RESEND_KEY  = process.env.RESEND_API_KEY;
        const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'wlissesv@gmail.com';
        const APP_URL     = process.env.APP_URL || 'https://app.mirageai.com.br';
        if (RESEND_KEY) {
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from:    'Mirage Sistema <pagamentos@mirageai.com.br>',
              to:      [ADMIN_EMAIL],
              subject: `💳 Excedente comprado — ${client.name || client.email} — ${qty} gerações`,
              html: `<div style="font-family:sans-serif;max-width:520px">
                <div style="background:#0a0a0a;padding:20px 28px;border-radius:12px 12px 0 0">
                  <img src="${APP_URL}/logo-mirage.png" alt="Mirage" height="28" style="filter:invert(1)">
                </div>
                <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px">
                  <h2 style="margin:0 0 16px;font-size:18px;color:#635bff">💳 Gerações extras compradas</h2>
                  <table style="width:100%;border-collapse:collapse">
                    <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;width:140px">Cliente</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${client.name || '—'}</td></tr>
                    <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Email</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px">${client.email || '—'}</td></tr>
                    <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Plano</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px">${planData.name}</td></tr>
                    <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Qtde extra</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${qty} gerações</td></tr>
                    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Valor cobrado</td><td style="padding:8px 0;font-size:13px;font-weight:600;color:#635bff">R$ ${amountBRL.toFixed(2).replace('.',',')}</td></tr>
                  </table>
                  <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Novo limite total: ${planData.limit + newExtra} tryons · <a href="${APP_URL}/painel-admin.html" style="color:#635bff">Ver admin →</a></p>
                </div>
              </div>`,
            }),
          }).catch(() => {});
        }
        return res.json({ ok: true, quantity: qty, amountBRL, newExtraTryons: newExtra });
      }

      return res.json({ ok: false, error: `Pagamento não confirmado (${pi.status}). Tente novamente.` });
    }

    // BUY_OVERAGE_INTENT — cria PaymentIntent para cobrar gerações extras com cartão novo
    if (action === 'buy_overage_intent') {
      if (!stripe) return res.status(503).json({ error: 'Stripe não configurado.' });
      const { quantity } = params;
      const qty = parseInt(quantity);
      if (!qty || qty < 1 || qty > 10000) return res.status(400).json({ error: 'Quantidade inválida (1–10.000).' });

      const planData    = await getPlanLimits(client.plan || 'starter');
      const overageRate = planData.overage;
      if (!overageRate) return res.status(400).json({ error: 'Este plano não possui cobrança por excedente.' });

      const amountCents = Math.round(qty * overageRate * 100);
      const customerId  = await ensureCustomer();

      const pi = await stripe.paymentIntents.create({
        amount:   amountCents,
        currency: 'brl',
        customer: customerId,
        description: `Mirage — ${qty} gerações excedentes (${planData.name})`,
        metadata: { clientKey: client.key, type: 'overage', quantity: String(qty) },
      });

      return res.json({ ok: true, clientSecret: pi.id ? pi.client_secret : null,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '', amountBRL: +(qty * overageRate).toFixed(2) });
    }

    // ACTIVATE_OVERAGE — ativa conta após pagamento de gerações extras com cartão novo
    if (action === 'activate_overage') {
      if (!stripe) return res.status(503).json({ error: 'Stripe não configurado.' });
      const { quantity, paymentIntentId } = params;
      const qty = parseInt(quantity);
      if (!qty || !paymentIntentId) return res.status(400).json({ error: 'quantity e paymentIntentId obrigatórios.' });

      // Verifica se o PaymentIntent foi realmente pago
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status !== 'succeeded') {
        return res.json({ ok: false, error: `Pagamento não confirmado (${pi.status}).` });
      }

      const newExtra = (Number(client.extraTryons) || 0) + qty;
      client.extraTryons     = newExtra;
      client.active          = true;
      client.suspendedReason = null;
      await redis.set(`client:${client.key}`, JSON.stringify(client));

      // Notifica admin
      const RESEND_KEY  = process.env.RESEND_API_KEY;
      const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'wlissesv@gmail.com';
      const APP_URL     = process.env.APP_URL || 'https://app.mirageai.com.br';
      const planData    = await getPlanLimits(client.plan || 'starter');
      const amountBRL   = (pi.amount_received / 100).toFixed(2).replace('.', ',');
      if (RESEND_KEY) {
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from:    'Mirage Sistema <pagamentos@mirageai.com.br>',
            to:      [ADMIN_EMAIL],
            subject: `✅ Excedente pago — ${client.name || client.email} — ${qty} gerações`,
            html: `<div style="font-family:sans-serif;max-width:520px">
              <div style="background:#0a0a0a;padding:20px 28px;border-radius:12px 12px 0 0">
                <img src="${APP_URL}/logo-mirage.png" alt="Mirage" height="28" style="filter:invert(1)">
              </div>
              <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px">
                <h2 style="margin:0 0 16px;font-size:18px;color:#16a34a">✅ Gerações extras pagas — plano reativado</h2>
                <table style="width:100%;border-collapse:collapse">
                  <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;width:120px">Cliente</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${client.name || '—'}</td></tr>
                  <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Plano</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px">${planData.name}</td></tr>
                  <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px">Qtde extra</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${qty} gerações</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Valor</td><td style="padding:8px 0;font-size:13px;font-weight:600;color:#16a34a">R$ ${amountBRL}</td></tr>
                </table>
                <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Novo limite: ${planData.limit + newExtra} tryons · <a href="${APP_URL}/painel-admin.html" style="color:#635bff">Ver admin →</a></p>
              </div>
            </div>`,
          }),
        }).catch(() => {});
      }
      return res.json({ ok: true, quantity: qty, newExtraTryons: newExtra });
    }

    // DECLINE_OVERAGE — cliente recusou ambas opções: suspende conta e notifica admin
    if (action === 'decline_overage') {
      client.active = false;
      await redis.set(`client:${client.key}`, JSON.stringify(client));

      const RESEND_KEY  = process.env.RESEND_API_KEY;
      const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'wlissesv@gmail.com';
      const APP_URL     = process.env.APP_URL || 'https://app.mirageai.com.br';
      if (RESEND_KEY) {
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from:    'Mirage Sistema <pagamentos@mirageai.com.br>',
            to:      [ADMIN_EMAIL],
            subject: `⚠️ Plano suspenso — ${client.name || client.email} recusou excedente`,
            html: `<div style="font-family:sans-serif;max-width:520px">
              <div style="background:#0a0a0a;padding:20px 28px;border-radius:12px 12px 0 0">
                <img src="${APP_URL}/logo-mirage.png" alt="Mirage" height="28" style="filter:invert(1)">
              </div>
              <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px">
                <h2 style="margin:0 0 12px;font-size:18px;color:#dc2626">⚠️ Plano suspenso</h2>
                <p style="font-size:14px;color:#374151;margin:0 0 16px">${client.name || client.email} atingiu o limite do plano e recusou comprar excedente e fazer upgrade.</p>
                <p style="font-size:12px;color:#9ca3af">Conta suspensa automaticamente. <a href="${APP_URL}/painel-admin.html" style="color:#635bff">Reativar no admin →</a></p>
              </div>
            </div>`,
          }),
        }).catch(() => {});
      }
      return res.json({ ok: true, suspended: true });
    }

    // REMOVE_CARD — desvincula o cartão salvo do cliente
    if (action === 'remove_card') {
      if (!stripe) return res.status(503).json({ error: 'Stripe não configurado.' });
      const { paymentMethodId } = params;
      if (!paymentMethodId) return res.status(400).json({ error: 'paymentMethodId obrigatório.' });
      try {
        await stripe.paymentMethods.detach(paymentMethodId);
        return res.json({ ok: true });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    return res.status(400).json({ error: 'Ação inválida.' });

  } catch (err) {
    console.error('[billing] Erro:', err);
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}