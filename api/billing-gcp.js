// api/billing-gcp.js
// Consulta custos do GCP via BigQuery Billing Export.
// Usa a mesma service account já configurada no projeto (GOOGLE_SERVICE_ACCOUNT).
//
// Retorna:
//   - custos do mês atual por serviço (Vertex AI, GCS, etc.)
//   - créditos disponíveis/utilizados
//   - totais bruto, créditos e líquido

const PROJECT_ID = 'provador-virtual-494213';
const DATASET    = 'billing_export';

// ─── Autenticação via Service Account JWT ────────────────────────────────────
async function getAccessToken(sa) {
  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/bigquery.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const header  = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payload = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signing = `${header}.${payload}`;

  const pemBody = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const keyBuf  = Buffer.from(pemBody, 'base64');

  const privateKey = await crypto.subtle.importKey(
    'pkcs8', keyBuf,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', privateKey,
    new TextEncoder().encode(signing)
  );
  const sig = Buffer.from(sigBuf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${signing}.${sig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Falha ao obter access token: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

// ─── Executa query no BigQuery ────────────────────────────────────────────────
async function queryBigQuery(token, sql) {
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: sql,
        useLegacySql: false,
        timeoutMs: 15000,
        location: 'southamerica-east1',
      }),
    }
  );

  const data = await res.json();

  // Erro HTTP direto
  if (!res.ok) {
    const msg = data.error?.message || JSON.stringify(data);
    throw new Error(msg);
  }

  // Erro dentro do job (retorna 200 mas com errorResult)
  const jobErr = data.status?.errorResult;
  if (jobErr) throw new Error(jobErr.message || JSON.stringify(jobErr));

  if (!data.jobComplete) throw new Error('Query ainda não completou (timeout)');

  const fields = data.schema?.fields?.map(f => f.name) || [];
  const rows   = (data.rows || []).map(row =>
    Object.fromEntries(fields.map((f, i) => [f, row.f[i]?.v ?? null]))
  );
  return rows;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Autenticação — aceita Bearer token (mesmo padrão do /api/admin)
  const adminPass = process.env.ADMIN_SECRET;
  if (adminPass) {
    const auth   = req.headers['authorization'] || '';
    const token  = auth.replace(/^Bearer\s+/i, '').trim();
    if (token !== adminPass) return res.status(401).json({ error: 'Não autorizado' });
  }

  const saEnv = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!saEnv) return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT não configurada' });

  try {
    const sa    = JSON.parse(saEnv);
    const token = await getAccessToken(sa);
    const table = `\`${PROJECT_ID}.${DATASET}.gcp_billing_export_v1_*\``;

    // ── Query 1: Custo bruto + créditos por serviço ─────────────────────────
    const costSql = `
      SELECT
        service.description                                      AS service,
        ROUND(SUM(cost), 4)                                      AS custo_bruto,
        ROUND(IFNULL(SUM((
          SELECT SUM(c.amount) FROM UNNEST(credits) c
        )), 0), 4)                                               AS creditos_aplicados,
        ROUND(SUM(cost) + IFNULL(SUM((
          SELECT SUM(c.amount) FROM UNNEST(credits) c
        )), 0), 4)                                               AS custo_liquido,
        currency
      FROM ${table}
      WHERE DATE(usage_start_time) >= DATE_TRUNC(CURRENT_DATE(), MONTH)
      GROUP BY service, currency
      ORDER BY custo_bruto DESC
      LIMIT 20
    `;

    // ── Query 2: Créditos disponíveis (saldo restante) ──────────────────────
    const creditSql = `
      SELECT
        c.name  AS nome,
        c.type  AS tipo,
        ROUND(SUM(c.amount), 2) AS valor_utilizado,
        currency
      FROM ${table},
      UNNEST(credits) AS c
      WHERE DATE(usage_start_time) >= DATE_TRUNC(CURRENT_DATE(), MONTH)
        AND c.amount < 0
      GROUP BY c.name, c.type, currency
      ORDER BY valor_utilizado ASC
    `;

    const [custosPorServico, creditosUtilizados] = await Promise.all([
      queryBigQuery(token, costSql),
      queryBigQuery(token, creditSql),
    ]);

    // ── Totais ───────────────────────────────────────────────────────────────
    const totalBruto    = custosPorServico.reduce((s, r) => s + parseFloat(r.custo_bruto || 0), 0);
    const totalCreditos = custosPorServico.reduce((s, r) => s + parseFloat(r.creditos_aplicados || 0), 0);
    const totalLiquido  = custosPorServico.reduce((s, r) => s + parseFloat(r.custo_liquido || 0), 0);

    return res.status(200).json({
      mes: new Date().toISOString().slice(0, 7),
      currency: custosPorServico[0]?.currency || 'BRL',
      totais: {
        bruto:    Math.round(totalBruto    * 100) / 100,
        creditos: Math.round(totalCreditos * 100) / 100,
        liquido:  Math.round(totalLiquido  * 100) / 100,
      },
      servicos: custosPorServico.map(r => ({
        servico:            r.service,
        custo_bruto:        parseFloat(r.custo_bruto    || 0),
        creditos_aplicados: parseFloat(r.creditos_aplicados || 0),
        custo_liquido:      parseFloat(r.custo_liquido   || 0),
      })),
      creditos_utilizados: creditosUtilizados.map(r => ({
        nome:  r.nome,
        tipo:  r.tipo,
        valor: parseFloat(r.valor_utilizado || 0),
      })),
    });

  } catch (err) {
    const msg = err.message || '';

    // Tabela ainda não existe — BigQuery export ativado há menos de 24h
    const isPending =
      msg.includes('does not match any table') ||
      msg.includes('notFound')                 ||
      msg.includes('Not found')                ||
      msg.includes('NOT_FOUND')                ||
      msg.includes('not found')                ||
      msg.includes('gcp_billing_export');

    if (isPending) {
      // Loga como info, não como erro — é comportamento esperado
      console.log('[billing-gcp] tabela ainda não existe — aguardando export (até 24h)');
      return res.status(200).json({
        pending: true,
        mes: new Date().toISOString().slice(0, 7),
        totais: { bruto: 0, creditos: 0, liquido: 0 },
        servicos: [],
        creditos_utilizados: [],
      });
    }

    console.error('[billing-gcp] erro inesperado:', msg);
    return res.status(500).json({ error: msg });
  }
}
