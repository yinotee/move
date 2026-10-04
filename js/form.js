'use strict';
// ---------- bottom sheet ----------
const sheet = { opener: null, busy: false, onClose: null };
function openSheet(title, html, opener, onClose) {
  if ($('#sheet').hidden) sheet.opener = opener || document.activeElement;
  sheet.onClose = onClose || null;
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  $('#sheet-body').scrollTop = 0;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#sheet-close').focus({ preventScroll: true });
}
function closeSheet() {
  if (sheet.busy) { toast('Wait until it finishes'); return; }
  sheet.onClose?.(); sheet.onClose = null;
  $('#sheet').hidden = true;
  $('#sheet-body').innerHTML = '';
  document.body.style.overflow = '';
  if (sheet.opener?.isConnected) sheet.opener.focus({ preventScroll: true });
}

// ---------- log form ----------
const form = { editing: null, sport: 'boulder', ex: [] };
const newEx = () => [{ name: '', sets: [{ kg: '', reps: '' }] }];

const num = (k, lab, max, hint = '') =>
  `<div class="field"><label for="x-${k}">${lab}</label><input type="number" id="x-${k}" data-k="${k}" min="0" max="${max}" step="1" inputmode="numeric">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
const txt = (k, lab, ph, wide) =>
  `<div class="field ${wide ? 'wide' : ''}"><label for="x-${k}">${lab}</label><input type="text" id="x-${k}" data-k="${k}" placeholder="${ph}" maxlength="60"></div>`;
const sel = (k, lab, opts, wide) =>
  `<div class="field ${wide ? 'wide' : ''}"><label for="x-${k}">${lab}</label><select id="x-${k}" data-k="${k}">${opts.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select></div>`;

function openLog(sport, s, opener) {
  form.editing = s ? s.id : null;
  form.sport = s ? s.sport : (sport || state.lastSport);
  const exs = s ? normEx(s) : [];
  form.ex = exs.length ? exs.map(e => ({ name: e.name, sets: e.sets.map(st => ({ kg: st.kg ? String(st.kg) : '', reps: String(st.reps || '') })) })) : newEx();
  const title = !s ? 'Log a session' : s.source === 'toplogger' ? `Complete session · ${s.gym}` : 'Edit session';
  const rpe = s?.rpe || 6, perf = s?.perf || 3;
  openSheet(title, `
    <form id="log-form" novalidate>
      <fieldset><legend class="label">Sport</legend>
        <div class="chips" id="sport-chips">${SPORTS.map(x => `<label class="chip" style="--dot:var(--c-${x.id})"><input type="radio" name="sport" id="sp-${x.id}" value="${x.id}" ${x.id === form.sport ? 'checked' : ''}><span>${x.label}</span></label>`).join('')}</div>
      </fieldset>
      <div class="row2">
        <div class="field"><label for="f-date">Date</label><input type="date" id="f-date" max="${todayIso()}" value="${s?.date || todayIso()}"></div>
        <div class="field"><label for="f-min">Duration (min)</label><input type="number" id="f-min" min="1" max="600" step="5" inputmode="numeric" placeholder="90" value="${s?.minutes || ''}"></div>
      </div>
      <div class="presets" aria-label="Duration presets">${[45, 60, 90, 120].map(m => `<button type="button" data-min="${m}">${m}</button>`).join('')}</div>
      <div class="field">
        <div class="rpe-out"><label for="f-rpe">Effort (RPE, CR‑10)</label><span><b id="rpe-v">${rpe}</b> <span class="hint" id="rpe-l">${RPE_L[rpe]} · ${RPE_TALK[rpe]}</span></span></div>
        <input type="range" id="f-rpe" min="1" max="10" step="1" value="${rpe}">
        <span class="hint">Rate the whole session about 30 minutes after, not the hardest moment.</span>
      </div>
      <fieldset><legend class="label">Performance</legend>
        <div class="seg" id="perf">${[1, 2, 3, 4, 5].map(i => `<label title="${PERF_L[i]}"><input type="radio" name="perf" id="pf-${i}" value="${i}" ${i === perf ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div>
        <div class="hint" id="perf-l">${perf} · ${PERF_L[perf]}. How well you climbed or played, not how tired you are.</div>
      </fieldset>
      <div class="fields" id="sport-fields"></div>
      <div class="field"><label for="f-notes">Notes</label><textarea id="f-notes" placeholder="Beta, how the fingers felt, what to try next">${esc(s?.notes || '')}</textarea></div>
      <p class="err" id="err" role="alert"></p>
      <div class="actions"><button class="primary" type="submit" id="save">${s ? 'Save changes' : 'Save session'}</button></div>
    </form>`, opener);
  renderFields();
  if (s) {
    for (const el of $('#sport-fields').querySelectorAll('[data-k]')) if (s[el.dataset.k] != null) el.value = s[el.dataset.k];
    syncRacket();
  }
  const f = $('#log-form');
  f.addEventListener('submit', onSave);
  $('#sport-chips').addEventListener('change', e => { form.sport = e.target.value; renderFields(); });
  f.addEventListener('click', e => { const b = e.target.closest('[data-min]'); if (b) $('#f-min').value = b.dataset.min; });
  $('#f-rpe').addEventListener('input', e => { const v = +e.target.value; $('#rpe-v').textContent = v; $('#rpe-l').textContent = `${RPE_L[v]} · ${RPE_TALK[v]}`; });
  $('#perf').addEventListener('change', e => { $('#perf-l').textContent = `${e.target.value} · ${PERF_L[+e.target.value]}`; });
  const sf = $('#sport-fields');
  sf.addEventListener('input', onExInput);
  sf.addEventListener('click', onExClick);
  sf.addEventListener('change', e => { if (e.target.id === 'x-format') syncRacket(); });
  if (!s) $('#f-min').focus({ preventScroll: true });
}

function renderFields() {
  const sp = form.sport, g = SP[sp].group;
  let h = '';
  if (g === 'route' || g === 'boulder') {
    const scale = g === 'route' ? FR : FONT;
    if (g === 'boulder') h += txt('gym', 'Gym', 'e.g. USC Amsterdam', true);
    h += sel('grade', `Hardest send (${g === 'route' ? 'French' : 'TopLogger'})`, [['', '—'], ...scale.map(x => [x, x])]);
    h += num('count', g === 'route' ? 'Routes climbed' : 'Problems tried', 300);
    h += num('sends', g === 'route' ? 'Clean sends' : 'Sends', 300, g === 'route' ? 'Topped with no falls or rests' : '');
    if (g === 'boulder') h += num('flashes', 'Flashes', 300);
  } else if (g === 'football') {
    h += sel('format', 'Format', [['training', 'Training'], ['match', 'Match']]);
    h += num('goals', 'Goals', 50) + num('assists', 'Assists', 50);
  } else if (g === 'racket') {
    h += sel('format', 'Format', [['practice', 'Practice'], ['lesson', 'Lesson'], ['match', 'Match']], true);
    h += `<div class="show-wrap" data-show="match">${sel('result', 'Result', [['', '—'], ['win', 'Win'], ['loss', 'Loss']])}`;
    // squash scores are per game to 11, tennis per set
    h += `${txt('score', 'Score', sp === 'squash' ? 'e.g. 11-7 9-11 11-5' : 'e.g. 6-4 3-6 10-8')}</div>`;
    h += `<div class="show-wrap" data-show="lesson">${txt('coach', 'Coach', 'Name')}${txt('lessonFocus', 'Worked on', 'e.g. serve toss')}</div>`;
    h += `<p class="hint wide">Save first, then add a video to the session from its history.</p>`;
  } else if (g === 'gym') {
    h += sel('focus', 'Focus', Object.entries(GYM_FOCUS), true);
    h += `<div class="wide ex-editor" id="ex-editor"></div>`;
  } else if (g === 'yoga') {
    h += sel('style', 'Style', YOGA_STYLES.map(x => [x.toLowerCase(), x]));
    h += sel('setting', 'Where', Object.entries(YOGA_WHERE));
    h += txt('instructor', 'Teacher or studio', 'Optional', true);
    h += txt('yogaFocus', 'Focus', 'e.g. hips, balance, breathing', true);
  }
  $('#sport-fields').innerHTML = h;
  if (g === 'gym') renderExEditor();
  if (g === 'racket') syncRacket();
}
function syncRacket() {
  const f = $('#x-format')?.value;
  $$('#sport-fields [data-show]').forEach(el => { el.hidden = el.dataset.show !== f; });
}

// gym: exercise and set editor; form.ex mirrors the inputs as strings and is parsed on save
function renderExEditor() {
  const box = $('#ex-editor'); if (!box) return;
  const names = [...new Set([...exerciseIndex().map(e => e.name), ...COMMON_EX])];
  box.innerHTML = `<datalist id="ex-names">${names.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
    <div class="ex-cap"><span class="lab">Exercises</span><span class="hint">kg × reps · for pull-ups and dips enter added load</span></div>` +
    form.ex.map((ex, i) => `<div class="ex-block">
      <div class="ex-head">
        <input type="text" id="ex-${i}-name" data-ei="${i}" data-fld="name" list="ex-names" maxlength="40" placeholder="Exercise, e.g. Deadlift" value="${esc(ex.name)}" aria-label="Exercise ${i + 1} name">
        <button type="button" class="icon" data-act="rm-ex" data-ei="${i}" aria-label="Remove exercise ${i + 1}">×</button>
      </div>
      ${ex.sets.map((st, j) => `<div class="set">
        <span class="set-n">${j + 1}</span>
        <input type="number" id="ex-${i}-s${j}-kg" data-ei="${i}" data-si="${j}" data-fld="kg" min="0" max="500" step="0.5" inputmode="decimal" placeholder="kg" value="${esc(st.kg)}" aria-label="Exercise ${i + 1} set ${j + 1} kg">
        <span class="x">×</span>
        <input type="number" id="ex-${i}-s${j}-reps" data-ei="${i}" data-si="${j}" data-fld="reps" min="1" max="100" step="1" inputmode="numeric" placeholder="reps" value="${esc(st.reps)}" aria-label="Exercise ${i + 1} set ${j + 1} reps">
        <button type="button" class="icon" data-act="rm-set" data-ei="${i}" data-si="${j}" aria-label="Remove set ${j + 1}">×</button>
      </div>`).join('')}
      <button type="button" class="ghost add" data-act="add-set" data-ei="${i}">+ Set</button>
    </div>`).join('') + `<button type="button" class="add" data-act="add-ex">+ Exercise</button>`;
}
function onExInput(e) {
  const t = e.target; if (t.dataset.ei == null || !t.dataset.fld) return;
  const ex = form.ex[+t.dataset.ei]; if (!ex) return;
  if (t.dataset.fld === 'name') ex.name = t.value; else ex.sets[+t.dataset.si][t.dataset.fld] = t.value;
}
function onExClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const i = +b.dataset.ei, act = b.dataset.act;
  let focus = null;
  if (act === 'add-ex') { form.ex.push({ name: '', sets: [{ kg: '', reps: '' }] }); focus = `#ex-${form.ex.length - 1}-name`; }
  if (act === 'rm-ex') { form.ex.splice(i, 1); if (!form.ex.length) form.ex = newEx(); }
  if (act === 'add-set') {
    // a new set starts as a copy of the previous one, which is usually what you repeat
    const sets = form.ex[i].sets, last = sets[sets.length - 1] || { kg: '', reps: '' };
    sets.push({ ...last }); focus = `#ex-${i}-s${sets.length - 1}-kg`;
  }
  if (act === 'rm-set') { const sets = form.ex[i].sets; sets.splice(+b.dataset.si, 1); if (!sets.length) sets.push({ kg: '', reps: '' }); }
  renderExEditor();
  if (focus) $(focus)?.focus();
}
function readExercises() {
  const out = [];
  for (const ex of form.ex) {
    const name = ex.name.trim().slice(0, 40), sets = [];
    for (const st of ex.sets) {
      const kgS = String(st.kg).trim(), rS = String(st.reps).trim();
      if (!kgS && !rS) continue;
      if (!name) return { error: 'Give each exercise a name.' };
      const kg = kgS === '' ? 0 : Number(kgS), reps = Number(rS);
      if (!Number.isFinite(reps) || reps < 1) return { error: `${name}: enter the reps for every set.` };
      if (!Number.isFinite(kg) || kg < 0) return { error: `${name}: weight must be zero or more.` };
      sets.push({ kg: Math.round(kg * 10) / 10, reps: Math.round(reps) });
    }
    if (name && !sets.length) return { error: `${name}: add at least one set.` };
    if (name) out.push({ name, sets });
  }
  return { exercises: out };
}

function readForm() {
  const sport = form.sport;
  const date = $('#f-date').value;
  const minutes = Number($('#f-min').value);
  const rpe = Number($('#f-rpe').value);
  const perf = Number(document.querySelector('input[name=perf]:checked')?.value || 3);
  if (!date) return { error: 'Pick a date.' };
  if (date > todayIso()) return { error: 'The date is in the future. Log sessions after you do them.' };
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) return { error: 'Enter a duration between 1 and 600 minutes.' };
  const rec = { date, sport, minutes: Math.round(minutes), rpe, perf };
  for (const el of $('#sport-fields').querySelectorAll('[data-k]')) {
    // fields hidden for the chosen format are cleared, so a practice keeps no stale match result
    if (el.closest('[hidden]')) { rec[el.dataset.k] = null; continue; }
    let v = el.value.trim();
    if (v === '') { rec[el.dataset.k] = null; continue; }
    if (el.type === 'number') {
      v = Number(v);
      if (!Number.isFinite(v) || v < 0) return { error: `${el.labels[0].textContent} must be zero or more.` };
      v = Math.round(v * 10) / 10;
    }
    rec[el.dataset.k] = v;
  }
  if (SP[sport].group === 'gym') {
    const r = readExercises();
    if (r.error) return { error: r.error };
    rec.exercises = r.exercises; rec.lift = null; rec.weight = null; rec.reps = null;
  }
  if (rec.sends != null && rec.count != null && rec.sends > rec.count) return { error: 'Sends cannot exceed the number climbed or tried.' };
  if (rec.flashes != null && rec.sends != null && rec.flashes > rec.sends) return { error: 'Flashes cannot exceed sends.' };
  rec.notes = $('#f-notes').value.trim().slice(0, 500);
  return { rec };
}

async function onSave(e) {
  e.preventDefault();
  const { rec, error } = readForm();
  $('#err').textContent = error || '';
  if (error) return;
  $('#save').disabled = true;
  try {
    const old = form.editing ? findS(form.editing) : null;
    // editing keeps everything the form does not show (TopLogger climbs, videos, created time)
    const s = old ? { ...old, ...rec } : { id: uid(), created: new Date().toISOString(), ...rec };
    await saveSession(s);
    state.lastSport = rec.sport;
    toast(old ? 'Changes saved' : 'Session saved');
    closeSheet();
  } catch {
    $('#err').textContent = 'Could not save on this device. Free some storage and try again.';
    $('#save').disabled = false;
  }
}

// ---------- next-day check ----------
function pendingCheckDay() {
  const limit = daysAgo(2), today = todayIso();
  return trainingDays().find(d => d < today && d >= limit && !state.checks[d]) || null;
}
function openCheck(date, opener) {
  const days = trainingDays().filter(d => d < todayIso()).slice(0, 14);
  if (!date) date = days[0];
  if (!date) { toast('Log a training session first'); return; }
  if (!days.includes(date)) days.unshift(date);
  const c = state.checks[date] || {};
  openSheet('Next-day check', `
    <form id="ck-form" novalidate>
      <div class="field"><label for="ck-date">After training on</label>
        <select id="ck-date">${days.map(d => `<option value="${d}" ${d === date ? 'selected' : ''}>${d} · ${state.sessions.filter(s => s.date === d).map(s => SP[s.sport].label).join(', ')}</option>`).join('')}</select>
        <span class="hint">Rate how you feel this morning, not how hard the session felt while you did it.</span></div>
      ${HOOPER.map(q => `<fieldset class="scale"><legend class="lab">${q.label}</legend>
        <div class="seg seg7">${[1, 2, 3, 4, 5, 6, 7].map(i => `<label><input type="radio" name="ck-${q.k}" id="ck-${q.k}-${i}" value="${i}" ${c[q.k] === i ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div>
        <div class="ends"><span>1 · ${q.lo}</span><span>7 · ${q.hi}</span></div></fieldset>`).join('')}
      <fieldset class="scale"><legend class="lab">Where are you sore?</legend>
        <div class="chips areas">${AREAS.map(a => `<label class="chip"><input type="checkbox" name="ck-area" id="ck-a-${a.toLowerCase()}" value="${a}" ${(c.areas || []).includes(a) ? 'checked' : ''}><span>${a}</span></label>`).join('')}</div></fieldset>
      <label class="chk" for="ck-pain"><input type="checkbox" id="ck-pain" ${c.pain ? 'checked' : ''}><span>Sharp or joint pain, not just muscle soreness</span></label>
      <p class="hint warn" id="ck-pain-note" ${c.pain ? '' : 'hidden'}>Pain in a joint or tendon, such as a finger pulley, is not normal training soreness. Rest that area, and see a physiotherapist if it lasts more than a few days or gets worse.</p>
      <div class="field"><label for="ck-note">Note</label><textarea id="ck-note" maxlength="300" placeholder="e.g. forearms tight, slept badly">${esc(c.note || '')}</textarea></div>
      <p class="err" id="ck-err" role="alert"></p>
      <div class="actions"><button type="submit" class="primary" id="ck-save">Save check</button></div>
    </form>`, opener);
  $('#ck-pain').addEventListener('change', e => { $('#ck-pain-note').hidden = !e.target.checked; });
  $('#ck-date').addEventListener('change', e => openCheck(e.target.value));
  $('#ck-form').addEventListener('submit', onSaveCheck);
}
async function onSaveCheck(e) {
  e.preventDefault();
  const date = $('#ck-date').value, rec = { date, checkedOn: todayIso() };
  for (const q of HOOPER) {
    const v = +(document.querySelector(`input[name="ck-${q.k}"]:checked`)?.value || 0);
    if (!v) { $('#ck-err').textContent = `Rate ${q.label.toLowerCase()} from 1 to 7.`; return; }
    rec[q.k] = v;
  }
  rec.hooper = HOOPER.reduce((a, q) => a + rec[q.k], 0);
  rec.areas = $$('input[name="ck-area"]:checked').map(i => i.value);
  rec.pain = $('#ck-pain').checked;
  rec.note = $('#ck-note').value.trim().slice(0, 300);
  $('#ck-save').disabled = true;
  try { await saveCheck(rec); toast('Next-day check saved'); closeSheet(); }
  catch { $('#ck-err').textContent = 'Could not save on this device. Try again.'; $('#ck-save').disabled = false; }
}
