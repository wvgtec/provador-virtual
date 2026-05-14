# Mirage Studio — Documento de Implementação

> Tudo que o Claude Code precisa para implementar o Mirage Studio do zero.
> Branch de trabalho: `feat/mirage-studio`
> Ambiente de aprovação: URL de preview do Vercel (não vai para main até aprovação manual)

---

## O que é o Mirage Studio

Ferramenta interna (uso exclusivo do owner — Wlisses) para gerar fotos de modelos
usando uma peça de roupa como referência visual + prompt de texto, e em seguida
gerar um vídeo curto a partir da foto gerada.

Dois modelos do Vertex AI em sequência:
1. **Imagen 3** (`imagen-3.0-generate-001`) → gera a foto do modelo com a peça
2. **Veo 3** (`veo-3.0-generate-preview`) → gera o vídeo a partir da foto

---

## Infraestrutura reutilizada (não criar nada novo)

| Recurso | Como reutiliza |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT` | Mesma service account — já tem permissão para Imagen e Veo 3 |
| `GCS_BUCKET` (`mirage-tryon`) | Mesmas bucket, novas pastas `studio/images/` e `studio/videos/` |
| `UPSTASH_REDIS_REST_*` | Mesmo Redis, novo prefixo `studio:` |
| `QSTASH_TOKEN` | Mesmo QStash para enfileirar jobs de vídeo (longa duração) |
| `APP_URL` | Mesma URL base |
| Cloud Run worker (`worker/index.js`) | Adicionar handler Veo 3 ao worker existente |
| `getGoogleAccessToken()` | Copiar exatamente de `api/process.js` |
| `uploadToGCS()` | Copiar exatamente de `api/process.js` |

**GCP Project ID:** `provador-virtual-494213`
**Região Vertex AI:** `us-central1` (igual ao try-on)

**Nova variável de ambiente necessária:**
```
STUDIO_SECRET=uma_senha_forte_qualquer
```
Criar no Vercel em Settings → Environment Variables, escopo **Preview + Production**.

---

## Autenticação

O Studio é uma ferramenta interna, sem sistema de clientes. A autenticação é simples:

- O HTML tem um campo de senha na abertura
- Após digitar a senha correta, o token é salvo em `sessionStorage` e enviado como
  header `Authorization: Bearer {token}` em todas as chamadas de API
- A API compara com `process.env.STUDIO_SECRET` usando comparação segura (timingSafeEqual)
- Sem JWT, sem Redis, sem Stripe — só uma variável de ambiente

```javascript
import { timingSafeEqual } from 'crypto';

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
```

---

## Arquivos a criar / modificar

```
CRIAR:
  studio.html              → Interface completa (upload, prompt, imagem, vídeo)
  api/studio-generate.js   → Gera foto com Imagen 3
  api/studio-result.js     → Polling de status (imagem e vídeo)
  api/studio-video.js      → Enfileira job de vídeo via QStash

MODIFICAR:
  worker/index.js          → Adicionar handler para Veo 3
  vercel.json              → Registrar as 3 novas funções

NÃO MUDA:
  api/submit.js, process.js, client.js, billing.js, widget, painel-cliente.html
  Tudo de produção continua intocado.
```

---

## Redis — keys do Studio (prefixo studio:)

```
studio:job:{jobId}
  Tipo: string (JSON)
  TTL: 24h (imagem) / 48h (vídeo)
  {
    jobId: string,
    type: "image" | "video",
    status: "pending" | "processing" | "done" | "error",
    prompt: string,
    garmentUrl: string,          // URL GCS da peça enviada
    resultImage: string | null,  // URL GCS da imagem gerada
    resultVideo: string | null,  // URL GCS do vídeo gerado
    videoPrompt: string | null,  // prompt usado para o vídeo
    sourceJobId: string | null,  // jobId da imagem que originou o vídeo
    error: string | null,
    createdAt: number,
    startedAt: number | null,
    completedAt: number | null,
  }
```

---

## 1. CRIAR: api/studio-generate.js

Recebe a peça de roupa (URL GCS já upada) + prompt, chama Imagen 3, salva no GCS.
Roda direto no Vercel (Imagen 3 demora ~15-30s, cabe no limite de 60s).

**Fluxo:**
1. Verifica `Authorization` header com `STUDIO_SECRET`
2. Valida `garmentGcsUrl` (deve começar com `https://storage.googleapis.com/`)
3. Valida `prompt` (string, 10-1000 chars)
4. Cria `jobId` (randomUUID)
5. Salva job no Redis com status `processing`
6. Chama Imagen 3 via Vertex AI
7. Salva resultado no GCS: `studio/images/{jobId}.png`
8. Atualiza job no Redis com `status: done, resultImage: url`
9. Retorna `{ jobId, resultImage }`

**Chamada Imagen 3 — formato com imagem de referência:**
```javascript
async function callImagen3({ prompt, garmentBase64, accessToken }) {
  const PROJECT_ID = 'provador-virtual-494213';
  const LOCATION   = 'us-central1';
  const MODEL      = 'imagen-3.0-generate-001';
  const endpoint   = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;

  const body = {
    instances: [{
      prompt,
      // Referência da peça de roupa — Imagen mantém cor, textura e silhueta
      referenceImages: [{
        referenceType: 'REFERENCE_TYPE_SUBJECT',
        referenceId: 1,
        referenceImage: { bytesBase64Encoded: garmentBase64 },
      }],
    }],
    parameters: {
      sampleCount:      1,
      aspectRatio:      '3:4',       // retrato — ideal para moda
      safetySetting:    'block_few',
      personGeneration: 'allow_all',
    },
  };

  const res = await fetch(endpoint, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Imagen 3 retornou ${res.status}: ${err}`);
  }

  const data = await response.json();
  const imageBase64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!imageBase64) throw new Error('Imagen 3 não retornou imagem: ' + JSON.stringify(data));
  return imageBase64;
}
```

**IMPORTANTE sobre fallback:** se `referenceImages` retornar erro 400 (nem sempre
disponível dependendo da versão do modelo), tentar sem a referência — só com o prompt.
Nesse caso, incluir no prompt: `wearing [garment description from prompt]`.

**Config vercel.json:**
```json
"api/studio-generate.js": { "maxDuration": 60, "memory": 512 }
```

---

## 2. CRIAR: api/studio-result.js

Polling de status. Funciona para jobs de imagem e de vídeo.

```javascript
// GET /api/studio-result?jobId=xxx
// Retorna: { status, resultImage?, resultVideo?, error? }
```

Validação: jobId deve começar com prefixo UUID válido.
Lê `studio:job:{jobId}` do Redis e retorna campos públicos (sem expor o prompt interno
completo se houver dados sensíveis).

**Config vercel.json:**
```json
"api/studio-result.js": { "maxDuration": 10, "memory": 128 }
```

---

## 3. CRIAR: api/studio-video.js

Recebe `sourceJobId` (jobId da imagem gerada) + `videoPrompt`, enfileira no QStash
para o Cloud Run processar (Veo 3 demora 2-5 minutos).

**Fluxo:**
1. Verifica `Authorization` header
2. Busca `studio:job:{sourceJobId}` no Redis — confirma que `status: done` e tem `resultImage`
3. Cria novo `jobId` para o vídeo
4. Salva job de vídeo no Redis com `status: pending, sourceJobId, videoPrompt`
5. Enfileira no QStash: `{ jobId }` → `WORKER_URL`
6. Retorna `{ jobId, status: 'pending' }`

**Config vercel.json:**
```json
"api/studio-video.js": { "maxDuration": 10, "memory": 128 }
```

---

## 4. MODIFICAR: worker/index.js

Adicionar handler para Veo 3 ao lado do handler existente de try-on.

O worker já detecta o tipo de job pelo campo no body do QStash. Adicionar:

```javascript
// No handler principal do QStash, após verificar a assinatura:
const { jobId } = req.body;
const raw = await redis.get(`studio:job:${jobId}`);

if (raw) {
  // É um job do Studio (vídeo Veo 3)
  const job = typeof raw === 'string' ? JSON.parse(raw) : raw;
  await processStudioVideo(job);
  return res.status(200).json({ ok: true });
}

// Caso contrário, é um job de try-on (lógica existente)
await processTryOn(req, res);
```

**Função processStudioVideo:**

```javascript
async function processStudioVideo(job) {
  const { jobId, resultImage, videoPrompt } = job;

  // Marca como processing
  await redis.set(`studio:job:${jobId}`, JSON.stringify({
    ...job, status: 'processing', startedAt: Date.now()
  }), { ex: 172800 }); // 48h

  try {
    const accessToken = await getGoogleAccessToken();

    // 1. Busca imagem do GCS como base64
    const imgRes = await fetch(resultImage);
    const imgBuf = await imgRes.arrayBuffer();
    const imgB64 = Buffer.from(imgBuf).toString('base64');

    // 2. Inicia geração Veo 3 (LRO — Long Running Operation)
    const videoUrl = await callVeo3({ imageBase64: imgB64, prompt: videoPrompt, accessToken });

    // 3. Baixa o vídeo do GCS URI retornado pelo Veo 3
    const videoBuffer = await fetchGcsFile(videoUrl, accessToken);

    // 4. Salva no bucket do Studio
    const outputPath = `studio/videos/${jobId}.mp4`;
    const finalUrl   = await uploadToGCS(accessToken, outputPath, videoBuffer, 'video/mp4');

    // 5. Atualiza job como done
    await redis.set(`studio:job:${jobId}`, JSON.stringify({
      ...job, status: 'done', resultVideo: finalUrl, completedAt: Date.now()
    }), { ex: 172800 });

  } catch (err) {
    await redis.set(`studio:job:${jobId}`, JSON.stringify({
      ...job, status: 'error', error: err.message
    }), { ex: 3600 });
    throw err;
  }
}
```

**Chamada Veo 3 — padrão LRO:**

```javascript
async function callVeo3({ imageBase64, prompt, accessToken }) {
  const PROJECT_ID = 'provador-virtual-494213';
  const LOCATION   = 'us-central1';
  const MODEL      = 'veo-3.0-generate-preview';
  const endpoint   = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:predictLongRunning`;

  // Inicia geração
  const startRes = await fetch(endpoint, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{
        prompt,
        image: { bytesBase64Encoded: imageBase64 },
      }],
      parameters: {
        aspectRatio:   '9:16',   // vertical — ideal para moda/reels
        sampleCount:   1,
        durationSeconds: 8,      // 8 segundos de vídeo
      },
    }),
  });

  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Veo 3 start falhou ${startRes.status}: ${err}`);
  }

  const lro = await startRes.json();
  // lro.name = "projects/provador-virtual-494213/locations/us-central1/operations/{id}"
  const operationName = lro.name;
  if (!operationName) throw new Error('Veo 3 não retornou operationName: ' + JSON.stringify(lro));

  // Polling da operação — até 10 minutos
  const pollEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/${operationName}`;
  const maxAttempts  = 120; // 120 × 5s = 10 minutos
  const pollInterval = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, pollInterval));

    const pollRes = await fetch(pollEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!pollRes.ok) continue; // retry em caso de erro transitório

    const status = await pollRes.json();

    if (status.done) {
      if (status.error) throw new Error('Veo 3 erro: ' + JSON.stringify(status.error));

      // O GCS URI do vídeo fica em response.videos[0].gcsUri ou predictions[0].gcsUri
      const gcsUri = status.response?.videos?.[0]?.gcsUri
                  || status.response?.predictions?.[0]?.gcsUri
                  || status.response?.generatedSamples?.[0]?.video?.uri;

      if (!gcsUri) throw new Error('Veo 3 done mas sem gcsUri: ' + JSON.stringify(status));
      return gcsUri; // ex: "gs://mirage-tryon/veo-output/xxx.mp4"
    }
  }

  throw new Error('Veo 3 timeout após 10 minutos');
}
```

**Função auxiliar para baixar arquivo do GCS:**

```javascript
async function fetchGcsFile(gcsUri, accessToken) {
  // Converte gs://bucket/path para URL HTTP
  const [, bucket, ...pathParts] = gcsUri.replace('gs://', '').split('/');
  const objectPath = pathParts.join('/');
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Falha ao baixar do GCS: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
```

**NOTA sobre o response do Veo 3:** O campo exato que contém o GCS URI pode variar
conforme a versão da API. Testar na primeira execução e ajustar o path de extração
se necessário. Logar o `status.response` completo na primeira vez para inspecionar.

---

## 5. CRIAR: studio.html

Interface limpa, protegida por senha. Uma única página, sem frameworks.

**Fluxo da UI:**

```
[1. SENHA]
  Campo de senha → valida contra STUDIO_SECRET via /api/studio-result com jobId fake
  (ou criar endpoint /api/studio-auth separado para validar)
  Após validar: salva token em sessionStorage, exibe a interface

[2. PEÇA DE ROUPA]
  Upload de imagem (arrastar ou clicar)
  → chama /api/upload-url para obter URL assinada
  → PUT direto no GCS
  → exibe thumbnail da peça

[3. PROMPT]
  Textarea com placeholder de exemplo:
  "Modelo feminina, 25 anos, pele morena, cabelo cacheado, posando de frente,
   estúdio fotográfico com fundo branco, iluminação suave, foto editorial de moda"

  [Prompt de vídeo] (aparece após gerar a imagem)
  "modelo caminhando levemente, cabelo ao vento, câmera lenta, 8 segundos"

[4. BOTÕES]
  [Gerar foto do modelo]   → POST /api/studio-generate
  [Gerar vídeo]            → POST /api/studio-video (ativado após ter imagem)

[5. RESULTADO — IMAGEM]
  - Skeleton animado durante processamento (~20s)
  - Polling GET /api/studio-result?jobId=xxx a cada 2s
  - Exibe imagem quando pronto
  - Botão [Baixar foto] + botão [Gerar vídeo a partir desta]

[6. RESULTADO — VÍDEO]
  - Indicador de progresso ("gerando vídeo... pode levar até 5 minutos")
  - Polling GET /api/studio-result?jobId=xxx a cada 5s
  - Exibe player de vídeo quando pronto
  - Botão [Baixar vídeo]

[7. HISTÓRICO (opcional, simples)]
  - Lista das últimas 10 gerações da sessão (em memória, sem persistência)
  - Clica para rever uma geração anterior
```

**Design:** manter o estilo visual do Mirage — fundo branco, primário #111, amarelo
Mirage #F5C53F como destaque. Fonte do sistema. Sem dependência de CDN.

**Segurança:**
- Content-Security-Policy restritiva no vercel.json para a rota `/studio.html`
- X-Frame-Options: DENY
- Cache-Control: no-store (para não cachear a página autenticada)

---

## 6. MODIFICAR: vercel.json

Adicionar no bloco `functions`:

```json
"api/studio-generate.js": { "maxDuration": 60, "memory": 512 },
"api/studio-result.js":   { "maxDuration": 10, "memory": 128 },
"api/studio-video.js":    { "maxDuration": 10, "memory": 128 }
```

Adicionar no bloco `headers` (para proteger a página):

```json
{
  "source": "/studio.html",
  "headers": [
    { "key": "Cache-Control",           "value": "no-store, no-cache, must-revalidate" },
    { "key": "X-Frame-Options",         "value": "DENY" },
    { "key": "X-Content-Type-Options",  "value": "nosniff" },
    { "key": "Referrer-Policy",         "value": "strict-origin-when-cross-origin" }
  ]
}
```

---

## Variável de ambiente a criar no Vercel

```
STUDIO_SECRET   → senha forte, mínimo 20 caracteres
                  Escopo: Production + Preview
                  Exemplo de geração: openssl rand -base64 32
```

---

## Tratamento de erros esperados

| Situação | Comportamento esperado |
|---|---|
| Imagen 3 sem suporte a `referenceImages` | Tentar sem referência, só com prompt |
| Veo 3 retorna erro 429 (quota) | Exibir "Limite de gerações de vídeo atingido. Tente mais tarde." |
| Veo 3 timeout > 10 min | Marcar job como error, exibir mensagem clara |
| Prompt rejeitado por safety filter | Exibir o erro original do modelo, não mascarar |
| Upload de peça > 5MB | Validar no frontend antes de chamar upload-url |
| GCS URI format diferente do esperado | Logar response completo, ajustar parser |

---

## Ordem de implementação sugerida

1. Criar `STUDIO_SECRET` no Vercel (Wlisses faz manualmente)
2. Criar branch `feat/mirage-studio` a partir de `main`
3. `studio.html` — página completa com UI (sem integração de API ainda)
4. `api/studio-result.js` — polling simples (mais fácil, para testar infraestrutura)
5. `api/studio-generate.js` — geração de imagem com Imagen 3
6. Testar imagem end-to-end no Vercel preview
7. `api/studio-video.js` — enfileiramento QStash
8. Modificar `worker/index.js` — handler Veo 3
9. Deploy do worker no Cloud Run (Wlisses faz: `gcloud run deploy`)
10. Testar vídeo end-to-end
11. Ajustar UI com base nos testes reais
12. Aprovação → merge para `main`

---

## Checklist de aprovação antes do merge

- [ ] Senha funciona (campo de senha + validação)
- [ ] Upload de peça funciona (imagem vai para `studio/inputs/`)
- [ ] Imagen 3 gera foto de modelo com referência da peça
- [ ] Fallback sem referência funciona (se API não suportar)
- [ ] Polling de imagem retorna resultado em tempo real
- [ ] Botão de download da imagem funciona
- [ ] Veo 3 é enfileirado corretamente via QStash
- [ ] Worker processa Veo 3 sem quebrar o try-on existente
- [ ] Polling de vídeo retorna resultado quando pronto
- [ ] Player de vídeo exibe o .mp4 gerado
- [ ] Botão de download do vídeo funciona
- [ ] Página não acessível sem senha (retorna 401 se tentar API sem token)
- [ ] Nenhum job de produção (try-on) foi afetado
- [ ] Keys Redis `studio:*` isolados dos keys de produção

---

## Referência de arquivos existentes para copiar padrões

- `api/process.js` → `getGoogleAccessToken()`, `uploadToGCS()`
- `api/result.js` → padrão de polling com rate limiting
- `api/upload-url.js` → URL assinada GCS (reutilizar sem modificar)
- `worker/index.js` → estrutura do worker, `getGoogleAccessToken()` com cache

---

*Documento criado em maio de 2026. Branch: `feat/mirage-studio`.*
