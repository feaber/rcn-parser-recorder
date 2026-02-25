'use strict';

const HEADERS = [
  'Plik źródłowy', 'Nr budynku', 'ID transakcji', 'Data transakcji',
  'Cena (PLN)', 'Rodzaj transakcji', 'Rodzaj rynku', 'Sprzedający',
  'Kupujący', 'Rodzaj nieruchomości', 'Prawo', 'Udział',
  'Pow. gruntu (m²)', 'ID budynku', 'Rodzaj budynku', 'Pow. użytkowa (m²)',
  'Miejscowość', 'Ulica', 'Nr budynku adres', 'Nr lokalu', 'Cena/m² (PLN)',
];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const dot         = document.getElementById('dot');
const statusText  = document.getElementById('statusText');
const countText   = document.getElementById('countText');
const countLabel  = document.getElementById('countLabel');
const btnStart    = document.getElementById('btnStart');
const btnStop     = document.getElementById('btnStop');
const btnResume   = document.getElementById('btnResume');
const btnDashboard = document.getElementById('btnDashboard');
const btnDownload  = document.getElementById('btnDownload');
const btnClear    = document.getElementById('btnClear');

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCount(n) {
  if (n === 1) return '1';
  return String(n);
}

function countSuffix(n) {
  if (n === 1) return 'transakcja';
  if (n >= 2 && n <= 4) return 'transakcje';
  return 'transakcji';
}

function render(recording, rowCount) {
  // Status indicator
  dot.className = 'dot ' + (recording ? 'active' : 'idle');
  statusText.textContent = recording ? 'Nagrywanie...' : 'Zatrzymano';

  // Count
  countText.textContent = formatCount(rowCount);
  countLabel.textContent = countSuffix(rowCount);

  // Buttons: reset all first
  btnStart.classList.add('hidden');
  btnStop.classList.add('hidden');
  btnResume.classList.add('hidden');
  btnDashboard.classList.add('hidden');
  btnDownload.classList.add('hidden');
  btnClear.classList.add('hidden');

  if (recording) {
    btnStop.classList.remove('hidden');
  } else if (rowCount > 0) {
    btnResume.classList.remove('hidden');
    btnDashboard.classList.remove('hidden');
    btnDownload.classList.remove('hidden');
    btnClear.classList.remove('hidden');
  } else {
    btnStart.classList.remove('hidden');
  }
}

async function getState() {
  return chrome.runtime.sendMessage({ type: 'GET_STATE' });
}

async function setRecording(flag) {
  return chrome.runtime.sendMessage({ type: 'SET_RECORDING', recording: flag });
}

// ── Download ──────────────────────────────────────────────────────────────────

async function downloadXLSX() {
  const { rows } = await chrome.runtime.sendMessage({ type: 'GET_ROWS' });
  if (!rows || rows.length === 0) return;

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS });

  // Column widths — approximate based on header length + content sample
  const colWidths = HEADERS.map((h, colIdx) => {
    let max = h.length;
    for (const row of rows) {
      const val = row[h];
      if (val !== null && val !== undefined) {
        max = Math.max(max, String(val).length);
      }
    }
    return { wch: Math.min(max + 2, 50) };
  });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'Transakcje');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  a.download = `${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Event listeners ───────────────────────────────────────────────────────────

btnStart.addEventListener('click', async () => {
  await setRecording(true);
  const state = await getState();
  render(state.recording, state.rowCount);
});

btnStop.addEventListener('click', async () => {
  await setRecording(false);
  const state = await getState();
  render(state.recording, state.rowCount);
});

btnResume.addEventListener('click', async () => {
  await setRecording(true);
  const state = await getState();
  render(state.recording, state.rowCount);
});

btnDashboard.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

btnDownload.addEventListener('click', () => {
  downloadXLSX().catch(console.error);
});

btnClear.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_DATA' });
  const state = await getState();
  render(state.recording, state.rowCount);
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  const state = await getState();
  render(state.recording, state.rowCount);
})();
