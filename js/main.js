'use strict';
// ---------- navigation ----------
const TABS = ['overview', ...SPORTS.map(s => s.id)];
function tabFromHash() { const h = location.hash.slice(1); return TABS.includes(h) ? h : 'overview'; }
let afterNav = null;
// opts.then runs after the new tab has rendered (e.g. scroll to a section); otherwise the page starts at the top
function goTab(t, opts = {}) {
  state.filter = opts.todo ? 'todo' : 'all'; state.shown = 25;
  afterNav = opts.then || null;
  if (location.hash.slice(1) !== t) { location.hash = t; return; } // hashchange renders
  state.tab = t; render(); finishNav();
}
function finishNav() {
  const f = afterNav; afterNav = null;
  if (f) requestAnimationFrame(f); else window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', () => { state.tab = tabFromHash(); render(); finishNav(); });

// ---------- one click handler for the whole app ----------
document.addEventListener('click', async e => {
  const t = e.target, at = sel => t.closest(sel);
  // sheet chrome and video tools
  if (t.id === 'sheet') { closeSheet(); return; }
  if (t.id === 'sheet-close') { closeSheet(); return; }
  let el;
  if ((el = at('[data-rate]'))) { vid.rate = +el.dataset.rate; const vp = $('#vp'); if (vp) vp.playbackRate = vid.rate; $$('[data-rate]').forEach(b => b.setAttribute('aria-pressed', b === el)); return; }
  if ((el = at('[data-step]'))) { stepFrame(+el.dataset.step); return; }
  if ((el = at('[data-seek]'))) { const vp = $('#vp'); vp.pause(); vp.currentTime = +el.dataset.seek; return; }
  if ((el = at('[data-vnd]'))) { vid.videos[vid.vi].notes.splice(+el.dataset.vnd, 1); renderNotes(); saveVideos(); return; }
  if ((el = at('[data-vtab]'))) { openReview(vid.sid, +el.dataset.vtab); return; }
  if (t.id === 'vid-del') { deleteVideo(t); return; }

  // navigation and top bar
  if ((el = at('[data-tab]'))) { goTab(el.dataset.tab, { todo: !!el.dataset.todo }); return; }
  if (t.id === 'log-btn') { openLog(state.tab === 'overview' ? null : state.tab, null, t); return; }
  if ((el = at('[data-log]'))) { openLog(el.dataset.log, null, el); return; }
  if (t.id === 'data-btn' || t.id === 'w-import') { openData(t); return; }
  if (t.id === 'w-log') { openLog(null, null, t); return; }

  // page controls
  if ((el = at('[data-metric]'))) { state.metric = el.dataset.metric; render(); return; }
  if ((el = at('[data-f]'))) { state.filter = el.dataset.f; state.shown = 25; render(); return; }
  if (t.id === 'more') { state.shown += 25; render(); return; }
  if ((el = at('[data-exm]'))) { state.exMetric = el.dataset.exm; renderStrength(); return; }
  if ((el = at('[data-exk]'))) {
    state.ex = el.dataset.exk;
    const toStrength = () => $('#strength')?.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
    if (state.tab !== 'gym') goTab('gym', { then: toStrength });
    else { renderStrength(); if (el.classList.contains('ex-link')) toStrength(); }
    return;
  }
  if ((el = at('[data-check]'))) { openCheck(el.dataset.check || null, el); return; }
  if ((el = at('[data-vid]'))) { openReview(el.dataset.vid, +el.dataset.vi, el); return; }
  if ((el = at('[data-vadd]'))) { openUpload(el.dataset.vadd, el); return; }
  if ((el = at('[data-edit]'))) { const s = findS(el.dataset.edit); if (s) openLog(null, s, el); return; }
  if ((el = at('[data-del]'))) {
    // two taps: the first arms the button, the second deletes
    if (!el.classList.contains('armed')) {
      el.classList.add('armed'); el.textContent = 'Confirm';
      setTimeout(() => { if (el.isConnected) { el.classList.remove('armed'); el.textContent = 'Delete'; } }, 3000);
      return;
    }
    const s = findS(el.dataset.del);
    try { await deleteSession(el.dataset.del); toast(s?.videos?.length ? 'Session and its videos deleted' : 'Session deleted'); }
    catch { toast('Could not delete. Try again.'); }
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('tr.link')) { goTab(e.target.dataset.tab); return; }
  if ($('#sheet').hidden) return;
  if (e.key === 'Escape') { closeSheet(); return; }
  if (e.target.matches('input, textarea, select')) return;
  if ($('#vp') && (e.key === ',' || e.key === '.')) { e.preventDefault(); stepFrame(e.key === '.' ? 1 : -1); }
});

// ---------- boot ----------
(async () => {
  state.tab = tabFromHash();
  render();
  try {
    const [sessions, checks] = await Promise.all([store.all('sessions'), store.all('checks')]);
    state.sessions = sessions.filter(s => s && s.date && SP[s.sport]);
    state.checks = Object.fromEntries(checks.map(c => [c.date, c]));
    sortSessions();
    if (state.sessions.length) navigator.storage?.persist?.().catch(() => {});
  } catch {
    toast('This browser blocks storage here. Open the app from your home screen or a normal window.');
  }
  render();
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
