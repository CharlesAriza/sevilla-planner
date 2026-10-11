/* Planificador del viaje a Sevilla. Sin dependencias: todo se guarda en el propio móvil. */
(() => {
  'use strict';

  const KEY = 'sevilla-2026';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------- Estado ----------
  const blank = () => ({ done: {}, notes: {}, times: {}, hidden: {}, custom: [], resv: {}, journal: [], expenses: [] });
  let state = blank();
  try { state = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* estado vacío */ }
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast('No se pudo guardar en este móvil'); }
  };

  // ?now=2026-11-08T16:00 permite simular una fecha para probar.
  const fakeNow = new URLSearchParams(location.search).get('now');
  const now = () => (fakeNow ? new Date(fakeNow) : new Date());
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const mins = (t) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
  const fmtDur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) : ''}` : `${m} min`);
  const euro = (n) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const dayOf = (date) => DAYS.find((d) => d.date === date);

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
      const blob = await idb('readonly', (s) => s.get(id));
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
    const base = day.items.filter((it) => !state.hidden[it.id]).map((it) => {
      const o = state.times[it.id];
      const start = o ? o.start : it.start;
      const end = o ? o.end : it.end;
      const key = mins(start) ?? prev + 0.1;
      prev = key;
      return { ...it, start, end, approx: o ? false : it.approx, key };
    });
    const custom = state.custom.filter((c) => c.date === day.date).map((c) => ({ ...c, kind: 'custom', custom: true, key: mins(c.start) ?? 9999 }));
    return [...base, ...custom].sort((a, b) => a.key - b.key);
  }

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

  function viewPlan() {
    const day = dayOf(selDay);
    const items = itemsFor(day);
    const { cur, next } = nowNext(day, items);
    const nDone = items.filter((i) => state.done[i.id]).length;
    const hidden = day.items.filter((it) => state.hidden[it.id]).length;

    const li = items.map((it) => {
      const isDone = !!state.done[it.id];
      const isOpen = open.has(it.id);
      const meta = [it.zone, it.move, it.dur && fmtDur(it.dur), it.food].filter(Boolean).map(esc);
      const badges = [
        it.id === cur && '<span class="badge now">Ahora</span>',
        it.id === next && !cur && '<span class="badge now">Siguiente</span>',
        it.prio === 'A' && '<span class="badge a">Imprescindible</span>',
        it.prio === 'B' && '<span class="badge b">Recomendable</span>',
        it.prio === 'C' && '<span class="badge">Opcional</span>',
        it.custom && '<span class="badge">Añadido</span>',
        resvBadge(it.resv),
      ].filter(Boolean);
      const my = state.notes[it.id];
      return `
      <li class="item k-${it.kind} ${isDone ? 'done' : ''} ${it.id === cur ? 'is-now' : ''}">
        <div class="item-time">${it.start
          ? `<b>${it.approx ? '~' : ''}${esc(it.start)}</b>${it.end ? `<small>${esc(it.end)}</small>` : ''}`
          : '<span class="tbd">hora por decidir</span>'}</div>
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
              ${it.map ? `<a class="btn primary" target="_blank" rel="noopener" href="${dirUrl(it.map)}">Cómo llegar</a>` : ''}
              ${it.web ? `<a class="btn" target="_blank" rel="noopener" href="${esc(it.web)}">Web oficial</a>` : ''}
              <button class="btn" data-act="edit" data-id="${it.id}">Hora y nota</button>
            </div>
          </div>` : ''}
        </div>
      </li>`;
    }).join('');

    return `${dayChips()}
      <div class="day-head">
        <h2>${esc(day.name)} · ${esc(day.title)}</h2>
        <p>${esc(day.summary)} Ritmo: ${esc(day.pace.toLowerCase())}.</p>
        <div class="progress"><i style="width:${items.length ? (nDone / items.length) * 100 : 0}%"></i></div>
        <div class="progress-label"><span>${nDone} de ${items.length} hechas</span><span>~ = hora orientativa</span></div>
      </div>
      <ul class="timeline">${li}</ul>
      <div class="add-row">
        <button class="btn ghost block" data-act="add">+ Añadir a este día</button>
        ${hidden ? `<button class="btn ghost block" style="margin-top:8px" data-act="restore">Recuperar ${hidden} actividad${hidden > 1 ? 'es' : ''} quitada${hidden > 1 ? 's' : ''}</button>` : ''}
      </div>`;
  }

  // ---------- Reservas ----------
  const resvState = (b) => (state.resv[b.id] && state.resv[b.id].status) || (b.confirmed ? 'ok' : 'todo');
  const RESV_LABEL = { todo: 'Pendiente', ok: 'Hecha', skip: 'No vamos' };

  function viewResv() {
    const need = BOOKINGS.filter((b) => resvState(b) !== 'skip');
    const ok = need.filter((b) => resvState(b) === 'ok').length;
    let last = '';
    const list = BOOKINGS.map((b) => {
      const st = resvState(b);
      const d = dayOf(b.date);
      const head = b.date !== last ? `<div class="section-title">${esc(d.name)}</div>` : '';
      last = b.date;
      const extra = state.resv[b.id] || {};
      return `${head}
      <div class="panel">
        <div class="row">
          <div>
            <h3>${esc(b.title)}</h3>
            <div class="sub">${esc(b.time)} · ${esc(b.prio)}</div>
          </div>
          <button class="state-btn ${st === 'todo' ? '' : st}" data-act="resv" data-id="${b.id}">${RESV_LABEL[st]}</button>
        </div>
        <p class="txt">${esc(b.note)}${b.when && st === 'todo' ? `\nCuándo reservar: ${esc(b.when.toLowerCase())}.` : ''}</p>
        ${extra.code ? `<div class="mynote"><b>Localizador / datos</b>${esc(extra.code)}</div>` : ''}
        <div class="actions">
          ${b.web ? `<a class="btn" target="_blank" rel="noopener" href="${esc(b.web)}">Web oficial</a>` : ''}
          <button class="btn" data-act="resv-edit" data-id="${b.id}">${extra.code ? 'Editar datos' : 'Apuntar localizador'}</button>
        </div>
      </div>`;
    }).join('');
    return `
      <div class="day-head">
        <h2>Reservas y billetes</h2>
        <p>Tocad el estado para cambiarlo: pendiente → hecha${' '}→ no vamos.</p>
        <div class="progress"><i style="width:${(ok / need.length) * 100}%"></i></div>
        <div class="progress-label"><span>${ok} de ${need.length} listas</span><span>${need.length - ok} pendiente${need.length - ok === 1 ? '' : 's'}</span></div>
      </div>${list}`;
  }

  // ---------- Diario ----------
  function viewDiary() {
    const day = dayOf(selDay);
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
      <div class="section-title">Vuestros datos</div>
      <div class="panel">
        <p class="txt" style="margin-top:0">Lo que apuntáis (hechos, notas, diario, fotos, gastos) se guarda solo en este móvil. Para pasarlo a otro móvil o guardar una copia, exportad el archivo e importadlo en el otro.</p>
        <div class="actions">
          <button class="btn" data-act="export">Exportar copia</button>
          <button class="btn" data-act="import">Importar copia</button>
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
    }
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close('cancel'); });
  const sheetButtons = (del) => `<div class="sheet-actions">
    ${del ? `<button class="btn danger" value="delete" formnovalidate>${del}</button>` : ''}
    <button class="btn" value="cancel" formnovalidate>Cancelar</button>
    <button class="btn primary" value="ok">Guardar</button></div>`;
  const dayOptions = (sel, withPre) => (withPre ? `<option value="pre" ${sel === 'pre' ? 'selected' : ''}>Antes del viaje</option>` : '')
    + DAYS.map((d) => `<option value="${d.date}" ${d.date === sel ? 'selected' : ''}>${d.name}</option>`).join('');

  function editItem(id) {
    const day = dayOf(selDay);
    const it = itemsFor(day).find((i) => i.id === id);
    if (!it) return;
    openSheet(`
      <h3>${it.custom ? 'Editar' : esc(it.title)}</h3>
      ${it.custom ? `<label class="f">Qué<input name="title" required value="${esc(it.title)}"></label>` : ''}
      <div class="two">
        <label class="f">Empieza<input type="time" name="start" value="${esc(it.start || '')}"></label>
        <label class="f">Termina<input type="time" name="end" value="${esc(it.end || '')}"></label>
      </div>
      <label class="f">Nuestra nota<textarea name="note" placeholder="Qué tal fue, dónde comimos, localizador…">${esc(state.notes[id] || '')}</textarea></label>
      ${sheetButtons(it.custom ? 'Borrar' : 'Quitar del plan')}`, (f, v) => {
      if (v === 'delete') {
        if (it.custom) state.custom = state.custom.filter((c) => c.id !== id); else state.hidden[id] = true;
        delete state.done[id];
        toast(it.custom ? 'Borrado' : 'Quitado del plan (se puede recuperar abajo)');
        return;
      }
      if (f.note.trim()) state.notes[id] = f.note.trim(); else delete state.notes[id];
      if (it.custom) {
        const c = state.custom.find((x) => x.id === id);
        Object.assign(c, { title: f.title.trim(), start: f.start, end: f.end });
      } else {
        const base = day.items.find((x) => x.id === id);
        if (f.start === (base.start || '') && f.end === (base.end || '')) delete state.times[id];
        else state.times[id] = { start: f.start, end: f.end };
      }
    });
  }

  function addItem() {
    openSheet(`
      <h3>Añadir al plan</h3>
      <label class="f">Qué<input name="title" required placeholder="Tapas en…, compras, descanso…"></label>
      <label class="f">Día<select name="date">${dayOptions(selDay)}</select></label>
      <div class="two">
        <label class="f">Empieza<input type="time" name="start"></label>
        <label class="f">Termina<input type="time" name="end"></label>
      </div>
      <label class="f">Nota (opcional)<textarea name="note"></textarea></label>
      ${sheetButtons()}`, (f) => {
      state.custom.push({ id: 'c' + uid(), date: f.date, title: f.title.trim(), start: f.start, end: f.end, note: f.note.trim() });
      selDay = f.date;
    });
  }

  function editResv(id) {
    const b = BOOKINGS.find((x) => x.id === id);
    const cur = state.resv[id] || {};
    openSheet(`
      <h3>${esc(b.title)}</h3>
      <label class="f">Localizador, hora exacta, sitio…<textarea name="code" placeholder="Ej.: entrada 15:00 · localizador ABC123">${esc(cur.code || '')}</textarea></label>
      <label class="f">Estado<select name="status">
        ${['todo', 'ok', 'skip'].map((s) => `<option value="${s}" ${resvState(b) === s ? 'selected' : ''}>${RESV_LABEL[s]}</option>`).join('')}
      </select></label>
      ${sheetButtons()}`, (f) => { state.resv[id] = { status: f.status, code: f.code.trim() }; });
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
          photo = photo || 'f' + uid();
          urls.delete(photo);
          await idb('readwrite', (s) => s.put(blob, photo));
        } catch (err) { toast('No se pudo guardar la foto'); }
      }
      if (!f.place.trim() && !f.text.trim() && !photo) return;
      const entry = { id: e ? e.id : 'j' + uid(), date: selDay, ts: `${selDay}T${f.time || '12:00'}:00`, place: f.place.trim(), text: f.text.trim(), stars: +f.stars, photo };
      if (e) Object.assign(e, entry); else state.journal.push(entry);
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
      case 'edit': editItem(id); break;
      case 'add': addItem(); break;
      case 'restore': dayOf(selDay).items.forEach((it) => delete state.hidden[it.id]); save(); render(); break;
      case 'resv': {
        const b = BOOKINGS.find((x) => x.id === id);
        const order = b.optional ? ['todo', 'ok', 'skip'] : ['todo', 'ok'];
        const nxt = order[(order.indexOf(resvState(b)) + 1) % order.length];
        state.resv[id] = { ...(state.resv[id] || {}), status: nxt };
        save(); render(); break;
      }
      case 'resv-edit': editResv(id); break;
      case 'j-add': editJournal(); break;
      case 'j-edit': editJournal(id); break;
      case 'e-add': addExpense(); break;
      case 'e-del': state.expenses = state.expenses.filter((x) => x.id !== id); save(); render(); break;
      case 'export': exportAll(); break;
      case 'import': $('#importFile').click(); break;
      case 'wipe':
        if (confirm('¿Borrar todo lo apuntado en este móvil? No se puede deshacer.')) {
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
  render();
  // Refresca "Ahora / Siguiente" mientras la app está abierta.
  setInterval(() => { if (tab === 'plan' && !sheet.open && selDay === today) render(); }, 60000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
