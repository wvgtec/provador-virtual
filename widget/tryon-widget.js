/**
 * Provador Virtual — Widget
 * Versão: 3.0
 *
 * Variáveis de configuração (defina antes de carregar o script):
 *
 *   window.VTON_API_URL          = 'https://...';          // obrigatório
 *   window.VTON_CLIENT_KEY       = 'pvk_...';              // obrigatório
 *   window.VTON_GARMENT_URL      = '{{ image_url }}';      // URL da peça
 *   window.VTON_GARMENT_CATEGORY = 'tops';                 // tops | bottoms | dresses | auto
 *
 *   // Personalização do botão trigger:
 *   window.VTON_BTN_TEXT         = 'Experimentar';         // texto do botão
 *   window.VTON_BTN_BG           = '#1a1a1a';              // cor de fundo
 *   window.VTON_BTN_COLOR        = '#ffffff';              // cor do texto
 *   window.VTON_BTN_WIDTH        = '100%';                 // largura (ex: '280px', '100%')
 *   window.VTON_BTN_HEIGHT       = '52px';                 // altura (ex: '52px', 'auto')
 *   window.VTON_BTN_RADIUS       = '50px';                 // border-radius
 */

(function () {
  'use strict';

  // ─── Configuração ─────────────────────────────────────────────────────────

  const API_URL    = window.VTON_API_URL    || '';
  const CLIENT_KEY = window.VTON_CLIENT_KEY || '';

  // Personalização do botão
  const BTN_TEXT   = window.VTON_BTN_TEXT   || 'Experimentar virtualmente';
  const BTN_BG     = window.VTON_BTN_BG     || '#1a1a1a';
  const BTN_COLOR  = window.VTON_BTN_COLOR  || '#ffffff';
  const BTN_WIDTH  = window.VTON_BTN_WIDTH  || '100%';
  const BTN_HEIGHT = window.VTON_BTN_HEIGHT || '52px';
  const BTN_RADIUS = window.VTON_BTN_RADIUS || '50px';

  const SSE_TIMEOUT_MS = 60000; // fecha a conexão SSE se o servidor não responder em 60s

  if (!API_URL) {
    console.warn('[Provador Virtual] window.VTON_API_URL não definido.');
    return;
  }

  // ─── Estilos ──────────────────────────────────────────────────────────────

  const CSS = `
    #nksw-overlay {
      display: none; position: fixed; inset: 0; z-index: 99999;
      background: rgba(0,0,0,0.6); align-items: center; justify-content: center;
    }
    #nksw-overlay.active { display: flex; }
    #nksw-modal {
      background: #fff; border-radius: 16px; width: 92%; max-width: 520px;
      max-height: 92vh; overflow-y: auto; padding: 28px 24px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.18); position: relative;
    }
    #nksw-close {
      position: absolute; top: 16px; right: 16px;
      background: none; border: none; font-size: 22px; cursor: pointer;
      color: #666; line-height: 1;
    }
    #nksw-title { font-size: 16px; font-weight: 700; margin: 0 0 4px; color: #1a1a1a; letter-spacing: .05em; display: flex; align-items: center; }
    #nksw-subtitle { font-size: 13px; color: #888; margin: 0 0 16px; }

    /* Upload */
    #nksw-upload-area {
      display: block !important;
      border: 2px dashed #d0d0d0; border-radius: 16px; padding: 40px 16px;
      text-align: center; cursor: pointer; transition: border-color .2s, background .2s;
      background: #fafafa;
    }
    #nksw-upload-area[style*="display: none"] { display: none !important; }
    #nksw-upload-area:hover { border-color: #1a1a1a; background: #f5f5f5; }
    #nksw-upload-area input { display: none; }
    #nksw-upload-icon { font-size: 40px; margin-bottom: 12px; }
    #nksw-upload-label { font-size: 15px; font-weight: 600; color: #1a1a1a; }
    #nksw-upload-hint { font-size: 12px; color: #999; margin-top: 6px; line-height: 1.6; }
    #nksw-privacy { font-size: 11px; color: #aaa; text-align: center; margin-top: 10px; line-height: 1.5; }
    #nksw-preview-img {
      max-width: 100%; max-height: 200px; border-radius: 12px;
      margin: 12px auto 0; display: block;
    }

    /* Botão principal */
    #nksw-btn-try {
      width: 100%; padding: 16px; background: #1a1a1a; color: #fff;
      border: none; border-radius: 50px; font-size: 13px; font-weight: 700;
      letter-spacing: .08em; text-transform: uppercase;
      cursor: pointer; margin-top: 16px; transition: background .2s;
      font-family: inherit;
    }
    #nksw-btn-try:hover { background: #333; }
    #nksw-btn-try:disabled { background: #ccc; cursor: not-allowed; }

    /* Status / loading */
    #nksw-status {
      display: none; text-align: center; padding: 36px 0 28px;
    }
    #nksw-spinner {
      width: 64px; height: 64px; border: 5px solid #eee;
      border-top-color: #6C5CE7; border-radius: 50%;
      animation: nksw-spin 0.8s linear infinite; margin: 0 auto 20px;
    }
    @keyframes nksw-spin { to { transform: rotate(360deg); } }
    #nksw-status-text { font-size: 17px; font-weight: 700; color: #1a1a1a; letter-spacing: -.01em; }
    #nksw-status-sub { font-size: 13px; color: #999; margin-top: 8px; line-height: 1.5; }
    #nksw-progress-bar-wrap {
      height: 4px; background: #eee; border-radius: 2px; margin-top: 20px; overflow: hidden;
    }
    #nksw-progress-bar {
      height: 100%; background: #6C5CE7; width: 0%;
      transition: width 1s ease; border-radius: 2px;
    }

    /* Resultado */
    #nksw-result { display: none; text-align: center; }
    #nksw-result-img {
      max-width: 100%; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    }
    #nksw-result-actions { display: flex; gap: 10px; margin-top: 14px; }
    #nksw-btn-save, #nksw-btn-retry {
      flex: 1; padding: 12px; border-radius: 8px;
      font-size: 14px; font-weight: 600; cursor: pointer; border: none;
    }
    #nksw-btn-save { background: #6C5CE7; color: #fff; }
    #nksw-btn-retry { background: #f0f0f0; color: #333; }

    /* Botão trigger */
    .nksw-trigger-btn {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: 0 24px;
      border: 2px solid currentColor; border-radius: 50px;
      font-size: 14px; font-weight: 700; letter-spacing: .06em;
      text-transform: uppercase; cursor: pointer;
      transition: opacity .2s; margin-top: 12px;
      font-family: inherit; box-sizing: border-box;
    }
    .nksw-trigger-btn:hover { opacity: .85; }
    .nksw-trigger-btn svg { flex-shrink: 0; }

    /* Erro */
    #nksw-error {
      display: none; background: #fff3f3; border: 1px solid #ffcccc;
      border-radius: 8px; padding: 14px 16px; color: #c0392b;
      font-size: 13px; margin-top: 12px; text-align: center;
    }
  `;

  // ─── HTML do modal ─────────────────────────────────────────────────────────

  const MODAL_HTML = `
    <div id="nksw-overlay">
      <div id="nksw-modal" role="dialog" aria-modal="true" aria-labelledby="nksw-title">
        <button id="nksw-close" aria-label="Fechar">&times;</button>

        <h2 id="nksw-title">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:8px"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
          PROVADOR VIRTUAL
        </h2>
        <p id="nksw-subtitle">Clique ou arraste sua foto aqui</p>

        <!-- Upload -->
        <div id="nksw-upload-area" role="button" tabindex="0" aria-label="Selecionar foto">
          <input type="file" id="nksw-file" accept="image/*">
          <div id="nksw-upload-icon">📷</div>
          <div id="nksw-upload-label">Clique ou arraste sua foto aqui</div>
          <div id="nksw-upload-hint">JPG, PNG ou WEBP &bull; foto de corpo inteiro &bull; boa iluminação</div>
        </div>
        <img id="nksw-preview-img" alt="Prévia da sua foto" style="display:none">

        <button type="button" id="nksw-btn-try" disabled>EXPERIMENTAR VIRTUALMENTE</button>
        <p id="nksw-privacy">🔒 Sua foto é processada em tempo real e não é armazenada.</p>

        <!-- Status / loading -->
        <div id="nksw-status">
          <div id="nksw-spinner"></div>
          <div id="nksw-status-text">Gerando seu look...</div>
          <div id="nksw-status-sub">Aguarde alguns segundos</div>
          <div id="nksw-progress-bar-wrap">
            <div id="nksw-progress-bar"></div>
          </div>
        </div>

        <!-- Erro -->
        <div id="nksw-error"></div>

        <!-- Resultado -->
        <div id="nksw-result">
          <img id="nksw-result-img" alt="Resultado do provador virtual">
          <div id="nksw-result-actions">
            <button id="nksw-btn-save">💾 Salvar foto</button>
            <button id="nksw-btn-retry">Tentar novamente</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // ─── Inicialização ────────────────────────────────────────────────────────

  function init() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = MODAL_HTML;
    document.body.appendChild(wrapper);

    const anchor = document.getElementById('vton-anchor');
    if (anchor) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nksw-trigger-btn';
      btn.style.cssText = [
        `background:${BTN_BG}`,
        `color:${BTN_COLOR}`,
        `width:${BTN_WIDTH}`,
        `height:${BTN_HEIGHT}`,
        `border-radius:${BTN_RADIUS}`,
        `border-color:${BTN_BG}`,
      ].join(';');
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg> ${BTN_TEXT}`;
      anchor.appendChild(btn);
      btn.addEventListener('click', openModal);
    } else {
      document.querySelectorAll('[data-vton]').forEach(bindTrigger);
      document.querySelectorAll('.nksw-trigger-btn').forEach(bindTrigger);
    }

    bindModal();
  }

  function bindTrigger(el) {
    el.addEventListener('click', openModal);
  }

  // ─── Lógica do modal ──────────────────────────────────────────────────────

  let currentJobId  = null;
  let sseSource     = null;
  let sseTimeout    = null;
  let progressTimer = null;
  let personBase64  = null;
  let garmentUrl    = null;
  let category      = 'auto';

  function openModal() {
    garmentUrl = window.VTON_GARMENT_URL
      || document.querySelector('[data-vton-image]')?.dataset?.vtonImage
      || document.querySelector('.product__media img')?.src
      || document.querySelector('.product-featured-img')?.src
      || document.querySelector('.js-product-featured-image')?.src
      || document.querySelector('.woocommerce-product-gallery__image img')?.src
      || document.querySelector('.product-image img')?.src
      || document.querySelector('[class*="productImageTag"]')?.src
      || document.querySelector('[class*="product-image"] img')?.src
      || '';

    category = window.VTON_GARMENT_CATEGORY
      || document.querySelector('[data-vton-category]')?.dataset?.vtonCategory
      || 'auto';

    resetModal();
    document.getElementById('nksw-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('nksw-overlay').classList.remove('active');
    document.body.style.overflow = '';
    clearSSE();
  }

  function resetModal() {
    personBase64 = null;
    currentJobId = null;
    clearSSE();
    show('nksw-upload-area');
    hide('nksw-status');
    hide('nksw-result');
    hide('nksw-error');
    hide('nksw-preview-img');
    document.getElementById('nksw-btn-try').disabled = true;
    document.getElementById('nksw-file').value = '';
    document.getElementById('nksw-progress-bar').style.width = '0%';
  }

  function bindModal() {
    const overlay = document.getElementById('nksw-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.getElementById('nksw-close').addEventListener('click', closeModal);

    const uploadArea = document.getElementById('nksw-upload-area');
    uploadArea.addEventListener('click', () => document.getElementById('nksw-file').click());
    uploadArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') document.getElementById('nksw-file').click();
    });

    document.getElementById('nksw-file').addEventListener('change', handleFileSelect);
    document.getElementById('nksw-btn-try').addEventListener('click', startTryOn);
    document.getElementById('nksw-btn-retry').addEventListener('click', resetModal);
    document.getElementById('nksw-btn-save').addEventListener('click', savePhoto);
  }

  // ─── Upload e redimensionamento ───────────────────────────────────────────

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    resizeImage(file, 1024, (base64) => {
      personBase64 = base64;
      const preview = document.getElementById('nksw-preview-img');
      preview.src = base64;
      preview.style.display = 'block';
      document.getElementById('nksw-upload-icon').style.display = 'none';
      document.getElementById('nksw-upload-label').textContent = file.name;
      document.getElementById('nksw-btn-try').disabled = false;
    });
  }

  function resizeImage(file, maxSize, cb) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else       { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ─── Try-on ───────────────────────────────────────────────────────────────

  async function startTryOn() {
    if (!personBase64) return;
    hide('nksw-upload-area');
    hide('nksw-preview-img');
    hide('nksw-error');
    show('nksw-status');
    setStatusText('Gerando seu look...');
    setStatusSub('Aguarde alguns segundos');
    animateProgress(0, 20, 4000);

    try {
      const res = await fetch(`${API_URL}/api/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personImage:  personBase64,
          garmentImage: garmentUrl,
          category,
          clientKey: CLIENT_KEY,
        }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Erro ao iniciar o processamento');

      if (data.output) {
        animateProgress(20, 100, 800);
        setTimeout(() => showResult(data.output), 900);
        return;
      }

      if (!data.jobId) throw new Error(data.error || 'Resposta inesperada da API');

      currentJobId = data.jobId;
      setStatusText('A IA está trabalhando...');
      setStatusSub('Pode levar até 30 segundos');
      animateProgress(20, 85, 30000);
      startSSE(currentJobId);

    } catch (err) {
      showError(err.message || 'Não foi possível conectar. Tente novamente.');
      console.error('[Provador Virtual] Erro:', err);
    }
  }

  function startSSE(jobId) {
    clearSSE();

    const es = new EventSource(`${API_URL}/api/result?jobId=${jobId}`);
    sseSource = es;

    // Timeout de segurança no lado do cliente
    sseTimeout = setTimeout(() => {
      clearSSE();
      showError('O processamento demorou mais que o esperado. Tente novamente.');
    }, SSE_TIMEOUT_MS);

    es.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch (_) { return; }

      if (data.status === 'done') {
        clearSSE();
        animateProgress(85, 100, 500);
        setTimeout(() => showResult(data.resultImage), 600);
      } else if (data.status === 'error') {
        clearSSE();
        showError(data.error || 'Não foi possível processar. Tente com outra foto.');
      }
      // pending / processing: heartbeat — não faz nada, apenas mantém a barra animando
    };

    es.onerror = () => {
      clearSSE();
      showError('Conexão perdida. Verifique sua internet e tente novamente.');
    };
  }

  function clearSSE() {
    if (sseSource)    { sseSource.close();           sseSource    = null; }
    if (sseTimeout)   { clearTimeout(sseTimeout);    sseTimeout   = null; }
    if (progressTimer){ clearInterval(progressTimer);progressTimer= null; }
  }

  // ─── Progresso visual ─────────────────────────────────────────────────────

  function animateProgress(from, to, durationMs) {
    const bar = document.getElementById('nksw-progress-bar');
    const steps = 30;
    const step  = (to - from) / steps;
    let current = from, count = 0;
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      current += step; count++;
      bar.style.width = Math.min(current, to) + '%';
      if (count >= steps) clearInterval(progressTimer);
    }, durationMs / steps);
  }

  // ─── Resultado ────────────────────────────────────────────────────────────

  function showResult(imageDataUrl) {
    hide('nksw-status');
    document.getElementById('nksw-result-img').src = imageDataUrl;
    show('nksw-result');
  }

  function savePhoto() {
    const img = document.getElementById('nksw-result-img');
    if (!img.src) return;
    const a = document.createElement('a');
    a.href = img.src;
    a.download = 'meu-look-provador-virtual.jpg';
    a.click();
  }

  // ─── Helpers de UI ───────────────────────────────────────────────────────

  function show(id, displayType) {
    const el = document.getElementById(id);
    if (el) el.style.display = displayType || 'block';
  }

  function hide(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function setStatusText(t) {
    const el = document.getElementById('nksw-status-text');
    if (el) el.textContent = t;
  }

  function setStatusSub(t) {
    const el = document.getElementById('nksw-status-sub');
    if (el) el.textContent = t;
  }

  function showError(msg) {
    hide('nksw-status');
    show('nksw-upload-area');
    const el = document.getElementById('nksw-error');
    el.textContent = msg;
    el.style.display = 'block';
    document.getElementById('nksw-btn-try').disabled = false;
  }

  // ─── Inicializa ───────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
