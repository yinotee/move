'use strict';
// ---------- aggregates ----------
function windowAgg(list, from, to) {
  const ss = list.filter(s => s.date >= from && s.date <= to);
  const done = ss.filter(s => !needsDetails(s));
  return {
    n: ss.length, min: ss.reduce((a, s) => a + mins(s), 0), load: ss.reduce((a, s) => a + load(s), 0),
    rpe: mean(done.map(s => s.rpe)), perf: mean(ss.map(s => s.perf).filter(x => x > 0)),
  };
}
const delta = (c, p, fmt = v => v) => p ? `${c >= p ? '+' : '−'}${Math.abs(Math.round((c - p) / p * 100))}% vs prior` : `prior: ${fmt(0)}`;

// One entry per exercise name with one point per session, oldest first
function exerciseIndex() {
  const map = new Map();
  const gym = bySport('gym').slice().sort((a, b) => a.date.localeCompare(b.date));
  for (const s of gym) {
    const merged = new Map();
    for (const ex of normEx(s)) {
      const k = exKey(ex.name); if (!k) continue;
      if (!merged.has(k)) merged.set(k, { name: ex.name.trim(), sets: [] });
      merged.get(k).sets.push(...ex.sets.filter(st => st.reps > 0));
    }
    for (const [k, ex] of merged) {
      if (!ex.sets.length) continue;
      const top = ex.sets.reduce((a, b) => (b.kg > a.kg || (b.kg === a.kg && b.reps > a.reps)) ? b : a);
      const e1 = ex.sets.filter(st => st.kg > 0 && st.reps <= 12).map(st => epley(st.kg, st.reps));
      const pt = {
        date: s.date, id: s.id, sets: ex.sets, top,
        e1rm: e1.length ? Math.max(...e1) : null,
        vol: ex.sets.reduce((a, st) => a + st.kg * st.reps, 0),
        maxReps: Math.max(...ex.sets.map(st => st.reps)),
        totReps: ex.sets.reduce((a, st) => a + st.reps, 0),
      };
      if (!map.has(k)) map.set(k, { key: k, name: ex.name, points: [] });
      const entry = map.get(k); entry.name = ex.name; entry.points.push(pt);
    }
  }
  return [...map.values()].map(e => ({ ...e, weighted: e.points.some(p => p.top.kg > 0), last: e.points[e.points.length - 1] }))
    .sort((a, b) => b.last.date.localeCompare(a.last.date));
}

// ---------- charts ----------
// Weekly bars; with sport = null the bars stack every sport
function weeklyChart(sport, weeks) {
  const mon = mondayOf(new Date());
  const ws = Array.from({ length: weeks }, (_, i) => ({ start: new Date(mon.getTime() - (weeks - 1 - i) * 7 * DAY), by: {}, total: 0 }));
  const idx = Object.fromEntries(ws.map((w, i) => [iso(w.start), i]));
  for (const s of sport ? bySport(sport) : state.sessions) {
    const i = idx[iso(mondayOf(parseD(s.date)))]; if (i === undefined) continue;
    const v = state.metric === 'load' ? load(s) : mins(s) / 60;
    ws[i].by[s.sport] = (ws[i].by[s.sport] || 0) + v; ws[i].total += v;
  }
  const max = Math.max(...ws.map(w => w.total));
  const step = niceStep((max || (state.metric === 'load' ? 1000 : 4)) / 4);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const W = 640, H = 230, ml = 46, mr = 8, mt = 16, mb = 28, pw = W - ml - mr, ph = H - mt - mb;
  const y = v => mt + ph - v / top * ph, slot = pw / weeks, bw = Math.min(42, slot * 0.62);
  // hours axis: below 2 h label in minutes so a 0.25 h step is not rounded to a misleading 0.3h
  const fmt = v => state.metric === 'load' ? (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${v}`) : top <= 2 ? `${Math.round(v * 60)}m` : `${+v.toFixed(2)}h`;
  let g = '';
  for (let t = 0; t <= top + 1e-9; t += step) g += `<line class="grid" x1="${ml}" x2="${W - mr}" y1="${y(t)}" y2="${y(t)}"/><text x="${ml - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
  const every = weeks > 8 ? 2 : 1;
  ws.forEach((w, i) => {
    const x = ml + i * slot + (slot - bw) / 2;
    let acc = 0;
    for (const s of SPORTS) {
      const v = w.by[s.id]; if (!v) continue;
      const h = v / top * ph;
      g += `<rect x="${x}" y="${y(acc) - h}" width="${bw}" height="${Math.max(h - 1, 0.5)}" fill="var(--c-${s.id})" rx="2"><title>${s.label}: ${state.metric === 'load' ? fmtNum(v) + ' AU' : fmtDur(v * 60)}</title></rect>`;
      acc += v;
    }
    if (w.total) g += `<text x="${x + bw / 2}" y="${y(w.total) - 5}" text-anchor="middle" style="fill:var(--fg)">${state.metric === 'load' ? fmtNum(w.total) : +w.total.toFixed(1)}</text>`;
    if ((weeks - 1 - i) % every === 0) g += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${i === weeks - 1 ? 'This wk' : short(w.start)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly ${state.metric === 'load' ? 'load' : 'hours'}, last ${weeks} weeks">${g}</svg>`;
}
const metricToggle = () => `<div class="toggle" role="group" aria-label="Metric">
  <button type="button" data-metric="hours" aria-pressed="${state.metric === 'hours'}">Hours</button>
  <button type="button" data-metric="load" aria-pressed="${state.metric === 'load'}">Load</button></div>`;

function heatmap() {
  const WK = 17, today = today0(), start = new Date(mondayOf(today).getTime() - (WK - 1) * 7 * DAY);
  const days = {};
  for (const s of state.sessions) {
    const d = days[s.date] || (days[s.date] = { min: 0, by: {} });
    // a session without a recorded time still marks the day as trained (weight 1 for picking the colour)
    d.min += mins(s); d.by[s.sport] = (d.by[s.sport] || 0) + Math.max(mins(s), 1);
  }
  const C = 14, G = 3, L = 30, T = 18, W = L + WK * (C + G), H = T + 7 * (C + G);
  let g = '', lastMonth = -1;
  ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].forEach((t, r) => { if (t) g += `<text x="0" y="${T + r * (C + G) + 11}">${t}</text>`; });
  for (let w = 0; w < WK; w++) {
    const col = new Date(start.getTime() + w * 7 * DAY);
    if (col.getMonth() !== lastMonth) { lastMonth = col.getMonth(); g += `<text x="${L + w * (C + G)}" y="11">${MON[lastMonth]}</text>`; }
    for (let r = 0; r < 7; r++) {
      const d = new Date(col.getTime() + r * DAY); if (d > today) continue;
      const k = iso(d), info = days[k], x = L + w * (C + G), yy = T + r * (C + G);
      if (!info) { g += `<rect x="${x}" y="${yy}" width="${C}" height="${C}" rx="3" fill="var(--soft)"><title>${k}: rest</title></rect>`; continue; }
      const main = Object.entries(info.by).sort((a, b) => b[1] - a[1])[0][0];
      const op = info.min >= 120 ? 1 : info.min >= 75 ? 0.75 : 0.45;
      const tip = Object.entries(info.by).map(([sp, m]) => `${SP[sp].label} ${m > 1 ? fmtDur(m) : '(time not set)'}`).join(', ');
      g += `<rect x="${x}" y="${yy}" width="${C}" height="${C}" rx="3" fill="var(--c-${main})" fill-opacity="${op}"><title>${k}: ${tip}</title></rect>`;
    }
  }
  return `<div class="scroll"><svg class="chart" style="max-width:${Math.round(W * 1.7)}px" viewBox="0 0 ${W} ${H}" role="img" aria-label="Training days, last 17 weeks">${g}</svg></div>`;
}

// Hardest send per session over time, with a dashed best-to-date step line
function gradeChart(sport) {
  const scale = SP[sport].group === 'route' ? FR : FONT;
  const pts = bySport(sport).filter(s => scale.includes(s.grade))
    .map(s => ({ t: parseD(s.date).getTime(), g: scale.indexOf(s.grade), s })).sort((a, b) => a.t - b.t);
  if (!pts.length) return `<div class="empty">No grades yet. Add a hardest send when you log a session.</div>`;
  const t1 = today0().getTime() + DAY, t0 = Math.min(pts[0].t, t1 - 90 * DAY) - 3 * DAY;
  let g0 = Math.max(0, Math.min(...pts.map(p => p.g)) - 1), g1 = Math.min(scale.length - 1, Math.max(...pts.map(p => p.g)) + 1);
  while (g1 - g0 < 4 && !(g0 === 0 && g1 === scale.length - 1)) { if (g0 > 0) g0--; if (g1 - g0 < 4 && g1 < scale.length - 1) g1++; }
  const W = 560, H = 220, ml = 40, mr = 12, mt = 10, mb = 24, pw = W - ml - mr, ph = H - mt - mb;
  const x = t => ml + (t - t0) / (t1 - t0) * pw, y = gi => mt + ph - (gi - g0) / (g1 - g0) * ph;
  const every = g1 - g0 > 9 ? 2 : 1;
  let s = '';
  for (let gi = g0; gi <= g1; gi += every) s += `<line class="grid" x1="${ml}" x2="${W - mr}" y1="${y(gi)}" y2="${y(gi)}"/><text x="${ml - 6}" y="${y(gi) + 4}" text-anchor="end">${scale[gi]}</text>`;
  s += monthTicks(t0, t1, x, H);
  let best = -1, path = '';
  for (const p of pts) if (p.g > best) { path += best < 0 ? `M${x(p.t)},${y(p.g)}` : `H${x(p.t)}V${y(p.g)}`; best = p.g; }
  path += `H${x(t1 - DAY)}`;
  s += `<path d="${path}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  for (const p of pts) s += `<circle cx="${x(p.t)}" cy="${y(p.g)}" r="4.5" fill="var(--c-${sport})"><title>${p.s.date} · ${p.s.grade}${p.s.gym ? ' · ' + esc(p.s.gym) : ''}</title></circle>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hardest send per session over time">${s}</svg>`;
}
function monthTicks(t0, t1, x, H) {
  let s = '';
  const m = new Date(t0); m.setDate(1); m.setMonth(m.getMonth() + 1);
  const months = []; for (; m.getTime() < t1; m.setMonth(m.getMonth() + 1)) months.push(new Date(m));
  const every = Math.ceil(months.length / 8);
  months.forEach((d, i) => { if (i % every === 0) s += `<text x="${x(d.getTime())}" y="${H - 6}" text-anchor="middle">${MON[d.getMonth()]}${d.getMonth() === 0 ? ' ' + String(d.getFullYear()).slice(2) : ''}</text>`; });
  return s;
}

// Horizontal bars: rows = [{label, parts:[{v, color, title}], val}]
function barList(rows, max) {
  const top = max || Math.max(1, ...rows.map(r => r.parts.reduce((a, p) => a + p.v, 0)));
  return `<div class="bars">${rows.map(r => `<div class="bar-row"><span>${r.label}</span>
    <span class="track">${r.parts.map(p => `<i style="width:${(p.v / top * 100).toFixed(1)}%;background:${p.color}" title="${esc(p.title || '')}"></i>`).join('')}</span>
    <span class="val">${r.val}</span></div>`).join('')}</div>`;
}

// ---------- shared row pieces ----------
function detailText(s) {
  const g = SP[s.sport].group, parts = [];
  if (s.source === 'toplogger') {
    if (s.gym) parts.push(s.gym);
    if (s.climbsRemoved) parts.push('climbs since removed from the wall');
    else { if (s.grade) parts.push(`best ${s.grade}`); parts.push(`${s.sends} sent`, `${s.flashes} flash`); }
    if (s.tries != null) parts.push(`${s.tries} tries`);
  } else if (g === 'route' || g === 'boulder') {
    if (s.gym) parts.push(s.gym);
    if (s.grade) parts.push(s.grade);
    if (s.count != null) parts.push(`${s.count} ${g === 'route' ? 'routes' : 'tried'}`);
    if (s.sends != null) parts.push(`${s.sends} ${g === 'route' ? 'clean' : 'sent'}`);
    if (s.flashes != null) parts.push(`${s.flashes} flash`);
  } else if (g === 'football') {
    parts.push(s.format === 'match' ? 'Match' : 'Training');
    if (s.goals != null) parts.push(`${s.goals} G`);
    if (s.assists != null) parts.push(`${s.assists} A`);
  } else if (g === 'racket') {
    parts.push({ match: 'Match', lesson: 'Lesson' }[s.format] || 'Practice');
    if (s.format === 'lesson') { if (s.coach) parts.push(`with ${s.coach}`); if (s.lessonFocus) parts.push(s.lessonFocus); }
    else { if (s.result) parts.push(s.result === 'win' ? 'Won' : 'Lost'); if (s.score) parts.push(s.score); }
  } else if (g === 'gym') {
    if (s.focus) parts.push(GYM_FOCUS[s.focus] || s.focus);
    const exs = normEx(s);
    if (exs.length) parts.push(`${exs.length} exercise${exs.length > 1 ? 's' : ''}`, `${exs.reduce((a, e) => a + e.sets.length, 0)} sets`);
  } else if (g === 'yoga') {
    if (s.style) parts.push(YOGA_STYLES.find(x => x.toLowerCase() === s.style) || s.style);
    if (s.setting) parts.push(YOGA_WHERE[s.setting] || s.setting);
    if (s.instructor) parts.push(s.instructor);
    if (s.yogaFocus) parts.push(s.yogaFocus);
  }
  return parts.join(' · ');
}
function climbChips(s) {
  if (!Array.isArray(s.climbs) || !s.climbs.length) return '';
  return `<div class="climbs">${s.climbs.map(c => {
    const col = /^#[0-9a-f]{3,8}$/i.test(c.color || '') ? c.color : 'transparent';
    const inner = `<span class="sw" style="background:${col}"></span>${esc(c.g)}<span class="tk">${c.tick === 'flash' ? '⚡' : '✓'}</span>`;
    const title = `${c.g} ${c.tick}${c.label ? ' · label ' + c.label : ''}`;
    return s.gymSlug && c.id
      ? `<a class="climb ${c.tick}" href="${esc(tlUrl(s, c))}" target="_blank" rel="noopener" title="${esc(title)} · open in TopLogger">${inner}</a>`
      : `<span class="climb ${c.tick}" title="${esc(title)}">${inner}</span>`;
  }).join('')}</div>`;
}
function exerciseRows(s) {
  const exs = normEx(s); if (!exs.length) return '';
  return `<div class="ex-rows">${exs.map(e => `<div class="ex-row"><button type="button" class="ex-link" data-exk="${esc(exKey(e.name))}">${esc(e.name)}</button><span class="mono">${esc(setsText(e.sets))}</span></div>`).join('')}</div>`;
}
function videoChips(s) {
  if (SP[s.sport].group !== 'racket') return '';
  const vs = Array.isArray(s.videos) ? s.videos : [];
  const chips = vs.map((v, i) => `<button type="button" class="vchip" data-vid="${esc(s.id)}" data-vi="${i}" aria-label="Review video ${i + 1}">▶ ${fmtClock(v.duration)}${v.notes?.length ? ` · ${v.notes.length} note${v.notes.length > 1 ? 's' : ''}` : ''}</button>`).join('');
  return `<div class="climbs">${chips}<button type="button" class="vchip add" data-vadd="${esc(s.id)}">+ Video</button></div>`;
}
function checkLine(s) {
  const c = state.checks[s.date];
  if (c) return `<div class="check-line"><button type="button" class="ex-link" data-check="${s.date}" title="Edit next-day check">Next day</button>
      <span>Hooper <b>${c.hooper}</b></span>${HOOPER.map(q => `<span>${q.label.split(' ')[0].toLowerCase()} <b>${c[q.k]}</b></span>`).join('')}
      ${c.areas?.length ? `<span>${esc(c.areas.join(', ').toLowerCase())}</span>` : ''}${c.pain ? '<span class="warn">pain</span>' : ''}</div>`;
  // offer the check only for the past week; older days are too far back to recall reliably
  if (s.date >= todayIso() || s.date < daysAgo(7)) return '';
  return `<div class="climbs"><button type="button" class="vchip add" data-check="${s.date}">+ Next-day check</button></div>`;
}
function historyRow(s, showSport) {
  const d = parseD(s.date);
  const dt = detailText(s);
  return `<li>
    <div class="date">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${short(d)}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}</div>
    <div class="main">
      <div class="top">${showSport ? `<span class="pill" style="--dot:var(--c-${s.sport})">${SP[s.sport].label}</span>` : ''}
        ${needsDetails(s) ? '<span class="tag todo">Add time &amp; effort</span>' : `<span class="meta">${fmtDur(s.minutes)} · RPE ${s.rpe} · perf ${s.perf || '—'}/5 · ${fmtNum(load(s))} AU</span>`}
        ${s.source === 'toplogger' ? '<span class="tag">TopLogger</span>' : ''}</div>
      ${dt ? `<div class="detail">${esc(dt)}</div>` : ''}
      ${climbChips(s)}${s.sport === 'gym' ? exerciseRows(s) : ''}${videoChips(s)}${checkLine(s)}
      ${s.notes ? `<div class="notes">${esc(s.notes)}</div>` : ''}
    </div>
    <div class="actions"><button type="button" data-edit="${esc(s.id)}">${needsDetails(s) ? 'Complete' : 'Edit'}</button><button type="button" data-del="${esc(s.id)}" aria-label="Delete session on ${s.date}">Delete</button></div>
  </li>`;
}
function historySection(list, title, showSport, withFilters) {
  const hasTodo = list.some(needsDetails);
  if (state.filter === 'todo' && !hasTodo) state.filter = 'all';
  const shown = state.filter === 'todo' ? list.filter(needsDetails) : list;
  return `<section aria-labelledby="h-hist">
    <div class="sec-head"><h2 id="h-hist">${title}</h2>${hasTodo && withFilters ? `<div class="filters" role="group" aria-label="Filter">
      <button type="button" data-f="all" aria-pressed="${state.filter === 'all'}">All</button>
      <button type="button" data-f="todo" aria-pressed="${state.filter === 'todo'}">To complete (${list.filter(needsDetails).length})</button></div>` : ''}</div>
    ${shown.length ? `<ul class="hist">${shown.slice(0, state.shown).map(s => historyRow(s, showSport)).join('')}</ul>` : '<div class="empty">No sessions yet.</div>'}
    ${shown.length > state.shown ? '<button type="button" id="more">Show more</button>' : ''}
  </section>`;
}

// ---------- recovery (next-day checks) ----------
function recoverySection() {
  const rows = Object.values(state.checks).sort((a, b) => a.date.localeCompare(b.date));
  let chart = '';
  if (!rows.length) chart = `<div class="empty">No checks yet. The morning after training, rate sleep, fatigue, soreness and stress. Over time this shows which sessions you recover from slowly.</div>`;
  else if (rows.length < 2) chart = `<div class="empty">One check so far. The trend line appears after the second.</div>`;
  else {
    const vals = rows.map(r => r.hooper), n = vals.length, m = mean(vals);
    const sd = Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1));
    const band = n >= 7;
    const W = 560, H = 200, ml = 34, mr = 12, mt = 10, mb = 24, pw = W - ml - mr, ph = H - mt - mb;
    const pts = rows.map(r => ({ r, t: parseD(r.date).getTime() }));
    const t1 = today0().getTime() + DAY, t0 = Math.min(pts[0].t, t1 - 30 * DAY) - DAY;
    const x = t => ml + (t - t0) / (t1 - t0) * pw, y = v => mt + ph - (v - 4) / 24 * ph;
    let s = '';
    if (band) s += `<rect x="${ml}" y="${y(Math.min(28, m + sd))}" width="${pw}" height="${Math.max(0, y(Math.max(4, m - sd)) - y(Math.min(28, m + sd)))}" fill="var(--soft)"/>`;
    for (const v of [4, 10, 16, 22, 28]) s += `<line class="grid" x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}"/><text x="${ml - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    s += monthTicks(t0, t1, x, H);
    s += `<polyline points="${pts.map(p => `${x(p.t)},${y(p.r.hooper)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
    for (const p of pts) {
      const high = band && p.r.hooper > m + sd;
      const tip = `${p.r.date} · Hooper ${p.r.hooper} · sleep ${p.r.sleep}, fatigue ${p.r.fatigue}, soreness ${p.r.doms}, stress ${p.r.stress} · load ${fmtNum(dayLoad(p.r.date))} AU${p.r.pain ? ' · pain' : ''}`;
      s += `<circle cx="${x(p.t)}" cy="${y(p.r.hooper)}" r="${high || p.r.pain ? 5 : 4}" fill="${p.r.pain ? 'var(--danger)' : high ? 'var(--accent)' : 'var(--surface)'}" stroke="${p.r.pain ? 'var(--danger)' : 'var(--accent)'}" stroke-width="2"><title>${esc(tip)}</title></circle>`;
    }
    chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hooper index after each training day">${s}</svg>`;
  }
  const recent = rows.slice(-8).reverse();
  const table = recent.length ? `<div class="scroll"><table><thead><tr><th>Training day</th><th>Sessions</th><th class="n">Load</th><th class="n">Hooper</th><th class="n">Sleep</th><th class="n">Fatigue</th><th class="n">Sore</th><th class="n">Stress</th><th>Areas</th></tr></thead><tbody>${recent.map(r => {
    const l = dayLoad(r.date);
    return `<tr><td class="mono">${r.date}</td><td>${state.sessions.filter(s => s.date === r.date).map(s => SP[s.sport].label).join(', ') || '—'}</td><td class="n">${l ? fmtNum(l) : '—'}</td><td class="n"><b>${r.hooper}</b></td>${HOOPER.map(q => `<td class="n">${r[q.k]}</td>`).join('')}<td>${esc((r.areas || []).join(', ')) || '—'}${r.pain ? ' <span class="warn">pain</span>' : ''}</td></tr>`;
  }).join('')}</tbody></table></div>` : '';
  return `<section aria-labelledby="h-rec">
    <div class="sec-head"><h2 id="h-rec">Next-day check</h2><button type="button" data-check="">Add check</button></div>
    ${chart}${table}
    <p class="note">Hooper index = sleep + fatigue + soreness + stress, each rated 1 to 7 the morning after (Hooper &amp; Mackinnon 1995). Higher means worse; the range is 4 to 28. Compare it with your own usual range. The shaded band is your mean ± 1 SD and appears after 7 checks.</p>
  </section>`;
}

// ---------- tabs ----------
function renderTabs() {
  const tabs = [{ id: 'overview', label: 'Overview' }, ...SPORTS];
  $('#tabs').innerHTML = tabs.map(t => `<button type="button" class="tab" data-tab="${t.id}" ${t.id === state.tab ? 'aria-current="page"' : ''} style="--dot:${t.id === 'overview' ? 'var(--accent)' : `var(--c-${t.id})`}"><span class="dot"></span>${t.label}</button>`).join('');
  $('#tabs [aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('#log-btn').textContent = state.tab === 'overview' ? '+ Log' : `+ ${SP[state.tab].label}`;
}

function render() {
  renderTabs();
  $('#view').innerHTML = state.tab === 'overview' ? overviewHtml() : sportHtml(state.tab);
  if (state.tab === 'gym') renderStrength();
}

// ---------- overview ----------
function overviewHtml() {
  if (!state.sessions.length) return `<div class="welcome">
    <h2>Welcome</h2>
    <p>Log a session, or restore the backup exported from the web version.</p>
    <div class="actions"><button type="button" class="primary" id="w-log">Log first session</button><button type="button" id="w-import">Import backup</button></div>
  </div>`;
  const banners = [];
  const pend = pendingCheckDay();
  if (pend) banners.push(`<div class="banner"><span>How do you feel after ${dayName(pend)}'s training?</span><button type="button" data-check="${pend}">Add next-day check</button></div>`);
  const todo = state.sessions.filter(needsDetails).length;
  if (todo) banners.push(`<div class="banner"><span>${todo} session${todo > 1 ? 's' : ''} from TopLogger still need${todo > 1 ? '' : 's'} time and effort, so ${todo > 1 ? 'they are' : 'it is'} left out of time and load totals.</span><button type="button" data-tab="boulder" data-todo="1">Complete them</button></div>`);

  const mon = mondayOf(new Date()), prev = new Date(mon.getTime() - 7 * DAY);
  const wk = (a, b) => state.sessions.filter(s => { const t = parseD(s.date); return t >= a && t < b; })
    .reduce((o, s) => (o.n++, o.min += mins(s), o.load += load(s), o), { n: 0, min: 0, load: 0 });
  const cur = wk(mon, new Date(mon.getTime() + 7 * DAY)), last = wk(prev, mon);
  const d = (c, l) => l ? `${c >= l ? '+' : '−'}${Math.abs(Math.round((c - l) / l * 100))}% vs last wk` : 'last wk: —';

  const from = daysAgo(29), to = todayIso();
  const rows = SPORTS.map(sp => {
    const ss = bySport(sp.id).filter(s => s.date >= from);
    if (!ss.length) return '';
    const a = windowAgg(ss, from, to);
    return `<tr class="link" data-tab="${sp.id}" tabindex="0"><td><span class="pill" style="--dot:var(--c-${sp.id})">${sp.label}</span></td><td class="n">${a.n}</td><td class="n">${fmtDur(a.min)}</td><td class="n">${fmtNum(a.load)}</td><td class="n">${a.rpe ? a.rpe.toFixed(1) : '—'}</td><td class="n">${a.perf ? a.perf.toFixed(1) : '—'}</td></tr>`;
  }).join('');

  return `
    ${banners.length ? `<div class="banners">${banners.join('')}</div>` : ''}
    <section aria-labelledby="h-week"><h2 id="h-week" class="label">This week</h2>
      <div class="week">
        <div class="stat"><span class="label">Sessions</span><span class="v">${cur.n}</span><span class="d">last wk ${last.n}</span></div>
        <div class="stat"><span class="label">Time</span><span class="v">${fmtDur(cur.min)}</span><span class="d">${d(cur.min, last.min)}</span></div>
        <div class="stat"><span class="label">Load AU</span><span class="v">${fmtNum(cur.load)}</span><span class="d">${d(cur.load, last.load)}</span></div>
      </div></section>
    <section aria-labelledby="h-weekly">
      <div class="sec-head"><h2 id="h-weekly">Weekly volume</h2>${metricToggle()}</div>
      ${weeklyChart(null, 8)}
      <div class="legend">${SPORTS.map(s => `<span><i style="background:var(--c-${s.id})"></i>${s.label}</span>`).join('')}</div>
      <p class="note">Load = RPE × minutes in arbitrary units (session‑RPE, Foster et al. 2001). Weeks start on Monday.</p>
    </section>
    <section aria-labelledby="h-cal"><h2 id="h-cal">Last 17 weeks</h2>${heatmap()}
      <p class="note">Colour shows the sport you spent most time on that day. Darker means longer.</p></section>
    <section aria-labelledby="h-sum"><h2 id="h-sum">Last 30 days by sport</h2>
      ${rows ? `<div class="scroll"><table><thead><tr><th>Sport</th><th class="n">Sessions</th><th class="n">Time</th><th class="n">Load</th><th class="n">Avg RPE</th><th class="n">Avg perf.</th></tr></thead><tbody>${rows}</tbody></table></div><p class="note">Tap a sport for its own page.</p>` : '<div class="empty">Nothing logged in the last 30 days.</div>'}</section>
    ${recoverySection()}
    ${historySection(state.sessions, 'All sessions', true, true)}`;
}

// ---------- sport page ----------
function sportHtml(sp) {
  const list = bySport(sp), g = SP[sp].group;
  const to = todayIso(), a = windowAgg(list, daysAgo(29), to), p = windowAgg(list, daysAgo(59), daysAgo(30));
  const cmp = (c, q, f) => q != null && q ? `${c >= q ? '+' : '−'}${Math.abs(Math.round((c - q) / q * 100))}%` : '—';
  const stat = (label, v, sub) => `<div class="stat"><span class="label">${label}</span><span class="v">${v}</span><span class="d">${sub}</span></div>`;
  const head = `<div class="sport-head" style="--dot:var(--c-${sp})"><span class="swatch"></span><h2>${SP[sp].label}</h2></div>`;
  if (!list.length) return `${head}<div class="welcome"><p>No ${SP[sp].label.toLowerCase()} sessions yet. Log one and this page fills with its own trends.</p><div class="actions"><button type="button" class="primary" data-log="${sp}">Log ${SP[sp].label.toLowerCase()}</button></div></div>`;
  const strip = `<section aria-label="Last 30 days"><div class="sec-head"><h3 class="label">Last 30 days</h3><span class="hint">change vs the 30 days before</span></div>
    <div class="stats5">
      ${stat('Sessions', a.n, `prior ${p.n}`)}
      ${stat('Time', fmtDur(a.min), cmp(a.min, p.min))}
      ${stat('Load AU', fmtNum(a.load), cmp(a.load, p.load))}
      ${stat('Avg RPE', a.rpe ? a.rpe.toFixed(1) : '—', p.rpe ? `prior ${p.rpe.toFixed(1)}` : 'prior —')}
      ${stat('Avg perf.', a.perf ? a.perf.toFixed(1) : '—', p.perf ? `prior ${p.perf.toFixed(1)}` : 'prior —')}
    </div></section>`;
  const noTime = list.filter(s => s.date >= daysAgo(83) && needsDetails(s)).length;
  const vol = `<section aria-labelledby="h-vol"><div class="sec-head"><h2 id="h-vol">Weekly volume</h2>${metricToggle()}</div>${weeklyChart(sp, 12)}
    ${noTime ? `<p class="note">${noTime} session${noTime > 1 ? 's' : ''} in these 12 weeks ${noTime > 1 ? 'have' : 'has'} no time or effort yet and ${noTime > 1 ? 'are' : 'is'} not counted. <button type="button" class="ex-link" data-f="todo">Show ${noTime > 1 ? 'them' : 'it'}</button></p>` : ''}</section>`;
  let specific = '';
  if (g === 'route') specific = routePanels(sp, list);
  if (g === 'boulder') specific = boulderPanels(sp, list);
  if (g === 'football') specific = footballPanels(list);
  if (g === 'racket') specific = racketPanels(sp, list);
  if (g === 'gym') specific = gymPanels(list);
  if (g === 'yoga') specific = yogaPanels(list);
  return `${head}${strip}${vol}${specific}${historySection(list, 'History', false, true)}`;
}

function routePanels(sp, list) {
  const from = daysAgo(89), ss = list.filter(s => s.date >= from);
  const climbed = ss.reduce((a, s) => a + (s.count || 0), 0), clean = ss.reduce((a, s) => a + (s.sends || 0), 0);
  return `<section aria-labelledby="h-gr"><h2 id="h-gr">Grade progression</h2>${gradeChart(sp)}
    <p class="note">Each dot is the hardest send of one session; the dashed line is your best to date.</p></section>
    <section aria-labelledby="h-rt"><h2 id="h-rt">Last 90 days</h2><div class="stats5">
      <div class="stat"><span class="label">Routes</span><span class="v">${climbed}</span><span class="d">${ss.length} sessions</span></div>
      <div class="stat"><span class="label">Clean sends</span><span class="v">${clean}</span><span class="d">${climbed ? Math.round(clean / climbed * 100) + '% of routes' : '—'}</span></div>
    </div></section>`;
}

function boulderPanels(sp, list) {
  const from = daysAgo(89), ss = list.filter(s => s.date >= from);
  const prevSs = list.filter(s => s.date >= daysAgo(179) && s.date < from);
  // grade pyramid from individual TopLogger climbs, plus manual sessions' hardest send
  const pyr = {};
  for (const s of ss) {
    if (Array.isArray(s.climbs) && s.climbs.length) for (const c of s.climbs) { const r = pyr[c.g] || (pyr[c.g] = { flash: 0, top: 0 }); r[c.tick === 'flash' ? 'flash' : 'top']++; }
  }
  const grades = Object.keys(pyr).sort((x, y) => FONT.indexOf(y) - FONT.indexOf(x));
  const pyramid = grades.length ? barList(grades.map(gr => ({
    label: `<span class="mono">${gr}</span>`, val: `${pyr[gr].flash + pyr[gr].top}`,
    parts: [{ v: pyr[gr].flash, color: 'var(--c-boulder)', title: `${pyr[gr].flash} flash` }, { v: pyr[gr].top, color: 'color-mix(in srgb, var(--c-boulder) 40%, var(--soft))', title: `${pyr[gr].top} top` }],
  }))) : '<div class="empty">No logged climbs in the last 90 days.</div>';
  const fl = (arr) => { const c = arr.flatMap(s => s.climbs || []); return c.length ? c.filter(x => x.tick === 'flash').length / c.length : null; };
  const fNow = fl(ss), fPrev = fl(prevSs);
  const gyms = {};
  for (const s of ss) if (s.gym) { const g = gyms[s.gym] || (gyms[s.gym] = { n: 0, sends: 0 }); g.n++; g.sends += s.sends || 0; }
  const gymRows = Object.entries(gyms).sort((a, b) => b[1].n - a[1].n);
  return `<section aria-labelledby="h-gr"><h2 id="h-gr">Grade progression</h2>${gradeChart(sp)}
      <p class="note">Each dot is the hardest send of one session; the dashed line is your best to date.</p></section>
    <div class="two">
      <div class="panel"><div class="sec-head"><h3>Grade pyramid</h3><span class="hint">last 90 days</span></div>
        ${pyramid}
        <div class="legend"><span><i style="background:var(--c-boulder)"></i>Flash</span><span><i style="background:color-mix(in srgb, var(--c-boulder) 40%, var(--soft))"></i>Top after tries</span></div></div>
      <div class="panel"><div class="sec-head"><h3>Gyms</h3><span class="hint">last 90 days</span></div>
        ${gymRows.length ? barList(gymRows.map(([n, g]) => ({ label: esc(n), val: `${g.n} × · ${g.sends} sent`, parts: [{ v: g.n, color: 'var(--c-boulder)' }] }))) : '<div class="empty">No gym recorded.</div>'}
        <div class="ex-stats" style="margin-top:6px"><div><span class="label">Flash rate</span><b>${fNow == null ? '—' : Math.round(fNow * 100) + '%'}</b><span class="hint">prior 90 days ${fPrev == null ? '—' : Math.round(fPrev * 100) + '%'}</span></div></div>
      </div>
    </div>
    <p class="note">Pyramid and flash rate count climbs logged in TopLogger. Flash rate = flashed climbs / all logged climbs. A falling flash rate with harder grades usually means you are trying harder problems, not climbing worse.</p>`;
}

function footballPanels(list) {
  const from = daysAgo(89), ss = list.filter(s => s.date >= from);
  const matches = ss.filter(s => s.format === 'match');
  const G = matches.reduce((a, s) => a + (s.goals || 0), 0), A = matches.reduce((a, s) => a + (s.assists || 0), 0);
  const allMatches = list.filter(s => s.format === 'match').slice(0, 10);
  return `<section aria-labelledby="h-fb"><div class="sec-head"><h2 id="h-fb">Last 90 days</h2></div><div class="stats5">
      <div class="stat"><span class="label">Matches</span><span class="v">${matches.length}</span><span class="d">${ss.length - matches.length} trainings</span></div>
      <div class="stat"><span class="label">Goals</span><span class="v">${G}</span><span class="d">${matches.length ? (G / matches.length).toFixed(2) + ' per match' : '—'}</span></div>
      <div class="stat"><span class="label">Assists</span><span class="v">${A}</span><span class="d">${matches.length ? (A / matches.length).toFixed(2) + ' per match' : '—'}</span></div>
    </div></section>
    ${allMatches.length ? `<section aria-labelledby="h-fm"><h2 id="h-fm">Recent matches</h2><div class="scroll"><table><thead><tr><th>Date</th><th class="n">Min</th><th class="n">G</th><th class="n">A</th><th class="n">RPE</th><th class="n">Perf.</th></tr></thead><tbody>${allMatches.map(s => `<tr><td class="mono">${s.date}</td><td class="n">${s.minutes || '—'}</td><td class="n">${s.goals ?? 0}</td><td class="n">${s.assists ?? 0}</td><td class="n">${s.rpe || '—'}</td><td class="n">${s.perf || '—'}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
}

function racketPanels(sp, list) {
  const rec = arr => ({ w: arr.filter(s => s.result === 'win').length, l: arr.filter(s => s.result === 'loss').length });
  const all = rec(list), r90 = rec(list.filter(s => s.date >= daysAgo(89)));
  const fm = { practice: 0, lesson: 0, match: 0 };
  for (const s of list.filter(s => s.date >= daysAgo(89))) fm[s.format === 'lesson' || s.format === 'match' ? s.format : 'practice']++;
  const lessons = list.filter(s => s.format === 'lesson').slice(0, 8);
  const vids = list.flatMap(s => (s.videos || []).map((v, i) => ({ s, v, i })));
  return `<div class="two">
      <div class="panel"><h3>Matches</h3><div class="ex-stats">
        <div><span class="label">All time</span><b>${all.w}–${all.l}</b></div>
        <div><span class="label">Last 90 days</span><b>${r90.w}–${r90.l}</b></div>
        <div><span class="label">Win rate</span><b>${all.w + all.l ? Math.round(all.w / (all.w + all.l) * 100) + '%' : '—'}</b></div></div></div>
      <div class="panel"><div class="sec-head"><h3>Session types</h3><span class="hint">last 90 days</span></div>
        ${barList(Object.entries(fm).map(([k, n]) => ({ label: { practice: 'Practice', lesson: 'Lesson', match: 'Match' }[k], val: n, parts: [{ v: n, color: `var(--c-${sp})` }] })))}</div>
    </div>
    <section aria-labelledby="h-les"><h2 id="h-les">Lessons</h2>
      ${lessons.length ? `<div class="scroll"><table><thead><tr><th>Date</th><th>Coach</th><th>Worked on</th><th class="n">Videos</th></tr></thead><tbody>${lessons.map(s => `<tr><td class="mono">${s.date}</td><td>${esc(s.coach || '—')}</td><td>${esc(s.lessonFocus || '—')}</td><td class="n">${(s.videos || []).length || '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No lessons logged yet.</div>'}</section>
    <section aria-labelledby="h-vids"><h2 id="h-vids">Videos</h2>
      ${vids.length ? `<div class="climbs">${vids.map(({ s, v, i }) => `<button type="button" class="vchip" data-vid="${esc(s.id)}" data-vi="${i}">▶ ${s.date} · ${fmtClock(v.duration)}${v.notes?.length ? ` · ${v.notes.length} note${v.notes.length > 1 ? 's' : ''}` : ''}</button>`).join('')}</div>` : '<div class="empty">No videos yet. Add one from a session in the history below.</div>'}</section>`;
}

function gymPanels(list) {
  const fc = {};
  for (const s of list.filter(s => s.date >= daysAgo(89))) if (s.focus) fc[s.focus] = (fc[s.focus] || 0) + 1;
  return `<section aria-labelledby="h-str" id="strength">
      <div class="sec-head"><h2 id="h-str">Strength</h2><div class="toggle" id="str-metric" role="group" aria-label="Strength metric"></div></div>
      <div class="str"><div class="ex-index" id="ex-index" role="group" aria-label="Exercises"></div><div class="panel" id="ex-detail"></div></div>
      <p class="note">e1RM is estimated with the Epley formula, kg × (1 + reps / 30), from sets of 1 to 12 reps. Volume is the sum of kg × reps. For pull-ups and dips the kg is added load, so body mass is not included. Filled dots mark a new best.</p>
    </section>
    <section aria-labelledby="h-foc"><div class="sec-head"><h2 id="h-foc">Focus</h2><span class="hint">sessions, last 90 days</span></div>
      ${Object.keys(fc).length ? barList(Object.entries(fc).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: GYM_FOCUS[k] || k, val: n, parts: [{ v: n, color: 'var(--c-gym)' }] }))) : '<div class="empty">No focus recorded.</div>'}</section>`;
}

function yogaPanels(list) {
  const ss = list.filter(s => s.date >= daysAgo(89));
  const st = {}, wh = {};
  for (const s of ss) {
    const k = s.style || 'other'; const r = st[k] || (st[k] = { n: 0, min: 0 }); r.n++; r.min += mins(s);
    if (s.setting) wh[s.setting] = (wh[s.setting] || 0) + 1;
  }
  const name = k => YOGA_STYLES.find(x => x.toLowerCase() === k) || k;
  return `<div class="two">
    <div class="panel"><div class="sec-head"><h3>Styles</h3><span class="hint">minutes, last 90 days</span></div>
      ${Object.keys(st).length ? barList(Object.entries(st).sort((a, b) => b[1].min - a[1].min).map(([k, r]) => ({ label: name(k), val: `${r.n} × · ${fmtDur(r.min)}`, parts: [{ v: r.min, color: 'var(--c-yoga)' }] }))) : '<div class="empty">No sessions in the last 90 days.</div>'}</div>
    <div class="panel"><div class="sec-head"><h3>Where</h3><span class="hint">sessions, last 90 days</span></div>
      ${Object.keys(wh).length ? barList(Object.entries(wh).map(([k, n]) => ({ label: YOGA_WHERE[k] || k, val: n, parts: [{ v: n, color: 'var(--c-yoga)' }] }))) : '<div class="empty">Not recorded.</div>'}</div>
  </div>`;
}

// ---------- strength (gym page) ----------
const METRICS = {
  top: { label: 'Top set', unit: 'kg', get: p => p.top.kg, weighted: true },
  e1rm: { label: 'e1RM', unit: 'kg', get: p => p.e1rm, weighted: true },
  vol: { label: 'Volume', unit: 'kg', get: p => p.vol, weighted: true },
  maxReps: { label: 'Max reps', unit: 'reps', get: p => p.maxReps, weighted: false },
  totReps: { label: 'Total reps', unit: 'reps', get: p => p.totReps, weighted: false },
};
function renderStrength() {
  const idxEl = $('#ex-index'); if (!idxEl) return;
  const idx = exerciseIndex();
  if (!idx.length) { $('#ex-detail').innerHTML = `<div class="empty">Log a gym session with exercises and sets. Each exercise then gets its own trend here.</div>`; return; }
  if (!idx.some(e => e.key === state.ex)) state.ex = idx[0].key;
  const ex = idx.find(e => e.key === state.ex);
  const allowed = Object.keys(METRICS).filter(k => METRICS[k].weighted === ex.weighted);
  if (!allowed.includes(state.exMetric)) state.exMetric = allowed[0];
  const M = METRICS[state.exMetric];
  idxEl.innerHTML = idx.map(e => { const t = e.last.top; return `<button type="button" data-exk="${esc(e.key)}" aria-pressed="${e.key === state.ex}"><b>${esc(e.name)}</b><span>${e.points.length} session${e.points.length > 1 ? 's' : ''} · ${t.kg > 0 ? fmtKg(t.kg) + ' kg × ' + t.reps : t.reps + ' reps'}</span></button>`; }).join('');
  $('#str-metric').innerHTML = allowed.map(k => `<button type="button" data-exm="${k}" aria-pressed="${k === state.exMetric}">${METRICS[k].label}</button>`).join('');
  const pts = ex.points.map(p => ({ p, t: parseD(p.date).getTime(), v: M.get(p) })).filter(d => d.v != null && d.v > 0);
  const best = k => Math.max(...ex.points.map(p => METRICS[k].get(p) ?? 0));
  const stats = ex.weighted
    ? [['Best top set', `${fmtKg(best('top'))} kg`], ['Best e1RM', best('e1rm') ? `${fmtKg(best('e1rm'))} kg` : '—'], ['Sessions', ex.points.length]]
    : [['Best set', `${best('maxReps')} reps`], ['Sessions', ex.points.length]];
  let chart;
  if (pts.length < 2) chart = `<div class="empty">${pts.length ? 'One session so far. The trend line appears after the second.' : `No ${M.label.toLowerCase()} data for this exercise.`}</div>`;
  else {
    const W = 560, H = 220, ml = 46, mr = 40, mt = 14, mb = 26, pw = W - ml - mr, ph = H - mt - mb;
    const t1 = today0().getTime() + DAY, t0 = Math.min(pts[0].t, t1 - 30 * DAY) - 2 * DAY;
    const vmin = Math.min(...pts.map(d => d.v)), vmax = Math.max(...pts.map(d => d.v));
    const step = niceStep(Math.max(vmax - vmin, vmax * 0.1, 1) / 4);
    const lo = Math.max(0, Math.floor((vmin - step * 0.5) / step) * step), hi = Math.ceil((vmax + step * 0.3) / step) * step;
    const x = t => ml + (t - t0) / (t1 - t0) * pw, y = v => mt + ph - (v - lo) / (hi - lo) * ph;
    const fv = v => M.unit === 'kg' ? fmtKg(v) : String(Math.round(v));
    let s = '';
    for (let v = lo; v <= hi + 1e-9; v += step) s += `<line class="grid" x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}"/><text x="${ml - 6}" y="${y(v) + 4}" text-anchor="end">${fv(v)}</text>`;
    s += monthTicks(t0, t1, x, H);
    s += `<polyline points="${pts.map(d => `${x(d.t)},${y(d.v)}`).join(' ')}" fill="none" stroke="var(--c-gym)" stroke-width="2" stroke-linejoin="round"/>`;
    let run = -Infinity;
    for (const d of pts) {
      const pr = d.v > run; if (pr) run = d.v;
      s += `<circle cx="${x(d.t)}" cy="${y(d.v)}" r="4.5" fill="${pr ? 'var(--c-gym)' : 'var(--surface)'}" stroke="var(--c-gym)" stroke-width="2"><title>${esc(`${d.p.date} · ${M.label} ${fv(d.v)} ${M.unit} · ${setsText(d.p.sets)}`)}</title></circle>`;
    }
    const L = pts[pts.length - 1];
    s += `<text x="${x(L.t) + 8}" y="${y(L.v) + 4}" style="fill:var(--fg)">${fv(L.v)}</text>`;
    chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ex.name)} ${M.label} over time">${s}</svg>`;
  }
  const rows = ex.points.slice(-8).reverse().map(p => `<tr><td class="mono">${p.date}</td><td class="mono">${esc(setsText(p.sets))}</td>
    ${ex.weighted ? `<td class="n">${fmtKg(p.top.kg)}×${p.top.reps}</td><td class="n">${p.e1rm ? fmtKg(p.e1rm) : '—'}</td><td class="n">${fmtNum(p.vol)}</td>` : `<td class="n">${p.maxReps}</td><td class="n">${p.totReps}</td>`}</tr>`).join('');
  const head = ex.weighted ? '<th>Date</th><th>Sets (kg×reps)</th><th class="n">Top</th><th class="n">e1RM</th><th class="n">Volume</th>' : '<th>Date</th><th>Sets (reps)</th><th class="n">Max</th><th class="n">Total</th>';
  $('#ex-detail').innerHTML = `<div class="sec-head"><h3>${esc(ex.name)}</h3><span class="label">${M.label}${M.unit === 'kg' ? ' · kg' : ''}</span></div>
    <div class="ex-stats">${stats.map(([k, v]) => `<div><span class="label">${k}</span><b>${v}</b></div>`).join('')}</div>
    ${chart}<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
