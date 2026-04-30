// api/stripe-admin.js
// Painel financeiro do admin — dados reais do Stripe.
// Retorna: receita do mês, MRR real, pagamentos recentes, assinaturas, gráfico mensal.

import Stripe from 'stripe';
import { timingSafeEqual } from 'crypto';

function safeCompare(a, b) {
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  // Auth via Bearer (mesma senha do admin)
  const adminSecret = process.env.ADMIN_SECRET || '';
  const auth  = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!safeCompare(auth, adminSecret)) return res.status(401).json({ error: 'Não autorizado' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'STRIPE_SECRET_KEY não configurada' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });

  try {
    const now       = new Date();
    const mesInicio = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
    const mesAtual  = now.toISOString().slice(0, 7);

    // ── 1. Balance transactions do mês (receita real recebida) ──────────────
    const [balanceTxns, subscriptions, charges, invoices] = await Promise.all([
      stripe.balanceTransactions.list({
        type:    'charge',
        created: { gte: mesInicio },
        limit:   100,
      }),
      stripe.subscriptions.list({
        status: 'active',
        limit:  100,
        expand: ['data.customer'],
      }),
      stripe.charges.list({
        created: { gte: mesInicio },
        limit:   50,
        expand:  ['data.customer'],
      }),
      stripe.invoices.list({
        created: { gte: mesInicio },
        limit:   50,
        status:  'paid',
      }),
    ]);

    // ── 2. Receita do mês atual ──────────────────────────────────────────────
    const receitaMes = balanceTxns.data.reduce((s, t) => s + t.net, 0) / 100;
    const taxasMes   = balanceTxns.data.reduce((s, t) => s + t.fee, 0) / 100;
    const brutoMes   = balanceTxns.data.reduce((s, t) => s + t.amount, 0) / 100;

    // ── 3. MRR real (soma das assinaturas ativas) ────────────────────────────
    const mrr = subscriptions.data.reduce((s, sub) => {
      const item  = sub.items?.data?.[0];
      const price = item?.price;
      if (!price) return s;
      const amt = price.unit_amount / 100;
      if (price.recurring?.interval === 'year')  return s + amt / 12;
      if (price.recurring?.interval === 'month') return s + amt;
      return s;
    }, 0);

    // ── 4. Pagamentos recentes (últimos 20) ──────────────────────────────────
    const pagamentos = charges.data.slice(0, 20).map(c => ({
      id:       c.id,
      valor:    c.amount / 100,
      liquido:  c.amount_captured ? (c.amount - (c.application_fee_amount || 0)) / 100 : 0,
      status:   c.status,
      reembolsado: c.refunded,
      cliente:  typeof c.customer === 'object'
        ? (c.customer?.name || c.customer?.email || c.customer?.id)
        : c.billing_details?.name || c.billing_details?.email || '—',
      email:    c.billing_details?.email || (typeof c.customer === 'object' ? c.customer?.email : null) || '—',
      descricao: c.description || c.statement_descriptor || '—',
      data:     new Date(c.created * 1000).toLocaleDateString('pt-BR'),
      hora:     new Date(c.created * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      metodo:   c.payment_method_details?.type || '—',
      bandeira: c.payment_method_details?.card?.brand || null,
    }));

    // ── 5. Assinaturas ativas ────────────────────────────────────────────────
    const assinaturas = subscriptions.data.map(sub => {
      const customer = sub.customer;
      const item     = sub.items?.data?.[0];
      const price    = item?.price;
      return {
        id:         sub.id,
        cliente:    typeof customer === 'object' ? (customer.name || customer.email || customer.id) : customer,
        email:      typeof customer === 'object' ? customer.email : '—',
        plano:      price?.nickname || price?.id || '—',
        valor:      price ? price.unit_amount / 100 : 0,
        intervalo:  price?.recurring?.interval || '—',
        status:     sub.status,
        inicio:     new Date(sub.created * 1000).toLocaleDateString('pt-BR'),
        proxima:    sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toLocaleDateString('pt-BR')
          : '—',
        cancelar_ao_fim: sub.cancel_at_period_end,
      };
    });

    // ── 6. Receita dos últimos 6 meses (balanço histórico) ──────────────────
    const meses = [];
    for (let i = 5; i >= 0; i--) {
      const d    = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ini  = Math.floor(d.getTime() / 1000);
      const fim  = Math.floor(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() / 1000);
      meses.push({ label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }), ini, fim, valor: 0 });
    }

    // Busca transações dos últimos 6 meses em paralelo
    const txnsHistorico = await stripe.balanceTransactions.list({
      type:    'charge',
      created: { gte: meses[0].ini },
      limit:   200,
    });

    txnsHistorico.data.forEach(t => {
      const m = meses.find(m => t.created >= m.ini && t.created < m.fim);
      if (m) m.valor += t.net / 100;
    });

    // ── 7. Consolidado ───────────────────────────────────────────────────────
    return res.status(200).json({
      ok: true,
      mesAtual,
      resumo: {
        receitaMes:     Math.round(receitaMes * 100) / 100,
        brutoMes:       Math.round(brutoMes   * 100) / 100,
        taxasMes:       Math.round(taxasMes   * 100) / 100,
        mrr:            Math.round(mrr        * 100) / 100,
        totalPagamentos: charges.data.length,
        assinaturasAtivas: subscriptions.data.length,
        faturasPagas: invoices.data.length,
      },
      pagamentos,
      assinaturas,
      grafico: meses.map(m => ({ label: m.label, valor: Math.round(m.valor * 100) / 100 })),
      currency: 'BRL',
    });

  } catch (err) {
    console.error('[stripe-admin]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
