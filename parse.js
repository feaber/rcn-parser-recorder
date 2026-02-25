'use strict';

const fs   = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const XLSX = require('xlsx');

const INPUT_DIR  = path.join(__dirname, 'parse-in');
const OUTPUT_DIR = path.join(__dirname, 'parse-out');

const HEADERS = [
  'Plik źródłowy',
  'Nr budynku',
  'ID transakcji',
  'Data transakcji',
  'Cena (PLN)',
  'Rodzaj transakcji',
  'Rodzaj rynku',
  'Sprzedający',
  'Kupujący',
  'Rodzaj nieruchomości',
  'Prawo',
  'Udział',
  'Pow. gruntu (m²)',
  'ID budynku',
  'Rodzaj budynku',
  'Pow. użytkowa (m²)',
  'Miejscowość',
  'Ulica',
  'Nr budynku adres',
  'Nr lokalu',
  'Cena/m² (PLN)',
];

/**
 * Extract fields from a named section (<h3> + following <ul>).
 * Returns a plain object { labelText: value } where "-" and "" become null.
 */
function getSectionFields($content, sectionTitle, $) {
  const result = {};
  const h3 = $content.find('h3').filter((_, el) => $(el).text().trim() === sectionTitle).first();
  if (!h3.length) return result;

  const ul = h3.next('ul');
  if (!ul.length) return result;

  ul.find('li').each((_, li) => {
    const $li = $(li);
    const label = $li.find('span.list-item-value').text().replace(/:$/, '').trim();
    const $liClone = $li.clone();
    $liClone.find('span.list-item-value').remove();
    const value = $liClone.text().trim();
    result[label] = (value === '-' || value === '') ? null : value;
  });

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
 * Parse number: return JS Number or null for null/dash, keep string for fractions like "1/1"
 */
function parseNumber(raw) {
  if (raw === null || raw === undefined || raw === '-') return null;
  const str = String(raw).trim();
  if (str === '' || str === '-') return null;
  if (str.includes('/')) return str;
  const n = Number(str.replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? str : n;
}

/**
 * Parse address: "MSC:Warszawa;UL:...;NR_PORZ:2bl,1"
 */
function parseAddress(raw) {
  if (!raw) return { miejscowosc: null, ulica: null, nrBudynku: null, nrLokalu: null };

  const segment = raw.split('|')[0].trim();
  const parts = segment.split(';');
  const map = {};
  for (const part of parts) {
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
      nrLokalu  = nrPorz.slice(commaIdx + 1).trim() || null;
    } else {
      nrBudynku = nrPorz;
      nrLokalu  = null;
    }
  }

  return {
    miejscowosc: map['MSC'] || null,
    ulica:       map['UL']  || null,
    nrBudynku,
    nrLokalu,
  };
}

/**
 * Parse a single HTML file, return array of row arrays (no header).
 */
function parseFile(filename) {
  const filepath = path.join(INPUT_DIR, filename);
  const html = fs.readFileSync(filepath, 'utf8');
  const $ = cheerio.load(html);
  const rows = [];

  const fileBase     = path.basename(filename, '.html');       // "b1"
  const buildingLabel = fileBase.replace(/^b/, '') + '_BUD';   // "1_BUD"

  $('.accordion').each((_, accordion) => {
    const $accordion = $(accordion);
    const $content   = $accordion.find('.accordion-content').first();
    if (!$content.length) return;

    const trans = getSectionFields($content, 'Dane transakcji', $);
    const dok   = getSectionFields($content, 'Dokument', $);
    const nier  = getSectionFields($content, 'Nieruchomość', $);
    const bud   = getSectionFields($content, 'Budynek', $);

    const addr        = parseAddress(bud['Adres']);
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

    rows.push([
      filename,
      buildingLabel,
      trans['Lokalny ID IIP'] || null,
      parseDate(dok['Data']),
      cena,
      trans['Rodzaj transakcji'] || null,
      trans['Rodzaj rynku']      || null,
      trans['Sprzedający']       || null,
      trans['Kupujący']          || null,
      nier['Rodzaj']             || null,
      nier['Prawo']              || null,
      parseNumber(nier['Udział']),
      powGruntu,
      bud['ID budynku']          || null,
      bud['Rodzaj']              || null,
      powUzytkowa,
      addr.miejscowosc,
      addr.ulica,
      addr.nrBudynku,
      addr.nrLokalu,
      cenaNaM2,
    ]);
  });

  return rows;
}

/**
 * Build a YYYYMMDD-HHmmss timestamp string.
 */
function timestamp() {
  const now = new Date();
  const p   = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
       + `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/**
 * Write XLSX to parse-out/<timestamp>.xlsx with auto column widths.
 */
function writeXLSX(allRows, outPath) {
  const wb   = XLSX.utils.book_new();
  const data = [HEADERS, ...allRows];
  const ws   = XLSX.utils.aoa_to_sheet(data);

  const colWidths = HEADERS.map((h, colIdx) => {
    let max = h.length;
    for (const row of allRows) {
      const val = row[colIdx];
      if (val !== null && val !== undefined) {
        max = Math.max(max, String(val).length);
      }
    }
    return { wch: Math.min(max + 2, 50) };
  });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'Transakcje');
  XLSX.writeFile(wb, outPath);
  console.log(`Zapisano ${outPath}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (!fs.existsSync(INPUT_DIR)) {
  console.error(`Brak katalogu wejściowego: ${INPUT_DIR}`);
  process.exit(1);
}

const files = fs.readdirSync(INPUT_DIR)
  .filter(f => f.toLowerCase().endsWith('.html'))
  .sort();

if (files.length === 0) {
  console.error(`Brak plików HTML w ${INPUT_DIR}`);
  process.exit(1);
}

const allRows = [];
for (const file of files) {
  const rows = parseFile(file);
  console.log(`${file}: ${rows.length} transakcji`);
  allRows.push(...rows);
}

console.log(`\nŁącznie: ${allRows.length} transakcji`);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeXLSX(allRows, path.join(OUTPUT_DIR, `${timestamp()}.xlsx`));
