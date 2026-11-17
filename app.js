(() => {
'use strict';

/* =========================================================
   Task Board — offline-first task board with photos,
   priorities, fix-by / completed dates and reminders.
   No frameworks, no build step. Data lives in IndexedDB.
   ========================================================= */

const PRI = { high: 'High', medium: 'Medium', low: 'Low', last: 'Last' };
const PRI_KEYS = Object.keys(PRI);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------------- storage (IndexedDB) ---------------- */
const dbp = new Promise((res, rej) => {
  const r = indexedDB.open('taskboard', 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore('tasks', { keyPath: 'id' });
    r.result.createObjectStore('photos', { keyPath: 'id' });
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const os = async (name, mode = 'readonly') => (await dbp).transaction(name, mode).objectStore(name);
const DB = {
  tasks: async () => wrap((await os('tasks')).getAll()),
  put: async t => wrap((await os('tasks', 'readwrite')).put(t)),
  del: async id => wrap((await os('tasks', 'readwrite')).delete(id)),
  photo: async id => wrap((await os('photos')).get(id)),
  putPhoto: async p => wrap((await os('photos', 'readwrite')).put(p)),
  delPhoto: async id => wrap((await os('photos', 'readwrite')).delete(id)),
};

const pref = {
  get(k, d) { try { return localStorage.getItem('tb.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tb.' + k, v); } catch {} },
};

/* ---------------- dates ---------------- */
const pad = n => String(n).padStart(2, '0');
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDT = d => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const today = () => localDate(new Date());
const parseDay = s => new Date(s + 'T00:00');
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
const fmtDay = s => {
  const d = parseDay(s);
  const o = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return d.toLocaleDateString(undefined, o);
};
const fmtDT = s => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

function status(t, t0 = today()) {
  if (t.doneDate) return 'done';
  if (!t.due) return 'none';
  return t.due < t0 ? 'overdue' : t.due === t0 ? 'today' : 'upcoming';
}
function dueLabel(t, t0 = today()) {
  if (t.doneDate) return ['done', 'Done ' + fmtDay(t.doneDate)];
  if (!t.due) return null;
  const n = daysBetween(t0, t.due);
  if (n < 0) return ['overdue', `Overdue ${-n}d · ${fmtDay(t.due)}`];
  if (n === 0) return ['today', 'Due today'];
  if (n === 1) return ['soon', 'Due tomorrow'];
  return [n <= 3 ? 'soon' : '', 'Due ' + fmtDay(t.due)];
}

/* ---------------- tiny DOM helpers ---------------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids) if (c != null && c !== false) el.append(c);
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function icon(name) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVGNS, 'use'); u.setAttribute('href', '#i-' + name);
  s.append(u); return s;
}
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

let toastTimer;
function toast(msg, action, fn, ms = 3500) {
  const el = $('#toast');
  const host = $('dialog[open]') || document.body; // keep toast above an open modal
  if (el.parentNode !== host) host.append(el);
  el.replaceChildren(h('span', { text: msg }));
  if (action) el.append(h('button', { type: 'button', class: 'toast-btn', text: action, onclick: () => { el.classList.remove('show'); fn(); } }));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------------- photos ---------------- */
// Photos are shrunk on-device before saving: a full view (max 1600px) and a
// small thumbnail for the board. Keeps storage small and the board fast.
async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  }
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode(); return img; }
  finally { URL.revokeObjectURL(url); }
}
function resize(src, max, quality) {
  const w = src.width, hgt = src.height;
  const s = Math.min(1, max / Math.max(w, hgt));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(hgt * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', quality));
}
const urlCache = new Map();
function photoURL(id, kind = 'thumb') {
  const key = id + ':' + kind;
  if (!urlCache.has(key)) urlCache.set(key, DB.photo(id).then(p => (p && p[kind] ? URL.createObjectURL(p[kind]) : '')).catch(() => ''));
  return urlCache.get(key);
}
function dropPhoto(id) {
  for (const kind of ['thumb', 'full']) {
    const key = id + ':' + kind;
    const p = urlCache.get(key);
    if (p) { p.then(u => u && URL.revokeObjectURL(u)); urlCache.delete(key); }
  }
  DB.delPhoto(id).catch(() => {});
}
async function setImg(img, id, kind) { const u = await photoURL(id, kind); if (u) img.src = u; }

/* ---------------- state ---------------- */
const tasks = new Map();
const ui = { view: pref.get('view', 'open'), sort: pref.get('sort', 'due'), quick: null, q: '' };
const board = $('#board');
const cols = Object.fromEntries($$('.col', board).map(c => [c.dataset.p, { el: c, list: $('.list', c), count: $('.count', c) }]));
const form = $('#form');
const F = name => form.elements[name];
const editor = $('#editor');
const viewer = $('#viewer');

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const str = v => (typeof v === 'string' ? v : '');
  return {
    id: String(raw.id),
    title: str(raw.title).slice(0, 200) || 'Untitled task',
    notes: str(raw.notes),
    priority: PRI[raw.priority] ? raw.priority : 'medium',
    due: /^\d{4}-\d{2}-\d{2}$/.test(raw.due) ? raw.due : '',
    doneDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.doneDate) ? raw.doneDate : '',
    remindAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw.remindAt) ? raw.remindAt.slice(0, 16) : '',
    reminded: !!raw.reminded,
    photos: Array.isArray(raw.photos) ? raw.photos.filter(p => typeof p === 'string') : [],
    created: Number(raw.created) || Date.now(),
    updated: Number(raw.updated) || Date.now(),
  };
}

async function save(t) {
  t.updated = Date.now();
  tasks.set(t.id, t);
  queueRender();
  schedule();
  try { await DB.put(t); } catch (e) { console.error(e); toast('Could not save — storage may be full'); }
}

let persistAsked = false;
function persist() {
  // Ask the browser not to evict our data when the device is low on space.
  if (persistAsked) return; persistAsked = true;
  navigator.storage?.persist?.().catch(() => {});
}

/* ---------------- rendering ---------------- */
function sorter(a, b) {
  if (ui.sort === 'new') return b.created - a.created;
  if (a.doneDate || b.doneDate) {
    if (a.doneDate && b.doneDate) return b.doneDate.localeCompare(a.doneDate) || b.updated - a.updated;
    return a.doneDate ? 1 : -1;
  }
  return (a.due || '9999').localeCompare(b.due || '9999') || b.created - a.created;
}

function card(t, t0) {
  const st = status(t, t0);
  const due = dueLabel(t, t0);
  const el = h('article', {
    class: 'card' + (st === 'done' ? ' is-done' : '') + (st === 'overdue' ? ' is-overdue' : ''),
    'data-id': t.id, draggable: 'true', tabindex: '0',
  });
  el.append(
    h('button', { type: 'button', class: 'check', 'data-act': 'toggle', 'aria-label': (t.doneDate ? 'Mark not done: ' : 'Mark done: ') + t.title }, icon('check')),
    h('div', { class: 'card-body' },
      h('h3', { text: t.title }),
      t.notes ? h('p', { class: 'notes', text: t.notes }) : null,
      h('div', { class: 'meta' },
        due ? h('span', { class: 'badge ' + due[0], text: due[1] }) : null,
        t.remindAt && !t.doneDate ? h('span', { class: 'badge remind' + (t.reminded ? ' past' : ''), title: 'Reminder' }, icon('bell'), fmtDT(t.remindAt)) : null,
        t.photos.length > 1 ? h('span', { class: 'badge', title: 'Photos' }, icon('camera'), String(t.photos.length)) : null,
      ),
    ),
  );
  if (t.photos.length) {
    const img = h('img', { class: 'thumb', alt: 'Photo', 'data-act': 'photo', decoding: 'async', width: '64', height: '64' });
    setImg(img, t.photos[0], 'thumb');
    el.append(img);
  }
  return el;
}

const EMPTY = { high: 'Nothing urgent 🎉', medium: 'No medium tasks', low: 'No low tasks', last: 'Nothing here' };
let lastDay = today();

function render() {
  const t0 = today(); lastDay = t0;
  const q = ui.q.trim().toLowerCase();
  const groups = Object.fromEntries(PRI_KEYS.map(k => [k, []]));
  const c = { overdue: 0, today: 0, open: 0, done: 0 };
  for (const t of tasks.values()) {
    const st = status(t, t0);
    if (st === 'done') c.done++;
    else { c.open++; if (st === 'overdue' || st === 'today') c[st]++; }
    if (ui.view === 'open' && st === 'done') continue;
    if (ui.view === 'done' && st !== 'done') continue;
    if (ui.quick && st !== ui.quick) continue;
    if (q && !(t.title + '\n' + t.notes).toLowerCase().includes(q)) continue;
    groups[t.priority].push(t);
  }
  for (const k of PRI_KEYS) {
    const list = groups[k].sort(sorter);
    const frag = document.createDocumentFragment();
    for (const t of list) frag.append(card(t, t0));
    if (!list.length) frag.append(h('p', { class: 'empty', text: q || ui.quick ? 'No matches' : ui.view === 'done' ? 'Nothing done yet' : EMPTY[k] }));
    cols[k].list.replaceChildren(frag);
    cols[k].count.textContent = list.length;
  }
  for (const b of $$('.stat')) {
    const k = b.dataset.stat;
    b.firstElementChild.textContent = c[k];
    b.classList.toggle('has', c[k] > 0);
    b.classList.toggle('active', k === ui.quick || (!ui.quick && k === ui.view));
  }
  for (const b of $$('.seg button')) b.setAttribute('aria-checked', String(b.dataset.view === ui.view));
  const qt = $('#quickTag');
  qt.hidden = !ui.quick;
  if (ui.quick) qt.replaceChildren(ui.quick === 'overdue' ? 'Overdue only' : 'Due today only',
    h('button', { type: 'button', 'aria-label': 'Clear filter', onclick: () => { ui.quick = null; render(); } }, icon('x')));
  $('#sort').value = ui.sort;
  try {
    const n = c.overdue + c.today;
    if (n) navigator.setAppBadge?.(n)?.catch?.(() => {}); else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch {}
  renderBanner();
}
let raf = 0;
function queueRender() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }

/* ---------------- reminders ---------------- */
const canNotify = () => 'Notification' in window;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function requestNotify() {
  if (!canNotify()) {
    toast(isIOS ? 'On iPhone: Share → Add to Home Screen, then open it from there' : 'Notifications aren’t supported in this browser', null, null, 6000);
    return false;
  }
  if (Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} }
  if (Notification.permission === 'denied') toast('Notifications are blocked — allow them in your browser/site settings', null, null, 6000);
  renderBanner(); updateHint();
  return Notification.permission === 'granted';
}

async function notify(t) {
  const title = '⏰ ' + t.title;
  const d = dueLabel(t);
  const body = [`${PRI[t.priority]} priority`, d && d[1], t.notes].filter(Boolean).join(' · ');
  const opts = { body, tag: t.id, data: { id: t.id }, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', requireInteraction: true, renotify: true };
  if (canNotify() && Notification.permission === 'granted') {
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) return await reg.showNotification(title, opts);
      new Notification(title, opts);
    } catch { try { new Notification(title, opts); } catch {} }
  }
}

function fire(t) {
  t.reminded = true;
  DB.put(t).catch(() => {});
  navigator.vibrate?.([180, 80, 180]);
  toast('⏰ ' + t.title, 'Open', () => openEditor(t), 10000);
  notify(t);
}

let timer = 0;
function schedule() {
  clearTimeout(timer);
  const now = Date.now();
  if (today() !== lastDay) queueRender(); // day rolled over: refresh overdue / due-today
  let next = new Date().setHours(24, 0, 5, 0);
  let fired = false;
  for (const t of tasks.values()) {
    if (t.doneDate || !t.remindAt || t.reminded) continue;
    const at = new Date(t.remindAt).getTime();
    if (Number.isNaN(at)) continue;
    if (at <= now + 500) { fire(t); fired = true; } else if (at < next) next = at;
  }
  if (fired) queueRender();
  // Re-check at least every 10 min so a sleeping laptop/phone catches up quickly.
  timer = setTimeout(schedule, Math.max(1000, Math.min(next - now, 6e5)));
}

/* ---------------- calendar (.ics) ---------------- */
// Calendar alarms are the most reliable way to get a phone alert even when
// the app is completely closed, so every task can be sent to the calendar.
function icsEvent(t) {
  const start = t.remindAt ? new Date(t.remindAt) : t.due ? new Date(t.due + 'T08:00') : null;
  if (!start || Number.isNaN(+start)) return null;
  const end = new Date(+start + 15 * 6e4);
  const f = d => localDT(d).replace(/[-:]/g, '') + '00';
  const esc = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\r?\n/g, '\\n');
  const desc = [`Priority: ${PRI[t.priority]}`, t.due && `Fix by: ${fmtDay(t.due)}`, t.notes].filter(Boolean).join('\n');
  return [
    'BEGIN:VEVENT', `UID:${t.id}@taskboard`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    `DTSTART:${f(start)}`, `DTEND:${f(end)}`,
    `SUMMARY:${esc((t.priority === 'high' ? '❗ ' : '') + t.title)}`, `DESCRIPTION:${esc(desc)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(t.title)}`, 'TRIGGER:-PT0M', 'END:VALARM',
    'END:VEVENT',
  ];
}
function fold(line) {
  const ch = [...line];
  if (ch.length <= 74) return line;
  const out = [];
  for (let i = 0; i < ch.length; i += 70) out.push(ch.slice(i, i + 70).join(''));
  return out.join('\r\n ');
}
function downloadICS(list, name) {
  const ev = list.map(icsEvent).filter(Boolean);
  if (!ev.length) return toast('Set a reminder or a “fixed by” date first');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Task Board//EN', 'CALSCALE:GREGORIAN', ...ev.flat(), 'END:VCALENDAR'];
  download(new Blob([lines.map(fold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' }), name);
}

/* ---------------- banner ---------------- */
function renderBanner() {
  const el = $('#banner');
  const pending = [...tasks.values()].some(t => t.remindAt && !t.doneDate && !t.reminded);
  let msg = '', btn = null;
  if (pending && pref.get('bannerOff') !== '1') {
    if (!canNotify() && isIOS && !standalone) {
      msg = 'For reminder pop-ups on iPhone, tap Share → “Add to Home Screen” and open Task Board from there. Or use “Add to calendar” on a task.';
    } else if (canNotify() && Notification.permission === 'default') {
      msg = 'Turn on notifications so your reminders can pop up.';
      btn = h('button', { type: 'button', class: 'btn primary', text: 'Turn on', onclick: requestNotify });
    }
  }
  el.hidden = !msg;
  if (msg) el.replaceChildren(h('p', { text: msg }), btn,
    h('button', { type: 'button', class: 'btn ghost', text: 'Dismiss', onclick: () => { pref.set('bannerOff', '1'); renderBanner(); } }));
}

/* ---------------- editor ---------------- */
const ed = { task: null, isNew: true, photos: [], added: [], removed: [], dirty: false };

function openEditor(t) {
  if (editor.open) return;
  const isNew = !t;
  t = t || normalize({ id: uid(), title: '', priority: 'medium' });
  if (isNew) t.title = '';
  Object.assign(ed, { task: t, isNew, photos: [...t.photos], added: [], removed: [], dirty: false });
  F('title').value = t.title;
  F('notes').value = t.notes;
  F('priority').value = t.priority;
  F('due').value = t.due;
  F('doneDate').value = t.doneDate;
  F('remindAt').value = t.remindAt;
  $('#edTitle').textContent = isNew ? 'New task' : 'Edit task';
  $('#delBtn').hidden = isNew;
  $('#doneTodayBtn').hidden = !!t.doneDate;
  renderPhotos(); updateHint();
  editor.showModal();
  if (!matchMedia('(pointer: coarse)').matches) F('title').focus();
  else editor.querySelector('.ed-body').scrollTop = 0;
}

function renderPhotos(busy = 0) {
  const box = $('#photos');
  const items = ed.photos.map(id => {
    const img = h('img', { alt: 'Task photo', 'data-view': id, decoding: 'async' });
    setImg(img, id, 'thumb');
    return h('div', { class: 'ph' }, img, h('button', { type: 'button', class: 'ph-x', 'data-rm': id, 'aria-label': 'Remove photo' }, icon('x')));
  });
  for (let i = 0; i < busy; i++) items.push(h('div', { class: 'ph busy', text: 'Saving…' }));
  box.replaceChildren(...items);
  box.hidden = !items.length;
}

async function addFiles(files) {
  files = [...files];
  if (!files.length) return;
  let left = files.length;
  renderPhotos(left);
  for (const f of files) {
    try {
      const src = await loadImage(f);
      const [full, thumb] = await Promise.all([resize(src, 1600, 0.78), resize(src, 320, 0.7)]);
      src.close?.();
      const id = uid();
      await DB.putPhoto({ id, full, thumb });
      ed.photos.push(id); ed.added.push(id); ed.dirty = true;
    } catch (e) {
      console.error(e);
      toast('Couldn’t read that photo');
    }
    renderPhotos(--left);
  }
  persist();
}

function updateHint() {
  const el = $('#remindHint');
  const v = F('remindAt').value;
  if (!v) { el.textContent = ''; return; }
  if (new Date(v) <= Date.now()) { el.textContent = 'That time has already passed.'; return; }
  if (!canNotify()) el.textContent = isIOS && !standalone
    ? 'Tip: add Task Board to your Home Screen for pop-up reminders, or tap “Add to calendar” for a guaranteed alert.'
    : 'This browser can’t show notifications — tap “Add to calendar” for a guaranteed alert.';
  else if (Notification.permission === 'denied') el.textContent = 'Notifications are blocked. Tap “Add to calendar” for a guaranteed alert.';
  else el.textContent = 'You’ll get a pop-up while Task Board is open or in the background. For an alert even when it’s fully closed, also tap “Add to calendar”.';
}

function formTask() {
  return {
    ...ed.task,
    title: F('title').value.trim(),
    notes: F('notes').value.trim(),
    priority: F('priority').value || 'medium',
    due: F('due').value,
    doneDate: F('doneDate').value,
    remindAt: F('remindAt').value,
    photos: [...ed.photos],
  };
}

function cleanupUnsaved() {
  for (const id of ed.added) dropPhoto(id);
  ed.added = [];
}

function tryClose() {
  if (ed.dirty && !confirm('Discard your changes?')) return;
  editor.close();
}

form.addEventListener('input', () => { ed.dirty = true; });
F('remindAt').addEventListener('input', updateHint);

form.addEventListener('submit', async e => {
  e.preventDefault();
  const next = formTask();
  if (!next.title) {
    F('title').focus();
    toast('Write down what needs to be done');
    return;
  }
  const remindChanged = next.remindAt !== ed.task.remindAt;
  // Ask for notification permission right away, while we still have the tap.
  if (next.remindAt && remindChanged && canNotify() && Notification.permission === 'default') requestNotify();
  if (remindChanged || (ed.task.doneDate && !next.doneDate)) next.reminded = !!next.remindAt && new Date(next.remindAt) <= Date.now();
  for (const id of ed.removed) dropPhoto(id);
  ed.added = []; ed.dirty = false;
  const isNew = ed.isNew;
  Object.assign(ed.task, next);
  editor.close();
  await save(ed.task);
  toast(isNew ? 'Task added' : 'Saved');
  persist();
});

editor.addEventListener('cancel', e => { if (ed.dirty && !confirm('Discard your changes?')) e.preventDefault(); });
editor.addEventListener('close', () => {
  cleanupUnsaved();
  document.body.append($('#toast'));
});
$('[data-close]', editor).addEventListener('click', tryClose);

$('#photos').addEventListener('click', e => {
  const rm = e.target.closest('[data-rm]')?.dataset.rm;
  if (rm) {
    ed.photos = ed.photos.filter(p => p !== rm);
    if (ed.added.includes(rm)) { ed.added = ed.added.filter(p => p !== rm); dropPhoto(rm); }
    else ed.removed.push(rm);
    ed.dirty = true;
    renderPhotos();
    return;
  }
  const v = e.target.closest('[data-view]')?.dataset.view;
  if (v) viewPhoto(v);
});
for (const id of ['camInput', 'libInput']) {
  const inp = $('#' + id);
  inp.addEventListener('change', () => { addFiles(inp.files); inp.value = ''; });
}

$('#remindChips').addEventListener('click', e => {
  const r = e.target.closest('[data-r]')?.dataset.r;
  if (!r) return;
  let d = new Date();
  if (r === '1h') d = new Date(Date.now() + 36e5);
  else if (r === 'tom') { d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); }
  else if (r === 'due') {
    if (!F('due').value) { toast('Pick a “fixed by” date first'); F('due').focus(); return; }
    d = new Date(F('due').value + 'T08:00');
  }
  F('remindAt').value = r === 'clear' ? '' : localDT(d);
  ed.dirty = true;
  updateHint();
});

$('#doneTodayBtn').addEventListener('click', () => {
  F('doneDate').value = today();
  form.requestSubmit ? form.requestSubmit() : $('#saveBtn').click();
});
$('#icsBtn').addEventListener('click', () => {
  const t = formTask();
  downloadICS([t], `task-${(t.title || 'reminder').replace(/[^\w-]+/g, '-').slice(0, 40)}.ics`);
});
$('#delBtn').addEventListener('click', async () => {
  if (!confirm('Delete this task? This can’t be undone.')) return;
  const t = ed.task;
  ed.dirty = false;
  editor.close();
  tasks.delete(t.id);
  for (const id of t.photos) dropPhoto(id);
  queueRender(); schedule();
  await DB.del(t.id).catch(() => {});
  toast('Task deleted');
});

async function viewPhoto(id) {
  const img = $('img', viewer);
  img.removeAttribute('src');
  viewer.showModal();
  await setImg(img, id, 'full');
}
viewer.addEventListener('click', () => viewer.close());

/* ---------------- board interactions ---------------- */
async function toggleDone(t) {
  const prev = t.doneDate;
  t.doneDate = prev ? '' : today();
  await save(t);
  toast(prev ? 'Moved back to open' : 'Marked done ✓', 'Undo', () => { t.doneDate = prev; save(t); });
}

board.addEventListener('click', e => {
  const el = e.target.closest('.card');
  if (!el) return;
  const t = tasks.get(el.dataset.id);
  if (!t) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'toggle') return toggleDone(t);
  if (act === 'photo') return viewPhoto(t.photos[0]);
  openEditor(t);
});
board.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) {
    e.preventDefault();
    openEditor(tasks.get(e.target.dataset.id));
  }
});

// Drag cards between columns to change priority (desktop).
board.addEventListener('dragstart', e => {
  const el = e.target.closest?.('.card');
  if (!el) return;
  e.dataTransfer.setData('text/plain', el.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
  el.classList.add('dragging');
});
const clearDrop = except => $$('.col.drop').forEach(c => c !== except && c.classList.remove('drop'));
board.addEventListener('dragend', e => { e.target.closest?.('.card')?.classList.remove('dragging'); clearDrop(); });
board.addEventListener('dragover', e => {
  const col = e.target.closest('.col');
  if (!col) return;
  e.preventDefault();
  clearDrop(col);
  col.classList.add('drop');
});
board.addEventListener('drop', e => {
  const col = e.target.closest('.col');
  if (!col) return;
  e.preventDefault();
  clearDrop();
  const t = tasks.get(e.dataTransfer.getData('text/plain'));
  if (!t || t.priority === col.dataset.p) return;
  const prev = t.priority;
  t.priority = col.dataset.p;
  save(t);
  toast(`Moved to ${PRI[t.priority]} priority`, 'Undo', () => { t.priority = prev; save(t); });
});

/* ---------------- header / toolbar ---------------- */
$('#newBtn').addEventListener('click', () => openEditor());
const quickCam = $('#quickCam');
$('#fab').addEventListener('click', () => quickCam.click());
quickCam.addEventListener('change', () => {
  const files = [...quickCam.files];
  quickCam.value = '';
  if (!files.length) return;
  openEditor();
  addFiles(files);
});

$('#q').addEventListener('input', e => { ui.q = e.target.value; queueRender(); });
$('#sort').addEventListener('change', e => { ui.sort = e.target.value; pref.set('sort', ui.sort); render(); });
$('.seg').addEventListener('click', e => {
  const v = e.target.closest('[data-view]')?.dataset.view;
  if (!v) return;
  ui.view = v; ui.quick = null; pref.set('view', v); render();
});
$('#stats').addEventListener('click', e => {
  const k = e.target.closest('[data-stat]')?.dataset.stat;
  if (!k) return;
  if (k === 'overdue' || k === 'today') { ui.quick = ui.quick === k ? null : k; ui.view = 'open'; }
  else { ui.quick = null; ui.view = k; }
  pref.set('view', ui.view);
  render();
});

const menu = $('#menu');
document.addEventListener('click', e => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
menu.addEventListener('click', e => {
  const a = e.target.closest('[data-menu]')?.dataset.menu;
  if (!a) return;
  menu.open = false;
  if (a === 'notify') requestNotify().then(ok => ok && toast('Notifications are on'));
  else if (a === 'ics') downloadICS([...tasks.values()].filter(t => !t.doneDate), `task-reminders-${today()}.ics`);
  else if (a === 'csv') exportCSV();
  else if (a === 'backup') exportJSON();
  else if (a === 'restore') $('#importFile').click();
});

/* ---------------- export / import ---------------- */
function exportCSV() {
  const cell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const label = { done: 'Done', overdue: 'Overdue', today: 'Due today', upcoming: 'Open', none: 'Open' };
  const rows = [['Task', 'Notes', 'Priority', 'Fix by', 'Completed on', 'Reminder', 'Status', 'Photos', 'Created']];
  const all = [...tasks.values()].sort((a, b) => PRI_KEYS.indexOf(a.priority) - PRI_KEYS.indexOf(b.priority) || sorter(a, b));
  for (const t of all) rows.push([t.title, t.notes, PRI[t.priority], t.due, t.doneDate, t.remindAt.replace('T', ' '), label[status(t)], t.photos.length, localDate(new Date(t.created))]);
  download(new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `tasks-${today()}.csv`);
}

const toDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

async function exportJSON() {
  toast('Preparing backup…');
  const photos = {};
  for (const t of tasks.values()) for (const id of t.photos) {
    const p = await DB.photo(id).catch(() => null);
    if (p) photos[id] = { full: await toDataURL(p.full), thumb: await toDataURL(p.thumb) };
  }
  const data = { app: 'taskboard', version: 1, exported: new Date().toISOString(), tasks: [...tasks.values()], photos };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `taskboard-backup-${today()}.json`);
  toast('Backup downloaded');
}

const importInput = $('#importFile');
importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  importInput.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.tasks)) throw new Error('not a backup');
    const photos = data.photos && typeof data.photos === 'object' ? data.photos : {};
    for (const [id, p] of Object.entries(photos)) {
      if (typeof p?.full !== 'string' || !p.full.startsWith('data:image/')) continue;
      const full = await (await fetch(p.full)).blob();
      const thumb = typeof p.thumb === 'string' && p.thumb.startsWith('data:image/') ? await (await fetch(p.thumb)).blob() : full;
      await DB.putPhoto({ id, full, thumb });
      for (const k of ['thumb', 'full']) urlCache.delete(id + ':' + k);
    }
    let n = 0;
    for (const raw of data.tasks) {
      const t = normalize(raw);
      if (!t) continue;
      tasks.set(t.id, t);
      await DB.put(t);
      n++;
    }
    render(); schedule();
    toast(`Restored ${n} task${n === 1 ? '' : 's'}`);
  } catch (e) {
    console.error(e);
    toast('That file isn’t a Task Board backup');
  }
});

/* ---------------- boot ---------------- */
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
addEventListener('focus', schedule);

function openFromURL() {
  const p = new URLSearchParams(location.search);
  const id = p.get('task');
  if (id && tasks.has(id)) openEditor(tasks.get(id));
  else if (p.has('new')) openEditor();
  if (id || p.has('new')) history.replaceState(null, '', location.pathname);
}

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', e => {
    const id = e.data && e.data.open;
    if (id && tasks.has(id)) { if (editor.open) editor.close(); openEditor(tasks.get(id)); }
  });
}

(async () => {
  try {
    for (const raw of await DB.tasks()) { const t = normalize(raw); if (t) tasks.set(t.id, t); }
  } catch (e) {
    console.error(e);
    toast('Storage is unavailable (private browsing?) — tasks won’t be saved', null, null, 8000);
  }
  render();
  schedule();
  openFromURL();
})();
})();
