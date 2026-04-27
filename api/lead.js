// api/lead.js
// Recebe leads dos formulários da página e envia por email via Resend.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, phone, shop, volume, source } = req.body;

  if (!name && !phone) {
    return res.status(400).json({ error: 'nome ou telefone é obrigatório' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY não configurada' });
  }

  const origem = source === 'demo'
    ? '📋 Formulário de Demonstração'
    : '💬 Modal de Contato';

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #eee; border-radius: 12px; overflow: hidden;">
      <div style="background: #0a0a0a; padding: 24px 32px; display: flex; align-items: center; gap: 12px;">
        <img src="https://www.mirageai.com.br/logo-mirage.png" alt="Mirage" style="height: 32px; filter: invert(1);" />
        <span style="color: #FFE34E; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;">Novo Lead</span>
      </div>
      <div style="padding: 28px 32px;">
        <p style="margin: 0 0 6px; font-size: 12px; color: #999; text-transform: uppercase; letter-spacing: 0.06em;">Origem</p>
        <p style="margin: 0 0 24px; font-size: 15px; font-weight: 600; color: #111;">${origem}</p>

        <table style="width: 100%; border-collapse: collapse;">
          ${name ? `
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 12px; color: #999; width: 120px; text-transform: uppercase; letter-spacing: 0.05em;">Nome</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 15px; color: #111; font-weight: 500;">${name}</td>
          </tr>` : ''}
          ${phone ? `
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 12px; color: #999; text-transform: uppercase; letter-spacing: 0.05em;">Telefone</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 15px; color: #111; font-weight: 500;"><a href="https://wa.me/55${phone.replace(/\D/g,'')}" style="color: #25D366;">${phone} (WhatsApp)</a></td>
          </tr>` : ''}
          ${shop ? `
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 12px; color: #999; text-transform: uppercase; letter-spacing: 0.05em;">Loja</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 15px; color: #111; font-weight: 500;">${shop}</td>
          </tr>` : ''}
          ${volume ? `
          <tr>
            <td style="padding: 10px 0; font-size: 12px; color: #999; text-transform: uppercase; letter-spacing: 0.05em;">Volume</td>
            <td style="padding: 10px 0; font-size: 15px; color: #111; font-weight: 500;">${volume}</td>
          </tr>` : ''}
        </table>
      </div>
      <div style="background: #f9f9f9; padding: 16px 32px; border-top: 1px solid #f0f0f0;">
        <p style="margin: 0; font-size: 11px; color: #bbb;">Enviado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · Mirage AI · mirageai.com.br</p>
      </div>
    </div>
  `;

  try {
    const payload = {
      from: 'Mirage <leads@mirageai.com.br>',
      to: [process.env.LEAD_EMAIL || 'wlissesv@gmail.com'],
      subject: `Novo lead Mirage — ${name || phone || 'Sem nome'}`,
      html: htmlBody,
    };

    console.log('[lead] Enviando para Resend:', JSON.stringify({ to: payload.to, subject: payload.subject }));

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const sendData = await sendRes.json();

    if (!sendRes.ok) {
      throw new Error(sendData.message || 'Erro ao enviar via Resend');
    }

    return res.status(200).json({ status: 'sent', id: sendData.id });

  } catch (err) {
    console.error('[lead] Erro Resend:', err);
    return res.status(500).json({ error: 'Erro ao enviar email', detail: err.message });
  }
}
