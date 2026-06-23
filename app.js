/* Notebook – Work Log
   PWA do szybkiego zapisu karty pracy.
   Dane lokalne w IndexedDB + GitHub. Eksport .xlsx/.csv. Backup: email (Web Share / mailto) + OneDrive (MS Graph).
*/

// ====== Service worker ======
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(()=>{}));
}

// ====== Theme Toggle ======
const THEME_KEY = 'worklog_theme';
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  document.body.classList.toggle('light-mode', saved === 'light');
}
function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
  toast(isLight ? '☀️ Tryb jasny' : '🌙 Tryb ciemny');
}
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  const themeBtn = document.querySelector('.theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
});

// ====== Toast ======
const toastEl = document.getElementById('toast');
function toast(msg, ms=2200) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.hidden = true, ms);
}

// ====== Nawigacja widoków ======
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  window.scrollTo({top:0});
  if (view === 'table') renderTable();
  if (view === 'new')   prepareForm();
  if (view === 'settings') renderSettings();
}
document.querySelectorAll('[data-go]').forEach(el => {
  el.addEventListener('click', () => show(el.dataset.go));
});

// ====== IndexedDB (Cache lokalny) ======
const DB_NAME = 'worklog';
const DB_VER = 1;
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('entries')) {
        const s = d.createObjectStore('entries', { keyPath: 'id', autoIncrement: false });
        s.createIndex('data', 'data');
      }
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'k' });
      if (!d.objectStoreNames.contains('shortcuts')) {
        const s = d.createObjectStore('shortcuts', { keyPath: 'id', autoIncrement: true });
        s.createIndex('key', 'key');
      }
    };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode='readonly') { return db.transaction(store, mode).objectStore(store); }
function idbAll(store) {
  return new Promise((res, rej) => {
    const r = tx(store).getAll();
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function idbPut(store, val) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').put(val);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function idbDel(store, key) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').delete(key);
    r.onsuccess = () => res(); r.onerror = () => rej(r.error);
  });
}
function idbClear(store) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').clear();
    r.onsuccess = () => res(); r.onerror = () => rej(r.error);
  });
}
function idbGet(store, key) {
  return new Promise((res, rej) => {
    const r = tx(store).get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}

// ====== Ustawienia (klucz/wartość) ======
async function getSetting(k, def=null) {
  const r = await idbGet('settings', k);
  return r ? r.v : def;
}
async function setSetting(k, v) {
  return idbPut('settings', { k, v });
}

// ====== Helpers ======
function todayISO() {
  const d = new Date(); const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function minutesBetween(from, to) {
  if (!from || !to) return 0;
  const [fh,fm] = from.split(':').map(Number);
  const [th,tm] = to.split(':').map(Number);
  let m = (th*60+tm) - (fh*60+fm);
  if (m < 0) m += 24*60;
  return m;
}
function formatH(minutes) {
  const h = Math.floor(minutes/60); const m = minutes%60;
  if (!minutes) return '0 h';
  return m ? `${h} h ${m} min` : `${h} h`;
}
function hoursDecimal(minutes) { return Math.round((minutes/60)*100)/100; }
function escapeHTML(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

// ====== Validacja ======
function validateEntry(entry) {
  const errors = [];
  if (!entry.data) errors.push('Data jest wymagana');
  if (!entry.godz_od) errors.push('Godzina od jest wymagana');
  if (!entry.godz_do) errors.push('Godzina do jest wymagana');
  if (entry.godz_od && entry.godz_do) {
    const mins = minutesBetween(entry.godz_od, entry.godz_do);
    if (mins === 0) errors.push('Godzina zakończenia musi być później niż rozpoczęcia');
  }
  return errors;
}

// ====== Formularz ======
const form = document.getElementById('entry-form');
const hoursSum = document.getElementById('hours-sum');

async function prepareForm() {
  form.data.value = todayISO();
  const entries = await idbAll('entries');
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const fillDL = (id, vals) => {
    const dl = document.getElementById(id);
    dl.innerHTML = vals.map(v => `<option value="${escapeHTML(v)}">`).join('');
  };
  fillDL('dl-projekt', uniq(entries.map(e => e.projekt)));
  fillDL('dl-mieszkanie', uniq(entries.map(e => e.mieszkanie)));
  updateHoursSum();
}
function updateHoursSum() {
  const m = minutesBetween(form.godz_od.value, form.godz_do.value);
  hoursSum.textContent = 'Godziny: ' + (m ? formatH(m) : '—');
}
form.godz_od.addEventListener('change', updateHoursSum);
form.godz_do.addEventListener('change', updateHoursSum);

// skróty słów-kluczy
const rodzajEl = form.rodzaj;
const suggBox = document.getElementById('shortcut-suggestions');
let shortcutsCache = [];
async function reloadShortcuts() { shortcutsCache = await idbAll('shortcuts'); }
function updateShortcutSuggestions() {
  const txt = rodzajEl.value.toLowerCase().trim();
  const word = txt.split(/\s+/).pop() || '';
  if (!word || word.length < 2) { suggBox.innerHTML=''; return; }
  const hits = shortcutsCache.filter(s => s.key.toLowerCase().startsWith(word) || word.startsWith(s.key.toLowerCase()));
  if (!hits.length) { suggBox.innerHTML=''; return; }
  suggBox.innerHTML = hits.map(s =>
    `<span class="chip" data-key="${escapeHTML(s.key)}" data-val="${escapeHTML(s.value)}">+ ${escapeHTML(s.value)}</span>`
  ).join('');
  suggBox.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    const parts = rodzajEl.value.split(/(\s+)/);
    for (let i = parts.length-1; i >= 0; i--) {
      if (parts[i].trim()) { parts[i] = c.dataset.val; break; }
    }
    rodzajEl.value = parts.join('') + (rodzajEl.value.endsWith(' ') ? '' : ' ');
    rodzajEl.focus();
    suggBox.innerHTML='';
  }));
}
rodzajEl.addEventListener('input', updateShortcutSuggestions);

// duplikuj ostatni
document.getElementById('btn-duplicate').addEventListener('click', async () => {
  const all = await idbAll('entries');
  if (!all.length) { toast('❌ Brak wpisów do zduplikowania'); return; }
  const last = all[all.length-1];
  form.projekt.value = last.projekt || '';
  form.mieszkanie.value = last.mieszkanie || '';
  form.rodzaj.value = last.rodzaj || '';
  form.godz_od.value = last.godz_do || last.godz_od || '';
  form.godz_do.value = '';
  updateHoursSum();
  toast('✅ Zduplikowano – zmień godziny/opis i zapisz');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const entry = {
    id: Date.now().toString(),
    imie: await getSetting('imie', ''),
    data: form.data.value,
    godz_od: form.godz_od.value,
    godz_do: form.godz_do.value,
    minuty: minutesBetween(form.godz_od.value, form.godz_do.value),
    projekt: form.projekt.value.trim(),
    mieszkanie: form.mieszkanie.value.trim(),
    rodzaj: form.rodzaj.value.trim(),
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  };
  
  const errors = validateEntry(entry);
  if (errors.length) { toast('❌ ' + errors[0]); return; }
  
  await idbPut('entries', entry);
  
  const token = await getSetting('github_token');
  if (token) {
    try {
      await GITHUB_DB.setToken(token);
      await GITHUB_DB.addEntry(entry);
      toast('✅ Zapisano (GitHub + Local)');
    } catch (e) {
      toast('✅ Zapisano lokalnie (GitHub offline)');
    }
  } else {
    toast('✅ Zapisano lokalnie');
  }
  
  form.reset();
  prepareForm();
});

// ====== Tabela ======
const tbody = document.querySelector('#tbl tbody');
const filterQ = document.getElementById('filter-q');
const filterFrom = document.getElementById('filter-from');
const filterTo = document.getElementById('filter-to');
const summary = document.getElementById('summary');

async function renderTable() {
  const all = await idbAll('entries');
  const q = (filterQ.value || '').toLowerCase();
  const from = filterFrom.value, to = filterTo.value;
  const rows = all.filter(e => {
    if (from && e.data < from) return false;
    if (to && e.data > to) return false;
    if (!q) return true;
    return [e.projekt,e.mieszkanie,e.rodzaj].some(v => (v||'').toLowerCase().includes(q));
  }).sort((a,b) => (b.data+b.godz_od).localeCompare(a.data+a.godz_od));

  tbody.innerHTML = rows.map(r => `
    <tr data-id="${r.id}">
      <td>${escapeHTML(r.data)}</td>
      <td>${escapeHTML(r.godz_od)}–${escapeHTML(r.godz_do)}<br><span class="hint">${formatH(r.minuty||0)}</span></td>
      <td>${escapeHTML(r.projekt||'')}</td>
      <td>${escapeHTML(r.mieszkanie||'')}</td>
      <td>${escapeHTML(r.rodzaj||'')}</td>
      <td><button type="button" class="edit" aria-label="Edytuj" title="Edytuj">✎</button><button type="button" class="del" aria-label="Usuń" title="Usuń">✕</button></td>
    </tr>
  `).join('');
  
  tbody.querySelectorAll('tr').forEach(tr => {
    const id = tr.dataset.id;
    tr.querySelector('.edit').addEventListener('click', async () => {
      const entry = await idbGet('entries', id);
      if (entry) openEditModal(entry);
    });
    tr.querySelector('.del').addEventListener('click', async () => {
      if (!confirm('Usunąć wpis?')) return;
      await idbDel('entries', id);
      const token = await getSetting('github_token');
      if (token) {
        try {
          await GITHUB_DB.setToken(token);
          await GITHUB_DB.deleteEntry(id);
        } catch (e) { }
      }
      renderTable();
      toast('✅ Usunięto');
    });
  });

  const totalMin = rows.reduce((s,r) => s + (r.minuty||0), 0);
  summary.textContent = `Wpisów: ${rows.length} · Godziny: ${formatH(totalMin)}`;
}
[filterQ, filterFrom, filterTo].forEach(el => el.addEventListener('input', renderTable));

// ====== Edit Modal ======
const editModal = document.getElementById('edit-modal');
const editForm = document.getElementById('edit-form');

function openEditModal(entry) {
  editForm['entry-id'].value = entry.id;
  editForm.data.value = entry.data;
  editForm.godz_od.value = entry.godz_od;
  editForm.godz_do.value = entry.godz_do;
  editForm.projekt.value = entry.projekt || '';
  editForm.mieszkanie.value = entry.mieszkanie || '';
  editForm.rodzaj.value = entry.rodzaj || '';
  updateEditHoursSum();
  editModal.hidden = false;
}

function closeEditModal() {
  editModal.hidden = true;
}

document.querySelector('.modal-close').addEventListener('click', closeEditModal);
document.querySelector('.btn-cancel').addEventListener('click', closeEditModal);
editModal.querySelector('.modal-overlay').addEventListener('click', closeEditModal);

function updateEditHoursSum() {
  const m = minutesBetween(editForm.godz_od.value, editForm.godz_do.value);
  document.getElementById('edit-hours-sum').textContent = 'Godziny: ' + (m ? formatH(m) : '—');
}
editForm.godz_od.addEventListener('change', updateEditHoursSum);
editForm.godz_do.addEventListener('change', updateEditHoursSum);

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = editForm['entry-id'].value;
  const updated = {
    data: editForm.data.value,
    godz_od: editForm.godz_od.value,
    godz_do: editForm.godz_do.value,
    minuty: minutesBetween(editForm.godz_od.value, editForm.godz_do.value),
    projekt: editForm.projekt.value.trim(),
    mieszkanie: editForm.mieszkanie.value.trim(),
    rodzaj: editForm.rodzaj.value.trim(),
    updated: new Date().toISOString()
  };
  
  const errors = validateEntry(updated);
  if (errors.length) { toast('❌ ' + errors[0]); return; }
  
  const existing = await idbGet('entries', id);
  const merged = { ...existing, ...updated };
  
  await idbPut('entries', merged);
  
  const token = await getSetting('github_token');
  if (token) {
    try {
      await GITHUB_DB.setToken(token);
      await GITHUB_DB.updateEntry(id, updated);
      toast('✅ Zaktualizowano (GitHub + Local)');
    } catch (e) {
      toast('✅ Zaktualizowano lokalnie');
    }
  } else {
    toast('✅ Zaktualizowano');
  }
  
  closeEditModal();
  renderTable();
});

// ====== Eksport ======
async function buildWorkbook() {
  const all = (await idbAll('entries')).sort((a,b) => (a.data+a.godz_od).localeCompare(b.data+b.godz_od));
  const imie = await getSetting('imie', '');
  const header = ['Imię','Data','Godz. od','Godz. do','Godziny','Projekt','Mieszkanie','Rodzaj wykonywanych prac'];
  const rows = all.map(e => [
    e.imie || imie || '', e.data, e.godz_od, e.godz_do, hoursDecimal(e.minuty||0),
    e.projekt||'', e.mieszkanie||'', e.rodzaj||''
  ]);
  const totalH = hoursDecimal(all.reduce((s,e)=>s+(e.minuty||0),0));
  rows.push([]);
  rows.push(['', '', '', 'RAZEM', totalH, '', '', '']);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{wch:10},{wch:12},{wch:8},{wch:8},{wch:8},{wch:18},{wch:14},{wch:40}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Karta pracy');
  return wb;
}
async function exportBlob(type='xlsx') {
  const wb = await buildWorkbook();
  if (type === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets['Karta pracy']);
    return new Blob([csv], { type: 'text/csv;charset=utf-8' });
  }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
document.getElementById('btn-export-xlsx').addEventListener('click', async () => {
  const b = await exportBlob('xlsx'); download(b, `karta-pracy_${todayISO()}.xlsx`); toast('✅ Pobrano .xlsx');
});
document.getElementById('btn-export-csv').addEventListener('click', async () => {
  const b = await exportBlob('csv'); download(b, `karta-pracy_${todayISO()}.csv`); toast('✅ Pobrano .csv');
});

// ====== Email ======
document.getElementById('btn-email').addEventListener('click', async () => {
  const to = await getSetting('email', '');
  const blob = await exportBlob('xlsx');
  const file = new File([blob], `karta-pracy_${todayISO()}.xlsx`, { type: blob.type });
  const subject = `Karta pracy – ${todayISO()}`;
  const body = `W załączniku karta pracy do ${todayISO()}.`;

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: subject, text: body });
      toast('✅ Otwarto udostępnianie');
      return;
    } catch(e) { }
  }
  download(blob, file.name);
  const mailto = `mailto:${encodeURIComponent(to||'')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n\n(Dodaj pobrany plik jako załącznik.)')}`;
  location.href = mailto;
});

// ====== GitHub Integration ======
document.getElementById('btn-github-connect').addEventListener('click', async () => {
  const token = document.getElementById('set-github-token').value.trim();
  if (!token) { toast('❌ Wpisz GitHub token'); return; }
  
  try {
    await GITHUB_DB.setToken(token);
    await GITHUB_DB.sync();
    toast('✅ Połączono z GitHub');
    renderSettings();
  } catch (e) {
    toast('❌ Błąd: ' + e.message);
  }
});

document.getElementById('btn-github-disconnect').addEventListener('click', async () => {
  await GITHUB_DB.clearToken();
  toast('✅ Rozłączono z GitHub');
  renderSettings();
});

document.getElementById('btn-sync-now').addEventListener('click', async () => {
  try {
    await GITHUB_DB.sync();
    toast('✅ Zsynchronizowano');
    renderTable();
  } catch (e) {
    toast('❌ Błąd sync: ' + e.message);
  }
});

// ====== OneDrive ======
const MSAL_CLIENT_ID_KEY = 'msal_client_id';
const MSAL_TOKEN_KEY = 'msal_token';
const MSAL_EXP_KEY   = 'msal_exp';

async function onedriveEnsureToken(interactive=false) {
  const tok = await getSetting(MSAL_TOKEN_KEY);
  const exp = await getSetting(MSAL_EXP_KEY, 0);
  if (tok && Date.now() < exp - 60000) return tok;
  if (!interactive) return null;
  return onedriveLogin();
}
async function onedriveLogin() {
  let clientId = await getSetting(MSAL_CLIENT_ID_KEY);
  if (!clientId) {
    clientId = prompt(
      'Aby łączyć z OneDrive, podaj Client ID aplikacji Microsoft (rejestracja w Azure Portal → App registrations, Redirect URI = ta strona).\n\nJeśli nie masz, możesz to pominąć i użyć innej metody.'
    );
    if (!clientId) return null;
    await setSetting(MSAL_CLIENT_ID_KEY, clientId.trim());
  }
  const redirect = location.origin + location.pathname;
  const state = Math.random().toString(36).slice(2);
  const nonce = Math.random().toString(36).slice(2);
  const scope = 'Files.ReadWrite offline_access openid profile';
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` +
              `?client_id=${encodeURIComponent(clientId)}` +
              `&response_type=token` +
              `&redirect_uri=${encodeURIComponent(redirect)}` +
              `&scope=${encodeURIComponent(scope)}` +
              `&state=${encodeURIComponent(state)}` +
              `&nonce=${encodeURIComponent(nonce)}`;
  const w = window.open(url, 'onedrive_login', 'width=480,height=720');
  if (!w) { toast('❌ Popup zablokowany'); return null; }
  return new Promise(resolve => {
    const t = setInterval(async () => {
      try {
        if (w.closed) { clearInterval(t); resolve(null); return; }
        const h = w.location.hash || '';
        if (h.includes('access_token=')) {
          const p = new URLSearchParams(h.slice(1));
          const token = p.get('access_token');
          const expIn = Number(p.get('expires_in') || 3600);
          await setSetting(MSAL_TOKEN_KEY, token);
          await setSetting(MSAL_EXP_KEY, Date.now() + expIn*1000);
          clearInterval(t); w.close(); resolve(token);
        }
      } catch(e) { }
    }, 400);
  });
}
async function onedriveUpload(blob, filename) {
  const token = await onedriveEnsureToken(false);
  if (!token) throw new Error('Brak autoryzacji OneDrive');
  const folder = (await getSetting('onedrive_folder','/Work Log')).replace(/^\/+|\/+$/g,'');
  const path = `/drive/root:/${folder}/${filename}:/content`;
  const resp = await fetch('https://graph.microsoft.com/v1.0/me'+path, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer '+token, 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob
  });
  if (!resp.ok) throw new Error('OneDrive: '+resp.status+' '+resp.statusText);
  return resp.json();
}
async function maybeAutoSyncOneDrive() {
  const tok = await getSetting(MSAL_TOKEN_KEY);
  if (!tok) return;
  try {
    const blob = await exportBlob('xlsx');
    await onedriveUpload(blob, 'karta-pracy.xlsx');
  } catch(e) { }
}

document.getElementById('btn-onedrive').addEventListener('click', async () => {
  try {
    let tok = await onedriveEnsureToken(true);
    if (!tok) return;
    const blob = await exportBlob('xlsx');
    await onedriveUpload(blob, 'karta-pracy.xlsx');
    toast('✅ Zapisano w OneDrive');
    renderSettings();
  } catch(e) { toast('❌ ' + e.message); }
});
document.getElementById('btn-onedrive-connect').addEventListener('click', async () => {
  const t = await onedriveLogin();
  if (t) toast('✅ Połączono z OneDrive');
  renderSettings();
});
document.getElementById('btn-onedrive-disconnect').addEventListener('click', async () => {
  await setSetting(MSAL_TOKEN_KEY, null);
  await setSetting(MSAL_EXP_KEY, 0);
  await setSetting(MSAL_CLIENT_ID_KEY, null);
  renderSettings();
  toast('✅ Rozłączono');
});

// ====== Ustawienia ======
async function renderSettings() {
  document.getElementById('set-imie').value = await getSetting('imie','') || '';
  document.getElementById('set-email').value = await getSetting('email','') || '';
  document.getElementById('set-onedrive-folder').value = await getSetting('onedrive_folder','/Work Log');
  
  const ghToken = await getSetting('github_token');
  document.getElementById('set-github-token').value = ghToken ? '••••••••' : '';
  document.getElementById('github-status').textContent = 'GitHub: ' + (ghToken ? '✅ Połączony' : '❌ Niepołączony');
  
  const tok = await getSetting(MSAL_TOKEN_KEY);
  document.getElementById('onedrive-status').textContent = 'OneDrive: ' + (tok ? '✅ Połączony' : '❌ Niepołączony');

  await reloadShortcuts();
  const list = document.getElementById('shortcuts-list');
  if (!shortcutsCache.length) {
    list.innerHTML = '<div class="hint">Brak skrótów. Dodaj pierwszy niżej – np. klucz <code>okno</code>, rozwinięcie „regulacja okna PCV".</div>';
  } else {
    list.innerHTML = shortcutsCache.map(s => `
      <div class="shortcut-row" data-id="${s.id}">
        <div class="k">${escapeHTML(s.key)}</div>
        <div class="v">${escapeHTML(s.value)}</div>
        <button type="button" aria-label="Usuń">✕</button>
      </div>
    `).join('');
    list.querySelectorAll('.shortcut-row').forEach(row => {
      row.querySelector('button').addEventListener('click', async () => {
        await idbDel('shortcuts', Number(row.dataset.id));
        renderSettings();
      });
    });
  }
}
document.getElementById('set-imie').addEventListener('change', e => setSetting('imie', e.target.value.trim()));
document.getElementById('set-email').addEventListener('change', e => setSetting('email', e.target.value.trim()));
document.getElementById('set-onedrive-folder').addEventListener('change', e => setSetting('onedrive_folder', e.target.value.trim() || '/Work Log'));

document.getElementById('btn-add-shortcut').addEventListener('click', async () => {
  const k = document.getElementById('new-shortcut-key').value.trim().toLowerCase();
  const v = document.getElementById('new-shortcut-val').value.trim();
  if (!k || !v) { toast('❌ Podaj słowo-klucz i rozwinięcie'); return; }
  await idbPut('shortcuts', { key: k, value: v });
  document.getElementById('new-shortcut-key').value = '';
  document.getElementById('new-shortcut-val').value = '';
  await reloadShortcuts();
  renderSettings();
  toast('✅ Dodano skrót');
});

document.getElementById('btn-backup').addEventListener('click', async () => {
  const data = {
    entries: await idbAll('entries'),
    shortcuts: await idbAll('shortcuts'),
    settings: {
      imie: await getSetting('imie',''),
      email: await getSetting('email',''),
      onedrive_folder: await getSetting('onedrive_folder','/Work Log')
    },
    exported_at: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  download(blob, `worklog-backup_${todayISO()}.json`);
  toast('✅ Backup pobrany');
});
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const text = await f.text();
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data.entries)) for (const x of data.entries) { delete x.id; await idbPut('entries', { id: Date.now().toString() + Math.random(), ...x }); }
    if (Array.isArray(data.shortcuts)) for (const x of data.shortcuts) { delete x.id; await idbPut('shortcuts', x); }
    if (data.settings) for (const [k,v] of Object.entries(data.settings)) await setSetting(k,v);
    toast('✅ Zaimportowano');
    renderSettings();
  } catch(err) { toast('❌ Błąd importu: '+err.message); }
  e.target.value = '';
});

document.getElementById('btn-wipe').addEventListener('click', async () => {
  if (!confirm('Na pewno wyczyścić wszystkie wpisy? Ustawienia i skróty pozostaną.')) return;
  await idbClear('entries');
  const token = await getSetting('github_token');
  if (token) {
    try {
      await GITHUB_DB.setToken(token);
      await GITHUB_DB.wipeAll();
    } catch (e) { }
  }
  toast('✅ Wyczyszczono');
  renderTable();
});

// ====== Start ======
(async function(){
  await openDB();
  await reloadShortcuts();
  show('cover');
})();
