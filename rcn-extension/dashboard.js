'use strict';

// ─── Column definitions ───────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'Data transakcji',     label: 'Data',          type: 'date'    },
  { key: 'Cena (PLN)',          label: 'Cena (PLN)',     type: 'number'  },
  { key: 'Nr budynku',         label: 'Nr bud.',        type: 'string'  },
  { key: 'Miejscowość',        label: 'Miejscowość',    type: 'string'  },
  { key: 'Ulica',              label: 'Ulica',          type: 'string'  },
  { key: 'Nr budynku adres',   label: 'Nr bud. (adr.)', type: 'string'  },
  { key: 'Nr lokalu',          label: 'Nr lok.',        type: 'string'  },
  { key: 'Pow. użytkowa (m²)', label: 'Pow. użytk.',   type: 'number'  },
  { key: 'Pow. gruntu (m²)',   label: 'Pow. gruntu',   type: 'number'  },
  { key: 'Cena/m² (PLN)',      label: 'Cena/m²',       type: 'number'  },
  { key: 'Rodzaj rynku',       label: 'Rynek',          type: 'string'  },
  { key: 'Rodzaj transakcji',  label: 'Rodzaj trans.',  type: 'string'  },
  { key: 'Rodzaj nieruchomości', label: 'Rodzaj nier.', type: 'string'  },
  { key: 'Rodzaj budynku',     label: 'Rodzaj bud.',    type: 'string'  },
  { key: 'Prawo',              label: 'Prawo',          type: 'string'  },
  { key: 'Udział',             label: 'Udział',         type: 'string'  },
  { key: 'Sprzedający',        label: 'Sprzedający',    type: 'string'  },
  { key: 'Kupujący',           label: 'Kupujący',       type: 'string'  },
  { key: 'ID transakcji',      label: 'ID transakcji',  type: 'string'  },
  { key: 'ID budynku',         label: 'ID budynku',     type: 'string'  },
  { key: 'Plik źródłowy',     label: 'Plik',           type: 'string'  },
];

const NUMERIC_COLS = ['Cena (PLN)', 'Pow. użytkowa (m²)', 'Pow. gruntu (m²)', 'Cena/m² (PLN)'];

// ─── State ────────────────────────────────────────────────────────────────────
let allRows = [];
let filteredRows = [];
let sortCol = 'Data transakcji';
let sortAsc = false;
let currentPage = 1;
let perPage = 25;
let filters = {
  dateFrom: '', dateTo: '',
  priceMin: '', priceMax: '',
  search: '',
  buildings: new Set(),
  market: '',
};

// ─── Drag & drop ──────────────────────────────────────────────────────────────
const dropArea = document.getElementById('drop-area');

dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('dragover'); });
dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));
dropArea.addEventListener('drop', e => {
  e.preventDefault();
  dropArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

function handleInputChange(e) {
  const file = e.target.files[0];
  if (file) handleFile(file);
}

// ─── File handling ────────────────────────────────────────────────────────────
function handleFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const data = new Uint8Array(e.target.result);
    const wb = XLSX.read(data, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });

    // Re-parse numeric columns (sheet_to_json with raw:false gives strings)
    allRows = raw.map(row => {
      const r = Object.assign({}, row);
      for (const col of NUMERIC_COLS) {
        if (r[col] !== null && r[col] !== undefined && r[col] !== '') {
          const n = Number(String(r[col]).replace(/\s/g, '').replace(',', '.'));
          r[col] = isNaN(n) ? null : n;
        } else {
          r[col] = null;
        }
      }
      return r;
    });

    initDashboard();
  };
  reader.readAsArrayBuffer(file);
}

// ─── Init dashboard ───────────────────────────────────────────────────────────
function initDashboard() {
  // Show dashboard, hide drop zone
  document.getElementById('drop-area').classList.add('hidden');
  document.getElementById('dashboard').classList.add('visible');
  document.getElementById('btn-reload').style.display = 'flex';

  // Build table header (once)
  buildTableHeader();

  // Build building checkboxes from unique values
  const buildSet = new Set(allRows.map(r => r['Nr budynku']).filter(Boolean));
  const builds = Array.from(buildSet).sort();
  filters.buildings = new Set(builds); // all checked by default

  const checksContainer = document.getElementById('buildings-checks');
  checksContainer.innerHTML = '';
  for (const b of builds) {
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = b;
    cb.checked = true;
    cb.addEventListener('change', () => onBuildingCheck(cb));
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' ' + b));
    lbl.classList.add('checked');
    checksContainer.appendChild(lbl);
  }

  // Build market dropdown
  const markets = Array.from(new Set(allRows.map(r => r['Rodzaj rynku']).filter(Boolean))).sort();
  const marketSel = document.getElementById('f-market');
  marketSel.innerHTML = '<option value="">Wszystkie</option>';
  for (const m of markets) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    marketSel.appendChild(opt);
  }

  // Set default date range from data
  const dates = allRows.map(r => r['Data transakcji']).filter(Boolean).sort();
  if (dates.length) {
    document.getElementById('f-date-from').value = dates[0];
    document.getElementById('f-date-to').value = dates[dates.length - 1];
    filters.dateFrom = dates[0];
    filters.dateTo = dates[dates.length - 1];
  }

  applyFilters();
}

function buildTableHeader() {
  const thead = document.getElementById('table-head');
  const tr = document.createElement('tr');
  for (const col of COLUMNS) {
    const th = document.createElement('th');
    th.dataset.key = col.key;
    th.dataset.type = col.type;
    const icon = document.createElement('span');
    icon.className = 'sort-icon';
    icon.textContent = '↕';
    th.textContent = col.label;
    th.appendChild(icon);
    th.addEventListener('click', () => onSort(col.key));
    tr.appendChild(th);
  }
  thead.innerHTML = '';
  thead.appendChild(tr);
}

// ─── Sorting ──────────────────────────────────────────────────────────────────
function onSort(key) {
  if (sortCol === key) {
    sortAsc = !sortAsc;
  } else {
    sortCol = key;
    sortAsc = true;
  }
  currentPage = 1;
  renderTable();
}

function sortRows(rows) {
  const colDef = COLUMNS.find(c => c.key === sortCol);
  const type = colDef ? colDef.type : 'string';

  return [...rows].sort((a, b) => {
    let va = a[sortCol];
    let vb = b[sortCol];

    // Nulls always last
    if (va === null || va === undefined || va === '') return 1;
    if (vb === null || vb === undefined || vb === '') return -1;

    let cmp;
    if (type === 'number') {
      cmp = Number(va) - Number(vb);
    } else {
      // date and string: localeCompare with numeric option
      cmp = String(va).localeCompare(String(vb), 'pl', { numeric: true });
    }
    return sortAsc ? cmp : -cmp;
  });
}

// ─── Filters ──────────────────────────────────────────────────────────────────
function onBuildingCheck(checkbox) {
  const val = checkbox.value;
  if (checkbox.checked) {
    filters.buildings.add(val);
    checkbox.parentElement.classList.add('checked');
  } else {
    filters.buildings.delete(val);
    checkbox.parentElement.classList.remove('checked');
  }
  applyFilters();
}

function applyFilters() {
  // Read filter values
  filters.dateFrom = document.getElementById('f-date-from').value;
  filters.dateTo   = document.getElementById('f-date-to').value;
  filters.priceMin = document.getElementById('f-price-min').value;
  filters.priceMax = document.getElementById('f-price-max').value;
  filters.search   = document.getElementById('f-search').value.toLowerCase().trim();
  filters.market   = document.getElementById('f-market').value;

  filteredRows = allRows.filter(row => {
    // Date filter
    const dt = row['Data transakcji'] || '';
    if (filters.dateFrom && dt && dt < filters.dateFrom) return false;
    if (filters.dateTo   && dt && dt > filters.dateTo)   return false;

    // Price filter
    const price = row['Cena (PLN)'];
    if (filters.priceMin !== '' && (price === null || price < Number(filters.priceMin))) return false;
    if (filters.priceMax !== '' && (price === null || price > Number(filters.priceMax))) return false;

    // Buildings filter (strict: empty set = 0 rows)
    const bud = row['Nr budynku'] || '';
    if (!filters.buildings.has(bud)) return false;

    // Market filter
    if (filters.market && row['Rodzaj rynku'] !== filters.market) return false;

    // Text search: ID, Ulica, Miejscowość, Nr budynku adres
    if (filters.search) {
      const haystack = [
        row['ID transakcji'],
        row['Ulica'],
        row['Miejscowość'],
        row['Nr budynku adres'],
        row['Nr lokalu'],
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(filters.search)) return false;
    }

    return true;
  });

  updateStats();
  currentPage = 1;
  renderTable();
}

function clearFilters() {
  document.getElementById('f-date-from').value = '';
  document.getElementById('f-date-to').value = '';
  document.getElementById('f-price-min').value = '';
  document.getElementById('f-price-max').value = '';
  document.getElementById('f-search').value = '';
  document.getElementById('f-market').value = '';
  filters.dateFrom = '';
  filters.dateTo = '';
  filters.priceMin = '';
  filters.priceMax = '';
  filters.search = '';
  filters.market = '';

  // Check all buildings
  document.querySelectorAll('#buildings-checks input[type=checkbox]').forEach(cb => {
    cb.checked = true;
    cb.parentElement.classList.add('checked');
    filters.buildings.add(cb.value);
  });

  applyFilters();
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  const prices = filteredRows.map(r => r['Cena (PLN)']).filter(v => typeof v === 'number' && !isNaN(v));
  const m2prices = filteredRows.map(r => r['Cena/m² (PLN)']).filter(v => typeof v === 'number' && !isNaN(v));

  const count = filteredRows.length;
  const avg   = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
  const min   = prices.length ? Math.min(...prices) : null;
  const max   = prices.length ? Math.max(...prices) : null;
  const avgM2 = m2prices.length ? Math.round(m2prices.reduce((a, b) => a + b, 0) / m2prices.length) : null;

  document.getElementById('stat-count').textContent = fmt(count);
  document.getElementById('stat-avg').textContent   = avg   !== null ? fmt(avg)   : '—';
  document.getElementById('stat-min').textContent   = min   !== null ? fmt(min)   : '—';
  document.getElementById('stat-max').textContent   = max   !== null ? fmt(max)   : '—';
  document.getElementById('stat-avgm2').textContent = avgM2 !== null ? fmt(avgM2) : '—';
}

// ─── Table render ─────────────────────────────────────────────────────────────
function renderTable() {
  // Update sort indicators
  document.querySelectorAll('#table-head th').forEach(th => {
    th.classList.remove('sorted');
    const icon = th.querySelector('.sort-icon');
    if (th.dataset.key === sortCol) {
      th.classList.add('sorted');
      icon.textContent = sortAsc ? '↑' : '↓';
      icon.classList.add('active');
    } else {
      icon.textContent = '↕';
      icon.classList.remove('active');
    }
  });

  const sorted = sortRows(filteredRows);
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * perPage;
  const pageRows = sorted.slice(start, start + perPage);

  const tbody = document.getElementById('table-body');

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="empty-state">
      <div class="big">🔍</div>Brak wyników dla wybranych filtrów</td></tr>`;
  } else {
    const fragment = document.createDocumentFragment();
    for (const row of pageRows) {
      const tr = document.createElement('tr');
      for (const col of COLUMNS) {
        const td = document.createElement('td');
        const val = row[col.key];
        if (val === null || val === undefined || val === '') {
          td.textContent = '—';
          td.className = 'null-val';
        } else if (col.type === 'number') {
          td.textContent = fmt(val);
          td.className = 'numeric';
        } else {
          td.textContent = String(val);
        }
        tr.appendChild(td);
      }
      fragment.appendChild(tr);
    }
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  // Update count & pagination
  document.getElementById('filtered-count').textContent = fmt(sorted.length);
  document.getElementById('page-info').textContent =
    sorted.length > 0
      ? `${fmt(start + 1)}–${fmt(Math.min(start + perPage, sorted.length))} z ${fmt(sorted.length)}`
      : '0 wyników';
  document.getElementById('page-label').textContent = `Strona ${currentPage} / ${totalPages}`;
  document.getElementById('btn-prev').disabled = currentPage <= 1;
  document.getElementById('btn-next').disabled = currentPage >= totalPages;
}

// ─── Pagination ───────────────────────────────────────────────────────────────
function changePage(delta) {
  currentPage += delta;
  renderTable();
}

function changePerPage() {
  perPage = Number(document.getElementById('per-page-select').value);
  currentPage = 1;
  renderTable();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('pl-PL').format(n);
}

function resetToUpload() {
  allRows = [];
  filteredRows = [];
  sortCol = 'Data transakcji';
  sortAsc = false;
  currentPage = 1;
  perPage = 25;
  filters = { dateFrom: '', dateTo: '', priceMin: '', priceMax: '', search: '', buildings: new Set(), market: '' };

  document.getElementById('dashboard').classList.remove('visible');
  document.getElementById('drop-area').classList.remove('hidden');
  document.getElementById('btn-reload').style.display = 'none';
  document.getElementById('file-input').value = '';
}

// ─── Event bindings ───────────────────────────────────────────────────────────
document.getElementById('drop-area').addEventListener('click', () => {
  document.getElementById('file-input').click();
});
document.getElementById('file-input').addEventListener('change', handleInputChange);
document.getElementById('btn-reload').addEventListener('click', resetToUpload);
document.getElementById('f-date-from').addEventListener('input', applyFilters);
document.getElementById('f-date-to').addEventListener('input', applyFilters);
document.getElementById('f-price-min').addEventListener('input', applyFilters);
document.getElementById('f-price-max').addEventListener('input', applyFilters);
document.getElementById('f-market').addEventListener('change', applyFilters);
document.getElementById('f-search').addEventListener('input', applyFilters);
document.getElementById('btn-clear-filters').addEventListener('click', clearFilters);
document.getElementById('btn-prev').addEventListener('click', () => changePage(-1));
document.getElementById('btn-next').addEventListener('click', () => changePage(1));
document.getElementById('per-page-select').addEventListener('change', changePerPage);
