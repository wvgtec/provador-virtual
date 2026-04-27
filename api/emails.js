// api/emails.js
// Módulo central de envio de emails via Resend.
// Usado pelo webhook do Stripe e pelo admin para notificações automáticas.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM           = 'Mirage <pagamentos@mirageai.com.br>';
const APP_URL        = process.env.APP_URL || 'https://mirageai.com.br';

async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('[emails] RESEND_API_KEY não configurada — email não enviado:', subject);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[emails] Falha Resend:', data?.message || JSON.stringify(data));
  } else {
    console.log('[emails] Enviado:', subject, '→', to, '| id:', data.id);
  }
  return data;
}

// ─── Componentes de layout ────────────────────────────────────────────────────

function emailLayout(content) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F9FC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FC;padding:32px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #E6E8EC;overflow:hidden">

        <!-- Header -->
        <tr>
          <td style="background:#0A0A0A;padding:24px 32px;text-align:center">
            <img src="${APP_URL}/logo-mirage.png" alt="Mirage" height="32" style="filter:invert(1);display:block;margin:0 auto">
          </td>
        </tr>

        <!-- Body -->
        <tr><td style="padding:32px">${content}</td></tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F7F9FC;border-top:1px solid #E6E8EC;padding:16px 32px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9CA3AF">
              Mirage AI · <a href="https://mirageai.com.br" style="color:#9CA3AF">mirageai.com.br</a><br>
              Você recebeu este email por ser cliente Mirage.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function btn(url, text, color = '#0A0A0A') {
  return `<a href="${url}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;font-size:15px;margin:16px 0">${text}</a>`;
}

function infoRow(label, value) {
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #F3F4F6;font-size:13px;color:#6B7280;width:140px">${label}</td>
    <td style="padding:8px 0;border-bottom:1px solid #F3F4F6;font-size:13px;color:#111;font-weight:500">${value}</td>
  </tr>`;
}

function fmtBRL(cents) {
  return 'R$ ' + (cents / 100).toFixed(2).replace('.', ',');
}

// ─── Templates ────────────────────────────────────────────────────────────────

// 1. Boas-vindas — enviado quando o admin cadastra um cliente
export async function sendWelcomeEmail({ name, email, planName, invoiceUrl, clientPortalUrl }) {
  const hasInvoice = !!invoiceUrl;
  const html = emailLayout(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0A0A0A">Bem-vindo ao Mirage, ${name}! 👋</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#6B7280;line-height:1.6">
      Sua conta foi criada com o plano <strong style="color:#0A0A0A">${planName}</strong>.
      ${hasInvoice ? 'Para ativar seu acesso, efetue o pagamento abaixo.' : 'Seu acesso está ativo — bom proveito!'}
    </p>
    ${hasInvoice ? `
      <div style="background:#FFF9C4;border:1px solid #FFE34E;border-radius:10px;padding:16px;margin-bottom:24px">
        <p style="margin:0;font-size:14px;color:#713F12;font-weight:500">
          ⏳ Seu plano será ativado assim que o pagamento for confirmado.
        </p>
      </div>
      ${btn(invoiceUrl, 'Pagar agora →', '#635BFF')}
    ` : ''}
    ${clientPortalUrl ? `<p style="margin:16px 0 0;font-size:13px;color:#6B7280">
      Acesse seu painel: <a href="${clientPortalUrl}" style="color:#635BFF">${clientPortalUrl}</a>
    </p>` : ''}
  `);

  return sendEmail({
    to: email,
    subject: `Bem-vindo ao Mirage — ${hasInvoice ? 'Fatura aguardando pagamento' : 'Conta ativada'}`,
    html,
  });
}

// 2. Fatura paga — enviado quando invoice.paid
export async function sendInvoicePaidEmail({ name, email, planName, amount, invoiceNumber, periodEnd, invoiceUrl }) {
  const html = emailLayout(`
    <div style="text-align:center;margin-bottom:28px">
      <div style="display:inline-block;background:#DCFCE7;border-radius:50%;padding:16px;margin-bottom:12px">
        <span style="font-size:32px">✅</span>
      </div>
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0A0A0A">Pagamento confirmado</h2>
      <p style="margin:0;font-size:15px;color:#6B7280">Obrigado, ${name}! Seu acesso está ativo.</p>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      ${infoRow('Plano', planName)}
      ${infoRow('Valor pago', fmtBRL(amount))}
      ${invoiceNumber ? infoRow('Fatura', `#${invoiceNumber}`) : ''}
      ${periodEnd ? infoRow('Próxima cobrança', new Date(periodEnd * 1000).toLocaleDateString('pt-BR')) : ''}
    </table>

    ${invoiceUrl ? btn(invoiceUrl, 'Ver fatura', '#16A34A') : ''}
    <p style="margin:16px 0 0;font-size:13px;color:#6B7280;line-height:1.5">
      Se tiver dúvidas sobre sua cobrança, responda este email ou acesse
      <a href="https://mirageai.com.br" style="color:#635BFF">mirageai.com.br</a>.
    </p>
  `);

  return sendEmail({
    to: email,
    subject: `✅ Pagamento confirmado — ${planName} — ${fmtBRL(amount)}`,
    html,
  });
}

// 3. Fatura pendente/falha — enviado quando invoice.payment_failed
export async function sendInvoiceFailedEmail({ name, email, planName, amount, invoiceUrl, attemptCount }) {
  const isFirst = attemptCount <= 1;
  const html = emailLayout(`
    <div style="text-align:center;margin-bottom:28px">
      <div style="display:inline-block;background:#FEF2F2;border-radius:50%;padding:16px;margin-bottom:12px">
        <span style="font-size:32px">⚠️</span>
      </div>
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0A0A0A">
        ${isFirst ? 'Fatura com pagamento pendente' : 'Nova tentativa de cobrança falhou'}
      </h2>
      <p style="margin:0;font-size:15px;color:#6B7280">
        Olá ${name}, não conseguimos processar o pagamento do seu plano.
      </p>
    </div>

    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:16px;margin-bottom:24px">
      <p style="margin:0;font-size:14px;color:#991B1B;font-weight:500">
        🔒 Seu acesso foi suspenso até a regularização do pagamento.
      </p>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      ${infoRow('Plano', planName)}
      ${infoRow('Valor', fmtBRL(amount))}
      ${attemptCount > 1 ? infoRow('Tentativa', `${attemptCount}ª`) : ''}
    </table>

    ${invoiceUrl ? btn(invoiceUrl, 'Pagar agora →', '#DC2626') : ''}

    <p style="margin:16px 0 0;font-size:13px;color:#6B7280;line-height:1.5">
      Após o pagamento seu acesso é restaurado automaticamente.
      Em caso de dúvidas, responda este email.
    </p>
  `);

  return sendEmail({
    to: email,
    subject: `⚠️ Ação necessária — Fatura pendente Mirage ${planName}`,
    html,
  });
}

// 4. Trial encerrando — enviado 3 dias antes do fim do trial
export async function sendTrialEndingEmail({ name, email, trialEndsAt, planName, invoiceUrl }) {
  const diasRestantes = Math.ceil((trialEndsAt - Date.now()) / 86400000);
  const html = emailLayout(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0A0A0A">
      Seu período de teste termina em ${diasRestantes} ${diasRestantes === 1 ? 'dia' : 'dias'}
    </h2>
    <p style="margin:0 0 24px;font-size:15px;color:#6B7280;line-height:1.6">
      Olá ${name}! Seu trial do Mirage se encerra em
      <strong>${new Date(trialEndsAt).toLocaleDateString('pt-BR')}</strong>.
      Após essa data, sua conta migra automaticamente para o plano
      <strong style="color:#0A0A0A">${planName}</strong>.
    </p>
    <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:16px;margin-bottom:24px">
      <p style="margin:0;font-size:14px;color:#0369A1">
        💡 Sua cobrança só acontece ao final do trial. Cancele a qualquer momento antes disso.
      </p>
    </div>
    ${invoiceUrl ? btn(invoiceUrl, 'Ver detalhes do plano', '#635BFF') : ''}
  `);

  return sendEmail({
    to: email,
    subject: `⏰ Seu trial Mirage termina em ${diasRestantes} ${diasRestantes === 1 ? 'dia' : 'dias'}`,
    html,
  });
}

// 5. Upgrade de trial para plano pago — enviado quando trial expira
export async function sendTrialUpgradeEmail({ name, email, planName, amount, invoiceUrl }) {
  const html = emailLayout(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0A0A0A">Seu trial expirou</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#6B7280;line-height:1.6">
      Olá ${name}! Seu período gratuito encerrou. Geramos uma fatura de
      <strong style="color:#0A0A0A">${fmtBRL(amount)}</strong>
      para o plano <strong>${planName}</strong>.
    </p>
    <div style="background:#FFF9C4;border:1px solid #FFE34E;border-radius:10px;padding:16px;margin-bottom:24px">
      <p style="margin:0;font-size:14px;color:#713F12;font-weight:500">
        ⏳ Seu acesso continua ativo por 48h. Efetue o pagamento para não ser suspenso.
      </p>
    </div>
    ${btn(invoiceUrl, 'Pagar agora →', '#635BFF')}
  `);

  return sendEmail({
    to: email,
    subject: `Mirage — Trial expirado · Fatura ${fmtBRL(amount)} aguardando`,
    html,
  });
}
