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
  const SHADOW_KEY = 'sevilla-shadow', SHADOW_ROOM = 'sevilla-shadow-sala', PHOTOQ_KEY = 'sevilla-fotos-pendientes';
  const MAPS = ['done', 'notes', 'edits', 'hidden', 'days', 'resv'];
  const LISTS = ['custom', 'bookings', 'journal', 'expenses'];
  let syncUrl = '';   // la sala se calcula a partir de la clave al desbloquear
  let shadow = {};   // último estado que sabemos que está en la nube (ya descifrado)
  let es = null, online = false, pushing = false, retryT, dirty = false;
  // Firmas de nuestros envíos recientes: su eco no debe tratarse como un cambio del otro móvil.
  const own = [];
  const sig = (up) => JSON.stringify(Object.keys(up || {}).sort().map((k) => [k, canon(up[k]) ?? null]));

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
    if (syncUrl) { lsSet(SHADOW_KEY, JSON.stringify(shadow)); lsSet(SHADOW_ROOM, syncUrl); }
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
    const before = JSON.stringify(canon(toTree(state))), oldDone = state.done;
    state = fromTree(merged);
    persist();
    const changed = JSON.stringify(canon(toTree(state))) !== before;
    if (changed && (segs.length || isPatch)) {
      const fresh = Object.keys(state.done).filter((id) => !oldDone[id]);
      const it = fresh.length && findItem(fresh[0]);
      toast(fresh.length ? `${other()} ha marcado «${it ? it.title : 'una actividad'}»` : `${other()} ha hecho cambios`);
    }
    // El eco de nuestros propios cambios no altera nada: no repintamos para no cortar animaciones.
    if (changed) { if (sheet.open) dirty = true; else render(); }
    flush();
  }

  async function flush() {
    syncDot();
    if (!syncUrl || pushing || !online) return;
    const up = diff(toTree(state), shadow);
    if (!Object.keys(up).length) { flushPhotos(); return; }
    pushing = true;
    let mine = null;
    try {
      const enc = {};   // a la nube solo sale cada registro cifrado
      for (const [k, v] of Object.entries(up)) enc[k] = v === null ? null : await seal(v);
      mine = sig(enc);
      own.push(mine);
      const r = await fetch(syncUrl + '.json', { method: 'PATCH', body: JSON.stringify(enc) });
      if (!r.ok) throw new Error(r.status);
      for (const [p, v] of Object.entries(up)) setPath(shadow, p.split('/'), v);
      lsSet(SHADOW_KEY, JSON.stringify(shadow));
      pushing = false;
      flush();
    } catch (e) {
      pushing = false;
      if (mine && own.includes(mine)) own.splice(own.indexOf(mine), 1);
      clearTimeout(retryT); retryT = setTimeout(flush, 5000);
      syncDot();
    }
  }

  function connect() {
    if (es) es.close();
    es = null; online = false; own.length = 0;
    syncDot();
    if (!syncUrl) return;
    es = new EventSource(syncUrl + '.json');
    const split = (path) => path.split('/').filter(Boolean);
    es.addEventListener('put', (e) => {
      const d = JSON.parse(e.data);
      enqueue(async () => { const plain = await openAt(split(d.path), d.data); online = true; onRemote(d.path, plain, false); });
    });
    es.addEventListener('patch', (e) => {
      const d = JSON.parse(e.data), i = d.path === '/' ? own.indexOf(sig(d.data)) : -1;
      if (i >= 0) { own.splice(i, 1); return; }
      enqueue(async () => {
        const plain = {};
        for (const [k, v] of Object.entries(d.data || {})) plain[k] = await openAt([...split(d.path), ...split(k)], v);
        onRemote(d.path, plain, true);
      });
    });
    es.onerror = () => {
      online = false; syncDot();
      if (es && es.readyState === 2) { clearTimeout(retryT); retryT = setTimeout(connect, 15000); }
    };
  }

  // Los eventos se descifran en orden, uno detrás de otro.
  let remoteQ = Promise.resolve();
  const enqueue = (fn) => { remoteQ = remoteQ.then(fn).catch(() => {}); };
  // Descifra un trozo del árbol remoto: los registros viven en <sección>/<id>.
  async function openAt(segs, data) {
    if (data === null || data === undefined) return null;
    if (segs.length >= 2) {
      if (typeof data !== 'object' || !data.ct) return null;
      try { return await unseal(data); } catch (e) { return null; }   // lo que no se pueda abrir, se ignora
    }
    if (typeof data !== 'object') return null;
    const out = {};
    for (const [k, v] of Object.entries(data)) { const o = await openAt([...segs, k], v); if (o !== null) out[k] = o; }
    return out;
  }

  const pendingCount = () => (syncUrl ? Object.keys(diff(toTree(state), shadow)).length : 0);
  function syncDot() {
    const el = document.getElementById('syncDot');
    if (!el) return;
    el.className = 'sync-dot ' + (!syncUrl ? 'off' : online && !pendingCount() ? 'ok' : 'wait');
    el.title = !syncUrl ? '' : online ? 'Sincronizado' : 'Sin conexión';
  }

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
        const r = await fetch(photoRemote(q[0]), { method: 'PUT', body: JSON.stringify(await seal({ data: await blobToData(blob) })) });
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
  // El plan base (días, reservas, horarios) no está en el código público: llega cifrado y se rellena al desbloquear.
  let TRIP = {}, DAYS = [], BOOKINGS = [], PLACES = [], TIPS = [], ALL = [], PEOPLE = [];
  function applyBase(b) {
    TRIP = b.TRIP || {}; DAYS = b.DAYS || []; BOOKINGS = b.BOOKINGS || []; PLACES = b.PLACES || []; TIPS = b.TIPS || [];
    // Hora fija = venía cerrada en el Excel (billete o entrada); el resto son horquillas orientativas.
    ALL = DAYS.flatMap((d) => d.items.map((it) => ({ ...it, date: d.date, fixed: !!it.start && !it.approx })));
    PEOPLE = TRIP.people || [];
    me = PEOPLE.includes(lsGet('sevilla-me')) ? lsGet('sevilla-me') : '';
    if (!dayOf(selDay)) selDay = dayOf(today) ? today : (DAYS[0] || {}).date;
  }
  const KINDS = { visit: 'Visita', walk: 'Paseo', food: 'Comida', train: 'Transporte', show: 'Espectáculo', stay: 'Alojamiento / traslado', custom: 'Otro' };

  const today = ymd(now());
  let me = '';
  const other = () => (me && PEOPLE.find((p) => p !== me)) || 'El otro móvil';
  let resvFilter = 'todo', flash = null, justOpen = null, editMode = false;
  let tab = 'plan';
  let selDay = '';
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
        const rec = await fetch(photoRemote(id)).then((r) => r.json()).catch(() => null);
        const data = rec && rec.ct ? await unseal(rec).then((o) => o.data, () => null) : null;
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
    const list = [...base, ...custom].sort((a, b) => a.key - b.key);
    // Si se ha reordenado a mano, manda ese orden; lo nuevo va al final.
    const order = String((state.days[day.date] || {}).order || '').split(',').filter(Boolean);
    if (!order.length) return list;
    const pos = (it) => (order.includes(it.id) ? order.indexOf(it.id) : order.length);
    return list.map((it, i) => [it, i]).sort((a, b) => pos(a[0]) - pos(b[0]) || a[1] - b[1]).map((x) => x[0]);
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

  function hero(items, cur, next) {
    if (today < TRIP.start) {
      const diff = Math.round((new Date(TRIP.start + 'T00:00') - new Date(today + 'T00:00')) / 864e5);
      const pend = bookings().filter((b) => resvState(b) === 'todo').length;
      return `<div class="hero">
        <div class="hero-k">${diff === 1 ? 'Mañana empieza el viaje' : `Faltan ${diff} días`}</div>
        <div class="hero-t">${pend ? `${pend} reserva${pend > 1 ? 's' : ''} por hacer` : 'Todo reservado'}</div>
        ${pend ? '<div class="actions"><button class="btn" data-act="go" data-id="resv">Ver reservas</button></div>' : ''}
      </div>`;
    }
    if (selDay !== today) return '';
    const it = items.find((i) => i.id === (cur || next));
    if (!it) {
      return `<div class="hero">
        <div class="hero-k">Hoy</div>
        <div class="hero-t">No queda nada con hora por delante</div>
        <div class="actions">
          <a class="btn" target="_blank" rel="noopener" href="${dirUrl(TRIP.stay.address)}">Volver al alojamiento</a>
          <button class="btn" data-act="j-add">Apuntar un momento</button>
        </div>
      </div>`;
    }
    const d = mins(it.start) - (now().getHours() * 60 + now().getMinutes());
    const rel = d < 60 ? `en ${d} min` : `en ${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60} min` : ''}`;
    const after = cur && next && items.find((i) => i.id === next);
    const map = it.map || (it.custom && it.zone);
    return `<div class="hero">
      <div class="hero-k">${cur ? `Ahora${it.end ? ` · hasta las ${esc(it.end)}` : ''}` : `Siguiente · ${esc(it.start)} · ${rel}`}</div>
      <div class="hero-t">${esc(it.title)}</div>
      ${after ? `<div class="hero-sub">Después: ${esc(after.start)} · ${esc(after.title)}</div>` : ''}
      <div class="actions">
        ${map ? `<a class="btn" target="_blank" rel="noopener" href="${dirUrl(map)}">Cómo llegar</a>` : ''}
        <button class="btn" data-act="done" data-id="${it.id}">Hecho</button>
      </div>
    </div>`;
  }

  function viewPlan() {
    const day = dayInfo(dayOf(selDay));
    const items = itemsFor(day);
    const { cur, next } = nowNext(day, items);
    const nDone = items.filter((i) => state.done[i.id]).length;
    const hidden = ALL.filter((it) => state.hidden[it.id] && it.date === day.date).length;

    const li = items.map((it, idx) => {
      const isDone = !!state.done[it.id];
      const isOpen = !editMode && open.has(it.id);
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
      <li class="item k-${it.kind} ${isDone ? 'done' : ''} ${it.id === cur ? 'is-now' : ''} ${isOpen ? 'open' : ''} ${flash === it.id ? 'pop' : ''}">
        <div class="item-time ${it.fixed ? 'fixed' : 'flex'}">${timeCell(it)}</div>
        <div class="card">
          <div class="card-main">
            <button class="card-tap" data-act="toggle" data-id="${it.id}" aria-expanded="${isOpen}">
              <div class="card-title">${esc(it.title)}</div>
              ${meta.length ? `<div class="meta">${meta.join(' · ')}</div>` : ''}
              ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
            </button>
            ${editMode ? '' : `<button class="check" data-act="done" data-id="${it.id}" aria-label="${isDone ? 'Marcar como pendiente' : 'Marcar como hecho'}" aria-pressed="${isDone}"><i></i></button>`}
          </div>
          ${editMode ? `<div class="edit-bar">
            <button data-act="mv" data-id="${it.id}" data-dir="-1" aria-label="Subir" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button data-act="mv" data-id="${it.id}" data-dir="1" aria-label="Bajar" ${idx === items.length - 1 ? 'disabled' : ''}>↓</button>
            <button data-act="edit" data-id="${it.id}">Editar</button>
            <button class="del" data-act="rm" data-id="${it.id}">Quitar</button>
          </div>` : ''}
          ${isOpen ? `
          <div class="detail ${justOpen === it.id ? 'anim' : ''}">
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

    return `${editMode ? '' : hero(items, cur, next)}
      <div class="day-head">
        <div class="row"><h2>${esc(day.name)} · ${esc(day.title)}</h2><button class="link" data-act="edit-mode">${editMode ? 'Listo' : 'Editar día'}</button></div>
        <p>${esc(day.summary)}</p>
        ${editMode ? `<div class="actions" style="margin-top:10px">
          <button class="btn" data-act="day-edit">Título y resumen</button>
          ${day.order ? '<button class="btn" data-act="sort-time">Ordenar por hora</button>' : ''}
        </div>` : ''}
        <div class="progress"><i style="width:${items.length ? (nDone / items.length) * 100 : 0}%"></i></div>
        <div class="progress-label"><span>${nDone} de ${items.length} hechas</span><span>Gris = hora orientativa</span></div>
      </div>
      <ul class="timeline">${li}</ul>
      ${items.length ? '' : '<div class="empty">Día vacío.</div>'}
      <div class="add-row">
        <button class="add-big" data-act="add">+ Añadir sitio o actividad</button>
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
    const shown = resvFilter === 'todo' ? all.filter((b) => resvState(b) === 'todo') : all;
    const list = shown.map((b) => {
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
        <p>Tocad el estado para cambiarlo.</p>
        <div class="progress"><i style="width:${need.length ? (ok / need.length) * 100 : 0}%"></i></div>
        <div class="progress-label"><span>${ok} de ${need.length} listas</span><span>${need.length - ok} pendiente${need.length - ok === 1 ? '' : 's'}</span></div>
      </div>
      <div class="seg" style="margin-top:14px">
        <button class="${resvFilter === 'todo' ? 'on' : ''}" data-act="resv-filter" data-id="todo">Pendientes · ${need.length - ok}</button>
        <button class="${resvFilter === 'all' ? 'on' : ''}" data-act="resv-filter" data-id="all">Todas · ${all.length}</button>
        <button class="${resvFilter === 'tix' ? 'on' : ''}" data-act="resv-filter" data-id="tix">Billetes${tKey && tLoaded ? ` · ${tickets.length}` : ''}</button>
      </div>
      ${resvFilter === 'tix' ? viewTickets() : list || '<div class="empty">No queda nada por reservar.</div>'}`;
  }

  // ---------- Billetes (cifrados en el móvil) ----------
  // La web y la base de datos son públicas, así que los billetes se cifran con AES-GCM usando una clave
  // que solo conocen los dos viajeros. A la nube solo sube el contenido cifrado.
  const TKEY = 'sevilla-clave', TPEND = 'sevilla-billetes-pendientes';
  let tKey = null, tickets = [], tLocked = 0, tLoaded = false;
  const canCrypt = !!(window.crypto && crypto.subtle);
  const tBase = () => `${syncUrl}-billetes`;
  const b64 = (buf) => { const a = new Uint8Array(buf); let t = ''; for (let i = 0; i < a.length; i += 0x8000) t += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(t); };
  const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  async function deriveKey(pass) {
    const te = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', te.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('sevilla-billetes:' + CONFIG.legacy), iterations: 600000 }, base, 256);
    return b64(bits);
  }
  const importKey = (raw) => crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function seal(obj, key = tKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function unseal(rec, key = tKey) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  const tPending = () => { try { return JSON.parse(lsGet(TPEND) || '[]'); } catch (e) { return []; } };
  const tSetPending = (list) => lsSet(TPEND, JSON.stringify([...new Set(list)]));

  async function loadTickets() {
    if (!tKey) return;
    let local = (await idb('readonly', (st) => st.getAllKeys()).catch(() => [])).filter((k) => String(k).startsWith('t:')).map((k) => k.slice(2));
    if (syncUrl && navigator.onLine !== false) {
      try {
        for (const id of tPending()) {   // subir lo que quedó pendiente sin cobertura
          const rec = await idb('readonly', (st) => st.get('t:' + id));
          if (rec) { const r = await fetch(`${tBase()}/${id}.json`, { method: 'PUT', body: JSON.stringify(rec) }); if (!r.ok) throw new Error(r.status); }
          tSetPending(tPending().filter((x) => x !== id));
        }
        const remote = Object.keys((await (await fetch(`${tBase()}.json?shallow=true`)).json()) || {}).filter((k) => k !== '_check');
        for (const id of remote.filter((x) => !local.includes(x))) {
          const rec = await (await fetch(`${tBase()}/${id}.json`)).json();
          if (rec && rec.ct) { await idb('readwrite', (st) => st.put(rec, 't:' + id)); local.push(id); }
        }
        for (const id of local.filter((x) => !remote.includes(x))) await idb('readwrite', (st) => st.delete('t:' + id));   // quitado en el otro móvil
        local = local.filter((x) => remote.includes(x));
      } catch (e) { /* sin conexión: seguimos con lo que hay en el móvil */ }
    }
    const out = [];
    tLocked = 0;
    for (const id of local) {
      try { out.push({ id, ...(await unseal(await idb('readonly', (st) => st.get('t:' + id)))) }); } catch (e) { tLocked++; }
    }
    tickets = out.sort((a, b) => (a.date + a.title).localeCompare(b.date + b.title));
    tLoaded = true;
  }
  const refreshTickets = () => loadTickets().then(() => { if (tab === 'resv' && resvFilter === 'tix' && !sheet.open) render(); });

  function viewTickets() {
    if (!canCrypt) return '<div class="empty">Este navegador no permite cifrar los billetes.</div>';
    if (!tKey) {
      return `<div class="panel" style="margin-top:14px">
        <h3>Billetes privados</h3>
        <p class="txt">Guardad aquí los PDF o fotos de billetes y entradas. Se cifran en el móvil con una clave que solo sabéis vosotros dos: sin ella nadie puede abrirlos.</p>

      </div>`;
    }
    if (!tLoaded) return '<div class="empty">Cargando billetes…</div>';
    let last = null;
    const list = tickets.map((t) => {
      const head = t.date !== last ? `<div class="section-title">${esc(dayOf(t.date) ? dayOf(t.date).name : 'General')}</div>` : '';
      last = t.date;
      return `${head}
      <div class="panel">
        <h3>${esc(t.title)}</h3>
        <div class="sub">${[t.name, t.by && `lo añadió ${t.by}`].filter(Boolean).map(esc).join(' · ') || 'Sin archivo'}</div>
        ${t.note ? `<div class="mynote">${esc(t.note)}</div>` : ''}
        <div class="actions">
          ${t.data ? `<button class="btn primary" data-act="tix-open" data-id="${t.id}">Abrir</button>` : ''}
          <button class="btn danger" data-act="tix-del" data-id="${t.id}">Quitar</button>
        </div>
      </div>`;
    }).join('');
    return `${list || '<div class="empty">Aún no hay billetes. Pulsad + arriba para añadir el primero.</div>'}
      ${tLocked ? `<div class="empty">Hay ${tLocked} billete${tLocked > 1 ? 's' : ''} que no se puede${tLocked > 1 ? 'n' : ''} abrir con la clave de este móvil.</div>` : ''}
      <div class="empty" style="padding-top:8px">Cifrados con la clave del viaje.</div>`;
  }

  function ticketSheet() {
    openSheet(`
      <h3>Nuevo billete</h3>
      <label class="f">Qué es<input name="title" required placeholder="AVE ida, entrada Alcázar…"></label>
      <label class="f">Día<select name="date">${dayOptions(selDay, true).replace('Antes del viaje', 'General')}</select></label>
      <label class="f">Archivo (PDF o foto)<input type="file" name="file" accept="image/*,application/pdf"></label>
      <label class="f">Localizador o notas (opcional)<textarea name="note"></textarea></label>
      ${sheetButtons()}`, async (f, v, form) => {
      const file = form.querySelector('[name=file]').files[0];
      let data = '', name = '', type = '';
      try {
        if (file) {
          const isImg = file.type.startsWith('image/');
          if (!isImg && file.size > 6e6) { toast('El archivo pasa de 6 MB'); return; }
          data = await blobToData(isImg ? await shrink(file, 2000) : file);
          name = file.name; type = isImg ? 'image/jpeg' : file.type;
        }
        const id = 't' + uid();
        const rec = await seal({ title: f.title.trim(), date: f.date, note: f.note.trim(), name, type, data, by: me, ts: new Date().toISOString() });
        await idb('readwrite', (st) => st.put(rec, 't:' + id));
        tSetPending([...tPending(), id]);
        await loadTickets();
        toast(tPending().includes(id) && syncUrl ? 'Guardado · se enviará al otro móvil con cobertura' : 'Billete guardado');
      } catch (e) { toast('No se pudo guardar el billete'); }
    });
  }

  async function openTicket(id) {
    const t = tickets.find((x) => x.id === id);
    if (!t || !t.data) return;
    if (t.type.startsWith('image/')) {
      $('#viewerImg').src = t.data;
      $('#viewer').showModal();
      return;
    }
    const url = URL.createObjectURL(await (await fetch(t.data)).blob());
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function deleteTicket(id) {
    if (!confirm('¿Quitar este billete? Se quita también en el otro móvil.')) return;
    await idb('readwrite', (st) => st.delete('t:' + id)).catch(() => {});
    tSetPending(tPending().filter((x) => x !== id));
    if (syncUrl) await fetch(`${tBase()}/${id}.json`, { method: 'DELETE' }).catch(() => {});
    await loadTickets();
    render();
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
          ${e.by ? `<div class="sub">${esc(e.by)}</div>` : ''}
        </div><button class="x" data-act="j-edit" data-id="${e.id}" aria-label="Editar" style="width:auto;font-size:15px">Editar</button></div>
        ${e.text ? `<p class="txt" style="margin-top:2px">${esc(e.text)}</p>` : ''}
        ${e.photo ? `<img data-photo="${esc(e.photo)}" alt="Foto del momento">` : ''}
      </div></div>`;
    }).join('');
    return `
      <div class="day-head" style="padding-bottom:14px">
        <h2>Diario · ${esc(day.name)}</h2>
        <p>Lo que marcáis como hecho aparece aquí solo. Con + añadís momentos, notas y fotos.</p>
      </div>
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
    const paid = PEOPLE.map((p) => state.expenses.filter((e) => e.who === p).reduce((s, e) => s + e.amount, 0));
    const gap = PEOPLE.length === 2 ? (paid[0] - paid[1]) / 2 : 0;
    const settle = !(paid[0] || paid[1]) ? '' : `<div class="panel settle">
        <h3>${Math.abs(gap) < 0.005 ? 'Estáis en paz' : `${esc(PEOPLE[gap > 0 ? 1 : 0])} debe ${euro(Math.abs(gap))} a ${esc(PEOPLE[gap > 0 ? 0 : 1])}`}</h3>
        <div class="sub">${PEOPLE.map((p, i) => `${esc(p)} ha pagado ${euro(paid[i])}`).join(' · ')}</div>
      </div>`;
    return `
      <div class="stats">
        <div class="panel"><div class="sub">Total</div><div class="big-num">${euro(total)}</div></div>
        <div class="panel"><div class="sub">Por persona</div><div class="big-num">${euro(total / 2)}</div></div>
      </div>
      ${settle}
      ${other.length ? group('Antes del viaje', other) : ''}
      ${byDay.map((g) => group(g.d.name, g.list)).join('')}
      ${state.expenses.length ? '' : '<div class="empty">Sin gastos apuntados. Pulsad + arriba para añadir el primero.</div>'}`;
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
      <div class="section-title">Este móvil es de</div>
      <div class="seg">${PEOPLE.map((p) => `<button class="${me === p ? 'on' : ''}" data-act="me" data-id="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <div class="section-title">Apariencia</div>
      <div class="seg">${[['light', 'Claro'], ['dark', 'Oscuro'], ['auto', 'Automático']].map(([k, n]) => `<button class="${theme === k ? 'on' : ''}" data-act="theme" data-id="${k}">${n}</button>`).join('')}</div>
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
      <div class="section-title">Sincronización entre los dos móviles</div>
      <div class="panel">
        <h3>${online ? (pendingCount() ? 'Enviando cambios…' : 'Sincronizado') : 'Sin conexión'}</h3>
        <p class="txt">Lo que marca o apunta uno le aparece al otro al momento. Todo viaja y se guarda cifrado con la clave del viaje: sin ella nadie puede leerlo.</p>
        <div class="actions"><button class="btn danger" data-act="lock">Bloquear este móvil</button></div>
      </div>
      <div class="panel">
        <h3>Código de acceso</h3>
        <p class="txt">Vale como clave en otro móvil u ordenador, sin saber la frase. Guardadlo en un gestor de contraseñas y no lo compartáis con nadie más: da acceso a todo.</p>
        <div class="actions"><button class="btn" data-act="copy-code">Copiar código</button></div>
      </div>
      <div class="section-title">Vuestros datos</div>
      <div class="panel">
        <p class="txt" style="margin-top:0">Con «Exportar copia» os lleváis un archivo con todo lo apuntado, fotos incluidas (el archivo no va cifrado: guardadlo en un sitio seguro). «Actualizar plan» carga un plan nuevo para los dos.</p>
        <div class="actions">
          <button class="btn" data-act="export">Exportar copia</button>
          <button class="btn" data-act="import">Importar copia</button>
          <button class="btn" data-act="plan-file">Actualizar plan</button>
          <button class="btn" data-act="reset-plan">Restaurar plan original</button>
          <button class="btn danger" data-act="wipe">Borrar todo</button>
        </div>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
        <input type="file" id="planFile" accept="application/json,.json" hidden>
      </div>
      <div class="panel">
        <h3>Tenerla como app</h3>
        <p class="txt">iPhone: Safari → Compartir → «Añadir a pantalla de inicio». Android: Chrome → menú ⋮ → «Instalar aplicación». Una vez abierta, funciona también sin cobertura.</p>
      </div>`;
  }

  // ---------- Render ----------
  const VIEWS = { plan: viewPlan, resv: viewResv, diary: viewDiary, money: viewMoney, info: viewInfo };
  // anim: 'enter' (cambio de pestaña), 'from-r' / 'from-l' (cambio de día). Sin anim = refresco en el sitio.
  function render(anim) {
    const chips = tab === 'plan' || tab === 'diary' ? dayChips() : '';
    $('#view').innerHTML = `${chips}<div class="page ${anim || ''}">${VIEWS[tab]()}</div>`;
    $('#plusBtn').hidden = tab === 'info';
    flash = justOpen = null;
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
  // Guardamos en el propio envío del formulario (no en el evento «close», que puede llegar con retraso).
  $('#sheetBody').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (e.submitter && e.submitter.value) || 'ok', h = onSheet, form = e.target;
    onSheet = null;
    const data = Object.fromEntries(new FormData(form));
    sheet.close();
    if (h && v !== 'cancel') { await h(data, v, form); save(); }
    dirty = false;
    render();
  });
  // Cierre con Esc o tocando fuera.
  sheet.addEventListener('close', () => {
    if (sheet.open) return;
    onSheet = null;
    if (dirty) { dirty = false; render(); }
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close('cancel'); });
  const sheetButtons = (del) => `<div class="sheet-actions">
    ${del ? `<button class="btn danger" value="delete" formnovalidate>${del}</button>` : ''}
    <button class="btn" value="cancel" formnovalidate>Cancelar</button>
    <button class="btn primary" value="ok">Guardar</button></div>`;
  const dayOptions = (sel, withPre) => (withPre ? `<option value="pre" ${sel === 'pre' ? 'selected' : ''}>Antes del viaje</option>` : '')
    + DAYS.map((d) => `<option value="${d.date}" ${d.date === sel ? 'selected' : ''}>${d.name}</option>`).join('');

  // ---------- Formulario de actividad ----------
  const DURS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240];
  const ZONES = ['Centro', 'Santa Cruz', 'Arenal', 'Encarnación', 'Alameda', 'Macarena', 'Triana', 'María Luisa', 'Santa Justa', 'Córdoba · Judería', 'Córdoba · Mezquita', 'Córdoba · Ribera', 'Córdoba · Centro'];
  const MOVES = ['A pie', 'Taxi', 'Bus', 'Tranvía', 'Metro', 'Tren', 'AVE', 'Bici'];
  const FOODS = ['Desayuno', 'Café', 'Comida', 'Aperitivo', 'Merienda', 'Cena'];
  const RESVS = ['Pendiente', 'Confirmado', 'Con reserva', 'Opcional'];
  const PRIOS = { A: 'Imprescindible', B: 'Recomendable', C: 'Opcional' };
  // Desplegable con «Otra…», que deja escribir un valor que no esté en la lista.
  function pick(name, label, options, value) {
    const known = !value || options.includes(value);
    return `<label class="f">${label}<select name="${name}" data-other>
      <option value="">—</option>
      ${options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      <option value="__other" ${known ? '' : 'selected'}>Otra…</option></select>
      <input name="${name}_other" value="${known ? '' : esc(value)}" placeholder="Escribid aquí" ${known ? 'hidden' : ''}></label>`;
  }
  const picked = (f, name) => (f[name] === '__other' ? (f[name + '_other'] || '').trim() : f[name] || '');
  const addMin = (t, m) => { const x = Math.min(mins(t) + m, 23 * 60 + 59); return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

  function itemSheet(id) {
    const it = id ? findItem(id) : { date: selDay, kind: 'visit', custom: true };
    if (!it) return;
    const v = (k) => esc(it[k] || '');
    const groups = [...new Set(CATALOG.map((c) => c.group))];
    openSheet(`
      <h3>${id ? 'Editar actividad' : 'Añadir al plan'}</h3>
      <label class="f">Elegir de la lista<select name="catalog">
        <option value="">${id ? '— no cambiar —' : 'Escribir uno nuevo…'}</option>
        ${groups.map((g) => `<optgroup label="${esc(g)}">${CATALOG.map((c, i) => (c.group === g ? `<option value="${i}">${esc(c.name)}</option>` : '')).join('')}</optgroup>`).join('')}
      </select></label>
      <label class="f">Qué<input name="title" required value="${v('title')}" placeholder="Sitio o actividad"></label>
      <div class="two">
        <label class="f">Día<select name="date">${dayOptions(it.date)}</select></label>
        <label class="f">Tipo<select name="kind">${Object.entries(KINDS).map(([k, n]) => `<option value="${k}" ${k === it.kind ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="two">
        <label class="f">Desde<input type="time" name="start" value="${v('start')}"></label>
        <label class="f">Hasta<input type="time" name="end" value="${v('end')}"></label>
      </div>
      <div class="two">
        <label class="f">Duración<select name="dur"><option value="">—</option>${DURS.map((d) => `<option value="${d}" ${d === it.dur ? 'selected' : ''}>${fmtDur(d)}</option>`).join('')}${it.dur && !DURS.includes(it.dur) ? `<option value="${it.dur}" selected>${fmtDur(it.dur)}</option>` : ''}</select></label>
        <label class="f">Prioridad<select name="prio"><option value="">—</option>${Object.entries(PRIOS).map(([k, n]) => `<option value="${k}" ${k === it.prio ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <label class="switch"><span>Hora fija<small>Apagado = hora orientativa</small></span><input type="checkbox" name="fixed" ${it.fixed ? 'checked' : ''}></label>
      <div class="two">
        ${pick('zone', 'Zona', ZONES, it.zone)}
        ${pick('move', 'Cómo se llega', MOVES, it.move)}
      </div>
      <div class="two">
        ${pick('resv', 'Reserva', RESVS, it.resv)}
        ${pick('food', 'Comida', FOODS, it.food)}
      </div>
      <label class="f">Lugar en el mapa<input name="map" value="${v('map')}" placeholder="Nombre o dirección para «Cómo llegar»"></label>
      <label class="f">Detalles del plan<textarea name="note" placeholder="Consejos, qué reservar…">${v('note')}</textarea></label>
      <label class="f">Nuestra nota<textarea name="my" placeholder="Qué tal fue, dónde comimos…">${esc(id ? state.notes[id] || '' : '')}</textarea></label>
      ${sheetButtons(id ? (it.custom ? 'Borrar' : 'Quitar') : '')}`, (f, btn) => {
      if (btn === 'delete') { removeItem(id); return; }
      const dur = +f.dur || (f.start && f.end && mins(f.end) > mins(f.start) ? mins(f.end) - mins(f.start) : 0);
      const data = {
        title: f.title.trim(), date: f.date, kind: f.kind, start: f.start, end: f.end, fixed: !!f.fixed, dur, prio: f.prio,
        zone: picked(f, 'zone'), move: picked(f, 'move'), resv: picked(f, 'resv'), food: picked(f, 'food'), map: f.map.trim(), note: f.note.trim(),
      };
      const key = id || 'c' + uid();
      if (!id) state.custom.push({ id: key, ...data });
      else if (it.custom) Object.assign(state.custom.find((x) => x.id === id) || {}, data);
      else state.edits[id] = data;
      if (f.my.trim()) state.notes[key] = f.my.trim(); else delete state.notes[key];
      selDay = f.date;
    });
  }

  function removeItem(id) {
    const it = findItem(id);
    if (!it) return;
    if (it.custom) state.custom = state.custom.filter((c) => c.id !== id); else state.hidden[id] = true;
    delete state.done[id];
    toast(it.custom ? 'Borrado' : 'Quitado · se puede recuperar al final del día');
  }

  // Los desplegables del formulario se rellenan unos a otros.
  $('#sheetBody').addEventListener('change', (e) => {
    const t = e.target, el = (n) => e.currentTarget.elements[n];
    const setPick = (name, value) => {
      const sel = el(name), has = [...sel.options].some((o) => o.value === value);
      sel.value = !value ? '' : has ? value : '__other';
      el(name + '_other').value = has ? '' : value || '';
      el(name + '_other').hidden = sel.value !== '__other';
    };
    const applyDur = () => { if (el('start') && el('start').value && el('dur').value) el('end').value = addMin(el('start').value, +el('dur').value); };
    if (t.matches('select[data-other]')) { const o = el(t.name + '_other'); o.hidden = t.value !== '__other'; if (!o.hidden) o.focus(); }
    if (t.name === 'catalog' && t.value !== '') {
      const c = CATALOG[+t.value];
      el('title').value = c.name; el('kind').value = c.kind; el('map').value = c.map || '';
      el('dur').value = DURS.includes(c.dur) ? c.dur : '';
      setPick('zone', c.zone); setPick('move', c.move || 'A pie'); setPick('food', c.food || '');
      applyDur();
    }
    if (t.name === 'dur' || t.name === 'start') applyDur();
  });

  function editDay() {
    const d = dayInfo(dayOf(selDay));
    openSheet(`
      <h3>${esc(d.name)}</h3>
      <label class="f">Título del día<input name="title" required value="${esc(d.title)}"></label>
      <label class="f">Resumen<textarea name="summary">${esc(d.summary)}</textarea></label>
      ${sheetButtons()}`, (f) => { state.days[selDay] = { ...(state.days[selDay] || {}), title: f.title.trim(), summary: f.summary.trim() }; });
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
      const entry = { id: e ? e.id : 'j' + uid(), date: selDay, ts: `${selDay}T${f.time || '12:00'}:00`, place: f.place.trim(), text: f.text.trim(), stars: +f.stars, photo, by: (e && e.by) || me };
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
        <label class="f">Quién pagó<select name="who">${PEOPLE.map((p) => `<option ${p === me ? 'selected' : ''}>${esc(p)}</option>`).join('')}<option value="" ${me ? '' : 'selected'}>A medias</option></select></label>
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
    if (tb) { if (tab !== tb.dataset.tab) { tab = tb.dataset.tab; render('enter'); } window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case 'day': goDay(id); break;
      case 'go': tab = id; render('enter'); window.scrollTo(0, 0); break;
      case 'plus': ({ plan: itemSheet, resv: () => (resvFilter === 'tix' ? ticketSheet() : editResv()), diary: editJournal, money: addExpense }[tab] || (() => {}))(); break;
      case 'me': me = id; lsSet('sevilla-me', me); render(); break;
      case 'resv-filter': resvFilter = id; render(); if (id === 'tix') refreshTickets(); break;
      case 'tix-open': openTicket(id); break;
      case 'tix-del': deleteTicket(id); break;
      case 'tix-close': $('#viewer').close(); break;
      case 'toggle':
        if (editMode) { itemSheet(id); break; }
        if (open.has(id)) open.delete(id); else { open.add(id); justOpen = id; }
        render(); break;
      case 'edit-mode': editMode = !editMode; render(); break;
      case 'mv': {
        const ids = itemsFor(dayOf(selDay)).map((x) => x.id), i = ids.indexOf(id), j = i + +el.dataset.dir;
        if (i < 0 || j < 0 || j >= ids.length) break;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        state.days[selDay] = { ...(state.days[selDay] || {}), order: ids.join(',') };
        save(); render(); break;
      }
      case 'sort-time': { const d = { ...(state.days[selDay] || {}) }; delete d.order; state.days[selDay] = d; save(); render(); break; }
      case 'rm': {
        const it = findItem(id);
        if (it && it.custom && !confirm(`¿Borrar «${it.title}»?`)) break;
        removeItem(id); save(); render(); break;
      }
      case 'done':
        if (state.done[id]) delete state.done[id];
        else {
          state.done[id] = selDay === today ? now().toISOString() : `${selDay}T23:59:00`;
          flash = id;
          if (navigator.vibrate) navigator.vibrate(12);
          toast('Hecho · apuntado en el diario');
        }
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
      case 'lost': showLost(); break;
      case 'lock-back': showLock(); break;
      case 'copy-code': {
        const code = lsGet(TKEY) || '';
        if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast('Código copiado'), () => prompt('Copiad este código:', code));
        else prompt('Copiad este código:', code);
        break;
      }
      case 'lock':
        if (confirm('¿Bloquear este móvil? Habrá que volver a escribir la clave del viaje para entrar.')) lock();
        break;
      case 'plan-file': $('#planFile').click(); break;
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
  function goDay(date) {
    if (date === selDay) return;
    const dir = DAYS.findIndex((d) => d.date === date) > DAYS.findIndex((d) => d.date === selDay) ? 'from-r' : 'from-l';
    selDay = date;
    render(dir);
    window.scrollTo(0, 0);
  }
  // Deslizar a izquierda/derecha cambia de día en Plan y Diario.
  let touch = null;
  $('#view').addEventListener('touchstart', (e) => { touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  $('#view').addEventListener('touchend', (e) => {
    if (!touch || (tab !== 'plan' && tab !== 'diary')) return;
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
    const next = DAYS[DAYS.findIndex((d) => d.date === selDay) + (dx < 0 ? 1 : -1)];
    if (next) goDay(next.date);
  }, { passive: true });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'importFile' && e.target.files[0]) importAll(e.target.files[0]);
    if (e.target.id === 'planFile' && e.target.files[0]) importPlan(e.target.files[0]);
    if (e.target.id === 'setupFile' && e.target.files[0]) setupPlan(e.target.files[0]);
  });

  // ---------- Privacidad: todo cifrado con la clave del viaje ----------
  // La sala de cada viaje se deriva de la clave, así que sin ella ni siquiera se sabe dónde buscar.
  const BASE_KEY = 'sevilla-plan';
  const validPlan = (b) => !!(b && b.TRIP && Array.isArray(b.DAYS) && b.DAYS.every((d) => d.date && Array.isArray(d.items)));
  const getJSON = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); };
  const putJSON = (url, body) => fetch(url, { method: 'PUT', body: JSON.stringify(body) }).then((r) => { if (!r.ok) throw new Error(r.status); });
  async function roomFor(raw) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', unb64(raw)));
    return `${CONFIG.db}/v-${[...h].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 40)}`;
  }
  const cachedBase = () => { try { return JSON.parse(lsGet(BASE_KEY) || 'null'); } catch (e) { return null; } };

  function lock() {
    lsSet(TKEY, null); lsSet(BASE_KEY, null); lsSet(SHADOW_KEY, null); lsSet(SHADOW_ROOM, null);
    location.reload();
  }

  function showLock(msg) {
    document.body.classList.add('locked');
    $('#view').innerHTML = `<div class="lock">
      <div class="lock-icon"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div>
      <h2>Viaje privado</h2>
      <p>Escribid la clave del viaje. Solo hace falta una vez en cada móvil.</p>
      <form id="lockForm">
        <input name="pass" type="password" required minlength="8" autocomplete="current-password" placeholder="Clave del viaje" aria-label="Clave del viaje">
        <button class="btn primary block">Entrar</button>
      </form>
      <p class="lock-msg">${esc(msg || '')}</p>
      <button class="link" data-act="lost">No recuerdo la clave</button>
    </div>`;
  }

  function showLost() {
    $('#view').innerHTML = `<div class="lock">
      <h2>Sin clave</h2>
      <p style="text-align:left"><b>1. Probad primero en un dispositivo donde ya entrasteis.</b> Si no cerrasteis sesión, entra solo. Allí, en Info → «Código de acceso», copiad el código: vale como clave en los demás.</p>
      <p style="text-align:left"><b>2. Si no queda ninguno</b>, cread una clave nueva. Se conservan el plan, notas, diario, gastos y fotos; los billetes ya subidos no se pueden abrir y habrá que volver a subirlos.</p>
      <form id="newKeyForm">
        <input name="pass" type="password" required minlength="8" autocomplete="new-password" placeholder="Clave nueva (mínimo 8 caracteres)" aria-label="Clave nueva">
        <input name="pass2" type="password" required minlength="8" autocomplete="new-password" placeholder="Repetid la clave" aria-label="Repetir la clave">
        <button class="btn primary block">Crear clave nueva</button>
      </form>
      <p class="lock-msg"></p>
      <button class="link" data-act="lock-back">Volver</button>
    </div>`;
  }
  const isCode = (t) => /^[A-Za-z0-9+/]{43}=$/.test(t.trim());   // el código de acceso es la clave ya derivada
  document.addEventListener('submit', async (e) => {
    if (e.target.id === 'newKeyForm') {
      e.preventDefault();
      const f = e.target.elements, msg = e.target.parentElement.querySelector('.lock-msg');
      if (f.pass.value !== f.pass2.value) { msg.textContent = 'Las dos claves no coinciden.'; return; }
      const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Creando…';
      try {
        const raw = await deriveKey(f.pass.value), key = await importKey(raw), room = await roomFor(raw);
        let base = await getJSON(`${room}-base.json`);   // si ya existe un viaje con esa clave, entramos en él
        if (base && base.ct) base = await unseal(base, key).catch(() => null); else base = null;
        lsSet(TKEY, raw);
        start(key, room, base);
      } catch (err) { btn.disabled = false; btn.textContent = 'Crear clave nueva'; msg.textContent = 'No se pudo crear. ¿Hay conexión?'; }
      return;
    }
    if (e.target.id !== 'lockForm') return;
    e.preventDefault();
    const btn = e.target.querySelector('button'), pass = e.target.elements.pass.value;
    btn.disabled = true; btn.textContent = 'Comprobando…';
    const fail = (m) => { showLock(m); };
    try {
      const raw = isCode(pass) ? pass.trim() : await deriveKey(pass);
      const key = await importKey(raw);
      const room = await roomFor(raw);
      let base = await getJSON(`${room}-base.json`);
      if (base && base.ct) base = await unseal(base, key).catch(() => null);
      else {
        base = null;
        // Aún no hay plan en la sala: comprobamos la clave con la marca de la sala antigua.
        const chk = (await getJSON(`${CONFIG.legacy}/check.json`).catch(() => null)) || (await getJSON(`${CONFIG.legacy}-billetes/_check.json`).catch(() => null));
        if (!chk || !chk.ct) return fail('No hay ningún viaje con esa clave.');
        try { await unseal(chk, key); } catch (err) { return fail('Clave incorrecta.'); }
      }
      lsSet(TKEY, raw);
      start(key, room, base);
    } catch (err) { fail('No se pudo comprobar la clave. ¿Hay conexión?'); }
  });

  // Primera vez en este viaje: el plan no está en la web (es privado) y hay que cargarlo una vez desde un archivo.
  function showSetup(room) {
    document.body.classList.add('locked');
    $('#view').innerHTML = `<div class="lock">
      <div class="lock-icon"><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg></div>
      <h2>Cargar el plan</h2>
      <p>Clave correcta. Es la primera vez en este viaje: elegid el archivo del plan (<b>plan-sevilla.json</b>). Se cifra y se guarda; los demás móviles solo necesitan la clave.</p>
      <label class="btn primary block" style="cursor:pointer">Elegir archivo<input id="setupFile" type="file" accept="application/json,.json" hidden></label>
      <p class="lock-msg" id="setupMsg"></p>
      <button class="link" data-act="copy-code">Copiar código de acceso</button>
      <p style="font-size:13px">Si el archivo del plan está en otro dispositivo, copiad el código y pegadlo allí como clave.</p>
    </div>`;
    setupRoom = room;
  }
  let setupRoom = '';
  async function setupPlan(file) {
    try {
      const b = JSON.parse(await file.text());
      if (!validPlan(b)) throw new Error('formato');
      await putJSON(`${setupRoom}-base.json`, await seal(b));
      start(tKey, setupRoom, b);
    } catch (e) { $('#setupMsg').textContent = 'Ese archivo no es un plan válido.'; }
  }

  function start(key, room, base) {
    tKey = key; syncUrl = room;
    shadow = {};
    if (lsGet(SHADOW_ROOM) === room) { try { shadow = JSON.parse(lsGet(SHADOW_KEY) || '{}'); } catch (e) { shadow = {}; } }
    const b = base || cachedBase();
    if (!b) { showSetup(room); return; }
    if (base) lsSet(BASE_KEY, JSON.stringify(base));
    applyBase(b);
    document.body.classList.remove('locked');
    header();
    render();
    askWho();
    connect();
    refreshTickets();
    syncBase(!base).then(migrate);
  }

  // Trae el plan cifrado de la nube (o lo sube si aún no está, la primera vez).
  async function syncBase(fetchIt) {
    try {
      let remote = fetchIt ? await getJSON(`${syncUrl}-base.json`) : true;
      if (remote && remote.ct) {
        const b = await unseal(remote);
        if (JSON.stringify(b) !== lsGet(BASE_KEY)) { lsSet(BASE_KEY, JSON.stringify(b)); applyBase(b); header(); if (!sheet.open) render(); }
      } else if (!remote) {
        const b = cachedBase();
        if (b) { await putJSON(`${syncUrl}-base.json`, await seal(b)); lsSet(BASE_KEY, JSON.stringify(b)); }
      }
    } catch (e) { /* sin conexión: seguimos con la copia del móvil */ }
  }

  // Paso único desde la sala antigua (sin cifrar): se copia todo cifrado y se deja solo una marca.
  async function migrate() {
    try {
      const L = CONFIG.legacy;
      const old = await getJSON(`${L}.json`);
      const oldT = await getJSON(`${L}-billetes.json`);
      const oldF = await getJSON(`${L}-fotos.json?shallow=true`);
      const data = old && Object.keys(old).some((k) => MAPS.includes(k) || LISTS.includes(k)) ? old : null;
      let ticketsOk = false;
      if (oldT && oldT._check && oldT._check.ct) { try { await unseal(oldT._check); ticketsOk = true; } catch (e) { /* otra clave */ } }
      if (!data && !ticketsOk && !oldF) return;
      if (data) {   // juntamos lo de la nube antigua con lo del móvil; gana lo del móvil
        const merged = JSON.parse(JSON.stringify(data)), loc = toTree(state);
        for (const sec of [...MAPS, ...LISTS]) for (const [id, v] of Object.entries(loc[sec] || {})) setPath(merged, [sec, id], v);
        state = fromTree(merged); save(); if (!sheet.open) render();
      }
      if (ticketsOk) for (const [id, rec] of Object.entries(oldT)) if (rec && rec.ct) await putJSON(`${tBase()}/${id}.json`, rec);
      if (oldF) {
        for (const id of Object.keys(oldF)) {
          const d = await getJSON(`${L}-fotos/${id}.json`);
          if (typeof d === 'string') await putJSON(photoRemote(id), await seal({ data: d }));
        }
      }
      await putJSON(`${L}.json`, { migrado: true, check: await seal({ ok: 1 }) });
      if (ticketsOk) await fetch(`${L}-billetes.json`, { method: 'DELETE' });
      await fetch(`${L}-fotos.json`, { method: 'DELETE' });
      refreshTickets();
    } catch (e) { /* se reintenta la próxima vez */ }
  }

  async function importPlan(file) {
    try {
      const b = JSON.parse(await file.text());
      if (!validPlan(b)) throw new Error('formato');
      if (!confirm('¿Cargar este plan para los dos? Vuestros cambios, el diario y los gastos se conservan.')) return;
      await putJSON(`${syncUrl}-base.json`, await seal(b));
      lsSet(BASE_KEY, JSON.stringify(b));
      applyBase(b); header(); render(); toast('Plan actualizado');
    } catch (e) { toast('No se pudo cargar ese plan'); }
  }

  // La primera vez preguntamos de quién es el móvil (para «quién pagó» y firmar el diario).
  function askWho() {
    if (me || !PEOPLE.length || lsGet('sevilla-me')) return;
    lsSet('sevilla-me', '-');
    openSheet(`<h3>¿De quién es este móvil?</h3>
      <p class="sheet-p">Así sabemos quién paga cada gasto y quién apunta cada momento.</p>
      <div class="sheet-actions">${PEOPLE.map((p) => `<button class="btn primary" value="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <button class="btn ghost" value="cancel" formnovalidate>Ahora no</button>`, (f, v) => { me = v; lsSet('sevilla-me', me); });
  }

  window.addEventListener('online', () => { if (syncUrl && (!es || es.readyState === 2)) connect(); else flush(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !syncUrl) return;
    if (!es || es.readyState === 2) connect();
    syncBase(true);
  });

  if (!canCrypt) showLock('Este navegador no permite cifrar. Abrid la web en Safari o Chrome.');
  else if (lsGet(TKEY)) {
    const raw = lsGet(TKEY);
    Promise.all([importKey(raw), roomFor(raw)]).then(([k, room]) => start(k, room, null)).catch(() => showLock());
  } else showLock();
  // Refresca "Ahora / Siguiente" mientras la app está abierta.
  setInterval(() => { if (syncUrl && tab === 'plan' && !sheet.open && selDay === today) render(); }, 60000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
