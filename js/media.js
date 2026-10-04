'use strict';
// ---------- video: add, compress, review ----------
// Videos are stored on this device (IndexedDB "blobs"). A file the browser can play and that is not too large
// is kept as it is; anything larger, or a trimmed section, is re-encoded here: the clip is drawn into a canvas
// (short side 720 px, 30 fps, no audio) and recorded with MediaRecorder.
const DIRECT_MAX = 60 * 1048576;               // keep originals up to 60 MB
const TARGET_BITS = 24 * 1048576 * 8 * 0.85;    // compressed files aim for ~24 MB with 15 % headroom
const MIN_BPS = 6e5, MAX_BPS = 4e6;             // below ~0.6 Mbit/s a 720p swing is too blurry to judge
const REC_TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const FRAME = 1 / 30;
const vid = { sid: null, vi: 0, videos: [], file: null, fileUrl: null, playUrl: null, rate: 1 };
const once = (el, ev) => new Promise((res, rej) => {
  el.addEventListener(ev, res, { once: true });
  el.addEventListener('error', () => rej({ code: 'decode' }), { once: true });
});
function cleanupVideo() {
  $('#vp')?.pause();
  if (vid.fileUrl) { URL.revokeObjectURL(vid.fileUrl); vid.fileUrl = null; }
  if (vid.playUrl) { URL.revokeObjectURL(vid.playUrl); vid.playUrl = null; }
}

// --- add ---
function openUpload(sid, opener) {
  const s = findS(sid); if (!s) return;
  vid.sid = sid; vid.file = null;
  openSheet(`Add video · ${SP[s.sport].label} ${s.date}`, `
    <div class="field"><label for="vf">Video file</label><input type="file" id="vf" accept="video/*">
      <span class="hint">The video stays on this phone. Clips up to 60 MB are kept as they are; longer ones, or a trimmed part, are compressed to 720p, which takes about as long as the clip.</span></div>
    <div id="vprep" class="sheet-body" style="padding:0" hidden>
      <video id="vprev" playsinline muted controls></video>
      <div class="row2">
        <div class="field"><label for="vt0">Start (s)</label><input type="number" id="vt0" min="0" step="0.1" value="0"></div>
        <div class="field"><label for="vt1">End (s)</label><input type="number" id="vt1" min="0" step="0.1"></div>
      </div>
      <p class="hint" id="vplan"></p>
      <div class="progress" id="vprog" hidden><div id="vbar"></div></div>
    </div>
    <p class="err" id="verr" role="alert"></p>
    <div class="actions"><button type="button" class="primary" id="vgo" hidden>Add video</button></div>`, opener, cleanupVideo);
  $('#vf').addEventListener('change', onPickVideo);
  $('#vt0').addEventListener('input', showPlan);
  $('#vt1').addEventListener('input', showPlan);
  $('#vgo').addEventListener('click', addVideo);
}
function onPickVideo(e) {
  const f = e.target.files?.[0]; if (!f) return;
  vid.file = f;
  if (vid.fileUrl) URL.revokeObjectURL(vid.fileUrl);
  vid.fileUrl = URL.createObjectURL(f);
  const v = $('#vprev');
  $('#verr').textContent = '';
  v.onloadedmetadata = () => {
    $('#vt0').value = 0; $('#vt1').value = v.duration.toFixed(1); $('#vt0').max = $('#vt1').max = v.duration.toFixed(1);
    $('#vprep').hidden = false; $('#vgo').hidden = false; showPlan();
  };
  v.onerror = () => {
    $('#vprep').hidden = true; $('#vgo').hidden = true;
    $('#verr').textContent = 'This browser cannot read this video. On iPhone, set Settings › Camera › Formats to Most Compatible and record again.';
  };
  v.src = vid.fileUrl;
}
function plan() {
  const d = $('#vprev').duration, f = vid.file;
  const t0 = Math.max(0, +$('#vt0').value || 0), t1 = Math.min(+$('#vt1').value || d, d), len = t1 - t0;
  if (!(len > 0.5)) return { error: 'End must be at least half a second after start.' };
  const whole = t0 <= 0.05 && t1 >= d - 0.05;
  if (whole && f.size <= DIRECT_MAX) return { direct: true, t0, t1, len };
  const bps = Math.min(MAX_BPS, TARGET_BITS / len);
  if (bps < MIN_BPS) return { error: `This ${fmtClock(len)} part is too long to keep at a quality you can judge strokes from. Trim it to ${Math.floor(TARGET_BITS / MIN_BPS)} s or less.` };
  return { direct: false, t0, t1, len, bps };
}
function showPlan() {
  const p = plan();
  $('#verr').textContent = p.error || '';
  $('#vgo').disabled = !!p.error;
  if (p.error) { $('#vplan').textContent = ''; return; }
  $('#vplan').textContent = p.direct
    ? `Kept as it is, ${(vid.file.size / 1048576).toFixed(1)} MB.`
    : `Compressed to 720p at about ${(p.bps / 1e6).toFixed(1)} Mbit/s, roughly ${(p.bps * p.len / 8 / 1048576).toFixed(0)} MB, without sound. Takes about ${fmtClock(p.len)}; keep the app open.`;
}
// Re-encode [t0, t1]: draw each decoded frame into a canvas and record the canvas stream
async function transcode(src, t0, t1, bps, onProg) {
  const mime = window.MediaRecorder && REC_TYPES.find(t => MediaRecorder.isTypeSupported(t));
  if (!mime) throw { code: 'no_recorder' };
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = src;
  await once(v, 'loadedmetadata');
  const k = Math.min(1, 720 / (Math.min(v.videoWidth, v.videoHeight) || 720));
  const w = Math.max(2, Math.round(v.videoWidth * k / 2) * 2), h = Math.max(2, Math.round(v.videoHeight * k / 2) * 2);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  v.currentTime = t0; await once(v, 'seeked');
  ctx.drawImage(v, 0, 0, w, h);
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: Math.round(bps) });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });
  rec.start(1000);
  await v.play();
  await new Promise(resolve => {
    const tick = () => {
      ctx.drawImage(v, 0, 0, w, h);
      onProg((v.currentTime - t0) / (t1 - t0));
      if (v.currentTime >= t1 || v.ended) { v.pause(); resolve(); return; }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick); else requestAnimationFrame(tick);
    };
    v.addEventListener('ended', resolve, { once: true });
    tick();
  });
  rec.stop(); await stopped;
  v.removeAttribute('src'); v.load();
  const type = mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
  return { blob: new Blob(chunks, { type }), type };
}
function videoError(err) {
  const c = err?.code || err?.name;
  if (c === 'QuotaExceededError') return 'This phone has no room left for the app. Delete old videos or free storage, then try again.';
  if (c === 'no_recorder') return 'This browser cannot compress video. Trim the clip in the Photos app and add it again.';
  if (c === 'decode') return 'The video could not be read. Try another file.';
  return 'The video could not be saved. Try again.';
}
async function addVideo() {
  const p = plan(); if (p.error) return;
  const bar = $('#vbar'), btn = $('#vgo');
  sheet.busy = true; btn.disabled = true; $('#vf').disabled = true; $('#vprog').hidden = false; $('#verr').textContent = '';
  let lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  try {
    let blob = vid.file, type = vid.file.type || 'video/mp4';
    if (!p.direct) {
      btn.textContent = 'Compressing…';
      ({ blob, type } = await transcode(vid.fileUrl, p.t0, p.t1, p.bps, f => { bar.style.width = `${Math.min(100, f * 95).toFixed(1)}%`; }));
    }
    btn.textContent = 'Saving…';
    const id = uid();
    await store.put('blobs', { id, blob, type });
    const s = findS(vid.sid);
    const videos = [...(s.videos || []), { id, sizeBytes: blob.size, duration: Math.round(p.len * 10) / 10, added: new Date().toISOString(), notes: [] }];
    await saveSession({ ...s, videos });
    bar.style.width = '100%';
    sheet.busy = false;
    toast('Video added');
    openReview(vid.sid, videos.length - 1);
  } catch (err) {
    sheet.busy = false; btn.disabled = false; $('#vf').disabled = false; btn.textContent = 'Add video'; bar.style.width = '0';
    $('#verr').textContent = videoError(err);
  } finally { lock?.release?.().catch(() => {}); }
}

// --- review ---
async function openReview(sid, vi, opener) {
  const s = findS(sid); if (!s) return;
  vid.sid = sid; vid.vi = vi;
  vid.videos = (s.videos || []).map(v => ({ ...v, notes: [...(v.notes || [])] }));
  const v = vid.videos[vi]; if (!v) return;
  cleanupVideo();
  const rec = await store.get('blobs', v.id);
  const title = `${SP[s.sport].label} · ${s.date}${vid.videos.length > 1 ? ` · video ${vi + 1} of ${vid.videos.length}` : ''}`;
  if (!rec) {
    openSheet(title, `<div class="empty">This video is not on this device. Videos are not part of backups, so they stay on the phone where you added them.</div>
      <div class="vfoot"><span></span><button type="button" id="vid-del">Remove from session</button></div>`, opener, cleanupVideo);
    return;
  }
  vid.playUrl = URL.createObjectURL(rec.blob);
  openSheet(title, `
    ${vid.videos.length > 1 ? `<div class="filters">${vid.videos.map((x, i) => `<button type="button" data-vtab="${i}" aria-pressed="${i === vi}">Video ${i + 1}</button>`).join('')}</div>` : ''}
    <video id="vp" src="${vid.playUrl}" controls playsinline preload="metadata"></video>
    <div class="vctl">
      <div class="toggle" role="group" aria-label="Playback speed">${[0.25, 0.5, 1].map(r => `<button type="button" data-rate="${r}" aria-pressed="${r === vid.rate}">${r}×</button>`).join('')}</div>
      <div class="toggle" role="group" aria-label="Step one frame"><button type="button" data-step="-1">◀ Frame</button><button type="button" data-step="1">Frame ▶</button></div>
      <span class="mono" id="vtime">0:00.0</span>
    </div>
    <form class="note-add" id="vn-form"><input type="text" id="vn-text" maxlength="200" placeholder="What to change, e.g. contact point too late" aria-label="Note at the current time"><button type="submit" id="vn-add">Note at 0:00.0</button></form>
    <ul class="vnotes" id="vnotes"></ul>
    <div class="vfoot"><span class="hint">${fmtClock(v.duration)} · ${(v.sizeBytes / 1048576).toFixed(1)} MB</span><button type="button" id="vid-del">Delete video</button></div>`, opener, cleanupVideo);
  const vp = $('#vp');
  vp.playbackRate = vid.rate;
  // recorded WebM files can report an infinite duration until the end is reached once
  vp.addEventListener('loadedmetadata', () => {
    if (vp.duration === Infinity) { vp.currentTime = 1e101; vp.addEventListener('timeupdate', () => { vp.currentTime = 0; }, { once: true }); }
  });
  vp.addEventListener('timeupdate', showTime);
  vp.addEventListener('seeked', showTime);
  $('#vn-form').addEventListener('submit', addNote);
  renderNotes();
}
function showTime() {
  const t = $('#vp')?.currentTime || 0;
  $('#vtime').textContent = fmtClock(t);
  const b = $('#vn-add'); if (b) b.textContent = `Note at ${fmtClock(t)}`;
}
function renderNotes() {
  const v = vid.videos[vid.vi], ul = $('#vnotes'); if (!ul) return;
  ul.innerHTML = v.notes.length
    ? v.notes.map((n, i) => `<li><button type="button" class="mono" data-seek="${n.t}" aria-label="Go to ${fmtClock(n.t)}">${fmtClock(n.t)}</button><span>${esc(n.text)}</span><button type="button" class="icon" data-vnd="${i}" aria-label="Delete note at ${fmtClock(n.t)}">×</button></li>`).join('')
    : `<li><span></span><span class="hint">No notes yet. Pause on a moment, type what to change, and add it.</span><span></span></li>`;
}
async function saveVideos() {
  const s = findS(vid.sid); if (!s) return;
  await saveSession({ ...s, videos: vid.videos.map(v => ({ ...v, notes: [...v.notes] })) });
}
function addNote(e) {
  e.preventDefault();
  const text = $('#vn-text').value.trim(); if (!text) { $('#vn-text').focus(); return; }
  const t = Math.round(($('#vp').currentTime || 0) * 10) / 10;
  const v = vid.videos[vid.vi];
  v.notes.push({ t, text }); v.notes.sort((a, b) => a.t - b.t);
  $('#vn-text').value = '';
  renderNotes(); saveVideos();
}
function stepFrame(dir) {
  const vp = $('#vp'); if (!vp) return;
  vp.pause();
  vp.currentTime = Math.max(0, Math.min(vp.duration || Infinity, vp.currentTime + dir * FRAME));
}
async function deleteVideo(btn) {
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed'); btn.dataset.label = btn.textContent; btn.textContent = 'Confirm delete';
    setTimeout(() => { if (btn.isConnected) { btn.classList.remove('armed'); btn.textContent = btn.dataset.label; } }, 3000);
    return;
  }
  btn.disabled = true;
  const v = vid.videos[vid.vi];
  vid.videos.splice(vid.vi, 1);
  await saveVideos();
  await store.del('blobs', v.id).catch(() => {});
  toast('Video deleted');
  if (!vid.videos.length) closeSheet(); else openReview(vid.sid, 0);
}
