'use strict';
// ---------- constants ----------
const SPORTS = [
  { id: 'toprope', label: 'Top rope', group: 'route' },
  { id: 'boulder', label: 'Boulder', group: 'boulder' },
  { id: 'football', label: 'Football', group: 'football' },
  { id: 'tennis', label: 'Tennis', group: 'racket' },
  { id: 'squash', label: 'Squash', group: 'racket' },
  { id: 'gym', label: 'Gym', group: 'gym' },
  { id: 'yoga', label: 'Yoga', group: 'yoga' },
];
const SP = Object.fromEntries(SPORTS.map(s => [s.id, s]));
const FR = ['4', '4+', '5a', '5a+', '5b', '5b+', '5c', '5c+', '6a', '6a+', '6b', '6b+', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b'];
// Boulder scale matches TopLogger: value = 100 per number, ~16.7 per a/a+/b/b+/c/c+ step (6A = 600, 6A+ = 617)
const FONT = ['3a', '3b', '3c', '4a', '4a+', '4b', '4b+', '4c', '4c+', '5a', '5a+', '5b', '5b+', '5c', '5c+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A'];
const RPE_L = ['', 'Very easy', 'Easy', 'Moderate', 'Somewhat hard', 'Hard', 'Hard', 'Very hard', 'Very hard', 'Very hard', 'Maximal'];
// talk test anchors for each RPE band, shown under the slider
const RPE_TALK = ['', 'could sing', 'could sing', 'full sentences', 'full sentences', 'short sentences', 'short sentences', 'a few words', 'a few words', 'no talking', 'no talking'];
const PERF_L = ['', 'Poor', 'Below par', 'Normal', 'Good', 'Great'];
const YOGA_STYLES = ['Vinyasa', 'Hatha', 'Yin', 'Ashtanga', 'Power', 'Restorative', 'Other'];
const YOGA_WHERE = { studio: 'Studio class', online: 'Online class', self: 'Self practice' };
const GYM_FOCUS = { full: 'Full body', upper: 'Upper', lower: 'Lower', pull: 'Pull & core', fingers: 'Hangboard' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY = 86400000;
// Hooper wellness items, 1 = very, very good / low, 7 = very, very bad / high (Hooper & Mackinnon 1995)
const HOOPER = [
  { k: 'sleep', label: 'Sleep last night', lo: 'very good', hi: 'very bad' },
  { k: 'fatigue', label: 'Fatigue', lo: 'fresh', hi: 'exhausted' },
  { k: 'doms', label: 'Muscle soreness', lo: 'none', hi: 'very sore' },
  { k: 'stress', label: 'Stress', lo: 'relaxed', hi: 'very stressed' },
];
const AREAS = ['Fingers', 'Forearms', 'Shoulders', 'Back', 'Core', 'Legs', 'Other'];
const COMMON_EX = ['Deadlift', 'Back squat', 'Bench press', 'Overhead press', 'Pull-up', 'Weighted pull-up', 'Barbell row', 'Hip thrust', 'Romanian deadlift', 'Hangboard max hang', 'Dips', 'Push-up'];

// ---------- small helpers ----------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const todayIso = () => iso(new Date());
const daysAgo = n => iso(new Date(today0().getTime() - n * DAY));
const mondayOf = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
const fmtDur = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h} h ${r} m` : `${h} h`) : `${r} m`; };
// m:ss.s clock for video positions
const fmtClock = t => { t = Math.round(Math.max(0, +t || 0) * 10) / 10; const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };
const fmtNum = n => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
const fmtKg = v => `${+(+v).toFixed(1)}`;
const short = d => `${d.getDate()} ${MON[d.getMonth()]}`;
const dayName = d => { const diff = Math.round((today0() - parseD(d)) / DAY); return diff === 1 ? 'yesterday' : DAYS[parseD(d).getDay()]; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const load = s => (s.minutes || 0) * (s.rpe || 0);
const mins = s => s.minutes || 0;
// a session counts toward time and load totals once it has both; TopLogger imports arrive without them
const needsDetails = s => !(s.minutes > 0 && s.rpe > 0);
const tlUrl = (s, c) => `https://app.toplogger.nu/en-us/${encodeURIComponent(s.gymSlug)}/boulders/${encodeURIComponent(c.id)}`;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function niceStep(x) {
  if (x <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(x)), n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

// ---------- gym helpers ----------
// Exercises of a session; the first web version stored a single "key lift" (lift, weight, reps)
const normEx = s => Array.isArray(s.exercises) && s.exercises.length ? s.exercises
  : (s.lift || s.weight) ? [{ name: s.lift || 'Top set', sets: [{ kg: s.weight || 0, reps: s.reps || 1 }] }] : [];
const exKey = n => String(n).trim().toLowerCase().replace(/\s+/g, ' ');
// Epley estimate of one-rep max: w × (1 + r/30), used only for sets of 1–12 reps where the estimate holds up
const epley = (kg, reps) => reps === 1 ? kg : kg * (1 + reps / 30);
const setsText = sets => sets.map(st => st.kg > 0 ? `${fmtKg(st.kg)}×${st.reps}` : `${st.reps}`).join(' · ');

// ---------- local storage (IndexedDB) ----------
// Three object stores: sessions (key id), checks (key date = the training day), blobs (key id, video files)
const store = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('chalk-turf', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('checks')) db.createObjectStore('checks', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (name, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(name, mode), os = t.objectStore(name);
      const out = fn(os);
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  };
  return {
    all: name => tx(name, 'readonly', os => os.getAll()),
    get: (name, key) => tx(name, 'readonly', os => os.get(key)),
    put: (name, obj) => tx(name, 'readwrite', os => { os.put(obj); }),
    putMany: (name, list) => tx(name, 'readwrite', os => { for (const o of list) os.put(o); }),
    del: (name, key) => tx(name, 'readwrite', os => { os.delete(key); }),
  };
})();

// ---------- state ----------
const state = {
  sessions: [], checks: {}, tab: 'overview', metric: 'hours', shown: 25, filter: 'all',
  ex: null, exMetric: 'top', lastSport: 'boulder',
};
const findS = id => state.sessions.find(s => s.id === id);
const bySport = sp => state.sessions.filter(s => s.sport === sp);
const trainingDays = () => [...new Set(state.sessions.map(s => s.date))].sort().reverse();
const dayLoad = d => state.sessions.filter(s => s.date === d).reduce((a, s) => a + load(s), 0);

async function saveSession(s) {
  await store.put('sessions', s);
  const i = state.sessions.findIndex(x => x.id === s.id);
  if (i >= 0) state.sessions[i] = s; else state.sessions.push(s);
  sortSessions(); render();
}
async function deleteSession(id) {
  const s = findS(id);
  for (const v of s?.videos || []) await store.del('blobs', v.id).catch(() => {});
  await store.del('sessions', id);
  state.sessions = state.sessions.filter(x => x.id !== id);
  render();
}
async function saveCheck(c) {
  await store.put('checks', c);
  state.checks[c.date] = c; render();
}
function sortSessions() {
  state.sessions.sort((a, b) => b.date.localeCompare(a.date) || String(b.created || '').localeCompare(String(a.created || '')));
}

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); }
