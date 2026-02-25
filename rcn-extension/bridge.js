/**
 * bridge.js — ISOLATED world content script
 * Receives RCN_RAW messages from interceptor.js (MAIN world),
 * parses the HTML with DOMParser, and forwards rows to background.js.
 */
(function () {
  'use strict';

  // ── Parsing helpers (ported from parse.js, native DOM) ────────────────────

  /**
   * Extract fields from a named section (<h3> + following <ul>).
   * Returns plain object { labelText: value }, where "-" and "" → null.
   */
  function getSectionFields(contentEl, sectionTitle) {
    const result = {};
    let matchH3 = null;
    for (const h3 of contentEl.querySelectorAll('h3')) {
      if (h3.textContent.trim() === sectionTitle) {
        matchH3 = h3;
        break;
      }
    }
    if (!matchH3) return result;

    const ul = matchH3.nextElementSibling;
    if (!ul || ul.tagName !== 'UL') return result;

    for (const li of ul.querySelectorAll('li')) {
      const span = li.querySelector('span.list-item-value');
      const label = span ? span.textContent.replace(/:$/, '').trim() : '';
      // Clone and strip span to isolate value text
      const liClone = li.cloneNode(true);
      const spanClone = liClone.querySelector('span.list-item-value');
      if (spanClone) spanClone.remove();
      const value = liClone.textContent.trim();
      result[label] = (value === '-' || value === '') ? null : value;
    }

    return result;
  }

  /**
   * Parse date string: "2021-01-12 00:00:00+01" → "2021-01-12"
   */
  function parseDate(raw) {
    if (!raw) return null;
    return raw.split(' ')[0];
  }

  /**
   * Parse number — returns JS Number, null, or fraction string (e.g. "1/2").
   */
  function parseNumber(raw) {
    if (raw === null || raw === undefined || raw === '-') return null;
    const str = String(raw).trim();
    if (str === '' || str === '-') return null;
    if (str.includes('/')) return str;  // keep fractions as-is
    const n = Number(str.replace(/\s/g, '').replace(',', '.'));
    return isNaN(n) ? str : n;
  }

  /**
   * Parse address: "MSC:Warszawa;UL:...;NR_PORZ:2bl,1"
   * Splits on "|" (takes first segment), then on ";", then on ":".
   * NR_PORZ last comma separates building nr from apartment nr.
   */
  function parseAddress(raw) {
    if (!raw) return { miejscowosc: null, ulica: null, nrBudynku: null, nrLokalu: null };

    const segment = raw.split('|')[0].trim();
    const map = {};
    for (const part of segment.split(';')) {
      const colonIdx = part.indexOf(':');
      if (colonIdx === -1) continue;
      const key = part.slice(0, colonIdx).trim();
      const val = part.slice(colonIdx + 1).trim();
      map[key] = val || null;
    }

    let nrBudynku = null;
    let nrLokalu = null;
    const nrPorz = map['NR_PORZ'] || null;
    if (nrPorz) {
      const commaIdx = nrPorz.lastIndexOf(',');
      if (commaIdx !== -1) {
        nrBudynku = nrPorz.slice(0, commaIdx).trim() || null;
        nrLokalu = nrPorz.slice(commaIdx + 1).trim() || null;
      } else {
        nrBudynku = nrPorz;
        nrLokalu = null;
      }
    }

    return {
      miejscowosc: map['MSC'] || null,
      ulica: map['UL'] || null,
      nrBudynku,
      nrLokalu,
    };
  }

  /**
   * Parse all accordion items from the HTML document, return array of row objects.
   */
  function parseDocument(doc) {
    const rows = [];
    const accordions = doc.querySelectorAll('.accordion');

    for (const accordion of accordions) {
      const content = accordion.querySelector('.accordion-content');
      if (!content) continue;

      const trans = getSectionFields(content, 'Dane transakcji');
      const dok   = getSectionFields(content, 'Dokument');
      const nier  = getSectionFields(content, 'Nieruchomość');
      const bud   = getSectionFields(content, 'Budynek');

      const addr = parseAddress(bud['Adres']);

      const cena        = parseNumber(trans['Cena brutto']);
      const powGruntu   = parseNumber(nier['Pow. gruntu']);
      const powUzytkowa = parseNumber(bud['Pow. użytkowa']);

      let cenaNaM2 = null;
      const denominator = (typeof powUzytkowa === 'number' && powUzytkowa > 0)
        ? powUzytkowa
        : (typeof powGruntu === 'number' && powGruntu > 0 ? powGruntu : null);
      if (typeof cena === 'number' && denominator !== null) {
        cenaNaM2 = Math.round(cena / denominator);
      }

      rows.push({
        'Plik źródłowy':        'live',
        'Nr budynku':           bud['Nr budynku'] || null,
        'ID transakcji':        trans['Lokalny ID IIP'] || null,
        'Data transakcji':      parseDate(dok['Data']),
        'Cena (PLN)':           cena,
        'Rodzaj transakcji':    trans['Rodzaj transakcji'] || null,
        'Rodzaj rynku':         trans['Rodzaj rynku'] || null,
        'Sprzedający':          trans['Sprzedający'] || null,
        'Kupujący':             trans['Kupujący'] || null,
        'Rodzaj nieruchomości': nier['Rodzaj'] || null,
        'Prawo':                nier['Prawo'] || null,
        'Udział':               parseNumber(nier['Udział']),
        'Pow. gruntu (m²)':     powGruntu,
        'ID budynku':           bud['ID budynku'] || null,
        'Rodzaj budynku':       bud['Rodzaj'] || null,
        'Pow. użytkowa (m²)':   powUzytkowa,
        'Miejscowość':          addr.miejscowosc,
        'Ulica':                addr.ulica,
        'Nr budynku adres':     addr.nrBudynku,
        'Nr lokalu':            addr.nrLokalu,
        'Cena/m² (PLN)':        cenaNaM2,
      });
    }

    return rows;
  }

  // ── Message listener ───────────────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'RCN_RAW') return;

    const { html } = event.data;
    if (!html) return;

    let doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch {
      return;
    }

    const rows = parseDocument(doc);
    if (rows.length === 0) return;

    try {
      chrome.runtime.sendMessage({ type: 'NEW_ROWS', rows }).catch(() => {});
    } catch {
      // Extension context invalidated (extension reloaded while tab was open) — ignore.
    }
  });
})();
