/**
 * Mirage — Widget de Provador Virtual v6.2
 * Design: NKSW v4 | Efeito de renderização + formulário abaixo do resultado
 */
(function () {
  'use strict';

  const MAX_PX        = 1200;
  const JPEG_QUALITY  = 0.88;
  const POLL_MS       = 2000;
  const POLL_TIMEOUT  = 90000;

  // ─── Configuração ──────────────────────────────────────────────────────────
  const CFG = {
    apiUrl    : (window.VTON_API_URL    || '').replace(/\/$/, ''),
    clientKey : window.VTON_CLIENT_KEY  || '',
    garmentUrl: window.VTON_GARMENT_URL || '',
    category  : window.VTON_GARMENT_CATEGORY || 'auto',
    storeName : window.VTON_STORE_NAME  || '',
    btnText   : window.VTON_BTN_TEXT    || 'Experimentar virtualmente',
    btnBg     : window.VTON_BTN_BG      || '#111111',
    btnColor  : window.VTON_BTN_COLOR   || '#ffffff',
    btnWidth  : window.VTON_BTN_WIDTH   || '100%',
    btnHeight : window.VTON_BTN_HEIGHT  || '52px',
    btnRadius : window.VTON_BTN_RADIUS  || '12px',
  };

  if (!CFG.apiUrl) {
    console.warn('[Mirage] window.VTON_API_URL não definido.');
    return;
  }

  // ─── CSS ───────────────────────────────────────────────────────────────────
  const CSS = `
    .nksw-overlay {
      position: fixed; inset: 0; z-index: 99999;
      background: rgba(0,0,0,0.68);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      animation: nksw-fade-in 0.2s ease;
    }
    @keyframes nksw-fade-in { from { opacity: 0 } to { opacity: 1 } }

    .nksw-modal {
      background: #fff; border-radius: 20px;
      width: 100%; max-width: 420px; max-height: 90dvh;
      overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.22);
      display: flex; flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    }

    /* ── Header ── */
    .nksw-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 20px 14px; border-bottom: 1px solid #f0f0f0;
      position: sticky; top: 0; background: #fff; z-index: 2;
    }
    .nksw-title-wrap { display: flex; align-items: center; gap: 8px; }
    .nksw-title-logo { height: 28px; width: auto; display: block; }
    .nksw-title { font-size: 15px; font-weight: 700; color: #111; margin: 0; letter-spacing: 0.01em; }
    .nksw-close {
      background: #f4f4f4; border: none; cursor: pointer;
      width: 30px; height: 30px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      color: #555; font-size: 18px; line-height: 1;
      transition: background 0.15s; flex-shrink: 0;
    }
    .nksw-close:hover { background: #e8e8e8; color: #111; }

    /* ── Body ── */
    .nksw-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; flex: 1; }

    /* ── Upload Zone ── */
    .nksw-upload-zone {
      text-align: center; cursor: pointer;
      position: relative; padding: 24px 0 0;
      transition: background 0.2s; border-radius: 12px;
    }
    .nksw-upload-zone:hover { background: #fafafa; }
    .nksw-upload-zone input[type=file] {
      position: absolute; inset: 0; opacity: 0; cursor: pointer;
      width: 100%; height: 100%; z-index: 1;
    }
    .nksw-camera-icon {
      width: 54px; height: 54px; background: #F5C53F; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 14px; box-shadow: 0 4px 12px rgba(245,197,63,0.35);
    }
    .nksw-camera-icon svg { width: 26px; height: 26px; stroke: #fff; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .nksw-upload-title { font-size: 17px; font-weight: 700; color: #111; margin: 0 0 6px; letter-spacing: -0.01em; }
    .nksw-upload-sub { font-size: 13px; color: #777; margin: 0 auto 16px; line-height: 1.55; max-width: 260px; }
    .nksw-upload-inner-zone {
      border: 2px dashed #d4d4d4; border-radius: 12px; padding: 20px 16px;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      transition: border-color 0.2s, background 0.2s;
    }
    .nksw-upload-zone:hover .nksw-upload-inner-zone { border-color: #aaa; }
    .nksw-upload-zone.drag-over .nksw-upload-inner-zone { border-color: #555; background: #f5f5f5; }
    .nksw-upload-arrow { color: #888; }
    .nksw-upload-btn {
      display: inline-flex; align-items: center; gap: 7px;
      background: #111; color: #fff; border: none; border-radius: 8px;
      padding: 10px 22px; font-size: 14px; font-weight: 600;
      cursor: pointer; letter-spacing: 0.01em; pointer-events: none;
    }
    .nksw-upload-btn svg { width: 14px; height: 14px; stroke: #fff; fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
    .nksw-upload-hint { font-size: 11px; color: #bbb; margin: 0; letter-spacing: 0.04em; }

    /* ── Preview ── */
    .nksw-preview-wrap { display: none; flex-direction: column; align-items: center; gap: 10px; }
    .nksw-preview-wrap.visible { display: flex; }
    .nksw-preview-img { width: 100%; max-height: 280px; object-fit: contain; border-radius: 12px; border: 1px solid #eee; background: #f8f8f8; }
    .nksw-change-btn {
      background: none; border: 1px solid #ccc; border-radius: 8px;
      padding: 7px 16px; font-size: 13px; cursor: pointer; color: #555;
      transition: border-color 0.15s, color 0.15s;
    }
    .nksw-change-btn:hover { border-color: #888; color: #111; }

    /* ── Generate Button ── */
    .nksw-generate-btn {
      width: 100%; padding: 15px; background: #111; color: #fff;
      border: none; border-radius: 12px; font-size: 13px; font-weight: 700;
      cursor: pointer; transition: background 0.2s, opacity 0.2s;
      letter-spacing: 1.8px; text-transform: uppercase;
    }
    .nksw-generate-btn:hover:not(:disabled) { background: #2a2a2a; }
    .nksw-generate-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .nksw-generate-btn.nksw-hidden { display: none; }

    /* ── Render Canvas ── */
    .nksw-render-canvas { display: none; flex-direction: column; gap: 12px; }
    .nksw-render-canvas.visible { display: flex; }

    .nksw-render-box {
      position: relative; border-radius: 14px; overflow: hidden;
      background: #0a0a0a; border: 1.5px solid #1a1a1a;
      width: 100%; aspect-ratio: 3 / 4;
    }

    .nksw-render-person {
      width: 100%; height: 100%; object-fit: contain; display: block;
    }

    .nksw-render-result {
      position: absolute; inset: 0;
      width: 100%; height: 100%; object-fit: contain;
      display: none; opacity: 0;
      transition: opacity 0.7s ease;
    }
    .nksw-render-result.visible { display: block; opacity: 1; }

    /* Scanline amarelo */
    .nksw-scanline {
      position: absolute; left: 0; right: 0; height: 10%;
      background: linear-gradient(180deg, transparent, rgba(255,227,78,0.9), transparent);
      filter: blur(2px); pointer-events: none;
      display: none; z-index: 2;
    }
    .nksw-scanline.active { display: block; animation: nksw-scanline-anim 2.4s cubic-bezier(.4,.1,.4,1) infinite; }
    @keyframes nksw-scanline-anim {
      0%   { top: -10%; opacity: 0; }
      8%   { opacity: 1; }
      92%  { opacity: 1; }
      100% { top: 110%; opacity: 0; }
    }

    /* Cantos dourados */
    .nksw-corners { position: absolute; inset: 12px; pointer-events: none; z-index: 3; }
    .nksw-corners span { position: absolute; width: 16px; height: 16px; border: 2px solid #FFE34E; }
    .nksw-corners span:nth-child(1) { top: 0; left: 0; border-right: none; border-bottom: none; }
    .nksw-corners span:nth-child(2) { top: 0; right: 0; border-left: none; border-bottom: none; }
    .nksw-corners span:nth-child(3) { bottom: 0; left: 0; border-right: none; border-top: none; }
    .nksw-corners span:nth-child(4) { bottom: 0; right: 0; border-left: none; border-top: none; }

    /* HUD */
    .nksw-hud { position: absolute; top: 10px; left: 10px; z-index: 4; display: flex; flex-direction: column; gap: 5px; }
    .nksw-hud-chip {
      display: inline-flex; align-items: center; gap: 5px;
      font-family: 'JetBrains Mono', 'Courier New', monospace;
      font-size: 9px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase;
      padding: 4px 9px; border-radius: 5px;
      background: #111; color: #fff; border: 1px solid rgba(255,255,255,0.12);
    }
    .nksw-hud-chip.yellow { background: #FFE34E; color: #0a0a0a; border-color: rgba(0,0,0,0.15); }
    .nksw-hud-dot {
      width: 5px; height: 5px; border-radius: 50%; background: #FFE34E;
      animation: nksw-pulse-dot 1.2s infinite; flex-shrink: 0;
    }
    .nksw-hud-chip.yellow .nksw-hud-dot { background: #0a0a0a; animation: none; }
    @keyframes nksw-pulse-dot {
      0%,100% { opacity: 0.35; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.4); }
    }

    /* Área de loading (progresso + texto) */
    .nksw-loading-area { display: none; flex-direction: column; gap: 8px; }
    .nksw-loading-area.visible { display: flex; }
    .nksw-loading-text { font-size: 13px; color: #666; text-align: center; line-height: 1.6; margin: 0; }
    .nksw-progress { width: 100%; height: 3px; background: #eee; border-radius: 2px; overflow: hidden; }
    .nksw-progress-bar { height: 100%; background: #111; border-radius: 2px; transition: width 1.8s ease; width: 0%; }

    /* Ações do resultado */
    .nksw-result-actions { display: none; gap: 10px; }
    .nksw-result-actions.visible { display: flex; }
    .nksw-retry-btn {
      flex: 1; padding: 12px; background: none; border: 1.5px solid #ddd;
      border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer;
      color: #444; transition: border-color 0.15s, background 0.15s;
    }
    .nksw-retry-btn:hover { background: #f5f5f5; border-color: #bbb; }
    .nksw-save-btn {
      flex: 1; padding: 12px; background: #111; color: #fff;
      border: none; border-radius: 10px; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: background 0.2s;
    }
    .nksw-save-btn:hover { background: #333; }

    /* ── Error ── */
    .nksw-error {
      display: none; background: #fff3f3; border: 1px solid #ffc0c0;
      border-radius: 10px; padding: 12px 16px; font-size: 13px; color: #c00; text-align: center;
    }
    .nksw-error.visible { display: block; }

    /* ── Lead ── */
    .nksw-lead { display: none; flex-direction: column; gap: 10px; }
    .nksw-lead.visible { display: flex; }
    .nksw-lead-inner {
      width: 100%; background: #f9f9f9; border-radius: 12px;
      padding: 16px; display: flex; flex-direction: column; gap: 10px;
    }
    .nksw-lead-title { font-size: 14px; font-weight: 700; color: #111; margin: 0; text-align: center; }
    .nksw-lead-sub   { font-size: 12px; color: #666; margin: 0; text-align: center; line-height: 1.5; }
    .nksw-lead input {
      width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px;
      font-size: 14px; font-family: inherit; box-sizing: border-box; outline: none;
      transition: border-color 0.2s;
    }
    .nksw-lead input:focus { border-color: #111; }
    .nksw-lead-submit {
      width: 100%; padding: 11px; background: #111; color: #fff;
      border: none; border-radius: 8px; font-size: 14px; font-weight: 600;
      cursor: pointer; transition: background 0.2s;
    }
    .nksw-lead-submit:hover { background: #333; }
    .nksw-lead-submit:disabled { opacity: 0.6; cursor: not-allowed; }
    .nksw-lead-skip {
      background: none; border: none; font-size: 12px; color: #aaa;
      cursor: pointer; text-decoration: underline; align-self: center; padding: 0;
    }
    .nksw-lead-skip:hover { color: #666; }
    .nksw-lead-sent { font-size: 13px; color: #2a7a2a; text-align: center; font-weight: 600; margin: 0; display: none; }

    /* ── LGPD Notice ── */
    .nksw-lgpd-notice {
      display: none; align-items: flex-start; gap: 9px;
      background: #f7f7f7; border-radius: 10px; padding: 12px 14px;
    }
    .nksw-lgpd-notice.visible { display: flex; }
    .nksw-lgpd-notice svg { width: 15px; height: 15px; flex-shrink: 0; margin-top: 1px; stroke: #999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .nksw-lgpd-notice p { font-size: 10.5px; color: #888; margin: 0; line-height: 1.65; }
    .nksw-lgpd-notice a { color: #666; text-decoration: underline; }
    .nksw-lgpd-notice a:hover { color: #111; }

    /* ── Footer ── */
    .nksw-footer {
      padding: 10px 20px 14px;
      display: flex; align-items: center; justify-content: space-between;
      border-top: 1px solid #f0f0f0; gap: 12px;
    }
    .nksw-disclaimer { font-size: 10px; color: #ccc; margin: 0; line-height: 1.4; }
    .nksw-powered-by {
      display: flex; align-items: center; gap: 5px;
      text-decoration: none; flex-shrink: 0;
      opacity: 0.65; transition: opacity 0.15s;
    }
    .nksw-powered-by:hover { opacity: 1; }
    .nksw-powered-by-label { font-size: 9px; color: #aaa; letter-spacing: 0.04em; white-space: nowrap; text-transform: uppercase; }
    .nksw-powered-by img { height: 16px; width: auto; display: block; }
    .nksw-powered-by-fallback { font-size: 12px; font-weight: 800; color: #111; letter-spacing: 0.12em; font-family: Georgia, 'Times New Roman', serif; display: none; }

    /* ── Trigger Button ── */
    .nksw-trigger-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      cursor: pointer; transition: opacity 0.2s; font-family: inherit;
      border: none; letter-spacing: 0.06em; text-transform: uppercase;
      font-size: 14px; font-weight: 700;
    }
    .nksw-trigger-btn:hover { opacity: 0.85; }

    @media (max-width: 480px) {
      .nksw-modal { max-height: 100dvh; border-radius: 20px 20px 0 0; }
      .nksw-overlay { align-items: flex-end; padding: 0; }
      .nksw-render-box { aspect-ratio: 3 / 4; }
    }
  `;

  function injectStyles() {
    if (document.getElementById('nksw-tryon-styles')) return;
    const s = document.createElement('style');
    s.id = 'nksw-tryon-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ─── Utilitários de imagem ─────────────────────────────────────────────────
  function processImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > MAX_PX || height > MAX_PX) {
          const r = Math.min(MAX_PX / width, MAX_PX / height);
          width = Math.round(width * r);
          height = Math.round(height * r);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        if (!dataUrl || dataUrl === 'data:,') return reject(new Error('Falha ao processar imagem'));
        resolve(dataUrl);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida')); };
      img.src = url;
    });
  }

  function dataURLtoBlob(dataURL) {
    const [header, data] = dataURL.split(',');
    const mime   = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    const binary = atob(data);
    const buf    = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }

  function toAbsoluteUrl(url) {
    if (!url) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (!url.startsWith('http')) return 'https://' + url;
    return url;
  }

  // ─── Constrói o modal ──────────────────────────────────────────────────────
  function buildModal(storeName) {
    const leadSub = storeName
      ? `Cadastre-se e receba as novidades da ${storeName} em primeira mão!`
      : 'Cadastre-se para receber novidades e promoções em primeira mão!';

    const overlay = document.createElement('div');
    overlay.className = 'nksw-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Provador Virtual');
    overlay.innerHTML = `
      <div class="nksw-modal">
        <div class="nksw-header">
          <div class="nksw-title-wrap">
            <img
              class="nksw-title-logo"
              src="https://www.mirageai.com.br/logo-mirage.png"
              alt="Mirage"
              onerror="this.style.display='none'"
            />
            <h2 class="nksw-title">Provador Virtual</h2>
          </div>
          <button class="nksw-close" aria-label="Fechar">&times;</button>
        </div>
        <div class="nksw-body">

          <!-- 1. Upload Zone -->
          <div class="nksw-upload-zone" id="nksw-drop-zone" tabindex="0" role="button" aria-label="Enviar sua foto">
            <input type="file" id="nksw-file-input" accept="image/jpeg,image/png,image/webp" />
            <div class="nksw-camera-icon">
              <svg viewBox="0 0 24 24">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </div>
            <p class="nksw-upload-title">Sua prova começa aqui</p>
            <p class="nksw-upload-sub">Envie uma foto sua de corpo inteiro para experimentar a peça selecionada.</p>
            <div class="nksw-upload-inner-zone">
              <svg class="nksw-upload-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <button class="nksw-upload-btn" type="button">
                <svg viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Enviar foto
              </button>
              <p class="nksw-upload-hint">JPG · PNG · ATÉ 2MB</p>
            </div>
          </div>

          <!-- 2. Preview pequena após upload -->
          <div class="nksw-preview-wrap" id="nksw-preview-wrap">
            <img class="nksw-preview-img" id="nksw-preview-img" alt="Sua foto" />
            <button class="nksw-change-btn" id="nksw-change-btn">Trocar foto</button>
          </div>

          <!-- 3. Render Canvas (processando + resultado) -->
          <div class="nksw-render-canvas" id="nksw-render-canvas">
            <div class="nksw-render-box" id="nksw-render-box">
              <!-- Foto da pessoa (mostrada durante o processamento) -->
              <img class="nksw-render-person" id="nksw-render-person" alt="Sua foto" />
              <!-- Resultado da IA (aparece com crossfade quando pronto) -->
              <img class="nksw-render-result" id="nksw-render-result" alt="Resultado" />
              <!-- Scanline animado -->
              <div class="nksw-scanline" id="nksw-scanline"></div>
              <!-- Cantos dourados -->
              <div class="nksw-corners"><span></span><span></span><span></span><span></span></div>
              <!-- HUD de status -->
              <div class="nksw-hud">
                <div class="nksw-hud-chip" id="nksw-hud-chip">
                  <span class="nksw-hud-dot" id="nksw-hud-dot"></span>
                  <span id="nksw-hud-status">PROCESSANDO</span>
                </div>
                <div class="nksw-hud-chip" style="background:#0a0a0a;color:#888;font-size:8px">v4.2</div>
              </div>
            </div>
            <!-- Progresso e texto (visíveis só durante loading) -->
            <div class="nksw-loading-area" id="nksw-loading-area">
              <p class="nksw-loading-text" id="nksw-loading-text">
                Gerando seu look... Isso leva cerca de 10–20 segundos
              </p>
              <div class="nksw-progress">
                <div class="nksw-progress-bar" id="nksw-progress-bar"></div>
              </div>
            </div>
            <!-- Ações (visíveis só após o resultado) -->
            <div class="nksw-result-actions" id="nksw-result-actions">
              <button class="nksw-retry-btn" id="nksw-retry-btn">↺ Tentar novamente</button>
              <button class="nksw-save-btn"  id="nksw-save-btn">↓ Salvar foto</button>
            </div>
          </div>

          <!-- 4. Erro -->
          <div class="nksw-error" id="nksw-error"></div>

          <!-- 5. Botão gerar (visível só com preview) -->
          <button class="nksw-generate-btn" id="nksw-generate-btn" disabled>
            EXPERIMENTAR VIRTUALMENTE
          </button>

          <!-- 6. Formulário de lead (abaixo do resultado) -->
          <div class="nksw-lead" id="nksw-lead">
            <div class="nksw-lead-inner" id="nksw-lead-inner">
              <p class="nksw-lead-title">Gostou do resultado?</p>
              <p class="nksw-lead-sub">${leadSub}</p>
              <input id="nksw-lead-name"  type="text"  placeholder="Seu nome"   autocomplete="name" />
              <input id="nksw-lead-phone" type="tel"   placeholder="WhatsApp"   autocomplete="tel" />
              <input id="nksw-lead-email" type="email" placeholder="Seu e-mail" autocomplete="email" />
              <button class="nksw-lead-submit" id="nksw-lead-submit">Quero receber novidades</button>
              <button class="nksw-lead-skip"   id="nksw-lead-skip">Pular</button>
            </div>
            <p class="nksw-lead-sent" id="nksw-lead-sent">
              ✅ Cadastro realizado! Fique de olho na sua caixa de entrada.
            </p>
          </div>

          <!-- 7. Aviso LGPD (exibido após gerar a foto) -->
          <div class="nksw-lgpd-notice" id="nksw-lgpd-notice">
            <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <p>
              Imagens processadas em sessão temporária e descartadas automaticamente,
              em conformidade com a <strong>LGPD</strong> e GDPR. Ao usar este serviço, você concorda
              com a <a href="https://www.mirageai.com.br" target="_blank" rel="noopener">Política de Privacidade</a>
              e os <a href="https://www.mirageai.com.br" target="_blank" rel="noopener">Termos de Uso</a> da Mirage.
            </p>
          </div>

        </div>

        <!-- Footer com powered by Mirage -->
        <div class="nksw-footer">
          <p class="nksw-disclaimer">🔒 Foto processada em tempo real, sem armazenamento.</p>
          <a href="https://www.mirageai.com.br" target="_blank" rel="noopener" class="nksw-powered-by" title="Powered by Mirage">
            <span class="nksw-powered-by-label">powered by</span>
            <img
              src="https://www.mirageai.com.br/logo-mirage.png"
              alt="Mirage"
              onerror="this.style.display='none';this.nextElementSibling.style.display='block';"
            />
            <span class="nksw-powered-by-fallback">MIRAGE</span>
          </a>
        </div>
      </div>
    `;
    return overlay;
  }

  // ─── Inicializa o modal para uma instância do widget ──────────────────────
  function initModal(instanceCfg) {
    const apiUrl     = instanceCfg.apiUrl     || CFG.apiUrl;
    const clientKey  = instanceCfg.clientKey  || CFG.clientKey;
    const garmentUrl = toAbsoluteUrl(instanceCfg.garmentUrl || CFG.garmentUrl
      || document.querySelector('[data-vton-image]')?.dataset?.vtonImage
      || document.querySelector('.product__media img')?.src
      || document.querySelector('.product-featured-img')?.src
      || document.querySelector('.woocommerce-product-gallery__image img')?.src
      || document.querySelector('[class*="productImageTag"]')?.src
      || '');
    const category   = instanceCfg.category  || CFG.category;
    const storeName  = instanceCfg.storeName  || CFG.storeName;

    if (!clientKey) { console.error('[Mirage] VTON_CLIENT_KEY não definido.'); return; }

    const overlay = buildModal(storeName);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Refs
    const $ = id => overlay.querySelector('#' + id);
    const dropZone      = $('nksw-drop-zone');
    const fileInput     = $('nksw-file-input');
    const previewWrap   = $('nksw-preview-wrap');
    const previewImg    = $('nksw-preview-img');
    const changeBtn     = $('nksw-change-btn');
    const generateBtn   = $('nksw-generate-btn');
    const renderCanvas  = $('nksw-render-canvas');
    const renderPerson  = $('nksw-render-person');
    const renderResult  = $('nksw-render-result');
    const scanLine      = $('nksw-scanline');
    const hudChip       = $('nksw-hud-chip');
    const hudStatus     = $('nksw-hud-status');
    const loadingArea   = $('nksw-loading-area');
    const loadingText   = $('nksw-loading-text');
    const progressBar   = $('nksw-progress-bar');
    const resultActions = $('nksw-result-actions');
    const retryBtn      = $('nksw-retry-btn');
    const saveBtn       = $('nksw-save-btn');
    const errorDiv      = $('nksw-error');
    const leadWrap      = $('nksw-lead');
    const leadInner     = $('nksw-lead-inner');
    const leadName      = $('nksw-lead-name');
    const leadPhone     = $('nksw-lead-phone');
    const leadEmail     = $('nksw-lead-email');
    const leadSubmit    = $('nksw-lead-submit');
    const leadSkip      = $('nksw-lead-skip');
    const leadSent      = $('nksw-lead-sent');
    const lgpdNotice    = $('nksw-lgpd-notice');
    const closeBtn      = overlay.querySelector('.nksw-close');

    // Estado
    let selectedDataUrl = null;
    let pollTimer       = null;
    let pollStart       = null;
    let currentJobId    = null;
    let pendingLead     = null;
    let leadDone        = false;

    // ── Helpers de UI ──────────────────────────────────────────────────────
    function showError(msg) { errorDiv.textContent = msg; errorDiv.classList.add('visible'); }
    function clearError()   { errorDiv.classList.remove('visible'); }
    function setProgress(p) { progressBar.style.width = `${p}%`; }

    function setHudProcessing() {
      hudChip.classList.remove('yellow');
      hudStatus.textContent = 'PROCESSANDO';
    }
    function setHudDone() {
      hudChip.classList.add('yellow');
      hudStatus.textContent = 'RENDER OK';
    }

    function shakeLeadForm() {
      const steps = [6, -6, 4, -4, 0];
      let delay = 0;
      steps.forEach(x => {
        setTimeout(() => { leadInner.style.transform = `translateX(${x}px)`; }, delay);
        delay += 80;
      });
      setTimeout(() => { leadInner.style.transform = ''; }, delay);
      leadEmail.focus();
    }

    function leadIsBeingFilled() {
      if (leadDone || !leadWrap.classList.contains('visible')) return false;
      return !!(leadName.value.trim() || leadPhone.value.trim() || leadEmail.value.trim());
    }

    // ── Lead submit ────────────────────────────────────────────────────────
    async function submitLead() {
      const name     = leadName.value.trim();
      const whatsapp = leadPhone.value.trim();
      const email    = leadEmail.value.trim();

      if (!email || !email.includes('@')) { shakeLeadForm(); return; }

      leadSubmit.disabled    = true;
      leadSubmit.textContent = 'Enviando...';

      const lead = { name, email, whatsapp };

      if (!currentJobId) {
        pendingLead = lead;
        leadInner.style.display = 'none';
        leadSent.style.display  = 'block';
        leadSent.textContent    = '✅ Dados salvos! Aguardando resultado...';
        leadDone = true;
        return;
      }

      await postLead(lead);
    }

    async function postLead(lead) {
      try {
        await fetch(`${apiUrl}/api/save-lead`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ jobId: currentJobId, clientKey, lead }),
        });
      } catch (_) {}

      leadInner.style.display = 'none';
      leadSent.style.display  = 'block';
      leadSent.textContent    = '✅ Cadastro realizado! Fique de olho na sua caixa de entrada.';
      leadDone    = true;
      pendingLead = null;
    }

    leadSubmit.addEventListener('click', submitLead);
    leadSkip.addEventListener('click', () => {
      leadWrap.classList.remove('visible');
      leadDone = true;
    });

    // ── Upload ─────────────────────────────────────────────────────────────
    function setFile(file) {
      clearError();
      const objectUrl = URL.createObjectURL(file);
      previewImg.src  = objectUrl;
      previewImg.onload = () => URL.revokeObjectURL(objectUrl);
      dropZone.style.display = 'none';
      previewWrap.classList.add('visible');
      renderCanvas.classList.remove('visible');
      generateBtn.disabled = true;
      generateBtn.classList.remove('nksw-hidden');

      processImage(file)
        .then(dataUrl => { selectedDataUrl = dataUrl; generateBtn.disabled = false; })
        .catch(e => { showError(e.message); });
    }

    function resetToUpload() {
      clearInterval(pollTimer);
      selectedDataUrl = null;
      currentJobId    = null;
      pendingLead     = null;
      leadDone        = false;
      fileInput.value = '';
      previewImg.src  = '';

      // UI reset
      previewWrap.classList.remove('visible');
      renderCanvas.classList.remove('visible');
      renderResult.classList.remove('visible');
      renderResult.src = '';
      renderPerson.src = '';
      scanLine.classList.remove('active');
      loadingArea.classList.remove('visible');
      resultActions.classList.remove('visible');
      leadWrap.classList.remove('visible');
      lgpdNotice.classList.remove('visible');

      // Lead form reset
      leadInner.style.display = '';
      leadSent.style.display  = 'none';
      leadSubmit.disabled     = false;
      leadSubmit.textContent  = 'Quero receber novidades';
      leadName.value  = '';
      leadPhone.value = '';
      leadEmail.value = '';

      // HUD reset
      setHudProcessing();

      dropZone.style.display = '';
      generateBtn.disabled   = true;
      generateBtn.classList.remove('nksw-hidden');
      setProgress(0);
      clearError();
    }

    function closeModal() {
      clearInterval(pollTimer);
      overlay.remove();
      document.body.style.overflow = '';
    }

    function tryClose() {
      if (leadIsBeingFilled()) { shakeLeadForm(); return; }
      closeModal();
    }

    overlay.addEventListener('click', e => { if (e.target === overlay) tryClose(); });
    closeBtn.addEventListener('click', tryClose);
    const onKey = e => {
      if (e.key !== 'Escape') return;
      tryClose();
      if (!leadIsBeingFilled()) document.removeEventListener('keydown', onKey);
    };
    document.addEventListener('keydown', onKey);

    fileInput.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) setFile(f); });
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.classList.remove('drag-over');
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith('image/')) setFile(f);
    });

    changeBtn.addEventListener('click', resetToUpload);
    retryBtn.addEventListener('click',  resetToUpload);

    // ── Salvar foto ─────────────────────────────────────────────────────────
    saveBtn.addEventListener('click', () => {
      const src = renderResult.src;
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      let blobUrl = null;
      try { blobUrl = URL.createObjectURL(dataURLtoBlob(src)); } catch (_) {}

      if (isIOS) { window.open(blobUrl || src, '_blank'); return; }

      const a = document.createElement('a');
      a.href = blobUrl || src;
      a.download = 'meu-look-mirage.jpg';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); if (blobUrl) URL.revokeObjectURL(blobUrl); }, 200);
    });

    // ── Fluxo principal ────────────────────────────────────────────────────
    generateBtn.addEventListener('click', async () => {
      if (!selectedDataUrl) { showError('Aguarde o processamento da foto.'); return; }
      clearError();

      // ─ Inicia estado de renderização ─
      // Oculta preview e botão
      previewWrap.classList.remove('visible');
      generateBtn.classList.add('nksw-hidden');
      generateBtn.disabled = true;

      // Monta o render canvas com a foto da pessoa
      renderPerson.src = selectedDataUrl;
      renderResult.classList.remove('visible');
      renderResult.src = '';
      setHudProcessing();
      scanLine.classList.add('active');
      renderCanvas.classList.add('visible');
      loadingArea.classList.add('visible');
      resultActions.classList.remove('visible');

      // Mostra formulário de lead enquanto processa
      if (!leadDone) leadWrap.classList.add('visible');

      setProgress(10);

      try {
        // 1. URL de upload assinada
        const urlRes = await fetch(`${apiUrl}/api/upload-url`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ clientKey, contentType: 'image/jpeg' }),
        });
        const urlData = await urlRes.json();
        if (!urlRes.ok) {
          if (urlData.suspended) {
            // Conta suspensa — mostra mensagem com link para o painel
            const errMsg = document.getElementById('nksw-error');
            if (errMsg) {
              errMsg.innerHTML = `Plano suspenso. <a href="https://app.mirageai.com.br/painel-cliente.html" target="_blank" style="color:#635BFF;text-decoration:underline;">Regularize o pagamento →</a>`;
              errMsg.classList.add('visible');
            }
            // Restaura estado
            scanLine.classList.remove('active');
            renderCanvas.classList.remove('visible');
            previewWrap.classList.add('visible');
            generateBtn.classList.remove('nksw-hidden');
            generateBtn.disabled = false;
            loadingArea.classList.remove('visible');
            return;
          }
          throw new Error(urlData.error || 'Erro ao gerar URL de upload.');
        }
        setProgress(25);

        // 2. Upload para o GCS via PUT
        const blob = dataURLtoBlob(selectedDataUrl);
        const putRes = await fetch(urlData.signedUrl, {
          method:  'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body:    blob,
        });
        if (!putRes.ok) throw new Error('Falha no upload da foto. Tente novamente.');
        setProgress(40);

        // 3. Submete o job
        const submitRes = await fetch(`${apiUrl}/api/submit`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            personImageUrl: urlData.gcsUrl,
            garmentImage:   garmentUrl,
            category,
            clientKey,
            productUrl:     window.location.href,
            productName:    document.title || window.location.hostname,
          }),
        });
        const submitData = await submitRes.json();
        if (!submitRes.ok || !submitData.jobId) {
          // Limite de plano atingido — mensagem especial com link para o painel
          if (submitData.code === 'QUOTA_EXCEEDED') {
            const panelUrl = submitData.panelUrl || 'https://app.mirageai.com.br/painel-cliente.html';
            const errDiv = document.getElementById('nksw-error');
            if (errDiv) {
              errDiv.innerHTML = `Limite do plano atingido. <a href="${panelUrl}" target="_blank" style="color:#635BFF;font-weight:600;text-decoration:underline;">Comprar gerações extras ou fazer upgrade →</a>`;
              errDiv.classList.add('visible');
            }
            scanLine.classList.remove('active');
            renderCanvas.classList.remove('visible');
            previewWrap.classList.add('visible');
            generateBtn.classList.remove('nksw-hidden');
            generateBtn.disabled = false;
            loadingArea.classList.remove('visible');
            return;
          }
          throw new Error(submitData.error || 'Falha ao enviar para processamento.');
        }
        currentJobId = submitData.jobId;

        // 4. Lead pendente → envia agora
        if (pendingLead) await postLead(pendingLead);

        setProgress(55);

        // 5. Polling
        pollStart = Date.now();
        await new Promise((resolve, reject) => {
          pollTimer = setInterval(async () => {
            if (Date.now() - pollStart > POLL_TIMEOUT) {
              clearInterval(pollTimer);
              return reject(new Error('O processamento demorou mais que o esperado. Tente novamente.'));
            }
            const elapsed = Date.now() - pollStart;
            setProgress(Math.min(55 + (elapsed / POLL_TIMEOUT) * 40, 93));
            try {
              const pollRes  = await fetch(`${apiUrl}/api/result?jobId=${encodeURIComponent(currentJobId)}`);
              const pollData = await pollRes.json();
              if (pollData.status === 'done' || pollData.status === 'completed') {
                clearInterval(pollTimer);
                setProgress(100);

                // ─ Crossfade: scanline para → resultado aparece ─
                const resultUrl = pollData.resultImage || pollData.output;
                renderResult.onload = () => {
                  scanLine.classList.remove('active');
                  renderResult.classList.add('visible');
                  setHudDone();
                  loadingArea.classList.remove('visible');
                  resultActions.classList.add('visible');
                  lgpdNotice.classList.add('visible');
                };
                renderResult.src = resultUrl;
                resolve();

              } else if (pollData.status === 'error' || pollData.status === 'failed') {
                clearInterval(pollTimer);
                reject(new Error(pollData.error || 'Não foi possível processar. Tente com outra foto.'));
              }
            } catch (_) {}
          }, POLL_MS);
        });

        // Lead pendente (job acabou depois do preenchimento)
        if (pendingLead) await postLead(pendingLead);

      } catch (err) {
        // ─ Erro: restaura estado de preview ─
        scanLine.classList.remove('active');
        renderCanvas.classList.remove('visible');
        leadWrap.classList.remove('visible');
        previewWrap.classList.add('visible');
        generateBtn.classList.remove('nksw-hidden');
        generateBtn.disabled = false;
        showError(err?.message || 'Erro inesperado. Tente novamente.');
        setProgress(0);
        loadingArea.classList.remove('visible');
      }
    });
  }

  // ─── Cria o botão trigger e injeta no anchor ───────────────────────────────
  function createTriggerBtn(anchor) {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'nksw-trigger-btn';
    btn.style.cssText = [
      `background:${CFG.btnBg}`,
      `color:${CFG.btnColor}`,
      `width:${CFG.btnWidth}`,
      `height:${CFG.btnHeight}`,
      `border-radius:${CFG.btnRadius}`,
    ].join(';');
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
      ${CFG.btnText}
    `;
    anchor.appendChild(btn);
    return btn;
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();

    document.querySelectorAll('.nksw-tryon-btn').forEach(btn => {
      const apiUrl = btn.dataset.apiUrl || btn.dataset.workerUrl || CFG.apiUrl;
      btn.addEventListener('click', () => initModal({
        apiUrl,
        clientKey:  btn.dataset.clientKey  || CFG.clientKey,
        garmentUrl: btn.dataset.garmentUrl || CFG.garmentUrl,
        category:   btn.dataset.category   || CFG.category,
        storeName:  btn.dataset.storeName  || CFG.storeName,
      }));
    });

    const anchor = document.getElementById('vton-anchor');
    if (anchor) {
      const triggerBtn = createTriggerBtn(anchor);
      triggerBtn.addEventListener('click', () => initModal({}));
    } else {
      document.querySelectorAll('[data-vton]').forEach(el => {
        el.addEventListener('click', () => initModal({}));
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
