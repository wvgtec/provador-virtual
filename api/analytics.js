// api/analytics.js
// Consulta dados do GA4 via Google Analytics Data API v1.
// Usa a mesma service account já configurada (GOOGLE_SERVICE_ACCOUNT).
// Requer: Google Analytics Data API ativada no GCP + service account com papel Leitor no GA4.

import { timingSafeEqual } from 'crypto';

const GA4_PROPERTY_ID = '535099478';

function safeCompare(a, b) {
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch { return false; }
}

// ─── JWT → Access Token (mesmo padrão do billing-gcp.js) ─────────────────────
async function getAccessToken(sa) {
  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  };

  const toB64 = obj => Buffer.from(JSON.stringify(obj))
    .toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');

  const header  = toB64({ alg: 'RS256', typ: 'JWT' });
  const payload = toB64(claim);
  const signing = `${header}.${payload}`;

  const pemBody  = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', Buffer.from(pemBody, 'base64'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signing));
  const sig    = Buffer.from(sigBuf).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt    = `${signing}.${sig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Falha no access token GA4: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

// ─── Executa uma query no GA4 Data API ───────────────────────────────────────
async function runReport(token, body) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
    {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data;
}

// ─── Parseia resultado em array de objetos ────────────────────────────────────
function parseReport(report) {
  if (!report?.rows?.length) return [];
  const dims    = report.dimensionHeaders?.map(h => h.name)  || [];
  const metrics = report.metricHeaders?.map(h => h.name)     || [];
  return report.rows.map(row => {
    const obj = {};
    dims.forEach((d, i)    => { obj[d] = row.dimensionValues?.[i]?.value ?? null; });
    metrics.forEach((m, i) => { obj[m] = row.metricValues?.[i]?.value   ?? null; });
    return obj;
  });
}

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  // Auth
  const adminSecret = process.env.ADMIN_SECRET || '';
  const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!safeCompare(auth, adminSecret)) return res.status(401).json({ error: 'Não autorizado' });

  const saEnv = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!saEnv) return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT não configurada' });

  try {
    const sa    = JSON.parse(saEnv);
    const token = await getAccessToken(sa);

    const periodo = req.query?.periodo || '30daysAgo';

    // ── 1. KPIs gerais ────────────────────────────────────────────────────────
    const [kpisReport, trendReport, sourcesReport, devicesReport, eventsReport, pagesReport] =
      await Promise.all([

        // KPIs: sessões, usuários, pageviews, bounce rate, duração média
        runReport(token, {
          dateRanges: [{ startDate: periodo, endDate: 'today' }],
          metrics: [
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'bounceRate' },
            { name: 'averageSessionDuration' },
            { name: 'newUsers' },
          ],
        }),

        // Tendência diária (últimos 14 dias)
        runReport(token, {
          dateRanges: [{ startDate: '14daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'date' }],
          metrics:    [{ name: 'sessions' }, { name: 'activeUsers' }],
          orderBys:   [{ dimension: { dimensionName: 'date' } }],
        }),

        // Fontes de tráfego (top 8)
        runReport(token, {
          dateRanges: [{ startDate: periodo, endDate: 'today' }],
          dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
          metrics:    [{ name: 'sessions' }, { name: 'activeUsers' }],
          orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 8,
        }),

        // Dispositivos
        runReport(token, {
          dateRanges: [{ startDate: periodo, endDate: 'today' }],
          dimensions: [{ name: 'deviceCategory' }],
          metrics:    [{ name: 'sessions' }, { name: 'activeUsers' }],
          orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
        }),

        // Top eventos
        runReport(token, {
          dateRanges: [{ startDate: periodo, endDate: 'today' }],
          dimensions: [{ name: 'eventName' }],
          metrics:    [{ name: 'eventCount' }, { name: 'totalUsers' }],
          orderBys:   [{ metric: { metricName: 'eventCount' }, desc: true }],
          limit: 15,
        }),

        // Top páginas
        runReport(token, {
          dateRanges: [{ startDate: periodo, endDate: 'today' }],
          dimensions: [{ name: 'pagePath' }],
          metrics:    [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
          orderBys:   [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 8,
        }),
      ]);

    // ── Extrai KPIs ───────────────────────────────────────────────────────────
    const kpis = kpisReport.rows?.[0];
    const metricVal = (i) => parseFloat(kpis?.metricValues?.[i]?.value || '0');

    return res.status(200).json({
      ok:      true,
      periodo,
      kpis: {
        sessions:        Math.round(metricVal(0)),
        activeUsers:     Math.round(metricVal(1)),
        pageviews:       Math.round(metricVal(2)),
        bounceRate:      Math.round(metricVal(3) * 100) / 100,
        avgSessionSec:   Math.round(metricVal(4)),
        newUsers:        Math.round(metricVal(5)),
      },
      tendencia:  parseReport(trendReport),
      fontes:     parseReport(sourcesReport),
      dispositivos: parseReport(devicesReport),
      eventos:    parseReport(eventsReport),
      paginas:    parseReport(pagesReport),
    });

  } catch (err) {
    console.error('[analytics]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
