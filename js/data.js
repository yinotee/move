'use strict';
// ---------- data: backup, restore, CSV, TopLogger ----------
// TopLogger has no public API. This bookmarklet runs on the signed-in TopLogger web app (You › Sessions),
// reads your climb days through the page's own data client, and downloads them as a JSON file to import here.
const TL_BOOKMARKLET_SRC = `(async()=>{try{
const app=[...document.querySelectorAll('*')].find(e=>e.__vue_app__)?.__vue_app__;
if(!app){alert('Open app.toplogger.nu, sign in and go to You > Sessions first.');return;}
const pv=app._context.provides;const k=Reflect.ownKeys(pv).find(x=>String(x)==='Symbol(default-apollo-client)');
const c0=k&&pv[k];const c=c0&&(c0.default||c0);
const oq=c&&[...c.getObservableQueries('all').values()].find(q=>q.queryName==='climbDaysSessionsList');
if(!oq){alert('Go to You > Sessions in TopLogger, then run this again.');return;}
const r=await c.query({query:oq.query,variables:{...oq.variables,pagination:{page:1,perPage:500}},fetchPolicy:'network-only'});
const gn=v=>{if(v<400)return({300:'3a',333:'3b',367:'3c'})[v]||'3a';const n=Math.floor(v/100),s=['a','a+','b','b+','c','c+'][Math.round((v%100)/16.667)];return n>=6?n+s.toUpperCase():n+s;};
const sessions=r.data.climbDaysPaginated.data.filter(d=>d.bouldersTotalTries>0||d.climbUserDaysBoulders.length).map(d=>{
const climbs=d.climbUserDaysBoulders.map(t=>({g:gn(t.climb.grade),v:t.climb.grade,tick:t.tickType===2?'flash':'top',color:t.climb.holdColor?.color||null,label:t.climb.label||null,id:t.climb.id,repeat:!!t.wasRepeat})).sort((a,b)=>b.v-a.v);
const o={id:'tl-'+d.id,date:d.statsAtDate,sport:'boulder',source:'toplogger',tlId:d.id,gym:d.gym.name,gymSlug:d.gym.nameSlug,tries:d.bouldersTotalTries,climbs,created:d.statsAtDate+'T12:00:00Z'};
if(climbs.length){o.count=o.sends=climbs.length;o.flashes=climbs.filter(x=>x.tick==='flash').length;o.grade=climbs[0].g;o.gradeValue=climbs[0].v;}else o.climbsRemoved=true;
return o;});
const b=new Blob([JSON.stringify({app:'chalk-turf-log',kind:'toplogger',exported:new Date().toISOString(),sessions})],{type:'application/json'});
const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='toplogger-'+new Date().toISOString().slice(0,10)+'.json';
document.body.appendChild(a);a.click();a.remove();
alert('Exported '+sessions.length+' boulder sessions. Import the file in Chalk & Turf > Data.');
}catch(e){alert('Export failed: '+e.message);}})()`;
const TL_BOOKMARKLET = 'javascript:' + encodeURIComponent(TL_BOOKMARKLET_SRC.replace(/\n/g, ''));
// fields you add in this app that a TopLogger re-import must not overwrite
const KEEP_ON_TL_IMPORT = ['minutes', 'rpe', 'perf', 'notes', 'videos'];

function saveFile(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function backupJson() {
  return JSON.stringify({ app: 'chalk-turf-log', version: 1, exported: new Date().toISOString(), sessions: state.sessions, checks: Object.values(state.checks) }, null, 1);
}
function toCSV() {
  const cols = ['date', 'sport', 'minutes', 'rpe', 'perf', 'load_au', 'gym', 'grade', 'count', 'sends', 'flashes', 'tries', 'format', 'goals', 'assists', 'result', 'score', 'coach', 'lessonFocus', 'videos', 'focus', 'exercises', 'style', 'setting', 'instructor', 'yogaFocus', 'climbs', 'source', 'hooper_next_day', 'notes'];
  const q = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const cell = (s, c) => {
    if (c === 'load_au') return needsDetails(s) ? '' : load(s);
    if (c === 'videos') return s.videos?.length || '';
    // "grade:tick" per climb, e.g. 6A+:flash;6A:top
    if (c === 'climbs') return Array.isArray(s.climbs) ? s.climbs.map(x => `${x.g}:${x.tick}`).join(';') : '';
    // "Name: kg x reps, ..." per exercise, e.g. Deadlift: 70x5, 70x5; Pull-up: 0x8
    if (c === 'exercises') return normEx(s).map(e => `${e.name}: ${e.sets.map(st => `${st.kg}x${st.reps}`).join(', ')}`).join('; ');
    if (c === 'hooper_next_day') return state.checks[s.date]?.hooper ?? '';
    return s[c];
  };
  return [cols.join(','), ...[...state.sessions].reverse().map(s => cols.map(c => q(cell(s, c))).join(','))].join('\n') + '\n';
}

async function openData(opener) {
  let storage = '';
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    if (est) storage = `Using ${(est.usage / 1048576).toFixed(1)} MB on this device${persisted ? ', protected from automatic clean-up' : ''}.`;
  } catch { /* not supported */ }
  const nVid = state.sessions.reduce((a, s) => a + (s.videos?.length || 0), 0);
  openSheet('Data', `<div class="menu">
    <div class="menu-item"><h3>Back up</h3>
      <p class="hint">Everything is stored only on this device. Save a backup regularly, for example to iCloud Drive or Google Drive. Videos (${nVid}) are not included; they stay on this phone.</p>
      <div class="actions"><button type="button" id="d-backup">Save backup (.json)</button><button type="button" id="d-csv">Export CSV</button></div></div>
    <div class="menu-item"><h3>Import</h3>
      <p class="hint">A backup from this app or the web version, or a TopLogger export. Sessions with the same ID are replaced; a TopLogger import keeps the time, effort, notes and videos you added here.</p>
      <input type="file" id="d-file" accept="application/json,.json" aria-label="Choose a file to import">
      <div id="d-preview"></div></div>
    <div class="menu-item"><h3>TopLogger</h3>
      <p class="hint">1. Save the link below as a bookmark: copy it, add any page as a bookmark, then edit the bookmark and paste this as its address.<br>2. In the same browser, open app.toplogger.nu, sign in and go to You › Sessions.<br>3. Open the bookmark. It downloads toplogger-date.json.<br>4. Import that file above. It works on the phone itself in Safari or Chrome.</p>
      <div class="code" id="d-bm">${esc(TL_BOOKMARKLET)}</div>
      <div class="actions"><button type="button" id="d-copy">Copy bookmark link</button></div>
      <p class="hint">TopLogger has no public API, so this reads the same data the TopLogger page already shows you. A TopLogger update can break it.</p></div>
    ${storage ? `<p class="hint">${storage}</p>` : ''}
  </div>`, opener);
  $('#d-backup').addEventListener('click', () => { saveFile(`chalk-turf-backup-${todayIso()}.json`, backupJson(), 'application/json'); toast('Backup saved'); });
  $('#d-csv').addEventListener('click', () => { saveFile(`chalk-turf-${todayIso()}.csv`, toCSV(), 'text/csv'); toast('CSV saved'); });
  $('#d-copy').addEventListener('click', async e => {
    try { await navigator.clipboard.writeText(TL_BOOKMARKLET); toast('Copied'); }
    catch { const r = document.createRange(); r.selectNodeContents($('#d-bm')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Selected; copy it'); }
  });
  $('#d-file').addEventListener('change', previewImport);
}

let pendingImport = null;
async function previewImport(e) {
  const f = e.target.files?.[0]; if (!f) return;
  const box = $('#d-preview');
  try {
    const data = JSON.parse(await f.text());
    if (!data || data.app !== 'chalk-turf-log' || !Array.isArray(data.sessions)) throw new Error('format');
    const ok = data.sessions.filter(s => s && typeof s.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date || '') && SP[s.sport] && !s.example);
    const checks = (Array.isArray(data.checks) ? data.checks : []).filter(c => c && /^\d{4}-\d{2}-\d{2}$/.test(c.date || '') && c.hooper);
    const replace = ok.filter(s => findS(s.id)).length;
    pendingImport = { kind: data.kind === 'toplogger' ? 'toplogger' : 'backup', sessions: ok, checks };
    box.innerHTML = `<p class="hint">${ok.length} sessions (${ok.length - replace} new, ${replace} already here)${checks.length ? `, ${checks.length} next-day checks` : ''}${data.sessions.length - ok.length ? `; ${data.sessions.length - ok.length} skipped as invalid or example` : ''}.</p>
      <div class="actions"><button type="button" class="primary" id="d-import">Import</button></div>`;
    $('#d-import').addEventListener('click', runImport);
  } catch {
    pendingImport = null;
    box.innerHTML = `<p class="err">This file is not a Chalk &amp; Turf backup or TopLogger export.</p>`;
  }
}
async function runImport() {
  const p = pendingImport; if (!p) return;
  $('#d-import').disabled = true;
  const merged = p.sessions.map(s => {
    const old = findS(s.id);
    if (p.kind === 'toplogger' && old) {
      const keep = {}; for (const k of KEEP_ON_TL_IMPORT) if (old[k] != null) keep[k] = old[k];
      return { ...s, ...keep };
    }
    return s;
  });
  try {
    await store.putMany('sessions', merged);
    if (p.checks.length) await store.putMany('checks', p.checks);
    for (const s of merged) { const i = state.sessions.findIndex(x => x.id === s.id); if (i >= 0) state.sessions[i] = s; else state.sessions.push(s); }
    for (const c of p.checks) state.checks[c.date] = c;
    sortSessions(); render();
    navigator.storage?.persist?.().catch(() => {});
    toast(`Imported ${merged.length} sessions`);
    pendingImport = null;
    closeSheet();
  } catch { $('#d-preview').innerHTML = '<p class="err">Import failed. Free some storage on this device and try again.</p>'; }
}
