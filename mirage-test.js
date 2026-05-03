/**
 * MIRAGE — Snippet de teste para Nuvemshop
 * Cole no console do DevTools numa página de produto e pressione Enter.
 * Não modifica nenhum arquivo da loja — roda apenas na sessão atual do navegador.
 */
(function () {
  if (document.getElementById('mirage-overlay')) {
    document.getElementById('mirage-overlay').remove();
    document.getElementById('mirage-fab')?.remove();
    console.log('Mirage removido.');
    return;
  }

  // ── Configuração ─────────────────────────────────────────────────────────────
  const API_URL    = 'https://provador-virtual-brown.vercel.app';
  const CLIENT_KEY = 'pvk_609c700a03c793cc63aef696046c5cc6';

  // ── Detecta imagem do produto ─────────────────────────────────────────────────
  function getGarmentUrl() {
    // 1. window.LS.product (API Nuvemshop)
    if (window.LS?.product?.images?.length) {
      const img = window.LS.product.images[0];
      return typeof img === 'string' ? img : (img.src || img.url || img);
    }
    // 2. Imagem principal visível na página
    const selectors = [
      '.js-product-featured-image img',
      '[data-product-featured-image] img',
      '.product-featured-image img',
      '.product__image img',
      '#product-image img',
      'img.product-image',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.src) return el.src;
    }
    // 3. Maior imagem da página como fallback
    const imgs = [...document.images].filter(i => i.naturalWidth > 300 && !i.src.includes('logo'));
    imgs.sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));
    return imgs[0]?.src || null;
  }

  const garmentUrl = getGarmentUrl();
  if (!garmentUrl) {
    alert('Mirage: imagem do produto não encontrada nesta página.');
    return;
  }
  console.log('Mirage: imagem do produto detectada:', garmentUrl);

  // ── Estilos ───────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.id = 'mirage-styles';
  style.textContent = `
    #mirage-fab {
      position: fixed; bottom: 88px; right: 24px; z-index: 99998;
      background: #FFE34E; border: 1.5px solid #0A0A0A; border-radius: 14px;
      padding: 12px 20px; font-weight: 700; font-size: 14px; cursor: pointer;
      font-family: "DM Sans", sans-serif; letter-spacing: -0.02em;
      box-shadow: 4px 4px 0 0 #0A0A0A; transition: transform .15s;
    }
    #mirage-fab:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0 0 #0A0A0A; }

    #mirage-overlay {
      position: fixed; inset: 0; z-index: 99999;
      background: rgba(0,0,0,.55); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center; padding: 16px;
    }
    #mirage-box {
      background: #fff; border: 1.5px solid #0A0A0A; border-radius: 24px;
      width: 100%; max-width: 860px; max-height: 90vh; overflow: hidden;
      display: grid; grid-template-columns: 1fr 1fr; box-shadow: 8px 8px 0 0 #0A0A0A;
      font-family: "DM Sans", ui-sans-serif, sans-serif;
    }
    @media (max-width: 640px) { #mirage-box { grid-template-columns: 1fr; } }

    #mirage-left {
      background: #F6F5F1; padding: 28px; border-right: 1.5px solid #0A0A0A;
      display: flex; flex-direction: column; gap: 16px; overflow-y: auto;
    }
    #mirage-right {
      padding: 28px; display: flex; flex-direction: column; gap: 16px;
      overflow-y: auto;
    }
    .mg-label {
      font-size: 10px; font-weight: 600; letter-spacing: .08em;
      text-transform: uppercase; color: rgba(10,10,10,.5);
      font-family: "JetBrains Mono", monospace;
    }
    .mg-title { font-size: 22px; font-weight: 700; letter-spacing: -.025em; line-height: 1.1; }
    .mg-sub { font-size: 13px; color: rgba(10,10,10,.6); line-height: 1.5; }

    #mg-garment-thumb {
      width: 100%; aspect-ratio: 3/4; object-fit: contain;
      border: 1.5px solid #0A0A0A; border-radius: 14px; background: #fff;
    }

    #mg-drop {
      border: 2px dashed #0A0A0A; border-radius: 14px; padding: 24px 16px;
      text-align: center; cursor: pointer; background: #fff; transition: all .2s;
    }
    #mg-drop:hover, #mg-drop.drag { background: #FFF5B8; border-style: solid; }
    #mg-drop .mg-drop-cta {
      display: inline-block; background: #0A0A0A; color: #fff;
      padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 600; margin-top: 8px;
    }

    #mg-canvas {
      flex: 1; min-height: 260px; border: 1.5px solid #0A0A0A; border-radius: 14px;
      background: #F6F5F1; display: flex; align-items: center; justify-content: center;
      position: relative; overflow: hidden;
    }
    #mg-canvas img { width: 100%; height: 100%; object-fit: contain; display: none; }
    #mg-canvas .mg-placeholder { color: rgba(10,10,10,.35); font-size: 13px; font-weight: 500; text-align: center; padding: 16px; }

    #mg-scan {
      position: absolute; left: 0; right: 0; height: 10%;
      background: linear-gradient(180deg, transparent, rgba(255,227,78,.85), transparent);
      filter: blur(1px); display: none; top: 0;
      animation: mg-scanline 2.4s cubic-bezier(.4,.1,.4,1) infinite;
    }
    @keyframes mg-scanline { 0%{top:-10%} 100%{top:110%} }

    #mg-run-btn {
      width: 100%; padding: 14px; border-radius: 12px; font-size: 15px; font-weight: 700;
      border: 1.5px solid #0A0A0A; cursor: pointer; transition: all .2s; font-family: inherit;
      background: #0A0A0A; color: #fff;
    }
    #mg-run-btn:disabled { opacity: .38; cursor: not-allowed; }
    #mg-run-btn.ready { background: #FFE34E; color: #0A0A0A; }
    #mg-run-btn:not(:disabled):hover { transform: translate(-2px,-2px); box-shadow: 3px 3px 0 0 #0A0A0A; }

    #mg-status {
      font-size: 12px; text-align: center; color: rgba(10,10,10,.5);
      font-family: "JetBrains Mono", monospace; letter-spacing: .04em; min-height: 18px;
    }
    #mg-error { display: none; background: #fff0f0; color: #c0392b; border: 1px solid #ffcccc; border-radius: 8px; padding: 10px 14px; font-size: 12px; }

    #mg-close {
      position: absolute; top: 16px; right: 20px;
      background: none; border: none; font-size: 22px; cursor: pointer; color: #999; z-index: 1;
    }
    #mg-close:hover { color: #333; }

    #mg-result-actions {
      display: none; gap: 8px; flex-direction: column;
    }
    #mg-result-actions a, #mg-result-actions button {
      display: block; width: 100%; text-align: center; padding: 11px;
      border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer;
      font-family: inherit; text-decoration: none;
    }
    #mg-download { background: #FFE34E; border: 1.5px solid #0A0A0A; color: #0A0A0A; }
    #mg-reset { background: transparent; border: 1.5px solid #0A0A0A; color: #0A0A0A; }
  `;
  document.head.appendChild(style);

  // ── FAB (botão flutuante) ─────────────────────────────────────────────────────
  const fab = document.createElement('button');
  fab.id = 'mirage-fab';
  fab.textContent = '✦ Experimentar';
  fab.onclick = openWidget;
  document.body.appendChild(fab);

  // ── Overlay / Modal ───────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'mirage-overlay';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div id="mirage-box">
      <button id="mg-close">×</button>

      <!-- Esquerda: peça + upload -->
      <div id="mirage-left">
        <div class="mg-label">01 · Produto detectado</div>
        <img id="mg-garment-thumb" src="${garmentUrl}" alt="Produto">
        <div>
          <div class="mg-label" style="margin-bottom:10px">02 · Sua foto</div>
          <div id="mg-drop">
            <div class="mg-sub">Foto de corpo inteiro, boa iluminação</div>
            <span class="mg-drop-cta">Enviar foto</span>
            <div style="font-size:11px;color:rgba(10,10,10,.4);margin-top:6px">JPG · PNG · até 12MB</div>
          </div>
          <input type="file" id="mg-file" accept="image/*" style="display:none">
        </div>
      </div>

      <!-- Direita: resultado -->
      <div id="mirage-right">
        <div>
          <div class="mg-label">03 · Resultado</div>
          <div class="mg-title" style="margin-top:6px">Veja a peça em você</div>
          <div class="mg-sub" style="margin-top:4px">Envie sua foto e clique em gerar.</div>
        </div>

        <div id="mg-canvas">
          <div class="mg-placeholder">A visualização aparece aqui</div>
          <img id="mg-result-img" alt="Resultado Mirage">
          <div id="mg-scan"></div>
        </div>

        <div id="mg-status"></div>
        <div id="mg-error"></div>

        <button id="mg-run-btn" disabled>Envie sua foto para continuar</button>

        <div id="mg-result-actions">
          <a id="mg-download" href="#" download="mirage-resultado.jpg">Baixar resultado</a>
          <button id="mg-reset">↺ Tentar com outra foto</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // ── Estado ────────────────────────────────────────────────────────────────────
  let personB64 = null;

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function setStatus(msg) { document.getElementById('mg-status').textContent = msg; }
  function showError(msg) {
    const el = document.getElementById('mg-error');
    el.textContent = msg; el.style.display = 'block';
  }
  function hideError() { document.getElementById('mg-error').style.display = 'none'; }

  function openWidget() {
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  function closeWidget() {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  // ── Upload e compressão da foto ───────────────────────────────────────────────
  function processPhoto(file) {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        const max = 1024;
        if (w > max || h > max) {
          if (w > h) { h = Math.round(h * max / w); w = max; }
          else { w = Math.round(w * max / h); h = max; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        personB64 = canvas.toDataURL('image/jpeg', 0.85);

        // Preview no canvas
        const resultImg = document.getElementById('mg-result-img');
        resultImg.src = personB64;
        resultImg.style.display = 'block';
        document.querySelector('#mg-canvas .mg-placeholder').style.display = 'none';

        // Habilita botão
        const btn = document.getElementById('mg-run-btn');
        btn.disabled = false;
        btn.classList.add('ready');
        btn.textContent = 'Gerar visualização →';
        setStatus('Foto pronta. Clique em gerar.');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ── Drop zone ─────────────────────────────────────────────────────────────────
  const drop = document.getElementById('mg-drop');
  const fileInput = document.getElementById('mg-file');

  drop.onclick = () => fileInput.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('drag'); };
  drop.ondragleave = () => drop.classList.remove('drag');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('drag'); processPhoto(e.dataTransfer.files[0]); };
  fileInput.onchange = e => processPhoto(e.target.files[0]);

  // ── Chamada à API Mirage ──────────────────────────────────────────────────────
  async function runTryOn() {
    if (!personB64) return;
    hideError();

    const btn = document.getElementById('mg-run-btn');
    btn.disabled = true;
    btn.classList.remove('ready');
    btn.textContent = 'Gerando...';

    document.getElementById('mg-scan').style.display = 'block';
    document.getElementById('mg-result-actions').style.display = 'none';
    setStatus('Enviando para o servidor...');

    try {
      // 1. Cria o job
      const submitRes = await fetch(API_URL + '/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientKey: CLIENT_KEY,
          personImage: personB64,
          garmentImage: garmentUrl,
          category: 'tops',
          source: 'nuvemshop-test',
        }),
      });
      const submitData = await submitRes.json();
      if (!submitData.jobId) throw new Error(submitData.error || 'Falha ao criar job');

      setStatus('Processando com IA...');
      console.log('Mirage: job criado', submitData.jobId);

      // 2. Polling do resultado
      await pollResult(submitData.jobId, Date.now(), btn);

    } catch (err) {
      document.getElementById('mg-scan').style.display = 'none';
      showError(err.message);
      btn.disabled = false;
      btn.classList.add('ready');
      btn.textContent = 'Tentar novamente';
      setStatus('');
      console.error('Mirage erro:', err);
    }
  }

  function pollResult(jobId, start, btn) {
    return new Promise((resolve, reject) => {
      if (Date.now() - start > 120000) {
        reject(new Error('Tempo esgotado. Tente novamente.'));
        return;
      }
      setTimeout(async () => {
        try {
          const r = await fetch(API_URL + '/api/result?jobId=' + jobId);
          const d = await r.json();
          console.log('Mirage: poll', d.status);

          if (d.status === 'done') {
            document.getElementById('mg-scan').style.display = 'none';
            const resultImg = document.getElementById('mg-result-img');
            resultImg.src = d.resultImage;
            resultImg.style.display = 'block';

            // Download link
            document.getElementById('mg-download').href = d.resultImage;

            btn.disabled = false;
            btn.textContent = 'Gerar novamente ✦';
            setStatus('Visualização gerada com sucesso.');
            document.getElementById('mg-result-actions').style.display = 'flex';
            resolve();

          } else if (d.status === 'error') {
            reject(new Error('Erro no servidor: ' + d.error));
          } else {
            const elapsed = Math.round((Date.now() - start) / 1000);
            setStatus(`Processando... ${elapsed}s`);
            resolve(pollResult(jobId, start, btn));
          }
        } catch (_) {
          resolve(pollResult(jobId, start, btn));
        }
      }, 2500);
    });
  }

  // ── Eventos ───────────────────────────────────────────────────────────────────
  document.getElementById('mg-run-btn').onclick = runTryOn;
  document.getElementById('mg-close').onclick = closeWidget;
  document.getElementById('mg-reset').onclick = () => {
    personB64 = null;
    const resultImg = document.getElementById('mg-result-img');
    resultImg.src = ''; resultImg.style.display = 'none';
    document.querySelector('#mg-canvas .mg-placeholder').style.display = '';
    document.getElementById('mg-result-actions').style.display = 'none';
    const btn = document.getElementById('mg-run-btn');
    btn.disabled = true; btn.classList.remove('ready');
    btn.textContent = 'Envie sua foto para continuar';
    setStatus(''); hideError();
  };
  overlay.onclick = e => { if (e.target === overlay) closeWidget(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeWidget(); });

  // Abre automaticamente
  openWidget();
  console.log('Mirage: widget carregado. Produto:', garmentUrl);
})();
