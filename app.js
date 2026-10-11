/* Planificador del viaje a Sevilla. Sin dependencias: todo se guarda en el propio móvil. */
(() => {
  'use strict';

  const KEY = 'sevilla-2026';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------- Estado ----------
  const blank = () => ({ done: {}, notes: {}, edits: {}, hidden: {}, days: {}, custom: [], resv: {}, bookings: [], journal: [], expenses: [] });
  let state = blank();
  try { state = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* estado vacío */ }
  // Versión anterior: las horas cambiadas se guardaban aparte.
  if (state.times) {
    for (const [id, t] of Object.entries(state.times)) state.edits[id] = { ...t, fixed: true, ...(state.edits[id] || {}) };
    delete state.times;
  }
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch (e) { return false; } };

  // ---------- Sincronización entre móviles ----------
  // Usa una Firebase Realtime Database por REST: cada registro se envía por separado,
  // así dos personas pueden tocar cosas distintas a la vez sin pisarse.
  const SYNC_KEY = 'sevilla-sync', SHADOW_KEY = 'sevilla-shadow', PHOTOQ_KEY = 'sevilla-fotos-pendientes';
  const MAPS = ['done', 'notes', 'edits', 'hidden', 'days', 'resv'];
  const LISTS = ['custom', 'bookings', 'journal', 'expenses'];
  const storedSync = lsGet(SYNC_KEY);
  let syncUrl = storedSync === 'off' ? '' : storedSync || SYNC_DEFAULT;
  let shadow = {};   // último estado que sabemos que está en la nube
  try { shadow = JSON.parse(lsGet(SHADOW_KEY) || '{}'); } catch (e) { /* vacío */ }
  let es = null, online = false, pushing = false, retryT, dirty = false;

  const canon = (v) => {
    if (v === null || v === undefined) return undefined;
    if (typeof v !== 'object') return v;
    const o = {};
    for (const k of Object.keys(v).sort()) { const c = canon(v[k]); if (c !== undefined) o[k] = c; }
    return Object.keys(o).length ? o : undefined;
  };
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const toTree = (st) => {
    const t = {};
    for (const k of MAPS) t[k] = st[k] || {};
    for (const k of LISTS) t[k] = Object.fromEntries((st[k] || []).map((r) => [r.id, r]));
    return t;
  };
  const fromTree = (t) => {
    const st = blank();
    for (const k of MAPS) st[k] = { ...(t[k] || {}) };
    for (const k of LISTS) st[k] = Object.entries(t[k] || {}).filter(([, r]) => r && typeof r === 'object').map(([id, r]) => ({ ...r, id }));
    return st;
  };
  function diff(tree, base) {
    const up = {};
    for (const sec of [...MAPS, ...LISTS]) {
      const a = tree[sec] || {}, b = base[sec] || {};
      for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!same(a[id], b[id])) up[`${sec}/${id}`] = canon(a[id]) ?? null;
      }
    }
    return up;
  }
  function setPath(tree, segs, val) {
    if (!segs.length) return val && typeof val === 'object' ? val : {};
    let o = tree;
    for (const k of segs.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    const last = segs[segs.length - 1];
    if (val === null || val === undefined) delete o[last]; else o[last] = val;
    return tree;
  }
  const persist = () => {
    const ok = lsSet(KEY, JSON.stringify(state));
    if (syncUrl) lsSet(SHADOW_KEY, JSON.stringify(shadow));
    if (!ok) toast('No se pudo guardar en este móvil');
  };
  const save = () => { persist(); flush(); };

  function onRemote(path, data, isPatch) {
    const pending = diff(toTree(state), shadow);   // cambios locales aún sin subir
    const segs = path.split('/').filter(Boolean);
    if (isPatch) for (const [k, v] of Object.entries(data || {})) shadow = setPath(shadow, [...segs, ...k.split('/').filter(Boolean)], v);
    else shadow = setPath(shadow, segs, data);
    const merged = JSON.parse(JSON.stringify(shadow));
    for (const [p, v] of Object.entries(pending)) setPath(merged, p.split('/'), v);
    state = fromTree(merged);
    persist();
    if (sheet.open) dirty = true; else render();
    flush();
  }

  async function flush() {
    syncDot();
    if (!syncUrl || pushing || !online) return;
    const up = diff(toTree(state), shadow);
    if (!Object.keys(up).length) { flushPhotos(); return; }
    pushing = true;
    try {
      const r = await fetch(syncUrl + '.json', { method: 'PATCH', body: JSON.stringify(up) });
      if (!r.ok) throw new Error(r.status);
      for (const [p, v] of Object.entries(up)) setPath(shadow, p.split('/'), v);
      lsSet(SHADOW_KEY, JSON.stringify(shadow));
      pushing = false;
      flush();
    } catch (e) {
      pushing = false;
      clearTimeout(retryT); retryT = setTimeout(flush, 5000);
      syncDot();
    }
  }

  function connect() {
    if (es) es.close();
    es = null; online = false;
    syncDot();
    if (!syncUrl) return;
    es = new EventSource(syncUrl + '.json');
    es.addEventListener('put', (e) => { const d = JSON.parse(e.data); online = true; onRemote(d.path, d.data, false); });
    es.addEventListener('patch', (e) => { const d = JSON.parse(e.data); onRemote(d.path, d.data, true); });
    es.onerror = () => {
      online = false; syncDot();
      if (es && es.readyState === 2) { clearTimeout(retryT); retryT = setTimeout(connect, 15000); }
    };
  }

  const pendingCount = () => (syncUrl ? Object.keys(diff(toTree(state), shadow)).length : 0);
  function syncDot() {
    const el = document.getElementById('syncDot');
    if (!el) return;
    el.className = 'sync-dot ' + (!syncUrl ? 'off' : online && !pendingCount() ? 'ok' : 'wait');
    el.title = !syncUrl ? '' : online ? 'Sincronizado' : 'Sin conexión';
  }

  // Acepta la URL de la base de datos (crea una sala nueva) o el enlace compartido desde el otro móvil.
  function parseSync(text) {
    let t = String(text || '').trim();
    const i = t.indexOf('#sync=');
    if (i >= 0) t = decodeURIComponent(t.slice(i + 6));
    let u;
    try { u = new URL(t); } catch (e) { return null; }
    const local = ['localhost', '127.0.0.1'].includes(u.hostname);
    if (u.protocol !== 'https:' && !local) return null;
    let path = u.pathname.replace(/\.json$/, '').replace(/\/+$/, '');
    if (!path || (local && path === '/db')) path += '/sevilla-' + uid() + uid();
    return u.origin + path;
  }
  function setSync(url) {
    syncUrl = url || '';
    lsSet(SYNC_KEY, syncUrl || 'off');
    shadow = {};
    lsSet(SHADOW_KEY, null);
    connect();
  }
  const shareLink = () => `${location.origin}${location.pathname}#sync=${encodeURIComponent(syncUrl)}`;

  // Las fotos van aparte (son grandes): se suben una vez y el otro móvil las baja cuando las necesita.
  const photoRemote = (id) => `${syncUrl}-fotos/${id}.json`;
  const photoQueue = () => { try { return JSON.parse(lsGet(PHOTOQ_KEY) || '[]'); } catch (e) { return []; } };
  function queuePhoto(id) { if (syncUrl) { lsSet(PHOTOQ_KEY, JSON.stringify([...photoQueue(), id])); flushPhotos(); } }
  let photoBusy = false;
  async function flushPhotos() {
    if (!syncUrl || !online || photoBusy) return;
    const q = photoQueue();
    if (!q.length) return;
    photoBusy = true;
    try {
      const blob = await idb('readonly', (s) => s.get(q[0]));
      if (blob) {
        const r = await fetch(photoRemote(q[0]), { method: 'PUT', body: JSON.stringify(await blobToData(blob)) });
        if (!r.ok) throw new Error(r.status);
      }
      lsSet(PHOTOQ_KEY, JSON.stringify(photoQueue().filter((x) => x !== q[0])));
      photoBusy = false;
      flushPhotos();
    } catch (e) { photoBusy = false; }
  }

  // ?now=2026-11-08T16:00 permite simular una fecha para probar.
  const fakeNow = new URLSearchParams(location.search).get('now');
  const now = () => (fakeNow ? new Date(fakeNow) : new Date());
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const mins = (t) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
  const fmtDur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) : ''}` : `${m} min`);
  const euro = (n) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const dayOf = (date) => DAYS.find((d) => d.date === date);
  const dayInfo = (d) => ({ ...d, ...(state.days[d.date] || {}) });
  // Hora fija = venía cerrada en el Excel (billete o entrada); el resto son horquillas orientativas.
  const ALL = DAYS.flatMap((d) => d.items.map((it) => ({ ...it, date: d.date, fixed: !!it.start && !it.approx })));
  const KINDS = { visit: 'Visita', walk: 'Paseo', food: 'Comida', train: 'Transporte', show: 'Espectáculo', stay: 'Alojamiento / traslado', custom: 'Otro' };

  const today = ymd(now());
  let tab = 'plan';
  let selDay = dayOf(today) ? today : DAYS[0].date;
  const open = new Set();

  // ---------- Fotos (IndexedDB) ----------
  let dbp;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('sevilla-fotos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('p');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const idb = (mode, fn) => db().then((d) => new Promise((res, rej) => {
    const rq = fn(d.transaction('p', mode).objectStore('p'));
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }));
  const urls = new Map();
  async function photoUrl(id) {
    if (!urls.has(id)) {
      let blob = await idb('readonly', (s) => s.get(id));
      if (!blob && syncUrl) {
        const data = await fetch(photoRemote(id)).then((r) => r.json()).catch(() => null);
        if (typeof data === 'string' && data.startsWith('data:image/')) {
          blob = await (await fetch(data)).blob();
          await idb('readwrite', (s) => s.put(blob, id));
        }
      }
      if (!blob) return null;
      urls.set(id, URL.createObjectURL(blob));
    }
    return urls.get(id);
  }
  function shrink(file, max = 1280) {
    return new Promise((res, rej) => {
      const img = new Image();
      const src = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(src);
        c.toBlob((b) => (b ? res(b) : rej(new Error('foto'))), 'image/jpeg', 0.72);
      };
      img.onerror = rej;
      img.src = src;
    });
  }
  const blobToData = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });

  // ---------- Plan ----------
  function itemsFor(day) {
    let prev = 0;
    const base = ALL.filter((it) => !state.hidden[it.id])
      .map((it) => ({ ...it, ...(state.edits[it.id] || {}) }))
      .filter((it) => it.date === day.date)
      .map((it) => { const key = mins(it.start) ?? prev + 0.1; prev = key; return { ...it, key }; });
    const custom = state.custom.filter((c) => c.date === day.date).map((c) => ({ kind: 'custom', ...c, custom: true, key: mins(c.start) ?? 9999 }));
    return [...base, ...custom].sort((a, b) => a.key - b.key);
  }
  const findItem = (id) => {
    const c = state.custom.find((x) => x.id === id);
    if (c) return { kind: 'custom', ...c, custom: true };
    const b = ALL.find((x) => x.id === id);
    return b && { ...b, ...(state.edits[id] || {}) };
  };

  function nowNext(day, items) {
    if (day.date !== today) return {};
    const m = now().getHours() * 60 + now().getMinutes();
    let cur, next;
    for (const it of items) {
      const s = mins(it.start);
      if (s == null) continue;
      const e = mins(it.end) ?? s + (it.dur || 60);
      if (s <= m && m < e && !state.done[it.id]) cur = cur || it.id;
      else if (s > m && !next && !state.done[it.id]) next = it.id;
    }
    return { cur, next };
  }

  const dirUrl = (q) => `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${encodeURIComponent(q)}`;

  function resvBadge(r) {
    if (!r) return '';
    const cls = /confirm/i.test(r) ? 'ok' : /opcional/i.test(r) ? '' : 'warn';
    return `<span class="badge ${cls}">Reserva: ${esc(r.replace(/^Sí · /, ''))}</span>`;
  }

  function dayChips() {
    return `<div class="days">${DAYS.map((d) => `
      <button class="day-chip ${d.date === selDay ? 'on' : ''} ${d.date === today ? 'today' : ''}" data-act="day" data-id="${d.date}" aria-label="${d.name}">
        <small>${d.short}</small><b>${d.num}</b>
      </button>`).join('')}</div>`;
  }

  function timeCell(it) {
    if (!it.start && !it.end) return '<span class="tbd">sin hora</span>';
    if (it.fixed) return `<b>${esc(it.start || it.end)}</b>${it.start && it.end ? `<small>${esc(it.end)}</small>` : ''}`;
    return `<span class="range">${it.start ? esc(it.start) : '…'}<br>${it.end ? esc(it.end) : '…'}</span><small>aprox.</small>`;
  }

  function viewPlan() {
    const day = dayInfo(dayOf(selDay));
    const items = itemsFor(day);
    const { cur, next } = nowNext(day, items);
    const nDone = items.filter((i) => state.done[i.id]).length;
    const hidden = ALL.filter((it) => state.hidden[it.id] && it.date === day.date).length;

    const li = items.map((it) => {
      const isDone = !!state.done[it.id];
      const isOpen = open.has(it.id);
      const meta = [it.zone, it.move, it.dur && fmtDur(it.dur), it.food].filter(Boolean).map(esc);
      const badges = [
        it.id === cur && '<span class="badge now">Ahora</span>',
        it.id === next && !cur && '<span class="badge now">Siguiente</span>',
        it.fixed && '<span class="badge">Hora fija</span>',
        it.prio === 'A' && '<span class="badge a">Imprescindible</span>',
        it.prio === 'B' && '<span class="badge b">Recomendable</span>',
        it.prio === 'C' && '<span class="badge">Opcional</span>',
        resvBadge(it.resv),
      ].filter(Boolean);
      const my = state.notes[it.id];
      const map = it.map || (it.custom && it.zone);
      return `
      <li class="item k-${it.kind} ${isDone ? 'done' : ''} ${it.id === cur ? 'is-now' : ''}">
        <div class="item-time ${it.fixed ? 'fixed' : 'flex'}">${timeCell(it)}</div>
        <div class="card">
          <div class="card-main">
            <button class="card-tap" data-act="toggle" data-id="${it.id}" aria-expanded="${isOpen}">
              <div class="card-title">${esc(it.title)}</div>
              ${meta.length ? `<div class="meta">${meta.join(' · ')}</div>` : ''}
              ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
            </button>
            <button class="check" data-act="done" data-id="${it.id}" aria-label="${isDone ? 'Marcar como pendiente' : 'Marcar como hecho'}" aria-pressed="${isDone}"><i></i></button>
          </div>
          ${isOpen ? `
          <div class="detail">
            ${it.note ? `<p>${esc(it.note)}</p>` : ''}
            ${my ? `<div class="mynote"><b>Nuestra nota</b>${esc(my)}</div>` : ''}
            <div class="actions">
              ${map ? `<a class="btn primary" target="_blank" rel="noopener" href="${dirUrl(map)}">Cómo llegar</a>` : ''}
              ${it.web ? `<a class="btn" target="_blank" rel="noopener" href="${esc(it.web)}">Web oficial</a>` : ''}
              <button class="btn" data-act="edit" data-id="${it.id}">Editar</button>
            </div>
          </div>` : ''}
        </div>
      </li>`;
    }).join('');

    return `${dayChips()}
      <div class="day-head">
        <div class="row"><h2>${esc(day.name)} · ${esc(day.title)}</h2><button class="link" data-act="day-edit">Editar</button></div>
        <p>${esc(day.summary)}</p>
        <div class="progress"><i style="width:${items.length ? (nDone / items.length) * 100 : 0}%"></i></div>
        <div class="progress-label"><span>${nDone} de ${items.length} hechas</span><span>Gris = horquilla orientativa</span></div>
      </div>
      <ul class="timeline">${li}</ul>
      ${items.length ? '' : '<div class="empty">Día vacío. Añadid lo que queráis.</div>'}
      <div class="add-row">
        <button class="btn ghost block" data-act="add">+ Añadir a este día</button>
        ${hidden ? `<button class="btn ghost block" data-act="restore">Recuperar ${hidden} actividad${hidden > 1 ? 'es' : ''} quitada${hidden > 1 ? 's' : ''}</button>` : ''}
      </div>`;
  }

  // ---------- Reservas ----------
  const bookings = () => [...BOOKINGS, ...state.bookings]
    .map((b) => ({ ...b, ...(state.resv[b.id] || {}) }))
    .filter((b) => !b.deleted)
    .sort((a, b) => a.date.localeCompare(b.date));
  const resvState = (b) => b.status || (b.confirmed ? 'ok' : 'todo');
  const RESV_LABEL = { todo: 'Pendiente', ok: 'Hecha', skip: 'No vamos' };

  function viewResv() {
    const all = bookings();
    const need = all.filter((b) => resvState(b) !== 'skip');
    const ok = need.filter((b) => resvState(b) === 'ok').length;
    let last = '';
    const list = all.map((b) => {
      const st = resvState(b);
      const head = b.date !== last ? `<div class="section-title">${esc(dayOf(b.date).name)}</div>` : '';
      last = b.date;
      return `${head}
      <div class="panel">
        <div class="row">
          <div>
            <h3>${esc(b.title)}</h3>
            <div class="sub">${[b.time, b.prio].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
          <button class="state-btn ${st === 'todo' ? '' : st}" data-act="resv" data-id="${b.id}">${RESV_LABEL[st]}</button>
        </div>
        ${b.note ? `<p class="txt">${esc(b.note)}${b.when && st === 'todo' ? `\nCuándo reservar: ${esc(b.when.toLowerCase())}.` : ''}</p>` : ''}
        ${b.code ? `<div class="mynote"><b>Localizador / datos</b>${esc(b.code)}</div>` : ''}
        <div class="actions">
          ${b.web ? `<a class="btn" target="_blank" rel="noopener" href="${esc(b.web)}">Web oficial</a>` : ''}
          <button class="btn" data-act="resv-edit" data-id="${b.id}">Editar</button>
        </div>
      </div>`;
    }).join('');
    return `
      <div class="day-head">
        <h2>Reservas y billetes</h2>
        <p>Tocad el estado para cambiarlo. Todo se puede editar, quitar o añadir.</p>
        <div class="progress"><i style="width:${need.length ? (ok / need.length) * 100 : 0}%"></i></div>
        <div class="progress-label"><span>${ok} de ${need.length} listas</span><span>${need.length - ok} pendiente${need.length - ok === 1 ? '' : 's'}</span></div>
      </div>${list}
      <button class="btn primary block" data-act="resv-add" style="margin-top:16px">Añadir reserva</button>`;
  }

  // ---------- Diario ----------
  function viewDiary() {
    const day = dayInfo(dayOf(selDay));
    const auto = itemsFor(day).filter((i) => state.done[i.id]).map((i) => ({ auto: true, ts: state.done[i.id], text: i.title, note: state.notes[i.id] }));
    const mine = state.journal.filter((j) => j.date === selDay);
    const all = [...auto, ...mine].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    const list = all.map((e) => {
      const t = typeof e.ts === 'string' && e.ts.length > 10 ? hm(new Date(e.ts)) : '';
      if (e.auto) return `<div class="entry auto"><time>${t}</time><div class="panel"><b>${esc(e.text)}</b> · hecho${e.note ? `<p class="txt">${esc(e.note)}</p>` : ''}</div></div>`;
      return `<div class="entry"><time>${t}</time><div class="panel">
        <div class="row"><div>
          ${e.place ? `<h3>${esc(e.place)}</h3>` : ''}
          ${e.stars ? `<div class="stars">${'★'.repeat(e.stars)}${'☆'.repeat(5 - e.stars)}</div>` : ''}
        </div><button class="x" data-act="j-edit" data-id="${e.id}" aria-label="Editar" style="width:auto;font-size:15px">Editar</button></div>
        ${e.text ? `<p class="txt" style="margin-top:2px">${esc(e.text)}</p>` : ''}
        ${e.photo ? `<img data-photo="${esc(e.photo)}" alt="Foto del momento">` : ''}
      </div></div>`;
    }).join('');
    return `${dayChips()}
      <div class="day-head">
        <h2>Diario · ${esc(day.name)}</h2>
        <p>Lo que marcáis como hecho en el plan aparece aquí solo. Añadid momentos, notas y fotos.</p>
      </div>
      <button class="btn primary block" data-act="j-add" style="margin:10px 0 16px">Añadir momento</button>
      ${list || '<div class="empty">Todavía no hay nada apuntado este día.</div>'}`;
  }

  // ---------- Gastos ----------
  function viewMoney() {
    const total = state.expenses.reduce((s, e) => s + e.amount, 0);
    const byDay = DAYS.map((d) => ({ d, list: state.expenses.filter((e) => e.date === d.date) })).filter((g) => g.list.length);
    const other = state.expenses.filter((e) => !dayOf(e.date));
    const group = (title, list) => `
      <div class="section-title">${esc(title)} · ${euro(list.reduce((s, e) => s + e.amount, 0))}</div>
      <div class="panel" style="padding:4px 14px">${list.map((e) => `
        <div class="exp"><div>${esc(e.what)}${e.who ? `<small>Pagó ${esc(e.who)}</small>` : ''}</div><b>${euro(e.amount)}</b>
        <button class="x" data-act="e-del" data-id="${e.id}" aria-label="Borrar gasto">×</button></div>`).join('')}</div>`;
    return `
      <div class="stats">
        <div class="panel"><div class="sub">Total</div><div class="big-num">${euro(total)}</div></div>
        <div class="panel"><div class="sub">Por persona</div><div class="big-num">${euro(total / 2)}</div></div>
      </div>
      <button class="btn primary block" data-act="e-add" style="margin:14px 0 4px">Añadir gasto</button>
      ${other.length ? group('Antes del viaje', other) : ''}
      ${byDay.map((g) => group(g.d.name, g.list)).join('')}
      ${state.expenses.length ? '' : '<div class="empty">Sin gastos apuntados. Los AVE ya pagados (67,50 € ida, 33,80 € vuelta aprox.) podéis añadirlos como «antes del viaje».</div>'}`;
  }

  // ---------- Info ----------
  function viewInfo() {
    const trains = BOOKINGS.filter((b) => b.confirmed);
    return `
      <div class="section-title">Alojamiento</div>
      <div class="panel">
        <h3>${esc(TRIP.stay.address)}</h3>
        <div class="sub">${esc(TRIP.tagline)}</div>
        <div class="actions"><a class="btn primary" target="_blank" rel="noopener" href="${dirUrl(TRIP.stay.address)}">Volver al alojamiento</a></div>
      </div>
      <div class="section-title">Trenes confirmados</div>
      ${trains.map((b) => `<div class="panel"><h3>${esc(b.title)}</h3><div class="sub">${esc(dayOf(b.date).name)} · ${esc(b.time)}</div><p class="txt">${esc(b.note)}</p></div>`).join('')}
      <div class="section-title">Horarios de monumentos</div>
      ${PLACES.map((p) => `<div class="panel">
        <h3>${esc(p.name)}</h3><div class="sub">${esc(p.day)}</div>
        <dl class="kv"><dt>Horario</dt><dd>${esc(p.hours)}</dd><dt>Tiempo</dt><dd>${esc(p.rec)}</dd><dt>Consejo</dt><dd>${esc(p.tip)}</dd></dl>
        <div class="actions"><a class="btn" target="_blank" rel="noopener" href="${esc(p.web)}">Comprobar en la web oficial</a></div>
      </div>`).join('')}
      <div class="section-title">Consejos</div>
      <div class="panel"><ul class="tips">${TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <div class="section-title">Apariencia</div>
      <div class="seg">${[['light', 'Claro'], ['dark', 'Oscuro'], ['auto', 'Automático']].map(([k, n]) => `<button class="${theme === k ? 'on' : ''}" data-act="theme" data-id="${k}">${n}</button>`).join('')}</div>
      <div class="section-title">Sincronización entre los dos móviles</div>
      <div class="panel">${syncUrl ? `
        <h3>${online ? (pendingCount() ? 'Enviando cambios…' : 'Sincronizado') : 'Sin conexión'}</h3>
        <p class="txt">Lo que marca o apunta uno le aparece al otro al momento, sin hacer nada. Sin cobertura se guarda en el móvil y se envía al recuperarla.</p>
        <div class="actions">
          <button class="btn danger" data-act="sync-off">Desactivar aquí</button>
        </div>` : `
        <h3>Desactivada</h3>
        <p class="txt">Este móvil no está compartiendo los cambios. Pulsad «Activar» para volver a la sala del viaje (o pegad antes otro enlace).</p>
        <label class="f" style="margin-top:10px"><input id="syncInput" placeholder="https://…" autocapitalize="off" autocorrect="off" spellcheck="false" style="background:var(--fill)"></label>
        <div class="actions"><button class="btn primary" data-act="sync-on">Activar</button></div>`}
      </div>
      <div class="section-title">Vuestros datos</div>
      <div class="panel">
        <p class="txt" style="margin-top:0">Todo lo que apuntáis se guarda en el móvil${syncUrl ? ' y se comparte con el otro' : ''}. Con «Exportar copia» os lleváis un archivo con todo, fotos incluidas.</p>
        <div class="actions">
          <button class="btn" data-act="export">Exportar copia</button>
          <button class="btn" data-act="import">Importar copia</button>
          <button class="btn" data-act="reset-plan">Restaurar plan original</button>
          <button class="btn danger" data-act="wipe">Borrar todo</button>
        </div>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
      </div>
      <div class="panel">
        <h3>Tenerla como app</h3>
        <p class="txt">iPhone: Safari → Compartir → «Añadir a pantalla de inicio». Android: Chrome → menú ⋮ → «Instalar aplicación». Una vez abierta, funciona también sin cobertura.</p>
      </div>`;
  }

  // ---------- Render ----------
  const VIEWS = { plan: viewPlan, resv: viewResv, diary: viewDiary, money: viewMoney, info: viewInfo };
  function render() {
    $('#view').innerHTML = VIEWS[tab]();
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('img[data-photo]').forEach(async (img) => {
      const u = await photoUrl(img.dataset.photo).catch(() => null);
      if (u) img.src = u; else img.remove();
    });
  }

  const THEME_KEY = 'sevilla-theme';
  function applyTheme(t) {
    if (t) lsSet(THEME_KEY, t);
    t = t || lsGet(THEME_KEY) || 'light';
    document.documentElement.dataset.theme = t;
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    $('#themeColor').content = dark ? '#000000' : '#f2f2f7';
    return t;
  }
  let theme = applyTheme();

  function header() {
    $('#tripTitle').textContent = TRIP.title;
    $('#tripSub').textContent = TRIP.subtitle;
    const d0 = new Date(TRIP.start + 'T00:00'), t0 = new Date(today + 'T00:00');
    const diff = Math.round((d0 - t0) / 864e5);
    const idx = DAYS.findIndex((d) => d.date === today);
    $('#tripStatus').textContent = idx >= 0 ? `Día ${idx + 1} de ${DAYS.length}` : diff > 1 ? `Faltan ${diff} días` : diff === 1 ? '¡Mañana!' : 'Viaje hecho';
  }

  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- Hoja inferior ----------
  const sheet = $('#sheet');
  let onSheet = null;
  function openSheet(html, handler) {
    $('#sheetBody').innerHTML = html;
    onSheet = handler;
    sheet.returnValue = '';
    sheet.showModal();
  }
  sheet.addEventListener('close', async () => {
    const v = sheet.returnValue, h = onSheet;
    onSheet = null;
    if (h && v && v !== 'cancel') {
      const form = $('#sheetBody');
      await h(Object.fromEntries(new FormData(form)), v, form);
      save(); render();
    } else if (dirty) render();
    dirty = false;
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close('cancel'); });
  const sheetButtons = (del) => `<div class="sheet-actions">
    ${del ? `<button class="btn danger" value="delete" formnovalidate>${del}</button>` : ''}
    <button class="btn" value="cancel" formnovalidate>Cancelar</button>
    <button class="btn primary" value="ok">Guardar</button></div>`;
  const dayOptions = (sel, withPre) => (withPre ? `<option value="pre" ${sel === 'pre' ? 'selected' : ''}>Antes del viaje</option>` : '')
    + DAYS.map((d) => `<option value="${d.date}" ${d.date === sel ? 'selected' : ''}>${d.name}</option>`).join('');

  // Formulario único para crear o editar cualquier actividad del plan.
  function itemSheet(id) {
    const it = id ? findItem(id) : { date: selDay, kind: 'custom', custom: true };
    if (!it) return;
    const v = (k) => esc(it[k] || '');
    openSheet(`
      <h3>${id ? 'Editar actividad' : 'Añadir al plan'}</h3>
      <label class="f">Qué<input name="title" required value="${v('title')}" placeholder="Tapas en…, compras, descanso…"></label>
      <div class="two">
        <label class="f">Día<select name="date">${dayOptions(it.date)}</select></label>
        <label class="f">Tipo<select name="kind">${Object.entries(KINDS).map(([k, n]) => `<option value="${k}" ${k === it.kind ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="two">
        <label class="f">Desde<input type="time" name="start" value="${v('start')}"></label>
        <label class="f">Hasta<input type="time" name="end" value="${v('end')}"></label>
      </div>
      <label class="switch"><span>Hora fija<small>Apagado = horquilla orientativa</small></span><input type="checkbox" name="fixed" ${it.fixed ? 'checked' : ''}></label>
      <div class="two">
        <label class="f">Zona<input name="zone" value="${v('zone')}" placeholder="Triana…"></label>
        <label class="f">Lugar en el mapa<input name="map" value="${v('map')}" placeholder="Nombre o dirección"></label>
      </div>
      <label class="f">Detalles del plan<textarea name="note" placeholder="Consejos, qué reservar…">${v('note')}</textarea></label>
      <label class="f">Nuestra nota<textarea name="my" placeholder="Qué tal fue, dónde comimos…">${esc(id ? state.notes[id] || '' : '')}</textarea></label>
      ${sheetButtons(id ? (it.custom ? 'Borrar' : 'Quitar') : '')}`, (f, btn) => {
      if (btn === 'delete') {
        if (it.custom) state.custom = state.custom.filter((c) => c.id !== id); else state.hidden[id] = true;
        delete state.done[id];
        toast(it.custom ? 'Borrado' : 'Quitado del plan (se puede recuperar abajo)');
        return;
      }
      const data = { title: f.title.trim(), date: f.date, kind: f.kind, start: f.start, end: f.end, fixed: !!f.fixed, zone: f.zone.trim(), map: f.map.trim(), note: f.note.trim() };
      const key = id || 'c' + uid();
      if (!id) state.custom.push({ id: key, ...data });
      else if (it.custom) Object.assign(state.custom.find((x) => x.id === id) || {}, data);
      else state.edits[id] = data;
      if (f.my.trim()) state.notes[key] = f.my.trim(); else delete state.notes[key];
      selDay = f.date;
    });
  }

  function editDay() {
    const d = dayInfo(dayOf(selDay));
    openSheet(`
      <h3>${esc(d.name)}</h3>
      <label class="f">Título del día<input name="title" required value="${esc(d.title)}"></label>
      <label class="f">Resumen<textarea name="summary">${esc(d.summary)}</textarea></label>
      ${sheetButtons()}`, (f) => { state.days[selDay] = { title: f.title.trim(), summary: f.summary.trim() }; });
  }

  function editResv(id) {
    const b = id ? bookings().find((x) => x.id === id) : { date: selDay, status: 'todo' };
    if (!b) return;
    const v = (k) => esc(b[k] || '');
    openSheet(`
      <h3>${id ? 'Editar reserva' : 'Nueva reserva'}</h3>
      <label class="f">Qué<input name="title" required value="${v('title')}" placeholder="Restaurante, entrada, tren…"></label>
      <div class="two">
        <label class="f">Día<select name="date">${dayOptions(b.date)}</select></label>
        <label class="f">Hora o franja<input name="time" value="${v('time')}" placeholder="14:00 · 10–11 h"></label>
      </div>
      <label class="f">Estado<select name="status">
        ${['todo', 'ok', 'skip'].map((s) => `<option value="${s}" ${resvState(b) === s ? 'selected' : ''}>${RESV_LABEL[s]}</option>`).join('')}
      </select></label>
      <label class="f">Localizador, sitio, datos<textarea name="code" placeholder="Ej.: entrada 15:00 · localizador ABC123">${v('code')}</textarea></label>
      <label class="f">Notas<textarea name="note">${v('note')}</textarea></label>
      ${sheetButtons(id ? 'Quitar' : '')}`, (f, btn) => {
      if (btn === 'delete') {
        if (BOOKINGS.some((x) => x.id === id)) state.resv[id] = { deleted: true };
        else { state.bookings = state.bookings.filter((x) => x.id !== id); delete state.resv[id]; }
        return;
      }
      const data = { title: f.title.trim(), date: f.date, time: f.time.trim(), status: f.status, code: f.code.trim(), note: f.note.trim() };
      if (id) state.resv[id] = data;
      else state.bookings.push({ id: 'r' + uid(), prio: 'Añadida', optional: true, ...data });
    });
  }

  function editJournal(id) {
    const e = id ? state.journal.find((j) => j.id === id) : null;
    const n = now();
    openSheet(`
      <h3>${e ? 'Editar momento' : 'Nuevo momento'}</h3>
      <label class="f">Dónde / qué (opcional)<input name="place" value="${esc(e ? e.place : '')}" placeholder="Bar, plaza, mirador…"></label>
      <label class="f">Cómo fue<textarea name="text" placeholder="Lo que queráis recordar">${esc(e ? e.text : '')}</textarea></label>
      <div class="two">
        <label class="f">Hora<input type="time" name="time" value="${e ? hm(new Date(e.ts)) : hm(n)}" required></label>
        <label class="f">Valoración<select name="stars">
          <option value="0">—</option>${[5, 4, 3, 2, 1].map((s) => `<option value="${s}" ${e && e.stars === s ? 'selected' : ''}>${'★'.repeat(s)}</option>`).join('')}
        </select></label>
      </div>
      <label class="f">Foto (opcional)<input type="file" name="file" accept="image/*"></label>
      ${e && e.photo ? `<img class="preview" data-photo="${esc(e.photo)}" alt="">` : ''}
      ${sheetButtons(e ? 'Borrar' : '')}`, async (f, v, form) => {
      if (v === 'delete') {
        if (e.photo) await idb('readwrite', (s) => s.delete(e.photo)).catch(() => {});
        state.journal = state.journal.filter((j) => j.id !== id);
        return;
      }
      const file = form.querySelector('[name=file]').files[0];
      let photo = e ? e.photo : null;
      if (file) {
        try {
          const blob = await shrink(file);
          photo = 'f' + uid();
          await idb('readwrite', (s) => s.put(blob, photo));
          queuePhoto(photo);
        } catch (err) { toast('No se pudo guardar la foto'); }
      }
      if (!f.place.trim() && !f.text.trim() && !photo) return;
      const entry = { id: e ? e.id : 'j' + uid(), date: selDay, ts: `${selDay}T${f.time || '12:00'}:00`, place: f.place.trim(), text: f.text.trim(), stars: +f.stars, photo };
      const cur = e && state.journal.find((j) => j.id === e.id);
      if (cur) Object.assign(cur, entry); else state.journal.push(entry);
    });
    const p = $('#sheetBody img[data-photo]');
    if (p) photoUrl(p.dataset.photo).then((u) => { if (u) p.src = u; });
  }

  function addExpense() {
    openSheet(`
      <h3>Nuevo gasto</h3>
      <label class="f">Concepto<input name="what" required placeholder="Comida, taxi, entradas…"></label>
      <div class="two">
        <label class="f">Importe (€)<input name="amount" required inputmode="decimal" placeholder="0,00"></label>
        <label class="f">Quién pagó<input name="who" placeholder="Opcional"></label>
      </div>
      <label class="f">Día<select name="date">${dayOptions(dayOf(today) ? today : 'pre', true)}</select></label>
      ${sheetButtons()}`, (f) => {
      const amount = parseFloat(f.amount.replace(/\s|€/g, '').replace(',', '.'));
      if (!(amount > 0)) { toast('Importe no válido'); return; }
      state.expenses.push({ id: 'e' + uid(), what: f.what.trim(), amount, who: f.who.trim(), date: f.date });
    });
  }

  // ---------- Copia de seguridad ----------
  async function exportAll() {
    const photos = {};
    for (const j of state.journal) {
      if (!j.photo) continue;
      const b = await idb('readonly', (s) => s.get(j.photo)).catch(() => null);
      if (b) photos[j.photo] = await blobToData(b);
    }
    const blob = new Blob([JSON.stringify({ app: KEY, exported: new Date().toISOString(), state, photos })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sevilla-copia-${ymd(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function importAll(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== KEY || !data.state) throw new Error('formato');
      if (!confirm('Esto sustituye lo que hay apuntado en este móvil por la copia. ¿Seguir?')) return;
      state = Object.assign(blank(), data.state);
      for (const [id, url] of Object.entries(data.photos || {})) {
        const b = await (await fetch(url)).blob();
        await idb('readwrite', (s) => s.put(b, id));
        urls.delete(id);
      }
      save(); render(); toast('Copia importada');
    } catch (e) { toast('Ese archivo no es una copia válida'); }
  }

  // ---------- Eventos ----------
  document.addEventListener('click', (e) => {
    const tb = e.target.closest('.tab');
    if (tb) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case 'day': selDay = id; render(); window.scrollTo(0, 0); break;
      case 'toggle': open.has(id) ? open.delete(id) : open.add(id); render(); break;
      case 'done':
        if (state.done[id]) delete state.done[id];
        else { state.done[id] = selDay === today ? now().toISOString() : `${selDay}T23:59:00`; toast('Hecho · apuntado en el diario'); }
        save(); render(); break;
      case 'edit': itemSheet(id); break;
      case 'add': itemSheet(); break;
      case 'day-edit': editDay(); break;
      case 'restore': ALL.forEach((it) => { if (it.date === selDay) delete state.hidden[it.id]; }); save(); render(); break;
      case 'resv': {
        const b = bookings().find((x) => x.id === id);
        const order = b.optional ? ['todo', 'ok', 'skip'] : ['todo', 'ok'];
        const nxt = order[(order.indexOf(resvState(b)) + 1) % order.length];
        state.resv[id] = { ...(state.resv[id] || {}), status: nxt };
        save(); render(); break;
      }
      case 'resv-edit': editResv(id); break;
      case 'resv-add': editResv(); break;
      case 'reset-plan':
        if (confirm('¿Volver al plan y reservas originales? Se pierden vuestros cambios de horas, títulos y actividades quitadas. Lo añadido, el diario y los gastos se conservan.')) {
          state.edits = {}; state.hidden = {}; state.days = {};
          for (const b of BOOKINGS) { const r = state.resv[b.id]; if (r) state.resv[b.id] = { status: r.deleted ? undefined : r.status, code: r.code }; }
          save(); render(); toast('Plan original restaurado');
        }
        break;
      case 'j-add': editJournal(); break;
      case 'j-edit': editJournal(id); break;
      case 'e-add': addExpense(); break;
      case 'e-del': state.expenses = state.expenses.filter((x) => x.id !== id); save(); render(); break;
      case 'theme': theme = applyTheme(id); render(); break;
      case 'sync-on': {
        const url = $('#syncInput').value.trim() ? parseSync($('#syncInput').value) : SYNC_DEFAULT;
        if (!url) { toast('Ese enlace no es válido'); break; }
        setSync(url); render(); toast('Sincronización activada');
        break;
      }
      case 'sync-off': if (confirm('¿Dejar de sincronizar en este móvil? Los datos se quedan guardados aquí.')) { setSync(''); render(); } break;
      case 'sync-share':
        if (navigator.share) navigator.share({ title: 'Sevilla', text: 'Abre este enlace para compartir el plan del viaje', url: shareLink() }).catch(() => {});
        else navigator.clipboard.writeText(shareLink()).then(() => toast('Enlace copiado'), () => prompt('Copiad este enlace:', shareLink()));
        break;
      case 'export': exportAll(); break;
      case 'import': $('#importFile').click(); break;
      case 'wipe':
        if (confirm(syncUrl ? '¿Borrar todo lo apuntado? Se borra también en el otro móvil. No se puede deshacer.' : '¿Borrar todo lo apuntado en este móvil? No se puede deshacer.')) {
          state = blank(); save();
          idb('readwrite', (s) => s.clear()).catch(() => {});
          render(); toast('Borrado');
        }
        break;
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'importFile' && e.target.files[0]) importAll(e.target.files[0]);
  });

  header();
  // Enlace compartido desde el otro móvil: .../#sync=<url>
  if (location.hash.startsWith('#sync=')) {
    const url = parseSync(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (url && url !== syncUrl) { setSync(url); setTimeout(() => toast('Sincronización activada'), 300); }
  }
  if (syncUrl && !es) connect();
  window.addEventListener('online', () => { if (syncUrl && (!es || es.readyState === 2)) connect(); else flush(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && syncUrl && (!es || es.readyState === 2)) connect(); });
  render();
  // Refresca "Ahora / Siguiente" mientras la app está abierta.
  setInterval(() => { if (tab === 'plan' && !sheet.open && selDay === today) render(); }, 60000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
