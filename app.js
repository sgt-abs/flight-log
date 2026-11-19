(function () {
  'use strict';

  const KEY = 'flightlog.v1';
  const KM_PER_MI = 1.609344;
  const EARTH_KM = 6371;
  const $ = (s, r = document) => r.querySelector(s);

  // ---------- reference data ----------
  const airports = {};
  for (const [iata, name, city, country, lat, lon, tz] of window.AIRPORTS) {
    airports[iata] = { iata, name, city, country, lat, lon, tz };
  }
  $('#airportList').innerHTML = window.AIRPORTS
    .map(a => `<option value="${a[0]}">${esc(a[2])} – ${esc(a[1])}</option>`).join('');
  $('#airlineList').innerHTML = window.AIRLINES
    .map(a => `<option value="${esc(a[1])}"></option>`).join('');

  // ---------- storage ----------
  let flights = load();
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(flights)); }
    catch (e) { alert('Could not save to this browser. Use Export to keep a backup.'); }
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function code(v) {
    const m = String(v).trim().toUpperCase().match(/[A-Z]{3}/);
    return m ? m[0] : '';
  }
  function haversineKm(a, b) {
    const r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
  }
  function distKm(f) {
    const a = airports[f.from], b = airports[f.to];
    return a && b ? haversineKm(a, b) : 0;
  }
  function hours(f) {
    if (f.duration) {
      const [h, m] = f.duration.split(':').map(Number);
      return h + m / 60;
    }
    const d = distKm(f);
    return d ? d / 800 + 0.5 : 0;
  }
  function fmtDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  }
  const nf = n => Math.round(n).toLocaleString();
  const sorted = () => [...flights].sort((a, b) => b.date.localeCompare(a.date));

  // ---------- flights tab ----------
  function renderFlights() {
    const el = $('#tab-flights');
    if (!flights.length) {
      el.innerHTML = '<div class="empty">No flights yet.<br>Tap <b>+</b> to log your first one.</div>';
      return;
    }
    let html = '', year = '';
    for (const f of sorted()) {
      const y = f.date.slice(0, 4);
      if (y !== year) { year = y; html += `<div class="year">${y}</div>`; }
      const a = airports[f.from], b = airports[f.to];
      const km = distKm(f);
      html += `<div class="card flight" data-id="${esc(f.id)}">
        <div class="route"><span>${esc(f.from)}</span><span class="arrow">✈</span><span>${esc(f.to)}</span></div>
        <div class="cities"><span>${esc(a ? a.city : '')}</span><span>${esc(b ? b.city : '')}</span></div>
        <div class="meta">
          <span>${fmtDate(f.date)}</span>
          ${f.flightNo ? `<span><b>${esc(f.flightNo)}</b></span>` : ''}
          ${f.airline ? `<span>${esc(f.airline)}</span>` : ''}
          ${f.seat ? `<span>Seat <span class="badge">${esc(f.seat)}</span>${f.seatType ? ' ' + esc(f.seatType) : ''}</span>` : ''}
          ${f.cabin && f.cabin !== 'Economy' ? `<span>${esc(f.cabin)}</span>` : ''}
          ${f.aircraft ? `<span>${esc(f.aircraft)}</span>` : ''}
          ${km ? `<span>${nf(km / KM_PER_MI)} mi</span>` : ''}
        </div>
        ${f.notes ? `<div class="meta">${esc(f.notes)}</div>` : ''}
      </div>`;
    }
    el.innerHTML = html;
  }

  // ---------- stats tab ----------
  function tally(list) {
    const m = {};
    for (const x of list) if (x) m[x] = (m[x] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }
  function bars(title, rows, max = 6) {
    if (!rows.length) return '';
    rows = rows.slice(0, max);
    const top = rows[0][1];
    return `<div class="card"><h3>${title}</h3>${rows.map(([k, n]) =>
      `<div class="bar"><span class="lbl">${esc(k)}</span><span class="track"><span class="fill" style="width:${(n / top) * 100}%;display:block"></span></span><span class="n">${n}</span></div>`).join('')}</div>`;
  }
  function renderStats() {
    const el = $('#tab-stats');
    const tools = `<div class="tools"><button id="exportBtn">Export backup</button><button id="importBtn">Import backup</button></div>`;
    if (!flights.length) { el.innerHTML = '<div class="empty">Stats will show up once you log a flight.</div>' + tools; return; }
    const km = flights.reduce((s, f) => s + distKm(f), 0);
    const hrs = flights.reduce((s, f) => s + hours(f), 0);
    const ports = new Set(), countries = new Set();
    for (const f of flights) for (const c of [f.from, f.to]) {
      if (airports[c]) { ports.add(c); countries.add(airports[c].country); }
    }
    const airlines = new Set(flights.map(f => f.airline).filter(Boolean));
    const longest = flights.reduce((m, f) => distKm(f) > distKm(m) ? f : m, flights[0]);
    const tiles = [
      [flights.length, 'flights'],
      [nf(km / KM_PER_MI), 'miles (' + nf(km) + ' km)'],
      ['~' + hrs.toFixed(1), 'hours in the air'],
      [(km / 40075).toFixed(2) + '×', 'around the world'],
      [ports.size, 'airports'],
      [countries.size, 'countries'],
      [airlines.size, 'airlines'],
      [longest.from + '→' + longest.to, 'longest (' + nf(distKm(longest) / KM_PER_MI) + ' mi)'],
    ];
    const routes = tally(flights.map(f => [f.from, f.to].sort().join(' ↔ ')));
    const visits = tally(flights.flatMap(f => [f.from, f.to]));
    el.innerHTML =
      `<div class="tiles">${tiles.map(([v, l]) => `<div class="tile"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('')}</div>` +
      bars('Seat type', tally(flights.map(f => f.seatType))) +
      bars('Cabin', tally(flights.map(f => f.cabin))) +
      bars('Top airlines', tally(flights.map(f => f.airline))) +
      bars('Aircraft flown', tally(flights.map(f => f.aircraft))) +
      bars('Top routes', routes) +
      bars('Most visited airports', visits) +
      bars('Flights per year', tally(flights.map(f => f.date.slice(0, 4))).sort((a, b) => b[0].localeCompare(a[0])), 12) +
      tools +
      '<p style="color:var(--muted);font-size:13px">Distances are great-circle. Hours use your entered duration, otherwise an estimate (~).</p>';
  }

  // ---------- map tab ----------
  const X = lon => (lon + 180) * 2, Y = lat => (90 - lat) * 2;
  function arcPaths(a, b) {
    const r = Math.PI / 180;
    const v = p => [Math.cos(p.lat * r) * Math.cos(p.lon * r), Math.cos(p.lat * r) * Math.sin(p.lon * r), Math.sin(p.lat * r)];
    const A = v(a), B = v(b);
    const dot = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
    const w = Math.acos(dot);
    const N = Math.max(2, Math.ceil(w * 30));
    const segs = []; let cur = [], prevLon = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const s1 = w < 1e-6 ? 1 - t : Math.sin((1 - t) * w) / Math.sin(w);
      const s2 = w < 1e-6 ? t : Math.sin(t * w) / Math.sin(w);
      const x = s1 * A[0] + s2 * B[0], y = s1 * A[1] + s2 * B[1], z = s1 * A[2] + s2 * B[2];
      const lat = Math.atan2(z, Math.hypot(x, y)) / r, lon = Math.atan2(y, x) / r;
      if (prevLon !== null && Math.abs(lon - prevLon) > 180) { segs.push(cur); cur = []; }
      cur.push([X(lon), Y(lat)]); prevLon = lon;
    }
    segs.push(cur);
    return segs.map(s => 'M' + s.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L')).join('');
  }
  let year = 'all';
  function renderMap() {
    const years = [...new Set(flights.map(f => f.date.slice(0, 4)))].sort().reverse();
    if (year !== 'all' && !years.includes(year)) year = 'all';
    const list = year === 'all' ? flights : flights.filter(f => f.date.startsWith(year));
    const land = window.LAND.map(poly => 'M' + poly.map(p => X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('L') + 'Z').join('');
    const seenRoutes = new Set(), arcs = [];
    const ports = new Set();
    for (const f of list) {
      const a = airports[f.from], b = airports[f.to];
      if (!a || !b) continue;
      ports.add(f.from); ports.add(f.to);
      const k = [f.from, f.to].sort().join('-');
      if (seenRoutes.has(k)) continue;
      seenRoutes.add(k);
      arcs.push(`<path class="arc" d="${arcPaths(a, b)}"/>`);
    }
    const dots = [...ports].map(c => {
      const a = airports[c];
      return `<circle class="dot" cx="${X(a.lon)}" cy="${Y(a.lat)}" r="2.6"/><text x="${X(a.lon) + 4}" y="${Y(a.lat) - 3}">${c}</text>`;
    }).join('');
    const chips = ['all', ...years].map(y =>
      `<button class="chip${y === year ? ' on' : ''}" data-year="${y}">${y === 'all' ? 'All-Time' : y}</button>`).join('');
    let summary = '';
    if (list.length) {
      const km = list.reduce((s, f) => s + distKm(f), 0);
      const hrs = list.reduce((s, f) => s + hours(f), 0);
      const ap = new Set(), co = new Set();
      for (const f of list) for (const c of [f.from, f.to]) if (airports[c]) { ap.add(c); co.add(airports[c].country); }
      const al = new Set(list.map(f => f.airline).filter(Boolean));
      const hm = '~' + Math.floor(hrs) + 'h ' + String(Math.round((hrs % 1) * 60)).padStart(2, '0') + 'm';
      const ac = tally(list.map(f => f.aircraft))[0];
      summary = `<div class="card passport">
          <div class="ptitle">${year === 'all' ? 'ALL-TIME' : year} FLIGHT SUMMARY</div>
          <div class="pgrid">
            <div><span class="pl">FLIGHTS</span><span class="pv">${list.length}</span></div>
            <div><span class="pl">DISTANCE</span><span class="pv">${nf(km)} km</span><span class="ps">${(km / 40075).toFixed(1)}× around the world</span></div>
            <div><span class="pl">FLIGHT TIME</span><span class="pv">${hm}</span></div>
            <div><span class="pl">AIRPORTS</span><span class="pv">${ap.size}</span></div>
            <div><span class="pl">AIRLINES</span><span class="pv">${al.size}</span></div>
            <div><span class="pl">COUNTRIES</span><span class="pv">${co.size}</span></div>
          </div></div>` +
        (ac ? `<div class="card"><div class="pl">MOST FLOWN AIRCRAFT</div><div class="pv">${esc(ac[0])}</div><div class="ps">${ac[1]} flight${ac[1] > 1 ? 's' : ''}</div></div>` : '');
    }
    $('#tab-map').innerHTML = (years.length ? `<div class="chips">${chips}</div>` : '') +
      `<div id="mapWrap"><svg viewBox="0 20 720 280" role="img" aria-label="Map of your flights">
      <path class="land" d="${land}"/>${arcs.join('')}${dots}</svg></div>` + summary +
      (flights.length ? '' : '<div class="empty">Your routes will be drawn here.</div>');
  }
  $('#tab-map').addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (c) { year = c.dataset.year; renderMap(); }
  });

  // ---------- tabs ----------
  let tab = 'flights';
  function show(name) {
    tab = name;
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === name);
    for (const t of ['flights', 'stats', 'map']) $('#tab-' + t).hidden = t !== name;
    render();
  }
  function render() {
    if (tab === 'flights') renderFlights();
    else if (tab === 'stats') renderStats();
    else renderMap();
  }
  $('#tabs').addEventListener('click', e => { if (e.target.dataset.tab) show(e.target.dataset.tab); });

  // ---------- add / edit dialog ----------
  const dlg = $('#dlg'), form = $('#form');
  let editingId = null;
  function openForm(id) {
    editingId = id || null;
    form.reset(); $('#formErr').hidden = true; $('#durHint').textContent = '';
    $('#dlgTitle').textContent = id ? 'Edit flight' : 'Add flight';
    $('#delBtn').hidden = !id;
    if (id) {
      const f = flights.find(x => x.id === id);
      for (const [k, v] of Object.entries(f)) if (form.elements[k]) form.elements[k].value = v;
    } else {
      form.elements.date.value = new Date().toISOString().slice(0, 10);
    }
    dlg.showModal();
  }
  // UTC ms for a local wall-clock time in an IANA time zone (two passes handle DST shifts)
  function utcFromLocal(tz, y, mo, d, h, mi) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    const offset = t => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value]));
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t;
    };
    const wall = Date.UTC(y, mo - 1, d, h, mi);
    return wall - offset(wall - offset(wall));
  }
  function autoDuration() {
    const e = form.elements, hint = $('#durHint');
    hint.textContent = '';
    const a = airports[code(e.from.value)], b = airports[code(e.to.value)];
    if (!e.date.value || !e.depTime.value || !e.arrTime.value || !a || !b) return;
    if (!a.tz || !b.tz) { hint.textContent = 'No time zone data for these airports; enter the duration manually.'; return; }
    const [y, m, d] = e.date.value.split('-').map(Number);
    const [dh, dn] = e.depTime.value.split(':').map(Number);
    const [ah, an] = e.arrTime.value.split(':').map(Number);
    const dep = utcFromLocal(a.tz, y, m, d, dh, dn);
    const [ay, am, ad] = (e.arrDate.value || e.date.value).split('-').map(Number);
    let mins = (utcFromLocal(b.tz, ay, am, ad, ah, an) - dep) / 60000;
    if (mins <= 0 && !e.arrDate.value) {
      mins += 1440;
      hint.textContent = 'Assumed arrival the next day.';
    }
    if (mins <= 0 || mins > 40 * 60) { hint.textContent = 'Check the times and arrival date; the result is not a valid duration.'; return; }
    e.duration.value = Math.floor(mins / 60) + ':' + String(Math.round(mins % 60)).padStart(2, '0');
    hint.textContent = (hint.textContent + ' Duration calculated from local times.').trim();
  }
  form.addEventListener('input', e => { if (e.target.name !== 'duration') autoDuration(); });

  $('#addBtn').addEventListener('click', () => openForm());
  $('#cancelBtn').addEventListener('click', () => dlg.close());
  $('#tab-flights').addEventListener('click', e => {
    const c = e.target.closest('.flight');
    if (c) openForm(c.dataset.id);
  });
  $('#delBtn').addEventListener('click', () => {
    if (editingId && confirm('Delete this flight? This cannot be undone.')) {
      flights = flights.filter(f => f.id !== editingId);
      save(); dlg.close(); render();
    }
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    d.from = code(d.from); d.to = code(d.to);
    d.seat = d.seat.trim().toUpperCase();
    const err = $('#formErr');
    if (!airports[d.from] || !airports[d.to]) {
      err.textContent = 'Please enter valid 3-letter airport codes (e.g. SFO). Pick from the suggestions.';
      err.hidden = false; return;
    }
    if (d.from === d.to) { err.textContent = 'From and To must be different.'; err.hidden = false; return; }
    for (const k of Object.keys(d)) d[k] = typeof d[k] === 'string' ? d[k].trim() : d[k];
    if (editingId) {
      const i = flights.findIndex(f => f.id === editingId);
      flights[i] = { ...d, id: editingId };
    } else {
      flights.push({ ...d, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
    }
    save(); dlg.close(); render();
  });

  // ---------- backup ----------
  document.addEventListener('click', e => {
    if (e.target.id === 'exportBtn') {
      const blob = new Blob([JSON.stringify(flights, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'flight-log-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click(); URL.revokeObjectURL(a.href);
    }
    if (e.target.id === 'importBtn') {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = async () => {
        try {
          const data = JSON.parse(await inp.files[0].text());
          if (!Array.isArray(data)) throw new Error();
          const ids = new Set(flights.map(f => f.id));
          let added = 0;
          for (const f of data) {
            if (f && f.id && f.date && airports[f.from] && airports[f.to] && !ids.has(f.id)) { flights.push(f); added++; }
          }
          save(); render(); alert('Imported ' + added + ' flight(s).');
        } catch (err) { alert('That file is not a valid flight log backup.'); }
      };
      inp.click();
    }
  });

  show('flights');

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
