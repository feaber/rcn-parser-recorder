/**
 * interceptor.js — MAIN world content script
 * Patches window.fetch and XMLHttpRequest to intercept WMS GetFeatureInfo responses.
 * Runs in page context (MAIN world) so it can access window.fetch / XHR prototypes.
 * Cannot use chrome.* APIs — communicates via window.postMessage.
 */
(function () {
  'use strict';

  // Guard against double-injection (extension reloaded while tab was open).
  if (window.__rcnInterceptorInstalled) return;
  window.__rcnInterceptorInstalled = true;

  function isRcnRequest(url) {
    try {
      const u = new URL(url, location.href);
      return u.pathname.toLowerCase().includes('/wss/service/rcn') &&
             u.search.toLowerCase().includes('getfeatureinfo');
    } catch {
      return false;
    }
  }

  // ── Patch fetch ────────────────────────────────────────────────────────────
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    const response = await originalFetch(...args);

    const url = (args[0] instanceof Request) ? args[0].url : String(args[0]);
    if (isRcnRequest(url)) {
      // Clone so the original stream remains unconsumed
      const clone = response.clone();
      clone.text().then(html => {
        window.postMessage({ type: 'RCN_RAW', html, url }, '*');
      }).catch(() => {});
    }

    return response;
  };

  // ── Patch XHR ─────────────────────────────────────────────────────────────
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;

  XHR.open = function (method, url, ...rest) {
    this._rcnUrl = String(url);
    return origOpen.call(this, method, url, ...rest);
  };

  XHR.send = function (...args) {
    if (this._rcnUrl && isRcnRequest(this._rcnUrl)) {
      const capturedUrl = this._rcnUrl;
      this.addEventListener('load', function () {
        window.postMessage({ type: 'RCN_RAW', html: this.responseText, url: capturedUrl }, '*');
      });
    }
    return origSend.apply(this, args);
  };
})();
