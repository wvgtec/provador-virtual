/**
 * Provador Virtual — Widget
 * Versão: 2.0 (modelo assíncrono com polling)
 *
 * Como usar:
 *   <script src="https://cdn.jsdelivr.net/gh/SEU-USER/SEU-REPO@v2.0/widget/tryon-widget.js" defer></script>
 *
 * O script lê window.VTON_API_URL ou o atributo data-api do elemento de produto.
 */


(function () {
  'use strict';


  const API_URL    = window.VTON_API_URL || '';
  const CLIENT_KEY = window.VTON_CLIENT_KEY || '';
  const POLL_INTERVAL_MS = 2000;
  const POLL_TIMEOUT_MS  = 90000;


  if (!API_URL) {
    console.warn('[Provador Virtual] window.VTON_API_URL não definido.');
    return;
  }
  if (!CLIENT_KEY) {
    console.warn('[Provador Virtual] window.VTON_CLIENT_KEY não definido.');
  }


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
