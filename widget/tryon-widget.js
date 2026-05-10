/**
 * Mirage — Widget de Provador Virtual v6.3
 * Design: NKSW v4 | Efeito de renderização + formulário abaixo do resultado
 */
(function () {
  'use strict';

  const MAX_PX        = 1200;
  const JPEG_QUALITY  = 0.88;
  const POLL_MS       = 2000;
  const POLL_TIMEOUT  = 90000;

  // ─── Mirage Analytics (Measurement Protocol GA4) ──────────────────────────
  const MGA = {
    mid: 'G-3CTR9CDSX4',
    sec: 'G-W38t4oSGW8scDifAUq0Q',
    _cid: null,
    cid() {
      if (this._cid) return this._cid;
      try {
        let id = localStorage.getItem('_mirage_cid');
        if (!id) {
          id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + '.' + Date.now());
          localStorage.setItem('_mirage_cid', id);
        }
        this._cid = id;
      } catch { this._cid = Math.random().toString(36).slice(2); }
      return this._cid;
    },
    send(name, params = {}) {
      try {
        fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${this.mid}&api_secret=${this.sec}`, {
          method: 'POST',
          body: JSON.stringify({
            client_id: this.cid(),
            events: [{ name, params: { engagement_time_msec: 100, ...params } }],
          }),
        }).catch(() => {});
      } catch (_) {}
    },
  };

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

    /* ── Tabs ── */
    .nksw-tabs {
      display: flex; border-bottom: 1px solid #f0f0f0;
      padding: 0 20px; gap: 4px;
    }
    .nksw-tab-btn {
      flex: 1; padding: 10px 8px; background: none; border: none;
      font-size: 13px; font-weight: 600; color: #999; cursor: pointer;
      border-bottom: 2px solid transparent; margin-bottom: -1px;
      transition: color 0.15s, border-color 0.15s; letter-spacing: 0.02em;
    }
    .nksw-tab-btn.active { color: #111; border-bottom-color: #F5C53F; }
    .nksw-tab-btn:hover:not(.active) { color: #555; }

    /* ── Sizing Pane — Multi-Step ── */
    .nksw-sizing-pane { display: none; flex-direction: column; flex: 1; }
    .nksw-sizing-pane.active { display: flex; }

    /* Step indicator */
    .nksw-fit-steps {
      display: flex; align-items: center; justify-content: center;
      padding: 14px 20px 0; gap: 0;
    }
    .nksw-fit-step-dot {
      width: 10px; height: 10px; border-radius: 50%; background: #e0e0e0;
      flex-shrink: 0; transition: background 0.25s, box-shadow 0.25s;
    }
    .nksw-fit-step-dot.done   { background: #111; }
    .nksw-fit-step-dot.active { background: #F5C53F; box-shadow: 0 0 0 3px rgba(245,197,63,0.28); }
    .nksw-fit-step-line {
      flex: 1; height: 2px; background: #e0e0e0; max-width: 40px; transition: background 0.25s;
    }
    .nksw-fit-step-line.done { background: #111; }

    /* Step panels */
    .nksw-fit-step-panel {
      display: none; flex-direction: column; gap: 14px;
      padding: 14px 20px 20px; flex: 1;
    }
    .nksw-fit-step-panel.active { display: flex; }

    .nksw-fit-step-title { font-size: 16px; font-weight: 800; color: #111; margin: 0; letter-spacing: -0.02em; }
    .nksw-fit-step-sub   { font-size: 12px; color: #999; margin: -8px 0 0; line-height: 1.5; }

    /* Input fields */
    .nksw-fit-field-wrap { display: flex; flex-direction: column; gap: 6px; }
    .nksw-fit-field-header { display: flex; align-items: center; justify-content: space-between; }
    .nksw-fit-field-label { font-size: 12px; font-weight: 600; color: #555; }
    .nksw-fit-unit-toggle { display: flex; background: #f2f2f2; border-radius: 6px; padding: 2px; gap: 2px; }
    .nksw-fit-unit-btn {
      padding: 2px 9px; border: none; background: none; cursor: pointer;
      font-size: 11px; font-weight: 600; color: #aaa; border-radius: 4px;
      transition: background 0.15s, color 0.15s;
    }
    .nksw-fit-unit-btn.active { background: #fff; color: #111; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .nksw-fit-input {
      padding: 11px 14px; border: 1.5px solid #e4e4e4; border-radius: 10px;
      font-size: 20px; font-weight: 700; font-family: inherit; outline: none;
      transition: border-color 0.2s; width: 100%; box-sizing: border-box; color: #111;
    }
    .nksw-fit-input:focus { border-color: #F5C53F; }
    .nksw-fit-input::placeholder { font-weight: 400; color: #ccc; font-size: 16px; }

    /* Avatar */
    .nksw-fit-avatar-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .nksw-fit-avatar-svg { width: 80px; height: auto; }

    /* Skin tone */
    .nksw-fit-skin-row { display: flex; align-items: center; gap: 8px; justify-content: center; }
    .nksw-fit-skin-dot {
      width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
      border: 2.5px solid transparent; transition: border-color 0.2s, transform 0.15s; flex-shrink: 0;
    }
    .nksw-fit-skin-dot:hover { transform: scale(1.1); }
    .nksw-fit-skin-dot.active { border-color: #F5C53F; transform: scale(1.12); }

    /* Sliders */
    .nksw-fit-sliders { display: flex; flex-direction: column; gap: 10px; }
    .nksw-fit-slider-row { display: flex; flex-direction: column; gap: 4px; }
    .nksw-fit-slider-header { display: flex; align-items: center; justify-content: space-between; }
    .nksw-fit-slider-label { font-size: 12px; font-weight: 600; color: #555; }
    .nksw-fit-slider-val   { font-size: 13px; font-weight: 800; color: #111; }
    .nksw-fit-slider {
      -webkit-appearance: none; appearance: none;
      width: 100%; height: 4px; border-radius: 2px; outline: none; cursor: pointer;
      background: linear-gradient(to right, #F5C53F 0%, #F5C53F var(--pct,0%), #e4e4e4 var(--pct,0%), #e4e4e4 100%);
    }
    .nksw-fit-slider::-webkit-slider-thumb {
      -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%;
      background: #111; border: 2.5px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.22); cursor: pointer;
    }
    .nksw-fit-slider::-moz-range-thumb {
      width: 18px; height: 18px; border-radius: 50%; background: #111;
      box-shadow: 0 1px 4px rgba(0,0,0,0.22); cursor: pointer; border: 2.5px solid #fff;
    }

    /* Result — Sizebay style */
    .nksw-fit-result-wrap { display: flex; flex-direction: column; gap: 10px; }
    .nksw-fit-sz-header { display: flex; align-items: flex-end; justify-content: space-between; }
    .nksw-fit-sz-number { font-size: 50px; font-weight: 900; color: #111; line-height: 1; letter-spacing: -0.04em; }
    .nksw-fit-quality-badge {
      font-size: 9px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
      padding: 4px 10px; border-radius: 20px; margin-bottom: 6px;
    }
    .nksw-fit-quality-badge.best { background: #111; color: #F5C53F; }
    .nksw-fit-quality-badge.alt  { background: #f3f4f6; color: #6b7280; }
    .nksw-fit-sz-nav { display: flex; align-items: center; gap: 6px; }
    .nksw-fit-sz-arrow {
      width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid #e0e0e0;
      background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 20px; color: #555; transition: all 0.15s; flex-shrink: 0; line-height: 1;
      padding: 0;
    }
    .nksw-fit-sz-arrow:hover:not([disabled]) { border-color: #999; color: #111; }
    .nksw-fit-sz-arrow[disabled] { opacity: 0.28; cursor: not-allowed; }
    .nksw-fit-sz-pills { display: flex; gap: 5px; flex: 1; }
    .nksw-fit-sz-pill {
      height: 32px; min-width: 32px; padding: 0 10px; border-radius: 16px;
      border: 2px solid #e0e0e0; background: #fff;
      font-size: 12px; font-weight: 700; color: #aaa;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: all 0.15s;
    }
    .nksw-fit-sz-pill.active { background: #111; border-color: #111; color: #fff; min-width: 40px; font-size: 14px; }
    .nksw-fit-sz-pill.adj    { color: #555; border-color: #ccc; }
    .nksw-fit-mannequin-wrap { position: relative; height: 210px; margin: 2px 0; }
    .nksw-fit-zone-row {
      position: absolute; left: 112px;
      display: flex; align-items: center; gap: 6px;
    }
    .nksw-fit-zone-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .nksw-fit-zone-name { font-size: 9px; color: #999; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 1px; }
    .nksw-fit-zone-label { font-size: 12px; font-weight: 700; color: #111; display: block; }
    .nksw-fit-measures-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
      background: #f9f9f9; border-radius: 14px; padding: 14px;
    }
    .nksw-fit-measure-item { display: flex; flex-direction: column; gap: 1px; }
    .nksw-fit-measure-name { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 0.05em; }
    .nksw-fit-measure-num  { font-size: 15px; font-weight: 800; color: #111; }
    .nksw-fit-no-table {
      background: #fffbe6; border: 1px solid #F5C53F; border-radius: 12px;
      padding: 12px 14px; font-size: 12px; color: #7a5c00; line-height: 1.6; text-align: center;
    }

    /* Nav buttons */
    .nksw-fit-nav { display: flex; gap: 8px; margin-top: auto; padding-top: 8px; }
    .nksw-fit-back-btn {
      flex: 0 0 44px; height: 44px; background: #f4f4f4; border: none; border-radius: 10px;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      color: #555; font-size: 18px; transition: background 0.15s; line-height: 1;
    }
    .nksw-fit-back-btn:hover { background: #e8e8e8; color: #111; }
    .nksw-fit-next-btn {
      flex: 1; padding: 13px; background: #111; color: #fff;
      border: none; border-radius: 10px; font-size: 13px; font-weight: 700;
      cursor: pointer; letter-spacing: 1.2px; text-transform: uppercase; transition: background 0.2s;
    }
    .nksw-fit-next-btn:hover:not(:disabled) { background: #2a2a2a; }
    .nksw-fit-next-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .nksw-fit-edit-btn {
      flex: 1; background: none; border: 1.5px solid #ddd; border-radius: 10px;
      padding: 13px; font-size: 13px; font-weight: 600; color: #555; cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .nksw-fit-edit-btn:hover { border-color: #999; color: #111; }

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

  // ─── Detecção de imagem para Nuvemshop ────────────────────────────────────
  function detectNuvemshopImage() {
    // Regex para trocar sufixo de tamanho por versão grande
    const upsize = src => src.replace(/-\d+-\d+(\.\w+)$/, '-1024-1024$1');

    // 1. API JS do Nuvemshop (window.LS.product.images)
    try {
      const lsImages = window.LS?.product?.images;
      if (lsImages && lsImages.length > 0) {
        const img = lsImages[0];
        const src = typeof img === 'string' ? img : (img.src || img.url || '');
        if (src && src.includes('mitiendanube.com')) return upsize(src);
      }
    } catch (_) {}

    // 2. Imagem já carregada no DOM com URL da CDN Nuvemshop
    const loaded = Array.from(document.querySelectorAll('img')).find(img =>
      img.src &&
      img.src.includes('mitiendanube.com/stores') &&
      img.src.includes('/products/') &&
      !img.src.includes('empty-placeholder') &&
      img.naturalWidth > 0
    );
    if (loaded) return upsize(loaded.src);

    // 3. Lazy loading (data-src / data-lazy-src / data-image)
    const lazy = document.querySelector(
      '[data-src*="mitiendanube.com/stores"][data-src*="/products/"],' +
      '[data-lazy-src*="mitiendanube.com/stores"][data-lazy-src*="/products/"],' +
      '[data-image*="mitiendanube.com/stores"][data-image*="/products/"]'
    );
    if (lazy) {
      const src = lazy.dataset.src || lazy.dataset.lazySrc || lazy.dataset.image || '';
      if (src) return upsize(src);
    }

    return null;
  }

  // ─── Detecção de imagem para Olist / VNDA ────────────────────────────────
  function detectVndaImage() {
    // Troca prefixo de tamanho para 1200x (ex: /150x/ → /1200x/)
    const upsize = src => src.replace(/\/\d+x\//, '/1200x/');
    // Reconhece CDN de produção (cdn.vnda.com.br) e desenvolvimento (cdn.vnda.dev)
    const isVnda = src => src.includes('cdn.vnda.com.br') || src.includes('cdn.vnda.dev');

    // 1. data-zoom-src no slide ativo
    const activeZoom = document.querySelector('.swiper-slide-active [data-zoom-src]');
    if (activeZoom) {
      const src = activeZoom.getAttribute('data-zoom-src') || '';
      if (isVnda(src)) return upsize(src);
    }

    // 2. Primeiro data-zoom-src da galeria
    const firstZoom = document.querySelector('[data-zoom-src]');
    if (firstZoom) {
      const src = firstZoom.getAttribute('data-zoom-src') || '';
      if (isVnda(src)) return upsize(src);
    }

    // 3. Imagem carregada no slide ativo (com upgrade de tamanho)
    const activeImg = document.querySelector('.swiper-slide-active img');
    if (activeImg && isVnda(activeImg.src || '')) {
      return upsize(activeImg.src);
    }

    // 4. Qualquer img visível com CDN da VNDA
    const loaded = Array.from(document.querySelectorAll('img')).find(img =>
      img.src && isVnda(img.src) && img.naturalWidth > 0
    );
    if (loaded) return upsize(loaded.src);

    return null;
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
        <div class="nksw-tabs">
          <button class="nksw-tab-btn active" id="nksw-tab-tryon">Experimentar</button>
          <button class="nksw-tab-btn" id="nksw-tab-sizing">Meu Tamanho</button>
        </div>
        <div class="nksw-body" id="nksw-tryon-pane">

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

        <!-- Painel Meu Tamanho — Multi-Step -->
        <div class="nksw-sizing-pane" id="nksw-sizing-pane">

          <!-- Step indicator -->
          <div class="nksw-fit-steps">
            <div class="nksw-fit-step-dot active" id="nksw-fit-dot-0"></div>
            <div class="nksw-fit-step-line" id="nksw-fit-line-0"></div>
            <div class="nksw-fit-step-dot" id="nksw-fit-dot-1"></div>
            <div class="nksw-fit-step-line" id="nksw-fit-line-1"></div>
            <div class="nksw-fit-step-dot" id="nksw-fit-dot-2"></div>
          </div>

          <!-- Step 1: dados básicos -->
          <div class="nksw-fit-step-panel active" id="nksw-fit-panel-0">
            <p class="nksw-fit-step-title">Suas medidas</p>
            <p class="nksw-fit-step-sub">Usadas apenas para estimar seu tamanho</p>
            <div class="nksw-fit-field-wrap">
              <div class="nksw-fit-field-header">
                <span class="nksw-fit-field-label">Altura</span>
                <div class="nksw-fit-unit-toggle">
                  <button class="nksw-fit-unit-btn active" id="nksw-height-cm" data-unit="cm" type="button">cm</button>
                  <button class="nksw-fit-unit-btn" id="nksw-height-in" data-unit="in" type="button">in</button>
                </div>
              </div>
              <input class="nksw-fit-input" type="number" id="nksw-fit-height" placeholder="165" min="100" max="230" />
            </div>
            <div class="nksw-fit-field-wrap">
              <div class="nksw-fit-field-header">
                <span class="nksw-fit-field-label">Peso</span>
                <div class="nksw-fit-unit-toggle">
                  <button class="nksw-fit-unit-btn active" id="nksw-weight-kg" data-unit="kg" type="button">kg</button>
                  <button class="nksw-fit-unit-btn" id="nksw-weight-lb" data-unit="lb" type="button">lb</button>
                </div>
              </div>
              <input class="nksw-fit-input" type="number" id="nksw-fit-weight" placeholder="60" min="30" max="300" />
            </div>
            <div class="nksw-fit-field-wrap">
              <div class="nksw-fit-field-header">
                <span class="nksw-fit-field-label">Idade <span style="color:#ccc;font-weight:400">(opcional)</span></span>
              </div>
              <input class="nksw-fit-input" type="number" id="nksw-fit-age" placeholder="25" min="10" max="99" />
            </div>
            <div class="nksw-fit-nav">
              <button class="nksw-fit-next-btn" id="nksw-fit-next-0" disabled>PRÓXIMO →</button>
            </div>
          </div>

          <!-- Step 2: silhueta -->
          <div class="nksw-fit-step-panel" id="nksw-fit-panel-1">
            <p class="nksw-fit-step-title">Ajuste sua silhueta</p>
            <div class="nksw-fit-avatar-wrap">
              <svg class="nksw-fit-avatar-svg" id="nksw-fit-avatar" viewBox="0 0 100 180" xmlns="http://www.w3.org/2000/svg">
                <circle id="nksw-avatar-head" cx="50" cy="16" r="10" />
                <path id="nksw-avatar-body" d="" />
              </svg>
              <div class="nksw-fit-skin-row" id="nksw-fit-skin-row">
                <div class="nksw-fit-skin-dot active" data-skin="#FDDBB4" style="background:#FDDBB4" title="Clara"></div>
                <div class="nksw-fit-skin-dot" data-skin="#E8B88A" style="background:#E8B88A" title="Média-clara"></div>
                <div class="nksw-fit-skin-dot" data-skin="#C68642" style="background:#C68642" title="Média"></div>
                <div class="nksw-fit-skin-dot" data-skin="#8D5524" style="background:#8D5524" title="Média-escura"></div>
                <div class="nksw-fit-skin-dot" data-skin="#4A2912" style="background:#4A2912" title="Escura"></div>
              </div>
            </div>
            <div class="nksw-fit-sliders">
              <div class="nksw-fit-slider-row">
                <div class="nksw-fit-slider-header">
                  <span class="nksw-fit-slider-label">Busto</span>
                  <span class="nksw-fit-slider-val" id="nksw-slider-bust-val">88 cm</span>
                </div>
                <input class="nksw-fit-slider" id="nksw-slider-bust" type="range" min="70" max="130" value="88" />
              </div>
              <div class="nksw-fit-slider-row">
                <div class="nksw-fit-slider-header">
                  <span class="nksw-fit-slider-label">Cintura</span>
                  <span class="nksw-fit-slider-val" id="nksw-slider-waist-val">68 cm</span>
                </div>
                <input class="nksw-fit-slider" id="nksw-slider-waist" type="range" min="55" max="110" value="68" />
              </div>
              <div class="nksw-fit-slider-row">
                <div class="nksw-fit-slider-header">
                  <span class="nksw-fit-slider-label">Quadril</span>
                  <span class="nksw-fit-slider-val" id="nksw-slider-hip-val">96 cm</span>
                </div>
                <input class="nksw-fit-slider" id="nksw-slider-hip" type="range" min="75" max="135" value="96" />
              </div>
            </div>
            <div class="nksw-fit-nav">
              <button class="nksw-fit-back-btn" id="nksw-fit-back-1" type="button">←</button>
              <button class="nksw-fit-next-btn" id="nksw-fit-next-1" type="button">CALCULAR TAMANHO</button>
            </div>
          </div>

          <!-- Step 3: resultado -->
          <div class="nksw-fit-step-panel" id="nksw-fit-panel-2">
            <p class="nksw-fit-step-title">Seu tamanho</p>
            <div class="nksw-fit-result-wrap" id="nksw-fit-result-wrap"></div>
            <div class="nksw-fit-nav">
              <button class="nksw-fit-edit-btn" id="nksw-fit-edit-btn" type="button">← Editar medidas</button>
            </div>
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
    // Ignora template não renderizado (ex: "{{ ... }}", "{% ... %}", "<?php")
    const _rawGarment = instanceCfg.garmentUrl || CFG.garmentUrl || '';
    const _safeGarment = /^\{\{|^\{%|^<\?/.test(_rawGarment.trim()) ? '' : _rawGarment;
    const garmentUrl = toAbsoluteUrl(_safeGarment
      || document.querySelector('[data-vton-image]')?.dataset?.vtonImage
      || detectNuvemshopImage()
      || detectVndaImage()
      || document.querySelector('.product__media img')?.src
      || document.querySelector('.product-featured-img')?.src
      || document.querySelector('.woocommerce-product-gallery__image img')?.src
      || document.querySelector('[class*="productImageTag"]')?.src
      || '');
    const category   = instanceCfg.category  || CFG.category;
    const storeName  = instanceCfg.storeName  || CFG.storeName;

    if (!clientKey) { console.error('[Mirage] VTON_CLIENT_KEY não definido.'); return; }

    // ── Helper: parâmetros comuns enriquecidos ─────────────────────────────
    const garmentDomain = (() => {
      try { return garmentUrl ? new URL(garmentUrl.startsWith('http') ? garmentUrl : 'https://'+garmentUrl).hostname : ''; }
      catch { return ''; }
    })();

    const mp = (extra = {}) => ({
      client_key:     clientKey,
      store:          window.location.hostname,
      store_name:     storeName || '',
      page:           window.location.pathname,
      category:       category || 'auto',
      has_garment:    garmentUrl ? 1 : 0,
      garment_domain: garmentDomain,
      ...extra,
    });

    // ── Evento: widget aberto ──────────────────────────────────────────────
    MGA.send('tryon_widget_opened', mp());

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

    // ── Sizing: multi-step flow ────────────────────────────────────────────
    const tabTryon       = $('nksw-tab-tryon');
    const tabSizing      = $('nksw-tab-sizing');
    const tryonPane      = $('nksw-tryon-pane');
    const sizingPane     = $('nksw-sizing-pane');

    const fitHeightInput = $('nksw-fit-height');
    const fitWeightInput = $('nksw-fit-weight');
    const fitNextBtn0    = $('nksw-fit-next-0');
    const fitBackBtn1    = $('nksw-fit-back-1');
    const fitNextBtn1    = $('nksw-fit-next-1');
    const fitEditBtn     = $('nksw-fit-edit-btn');
    const fitResultWrap  = $('nksw-fit-result-wrap');

    const sliderBust     = $('nksw-slider-bust');
    const sliderWaist    = $('nksw-slider-waist');
    const sliderHip      = $('nksw-slider-hip');
    const sliderBustVal  = $('nksw-slider-bust-val');
    const sliderWaistVal = $('nksw-slider-waist-val');
    const sliderHipVal   = $('nksw-slider-hip-val');
    const avatarBody     = $('nksw-avatar-body');
    const avatarHead     = $('nksw-avatar-head');
    const skinRow        = $('nksw-fit-skin-row');

    let heightUnit = 'cm';
    let weightUnit = 'kg';
    let skinColor  = '#FDDBB4';

    // ── Avatar SVG ──────────────────────────────────────────────────────────
    function buildAvatarPath(bust, waist, hip) {
      const cx = 50;
      const bw = Math.max(14, Math.min(26, 14 + (bust  - 75) / 3));
      const ww = Math.max(9,  Math.min(20, 9  + (waist - 60) / 3));
      const hw = Math.max(16, Math.min(28, 16 + (hip   - 85) / 3));
      const sw = 20, nk = 6;
      return [
        `M ${cx-nk} 26`,
        `C ${cx-sw} 28 ${cx-sw} 40 ${cx-sw} 44`,
        `C ${cx-sw} 52 ${cx-bw} 60 ${cx-bw} 70`,
        `C ${cx-bw} 76 ${cx-ww} 82 ${cx-ww} 88`,
        `C ${cx-ww} 96 ${cx-hw} 100 ${cx-hw} 108`,
        `C ${cx-hw} 116 ${cx-12} 120 ${cx-12} 124`,
        `C ${cx-11} 136 ${cx-9} 148 ${cx-9} 158`,
        `L ${cx-8} 168 L ${cx+8} 168`,
        `C ${cx+9} 148 ${cx+11} 136 ${cx+12} 124`,
        `C ${cx+12} 120 ${cx+hw} 116 ${cx+hw} 108`,
        `C ${cx+hw} 100 ${cx+ww} 96 ${cx+ww} 88`,
        `C ${cx+ww} 82 ${cx+bw} 76 ${cx+bw} 70`,
        `C ${cx+bw} 60 ${cx+sw} 52 ${cx+sw} 44`,
        `C ${cx+sw} 40 ${cx+sw} 28 ${cx+nk} 26 Z`,
      ].join(' ');
    }

    function updateSliderTrack(slider) {
      const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.setProperty('--pct', pct + '%');
    }

    function refreshAvatar() {
      const bust  = Number(sliderBust.value);
      const waist = Number(sliderWaist.value);
      const hip   = Number(sliderHip.value);
      if (avatarBody) avatarBody.setAttribute('d', buildAvatarPath(bust, waist, hip));
      updateSliderTrack(sliderBust);
      updateSliderTrack(sliderWaist);
      updateSliderTrack(sliderHip);
      sliderBustVal.textContent  = bust  + ' cm';
      sliderWaistVal.textContent = waist + ' cm';
      sliderHipVal.textContent   = hip   + ' cm';
    }

    function setAvatarColor(color) {
      if (avatarBody) avatarBody.style.fill = color;
      if (avatarHead) avatarHead.style.fill = color;
    }

    refreshAvatar();
    setAvatarColor(skinColor);

    skinRow.addEventListener('click', e => {
      const dot = e.target.closest('.nksw-fit-skin-dot');
      if (!dot) return;
      skinRow.querySelectorAll('.nksw-fit-skin-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      skinColor = dot.dataset.skin;
      setAvatarColor(skinColor);
    });

    sliderBust.addEventListener('input',  refreshAvatar);
    sliderWaist.addEventListener('input', refreshAvatar);
    sliderHip.addEventListener('input',   refreshAvatar);

    // ── Step navigation ──────────────────────────────────────────────────────
    function goToStep(n) {
      for (let i = 0; i < 3; i++) {
        const panel = $(`nksw-fit-panel-${i}`);
        if (panel) panel.classList.toggle('active', i === n);
        const dot = $(`nksw-fit-dot-${i}`);
        if (dot) {
          dot.classList.remove('active', 'done');
          if (i < n) dot.classList.add('done');
          else if (i === n) dot.classList.add('active');
        }
      }
      for (let i = 0; i < 2; i++) {
        const line = $(`nksw-fit-line-${i}`);
        if (line) line.classList.toggle('done', i < n);
      }
    }

    // ── Unit helpers ─────────────────────────────────────────────────────────
    function getHeightCm() {
      const v = parseFloat(fitHeightInput.value);
      return isNaN(v) ? 0 : (heightUnit === 'in' ? v * 2.54 : v);
    }
    function getWeightKg() {
      const v = parseFloat(fitWeightInput.value);
      return isNaN(v) ? 0 : (weightUnit === 'lb' ? v * 0.453592 : v);
    }
    function validateStep0() {
      const h = getHeightCm(), w = getWeightKg();
      return h >= 100 && h <= 230 && w >= 30 && w <= 300;
    }

    fitHeightInput.addEventListener('input', () => { fitNextBtn0.disabled = !validateStep0(); });
    fitWeightInput.addEventListener('input', () => { fitNextBtn0.disabled = !validateStep0(); });

    $('nksw-height-cm').addEventListener('click', () => {
      if (heightUnit === 'cm') return;
      const v = parseFloat(fitHeightInput.value);
      heightUnit = 'cm';
      $('nksw-height-cm').classList.add('active'); $('nksw-height-in').classList.remove('active');
      if (!isNaN(v)) fitHeightInput.value = Math.round(v * 2.54);
      fitHeightInput.placeholder = '165';
      fitNextBtn0.disabled = !validateStep0();
    });
    $('nksw-height-in').addEventListener('click', () => {
      if (heightUnit === 'in') return;
      const v = parseFloat(fitHeightInput.value);
      heightUnit = 'in';
      $('nksw-height-in').classList.add('active'); $('nksw-height-cm').classList.remove('active');
      if (!isNaN(v)) fitHeightInput.value = Math.round(v / 2.54 * 10) / 10;
      fitHeightInput.placeholder = '65';
      fitNextBtn0.disabled = !validateStep0();
    });
    $('nksw-weight-kg').addEventListener('click', () => {
      if (weightUnit === 'kg') return;
      const v = parseFloat(fitWeightInput.value);
      weightUnit = 'kg';
      $('nksw-weight-kg').classList.add('active'); $('nksw-weight-lb').classList.remove('active');
      if (!isNaN(v)) fitWeightInput.value = Math.round(v * 0.453592);
      fitWeightInput.placeholder = '60';
      fitNextBtn0.disabled = !validateStep0();
    });
    $('nksw-weight-lb').addEventListener('click', () => {
      if (weightUnit === 'lb') return;
      const v = parseFloat(fitWeightInput.value);
      weightUnit = 'lb';
      $('nksw-weight-lb').classList.add('active'); $('nksw-weight-kg').classList.remove('active');
      if (!isNaN(v)) fitWeightInput.value = Math.round(v / 0.453592);
      fitWeightInput.placeholder = '130';
      fitNextBtn0.disabled = !validateStep0();
    });

    // Step 0 → 1: prefill sliders from height/weight
    function estimateMeasurements(hCm, wKg) {
      const bmi = wKg / ((hCm / 100) ** 2);
      const a   = bmi < 18.5 ? 0.97 : bmi < 25 ? 1.00 : bmi < 30 ? 1.03 : 1.06;
      return {
        bust:  Math.round(hCm * 0.530 * a),
        waist: Math.round(hCm * 0.395 * a),
        hip:   Math.round(hCm * 0.550 * a),
      };
    }

    fitNextBtn0.addEventListener('click', () => {
      if (!validateStep0()) return;
      const est = estimateMeasurements(getHeightCm(), getWeightKg());
      sliderBust.value  = Math.max(+sliderBust.min,  Math.min(+sliderBust.max,  est.bust));
      sliderWaist.value = Math.max(+sliderWaist.min, Math.min(+sliderWaist.max, est.waist));
      sliderHip.value   = Math.max(+sliderHip.min,   Math.min(+sliderHip.max,   est.hip));
      refreshAvatar();
      try {
        localStorage.setItem('_mf_h', getHeightCm().toFixed(1));
        localStorage.setItem('_mf_w', getWeightKg().toFixed(1));
      } catch (_) {}
      goToStep(1);
    });

    fitBackBtn1.addEventListener('click', () => goToStep(0));

    // Step 1 → 2: calculate and show result
    fitNextBtn1.addEventListener('click', async () => {
      const bust  = Number(sliderBust.value);
      const waist = Number(sliderWaist.value);
      const hip   = Number(sliderHip.value);
      const shoulder = Math.round(bust * 0.43);
      const meas = { bust, waist, hip, shoulder };

      try { localStorage.setItem('_mf_meas', JSON.stringify(meas)); } catch (_) {}

      const productId = window.VTON_PRODUCT_ID || '';
      let fitSortedSizes = [];

      if (productId) {
        try {
          const r = await fetch(`${apiUrl}/api/sizing?action=getProduct&clientKey=${encodeURIComponent(clientKey)}&productId=${encodeURIComponent(productId)}`);
          const d = await r.json();
          if (d.found && d.product?.sizes) {
            fitSortedSizes = Object.entries(d.product.sizes).map(([sz, ranges]) => {
              let score = 0, checks = 0;
              const chk = (val, range) => {
                if (!range || range.length < 2) return;
                const mid  = (range[0] + range[1]) / 2;
                const span = Math.max(range[1] - range[0], 4);
                score += Math.max(0, 1 - Math.abs(val - mid) / span);
                checks++;
              };
              chk(bust, ranges.bust); chk(waist, ranges.waist); chk(hip, ranges.hip);
              return { size: sz, score: checks > 0 ? score / checks : 0, ranges };
            }).sort((a, b) => b.score - a.score);
          }
        } catch (_) {}
      }

      function getFit(measured, range) {
        if (!range || range.length < 2) return { label: '—', color: '#d1d5db' };
        const lo = range[0], hi = range[1], span = Math.max(hi - lo, 4);
        if (measured >= lo && measured <= hi) return { label: 'Ideal', color: '#22c55e' };
        if (measured > hi) {
          const over = measured - hi;
          if (over <= span * 0.3) return { label: 'Levemente justo', color: '#86efac' };
          if (over <= span * 0.7) return { label: 'Justo', color: '#f59e0b' };
          return { label: 'Muito justo', color: '#ef4444' };
        }
        const under = lo - measured;
        if (under <= span * 0.3) return { label: 'Levemente folgado', color: '#86efac' };
        if (under <= span * 0.7) return { label: 'Folgado', color: '#f59e0b' };
        return { label: 'Muito folgado', color: '#ef4444' };
      }

      function showSizeResult(idx) {
        const { size, score, ranges } = fitSortedSizes[idx];
        const $q = sel => fitResultWrap.querySelector(sel);

        $q('#nksw-fit-sz-num').textContent = size;
        const badge = $q('#nksw-fit-quality-badge');
        badge.textContent = idx === 0 ? 'MELHOR OPÇÃO' : 'TAMBÉM SERVE';
        badge.className = 'nksw-fit-quality-badge ' + (idx === 0 ? 'best' : 'alt');

        const pillsEl = $q('#nksw-fit-sz-pills');
        pillsEl.innerHTML = fitSortedSizes
          .map((s, i) => Math.abs(i - idx) <= 1
            ? `<button class="nksw-fit-sz-pill ${i === idx ? 'active' : 'adj'}" data-idx="${i}" type="button">${s.size}</button>`
            : '')
          .join('');
        pillsEl.querySelectorAll('button').forEach(btn =>
          btn.addEventListener('click', () => showSizeResult(+btn.dataset.idx))
        );

        const prevBtn = $q('#nksw-fit-sz-prev');
        const nextBtn = $q('#nksw-fit-sz-next');
        prevBtn.disabled = idx === 0;
        nextBtn.disabled = idx === fitSortedSizes.length - 1;
        prevBtn.onclick = () => showSizeResult(idx - 1);
        nextBtn.onclick = () => showSizeResult(idx + 1);

        [['bust', bust], ['waist', waist], ['hip', hip]].forEach(([zone, val]) => {
          const fit = getFit(val, ranges?.[zone]);
          $q(`#nksw-fit-band-${zone}`)?.setAttribute('fill', fit.color);
          const dot = $q(`#nksw-fit-zdot-${zone}`);
          if (dot) dot.style.background = fit.color;
          const lbl = $q(`#nksw-fit-zlbl-${zone}`);
          if (lbl) lbl.textContent = fit.label;
        });
      }

      const measGrid = `
        <div class="nksw-fit-measures-grid">
          <div class="nksw-fit-measure-item"><span class="nksw-fit-measure-name">Busto</span><span class="nksw-fit-measure-num">${meas.bust} cm</span></div>
          <div class="nksw-fit-measure-item"><span class="nksw-fit-measure-name">Cintura</span><span class="nksw-fit-measure-num">${meas.waist} cm</span></div>
          <div class="nksw-fit-measure-item"><span class="nksw-fit-measure-name">Quadril</span><span class="nksw-fit-measure-num">${meas.hip} cm</span></div>
          <div class="nksw-fit-measure-item"><span class="nksw-fit-measure-name">Ombro</span><span class="nksw-fit-measure-num">${meas.shoulder} cm</span></div>
        </div>`;

      fitResultWrap.innerHTML = fitSortedSizes.length
        ? `<div class="nksw-fit-sz-header">
            <div class="nksw-fit-sz-number" id="nksw-fit-sz-num">—</div>
            <span class="nksw-fit-quality-badge best" id="nksw-fit-quality-badge">MELHOR OPÇÃO</span>
          </div>
          <div class="nksw-fit-sz-nav">
            <button class="nksw-fit-sz-arrow" id="nksw-fit-sz-prev" type="button">‹</button>
            <div class="nksw-fit-sz-pills" id="nksw-fit-sz-pills"></div>
            <button class="nksw-fit-sz-arrow" id="nksw-fit-sz-next" type="button">›</button>
          </div>
          <div class="nksw-fit-mannequin-wrap">
            <svg viewBox="0 0 100 240" width="100" height="210" overflow="visible" style="display:block;position:absolute;left:0;top:0">
              <defs>
                <radialGradient id="mf-body-g" cx="35%" cy="28%" r="65%" gradientUnits="objectBoundingBox">
                  <stop offset="0%"   stop-color="#ffffff"/>
                  <stop offset="60%"  stop-color="#eeeeee"/>
                  <stop offset="100%" stop-color="#cccccc"/>
                </radialGradient>
                <radialGradient id="mf-head-g" cx="38%" cy="32%" r="58%">
                  <stop offset="0%"   stop-color="#ffffff"/>
                  <stop offset="100%" stop-color="#d0d0d0"/>
                </radialGradient>
                <radialGradient id="mf-band-hi" cx="50%" cy="50%" r="55%">
                  <stop offset="0%"   stop-color="#fff" stop-opacity="0.40"/>
                  <stop offset="55%"  stop-color="#fff" stop-opacity="0"/>
                  <stop offset="100%" stop-color="#000" stop-opacity="0.22"/>
                </radialGradient>
                <filter id="mf-shadow" x="-25%" y="-5%" width="160%" height="120%">
                  <feDropShadow dx="2" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.18"/>
                </filter>
                <clipPath id="mf-clip">
                  <path d="M44,32 L56,32 C62,34 72,40 80,48 C84,54 86,62 84,68 C82,72 80,76 80,80 C78,90 74,100 72,112 C72,122 76,134 80,142 C80,152 80,160 78,168 C76,176 74,186 72,200 C71,212 71,226 71,240 L58,240 C58,228 58,216 58,204 C57,192 56,182 55,174 C53,166 51,162 50,158 C49,162 47,166 45,174 C44,182 43,192 42,204 C42,216 42,228 42,240 L29,240 C29,226 29,212 28,200 C26,186 24,176 22,168 C20,160 20,152 20,142 C24,134 28,122 28,112 C26,100 22,90 20,80 C18,76 16,72 14,68 C12,62 14,54 20,48 C28,40 38,34 44,32 Z"/>
                </clipPath>
              </defs>
              <!-- Ground shadow -->
              <ellipse cx="50" cy="238" rx="22" ry="4" fill="rgba(0,0,0,0.10)"/>
              <!-- Figure with drop shadow -->
              <g filter="url(#mf-shadow)">
                <!-- Left arm -->
                <ellipse cx="9" cy="118" rx="7" ry="64" fill="url(#mf-body-g)"/>
                <!-- Right arm -->
                <ellipse cx="91" cy="118" rx="7" ry="64" fill="url(#mf-body-g)"/>
                <!-- Body fill -->
                <path d="M44,32 L56,32 C62,34 72,40 80,48 C84,54 86,62 84,68 C82,72 80,76 80,80 C78,90 74,100 72,112 C72,122 76,134 80,142 C80,152 80,160 78,168 C76,176 74,186 72,200 C71,212 71,226 71,240 L58,240 C58,228 58,216 58,204 C57,192 56,182 55,174 C53,166 51,162 50,158 C49,162 47,166 45,174 C44,182 43,192 42,204 C42,216 42,228 42,240 L29,240 C29,226 29,212 28,200 C26,186 24,176 22,168 C20,160 20,152 20,142 C24,134 28,122 28,112 C26,100 22,90 20,80 C18,76 16,72 14,68 C12,62 14,54 20,48 C28,40 38,34 44,32 Z" fill="url(#mf-body-g)"/>
                <!-- Head -->
                <circle cx="50" cy="20" r="15" fill="url(#mf-head-g)"/>
              </g>
              <!-- Fit bands (clipped to body, then highlight overlay) -->
              <g clip-path="url(#mf-clip)">
                <ellipse id="nksw-fit-band-bust"  cx="50" cy="80"  rx="30" ry="7"  fill="#22c55e" fill-opacity="0.80"/>
                <ellipse id="nksw-fit-band-waist" cx="50" cy="116" rx="22" ry="6"  fill="#22c55e" fill-opacity="0.80"/>
                <ellipse id="nksw-fit-band-hip"   cx="50" cy="148" rx="30" ry="7"  fill="#22c55e" fill-opacity="0.80"/>
                <!-- 3D shading overlay per band -->
                <ellipse cx="50" cy="80"  rx="30" ry="7"  fill="url(#mf-band-hi)"/>
                <ellipse cx="50" cy="116" rx="22" ry="6"  fill="url(#mf-band-hi)"/>
                <ellipse cx="50" cy="148" rx="30" ry="7"  fill="url(#mf-band-hi)"/>
              </g>
              <!-- Connector lines to labels -->
              <line x1="80" y1="80"  x2="100" y2="80"  stroke="#ddd" stroke-width="1"/>
              <line x1="72" y1="116" x2="100" y2="116" stroke="#ddd" stroke-width="1"/>
              <line x1="80" y1="148" x2="100" y2="148" stroke="#ddd" stroke-width="1"/>
            </svg>
            <div class="nksw-fit-zone-row" style="top:58px">
              <span id="nksw-fit-zdot-bust" class="nksw-fit-zone-dot"></span>
              <div><span class="nksw-fit-zone-name">Busto</span><span id="nksw-fit-zlbl-bust" class="nksw-fit-zone-label">—</span></div>
            </div>
            <div class="nksw-fit-zone-row" style="top:91px">
              <span id="nksw-fit-zdot-waist" class="nksw-fit-zone-dot"></span>
              <div><span class="nksw-fit-zone-name">Cintura</span><span id="nksw-fit-zlbl-waist" class="nksw-fit-zone-label">—</span></div>
            </div>
            <div class="nksw-fit-zone-row" style="top:122px">
              <span id="nksw-fit-zdot-hip" class="nksw-fit-zone-dot"></span>
              <div><span class="nksw-fit-zone-name">Quadril</span><span id="nksw-fit-zlbl-hip" class="nksw-fit-zone-label">—</span></div>
            </div>
          </div>
          ${measGrid}`
        : `<div class="nksw-fit-no-table">
            A loja ainda não cadastrou a tabela de medidas desta peça. Use suas medidas abaixo como referência.
          </div>
          ${measGrid}`;

      if (fitSortedSizes.length) showSizeResult(0);
      goToStep(2);

      // Salva outcome em background
      try {
        const sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
        fetch(`${apiUrl}/api/sizing`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'saveOutcome', clientKey, sessionId,
            productId:       productId || null,
            recommendedSize: fitSortedSizes[0]?.size || null,
            confidence:      fitSortedSizes[0]?.score > 0.75 ? 'high' : fitSortedSizes[0]?.score > 0.45 ? 'medium' : 'low',
            method:          fitSortedSizes.length ? 'matching' : 'anthropometric',
            inputs:          { bust, waist, hip },
          }),
        }).catch(() => {});
      } catch (_) {}
    });

    fitEditBtn.addEventListener('click', () => goToStep(1));

    // Tabs
    tabTryon.addEventListener('click', () => {
      tabTryon.classList.add('active'); tabSizing.classList.remove('active');
      tryonPane.style.display = ''; sizingPane.classList.remove('active');
    });
    tabSizing.addEventListener('click', () => {
      tabSizing.classList.add('active'); tabTryon.classList.remove('active');
      tryonPane.style.display = 'none'; sizingPane.classList.add('active');
      // Restaura perfil salvo
      try {
        const savedH = localStorage.getItem('_mf_h');
        const savedW = localStorage.getItem('_mf_w');
        const savedM = JSON.parse(localStorage.getItem('_mf_meas') || 'null');
        if (savedH && !fitHeightInput.value) fitHeightInput.value = parseFloat(savedH).toFixed(0);
        if (savedW && !fitWeightInput.value) fitWeightInput.value = parseFloat(savedW).toFixed(0);
        if (savedM) {
          if (savedM.bust  >= +sliderBust.min  && savedM.bust  <= +sliderBust.max)  sliderBust.value  = savedM.bust;
          if (savedM.waist >= +sliderWaist.min && savedM.waist <= +sliderWaist.max) sliderWaist.value = savedM.waist;
          if (savedM.hip   >= +sliderHip.min   && savedM.hip   <= +sliderHip.max)   sliderHip.value   = savedM.hip;
          refreshAvatar();
        }
        fitNextBtn0.disabled = !validateStep0();
      } catch (_) {}
    });

    // ── Estado ─────────────────────────────────────────────────────────────
    let selectedDataUrl = null;
    let pollTimer       = null;
    let pollStart       = null;
    let currentJobId    = null;
    let pendingLead     = null;
    let leadDone        = false;
    let stageTimer      = null;

    // Mensagens por etapa (ms → texto)
    const LOADING_STAGES = [
      {  at:     0, text: 'Enviando sua foto para processamento...' },
      {  at:  4000, text: 'Analisando a peça de roupa...' },
      {  at:  9000, text: 'Aplicando a peça ao seu modelo...' },
      {  at: 14000, text: 'Ajustando detalhes e iluminação...' },
      {  at: 20000, text: 'Finalizando seu look...' },
      {  at: 28000, text: 'Quase lá, aguarde mais um instante...' },
    ];

    function startLoadingStages() {
      if (stageTimer) clearInterval(stageTimer);
      const start = Date.now();
      let stageIdx = 0;
      loadingText.textContent = LOADING_STAGES[0].text;

      stageTimer = setInterval(() => {
        const elapsed = Date.now() - start;
        let next = stageIdx;
        for (let i = LOADING_STAGES.length - 1; i >= 0; i--) {
          if (elapsed >= LOADING_STAGES[i].at) { next = i; break; }
        }
        if (next !== stageIdx) {
          stageIdx = next;
          loadingText.textContent = LOADING_STAGES[stageIdx].text;
        }
      }, 500);
    }

    function stopLoadingStages() {
      if (stageTimer) { clearInterval(stageTimer); stageTimer = null; }
    }

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
        MGA.send('tryon_lead_submitted', mp({ has_whatsapp: !!lead.whatsapp ? 1 : 0 }));
      } catch (_) {}

      leadInner.style.display = 'none';
      leadSent.style.display  = 'block';
      leadSent.textContent    = '✅ Cadastro realizado! Fique de olho na sua caixa de entrada.';
      leadDone    = true;
      pendingLead = null;
    }

    leadSubmit.addEventListener('click', submitLead);
    leadSkip.addEventListener('click', () => {
      MGA.send('tryon_lead_skipped', mp());
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
        .then(dataUrl => {
          selectedDataUrl = dataUrl;
          generateBtn.disabled = false;
          MGA.send('tryon_photo_uploaded', mp({ file_type: file.type, file_size_kb: Math.round(file.size / 1024) }));
        })
        .catch(e => { showError(e.message); });
    }

    function resetToUpload() {
      clearInterval(pollTimer);
      stopLoadingStages();
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

    function getStage() {
      if (resultActions.classList.contains('visible')) return 'result';
      if (renderCanvas.classList.contains('visible'))  return 'generating';
      if (previewWrap.classList.contains('visible'))   return 'preview';
      return 'upload';
    }

    function closeModal() {
      MGA.send('tryon_modal_closed', mp({ stage: getStage() }));
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

    changeBtn.addEventListener('click', () => {
      MGA.send('tryon_change_photo', mp({ stage: 'preview' }));
      resetToUpload();
    });
    retryBtn.addEventListener('click', () => {
      MGA.send('tryon_retry', mp({ stage: 'result' }));
      resetToUpload();
    });

    // ── Salvar foto ─────────────────────────────────────────────────────────
    saveBtn.addEventListener('click', () => {
      MGA.send('tryon_result_saved', mp({ garment_url: (garmentUrl||'').slice(0,100) }));
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
        MGA.send('tryon_started', mp({ garment_url: (garmentUrl||'').slice(0,100) }));
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
        startLoadingStages();
        await new Promise((resolve, reject) => {
          pollTimer = setInterval(async () => {
            if (Date.now() - pollStart > POLL_TIMEOUT) {
              clearInterval(pollTimer);
              stopLoadingStages();
              return reject(new Error('O processamento demorou mais que o esperado. Tente novamente.'));
            }
            const elapsed = Date.now() - pollStart;
            setProgress(Math.min(55 + (elapsed / POLL_TIMEOUT) * 40, 93));
            try {
              const pollRes  = await fetch(`${apiUrl}/api/result?jobId=${encodeURIComponent(currentJobId)}`);
              const pollData = await pollRes.json();
              if (pollData.status === 'done' || pollData.status === 'completed') {
                clearInterval(pollTimer);
                stopLoadingStages();
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
                  MGA.send('tryon_result_viewed', mp({
                    duration_ms:  Date.now() - pollStart,
                    garment_url:  (garmentUrl||'').slice(0,100),
                    result_time_s: Math.round((Date.now() - pollStart) / 1000),
                  }));
                };
                renderResult.src = resultUrl;
                resolve();

              } else if (pollData.status === 'error' || pollData.status === 'failed') {
                clearInterval(pollTimer);
                stopLoadingStages();
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
        const errMsg = err?.message || 'Erro inesperado';
        MGA.send('tryon_error', mp({ error_message: errMsg.slice(0, 100), garment_url: (garmentUrl||'').slice(0,100) }));
        showError(errMsg + '. Tente novamente.');
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
