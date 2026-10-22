/* Sloth BPP 215 — NVR by Frigate dashboard
   vanilla JS ไม่มี build step — ต่อ Frigate/go2rtc ผ่าน WebRTC + Frigate events API */
(() => {
'use strict';

// Global error telemetry to detect any runtime exceptions on mobile Safari or edge clients
window.addEventListener('error', function(e) {
  const detail = (e.message || e.error || 'Unknown error') + ' at ' + (e.filename || '') + ':' + (e.lineno || '') + ':' + (e.colno || '');
  console.error('[BPP-VMS Global Error]', detail, e.error);
  try {
    new Image().src = '/api/client-error?err=' + encodeURIComponent(detail) + '&ua=' + encodeURIComponent(navigator.userAgent || '');
  } catch(_) {}
});
window.addEventListener('unhandledrejection', function(e) {
  const detail = 'Unhandled Promise Rejection: ' + (e.reason ? (e.reason.stack || e.reason.message || e.reason) : 'unknown');
  console.error('[BPP-VMS Unhandled Rejection]', detail);
  try {
    new Image().src = '/api/client-error?err=' + encodeURIComponent(detail) + '&ua=' + encodeURIComponent(navigator.userAgent || '');
  } catch(_) {}
});

/* ============ AUTHENTICATION ============ */
let userRole = '';
const originalFetch = window.fetch.bind(window);

/**
 * Send same-origin requests with the server-managed HttpOnly session cookie.
 * A 401 invalidates the page session and redirects to login; the JWT never
 * enters JavaScript-accessible storage or an Authorization header.
 */
let _sessionVerifyPromise = null;
async function verifySessionOrRedirect() {
  if (_sessionVerifyPromise) return _sessionVerifyPromise;
  _sessionVerifyPromise = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await originalFetch('/auth/session', {
          credentials: 'same-origin',
          cache: 'no-store'
        });
        if (res.ok) return true;
        if (res.status === 401 || res.status === 403) {
          window.location.replace('/login.html');
          return false;
        }
      } catch (e) {
        // Network glitch or container restarting — do not kick 24/7 wallboard to login
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    return true;
  })().finally(() => { _sessionVerifyPromise = null; });
  return _sessionVerifyPromise;
}

window.fetch = async function authenticatedFetch() {
  let [resource, config] = arguments;
  if (!config) config = {};
  config.credentials = 'same-origin';
  try {
    const response = await originalFetch(resource, config);
    if (response.status === 401) {
      verifySessionOrRedirect();
    }
    return response;
  } catch (err) {
    throw err;
  }
};

/**
 * Resolve the authenticated identity from the server before initializing the
 * dashboard. The returned promise is shared with admin.js so both modules use
 * one authoritative role rather than a client-controlled localStorage value.
 */
async function loadAuthenticatedSession() {
  try {
    let sig;
    if (typeof AbortController !== 'undefined') {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5000);
      sig = ctrl.signal;
    }
    const response = await originalFetch('/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: sig
    });
    if (!response.ok) {
      window.location.replace('/login.html');
      return null;
    }
    const session = await response.json();
    userRole = session.role || '';
    window.bppSession = session;
    if (['admin', 'superadmin'].includes(userRole)) {
      document.querySelectorAll('.admin-only').forEach(element => {
        element.hidden = false;
      });
    }
    // Incident 2.45: Settings button is accessible to ALL authenticated roles.
    // Tab-level guards inside openSettings() control per-role tab visibility
    // (Tab 1 NVR: admin/superadmin only, Tab 3 LPR Learning: superadmin only).
    const btnSettings = document.getElementById('btnSettings');
    if (btnSettings) btnSettings.hidden = false;
    return session;
  } catch (error) {
    // If transient network timeout occurs on a returning browser with cached config, keep page alive
    if (error && error.name === 'AbortError') {
      const btnSettings = document.getElementById('btnSettings');
      if (btnSettings) btnSettings.hidden = false;
      return { role: userRole || 'operator' };
    }
    window.location.replace('/login.html');
    return null;
  }
}

// Expose only the identity promise, never the cookie/JWT, for cooperating UI
// modules that need to decide whether to render admin-only controls.
window.bppSessionPromise = loadAuthenticatedSession();

/**
 * Safely escape untrusted text content before inserting into HTML templates.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ============ ค่าตั้งต้น + localStorage ============ */
window.BRANDING = { name: 'Sloth', sub: 'BPP 215', logo: 'assets/BPP215.png' };
const LS_KEY = 'ta-nvr-dashboard';
const MAX_CH = 16;
// เสิร์ฟผ่าน nginx ของ service dashboard → มี /nvr/ proxy ไป frigate:5000 (same-origin กัน CORS)
// ถ้าเปิดไฟล์ตรงๆ (file:) จะเข้าโหมด demo และค่าเชื่อมต่อ default ชี้เครื่องตัวเอง (แก้ได้ใน settings)
const SAME_ORIGIN = location.protocol.startsWith('http');
const DEFAULTS = {
  base: SAME_ORIGIN ? location.origin + '/nvr/live/webrtc' : 'http://localhost:8080/nvr/live/webrtc',
  api: SAME_ORIGIN ? location.origin + '/nvr' : 'http://localhost:8080/nvr',
  demo: location.protocol === 'file:', // เปิดไฟล์ตรงๆ = โชว์โหมดสาธิตทันที
  layout: '2x2',
  eventsOpen: window.innerWidth >= 900,
  emgrThumb: 'md',   // ขนาดภาพย่อในคลังวิดีโอ: sm | md | lg | xl | xxl
  pbLayout: 1,       // จำนวนจอในหน้าดูย้อนหลัง: 1 | 2 | 4
  railClasses: null, // class ที่โฟกัสในแถบเหตุการณ์ (array ชื่อ class) — null = ทุกชนิดที่ตรวจพบ
  channels: [],
};

/* ============ รูปแบบตาราง (rows×cols) ============ */
// key = "rowsxcols" — รองรับทั้งแบบจัตุรัส (2×2/3×3/4×4) และไม่จัตุรัส (1×1/1×2)
const LAYOUTS = [
  { key: '1x1', rows: 1, cols: 1 },
  { key: '1x2', rows: 1, cols: 2 },
  { key: '2x2', rows: 2, cols: 2 },
  { key: '3x3', rows: 3, cols: 3 },
  { key: '4x4', rows: 4, cols: 4 },
];
function layoutOf(key) { return LAYOUTS.find(l => l.key === key) || LAYOUTS[2]; } // default 2×2
// backward-compat: cfg.layout เดิมเก็บเป็นเลข N (หมายถึง N×N) → แปลงเป็น key string
function normLayout(v) {
  if (typeof v === 'number' && Number.isFinite(v)) v = v + 'x' + v;
  return LAYOUTS.some(l => l.key === v) ? v : '2x2';
}

/**
 * คำนวณขนาดกริดที่เหมาะสมที่สุดตามจำนวนกล้องที่เปิดใช้งานจริงและตำแหน่งช่องสูงสุด
 * กฎเกณฑ์ที่กำหนด:
 * - 0 ตัว -> 2x2 (4ch ค่าเริ่มต้นตารางว่าง)
 * - 1 ตัว -> 1x1 (1ch)
 * - 2 ตัว -> 1x2 (2ch)
 * - 3–4 ตัว -> 2x2 (4ch)
 * - 5–9 ตัว -> 3x3 (9ch)
 * - 10–16 ตัว -> 4x4 (16ch)
 * โดยพิจารณาทั้ง activeCount และ maxSlotIdx เพื่อไม่ให้กล้องช่องท้ายๆ ตกขอบกริด
 */
function getOptimalAutoLayout() {
  const hiddenSet = new Set((state.userProfile && state.userProfile.hidden_channels) || []);
  const visibleSet = new Set((state.userProfile && state.userProfile.visible_channels) || []);

  let activeCount = 0;
  let maxSlotIdx = -1;

  if (Array.isArray(cfg.channels)) {
    cfg.channels.forEach((ch, idx) => {
      if (!ch || !ch.src || ch.enabled === false) return;
      const chNum = `CH${String(idx + 1).padStart(2, '0')}`;
      const isHidden = hiddenSet.has(ch.src);
      const isVisible = visibleSet.size === 0 || visibleSet.has(ch.src) || visibleSet.has(String(idx)) || visibleSet.has(chNum);
      if (!isHidden && isVisible) {
        activeCount++;
        if (idx > maxSlotIdx) maxSlotIdx = idx;
      }
    });
  }

  if (activeCount === 0) return '2x2';

  const requiredSlots = Math.max(activeCount, maxSlotIdx + 1);

  if (requiredSlots <= 1) return '1x1';
  if (requiredSlots <= 2) return '1x2';
  if (requiredSlots <= 4) return '2x2';
  if (requiredSlots <= 9) return '3x3';
  return '4x4';
}

function applyAutoLayout(force = false) {
  if (force || !state.manualLayoutOverride) {
    const optimal = getOptimalAutoLayout();
    if (cfg.layout !== optimal) {
      cfg.layout = optimal;
      saveCfg();
      if (typeof buildLayoutSwitch === 'function') buildLayoutSwitch();
    }
  }
}

// กล้อง Frigate/go2rtc ที่มีสตรีมหลักเป็น HEVC (`#video=copy`) จะมี `<cam>_sub` และ/หรือ `<cam>_hd` (NVENC H.264) เสมอ
// ห้ามเบราว์เซอร์ของผู้ใช้ที่ไม่ใช่แอดมินตกลงไปเรียก `<cam>` ดิบโดยตรง เพราะ WebRTC/MSE เล่น HEVC raw copy ไม่ได้ (Incident 2.182)
const SPLIT_SUB_CAM_RE = /^(Banmuang|D_BPP215|Doonsad|KK\d|nonburi|nongwang)/i;
const SPLIT_HD_CAM_RE  = /^(Banmuang|D_BPP215|Doonsad|KK\d|nonburi|nongwang|prasat)/i;

function normalizeChannelStreams(ch) {
  if (!ch || typeof ch !== 'object') return ch;
  const camId = typeof ch.src === 'string' ? ch.src.trim() : '';
  if (!camId || camId === 'cam11') {
    ch.src = '';
    ch.name = '';
    ch.sub = '';
    ch.hd = '';
    return ch;
  }
  const nvrList = (typeof state !== 'undefined' && Array.isArray(state.nvrCameras)) ? state.nvrCameras : null;
  const camDef = nvrList ? nvrList.find(c => c && c.name === camId) : null;
  const masterList = (typeof state !== 'undefined' && Array.isArray(state.masterChannels)) ? state.masterChannels : null;
  const masterCh = masterList ? masterList.find(m => m && m.src === camId && (m.sub || m.hd)) : null;

  let hasSub = false;
  if (camDef) {
    hasSub = Boolean(camDef.has_sub || camDef.sub_url);
  } else if (masterCh && masterCh.sub) {
    hasSub = true;
  } else if (ch.sub === camId + '_sub') {
    hasSub = true;
  } else if (SPLIT_SUB_CAM_RE.test(camId)) {
    hasSub = true;
  }

  let hasHd = false;
  if (camDef) {
    hasHd = Boolean(camDef.has_hd);
  } else if (masterCh && masterCh.hd) {
    hasHd = true;
  } else if (ch.hd === camId + '_hd') {
    hasHd = true;
  } else if (SPLIT_HD_CAM_RE.test(camId)) {
    hasHd = true;
  }

  if (hasSub) {
    if (!ch.sub || ch.sub === camId) ch.sub = camId + '_sub';
  } else if (camDef && !camDef.has_sub && !camDef.sub_url && ch.sub === camId + '_sub' && !SPLIT_SUB_CAM_RE.test(camId)) {
    ch.sub = '';
  }

  if (hasHd) {
    if (!ch.hd || ch.hd === camId) ch.hd = camId + '_hd';
  } else if (camDef && !camDef.has_hd && ch.hd === camId + '_hd' && !SPLIT_HD_CAM_RE.test(camId)) {
    ch.hd = '';
  }
  return ch;
}

function loadCfg() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { /* ค่าเสีย → ใช้ default */ }
  
  if (saved.base && !saved.base.startsWith('http') && !saved.base.startsWith('/')) {
    saved.base = DEFAULTS.base;
  }
  if (saved.api && !saved.api.startsWith('http') && !saved.api.startsWith('/')) {
    saved.api = DEFAULTS.api;
  }

  // Incident 2.172: Auto-heal stale API and WebRTC base URLs in localStorage
  // If an account was previously used on LAN HTTP or different host, visiting over HTTPS or domain (e.g. vms.local)
  // on cellular data must not fail with Mixed Content errors or unreachable LAN IPs.
  if (SAME_ORIGIN) {
    try {
      if (saved.api) {
        const u = new URL(saved.api, location.origin);
        if (location.protocol === 'https:' && u.protocol === 'http:') saved.api = DEFAULTS.api;
        else if (u.host !== location.host) saved.api = DEFAULTS.api;
      }
      if (saved.base) {
        const u = new URL(saved.base, location.origin);
        if (location.protocol === 'https:' && u.protocol === 'http:') saved.base = DEFAULTS.base;
        else if (u.host !== location.host) saved.base = DEFAULTS.base;
      }
    } catch (_) {
      saved.api = DEFAULTS.api;
      saved.base = DEFAULTS.base;
    }
  }

  const cfg = { ...DEFAULTS, ...saved };
  cfg.layout = normLayout(cfg.layout); // รองรับค่าที่บันทึกไว้เดิม (เลข N) + กันค่าเสีย
  cfg.channels = Array.from({ length: MAX_CH }, (_, i) => {
    const c = { src: '', name: '', sub: '', enabled: true, ...(saved.channels || DEFAULTS.channels)[i] };
    if (c.src === 'cam11') { c.src = ''; c.name = ''; c.sub = ''; }
    return normalizeChannelStreams(c);
  });
  cfg._cachedUserProfile = saved._cachedUserProfile || null;
  cfg._cachedCameraNames = saved._cachedCameraNames || null;
  return cfg;
}
function saveCfg() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({
    base: cfg.base, api: cfg.api, demo: cfg.demo, layout: cfg.layout,
    eventsOpen: cfg.eventsOpen, channels: cfg.channels, emgrThumb: cfg.emgrThumb, pbLayout: cfg.pbLayout,
    railClasses: cfg.railClasses,
    _cachedUserProfile: (typeof state !== 'undefined' && state.userProfile) ? state.userProfile : (cfg._cachedUserProfile || null),
    _cachedCameraNames: (typeof state !== 'undefined' && state.cameraNames) ? state.cameraNames : (cfg._cachedCameraNames || null),
  })); } catch (e) { /* private mode ฯลฯ — ข้ามได้ */ }
}

const cfg = loadCfg();
if (window.innerWidth <= 899) {
  cfg.eventsOpen = false;
  const _railEl = document.getElementById('eventsRail');
  const _tabEl = document.getElementById('railTab');
  const _btnEv = document.getElementById('btnEvents');
  if (_railEl) _railEl.hidden = true;
  if (_tabEl) _tabEl.hidden = false;
  if (_btnEv) _btnEv.setAttribute('aria-pressed', 'false');
}

const isIOSBrowser = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let activeMediaJobs = new Map();
function cleanupCompatJob(video) {
  if (video && video._compatJobId) {
    activeMediaJobs.set(video._compatJobId, false);
    fetch('/api/media-compat/jobs/' + video._compatJobId + '/waiter', { method: 'DELETE' }).catch(()=>{});
    video._compatJobId = null;
    if (video.parentElement) {
      const overlay = video.parentElement.querySelector('.compat-overlay');
      if (overlay) overlay.style.display = 'none';
    }
  }
}

async function prepareAndPlayVideoCompat(payload, videoEl, onPlay, onError) {
  cleanupCompatJob(videoEl);
  let container = videoEl.closest('.vid-cnt') || videoEl.parentElement;
  let overlay = container.querySelector('.compat-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'compat-overlay';
    overlay.innerHTML = '<div class="compat-spinner"></div><div class="compat-text">กำลังเตรียมวิดีโอสำหรับอุปกรณ์นี้...</div>';
    container.appendChild(overlay);
  }
  overlay.innerHTML = '<div class="compat-spinner"></div><div class="compat-text">กำลังแปลงวิดีโอ...</div>';
  overlay.style.display = 'flex';
  
  const playVideoSafely = () => {
    overlay.style.display = 'none';
    const playPromise = videoEl.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => { if (onPlay) onPlay(); })
        .catch(err => {
          console.warn('Autoplay restricted or deferred:', err);
          // On mobile Safari, if autoplay is blocked, do NOT mark as fatal error.
          // The video element is ready with native controls.
          if (onPlay) onPlay();
        });
    } else {
      if (onPlay) onPlay();
    }
  };

  try {
    let res = await fetch('/api/media-compat/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Prepare failed');
    let data = await res.json();
    
    if (data.state === 'ready') {
      videoEl.src = data.media_url;
      playVideoSafely();
      return;
    }
    
    videoEl._compatJobId = data.job_id;
    activeMediaJobs.set(data.job_id, true);
    
    let pollCount = 0;
    const maxPolls = 60; // 60 seconds max
    while (activeMediaJobs.get(data.job_id) && pollCount < maxPolls) {
      pollCount++;
      await new Promise(r => setTimeout(r, data.retry_after_ms || 1000));
      if (!activeMediaJobs.get(data.job_id)) break;
      let pollRes = await fetch('/api/media-compat/jobs/' + data.job_id);
      if (!pollRes.ok) throw new Error('Poll failed');
      data = await pollRes.json();
      
      if (data.state === 'ready') {
        if (activeMediaJobs.get(data.job_id)) {
          videoEl.src = data.media_url;
          playVideoSafely();
        }
        break;
      } else if (data.state === 'failed' || data.state === 'cancelled') {
        throw new Error('Job ' + data.state);
      }
    }
  } catch (err) {
    console.error('Media compat error:', err);
    if (overlay && overlay.style.display !== 'none') {
      overlay.innerHTML = '<div class="compat-text" style="color:#ef4444">โหลดวิดีโอล้มเหลว</div>';
    }
    if (onError) onError();
  }
}

/**
 * Replace only the Dashboard channel map with the shared server copy.
 *
 * @returns {Promise<boolean>} True when a valid shared array was loaded; false
 * keeps the browser cache as an offline fallback.
 */
async function loadServerChannels() {
  if (cfg.demo || !SAME_ORIGIN) return false;
  try {
    // The authenticated read route is intentionally separate from the admin-only
    // mutation route so standard operators receive the same saved channel layout.
    const [namesRes, response] = await Promise.all([
      fetch('/settings/camera_names?t=' + Date.now(), { signal: timeoutSignal(4000) }).catch(() => null),
      fetch('/settings/channels?t=' + Date.now(), { cache: 'no-store', signal: timeoutSignal(4000) }).catch(() => null)
    ]);
    if (namesRes && namesRes.ok) {
        try {
          const fetchedNames = await namesRes.json();
          state.cameraNames = { ...DEFAULT_SPECIAL_CAMERA_NAMES, ...(fetchedNames || {}) };
        } catch (e) {}
    }
    if (!response || !response.ok) return false;
    const savedChannels = await response.json();
    if (!Array.isArray(savedChannels)) return false;
    // Normalize the persisted array to the fixed CH01-CH16 slot contract while
    // preserving optional channel fields such as group, LPR, and object choices.
    cfg.channels = Array.from({ length: MAX_CH }, (_, index) => {
      const channel = savedChannels[index];
      const persisted = channel && typeof channel === 'object' && !Array.isArray(channel)
        ? channel
        : {};
      return normalizeChannelStreams({ src: '', name: '', sub: '', enabled: true, ...persisted });
    });
    
    // Backfill missing cameraNames from loaded channels
    if (!state.cameraNames) state.cameraNames = {};
    cfg.channels.forEach(c => {
      if (c.src && c.name && !state.cameraNames[c.src] && c.src !== c.name) {
        state.cameraNames[c.src] = c.name;
      }
    });

    // ADR-0019: Cache System Master Grid baseline
    state.masterChannels = cfg.channels.map(c => ({ ...c }));

    // Keep localStorage synchronized only as a fallback for a later server outage.
    saveCfg();
    return true;
  } catch (error) {
    // A missing/unavailable settings service must not prevent the locally cached
    // Dashboard from starting; the next successful page load reconciles it.
    return false;
  }
}

/**
 * ADR-0019: Fetch System Master Grid from server without mutating client cfg.channels
 * Used to populate the Dashboard Settings modal (Tab 2) independently from personal user grids.
 */
async function fetchServerMasterChannels() {
  if (cfg.demo || !SAME_ORIGIN) {
    return state.masterChannels ? state.masterChannels.map(c => ({ ...c })) : null;
  }
  try {
    const res = await fetch('/settings/channels?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    const saved = await res.json();
    if (!Array.isArray(saved)) return null;
    const master = Array.from({ length: MAX_CH }, (_, index) => {
      const channel = saved[index];
      const persisted = channel && typeof channel === 'object' && !Array.isArray(channel) ? channel : {};
      return normalizeChannelStreams({ src: '', name: '', sub: '', enabled: true, ...persisted });
    });
    state.masterChannels = master.map(c => ({ ...c }));
    return master;
  } catch (e) {
    return state.masterChannels ? state.masterChannels.map(c => ({ ...c })) : null;
  }
}

/**
 * CLAUDE.md Section 10: Load personal user dashboard profile
 * Supports user-specific camera grid layouts (channels), camera visibility filters, and view modes.
 * If personal channels are saved, they override the system master grid without affecting other operators.
 */
async function loadUserProfile(prefetchedPromise = null) {
  if (cfg.demo || !SAME_ORIGIN) return null;
  try {
    const res = await (prefetchedPromise || fetch('/api/nas-bot/user/profile', { signal: timeoutSignal(3500) }).catch(() => null));
    if (res && res.ok) {
      const data = await res.json();
      if (data && data.profile) {
        state.userProfile = data.profile;
        state.gridRevision = Number(data.profile.grid_revision) || 0; // ADR-0024
        if (state.userProfile) {
          if (Array.isArray(state.userProfile.hidden_channels)) {
            state.userProfile.hidden_channels = state.userProfile.hidden_channels.filter(s => s && !s.startsWith('CH') && isNaN(Number(s)));
          }
          if (Array.isArray(state.userProfile.disabled_ai_cameras)) {
            state.userProfile.disabled_ai_cameras = state.userProfile.disabled_ai_cameras.filter(s => s && !s.startsWith('CH') && isNaN(Number(s)));
          }
          if (Array.isArray(state.userProfile.disabled_lpr_cameras)) {
            state.userProfile.disabled_lpr_cameras = state.userProfile.disabled_lpr_cameras.filter(s => s && !s.startsWith('CH') && isNaN(Number(s)));
          }
        }
        if (data.profile.layout) {
          cfg.layout = normLayout(data.profile.layout);
        }
        if (data.profile.events_open !== undefined && window.innerWidth > 899) {
          cfg.eventsOpen = !!data.profile.events_open;
        }
        // If the user has a customized Personal User Grid, apply it over the System Master Grid
        if (Array.isArray(data.profile.channels) && data.profile.channels.length > 0) {
          cfg.channels = Array.from({ length: MAX_CH }, (_, index) => {
            const channel = data.profile.channels[index];
            const persisted = channel && typeof channel === 'object' && !Array.isArray(channel)
              ? channel
              : {};
            return normalizeChannelStreams({ src: '', name: '', sub: '', enabled: true, ...persisted });
          });
          state.userProfile.channels = cfg.channels.map(c => ({ ...c }));
          if (!state.cameraNames) state.cameraNames = {};
          cfg.channels.forEach(c => {
            if (c.src && c.name && !state.cameraNames[c.src] && c.src !== c.name) {
              state.cameraNames[c.src] = c.name;
            }
          });
        }
        saveCfg();
        updateResetLayoutButton();
        return data.profile;
      }
    }
  } catch (e) {
    console.warn('Failed to load user profile from server:', e);
  }
  return null;
}

/**
 * CLAUDE.md Section 10: Save personal user dashboard profile to server and user-keyed localStorage.
 * Keeps user-level channel configurations completely isolated from global system configuration.
 */
async function saveUserProfile() {
  if (cfg.demo || !SAME_ORIGIN) return false;
  try {
    const curUser = (window.bppSession && window.bppSession.username) || '';
    const payload = {
      layout: cfg.layout,
      channels: (state.userProfile && state.userProfile.channels) ? state.userProfile.channels : null,
      visible_channels: (state.userProfile && state.userProfile.visible_channels) || [],
      hidden_channels: (state.userProfile && state.userProfile.hidden_channels) || [],
      disabled_ai_cameras: (state.userProfile && state.userProfile.disabled_ai_cameras) || [],
      disabled_lpr_cameras: (state.userProfile && state.userProfile.disabled_lpr_cameras) || [],
      events_open: cfg.eventsOpen,
      grid_revision: state.gridRevision // ADR-0024: lets the server reject writes from a stale grid
    };
    
    // Save to user-keyed localStorage
    if (curUser) {
      try {
        localStorage.setItem(LS_KEY + '-' + curUser, JSON.stringify({ ...cfg, userProfile: payload }));
      } catch (e) {}
    }
    
    const res = await fetch('/api/nas-bot/user/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const body = await res.json().catch(() => null);
      if (body && body.stale) {
        // A Superadmin changed this grid after we loaded it: our channels were not saved.
        await applyServerGridReload('ผู้ดูแลระบบปรับผังหน้าจอของคุณ — โหลดผังล่าสุดแล้ว');
      } else if (body && body.profile && body.profile.grid_revision !== undefined) {
        state.gridRevision = Number(body.profile.grid_revision) || 0;
      }
    }
    updateResetLayoutButton();
    return res.ok;
  } catch (e) {
    console.error('Failed to save user profile:', e);
    return false;
  }
}

/* ============ ADR-0024: Grid Revision, per-account AI demand, kill-switches ============ */
async function applyServerGridReload(message) {
  if (state.gridReloading) return;
  state.gridReloading = true;
  try {
    const prof = await loadUserProfile();
    if (!prof) return;
    const overlay = $('settingsOverlay');
    if (!state.impersonatingUser && state.draft && overlay && !overlay.hidden) {
      state.draft = cfg.channels.map(c => ({ ...c }));
    }
    applyAutoLayout(true);
    if (typeof syncGridDiffSmoothly === 'function') syncGridDiffSmoothly();
    else rebuildGrid();
    renderChList();
    renderChForm();
    triggerDemandReconciliation(false);
    if (window.bppToast) window.bppToast(message || 'ผู้ดูแลระบบปรับผังหน้าจอของคุณ');
  } finally {
    state.gridReloading = false;
  }
}

async function fetchAiDemandCounts() {
  if (cfg.demo || !SAME_ORIGIN) return null;
  try {
    const res = await fetch('/api/nas-bot/user/ai-demand', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    state.aiDemandCounts = data.counts || {};
    state.aiDemandUsers = data.users || {};
    return state.aiDemandCounts;
  } catch (e) {
    return null;
  }
}

function liveFrigateAiOn(src) {
  if (state.frigateDetect && Object.prototype.hasOwnProperty.call(state.frigateDetect, src)) {
    return state.frigateDetect[src] === true;
  }
  const found = Array.isArray(state.nvrCameras) ? state.nvrCameras.find(c => c.name === src) : null;
  return !!(found && found.ai_enabled === true);
}

async function sendFrigateWsCommands(commands) {
  if (!Array.isArray(commands) || !commands.length || cfg.demo || !SAME_ORIGIN) return false;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const rawPath = apiUrl('/ws');
      const wsEndpoint = /^https?:/i.test(rawPath)
        ? rawPath.replace(/^http/i, 'ws')
        : ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + (rawPath.startsWith('/') ? rawPath : '/' + rawPath));
      const ws = new WebSocket(wsEndpoint);
      const timer = setTimeout(() => {
        try { ws.close(); } catch (e) {}
        finish(false);
      }, 3000);
      ws.onopen = () => {
        try {
          commands.forEach(cmd => {
            if (cmd && cmd.topic) {
              ws.send(JSON.stringify({ topic: cmd.topic, payload: String(cmd.payload ?? '') }));
            }
          });
        } catch (e) {}
        setTimeout(() => {
          clearTimeout(timer);
          try { ws.close(); } catch (e) {}
          finish(true);
        }, 250);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        finish(false);
      };
    } catch (e) {
      finish(false);
    }
  });
}

async function setFrigateAi(src, on) {
  try {
    const res = await fetch(`/api/config/cameras/${encodeURIComponent(src)}/detect_toggle`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ detect_enabled: on }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      // Respect active AI schedule when forwarding runtime detect state over Frigate WebSocket.
      const runtimeDet = (data && typeof data.runtime_detect_enabled === 'boolean')
        ? data.runtime_detect_enabled
        : on;
      const wsCmds = on
        ? [
            { topic: `${src}/enabled/set`, payload: 'ON' },
            { topic: `${src}/detect/set`, payload: runtimeDet ? 'ON' : 'OFF' },
            { topic: `${src}/recordings/set`, payload: 'ON' },
          ]
        : [
            { topic: `${src}/detect/set`, payload: 'OFF' },
            { topic: `${src}/recordings/set`, payload: 'OFF' },
            { topic: `${src}/enabled/set`, payload: 'OFF' },
          ];
      await sendFrigateWsCommands(wsCmds);
      if (!state.frigateDetect) state.frigateDetect = {};
      state.frigateDetect[src] = on;
      if (Array.isArray(state.nvrCameras)) {
        const nc = state.nvrCameras.find(c => (c.name || c.id) === src);
        if (nc) nc.ai_enabled = on;
      }
      return { ok: true };
    }
    const err = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, detail: err.detail };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

// Frigate runs AI on a camera only while at least one account demands it (ADR-0024).
async function applyAiDeltaToFrigate(result, extraCheckCams = []) {
  let failed = 0;
  const handled = new Set();
  for (const cam of (result.ai_release || [])) {
    handled.add(cam);
    const r = await setFrigateAi(cam, false);
    if (!r.ok) failed++;
  }
  for (const cam of (result.ai_acquire || [])) {
    handled.add(cam);
    const r = await setFrigateAi(cam, true);
    if (!r.ok) failed++;
  }
  const counts = await fetchAiDemandCounts();
  if (counts && Array.isArray(extraCheckCams)) {
    for (const cam of extraCheckCams) {
      if (!cam || handled.has(cam)) continue;
      handled.add(cam);
      const wantOn = (counts[cam] || 0) > 0;
      if (!wantOn || wantOn !== liveFrigateAiOn(cam)) {
        const r = await setFrigateAi(cam, wantOn);
        if (!r.ok) failed++;
      }
    }
  }
  triggerDemandReconciliation(false);
  return failed;
}

async function refreshUserProfilesCache() {
  try {
    const res = await fetch('/api/nas-bot/admin/user-profiles', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.profiles) state.allUserProfilesCache = data.profiles;
    }
  } catch (e) { /* keep previous cache */ }
}

function isKillSwitchAuthorized() {
  const curUser = (window.bppSession && window.bppSession.username) || '';
  return ['admin', 'superadmin'].includes(userRole) || ['arm215', 'suchakree', 'bpp215'].includes(curUser);
}

function updateKillSwitchUi() {
  const strict = isKillSwitchAuthorized();
  const imp = !!state.impersonatingUser;
  const set = (id, on, disp) => { const el = $(id); if (el) el.style.display = on ? disp : 'none'; };
  set('lblBroadcastGrid', strict && !imp, 'inline-flex');
  set('ksGlobalGroup', strict, 'flex');
  set('ksAccountGroup', strict && imp, 'flex');
  if (!(strict && !imp) && $('chkBroadcastGrid')) $('chkBroadcastGrid').checked = false;
  if ($('ksAccountLabel')) $('ksAccountLabel').textContent = imp ? `บัญชี ${window.bppAccountLabel ? window.bppAccountLabel.text(state.impersonatingUser) : state.impersonatingUser}:` : 'บัญชีนี้:';
}

function countAccountsWithGrid() {
  const me = (window.bppSession && window.bppSession.username) || '';
  return Object.entries(state.allUserProfilesCache || {})
    .filter(([u, p]) => u !== me && p && ((Array.isArray(p.channels) && p.channels.length) || (Array.isArray(p.active_channels) && p.active_channels.length))).length;
}

async function runGridKillSwitch(action, scope) {
  const target = scope === 'account' ? state.impersonatingUser : null;
  if (scope === 'account' && !target) return;
  await refreshUserProfilesCache();
  const label = { stream_off: 'ปิดกล้อง (สตรีมปิด)', ai_off: 'ปิด AI', stream_on: 'เปิดกล้องกลับ' }[action];
  const who = scope === 'account' ? `บัญชี ${target}` : `ทุกบัญชี (${countAccountsWithGrid()} บัญชีที่มีผังของตัวเอง ยกเว้นบัญชีของคุณ)`;
  const note = action === 'ai_off'
    ? 'AI ของกล้องจะถูกปิดใน Frigate เมื่อไม่มีบัญชีใดเปิดไว้แล้ว'
    : (action === 'stream_off' ? 'กล้องยังผูกอยู่กับช่องเดิม เปิดกลับได้ภายหลัง' : 'ช่องที่มีกล้องจะกลับมาสตรีมตามกล้องเดิม (AI ไม่ถูกเปิดให้อัตโนมัติ)');
  if (!await window.bppConfirm(`${label} ${who}\n\n${note}\nผู้ใช้ที่ออนไลน์จะเห็นผลภายใน 1 นาที\n\nยืนยันดำเนินการ?`)) return;
  try {
    // Collect candidate cameras from target profile(s) before batch action so we can self-heal out-of-sync Frigate runtime state
    const candidateCams = new Set();
    const me = (window.bppSession && window.bppSession.username) || '';
    Object.entries(state.allUserProfilesCache || {}).forEach(([u, p]) => {
      if (scope === 'account' ? u !== target : u === me) return;
      ((p && p.channels) || []).forEach(c => { if (c && c.src) candidateCams.add(c.src); });
      ((p && p.active_channels) || []).forEach(c => { if (c && c.src) candidateCams.add(c.src); });
    });
    if (scope === 'account' && Array.isArray(state.draft)) {
      state.draft.forEach(c => { if (c && c.src) candidateCams.add(c.src); });
    }

    const res = await fetch('/api/nas-bot/admin/grid/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, scope, target_user: target }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const failed = await applyAiDeltaToFrigate(data, Array.from(candidateCams));
    await refreshUserProfilesCache();
    if (state.impersonatingUser) {
      const prof = state.allUserProfilesCache && state.allUserProfilesCache[state.impersonatingUser];
      if (prof && Array.isArray(prof.channels)) {
        state.draft = prof.channels.map(c => ({ ...c }));
      } else if (Array.isArray(state.draft)) {
        state.draft.forEach(c => {
          if (!c || !c.src) return;
          if (action === 'stream_off') c.enabled = false;
          else if (action === 'stream_on') c.enabled = true;
          else if (action === 'ai_off') c.detect = false;
        });
      }
    }
    renderChList();
    renderChForm();
    renderMyAlertsMatrix();
    const skipped = (data.skipped_no_grid || []).length;
    if (window.bppToast) {
      window.bppToast(`${label} ${who} เรียบร้อย (${(data.updated_users || []).length} บัญชี` +
        (skipped ? `, ข้าม ${skipped} บัญชีที่ยังไม่มีผังของตัวเอง` : '') + ')' +
        (failed ? ` — ปรับ AI ใน Frigate ไม่สำเร็จ ${failed} กล้อง` : ''), failed > 0);
    }
  } catch (e) {
    if (window.bppToast) window.bppToast(`${label} ไม่สำเร็จ: ${e.message}`, true);
  }
}

/**
 * CLAUDE.md Section 10: Update visibility of Reset Layout button based on whether user has custom channels
 */
function updateResetLayoutButton() {
  const btn = document.getElementById('btnResetLayout');
  if (!btn) return;
  const hasCustom = !!(state.userProfile && Array.isArray(state.userProfile.channels) && state.userProfile.channels.length > 0);
  btn.style.display = hasCustom ? 'inline-flex' : 'none';
}

/**
 * CLAUDE.md Section 10: Reset user's personal channel layout back to the System Master Grid
 */
window.resetUserChannelsToDefault = async function() {
  const ok = await window.bppConfirm('คุณต้องการคืนค่าผังกล้องบนหน้าจอของคุณ ให้กลับเป็นค่ามาตรฐานของระบบทั้งหมดหรือไม่?');
  if (!ok) return;
  if (state.userProfile) {
    state.userProfile.channels = null;
  }
  await saveUserProfile();
  await loadServerChannels();
  updateResetLayoutButton();
  applyAutoLayout(true);
  rebuildGrid();
  if (typeof renderChList === 'function') renderChList();
  if (typeof renderChForm === 'function') renderChForm();
  toast('คืนค่าผังกล้องมาตรฐานระบบบนหน้าจอของคุณเรียบร้อยแล้ว');
};

/* ============ ข้อมูลโหมดสาธิต (จาก design prototype) ============ */
const DEMO_SCENES = [
  'linear-gradient(0deg, rgba(8,10,22,.9), transparent 60%), radial-gradient(60% 80% at 50% 95%, rgba(64,72,110,.5), transparent), repeating-linear-gradient(90deg, rgba(120,130,170,.06) 0 2px, transparent 2px 60px), linear-gradient(160deg, #14182c, #0a0c18)',
  'radial-gradient(40% 60% at 70% 30%, rgba(120,140,190,.35), transparent), linear-gradient(180deg, rgba(40,48,80,.6), rgba(8,10,20,.95)), linear-gradient(120deg, #161a30, #0b0d1a)',
  'radial-gradient(50% 90% at 50% 10%, rgba(150,160,210,.3), transparent 70%), linear-gradient(180deg, rgba(30,36,64,.4), rgba(6,8,16,.95)), linear-gradient(140deg, #12162a, #090b16)',
  'radial-gradient(30% 50% at 25% 20%, rgba(180,160,120,.3), transparent), radial-gradient(30% 50% at 80% 25%, rgba(120,140,190,.25), transparent), linear-gradient(180deg, rgba(24,28,50,.5), rgba(6,8,16,.95))',
  'repeating-linear-gradient(90deg, rgba(90,100,140,.08) 0 1px, transparent 1px 48px), radial-gradient(70% 60% at 50% 100%, rgba(50,58,92,.55), transparent), linear-gradient(170deg, #11152a, #080a16)',
  'radial-gradient(45% 70% at 60% 40%, rgba(70,180,150,.18), transparent), linear-gradient(180deg, rgba(20,30,40,.5), rgba(4,8,12,.95)), linear-gradient(150deg, #0e1620, #070b12)',
];
const DEMO_CAMS = [
  ['ประตูหน้า', 'live'], ['ลานจอดรถ', 'live'], ['โถงต้อนรับ', 'live'], ['ทางเดินชั้น 2', 'videoloss'],
  ['ห้องเซิร์ฟเวอร์', 'live'], ['โกดังสินค้า', 'live'], ['รั้วด้านหลัง', 'videoloss'], ['ลิฟต์โดยสาร', 'live'],
  ['บันไดหนีไฟ', 'live'], ['ห้องประชุมใหญ่', 'live'], ['จุดรับสินค้า', 'connecting'], ['ที่จอดมอเตอร์ไซค์', 'live'],
  ['สวนหย่อม', 'live'], ['ป้อมยาม', 'live'], ['ทางออกฉุกเฉิน', 'videoloss'], ['ดาดฟ้า', 'live'],
];
const DEMO_EVENTS = [
  { cam: 1, type: 'person', mins: 2, dur: 14, conf: 96 }, { cam: 0, type: 'motion', mins: 6, dur: 8, conf: 82 },
  { cam: 5, type: 'car', mins: 9, dur: 21, conf: 91 }, { cam: 13, type: 'person', mins: 14, dur: 11, conf: 94 },
  { cam: 2, type: 'motion', mins: 18, dur: 6, conf: 71 }, { cam: 11, type: 'car', mins: 25, dur: 17, conf: 88 },
  { cam: 8, type: 'person', mins: 31, dur: 9, conf: 90 }, { cam: 5, type: 'motion', mins: 44, dur: 12, conf: 77 },
  { cam: 1, type: 'car', mins: 58, dur: 19, conf: 93 }, { cam: 9, type: 'person', mins: 73, dur: 13, conf: 89 },
  { cam: 12, type: 'motion', mins: 95, dur: 7, conf: 68 }, { cam: 0, type: 'car', mins: 120, dur: 16, conf: 85 },
];
/* ชนิดวัตถุ (coco-80) — ชื่อไทยครบ 80 + สีคงที่ต่อ label (hash)
   ถ้า key หาย/สะกดผิด UI จะ fallback เป็นชื่ออังกฤษ (|| obj) ไม่พัง */
const LABEL_TH = {
  motion: 'Motion',
  person: 'บุคคล', bicycle: 'จักรยาน', car: 'รถยนต์', motorcycle: 'มอเตอร์ไซค์',
  airplane: 'เครื่องบิน', bus: 'รถบัส', train: 'รถไฟ', truck: 'รถบรรทุก', boat: 'เรือ',
  'traffic light': 'ไฟจราจร', 'fire hydrant': 'หัวดับเพลิง', 'stop sign': 'ป้ายหยุด',
  'parking meter': 'มิเตอร์จอดรถ', bench: 'ม้านั่ง',
  bird: 'นก', cat: 'แมว', dog: 'สุนัข', horse: 'ม้า', sheep: 'แกะ', cow: 'วัว',
  elephant: 'ช้าง', bear: 'หมี', zebra: 'ม้าลาย', giraffe: 'ยีราฟ',
  backpack: 'เป้สะพาย', umbrella: 'ร่ม', handbag: 'กระเป๋าถือ', tie: 'เนกไท', suitcase: 'กระเป๋าเดินทาง',
  frisbee: 'จานร่อน', skis: 'สกี', snowboard: 'สโนว์บอร์ด', 'sports ball': 'ลูกบอลกีฬา', kite: 'ว่าว',
  'baseball bat': 'ไม้เบสบอล', 'baseball glove': 'ถุงมือเบสบอล', skateboard: 'สเก็ตบอร์ด',
  surfboard: 'กระดานโต้คลื่น', 'tennis racket': 'ไม้เทนนิส',
  bottle: 'ขวด', 'wine glass': 'แก้วไวน์', cup: 'ถ้วย/แก้ว', fork: 'ส้อม', knife: 'มีด',
  spoon: 'ช้อน', bowl: 'ชาม',
  banana: 'กล้วย', apple: 'แอปเปิล', sandwich: 'แซนด์วิช', orange: 'ส้ม', broccoli: 'บรอกโคลี',
  carrot: 'แครอท', 'hot dog': 'ฮอตดอก', pizza: 'พิซซ่า', donut: 'โดนัท', cake: 'เค้ก',
  chair: 'เก้าอี้', couch: 'โซฟา', 'potted plant': 'กระถางต้นไม้', bed: 'เตียง',
  'dining table': 'โต๊ะอาหาร', toilet: 'โถส้วม',
  tv: 'โทรทัศน์', laptop: 'แล็ปท็อป', mouse: 'เมาส์', remote: 'รีโมต', keyboard: 'คีย์บอร์ด',
  'cell phone': 'โทรศัพท์มือถือ',
  microwave: 'ไมโครเวฟ', oven: 'เตาอบ', toaster: 'เครื่องปิ้งขนมปัง', sink: 'อ่างล้าง',
  refrigerator: 'ตู้เย็น',
  book: 'หนังสือ', clock: 'นาฬิกา', vase: 'แจกัน', scissors: 'กรรไกร',
  'teddy bear': 'ตุ๊กตาหมี', 'hair drier': 'ไดร์เป่าผม', toothbrush: 'แปรงสีฟัน',
};
const OBJ_PALETTE = ['#34e2a8', '#c084fc', '#60a5fa', '#fbbf24', '#fb7185', '#f472b6', '#38bdf8', '#a3e635', '#fb923c', '#2dd4bf', '#818cf8', '#e879f9'];
// วัตถุที่ track ได้ครบ 80 ตามลำดับ COCO index (bus=5, truck=7 เลือกได้จริงผ่าน
// model.labelmap override ใน config.yml — ถ้า Frigate ยังไม่ restart chip จะ disabled)
const ALL_OBJECTS = ['person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'];
// 3 กลุ่มในหน้าตั้งค่า: ความปลอดภัย (คัดมือ 15) + สัตว์ (10 ตาม COCO) + วัตถุทั่วไป (derive ที่เหลือ 55)
const SECURITY_GROUP = ['person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'knife', 'scissors', 'baseball bat', 'backpack', 'handbag', 'suitcase'];
const ANIMAL_GROUP = ['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe'];
const GENERAL_GROUP = ALL_OBJECTS.filter(o => !SECURITY_GROUP.includes(o) && !ANIMAL_GROUP.includes(o));
// ลำดับเก็บค่า: ความปลอดภัย → สัตว์ → ทั่วไป — toggleObj/setObjPreset filter ตามลำดับนี้
const OBJECT_ORDER = SECURITY_GROUP.concat(ANIMAL_GROUP, GENERAL_GROUP);
const MAX_OBJECTS = 10; // โควตาสูงสุดต่อกล้อง (เกินนี้ detector ทำงานหนักเกินจำเป็น)
// ชุดแนะนำ (≤10) ผูกปุ่ม preset ในหน้าตั้งค่า
const RECOMMENDED_PRESET = ['person', 'car', 'motorcycle', 'bicycle', 'bus', 'truck', 'knife', 'backpack'];

// ── Notification Alert Chip Groups (หน้าต่างตั้งค่าการแจ้งเตือน Telegram) ──
// แบ่ง 3 กลุ่ม: ความปลอดภัย (3 ชนิด) + ยานพาหนะ (5 ชนิด) + ทะเบียนเฝ้าระวัง (1 ชนิด) รวมเป็น 9 ชนิด
const ALERT_SECURITY_GROUP = ['person', 'knife', 'backpack'];
const ALERT_VEHICLE_GROUP  = ['car', 'motorcycle', 'bicycle', 'bus', 'truck'];
const ALERT_WATCHLIST_GROUP = ['watchlist_plate'];
const ALERT_ALL_OBJECTS = ALERT_SECURITY_GROUP.concat(ALERT_VEHICLE_GROUP, ALERT_WATCHLIST_GROUP);
const ALERT_LABEL_TH = {
  ...LABEL_TH,
  watchlist_plate: 'ทะเบียนเฝ้าระวัง'
};
function typeOf(label) { return label || 'motion'; } // ใช้ label จริงจาก Frigate (ไม่ยุบเป็น motion)

// อ่านผลอ่านป้ายทะเบียนจาก raw event object ของ Frigate API (list หรือ detail ก็ได้
// โครงเดียวกัน) — lpr-service เขียนผลกลับสองช่องทาง: sub_label (ทะเบียน+จังหวัด
// พร้อมแสดงผล) และ data.recognized_license_plate (เฉพาะทะเบียน, ไว้ค้นหา/เทียบ)
// ให้ sub_label ชนะก่อนเพราะมีจังหวัดต่อท้ายอ่านง่ายกว่าในการ์ด
function isPlateString(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (!s || s === ' ' || s === 'รอสอนAI') return false;
  if (s.startsWith('ตรวจพบ') || s.startsWith('ตรวจการณ์') || s.startsWith('บุกรุก') || s.startsWith('การเคลื่อนไหว')) return false;
  if (/Detection|Crossing|Intrusion|Motion|Tampering|Entrance|Exit/i.test(s)) return false;
  return true;
}

function plateOf(rawEv) {
  if (!rawEv) return '';
  if (rawEv.sub_label === ' ') return ''; // ' ' means explicitly deleted
  if (rawEv.data && rawEv.data.recognized_license_plate) return rawEv.data.recognized_license_plate;
  if (rawEv.sub_label && isPlateString(rawEv.sub_label)) return rawEv.sub_label;
  return '';
}
function typeMeta(label) {
  const key = typeOf(label);
  if (key === 'motion') return { label: 'Motion', color: '#fbbf24' };
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return { label: LABEL_TH[key] || key, color: OBJ_PALETTE[h % OBJ_PALETTE.length] };
}

/* ============ utilities ============ */
const $ = id => document.getElementById(id);
const pad2 = n => String(n).padStart(2, '0');
const chLabel = i => 'CH' + pad2(i + 1);
function fmtTime(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
function fmtDate(d) {
  const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const mon = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return 'วัน' + days[d.getDay()] + ' ' + d.getDate() + ' ' + mon[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}
function fmtAgo(mins) {
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return Math.floor(mins) + ' นาทีที่แล้ว';
  if (mins < 1440) return Math.floor(mins / 60) + ' ชม. ' + Math.floor(mins % 60) + ' นาทีที่แล้ว';
  return Math.floor(mins / 1440) + ' วันที่แล้ว';
}
function fmtDur(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + pad2(sec % 60); }
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
// Live video and Frigate APIs always stay on this authenticated TLS gateway.
// Federation is deliberately server-to-server and exports only minimized
// Watchlist data, so browser helpers never construct direct peer URLs.
function wsUrl(base) {
  return base.replace(/^http/, 'ws').replace(/\/+$/, '') + '/api/ws';
}
function apiUrl(path) {
  return cfg.api.replace(/\/+$/, '') + path;
}
// ทุก write (PUT/POST) ไป Frigate ต้องมี X-CSRF-Token: middleware ของ Frigate ตอบ
// 401 "Missing CSRF header" กับ non-GET ที่มี Origin (browser แนบเสมอ) แต่ไม่มี header นี้
// — Frigate เช็คแค่ "มี header" ไม่เช็คค่า (fastapi_app.py check_csrf)
const FRIGATE_WRITE_HEADERS = { 'Content-Type': 'application/json', 'X-CSRF-Token': '1' };

// AbortSignal.timeout มีเฉพาะเบราว์เซอร์ปี 2022+ — จอ kiosk/แท็บเล็ตเก่าไม่มี ต้องมี fallback
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  if (typeof AbortController === 'undefined') return undefined;
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

// navigator.clipboard มีเฉพาะ secure context — production เสิร์ฟผ่าน http ในวง LAN จึงต้องมี fallback
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return; }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed; top:0; left:0; opacity:0;';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { /* ok คงเป็น false */ }
  ta.remove();
  if (!ok) throw new Error('copy failed');
}

let toastT = null;
function toast(msg) {
  $('toastMsg').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { $('toast').hidden = true; }, 2600);
}
window.bppToast = function(msg) { toast(msg); };

/* ============ Camera: go2rtc WebRTC ผ่าน WebSocket signaling ============ */
// เพิ่มเป็น 15000ms เพื่อรองรับกล้อง H.264/HEVC ที่ GOP ยาว 2-4 วินาที หรือกล้อง DDNS/4G ที่ต้องรอ Keyframe แรกจากต้นทาง (Phase P0 Zero-Drop)
const CONNECT_TIMEOUT = 15000;
const RETRY_STEPS = [5000, 10000, 20000, 30000];
const RECONNECT_GRACE_MS = 8000;   // แช่เฟรมสุดท้ายเงียบๆ สูงสุด 8 วินาทีระหว่างต่อใหม่สั้นๆ หากเกินกว่านั้นต้องแสดงสถานะ RECONNECT ตามจริง (Incident 2.181)
const RECONNECT_JITTER_MS = 3000;  // กระจาย reconnect delay สุ่ม 0-3s ป้องกัน thundering herd ที่ NVR

/**
 * เลือกชื่อ go2rtc stream ที่ "เล่นในเบราว์เซอร์ได้จริง" สำหรับมุมมองภาพใหญ่ของ channel
 *
 * ลำดับ: ch.hd → ch.sub → ch.src
 * - ch.hd  (<cam>_hd) = main + NVENC H.264 แบบ on-demand — คมที่สุดและเล่นได้
 * - ch.sub (<cam>_sub) = สตรีมรอง NVENC H.264 — ความละเอียดต่ำกว่าแต่เล่นได้แน่นอน
 * - ch.src = สตรีมดิบที่ Frigate ใช้บันทึก ซึ่งตั้งเป็น `#video=copy` (HEVC) ตั้งแต่
 *   2026-08-07 — WebRTC ของเบราว์เซอร์เล่นไม่ได้ และ go2rtc เองยังดึงเฟรมไม่ออก
 *   (`/api/frame.jpeg?src=<cam>` ตอบ HTTP 500) จึงเป็นทางเลือกสุดท้ายเท่านั้น
 *
 * เดิมโค้ดตกไป ch.src ทันทีที่ไม่มี ch.hd ทำให้กรณี metadata ค้าง (เปลี่ยนชื่อกล้อง,
 * config-api รุ่นเก่าที่ยังไม่ส่ง has_hd) ได้จอดำวน retry ไม่จบโดยไม่มี error แจ้ง
 * การแทรก ch.sub ไว้ตรงกลางทำให้กรณีนั้นยังเห็นภาพ แค่ความละเอียดต่ำลง
 *
 * @param {object} ch channel object จาก cfg.channels
 * @returns {string} ชื่อ stream สำหรับส่งให้ go2rtc (อาจว่างถ้า channel ยังไม่ผูกกล้อง)
 */
function playableMainStream(ch) {
  if (!ch) return '';
  normalizeChannelStreams(ch);
  return ch.hd || ch.sub || ch.src;
}

function playableGridStream(ch) {
  if (!ch) return '';
  normalizeChannelStreams(ch);
  return ch.sub || ch.hd || ch.src;
}

/**
 * CLAUDE.md Section 10: Central Reverse Proxy URL Rewriter for External Streams
 * Routes external HLS streams through Nginx reverse proxies to prevent CORS/SSL failures:
 * - 38.159.250.22 -> /proxy-ubon/
 * - hj50ac9nwcc.sn.mynetname.net:18191 -> /proxy-roiet/
 * - camerai1.iticfoundation.org -> /proxy-doh-camerai1/
 * - streaming1.highwaytraffic.go.th -> /proxy-doh-streaming1/
 * - streaming2.highwaytraffic.go.th -> /proxy-doh-streaming2/
 * - streaming.udoncity.go.th:1935 -> /proxy-udoncity/
 */
function rewriteHlsProxyUrl(url) {
  if (!url || typeof url !== 'string') return url;
  let cleanUrl = url.split('#')[0].trim();
  if (cleanUrl.startsWith('ffmpeg:')) cleanUrl = cleanUrl.substring(7).trim();

  // Strip leading transport flags if present (e.g. "-rtsp_transport tcp http://...")
  if (cleanUrl.includes('http://') || cleanUrl.includes('https://')) {
    const httpIdx = cleanUrl.indexOf('http://');
    const httpsIdx = cleanUrl.indexOf('https://');
    const targetIdx = (httpsIdx !== -1 && (httpIdx === -1 || httpsIdx < httpIdx)) ? httpsIdx : httpIdx;
    if (targetIdx > 0) cleanUrl = cleanUrl.substring(targetIdx).trim();
  }

  if (/^https?:\/\/38\.159\.250\.22\//.test(cleanUrl)) {
    return cleanUrl.replace(/^https?:\/\/38\.159\.250\.22\//, '/proxy-ubon/');
  }
  if (/^https?:\/\/hj50ac9nwcc\.sn\.mynetname\.net:18191\//.test(cleanUrl)) {
    return cleanUrl.replace(/^https?:\/\/hj50ac9nwcc\.sn\.mynetname\.net:18191\//, '/proxy-roiet/');
  }
  if (/^https?:\/\/camerai1\.iticfoundation\.org\//.test(cleanUrl)) {
    return cleanUrl.replace(/^https?:\/\/camerai1\.iticfoundation\.org\//, '/proxy-doh-camerai1/');
  }
  if (/^https?:\/\/streaming1\.highwaytraffic\.go\.th\//.test(cleanUrl)) {
    return cleanUrl.replace(/^https?:\/\/streaming1\.highwaytraffic\.go\.th\//, '/proxy-doh-streaming1/');
  }
  if (/^https?:\/\/streaming2\.highwaytraffic\.go\.th\//.test(cleanUrl)) {
    return cleanUrl.replace(/^https?:\/\/streaming2\.highwaytraffic\.go\.th\//, '/proxy-doh-streaming2/');
  }
  if (/^https?:\/\/streaming\.udoncity\.go\.th:1935\//.test(cleanUrl)) {
    return cleanUrl.replace(/^https?:\/\/streaming\.udoncity\.go\.th:1935\//, '/proxy-udoncity/');
  }
  return cleanUrl;
}
window.rewriteHlsProxyUrl = rewriteHlsProxyUrl;

function getHlsUrl(src) {
  if (!src || typeof src !== 'string') return null;
  const base = src.replace(/_(sub|hd|main)$/i, '');
  let url = null;
  if (window.DYNAMIC_HLS_MAP) {
    url = window.DYNAMIC_HLS_MAP[src] || window.DYNAMIC_HLS_MAP[base];
  }
  if (!url && window.cachedCameraGPS) {
    const cam = window.cachedCameraGPS[src] || window.cachedCameraGPS[base];
    if (cam && cam.url) {
      url = cam.url;
    }
  }
  if (url) {
    return rewriteHlsProxyUrl(url);
  }
  return null;
}

// กล้องกรมทางหลวง (DOH) ใช้ Wowza ที่มีเพียง 3 segments ในหน้าต่างสตรีม แต่ค้างค่า #EXT-X-TARGETDURATION สูงสุดตลอดกาล
// จึงต้อง normalize TARGETDURATION และซิงก์เข้ากึ่งกลาง segment ที่ 2 เสมอ (Incident 2.119)
function isDohHlsSource(srcOrUrl) {
  if (!srcOrUrl || typeof srcOrUrl !== 'string') return false;
  if (/^doh_/i.test(srcOrUrl) || /^\/proxy-doh-streaming[12]\//.test(srcOrUrl)) return true;
  const u = getHlsUrl(srcOrUrl);
  return !!u && /^\/proxy-doh-streaming[12]\//.test(u);
}
window.isDohHlsSource = isDohHlsSource;

function createDohPlaylistLoader(getHlsInstance) {
  const BaseLoader = (window.Hls && Hls.DefaultConfig && Hls.DefaultConfig.loader) ? Hls.DefaultConfig.loader : null;
  if (!BaseLoader) return undefined;
  return class DohPlaylistLoader extends BaseLoader {
    load(context, config, callbacks) {
      const origSuccess = callbacks.onSuccess;
      callbacks.onSuccess = (response, stats, ctx, networkDetails) => {
        if (response && typeof response.data === 'string' && response.data.includes('#EXT-X-TARGETDURATION:')) {
          const infMatches = [...response.data.matchAll(/#EXTINF:([\d.]+)/g)]
            .map(m => parseFloat(m[1]))
            .filter(n => Number.isFinite(n) && n > 0);
          const dLast = infMatches.length ? infMatches[infMatches.length - 1] : 6;
          const normTd = Math.max(3, Math.min(6, Math.floor(dLast)));
          response.data = response.data.replace(/#EXT-X-TARGETDURATION:\d+/g, `#EXT-X-TARGETDURATION:${normTd}`);

          const hlsInst = typeof getHlsInstance === 'function' ? getHlsInstance() : null;
          if (hlsInst && hlsInst.config && infMatches.length >= 2) {
            const dPrev = infMatches[infMatches.length - 2];
            const totalDur = infMatches.reduce((a, b) => a + b, 0);
            const targetSync = Math.max(normTd + 1, Math.min(35, Math.round((dLast + 0.5 * dPrev) * 10) / 10));
            if (!hlsInst._dohSyncInit) {
              hlsInst._dohSyncInit = true;
              hlsInst.config.liveSyncDuration = targetSync;
              hlsInst.config.liveMaxLatencyDuration = Math.max(60, Math.round(totalDur + 25));
            }
          }
        }
        origSuccess(response, stats, ctx, networkDetails);
      };
      super.load(context, config, callbacks);
    }
  };
}
window.createDohPlaylistLoader = createDohPlaylistLoader;

function isFieldMobileStream(src, chName = '') {
  if (!src && !chName) return false;
  const s = String(src || '').toLowerCase();
  const n = String(chName || '').toLowerCase();
  const pattern = /bodyarm|falcon|drone|live|mobile|cellular|field|4g|5g|ติดตัว|โดรน|ภาคสนาม|วิหค/i;
  return pattern.test(s) || pattern.test(n);
}

const isMobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
const isIOSDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isLocalLanHost = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(window.location.hostname || '');
const streamTransportState = {
  preferMSE: !isLocalLanHost || isMobileDevice,
  webrtcFailures: 0,
  markWebrtcFailure() {
    this.webrtcFailures++;
    if (this.webrtcFailures >= 1) {
      this.preferMSE = true;
    }
  }
};

function captureVideoPoster(videoEl, maxW = 480) {
  if (!videoEl) return '';
  if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
    try {
      const c = document.createElement('canvas');
      const scale = Math.min(1, maxW / videoEl.videoWidth);
      c.width = Math.max(1, Math.round(videoEl.videoWidth * scale));
      c.height = Math.max(1, Math.round(videoEl.videoHeight * scale));
      const ctx = c.getContext('2d');
      let dataUrl = '';
      if (ctx) {
        ctx.drawImage(videoEl, 0, 0, c.width, c.height);
        dataUrl = c.toDataURL('image/jpeg', 0.72);
      }
      c.width = 0;
      c.height = 0;
      return dataUrl;
    } catch (e) {}
  }
  return videoEl.poster || '';
}

class Camera {
  constructor(src, videoEl, onStatus, opts) {
    if (typeof src === 'string' && src && !/_(sub|hd|main)$/i.test(src) && !getHlsUrl(src)) {
      if (SPLIT_SUB_CAM_RE.test(src)) {
        src = src + '_sub';
      } else if (SPLIT_HD_CAM_RE.test(src)) {
        src = src + '_hd';
      }
    }
    this.src = src;
    this.opts = opts || {};
    this.video = videoEl;
    if (this.video) {
      try {
        this.video.style.transform = 'translateZ(0)';
        this.video.style.willChange = 'transform';
      } catch (e) {}
    }
    this.onStatus = onStatus;
    this.hlsLite = opts && opts.hlsLite;
    this.ws = null; this.pc = null;
    this.hls = null;
    this.hlsStartT = null;
    this.retryN = 0; this.retryT = null; this.timeoutT = null;
    this.watchdogT = null;
    this.pingT = null;
    this.webrtcFallbackT = null;
    this.viewerHoldT = null;
    this.viewerPaused = false;
    this.lastFrameTime = 0;
    // ติดตามเวลาที่ได้รับแพ็กเก็ตวิดีโอล่าสุดจาก WebSocket แยกจากเวลาเรนเดอร์ของ <video> (Phase P0 Zero-Drop)
    this.lastPacketTime = 0;
    // นับจำนวนครั้งที่ทำ Soft Recovery กระโดดไปขอบสตรีมสดก่อนตัดสินใจตัดการเชื่อมต่อจริง
    this.softRecoveryCount = 0;
    this.lastCurrentTime = -1;
    this._lastDecodedFrames = 0;
    this._lastFpsCheckTime = 0;
    this.wasLive = false;
    this.isLive = false;
    this.dead = false;
    this.preferMSE = Boolean((opts && opts.preferMSE) || streamTransportState.preferMSE);
    this.currentMode = this.preferMSE ? 'mse' : 'webrtc';
    this.startMSE = null;
    this.onTimeUpdate = null;
    this.onPlaying = null;
    const startDelayMs = (opts && Number(opts.startDelayMs) > 0) ? Number(opts.startDelayMs) : 0;
    if (startDelayMs > 0) {
      this.retryT = setTimeout(() => this.connect(), startDelayMs);
    } else {
      this.connect();
    }
  }

  clearVideoForMjpeg() {
    if (!this.video) return;
    try { this.video.pause(); } catch (e) {}
    this.video.srcObject = null;
    if (this.video.src) {
      this.video.removeAttribute('src');
      try { this.video.load(); } catch (e) {}
    }
    if (this.msUrl) {
      try { URL.revokeObjectURL(this.msUrl); } catch (e) {}
      this.msUrl = null;
    }
    this.ms = null;
    this.sb = null;
  }

  markLive() {
    if (this.dead || this.isLive) return;
    this.isLive = true;
    this.wasLive = true;
    this._graceStart = 0; // รีเซ็ตเวลา grace period เมื่อสตรีมกลับมาเล่นได้สมบูรณ์ (ADR-0026)
    clearTimeout(this.timeoutT);
    if (this.webrtcFallbackT) {
      clearTimeout(this.webrtcFallbackT);
      this.webrtcFallbackT = null;
    }
    this.retryN = 0;
    this._reconnAttempt = 0;
    this.lastFrameTime = Date.now();
    this.lastPacketTime = Date.now();
    this.softRecoveryCount = 0;
    if (this.video && this.video.poster && this.currentMode !== 'mjpeg' && this.currentMode !== 'snapshot') {
      this.video.removeAttribute('poster');
    }
    this.onStatus('live');
  }

  connect() {
    if (this.dead) return;
    this.cleanupPeer();
    this.paused = false;
    this._mseSoftRecovered = false;
    this._mseSoftRecoverTime = 0;
    this._appendErrCount = 0;
    this._watchdogDecodedFrames = 0;
    this._lastTimeUpdateFrames = 0;
    // ADR-0026 Grace Period: ถ้าสตรีมเคยเล่นได้และยังอยู่ในช่วง 8 วินาทีแรก ไม่ต้องแสดงสถานะ connecting (แช่ภาพเงียบๆ)
    const inGrace = this.wasLive && this._graceStart && ((Date.now() - this._graceStart) < RECONNECT_GRACE_MS);
    if (!inGrace) {
      if (this.wasLive) {
        this.onStatus('reconnecting');
      } else {
        this.onStatus('connecting');
      }
    }

    const hlsUrl = getHlsUrl(this.src);
    if (hlsUrl) {
      this.connectHls(hlsUrl);
      return;
    }

    let url;
    try { url = wsUrl(cfg.base) + '?src=' + encodeURIComponent(this.src) + '&media=video+audio'; }
    catch (e) { this.fail(); return; }

    this.timeoutT = setTimeout(() => this.fail(), CONNECT_TIMEOUT);

    let ws;
    try { ws = new WebSocket(url); } catch (e) { this.fail(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    // Sequential WebRTC-first with clean MSE fallback (Zero concurrent stream duplication)
    const hasMSE = ('MediaSource' in window || 'ManagedMediaSource' in window);
    const hasWebRTC = typeof RTCPeerConnection !== 'undefined';
    let ms = null;
    let sb = null;
    let mseBuf = new Uint8Array(4 * 1024 * 1024);
    let mseBufLen = 0;
    let triedWebRTC = false;
    let triedMSE = false;
    this.mseLive = false;
    let currentMode = 'webrtc'; // 'webrtc' | 'mse' | 'mjpeg' | 'snapshot'
    this.currentMode = currentMode;

    const fallbackAfterTransportExhausted = () => {
      if (this.dead) return;
      if (isIOSDevice) {
        this.startSnapshotStream();
      } else {
        this.fail();
      }
    };

    const safeAppendMse = chunk => {
      if (!sb || sb.updating) return false;
      if ((this.ms && this.ms.readyState !== 'open') || (this.video && this.video.error)) {
        this.fail();
        return false;
      }
      try {
        sb.appendBuffer(chunk);
        this._appendErrCount = 0;
        return true;
      } catch (err) {
        mseBufLen = 0;
        if (
          (err && err.name === 'InvalidStateError') ||
          (this.ms && this.ms.readyState !== 'open') ||
          (this.video && this.video.error)
        ) {
          console.warn(`[MSE ${this.src}] SourceBuffer/MediaSource invalid state (${err && err.name}), reconnecting`);
          this.fail();
          return false;
        }
        this._appendErrCount = (this._appendErrCount || 0) + 1;
        if (this._appendErrCount >= 6) {
          console.warn(`[MSE ${this.src}] Repeated appendBuffer errors (${this._appendErrCount}), reconnecting`);
          this.fail();
          return false;
        }
        try {
          if (sb.buffered && sb.buffered.length > 0 && !sb.updating) {
            const s0 = sb.buffered.start(0);
            const e0 = sb.buffered.end(sb.buffered.length - 1);
            if (e0 - s0 > 1.5) {
              sb.remove(s0, Math.max(s0 + 0.5, e0 - 2.0));
            }
          }
        } catch (remErr) {}
        return false;
      }
    };

    const startMSE = () => {
      if (this.dead || currentMode === 'mse' || currentMode === 'snapshot' || !this.video) return;
      triedMSE = true;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn(`[Stream ${this.src}] WebSocket closed during MSE switch, forcing reconnect with MSE preference`);
        this.preferMSE = true;
        streamTransportState.markWebrtcFailure();
        this.fail();
        return;
      }
      clearTimeout(this.webrtcFallbackT);
      this.webrtcFallbackT = null;
      clearTimeout(this.timeoutT);
      this.timeoutT = setTimeout(() => this.fail(), CONNECT_TIMEOUT);

      // Cleanly teardown WebRTC peer connection so zero UDP packets continue downloading
      if (this.pc) {
        this.pc.ontrack = this.pc.onicecandidate = this.pc.onconnectionstatechange = null;
        try { this.pc.close(); } catch (e) {}
        this.pc = null;
      }

      if (!hasMSE) {
        if (hasWebRTC && !triedWebRTC) {
          startWebRTC();
        } else {
          fallbackAfterTransportExhausted();
        }
        return;
      }

      currentMode = 'mse';
      this.currentMode = 'mse';
      this.preferMSE = true;
      streamTransportState.markWebrtcFailure();

      console.debug(`[Stream ${this.src}] Activating clean MSE fallback over WebSocket`);
      const MediaSourceClass = window.ManagedMediaSource || window.MediaSource;
      ms = new MediaSourceClass();
      this.ms = ms;
      let mseOpened = false;

      ms.addEventListener('sourceopen', () => {
        mseOpened = true;
        if (this.dead || this.ms !== ms) return;
        if (ws && ws.readyState === WebSocket.OPEN) {
          const supportedCodecs = [
            'avc1.64001E', 'avc1.64001F', 'avc1.640020', 'avc1.640028',
            'avc1.640029', 'avc1.64002A', 'avc1.640033',
            'avc1.4d401e', 'avc1.4d401f', 'avc1.4d4028', 'avc1.42e01e',
            'hvc1.1.6.L93.B0', 'hev1.1.6.L93.B0', 'mp4a.40.2'
          ].filter(c => {
            try { return MediaSourceClass.isTypeSupported(`video/mp4; codecs="${c}"`); } catch (e) { return false; }
          }).join();
          ws.send(JSON.stringify({ type: 'mse', value: supportedCodecs }));
        }
      }, { once: true });

      // iOS Low Power Mode / >4 ManagedMediaSource limit can block MediaSource from firing 'sourceopen'.
      setTimeout(() => {
        if (this.dead || this.ms !== ms || mseOpened || currentMode !== 'mse') return;
        console.warn(`[Stream ${this.src}] MediaSource sourceopen blocked -> falling back`);
        if (hasWebRTC && !triedWebRTC && ws && ws.readyState === WebSocket.OPEN) {
          startWebRTC();
        } else {
          fallbackAfterTransportExhausted();
        }
      }, 2800);

      this.video.preload = 'auto';
      if (this.video.srcObject) {
        this.video.srcObject = null;
      }
      if ('ManagedMediaSource' in window) {
        this.video.disableRemotePlayback = true;
        try {
          this.video.srcObject = ms;
        } catch (e) {
          const msUrl = URL.createObjectURL(ms);
          this.msUrl = msUrl;
          this.video.src = msUrl;
        }
      } else {
        const msUrl = URL.createObjectURL(ms);
        this.msUrl = msUrl;
        this.video.src = msUrl;
        this.video.srcObject = null;
      }
      if (this.unmutedByUser || (typeof state !== 'undefined' && state.unmutedSrc === this.src)) {
        this.video.muted = false;
        this.video.volume = 1.0;
      } else {
        this.video.muted = true;
      }
      this.video.playbackRate = 1.0;
      this.video.play().catch(() => {});
    };
    this.startMSE = startMSE;

    const startWebRTC = async () => {
      triedWebRTC = true;
      if (!hasWebRTC) {
        if (hasMSE && !triedMSE) startMSE();
        else fallbackAfterTransportExhausted();
        return;
      }

      currentMode = 'webrtc';
      this.currentMode = 'webrtc';
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      this.pc = pc;
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = ev => {
        if (currentMode !== 'webrtc') return;
        const stream = (ev.streams && ev.streams[0]) || (ev.track ? new MediaStream([ev.track]) : null);
        if (!stream) return;
        const isField = isFieldMobileStream(this.src, this.opts && this.opts.chName);
        if (ev.receiver && 'playoutDelayHint' in ev.receiver) {
          try { ev.receiver.playoutDelayHint = isField ? 1.2 : 0.25; } catch (e) {}
        }
        if (this.video && this.video.srcObject !== stream) {
          if (this.video.src) {
            this.video.removeAttribute('src');
            try { this.video.load(); } catch (e) {}
          }
          this.video.srcObject = stream;
          if (this.unmutedByUser || (typeof state !== 'undefined' && state.unmutedSrc === this.src)) {
            this.video.muted = false;
            this.video.volume = 1.0;
          } else {
            this.video.muted = true;
          }
          this.video.playbackRate = 1.0;
          this.video.play().catch(() => {});
        }
        const tracks = stream.getVideoTracks();
        if (tracks.length > 0) {
          const track = tracks[0];
          track.onmute = () => {
            if (!this.dead && this.pc === pc && currentMode === 'webrtc') {
              setTimeout(() => {
                if (!this.dead && this.pc === pc && track.muted && !this.paused && currentMode === 'webrtc') {
                  if (hasMSE && !triedMSE && !this.isLive) startMSE();
                  else if (!this.isLive) fallbackAfterTransportExhausted();
                  else this.fail();
                }
              }, 4000);
            }
          };
          track.onunmute = () => {
            this.lastFrameTime = Date.now();
          };
        }
      };

      pc.onicecandidate = ev => {
        if (currentMode === 'webrtc' && ev.candidate && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'webrtc/candidate', value: ev.candidate.candidate }));
        }
      };

      pc.onconnectionstatechange = () => {
        if (this.dead || this.pc !== pc || currentMode !== 'webrtc') return;
        if (pc.connectionState === 'connected') {
          clearTimeout(this.timeoutT);
          this.retryN = 0;
          this._reconnAttempt = 0;
          this.lastFrameTime = Date.now();
          this.startWatchdog();
          if (this.video && this.video.videoWidth > 0) {
            clearTimeout(this.webrtcFallbackT);
            this.webrtcFallbackT = null;
            this.markLive();
          }
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          if (hasMSE && !triedMSE && currentMode === 'webrtc' && !this.isLive) {
            startMSE();
          } else if (!this.isLive) {
            fallbackAfterTransportExhausted();
          } else {
            this.fail();
          }
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'webrtc/offer', value: offer.sdp }));
        }
      } catch (e) {
        if (hasMSE && !triedMSE) startMSE();
        else fallbackAfterTransportExhausted();
      }

      // WebRTC frame watchdog: if video frames don't actually decode within fallbackDelay, fallback to MSE!
      const fallbackDelay = isFieldMobileStream(this.src, this.opts && this.opts.chName) ? 6500 : 3800;
      clearTimeout(this.webrtcFallbackT);
      this.webrtcFallbackT = setTimeout(() => {
        if (this.dead) return;
        if (currentMode === 'webrtc') {
          const hasVideoRendering = this.video && this.video.videoWidth > 0;
          const isConnected = this.pc && this.pc.connectionState === 'connected';
          if (!isConnected || !hasVideoRendering) {
            console.warn(`[Stream ${this.src}] WebRTC not rendering video within ${fallbackDelay}ms -> falling back`);
            if (hasMSE && !triedMSE) {
              startMSE();
            } else if (!hasVideoRendering) {
              fallbackAfterTransportExhausted();
            }
          }
        }
      }, fallbackDelay);
    };

    if (this.video) {
      this.lastFrameTime = Date.now();
      this.lastCurrentTime = -1;
      this.onTimeUpdate = () => {
        if (this.video && this.video.currentTime !== this.lastCurrentTime) {
          this.lastCurrentTime = this.video.currentTime;
          if (this.video.videoWidth > 0) {
            // ตรวจสอบว่าเฟรมวิดีโอถูกถอดรหัสเพิ่มขึ้นจริง ไม่ใช่เวลาขยับเฉพาะแทร็กเสียงขณะที่ภาพค้าง (Incident 2.181)
            let frameAdvanced = true;
            if (typeof this.video.getVideoPlaybackQuality === 'function') {
              const q = this.video.getVideoPlaybackQuality();
              if (q && typeof q.totalVideoFrames === 'number') {
                if (q.totalVideoFrames > (this._lastTimeUpdateFrames || 0)) {
                  this._lastTimeUpdateFrames = q.totalVideoFrames;
                  this._watchdogDecodedFrames = q.totalVideoFrames;
                } else if ((this._lastTimeUpdateFrames || 0) > 0) {
                  frameAdvanced = false;
                }
              }
            }
            if (frameAdvanced) {
              this.lastFrameTime = Date.now();
              if (this.video.poster && this.currentMode !== 'mjpeg' && this.currentMode !== 'snapshot') {
                this.video.removeAttribute('poster');
              }
              if (this.webrtcFallbackT) {
                clearTimeout(this.webrtcFallbackT);
                this.webrtcFallbackT = null;
              }
              if (!this.isLive) {
                this.markLive();
              }
            }
          }
        }
      };
      this.video.addEventListener('timeupdate', this.onTimeUpdate);
      this.onPlaying = () => {
        if (this.video && this.video.videoWidth > 0) {
          this.lastFrameTime = Date.now();
          if (this.video.poster && this.currentMode !== 'mjpeg' && this.currentMode !== 'snapshot') {
            this.video.removeAttribute('poster');
          }
          if (this.webrtcFallbackT) {
            clearTimeout(this.webrtcFallbackT);
            this.webrtcFallbackT = null;
          }
          if (!this.isLive) {
            this.markLive();
          }
        }
      };
      this.video.addEventListener('playing', this.onPlaying);
      this.video.addEventListener('loadeddata', this.onPlaying);
      this.onError = () => {
        if (!this.dead && this.currentMode === 'mse' && this.video && this.video.error) {
          console.warn(`[MSE ${this.src}] Video element decode error (${this.video.error.code}), reconnecting`);
          this.fail();
        }
      };
      this.video.addEventListener('error', this.onError);
    }

    ws.onopen = async () => {
      if (this.pingT) clearInterval(this.pingT);
      this.pingT = setInterval(() => {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' }));
      }, 30000);

      // If previously fell back to MSE or on WAN/Mobile, connect immediately with MSE; otherwise start WebRTC
      if ((this.preferMSE || streamTransportState.preferMSE) && hasMSE) {
        startMSE();
      } else {
        startWebRTC();
      }
    };

    ws.onmessage = async ev => {
      if (this.dead) return;

      // Binary payload: fragmented MP4 video chunks from go2rtc MSE or JPEG frames from MJPEG fallback
      if (typeof ev.data !== 'string') {
        this.lastPacketTime = Date.now();
        if (currentMode === 'mjpeg') {
          if (this.video) {
            try {
              const blob = new Blob([ev.data], { type: 'image/jpeg' });
              const objUrl = URL.createObjectURL(blob);
              if (this._mjpegUrl) {
                try { URL.revokeObjectURL(this._mjpegUrl); } catch (e) {}
              }
              this._mjpegUrl = objUrl;
              this.video.poster = objUrl;
            } catch (e) {}
          }
          this.lastFrameTime = Date.now();
          if (!this.mseLive) {
            this.mseLive = true;
            clearTimeout(this.timeoutT);
            this.retryN = 0;
            this._reconnAttempt = 0;
            this.startWatchdog();
            this.markLive();
          }
          return;
        }
        if (currentMode !== 'mse') return;
        // ห้ามอัปเดต this.lastFrameTime ที่นี่โดยเด็ดขาด เพราะแพ็กเก็ตไบนารีอาจเป็นเฉพาะเสียงหรือเฟรมที่ดีโค้ดเดอร์ค้างแล้ว
        // ต้องให้ timeupdate / totalVideoFrames ของ <video> เป็นตัวอัปเดต this.lastFrameTime เท่านั้น (Incident 2.181)
        if (sb) {
          if (sb.updating || mseBufLen > 0) {
            const b = new Uint8Array(ev.data);
            if (mseBufLen + b.byteLength <= mseBuf.length) {
              mseBuf.set(b, mseBufLen);
              mseBufLen += b.byteLength;
            } else {
              // Buffer overflow protection during 24/7 spikes: keep latest chunk
              mseBufLen = 0;
              if (b.byteLength <= mseBuf.length) {
                mseBuf.set(b, 0);
                mseBufLen = b.byteLength;
              }
            }
          } else {
            safeAppendMse(ev.data);
          }
        }
        if (!this.mseLive) {
          this.mseLive = true;
          this.lastFrameTime = Date.now();
          clearTimeout(this.timeoutT);
          this.retryN = 0;
          this._reconnAttempt = 0;
          this.startWatchdog();
        }
        if (!this.isLive && this.video && this.video.videoWidth > 0) {
          this.markLive();
        }
        return;
      }

      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }

      if (msg.type === 'error') {
        if (currentMode === 'webrtc' && hasMSE && !triedMSE) {
          startMSE();
        } else if (currentMode === 'mse' && hasWebRTC && !triedWebRTC) {
          startWebRTC();
        } else {
          fallbackAfterTransportExhausted();
        }
        return;
      }

      // go2rtc MSE stream initialization
      if (msg.type === 'mse' && ms && !sb) {
        try {
          sb = ms.addSourceBuffer(msg.value);
          this.sb = sb;
          sb.mode = 'segments';
          sb.addEventListener('updateend', () => {
            if (!sb.updating && mseBufLen > 0) {
              const chunk = mseBuf.slice(0, mseBufLen);
              mseBufLen = 0;
              safeAppendMse(chunk);
            }
            if (!sb.updating && sb.buffered && sb.buffered.length) {
              const lastIdx = sb.buffered.length - 1;
              const end = sb.buffered.end(lastIdx);
              const start0 = sb.buffered.start(0);
              const startLast = sb.buffered.start(lastIdx);

              // Trim MSE buffer only when > 30s accumulated, keeping at least 15s (1-2 full GOPs)
              // Prevents W3C Coded Frame Removal from evicting the active keyframe under currentTime
              if ((end - start0) > 30) {
                const trimEnd = end - 15;
                if (trimEnd > start0) {
                  try { sb.remove(start0, trimEnd); } catch (e) {}
                  try { ms.setLiveSeekableRange(trimEnd, end); } catch (e) {}
                }
              }

              if (this.video) {
                // Jump over disjoint MSE buffer holes (e.g. 50ms micro-gap on WAN RTSP) or unbuffered start0
                if (sb.buffered.length > 1 && this.video.currentTime < startLast) {
                  let hasHeadroomInOldRange = false;
                  for (let i = 0; i < lastIdx; i++) {
                    if (this.video.currentTime >= sb.buffered.start(i) && (sb.buffered.end(i) - this.video.currentTime) > 0.3) {
                      hasHeadroomInOldRange = true;
                      break;
                    }
                  }
                  if (!hasHeadroomInOldRange) {
                    try { this.video.currentTime = Math.max(startLast + 0.05, end - 0.5); } catch (e) {}
                  }
                } else if (this.video.currentTime < start0) {
                  try { this.video.currentTime = Math.max(start0 + 0.05, end - 0.5); } catch (e) {}
                }

                if (!this.viewerPaused && !this.paused) {
                  const gap = end - this.video.currentTime;
                  if (gap > 4.0) {
                    try { this.video.currentTime = Math.max(startLast + 0.05, end - 0.6); } catch (e) {}
                    this.video.playbackRate = 1.0;
                  } else if (gap > 1.8) {
                    this.video.playbackRate = 1.12; // Smooth catch-up without stalling the decoder
                  } else if (gap > 0.9) {
                    this.video.playbackRate = 1.05;
                  } else if (gap < 0.25) {
                    this.video.playbackRate = 0.95; // Prevent buffer underflow
                  } else {
                    this.video.playbackRate = 1.0;
                  }
                  if (this.video.paused) {
                    this.video.play().catch(() => {});
                  }
                }
                if (!this.isLive && this.video.videoWidth > 0) {
                  this.markLive();
                }
              }
            }
          });
        } catch (e) {
          console.warn('[MSE] addSourceBuffer error:', e);
          if (hasWebRTC && !triedWebRTC) startWebRTC();
          else fallbackAfterTransportExhausted();
        }
        return;
      }

      if (currentMode === 'webrtc' && this.pc) {
        try {
          if (msg.type === 'webrtc/answer') {
            await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.value });
          } else if (msg.type === 'webrtc/candidate' && msg.value) {
            await this.pc.addIceCandidate({ candidate: msg.value, sdpMid: '0' });
          }
        } catch (e) { /* candidate / sdp error */ }
      }
    };

    ws.onerror = () => {
      if (currentMode === 'webrtc' && hasMSE && !triedMSE && !this.isLive) {
        startMSE();
      } else {
        this.fail();
      }
    };
    ws.onclose = () => {
      if (this.dead || this.currentMode === 'snapshot') return;
      if ((currentMode === 'mse' || currentMode === 'mjpeg') && this.mseLive) {
        this.fail();
        return;
      }
      if (currentMode === 'webrtc' && this.pc && this.pc.connectionState === 'connected') {
        this.ws = null;
        if (this.pingT) { clearInterval(this.pingT); this.pingT = null; }
        return;
      }
      this.fail();
    };
  }

  /**
   * สตรีมภาพสดผ่าน HTTP Snapshot (`/api/<cam>/latest.jpg`) สำหรับอุปกรณ์ iOS โหมดประหยัดพลังงาน
   * หรือเมื่อขีดจำกัดฮาร์ดแวร์ดีโค้ดเดอร์ (ManagedMediaSource > 4 ช่อง) เต็ม
   * พร้อมตรวจสอบไบต์ของภาพเพื่อป้องกันภาพค้างจากแคช Frigate เมื่อกล้องออฟไลน์ (Incident 2.181)
   */
  startSnapshotStream() {
    if (this.dead || !this.video) return;
    const baseCam = String(this.src || '').replace(/_(sub|hd|main)$/i, '');
    if (!baseCam) {
      this.fail();
      return;
    }
    this.currentMode = 'snapshot';
    clearTimeout(this.timeoutT);
    clearTimeout(this.webrtcFallbackT);
    this.webrtcFallbackT = null;
    if (this.pc) {
      this.pc.ontrack = this.pc.onicecandidate = this.pc.onconnectionstatechange = null;
      try { this.pc.close(); } catch (e) {}
      this.pc = null;
    }
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    if (this.pingT) {
      clearInterval(this.pingT);
      this.pingT = null;
    }
    this.clearVideoForMjpeg();

    let errCount = 0;
    let staleCount = 0;
    let pollCount = 0;
    let lastSig = '';
    let loading = false;
    const fetchFrame = async () => {
      if (this.dead || this.paused || this.viewerPaused || this.currentMode !== 'snapshot') return;
      if (loading) return;
      loading = true;
      pollCount++;
      // หลังจากโพลครบ ~30 วินาที ให้ลองกลับไปเชื่อมต่อสตรีมวิดีโอจริง (MSE/WebRTC) อัตโนมัติ
      if (pollCount > 28) {
        clearInterval(this.snapshotPollT);
        this.snapshotPollT = null;
        this.connect();
        return;
      }
      const snapUrl = apiUrl('/api/' + encodeURIComponent(baseCam) + '/latest.jpg?t=' + Date.now());
      try {
        const res = await originalFetch(snapUrl, { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = await res.arrayBuffer();
        if (this.dead || this.currentMode !== 'snapshot' || !this.video) {
          loading = false;
          return;
        }
        if (!buf || buf.byteLength < 256) throw new Error('Empty snapshot');
        const u8 = new Uint8Array(buf);
        const mid = Math.floor(u8.length / 2);
        const sig = `${u8.length}:${u8[mid]}:${u8[mid + 1] || 0}:${u8[u8.length - 4] || 0}`;
        if (sig === lastSig) {
          staleCount++;
          if (staleCount >= 3) {
            // ภาพนิ่งซ้ำเดิม 3 รอบติดกัน = แคชค้างใน Frigate (กล้องไม่ได้ส่งเฟรมใหม่) ห้ามแสดงว่าออนไลน์
            clearInterval(this.snapshotPollT);
            this.snapshotPollT = null;
            loading = false;
            this.fail();
            return;
          }
        } else {
          lastSig = sig;
          staleCount = 0;
        }
        const blob = new Blob([buf], { type: 'image/jpeg' });
        const objUrl = URL.createObjectURL(blob);
        if (this._mjpegUrl) {
          try { URL.revokeObjectURL(this._mjpegUrl); } catch (e) {}
        }
        this._mjpegUrl = objUrl;
        this.video.poster = objUrl;
        errCount = 0;
        this.lastFrameTime = Date.now();
        this.mseLive = true;
        if (!this.isLive) {
          this.markLive();
        }
      } catch (e) {
        if (this.dead || this.currentMode !== 'snapshot') {
          loading = false;
          return;
        }
        errCount++;
        if (errCount >= 3) {
          clearInterval(this.snapshotPollT);
          this.snapshotPollT = null;
          loading = false;
          this.fail();
          return;
        }
      }
      loading = false;
    };

    clearInterval(this.snapshotPollT);
    fetchFrame();
    this.snapshotPollT = setInterval(fetchFrame, 1100);
  }

  /**
   * กระโดดไปยังขอบเวลาสดล่าสุดของบัฟเฟอร์ MSE (Soft Recovery) โดยไม่ต้องตัดการเชื่อมต่อ WebSocket ใหม่
   *
   * ใช้เมื่อผู้ใช้สลับแท็บกลับมา (resume) หรือเมื่อ <video> ชะงักชั่วคราวแต่ข้อมูลยังไหลเข้า WebSocket ปกติ
   */
  jumpToLiveEdge() {
    if (this.dead || !this.video) return;
    try {
      if (this.sb && !this.sb.updating && this.sb.buffered && this.sb.buffered.length > 0) {
        const lastIdx = this.sb.buffered.length - 1;
        const end = this.sb.buffered.end(lastIdx);
        const startLast = this.sb.buffered.start(lastIdx);
        if (end - this.video.currentTime > 0.8 || this.video.currentTime < startLast) {
          this.video.currentTime = Math.max(startLast + 0.05, end - 0.4);
        }
      }
      this.video.playbackRate = 1.0;
      if (this.video.paused) {
        this.video.play().catch(() => {});
      }
    } catch (e) {}
  }

  startWatchdog() {
    clearInterval(this.watchdogT);
    this.watchdogT = setInterval(() => {
      if (this.dead || this.viewerPaused || this.paused) {
        clearInterval(this.watchdogT);
        return;
      }
      if (!this.mseLive && !this.hls && (!this.pc || this.pc.connectionState !== 'connected')) {
        clearInterval(this.watchdogT);
        return;
      }
      // หาก <video> หรือ MediaSource เกิดข้อผิดพลาดในการถอดรหัส ให้รีคอนเน็กต์ทันที ไม่ปล่อยให้ภาพค้าง (Incident 2.181)
      if (
        (this.video && this.video.error) ||
        (this.currentMode === 'mse' && this.ms && this.ms.readyState !== 'open' && this.mseLive)
      ) {
        clearInterval(this.watchdogT);
        this.fail();
        return;
      }
      if (this.currentMode !== 'mjpeg' && this.currentMode !== 'snapshot' && this.video && this.video.paused) {
        this.video.play().catch(() => {});
      }
      if (!this.isLive && this.video && (this.currentMode === 'mjpeg' || this.currentMode === 'snapshot' || this.video.videoWidth > 0)) {
        this.markLive();
      }
      const now = Date.now();

      // ตรวจสอบจำนวนเฟรมวิดีโอที่ถูกถอดรหัสจริงจากฮาร์ดแวร์/ซอฟต์แวร์ทุก 1 วินาที (รองรับทั้ง WebRTC, MSE, HLS)
      if (this.video && this.currentMode !== 'mjpeg' && this.currentMode !== 'snapshot' && typeof this.video.getVideoPlaybackQuality === 'function') {
        const q = this.video.getVideoPlaybackQuality();
        if (q && typeof q.totalVideoFrames === 'number' && this.video.videoWidth > 0) {
          if (q.totalVideoFrames > (this._watchdogDecodedFrames || 0)) {
            this._watchdogDecodedFrames = q.totalVideoFrames;
            this.lastFrameTime = now;
          }
        }
      }

      // Auto Adaptive Jitter Smoothing: auto-detects FPS and network jitter to smooth frames
      if (this.pc && this.video) {
        if (!this._lastFpsCheckTime) {
          this._lastFpsCheckTime = now;
          if (this.video.getVideoPlaybackQuality) {
            const q = this.video.getVideoPlaybackQuality();
            if (q) this._lastDecodedFrames = q.totalVideoFrames;
          }
        }
        const dt = (now - this._lastFpsCheckTime) / 1000;
        if (dt >= 2.0) {
          let currentFps = 25;
          let dropped = 0;
          if (this.video.getVideoPlaybackQuality) {
            const q = this.video.getVideoPlaybackQuality();
            if (q) {
              const dFrames = q.totalVideoFrames - this._lastDecodedFrames;
              currentFps = dFrames / dt;
              this._lastDecodedFrames = q.totalVideoFrames;
              dropped = q.droppedVideoFrames;
            }
          }
          this._lastFpsCheckTime = now;

          const isField = isFieldMobileStream(this.src, this.opts && this.opts.chName);
          const receivers = this.pc.getReceivers ? this.pc.getReceivers() : [];
          receivers.forEach(r => {
            if (r.track && 'playoutDelayHint' in r) {
              if (isField) {
                r.playoutDelayHint = (currentFps < 22 || dropped > 0) ? 1.5 : 1.2;
              } else {
                if (currentFps < 22 || dropped > 0) {
                  r.playoutDelayHint = 0.25;
                } else {
                  r.playoutDelayHint = 0.1;
                }
              }
            }
          });
        }
      }

      // หากไม่มีเฟรมวิดีโอใหม่ถูกถอดรหัสเกินเวลาที่กำหนด ให้กู้คืนสตรีมแบบ 2 ขั้นตอน (Two-Stage Recovery — Incident 2.181)
      const softLimitMs = this.hls ? 10000 : 4000;
      const hardLimitMs = this.hls ? 16000 : 7500;
      const silentMs = this.lastFrameTime > 0 ? (now - this.lastFrameTime) : 0;
      if (this.lastFrameTime > 0 && silentMs > softLimitMs) {
        if (this.hls && !this._hlsWatchdogRecovered) {
          this._hlsWatchdogRecovered = true;
          try {
            console.warn(`[HLS ${this.src}] Video frame stalled >10s, attempting recoverMediaError()`);
            this.hls.recoverMediaError();
            return;
          } catch (e) {}
        }
        if (!this.hls && !this._mseSoftRecovered && this.video) {
          this._mseSoftRecovered = true;
          this._mseSoftRecoverTime = now;
          console.warn(`[Stream ${this.src}] Video frame stalled >4s, jumping to live edge`);
          this.jumpToLiveEdge();
          return;
        }
        if (silentMs > hardLimitMs) {
          clearInterval(this.watchdogT);
          if (this.currentMode === 'webrtc' && typeof this.startMSE === 'function') {
            console.warn(`[Stream ${this.src}] WebRTC video stalled >7.5s, switching to MSE fallback`);
            this.startMSE();
          } else {
            console.warn(`[Stream ${this.src}] Video frame frozen >${Math.round(silentMs / 1000)}s after soft recovery, forcing reconnect`);
            this.fail();
          }
        }
      } else if (silentMs < 2500) {
        this.softRecoveryCount = 0;
        this._mseSoftRecovered = false;
        this._mseSoftRecoverTime = 0;
      }
    }, 1000);
  }

  connectHls(url) {
    if (this.dead) return;
    this.currentMode = 'hls';
    this._hlsWatchdogRecovered = false;
    this.timeoutT = setTimeout(() => this.fail(), 45000);

    const start = () => {
      this.hlsStartT = null;
      if (this.dead) return;
      if (this.hls) {
        try { this.hls.destroy(); } catch (e) {}
        this.hls = null;
      }

      if (this.video) {
        try { this.video.crossOrigin = 'anonymous'; } catch (e) {}
        this.lastFrameTime = Date.now();
        this.lastCurrentTime = -1;
        this.onTimeUpdate = () => {
          if (this.video && this.video.currentTime !== this.lastCurrentTime) {
            this.lastCurrentTime = this.video.currentTime;
            if (this.video.videoWidth > 0) {
              this.lastFrameTime = Date.now();
              this._hlsWatchdogRecovered = false;
              if (!this.isLive) {
                this.markLive();
              }
            }
          }
        };
        this.video.addEventListener('timeupdate', this.onTimeUpdate);
      }

      if (window.Hls && Hls.isSupported()) {
        const hlsCfg = this.hlsLite ? {
          maxBufferLength: 40,
          maxMaxBufferLength: 60,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 7,
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 20,
          fragLoadingMaxRetry: 4,
          fragLoadingRetryDelay: 3000,
          levelLoadingMaxRetry: 4,
          levelLoadingRetryDelay: 3000,
          manifestLoadingMaxRetry: 4,
          manifestLoadingRetryDelay: 3000,
          capLevelToPlayerSize: true
        } : {
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          liveSyncDurationCount: 5,
          liveMaxLatencyDurationCount: 10,
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 60,
          fragLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 2000,
          levelLoadingMaxRetry: 6,
          levelLoadingRetryDelay: 2000,
          manifestLoadingMaxRetry: 4,
          manifestLoadingRetryDelay: 2000,
          capLevelToPlayerSize: true
        };
        let hlsRef = null;
        if (isDohHlsSource(this.src) || isDohHlsSource(url)) {
          Object.assign(hlsCfg, {
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            backBufferLength: 30,
            liveBackBufferLength: 30,
            liveSyncDuration: 14,
            liveMaxLatencyDuration: 60,
            maxLiveSyncPlaybackRate: 1.1,
            maxBufferHole: 2.5,
            highBufferWatchdogPeriod: 0.5,
            detectStallWithCurrentTimeMs: 600,
            nudgeOffset: 0.25,
            nudgeMaxRetry: 10,
            liveMaxUnchangedPlaylistRefresh: 8,
            fragLoadingTimeOut: 15000,
            fragLoadingMaxRetry: 3,
            fragLoadingRetryDelay: 1000,
            levelLoadingTimeOut: 8000,
            levelLoadingMaxRetry: 2,
            levelLoadingRetryDelay: 1000,
            manifestLoadingTimeOut: 10000,
            manifestLoadingMaxRetry: 3,
            manifestLoadingRetryDelay: 1000,
            pLoader: createDohPlaylistLoader(() => hlsRef)
          });
          delete hlsCfg.liveSyncDurationCount;
          delete hlsCfg.liveMaxLatencyDurationCount;
          this.isDohSource = true;
        }
        const hls = new Hls(hlsCfg);
        hlsRef = hls;
        this.hls = hls;
        hls.loadSource(url);
        hls.attachMedia(this.video);

        const markLive = () => {
          if (this.dead || this.hls !== hls) return;
          this.lastFrameTime = Date.now();
          this.startWatchdog();
          this.video.muted = true;
          this.video.play().catch(() => {});
          if (this.video && this.video.videoWidth > 0) {
            this.markLive();
          }
        };

        hls.on(Hls.Events.FRAG_LOADED, markLive);
        if (this.video) {
          this.onPlaying = markLive;
          this.video.addEventListener('playing', markLive);
          this.video.addEventListener('loadeddata', markLive);
        }

        let mediaRecoveries = 0;
        let netRecoveries = 0;
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (this.dead || this.hls !== hls) return;
          if (data.details === Hls.ErrorDetails.PLAYLIST_UNCHANGED_ERROR) {
            console.warn('[HLS] Playlist unchanged limit reached for', this.src, '— refreshing master session');
            this.fail();
            return;
          }
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                netRecoveries++;
                if (!this.isDohSource && netRecoveries <= 1) {
                  console.warn('[HLS] Fatal network error for', this.src, '— restarting load');
                  hls.startLoad();
                } else {
                  console.warn('[HLS] Fatal network error for', this.src, '— reconnecting master playlist');
                  this.fail();
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                mediaRecoveries++;
                if (mediaRecoveries <= 4) {
                  console.warn('[HLS] Fatal media error for', this.src, '— recovering attempt', mediaRecoveries);
                  hls.recoverMediaError();
                } else {
                  console.error('[HLS] Media recovery failed for', this.src);
                  this.fail();
                }
                break;
              default:
                console.error('[HLS] Fatal unrecoverable error for', this.src, data);
                this.fail();
                break;
            }
          }
        });
      } else if (this.video && this.video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS
        this.video.src = url;
        this.video.muted = true;
        const onCanPlay = () => {
          if (this.dead) return;
          this.lastFrameTime = Date.now();
          this.startWatchdog();
          this.video.play().catch(() => {});
          if (this.video && this.video.videoWidth > 0) {
            this.markLive();
          }
        };
        this.onPlaying = onCanPlay;
        this.video.addEventListener('loadeddata', onCanPlay);
        this.video.addEventListener('playing', onCanPlay);
        this.video.addEventListener('error', () => {
          if (!this.dead) this.fail();
        }, { once: true });
      } else {
        console.error('[HLS] Not supported in this browser');
        this.fail();
      }
    };

    clearTimeout(this.hlsStartT);
    if (this.hlsLite) {
      this.hlsStartT = setTimeout(start, Math.random() * 1500); // Stagger 0-1.5s
    } else {
      start();
    }
  }

  fail() {
    if (this.dead) return;
    this.isLive = false;
    clearTimeout(this.timeoutT);
    clearInterval(this.watchdogT);
    this.watchdogT = null;
    const hadLive = this.wasLive;
    this.cleanupPeer();
    let delay;
    if (hadLive) {
      // สตรีมเคยเล่นได้ปกติแต่หลุดชั่วคราว (4G dropout / NVR session reset) — Incident 1.56 + ADR-0026
      this._reconnAttempt = (this._reconnAttempt || 0) + 1;

      // ADR-0026 Grace Period: แช่เฟรมสุดท้ายเงียบๆ 10 วินาทีก่อนโชว์ RECONNECT
      if (!this._graceStart) {
        this._graceStart = Date.now();
      }
      const elapsed = Date.now() - this._graceStart;
      if (elapsed >= RECONNECT_GRACE_MS) {
        this.onStatus('reconnecting');
      }

      // ADR-0026 Anti-Thundering Herd: เพิ่ม jitter สุ่ม 0-3s ลงใน delay
      if (this._reconnAttempt >= 2) {
        this.preferMSE = true;
      }
      const jitter = Math.floor(Math.random() * RECONNECT_JITTER_MS);
      delay = (this._reconnAttempt === 1 ? 2000 : 3000) + jitter;
    } else {
      this.onStatus('videoloss');
      delay = RETRY_STEPS[Math.min(this.retryN, RETRY_STEPS.length - 1)];
      this.retryN++;
    }
    clearTimeout(this.retryT);
    this.retryT = setTimeout(() => this.connect(), delay);
  }

  cleanupPeer() {
    this.isLive = false;
    clearTimeout(this.timeoutT);
    clearTimeout(this.hlsStartT);
    this.hlsStartT = null;
    clearTimeout(this.webrtcFallbackT);
    this.webrtcFallbackT = null;
    if (this.snapshotPollT) {
      clearInterval(this.snapshotPollT);
      this.snapshotPollT = null;
    }
    this._lastDecodedFrames = 0;
    this._lastFpsCheckTime = 0;
    if (this.pingT) clearInterval(this.pingT);
    clearInterval(this.watchdogT);
    this.watchdogT = null;
    if (this.video) {
      if (this.onTimeUpdate) {
        this.video.removeEventListener('timeupdate', this.onTimeUpdate);
        this.onTimeUpdate = null;
      }
      if (this.onPlaying) {
        this.video.removeEventListener('playing', this.onPlaying);
        this.video.removeEventListener('loadeddata', this.onPlaying);
        this.onPlaying = null;
      }
      if (this.onError) {
        this.video.removeEventListener('error', this.onError);
        this.onError = null;
      }
    }
    if (this.hls) {
      try { this.hls.destroy(); } catch (e) {}
      this.hls = null;
    }
    if (this.msUrl) {
      try { URL.revokeObjectURL(this.msUrl); } catch (e) {}
      this.msUrl = null;
    }
    if (this.sb) {
      try { if (this.ms && this.ms.readyState === 'open') this.ms.removeSourceBuffer(this.sb); } catch (e) {}
      this.sb = null;
    }
    this.ms = null;
    this.mseLive = false;
    if (this.ws) { this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null; try { this.ws.close(); } catch (e) {} this.ws = null; }
    if (this.pc) { this.pc.ontrack = this.pc.onicecandidate = this.pc.onconnectionstatechange = null; try { this.pc.close(); } catch (e) {} this.pc = null; }
    if (this.video) {
      // Snapshot frame to poster before clearing stream, preventing black canvas flicker during reconnect
      if (this.wasLive && this.video.videoWidth > 0) {
        const snap = captureVideoPoster(this.video, 480);
        if (snap) this.video.poster = snap;
      }
      this.video.playbackRate = 1.0;
      this.video.srcObject = null;
      if (this.video.src) {
        this.video.removeAttribute('src');
        try { this.video.load(); } catch (e) {}
      }
    }
  }

  destroy() {
    this.dead = true;
    clearTimeout(this.retryT);
    clearTimeout(this.hlsStartT);
    this.hlsStartT = null;
    clearTimeout(this.viewerHoldT);
    this.viewerHoldT = null;
    clearInterval(this.watchdogT);
    if (this.snapshotPollT) {
      clearInterval(this.snapshotPollT);
      this.snapshotPollT = null;
    }
    if (this._mjpegUrl) {
      try { URL.revokeObjectURL(this._mjpegUrl); } catch (e) {}
      this._mjpegUrl = null;
    }
    if (this.video && this.video.poster) {
      this.video.removeAttribute('poster');
    }
    this.cleanupPeer();
  }

  // Incident 1.63 & 2.86: pause/resume สำหรับ visibilitychange
  pause() {
    if (this.dead) return;
    this.paused = true;
    // หยุด watchdog — ป้องกัน false positive "ไม่มีเฟรม" ระหว่าง tab hidden (browser throttle)
    clearInterval(this.watchdogT); this.watchdogT = null;
    // หมายเหตุ: คง pingT ไว้ตามเดิมเพื่อให้ keepalive WebSocket ไปยัง Cloudflare Tunnel ไม่ถูกตัดขาด
  }

  resume() {
    if (this.dead) return;
    this.paused = false;
    this.viewerPaused = false;
    // ตรวจสอบว่า PeerConnection, MSE/MJPEG WebSocket, Snapshot Stream หรือ HLS ยังดีอยู่ไหม
    const pcOk = this.pc && this.pc.connectionState === 'connected';
    const mseOk = (this.currentMode === 'mse' || this.currentMode === 'mjpeg') && this.mseLive && this.ws && this.ws.readyState === WebSocket.OPEN;
    const snapOk = this.currentMode === 'snapshot' && !!this.snapshotPollT;
    const hlsOk = !!this.hls;
    if (pcOk || mseOk || snapOk || hlsOk) {
      // ✅ ยังเชื่อมอยู่! → แค่เปิด watchdog กลับและกระโดดไปขอบเวลาสด (สำหรับ MSE) โดยไม่ต้อง reconnect (Phase P0)
      this.lastFrameTime = Date.now();
      if (mseOk) {
        this.jumpToLiveEdge();
      }
      this.startWatchdog();
      if (this.currentMode !== 'mjpeg' && this.currentMode !== 'snapshot' && this.video && this.video.paused) {
        this.video.play().catch(() => {});
      }
    } else {
      // ❌ หลุดจริงๆ (network change, sleep นาน) → reconnect ภายใต้ grace period
      if (this.wasLive && !this._graceStart) {
        this._graceStart = Date.now();
      }
      this.fail();
    }
  }

  // Warm-Pause for Fullscreen Camera Viewer: หยุดถอดรหัสภาพชั่วคราวขณะดูเต็มจอ แต่คงการเชื่อมต่อไว้ 90 วินาที
  // ทำให้กดปิดหน้าต่างเต็มจอแล้วกลับมาเล่นต่อได้ทันทีใน 0.1 วินาที โดยไม่ขึ้น "กำลังเชื่อมต่อใหม่..." ทั้ง 10 กล้อง
  pauseForViewer() {
    if (this.dead || this.viewerPaused) return;
    this.viewerPaused = true;
    this.pause();
    if (this.video) {
      if (this.wasLive && this.video.videoWidth > 0) {
        const snap = captureVideoPoster(this.video, 480);
        if (snap) this.video.poster = snap;
      }
      try { this.video.pause(); } catch (e) {}
    }
    clearTimeout(this.viewerHoldT);
    this.viewerHoldT = setTimeout(() => {
      if (!this.dead && this.viewerPaused) {
        this.suspend();
      }
    }, 90000);
  }

  resumeFromViewer() {
    if (this.dead) return;
    clearTimeout(this.viewerHoldT);
    this.viewerHoldT = null;
    this.viewerPaused = false;
    if (this.suspended) {
      this.resumeFromSuspend();
      return;
    }
    // กระโดดไปขอบสตรีมสด (Live Edge) ทันทีหลังกลับมาจากการหยุดพัก
    if (this.video && this.sb && !this.sb.updating && this.sb.buffered && this.sb.buffered.length > 0) {
      try {
        const end = this.sb.buffered.end(this.sb.buffered.length - 1);
        if (end - this.video.currentTime > 1.5) {
          this.video.currentTime = Math.max(0, end - 0.5);
        }
      } catch (e) {}
    }
    this.resume();
  }

  // Incident 2.16: Modal background suspension (ประหยัดแบนด์วิดท์ WAN 100% & ป้องกัน GPU Compositor flicker)
  suspend() {
    if (this.dead || this.suspended) return;
    this.suspended = true;
    clearTimeout(this.viewerHoldT);
    this.viewerHoldT = null;
    this.pause();
    this.cleanupPeer();
    if (this.video) {
      try { this.video.pause(); } catch (e) {}
    }
  }

  resumeFromSuspend() {
    if (this.dead || !this.suspended) return;
    this.suspended = false;
    this.paused = false;
    this.viewerPaused = false;
    // ตั้งค่า _graceStart เพื่อให้คงสถานะสีเขียว (ออนไลน์) และแสดงภาพนิ่งเดิมระหว่างต่อสตรีมใหม่เบื้องหลัง
    if (this.wasLive) {
      this._graceStart = Date.now();
    }
    this.connect();
  }
}

let modalSuspensionDepth = 0;

window.suspendDashboardCameras = function() {
  modalSuspensionDepth++;
  if (modalSuspensionDepth === 1) {
    document.body.classList.add('bpp-modal-active');
    state.tiles.forEach(t => {
      if (t.cam && typeof t.cam.suspend === 'function') {
        t.cam.suspend();
      }
    });
    if (state.viewerCam && typeof state.viewerCam.suspend === 'function') {
      state.viewerCam.suspend();
    }
  }
};

window.resumeDashboardCameras = function() {
  modalSuspensionDepth = Math.max(0, modalSuspensionDepth - 1);
  if (modalSuspensionDepth === 0) {
    document.body.classList.remove('bpp-modal-active');
    state.tiles.forEach((t, idx) => {
      if (t.cam && typeof t.cam.resumeFromSuspend === 'function') {
        setTimeout(() => {
          if (modalSuspensionDepth === 0 && t.cam) {
            t.cam.resumeFromSuspend();
          }
        }, idx * 80);
      }
    });
    if (state.viewerCam && typeof state.viewerCam.resumeFromSuspend === 'function') {
      state.viewerCam.resumeFromSuspend();
    }
  }
};

/* ============ secret masking ============ */
window.maskFrigateSecret = function(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.username && u.password) {
      return url.replace(`${u.username}:${u.password}`, '***:***');
    }
  } catch (e) {}
  return url.replace(/\{FRIGATE_[^}]+\}:\{FRIGATE_[^}]+\}/, '***:***');
};

window.unmaskFrigateSecret = function(masked, original) {
  if (!masked || !original) return masked;
  const match = original.match(/(\{FRIGATE_[^}]+\}:\{FRIGATE_[^}]+\})/);
  if (match && masked.includes('***:***')) {
    return masked.replace('***:***', match[1]);
  }
  return masked;
};

/* ============ state ============ */
const DEFAULT_SPECIAL_CAMERA_NAMES = {
  A01: 'A01 - สามแยกนาโพธิ์ - ดงมัน - ร้อย ตชด.234',
  A02: 'A02 - สามแยกท่าไคร้ - ร้อย ตชด.234',
  A03: 'A03 - ปากทางเข้า กศน.นาสีนวล - ร้อย ตชด.234',
  A04: 'A04 - หน้าเทศบาล ต.ชะโนด - ร้อย ตชด.234',
  A05: 'A05 - สามแยกหาดมะโนภิรมย์ - ร้อย ตชด.234',
  A06: 'A06 - แยกหว้านใหญ่ - ร้อย ตชด.234',
  A07: 'A07 - หน้า รร.บ้านนาคำ - ร้อย ตชด.235',
  A08: 'A08 - หน้า ฐานทรายมูล - ร้อย ตชด.235',
  A09: 'A09 - สะพานปากห้วยน้ำก่ำ - ร้อย ตชด.235',
  A10: 'A10 - หน้า ร้อย ตชด.235 - ร้อย ตชด.235',
  A11: 'A11 - สามแยก ดอนนางหง (รีสอร์ทครูมังกร) - ร้อย ตชด.235',
  A12: 'A12 - หลังวัดบ้านห้อม - ร้อย ตชด.236',
  A13: 'A13 - รร.บ้านท่าค้อ - ร้อย ตชด.236',
  A14: 'A14 - ดอนปู่ตาบ้านซะโงม - ร้อย ตชด.236',
  A15: 'A15 - แยกบ้านหนาด - ร้อย ตชด.236',
  A16: 'A16 - หน้าวัดสุพรรณบ้านกลางน้อย - ร้อย ตชด.236',
  A17: 'A17 - ทางเข้าถนนเลียบแม่น้ำโขง บ.เชียงยืน - ร้อย ตชด.237',
  A18: 'A18 - ซอยข้าง รพ.ท่าอุเทน - ร้อย ตชด.237',
  A19: 'A19 - ซอยตรงข้ามนครหลวงวัสดุก่อสร้าง 99 - ร้อย ตชด.237',
  A20: 'A20 - ทางเข้าบ้านหนองเทา (ป้อมอาเซียน) - ร้อย ตชด.237',
  A21: 'A21 - แยกนาพระชัยตรงข้ามเซเว่นฯ - ร้อย ตชด.237',
  A22: 'A22 - ปากทางเข้าบ้านปากห้วยม่วง - ร้อย ตชด.237',
  doh_per_4_002: 'DOH นครราชสีมา (PER-4-002 มุ่งหน้า จ.สระบุรี)',
  doh_per_4_003_1: 'DOH นครราชสีมา (PER-4-003 มุ่งหน้า จ.สระบุรี)',
  doh_per_4_003_2: 'DOH นครราชสีมา (PER-4-003 มุ่งหน้า ตัวเมืองนครราชสีมา)',
  doh_per_6_023: 'DOH ขอนแก่น (PER-6-023)',
  doh_per_6_025: 'DOH ขอนแก่น (PER-6-025)',
  doh_per_6_026: 'DOH มุกดาหาร (PER-6-026)',
  doh_per_6_029: 'DOH มหาสารคาม (PER-6-029)',
  doh_per_6_030: 'DOH ร้อยเอ็ด (PER-6-030)',
  doh_per_7_007: 'DOH อุบลราชธานี (PER-7-007)',
  doh_per_7_015: 'DOH นครพนม (PER-7-015)',
  doh_per_7_017: 'DOH อุบลราชธานี (PER-7-017)',
  doh_per_7_020: 'DOH นครราชสีมา (PER-7-020)',
  doh_per_7_021: 'DOH สุรินทร์ (PER-7-021)',
  doh_per_7_022: 'DOH นครราชสีมา (PER-7-022)',
  doh_per_8_004: 'DOH สกลนคร (PER-8-004)',
  doh_per_8_005: 'DOH ศรีสะเกษ (PER-8-005)',
  doh_per_8_007: 'DOH บึงกาฬ (PER-8-007)',
  doh_per_8_011: 'DOH บุรีรัมย์-สระแก้ว (PER-8-011)',
  doh_per_9_008: 'DOH สกลนคร (PER-9-008)',
  doh_per_9_009: 'DOH อุดรธานี (PER-9-009)',
  doh_per_9_013: 'DOH ร้อยเอ็ด (PER-9-013)',
  doh_per_9_015: 'DOH บุรีรัมย์ (PER-9-015)',
  doh_per_10_012: 'DOH ชัยภูมิ-ลพบุรี (PER-10-012)',
  doh_per_13_013_1: 'DOH อุดรธานี (PER-13-013 มุ่งหน้า อุดรธานี)',
  doh_per_13_013_2: 'DOH อุดรธานี (PER-13-013 มุ่งหน้า หนองคาย)',
  doh_per_13_020_1: 'DOH นครราชสีมา (PER-13-020 มุ่งหน้า สระบุรี)',
  doh_per_13_020_2: 'DOH นครราชสีมา (PER-13-020 มุ่งหน้า นครราชสีมา)',
  doh_per_17_014_in: 'DOH อำนาจเจริญ (PER-17-014 มุ่งหน้า อ.เมือง)',
  doh_per_17_014_out: 'DOH อำนาจเจริญ (PER-17-014 มุ่งหน้า อ.ลืออำนาจ)'
};

const state = {
  manualLayoutOverride: false,
  cameraNames: { ...DEFAULT_SPECIAL_CAMERA_NAMES },
  activeIdx: 0,
  query: '',
  tiles: [],           // [{el, video, cam, status, feedEl, nameEl, chipEl}]
  events: [],          // normalized: {id, camIdx|null, camera, label, type, mins, dur, conf, thumb, hasClip, startTime}
  lastEventsReadTime: Number(localStorage.getItem('bpp_events_last_read') || 0),
  eventFilter: 'all',
  emgrCameraFilter: '', // Empty means every camera in the event archive.
  emgrDateFilter: '', // Empty means every retained day in the event archive.
  emgrArchiveNextBefore: null, // Cursor for the next older Frigate event page.
  emgrArchiveHasMore: false, // Enables progressive loading without discarding retained history.
  emgrArchiveLoadingMore: false, // Prevents duplicate cursor requests from repeated clicks/scrolls.
  emgrThumbObserver: null, // Disconnects stale thumbnail observers when the archive re-renders.
  emgrScrollObserver: null, // Disconnects stale infinite scroll observers when the archive re-renders.
  selCh: 0,
  dirty: {},
  connDirty: false,
  storageDirty: false, // เพดานพื้นที่ว่าง (%) ถูกแก้ในฟอร์มแต่ยังไม่บันทึก
  frigateCams: null,   // Set ชื่อกล้องจริงใน Frigate (โหลดตอนเปิด settings)
  objBase: {},         // { camName: [track...] } ค่าเดิมจาก Frigate
  objDraft: {},        // { camName: [track...] } ค่าที่กำลังแก้ในฟอร์ม
  objDirty: {},        // { camName: true } กล้องที่ object ถูกแก้แต่ยังไม่บันทึก
  draft: null,       // สำเนา channels ระหว่างแก้ใน settings — apply เข้า cfg เมื่อกดบันทึกเท่านั้น
  evSignature: null, // กัน re-render events rail ซ้ำเมื่อข้อมูลไม่เปลี่ยน (focus/click จะได้ไม่หลุด)
  playerEv: null,
  viewerCam: null,   // Camera instance ของหน้าดูเต็มจอ (ดึงสตรีมหลักแยก connection)
  viewerOpen: false,
  demoPlay: { t: 0, playing: false },
  dlToken: 0,        // ใช้ยกเลิกงานดาวน์โหลดค้างเมื่อปิด player/เปลี่ยน event
  dlTimer: null,
  reconnecting: false,
  emgrEvents: [],    // เหตุการณ์ในหน้าคลังวิดีโอ (พร้อม description)
  emgrQuery: '',     // คำค้นในหน้าคลังวิดีโอ
  emgrTypeFilter: 'all', // กรองตามชนิดวัตถุในคลังวิดีโอ
  emgrLprFilter: 'all', // Same-page LPR review status; never fabricates a Frigate plate value.
  emgrLprByEvent: new Map(), // event ID -> Set of candidate buckets loaded from admin-only metadata.
  emgrDescOnly: false,   // แสดงเฉพาะที่มีคำอธิบาย
  emgrEv: null,      // เหตุการณ์ที่เปิดดูรายละเอียดอยู่
  lprCams: null,     // Set ชื่อกล้องที่เปิด LPR (null = ยังไม่โหลด/โหลดพัง → ปุ่มซ่อน)
  lprZones: {},      // โซนจับป้ายต่อกล้อง {cam: [x,y,w,h] normalized} จาก /settings/lpr_zones
  lprDirty: false,   // มีการสลับเปิด/ปิด LPR ที่ยังไม่เขียนไฟล์
};

/**
 * Resolve the operator-facing name without changing the canonical Frigate ID.
 *
 * A channel's `src` remains the immutable technical identifier used by stream
 * and API requests.  The shared camera-name map is the first display choice;
 * a legacy channel name remains a safe fallback for existing saved layouts.
 *
 * @param {string} source Canonical camera identifier from the channel map.
 * @param {string} legacyName Older per-channel display value, when present.
 * @returns {string} The best non-empty name for operator-visible UI.
 */
function displayCameraName(source, legacyName = '') {
  const normalizedSource = typeof source === 'string' ? source.trim() : '';
  const configuredName = normalizedSource && state.cameraNames
    ? (state.cameraNames[normalizedSource] || DEFAULT_SPECIAL_CAMERA_NAMES[normalizedSource])
    : (normalizedSource ? DEFAULT_SPECIAL_CAMERA_NAMES[normalizedSource] : '');
  if (typeof configuredName === 'string' && configuredName.trim()) {
    return configuredName.trim();
  }
  if (typeof legacyName === 'string' && legacyName.trim() && legacyName.trim() !== normalizedSource) {
    return legacyName.trim();
  }
  if (normalizedSource && window.cachedCameraGPS && window.cachedCameraGPS[normalizedSource] && window.cachedCameraGPS[normalizedSource].name) {
    return window.cachedCameraGPS[normalizedSource].name;
  }
  if (typeof legacyName === 'string' && legacyName.trim()) {
    return legacyName.trim();
  }
  return normalizedSource;
}

/* ============ grid ============ */
function tileTemplate(i, ch) {
  const isDemo = cfg.demo;
  const demoInfo = DEMO_CAMS[i % DEMO_CAMS.length];
  const name = isDemo ? demoInfo[0] : (displayCameraName(ch.src, ch.name) || '— ไม่ได้ตั้งค่า —');
  const el = document.createElement('div');
  el.className = 'tile';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.dataset.idx = i;
  el.innerHTML = `
    <div class="tile-feed${isDemo ? ' demo' : ''}"></div>
    <div class="tile-vignette"></div>
    <div class="tile-overlay ov-offline" hidden><img src="${escapeHtml(window.BRANDING.logo)}" alt="BPP 215"><div class="ov-center"><div class="ov-title">ช่องสัญญาณว่าง</div><div class="ov-sub">คลิกเพื่อเลือกกล้องสำหรับหน้าจอของคุณ</div><button type="button" class="btn-tile-pick-cam"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/><line x1="8.5" y1="9" x2="8.5" y2="15"/><line x1="5.5" y1="12" x2="11.5" y2="12"/></svg><span>เลือกกล้อง</span></button></div></div>
    <div class="tile-overlay ov-videoloss" hidden><img src="${escapeHtml(window.BRANDING.logo)}" alt="BPP 215"><div class="ov-center"><div class="ov-title">VIDEO LOSS</div><div class="ov-sub">สัญญาณวิดีโอขาดหาย</div></div></div>
    <div class="tile-overlay ov-connecting" hidden><div class="ov-center"><div class="spinner"></div><div class="ov-sub">กำลังเชื่อมต่อ…</div></div></div>
    <div class="tile-overlay ov-reconnecting" hidden><div class="ov-center"><div class="spinner"></div><div class="ov-sub">กำลังเชื่อมต่อใหม่…</div></div></div>
    <div class="tile-overlay ov-disabled" hidden><img src="${escapeHtml(window.BRANDING.logo)}" alt="BPP 215"><div class="ov-center"><div class="ov-title">ปิดการใช้งาน</div><div class="ov-sub">กล้องนี้ถูกปิด — เปิดได้ที่หน้าตั้งค่า</div></div></div>
    <div class="hud tl"></div><div class="hud tr"></div><div class="hud bl"></div><div class="hud br"></div>
    <div class="tile-top"><span class="ch-chip">${chLabel(i)}</span><span class="tile-name"></span><span class="tile-status-dot"></span></div>
    <div class="tile-bottom"><span class="tile-rec"><span class="rec-dot"></span><span class="rec-text">—</span></span><span class="tile-clock">--:--:--</span></div>`;
  el.querySelector('.tile-name').textContent = name;

  const feed = el.querySelector('.tile-feed');
  let video = null;
  if (isDemo) {
    feed.style.background = DEMO_SCENES[i % DEMO_SCENES.length];
  } else if (ch.src) {
    video = document.createElement('video');
    video.playsInline = true; video.muted = true; video.autoplay = true; video.preload = 'auto';
    video.draggable = false; // กัน <video> ไฮแจ็ก drag ตอนจัดเรียง layout
    feed.appendChild(video);
  }

  // CLAUDE.md Section 10: Clicking an empty tile opens the Camera Picker for that specific slot
  el.addEventListener('click', () => {
    if (state.editLayout || state.viewerOpen) return;
    setActive(i);
    if (!ch.src) {
      openCameraPickerForSlot(i);
    } else {
      openViewer(i);
    }
  });
  el.addEventListener('keydown', e => {
    if (e.target !== el || state.editLayout || state.viewerOpen) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActive(i);
      if (!ch.src) {
        openCameraPickerForSlot(i);
      } else {
        openViewer(i);
      }
    }
  });
  // ลากสลับตำแหน่งช่อง (เฉพาะโหมดจัดเรียง — el.draggable เปิด/ปิดใน setEditLayout)
  el.addEventListener('dragstart', e => { if (!state.editLayout) { e.preventDefault(); return; } e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('dragover', e => { if (state.editLayout) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drag-over'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', e => { el.classList.remove('drag-over'); if (!state.editLayout) return; e.preventDefault(); const from = +e.dataTransfer.getData('text/plain'); if (Number.isNaN(from) || from === i) return; swapChannels(from, i); });
  return { el, video };
}

// ปุ่มบน tile สด (โผล่ตอน hover): ถ่ายภาพ / อัดวิดีโอ / สลับ Main-Sub / สลับกล้อง
// ทุกปุ่ม stopPropagation — คลิก tile ทั้งใบ = เปิด viewer (ห้ามทะลุ)
const TILE_SVG_CAM = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';
const TILE_SVG_REC = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="6"></circle></svg>';
const TILE_SVG_GPS = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
const TILE_SVG_SWITCH = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
const TILE_SVG_AUDIO_MUTE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';
const TILE_SVG_AUDIO_ON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
const CV_SVG_AUDIO_MUTE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';
const CV_SVG_AUDIO_ON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
function attachTileActions(t, ch, i) {
  const wrap = document.createElement('div');
  wrap.className = 'tile-actions';
  
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'tile-act-btn tile-menu-toggle';
  toggleBtn.title = 'เครื่องมือเพิ่มเติม';
  toggleBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';
  
  const innerWrap = document.createElement('div');
  innerWrap.className = 'tile-actions-inner';
  
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isExpanded = wrap.classList.contains('expanded');
    // ปิดเมนูช่องอื่นก่อนเสมอเพื่อให้เปิดได้ครั้งละ 1 ช่อง (ADR-0028)
    document.querySelectorAll('.tile-actions.expanded').forEach(el => {
      if (el !== wrap) el.classList.remove('expanded');
    });
    wrap.classList.toggle('expanded', !isExpanded);
  });
  
  // ป้องกันไม่ให้การคลิกปุ่มบนแถบเครื่องมือแพร่กระจายไปทริกเกอร์เลือกช่องหรือขยายจอ
  innerWrap.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // ปิดเมนูอัตโนมัติเมื่อคลิกพื้นที่อื่นบนหน้าเว็บ
  if (!window._tileActionsGlobalListenerAdded) {
    window._tileActionsGlobalListenerAdded = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.tile-actions')) {
        document.querySelectorAll('.tile-actions.expanded').forEach(el => {
          el.classList.remove('expanded');
        });
      }
    });
  }

  wrap.appendChild(toggleBtn);
  wrap.appendChild(innerWrap);

  const mk = (title, html) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tile-act-btn'; b.title = title; b.innerHTML = html;
    innerWrap.appendChild(b); return b;
  };
  const snap = mk('บันทึกภาพนิ่งลง Downloads', TILE_SVG_CAM);
  snap.addEventListener('click', e => { e.stopPropagation(); snapVideoFrame(t.video, chLabel(i) + '_' + displayCameraName(ch.src, ch.name)); });
  const rec = mk('บันทึกวิดีโอลงระบบ NVR (กดซ้ำเพื่อหยุด)', TILE_SVG_REC);
  rec.dataset.src = ch.src || '';
  if (state.activeNvrRecordings && state.activeNvrRecordings.has(ch.src)) {
    rec.classList.add('rec-on');
    rec.title = 'กำลังบันทึกลง NVR (คลิกเพื่อหยุด)';
  }
  rec.addEventListener('click', e => {
    e.stopPropagation();
    if (!ch.src) return;
    toggleNvrManualRecord(ch.src, rec, ch.name);
  });
  if (ch.src) {
    const isUnmutedInit = (state.unmutedSrc === ch.src);
    const audioBtn = mk(isUnmutedInit ? 'ปิดเสียง (กำลังเปิดเสียงสด)' : 'เปิดเสียง (สตรีมสด)', isUnmutedInit ? TILE_SVG_AUDIO_ON : TILE_SVG_AUDIO_MUTE);
    audioBtn.classList.add('tile-audio-btn');
    if (isUnmutedInit) audioBtn.classList.add('audio-on');
    t.audioBtn = audioBtn;
    t.audioUnmuted = isUnmutedInit;
    audioBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!t.video) return;
      const willUnmute = t.video.muted;
      if (willUnmute) {
        state.tiles.forEach(other => {
          if (other !== t) {
            other.audioUnmuted = false;
            if (other.video) {
              other.video.muted = true;
              if (other.cam) other.cam.unmutedByUser = false;
            }
            if (other.audioBtn) {
              other.audioBtn.classList.remove('audio-on');
              other.audioBtn.innerHTML = TILE_SVG_AUDIO_MUTE;
              other.audioBtn.title = 'เปิดเสียง (สตรีมสด)';
            }
          }
        });
        state.unmutedSrc = ch.src;
        t.audioUnmuted = true;
        t.video.muted = false;
        t.video.volume = 1.0;
        if (t.cam) t.cam.unmutedByUser = true;
        if (t.video.srcObject && t.video.srcObject.getAudioTracks) {
          t.video.srcObject.getAudioTracks().forEach(tr => { tr.enabled = true; });
        }
        t.video.play().catch(() => {});
        audioBtn.classList.add('audio-on');
        audioBtn.innerHTML = TILE_SVG_AUDIO_ON;
        audioBtn.title = 'ปิดเสียง (กำลังเปิดเสียงสด)';
        toast('🔊 เปิดเสียง: ' + displayCameraName(ch.src, ch.name));
      } else {
        state.unmutedSrc = null;
        t.audioUnmuted = false;
        t.video.muted = true;
        if (t.cam) t.cam.unmutedByUser = false;
        audioBtn.classList.remove('audio-on');
        audioBtn.innerHTML = TILE_SVG_AUDIO_MUTE;
        audioBtn.title = 'เปิดเสียง (สตรีมสด)';
        toast('🔇 ปิดเสียง: ' + displayCameraName(ch.src, ch.name));
      }
    });

    const gps = mk('ดูตำแหน่งพิกัดกล้องบนแผนที่ Heatmap', TILE_SVG_GPS);
    gps.classList.add('tile-gps-btn');
    gps.addEventListener('click', e => {
      e.stopPropagation();
      if (typeof window.flyToCameraOnHeatmap === 'function') {
        window.flyToCameraOnHeatmap(ch.src);
      }
    });

    // CLAUDE.md Section 10: Add Switch Camera button for individual user grid customization
    const sw = mk('เปลี่ยนกล้องในช่องนี้ (เลือกกล้องสำหรับหน้าจอของคุณ)', TILE_SVG_SWITCH);
    sw.classList.add('tile-sw-btn');
    sw.addEventListener('click', e => {
      e.stopPropagation();
      openCameraPickerForSlot(i);
    });
  }
  if (ch.sub) { // ไม่มีสตรีมรอง = ไม่มีอะไรให้สลับ
    const ms = mk('สลับสตรีมหลัก/รอง (ตอนนี้: สตรีมรอง)', '');
    ms.classList.add('tile-ms-btn');
    ms.textContent = 'SUB'; t.streamMode = 'sub'; // ตารางเริ่มที่ sub ตามเดิม (:403)
    ms.addEventListener('click', e => {
      e.stopPropagation();
      if (t.recorder) return;
      t.streamMode = t.streamMode === 'sub' ? 'main' : 'sub';
      ms.textContent = t.streamMode.toUpperCase();
      ms.classList.toggle('main', t.streamMode === 'main');
      ms.title = 'สลับสตรีมหลัก/รอง (ตอนนี้: ' + (t.streamMode === 'main' ? 'สตรีมหลัก' : 'สตรีมรอง') + ')';
      const snap = t.video ? (captureVideoPoster(t.video, 480) || t.video.poster || '') : '';
      if (t.cam) t.cam.destroy();
      if (t.video && snap) t.video.poster = snap;
      // สตรีมหลักสำหรับ "ดู" เลือกผ่าน playableMainStream() ซึ่งไล่ ch.hd → ch.sub → ch.src
      // เพื่อไม่ให้ตกไปที่สตรีมดิบ HEVC ที่เบราว์เซอร์เล่นไม่ได้ (ดูคำอธิบายที่ฟังก์ชันนั้น)
      t.cam = new Camera(t.streamMode === 'main' ? playableMainStream(ch) : ch.sub, t.video, s => setTileStatus(t, s), { hlsLite: true, chName: ch.name });
    });
  }
  t.el.appendChild(wrap);
}

function setTileStatus(t, status) {
  if (status === 'connecting' && t.video && (t.video.poster || t.video.videoWidth > 0)) {
    status = 'live';
  }
  if (status === 'reconnecting' && t.video && (t.video.poster || t.video.videoWidth > 0)) {
    const attempts = (t.cam && typeof t.cam._reconnAttempt === 'number') ? t.cam._reconnAttempt : 0;
    if (attempts <= 5) {
      status = 'live';
    }
  }
  t.status = status;
  t.el.dataset.status = status;
  t.el.querySelector('.ov-offline').hidden = status !== 'offline';
  t.el.querySelector('.ov-videoloss').hidden = status !== 'videoloss';
  t.el.querySelector('.ov-connecting').hidden = status !== 'connecting';
  t.el.querySelector('.ov-reconnecting').hidden = status !== 'reconnecting'; // Incident 1.56
  t.el.querySelector('.ov-disabled').hidden = status !== 'disabled';
  const recText = { live: 'REC', connecting: 'BUFFER', reconnecting: 'RECONNECT', offline: '—', videoloss: 'NO VIDEO', disabled: 'OFF' }[status];
  t.el.querySelector('.rec-text').textContent = recText;
  t.el.setAttribute('aria-label', chLabel(+t.el.dataset.idx) + ' ' + t.el.querySelector('.tile-name').textContent + ' สถานะ ' + status);
  updateStats();
}

function setActive(i) {
  state.activeIdx = i;
  state.tiles.forEach((t, j) => t.el.classList.toggle('active', j === i));
}

/**
 * สร้างหรืออัปเดตตารางช่องสัญญาณกล้องแบบ Differential Reconciliation (Phase P0 Zero-Drop)
 *
 * หากจำนวนช่องตารางมีอยู่แล้วและไม่ได้บังคับล้างทั้งหมด (`forceFull = false`) ระบบจะเรียก `syncGridDiffSmoothly()`
 * เพื่อคงอินสแตนซ์ `Camera` และ `<video>` ของช่องที่ไม่ได้เปลี่ยนแหล่งสัญญาณหรือสถานะการมองเห็นไว้ตามเดิม
 * เพื่อไม่ให้กล้องอื่นหลุดหรือต้องเชื่อมต่อใหม่เมื่อผู้ใช้เปลี่ยนกล้องเพียงบางช่อง ล้างช่องว่าง บันทึกการตั้งค่า หรือสลับตำแหน่งช่อง
 *
 * @param {boolean} [forceFull=false] บังคับทำลายและสร้างทุกช่องใหม่ทั้งหมด
 */
function rebuildGrid(forceFull = false) {
  if (!forceFull && !cfg.demo && Array.isArray(state.tiles) && state.tiles.length > 0 && $('grid') && $('grid').children.length > 0) {
    syncGridDiffSmoothly();
    return;
  }
  const lay = layoutOf(cfg.layout);
  const count = lay.rows * lay.cols;
  applyGridCols();

  const hiddenSet = new Set((state.userProfile && state.userProfile.hidden_channels) || []);
  const visibleSet = new Set((state.userProfile && state.userProfile.visible_channels) || []);
  const grid = $('grid');

  closeViewer();
  state.tiles.forEach(t => {
    if (t.recorder && t.recorder.state === 'recording') { try { t.recorder.stop(); } catch (e) {} }
    if (t.cam) t.cam.destroy();
  });
  grid.innerHTML = '';
  state.tiles = [];

  let savedPosters = null;
  try {
    const raw = sessionStorage.getItem('bpp_warm_posters');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.ts && (Date.now() - parsed.ts < 60000)) {
        savedPosters = parsed.map || null;
      }
      sessionStorage.removeItem('bpp_warm_posters');
    }
  } catch (e) {}

  for (let i = 0; i < count; i++) {
    const ch = normalizeChannelStreams(cfg.channels[i] || { src: '', name: '', sub: '' });
    const gridStream = playableGridStream(ch);
    const chNum = `CH${String(i + 1).padStart(2, '0')}`;
    const isHiddenByMe = !!(ch.src && hiddenSet.has(ch.src));
    const isExplicitlyVisible = visibleSet.size === 0 || visibleSet.has(ch.src) || visibleSet.has(String(i)) || visibleSet.has(chNum);
    const isPersonallyVisible = !isHiddenByMe && isExplicitlyVisible;
    const shouldDisable = !!(ch.src && (!isPersonallyVisible || ch.enabled === false));

    const t = tileTemplate(i, ch);
    t.cam = null; t.status = 'offline';
    t.configured = cfg.demo || !!ch.src; // ช่องว่างที่ยังไม่เพิ่มกล้องไม่ถูกนับใน status bar
    t._boundSrc = ch.src || '';
    t._boundSub = ch.sub || '';
    t._slotKey = `${ch.src || ''}|${gridStream}|${ch.enabled !== false}|${isPersonallyVisible}`;
    grid.appendChild(t.el);
    state.tiles.push(t);

    if (cfg.demo) {
      setTileStatus(t, DEMO_CAMS[i % DEMO_CAMS.length][1]);
    } else if (shouldDisable) {
      // ซ่อน/ปิดใช้งานเฉพาะมุมมองของผู้ใช้นี้ — ไม่เชื่อมต่อสตรีม (ไม่กระทบผู้อื่นและเซิร์ฟเวอร์)
      t.disabled = true;
      setTileStatus(t, 'disabled');
    } else if (ch.src && t.video) {
      if (savedPosters && savedPosters[ch.src]) {
        t.video.poster = savedPosters[ch.src];
      }
      // ตารางใช้สตรีมที่เบราว์เซอร์เล่นได้จริง (playableGridStream: ch.sub -> ch.hd -> ch.src)
      // Stagger การเปิดสตรีมทีละ 65ms เพื่อไม่ให้แย่งแบนด์วิดท์/WebSocket พร้อมกัน 10 ช่อง
      t.cam = new Camera(gridStream, t.video, s => setTileStatus(t, s), {
        hlsLite: true,
        chName: ch.name,
        startDelayMs: i * 65
      });
      attachTileActions(t, ch, i); // ปุ่มถ่ายภาพ/อัด/สลับสตรีม (เฉพาะช่องที่มีกล้องจริง)
    } else {
      setTileStatus(t, 'offline');
    }
  }
  if (state.editLayout) state.tiles.forEach(t => { t.el.draggable = true; }); // จัดเรียงอยู่ → เปิด drag ให้ tile ใหม่
  setActive(Math.min(state.activeIdx, count - 1));
  applySearch();
  updateStats();
  tickClock();
}

// Surgical Grid Diffing: อัปเดตชื่อกล้อง/ช่องสัญญาณเฉพาะช่องที่เปลี่ยนจริง โดยไม่ตัดสตรีมช่องอื่นที่กำลังเล่นอยู่
function syncGridDiffSmoothly() {
  const lay = layoutOf(cfg.layout);
  const count = lay.rows * lay.cols;
  const grid = $('grid');
  if (!grid || !Array.isArray(state.tiles) || state.tiles.length === 0) {
    rebuildGrid(true);
    return;
  }
  applyGridCols();
  const hiddenSet = new Set((state.userProfile && state.userProfile.hidden_channels) || []);
  const visibleSet = new Set((state.userProfile && state.userProfile.visible_channels) || []);

  if (state.viewerOpen) {
    const activeCh = cfg.channels[state.activeIdx] || { src: '', name: '', sub: '' };
    const activeTile = state.tiles[state.activeIdx];
    if (state.activeIdx >= count || !activeTile || activeTile._boundSrc !== (activeCh.src || '')) {
      closeViewer();
    }
  }

  // ถ้าลดขนาด Layout (เช่น 3x3 -> 2x2) ให้ลบเฉพาะช่องที่เกินออกโดยไม่แตะช่องที่ยังอยู่
  while (state.tiles.length > count) {
    const removed = state.tiles.pop();
    if (removed) {
      if (removed.recorder && removed.recorder.state === 'recording') {
        try { removed.recorder.stop(); } catch (e) {}
      }
      if (removed.cam) removed.cam.destroy();
      if (removed.el && removed.el.parentNode) removed.el.parentNode.removeChild(removed.el);
    }
  }

  for (let i = 0; i < count; i++) {
    const ch = normalizeChannelStreams(cfg.channels[i] || { src: '', name: '', sub: '' });
    const gridStream = playableGridStream(ch);
    const chNum = `CH${String(i + 1).padStart(2, '0')}`;
    const isHiddenByMe = !!(ch.src && hiddenSet.has(ch.src));
    const isExplicitlyVisible = visibleSet.size === 0 || visibleSet.has(ch.src) || visibleSet.has(String(i)) || visibleSet.has(chNum);
    const isPersonallyVisible = !isHiddenByMe && isExplicitlyVisible;
    const nextSlotKey = `${ch.src || ''}|${gridStream}|${ch.enabled !== false}|${isPersonallyVisible}`;
    const oldTile = state.tiles[i];

    // ถ้าช่องเดิมไม่ได้เปลี่ยนสตรีมหรือสถานะการมองเห็น ให้อัปเดตเฉพาะชื่อกล้องแบบ In-Place
    if (oldTile && oldTile._slotKey === nextSlotKey) {
      const nameEl = oldTile.el.querySelector('.tile-name');
      const dispName = ch.src ? displayCameraName(ch.src, ch.name) : 'ยังไม่ได้ตั้งค่า';
      if (nameEl && nameEl.textContent !== dispName) {
        nameEl.textContent = dispName;
      }
      const chipEl = oldTile.el.querySelector('.ch-chip');
      if (chipEl) chipEl.textContent = chLabel(i);
      oldTile.configured = cfg.demo || !!ch.src;
      oldTile._boundSrc = ch.src || '';
      oldTile._boundSub = ch.sub || '';
      if (oldTile.cam && oldTile.cam.opts) {
        oldTile.cam.opts.chName = ch.name;
      }
      continue;
    }

    // ช่องนี้มีการเปลี่ยนแหล่งสตรีมจริง -> เปลี่ยนเฉพาะช่องนี้ช่องเดียว
    if (oldTile) {
      if (oldTile.recorder && oldTile.recorder.state === 'recording') {
        try { oldTile.recorder.stop(); } catch (e) {}
      }
      if (oldTile.cam) oldTile.cam.destroy();
    }
    const newTile = tileTemplate(i, ch);
    newTile.cam = null;
    newTile.status = 'offline';
    newTile.configured = cfg.demo || !!ch.src;
    newTile._boundSrc = ch.src || '';
    newTile._boundSub = ch.sub || '';
    newTile._slotKey = nextSlotKey;
    if (oldTile && oldTile.el && oldTile.el.parentNode) {
      oldTile.el.parentNode.replaceChild(newTile.el, oldTile.el);
    } else {
      grid.appendChild(newTile.el);
    }
    state.tiles[i] = newTile;

    if (cfg.demo) {
      setTileStatus(newTile, DEMO_CAMS[i % DEMO_CAMS.length][1]);
    } else if (ch.src && (!isPersonallyVisible || ch.enabled === false)) {
      newTile.disabled = true;
      setTileStatus(newTile, 'disabled');
    } else if (ch.src && newTile.video) {
      newTile.cam = new Camera(gridStream, newTile.video, s => setTileStatus(newTile, s), {
        hlsLite: true,
        chName: ch.name
      });
      attachTileActions(newTile, ch, i);
    } else {
      setTileStatus(newTile, 'offline');
    }
    if (state.editLayout) newTile.el.draggable = true;
  }
  setActive(Math.min(state.activeIdx, count - 1));
  applySearch();
  updateStats();
  tickClock();
}

// สลับตำแหน่ง 2 ช่องในตาราง (โหมดจัดเรียง) — mutate cfg.channels แล้ว rebuild
function swapChannels(from, to) {
  const ch = cfg.channels;
  const a = ch[from] || { src: '', name: '', sub: '', enabled: true };
  const b = ch[to] || { src: '', name: '', sub: '', enabled: true };
  ch[from] = b; ch[to] = a;
  if (state.draft && state.draft.length) {
    state.draft[from] = { ...b };
    state.draft[to] = { ...a };
  }
  rebuildGrid();
}

/* ============ โหมดจัดเรียง Layout (drag & drop) ============ */
function setEditLayout(on) {
  const count = layoutOf(cfg.layout).rows * layoutOf(cfg.layout).cols;
  if (on && count < 2) { toast('เลือกตารางที่มีอย่างน้อย 2 ช่องก่อนจึงจัดเรียงได้'); return; }
  state.editLayout = on;
  if (on) state.layoutSnapshot = cfg.channels.map(c => ({ ...c })); // เผื่อกดยกเลิก
  const btn = $('btnEditLayout');
  btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on));
  $('btnLayoutSave').hidden = !on;
  $('btnLayoutCancel').hidden = !on;
  document.body.classList.toggle('editing-layout', on);
  state.tiles.forEach(t => { t.el.draggable = on; }); // enter/exit ไม่ rebuild — สตรีมไม่สะดุด
}

function applyGridCols() {
  const lay = layoutOf(cfg.layout);
  const vw = window.innerWidth;
  let cols = lay.cols;
  // มือถือ/แท็บเล็ต: จำกัดจำนวนคอลัมน์ไม่ให้กล้องเล็กเกินอ่าน (ตารางแนวตั้งเลื่อนแทน)
  if (vw < 768 && cfg.layout === '1x2') cols = 1;
  else if (vw < 560) cols = Math.min(lay.cols, 2);
  else if (vw < 900) cols = Math.min(lay.cols, 3);
  const grid = $('grid');
  grid.style.gridTemplateColumns = `repeat(${cols},1fr)`;
  grid.dataset.layout = cfg.layout;   // CSS ใช้ [data-layout] ทำ 1×1/1×2 ให้เต็มจอบนมือถือ
}

function updateStats() {
  // นับเฉพาะช่องที่มีกล้องจริง — ช่องว่าง (ยังไม่ได้เพิ่มกล้อง) ไม่ใช่กล้องออฟไลน์
  let live = 0, connecting = 0, offline = 0;
  state.tiles.forEach(t => {
    if (!t.configured) return;
    if (t.status === 'live') live++;
    else if (t.status === 'connecting' || t.status === 'reconnecting') connecting++;
    else offline++;
  });
  $('statLive').textContent = live;
  $('statConnecting').textContent = connecting;
  $('statOffline').textContent = offline;
}

/* ============ layout switcher ============ */
function buildLayoutSwitch() {
  const wrap = $('layoutSwitch');
  wrap.innerHTML = '';
  LAYOUTS.forEach(lay => {
    const nice = lay.key.replace('x', '×');
    const b = document.createElement('button');
    b.className = 'layout-btn';
    b.title = nice;
    b.setAttribute('aria-label', 'ตาราง ' + nice);
    b.setAttribute('aria-pressed', String(cfg.layout === lay.key));
    const dots = document.createElement('span');
    dots.className = 'layout-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.style.gridTemplateColumns = `repeat(${lay.cols},1fr)`;
    dots.style.gridTemplateRows = `repeat(${lay.rows},1fr)`;
    for (let i = 0; i < lay.rows * lay.cols; i++) dots.appendChild(document.createElement('span'));
    const label = document.createElement('span');
    label.className = 'layout-label';
    label.textContent = nice;
    b.append(dots, label);
    b.addEventListener('click', () => {
      if (cfg.layout === lay.key) return;
      cfg.layout = lay.key;
      state.activeIdx = 0;
      state.manualLayoutOverride = true; // บันทึกว่าเป็นการเลือกด้วยตนเองใน session นี้
      saveCfg();
      buildLayoutSwitch();
      rebuildGrid();
    });
    wrap.appendChild(b);
  });
}

/* ============ search ============ */
function applySearch() {
  const q = state.query.trim().toLowerCase();
  state.tiles.forEach((t, i) => {
    const name = t.el.querySelector('.tile-name').textContent.toLowerCase();
    const cl = chLabel(i).toLowerCase();
    const match = q === '' || name.includes(q) || cl.includes(q) || String(i + 1) === q;
    t.el.classList.toggle('dim', q !== '' && !match);
  });
}

/* ============ นาฬิกา ============ */
function tickClock() {
  const now = new Date();
  const time = fmtTime(now);
  $('clock').textContent = time;
  $('dateStr').textContent = fmtDate(now);
  document.querySelectorAll('.tile-clock').forEach(el => { el.textContent = time; });
  // demo clip player จำลองเวลาเดิน
  if (cfg.demo && state.playerEv && state.demoPlay.playing) {
    state.demoPlay.t = state.demoPlay.t + 1 > state.playerEv.dur ? 0 : state.demoPlay.t + 1;
    renderDemoSeek();
  }
}

/* ============ เหตุการณ์ ============ */
function normalizeDemoEvents() {
  return DEMO_EVENTS.map((e, i) => ({
    id: 'demo-' + i,
    camIdx: e.cam,
    camera: DEMO_CAMS[e.cam % DEMO_CAMS.length][0],
    label: e.type, type: e.type,
    mins: e.mins, dur: e.dur, conf: e.conf,
    thumb: null, demoBg: DEMO_SCENES[e.cam % DEMO_SCENES.length],
    hasClip: true, startTime: Date.now() / 1000 - e.mins * 60,
  }));
}

// ดึงค่า pre_capture จาก Frigate runtime config — ใช้คำนวณ seekOffset ให้ตรง bestshot
// Frigate 0.14+ เก็บค่านี้ที่ record.events.pre_capture; fallback = 5s (Frigate default)
async function fetchFrigatePreCapture() {
  try {
    const res = await fetch(apiUrl('/api/config'), { signal: timeoutSignal(5000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const cfg_data = await res.json();
    state.frigatePreCapture =
      cfg_data?.record?.events?.pre_capture ??
      cfg_data?.record?.pre_capture ??
      5;
    console.log('[BPP-VMS] Frigate pre_capture =', state.frigatePreCapture, 's');
  } catch (e) {
    state.frigatePreCapture = 5; // Frigate default — safe fallback
    console.warn('[BPP-VMS] Could not read Frigate pre_capture, using default 5s');
  }
}

function extractFaceInfo(ev) {
  if (!ev) return { subLabel: null, subLabelScore: null };
  const raw = ev.sub_label !== undefined ? ev.sub_label : ev.subLabel;
  if (!raw) return { subLabel: null, subLabelScore: null };
  let name = '';
  let score = (ev.data && typeof ev.data.sub_label_score === 'number') ? ev.data.sub_label_score : (ev.subLabelScore || null);
  if (Array.isArray(raw)) {
    name = String(raw[0] || '').trim();
    if (typeof raw[1] === 'number') score = raw[1];
  } else {
    name = String(raw).trim();
  }
  if (!name) return { subLabel: null, subLabelScore: null };
  if (
    name.includes('Detection') ||
    name.includes('ตรวจพบ') ||
    name.includes('PEOPLE') ||
    name.includes('VEHICLE') ||
    isPlateString(name)
  ) {
    return { subLabel: null, subLabelScore: null };
  }
  const kind = ev.label || ev.type || '';
  if (kind && kind !== 'person') {
    return { subLabel: null, subLabelScore: null };
  }
  return { subLabel: name, subLabelScore: score };
}

let lastLprFetchTs = 0;
async function fetchEvents() {
  if (cfg.demo) { state.events = normalizeDemoEvents(); renderEvents(); return; }
  try {
    if (!state.events || state.events.length === 0) {
      const evListEl = $('evList');
      if (evListEl && !evListEl.children.length) {
        renderEventsEmptyState('loading');
      }
    }
    const now = Date.now() / 1000;
    if (now - lastLprFetchTs > 20) {
      lastLprFetchTs = now;
      fetchEmgrLprIndex();
    }
    const [res, vigiRes] = await Promise.all([
      fetch(apiUrl('/api/events?limit=50'), { signal: timeoutSignal(8000) }).catch(() => null),
      fetch('/api/watchlist/lpr/candidates?limit=20&source=vigi_edge_ai', { signal: timeoutSignal(8000) }).catch(() => null)
    ]);
    
    let list = [];
    // Incident 2.44: If Frigate is restarting (e.g. after AI toggle) or temporarily unreachable,
    // NEVER wipe state.events with []! Preserve cached events so alert rail stays visible.
    if (!res || !res.ok) {
      console.warn('[fetchEvents] Frigate API unavailable/restarting, preserving cached events');
      if (Array.isArray(state.events) && state.events.length) {
        state.events.forEach(ev => {
          if (ev.startTime) ev.mins = Math.max(0, (now - ev.startTime) / 60);
        });
        renderEvents();
      } else {
        renderEventsEmptyState('offline');
      }
      return;
    }

    try {
      list = await res.json();
    } catch (jsonErr) {
      console.warn('[fetchEvents] JSON parse error from Frigate, preserving cached events:', jsonErr);
      return;
    }
    
    let vigiList = [];
    if (vigiRes && vigiRes.ok) {
      try {
        vigiList = await vigiRes.json();
      } catch (_) {}
    }
    
    const vigiByEventId = new Map();
    if (Array.isArray(vigiList)) {
      vigiList.forEach(c => {
        if (c.event_id) vigiByEventId.set(c.event_id, c);
      });
    }

    const nextEvents = [];
    const addedIds = new Set();
    if (Array.isArray(list)) {
      list.forEach(ev => {
        try {
          const score = (ev.data && ev.data.top_score) || ev.top_score || 0;
          const camIdx = cfg.channels.findIndex(c => c.src === ev.camera);
          const vigiCand = vigiByEventId.get(ev.id);
          const subLabelStr = Array.isArray(ev.sub_label) ? String(ev.sub_label[0] || '') : String(ev.sub_label || '');
          const isVigiApiEvent = (ev.data && ev.data.type === 'api') || 
                                 (subLabelStr && (subLabelStr.includes('Detection') || subLabelStr.includes('ตรวจพบ') || subLabelStr.includes('PEOPLE') || subLabelStr.includes('VEHICLE'))) ||
                                 String(ev.id).startsWith('vigi_') || String(ev.id).startsWith('ext_');
          const cropPath = vigiCand?.crop_path || (isVigiApiEvent ? (ev.id + '.jpg') : '');
          const thumb = cropPath
            ? '/lpr-crops/' + encodeURIComponent(cropPath)
            : apiUrl('/api/events/' + encodeURIComponent(ev.id) + '/thumbnail.jpg');
          const plateStr = (vigiCand ? [vigiCand.plate_text, vigiCand.province].filter(Boolean).join(' ') : '') || plateOf(ev);
          const descStr = vigiCand?.description || (ev.data && ev.data.description) || subLabelStr || '';
          const faceInfo = extractFaceInfo(ev);

          nextEvents.push({
            id: ev.id,
            camIdx: camIdx >= 0 ? camIdx : null,
            camera: ev.camera,
            label: ev.label, type: typeOf(ev.label),
            mins: Math.max(0, (now - ev.start_time) / 60),
            dur: ev.end_time ? Math.max(1, ev.end_time - ev.start_time) : 0,
            conf: Math.round(score * 100) || (vigiCand ? Math.round((vigiCand.detector_confidence || 0.85) * 100) : 0),
            thumb: thumb,
            crop_path: cropPath,
            description: descStr,
            hasClip: !!ev.has_clip,
            startTime: ev.start_time,
            plate: plateStr,
            subLabel: faceInfo.subLabel,
            subLabelScore: faceInfo.subLabelScore,
            source: vigiCand ? (vigiCand.source || 'vigi_edge_ai') : (isVigiApiEvent ? 'vigi_edge_ai' : 'frigate')
          });
          addedIds.add(ev.id);
        } catch (innerErr) {
          console.error('Error parsing event:', ev.id, innerErr);
        }
      });
    }

    if (Array.isArray(vigiList)) {
      vigiList.forEach(candidate => {
        if (addedIds.has(candidate.event_id)) return;
        try {
          let eventTime = now;
          const match = candidate.event_id.match(/^(\d+(\.\d+)?)/);
          if (match) {
            eventTime = parseFloat(match[1]);
          } else if (candidate.created_at) {
            eventTime = new Date(candidate.created_at).getTime() / 1000;
          }
          const camIdx = cfg.channels.findIndex(c => c.src === candidate.camera);
          const descStr = candidate.description || '';
          const descLower = descStr.toLowerCase();
          let label = 'car';
          if (descLower.includes('person') || descLower.includes('บุคคล') || descLower.includes('คน')) label = 'person';
          else if (descLower.includes('vehicle') || descLower.includes('car') || descLower.includes('รถยนต์')) label = 'car';
          else if (descLower.includes('motion') || descLower.includes('เคลื่อนไหว')) label = 'motion';
          else label = 'motion';

          nextEvents.push({
            id: candidate.event_id,
            camIdx: camIdx >= 0 ? camIdx : null,
            camera: candidate.camera || '',
            label: label, type: typeOf(label),
            mins: Math.max(0, (now - eventTime) / 60),
            dur: 5,
            conf: Math.round((candidate.detector_confidence || 0.85) * 100),
            thumb: candidate.crop_path ? '/lpr-crops/' + encodeURIComponent(candidate.crop_path) : '',
            hasClip: true,
            startTime: eventTime,
            plate: [candidate.plate_text, candidate.province].filter(Boolean).join(' '),
            source: candidate.source || 'vigi_edge_ai',
            crop_path: candidate.crop_path || '',
            description: descStr,
          });
          addedIds.add(candidate.event_id);
        } catch (innerErr) {
          console.error('Error parsing VIGI event:', candidate.event_id, innerErr);
        }
      });
    }

    nextEvents.sort((a, b) => b.startTime - a.startTime);
    state.events = nextEvents.length > 50 ? nextEvents.slice(0, 50) : nextEvents;
  } catch (e) {
    console.error('Error fetching events:', e);
  }
  renderEvents();
}

function updateEventBadge(count) {
  const badge = $('eventBadge');
  if (badge) {
    badge.hidden = count <= 0;
    badge.textContent = count > 99 ? '99+' : String(count);
  }
  const tabBadge = $('railTabBadge');
  if (tabBadge) {
    tabBadge.hidden = count <= 0;
    tabBadge.textContent = count > 99 ? '99+' : String(count);
  }
}

function markEventsAsRead() {
  state.lastEventsReadTime = Date.now() / 1000;
  try {
    localStorage.setItem('bpp_events_last_read', String(state.lastEventsReadTime));
  } catch (e) {}
  updateEventBadge(0);
}

function renderEventsEmptyState(reason = 'none') {
  const list = $('evList');
  if (!list) return;
  const rc = (cfg.railClasses && cfg.railClasses.length) ? cfg.railClasses : null;
  const filterDesc = rc ? rc.map(t => typeMeta(t).label).join(', ') : '';

  if (reason === 'loading') {
    list.innerHTML = `
      <div class="events-loading">
        <div class="spinner"></div>
        <div class="events-empty-title">กำลังโหลดเหตุการณ์ล่าสุด…</div>
        <div class="events-empty-sub">กำลังเชื่อมต่อฐานข้อมูล AI NVR</div>
      </div>
    `;
    return;
  }

  if (reason === 'offline') {
    $('evTotal').textContent = 'เชื่อมต่อใหม่…';
    list.innerHTML = `
      <div class="events-empty-state">
        <div style="font-size:26px; line-height:1; margin-bottom:4px;">⏳</div>
        <div class="events-empty-title">กำลังเชื่อมต่อระบบเหตุการณ์…</div>
        <div class="events-empty-sub">รอสัญญาณจาก NVR หรือกำลังเริ่มต้นระบบใหม่</div>
        <button type="button" class="btn-clear-filter" id="btnRetryEvents">🔄 ลองเชื่อมต่อใหม่</button>
      </div>
    `;
    const btn = $('btnRetryEvents');
    if (btn) btn.addEventListener('click', () => {
      renderEventsEmptyState('loading');
      fetchEvents();
    });
    return;
  }

  // reason === 'none' (0 events matching filter)
  $('evTotal').textContent = '0 รายการ';
  list.innerHTML = `
    <div class="events-empty-state">
      <div style="font-size:26px; line-height:1; margin-bottom:4px;">🔔</div>
      <div class="events-empty-title">ไม่มีเหตุการณ์ล่าสุด</div>
      <div class="events-empty-sub">${rc ? `กำลังกรองเฉพาะ: ${escapeHtml(filterDesc)}` : 'ยังไม่พบการตรวจจับวัตถุใหม่ในช่วงนี้'}</div>
      ${rc ? '<button type="button" class="btn-clear-filter" id="btnResetRailFilter">ล้างตัวกรอง (แสดงทั้งหมด)</button>' : ''}
    </div>
  `;
  const resetBtn = $('btnResetRailFilter');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      cfg.railClasses = null;
      saveCfg();
      renderEvents();
      const pop = $('railClassPop');
      if (pop && !pop.hidden) renderRailClassPop();
    });
  }
}

function renderEvents() {
  // โฟกัสเฉพาะ class ที่ผู้ใช้เลือก (cfg.railClasses) — null = ทุก class ที่ตรวจพบ
  // ทั้งลิสต์ + badge แจ้งเตือน + chips นับเฉพาะที่โฟกัส ("แจ้งเตือนเฉพาะที่เลือก")
  const rc = (cfg.railClasses && cfg.railClasses.length) ? cfg.railClasses : null;
  const evs = rc ? state.events.filter(e => rc.indexOf(e.type) >= 0) : state.events;

  const btnRc = $('btnRailClasses');
  if (btnRc) {
    btnRc.classList.toggle('is-filtered', Boolean(rc && rc.length));
    btnRc.title = rc && rc.length
      ? `กำลังกรองเฉพาะ: ${rc.map(t => typeMeta(t).label).join(', ')} (คลิกเพื่อแก้ไข)`
      : 'เลือก Class ที่จะแจ้งเตือน/แสดงในแถบเหตุการณ์';
  }

  // badge = นับเฉพาะเหตุการณ์ใหม่หลังจากเวลากดดูล่าสุด และอยู่ภายใน 15 นาที
  const isRailOpen = !$('eventsRail').hidden;
  if (isRailOpen) {
    state.lastEventsReadTime = Date.now() / 1000;
    try {
      localStorage.setItem('bpp_events_last_read', String(state.lastEventsReadTime));
    } catch (e) {}
    updateEventBadge(0);
  } else {
    const unread = evs.filter(e => !state.lastEventsReadTime || e.startTime > state.lastEventsReadTime).length;
    updateEventBadge(Math.min(unread, 50));
  }

  // re-render เฉพาะเมื่อเนื้อหาเปลี่ยนจริง (รวมถึงป้ายทะเบียน LPR ที่เพิ่งประมวลผลเสร็จ)
  // ไม่นำ Math.floor(e.mins) มาใส่ใน sig เพื่อป้องกันการทำลายและสร้าง DOM ใหม่ทุกๆ 1 นาที (24/7 Zero-Churn)
  const sig = state.eventFilter + '|' + (rc ? rc.join('+') : 'auto') + '|' + cfg.channels.map(c => c.name || c.src).join(';') + '|'
    + evs.map(e => {
      const lpr = lprTagForEvent(e);
      const lprSig = lpr ? `${lpr.tag}:${lpr.type}` : '';
      return `${e.id}:${Math.round(e.dur || 0)}:${e.conf || 0}:${e.hasClip ? 1 : 0}:${e.plate || ''}:${lprSig}`;
    }).join(',');
  if (sig === state.evSignature) {
    // อัปเดตเฉพาะตัวเลขเวลา "เมื่อ X นาทีที่แล้ว" แบบ In-Place โดยไม่สร้างการ์ดหรือโหลดรูปใหม่
    const evById = new Map(evs.map(e => [String(e.id), e]));
    document.querySelectorAll('#evList .ev-card[data-ev-id]').forEach(card => {
      const ev = evById.get(card.dataset.evId);
      if (!ev) return;
      const agoEl = card.querySelector('.ev-ago');
      const nextAgo = fmtAgo(ev.mins);
      if (agoEl && agoEl.textContent !== nextAgo) {
        agoEl.textContent = nextAgo;
      }
    });
    return;
  }
  state.evSignature = sig;
  $('evTotal').textContent = evs.length + ' รายการ';

  // filter chips — จาก class ที่เลือกโฟกัส (ถ้าตั้งไว้) หรือชนิดที่มีในเหตุการณ์จริง (มาก→น้อย)
  const typeCounts = {};
  let plateCount = 0;
  evs.forEach(e => { 
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; 
    const lprTag = lprTagForEvent(e);
    if (lprTag && lprTag.isPlateCategory) plateCount++;
  });
  const presentTypes = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a]);
  const chipTypes = rc || presentTypes;
  if (state.eventFilter !== 'all' && state.eventFilter !== 'plate' && chipTypes.indexOf(state.eventFilter) < 0) state.eventFilter = 'all';
  const filters = [['all', 'ทั้งหมด']];
  filters.push(['plate', 'ป้ายทะเบียน']);
  chipTypes.forEach(t => filters.push([t, typeMeta(t).label]));
  const fWrap = $('evFilters');
  fWrap.innerHTML = '';
  filters.forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = 'filter-chip';
    b.setAttribute('aria-pressed', String(state.eventFilter === key));
    const cnt = key === 'all' ? evs.length : (key === 'plate' ? plateCount : (typeCounts[key] || 0));
    b.innerHTML = `<span></span><span class="cnt">${cnt}</span>`;
    b.firstChild.textContent = label;
    b.addEventListener('click', () => { state.eventFilter = key; renderEvents(); });
    fWrap.appendChild(b);
  });

  // cards
  const list = $('evList');
  list.innerHTML = '';
  const shown = evs.filter(e => {
    if (state.eventFilter === 'all') return true;
    if (state.eventFilter === 'plate') {
      const lprTag = lprTagForEvent(e);
      return lprTag && lprTag.isPlateCategory;
    }
    return e.type === state.eventFilter;
  });
  if (shown.length === 0) {
    renderEventsEmptyState('none');
    return;
  }
  shown.forEach(ev => {
    const meta = typeMeta(ev.label);
    const card = document.createElement('button');
    card.className = 'ev-card';
    card.dataset.evId = String(ev.id);
    card.setAttribute('aria-label', `${meta.label} ที่ ${ev.camera} ${fmtAgo(ev.mins)}`);
    card.innerHTML = `
      <div class="ev-thumb">
        <div class="ev-thumb-vignette"></div>
        <span class="type-chip" style="color:${meta.color}; border:1px solid ${meta.color}55;"><span class="type-dot" style="background:${meta.color}; box-shadow:0 0 6px ${meta.color};"></span><span class="tc-label"></span></span>
        <span class="ev-conf">${ev.conf}%</span>
        <span class="ev-play"><svg width="13" height="13" viewBox="0 0 24 24" fill="#e9d5ff" stroke="none" style="margin-left:2px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></span>
        <span class="ev-dur">${ev.dur ? fmtDur(ev.dur) : 'LIVE'}</span>
      </div>
      <div class="ev-meta">
        <span class="ch-chip">${ev.camIdx !== null ? chLabel(ev.camIdx) : 'NVR'}</span>
        <span class="ev-cam"></span>
        <span class="ev-ago">${fmtAgo(ev.mins)}</span>
      </div>`;
    card.querySelector('.tc-label').textContent = meta.label;
    card.querySelector('.ev-cam').textContent = ev.camIdx !== null && cfg.channels[ev.camIdx]
      ? displayCameraName(cfg.channels[ev.camIdx].src, cfg.channels[ev.camIdx].name)
      : (state.cameraNames?.[ev.camera] ? displayCameraName(ev.camera, state.cameraNames[ev.camera]) : (ev.camera || ''));
    const thumbEl = card.querySelector('.ev-thumb');
    const lprTag = lprTagForEvent(ev);
    if (lprTag) {
      const plate = document.createElement('span');
      plate.className = 'ev-plate';
      plate.title = lprTag.tag;
      plate.textContent = lprTag.tag;
      if (lprTag.type === 'non_plate') {
        plate.style.background = 'rgba(239, 68, 68, 0.85)';
      } else if (lprTag.type === 'confirmed' || lprTag.type === 'unreadable_reviewed') {
        plate.style.background = 'rgba(16, 185, 129, 0.85)';
      } else if (lprTag.type === 'partial') {
        plate.style.background = 'rgba(59, 130, 246, 0.85)';
      } else {
        plate.style.background = 'rgba(168, 85, 247, 0.85)';
      }
      thumbEl.appendChild(plate);
    } else if (ev.subLabel) {
      const faceBadge = document.createElement('span');
      faceBadge.className = 'ev-plate ev-face-badge';
      const scorePct = ev.subLabelScore ? ` (${Math.round(ev.subLabelScore * 100)}%)` : '';
      faceBadge.title = `ใบหน้า: ${ev.subLabel}${scorePct}`;
      faceBadge.textContent = `👤 ${ev.subLabel}`;
      faceBadge.style.background = 'rgba(147, 51, 234, 0.88)';
      faceBadge.style.borderColor = '#a855f7';
      thumbEl.appendChild(faceBadge);
    }
    if (ev.thumb) thumbEl.style.backgroundImage = `url("${escapeHtml(ev.thumb).replace(/"/g, '%22')}")`;
    else if (ev.demoBg) thumbEl.style.background = ev.demoBg;
    // คลิก = เปิดหน้าต่างเหตุการณ์อิสระ เล่นวิดีโอทันที (แยกจากคลัง — ปิดแล้วกลับหน้า Realtime)
    card.addEventListener('click', () => openRailEvent(ev));
    list.appendChild(card);
  });

  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'ev-empty';
    empty.textContent = rc ? 'ไม่มีเหตุการณ์ใน class ที่โฟกัส' : 'ไม่มีเหตุการณ์ประเภทนี้';
    list.appendChild(empty);
  }
}

// event จาก rail มี field ไม่ครบแบบของคลัง (hasClip/thumb แทน has_clip/has_snapshot/description)
// — แปลงก่อนส่งเข้า openEmgrDetail (กรณี event เก่ากว่า 1000 ตัวแรกของคลัง)
function adaptRailEv(ev) {
  return {
    id: ev.id, camera: ev.camera, camIdx: ev.camIdx, label: ev.label, type: ev.type,
    startTime: ev.startTime, mins: ev.mins, dur: ev.dur, conf: ev.conf,
    has_snapshot: true, // ลอง snapshot ก่อน — emgrThumb มี fallback thumbnail ให้อยู่แล้ว
    has_clip: !!ev.hasClip, description: ev.description || '',
    plate: ev.plate || '',
    subLabel: ev.subLabel || null,
    subLabelScore: ev.subLabelScore || null,
    source: ev.source || '',
    crop_path: ev.crop_path || '',
  };
}

// คลิกการ์ดใน rail → เปิดหน้าต่างรายละเอียดเหตุการณ์ "แบบอิสระ" (ไม่เปิดคลังใต้ modal)
// → เล่นวิดีโอทันที + สลับไปแท็บ Snapshot / รายละเอียดวัตถุที่ติดตามได้ + ปิดแล้วกลับหน้า Realtime
async function openRailEvent(ev) {
  if (cfg.demo) { openPlayer(ev); return; } // demo: ไม่มีข้อมูลจริง — เล่นคลิปจำลองแบบเดิม
  let full = null;
  try {
    // ดึงข้อมูล event ตัวเดียวให้ครบ (has_clip/has_snapshot/description) โดยไม่ต้องเปิดคลัง
    const res = await fetch(apiUrl('/api/events/' + encodeURIComponent(ev.id)), { signal: timeoutSignal(6000) });
    if (res.ok) {
      const e = await res.json();
      const score = (e.data && (e.data.top_score || e.data.score)) || e.top_score || 0;
      const camIdx = cfg.channels.findIndex(c => c.src === e.camera);
      const subLabelStr = Array.isArray(e.sub_label) ? String(e.sub_label[0] || '') : String(e.sub_label || '');
      const isVigiApi = (e.data && e.data.type === 'api') || 
                        (subLabelStr && (subLabelStr.includes('Detection') || subLabelStr.includes('ตรวจพบ') || subLabelStr.includes('PEOPLE') || subLabelStr.includes('VEHICLE'))) ||
                        String(e.id).startsWith('vigi_') || String(e.id).startsWith('ext_');
      const faceInfo = extractFaceInfo(e);
      full = {
        id: e.id, camera: e.camera, camIdx: camIdx >= 0 ? camIdx : null,
        label: e.label, type: typeOf(e.label), startTime: e.start_time,
        mins: Math.max(0, (Date.now() / 1000 - e.start_time) / 60),
        dur: e.end_time ? Math.max(1, e.end_time - e.start_time) : 0,
        conf: Math.round(score * 100), has_snapshot: !!e.has_snapshot, has_clip: !!e.has_clip,
        description: (e.data && e.data.description) || subLabelStr || ev.description || '',
        plate: plateOf(e) || ev.plate || '',
        subLabel: faceInfo.subLabel || ev.subLabel || null,
        subLabelScore: faceInfo.subLabelScore || ev.subLabelScore || null,
        source: ev.source || (isVigiApi ? 'vigi_edge_ai' : 'frigate'),
        crop_path: ev.crop_path || (isVigiApi ? (e.id + '.jpg') : ''),
        frameTime: e.frame_time || null,
      };
    }
  } catch (err) { /* เข้า Frigate ไม่ได้ — ใช้ข้อมูลจาก rail แทน */ }
    const detail = full || adaptRailEv(ev);
    const w = $('edIncompleteWarning');
    if (w) w.hidden = true;
    openEmgrDetail(detail);
  switchEmgrTab(detail.has_clip ? 'video' : 'snap'); // มีคลิป = เล่นทันที; ไม่มี = โชว์ snapshot ก่อน
}

// popover เลือก class โฟกัสของแถบเหตุการณ์ (persist ใน cfg.railClasses)
function renderRailClassPop() {
  const pop = $('railClassPop'); if (!pop) return;
  pop.innerHTML = '';
  const cur = (cfg.railClasses && cfg.railClasses.length) ? cfg.railClasses.slice() : null;
  const mkRow = (label, checked, onChange) => {
    const row = document.createElement('label');
    row.className = 'pb-evclass-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    row.appendChild(cb);
    const sp = document.createElement('span'); sp.textContent = label; row.appendChild(sp);
    pop.appendChild(row);
  };
  mkRow('อัตโนมัติ — ทุก class ที่ตรวจพบ', !cur, () => {
    cfg.railClasses = null; saveCfg(); renderRailClassPop(); renderEvents();
  });
  // รายชื่อจากลำดับกลุ่มเดิม (ความปลอดภัย → สัตว์ → ทั่วไป) + motion
  ['motion'].concat(OBJECT_ORDER).forEach(t => {
    mkRow((ICON_OF[t] ? ICON_OF[t] + ' ' : '') + typeMeta(t).label, !!(cur && cur.indexOf(t) >= 0), on => {
      let next = cur ? cur.slice() : [];
      if (on) { if (next.indexOf(t) < 0) next.push(t); }
      else next = next.filter(x => x !== t);
      cfg.railClasses = next.length ? next : null; // เอาออกหมด = กลับอัตโนมัติ
      saveCfg(); renderRailClassPop(); renderEvents();
    });
  });
}

function setEventsOpen(open) {
  cfg.eventsOpen = open;
  $('eventsRail').hidden = !open;
  $('railTab').hidden = open; // แถบเรียกกลับโผล่เฉพาะตอนซ่อน
  const bd = $('eventsBackdrop');
  if (bd) bd.hidden = !open;
  $('btnEvents').setAttribute('aria-pressed', String(open));
  saveCfg();
  markEventsAsRead();
}

/* ============ fullscreen camera viewer (Direct Zero-Load Live Passthrough + สลับ MAIN/SUB ไร้รอยต่อ) ============ */
function activeViewerVideo() {
  const camViewer = $('camViewer');
  if (camViewer && camViewer.classList.contains('is-passthrough') && state.viewerIdx !== null && state.tiles[state.viewerIdx] && state.tiles[state.viewerIdx].video) {
    return state.tiles[state.viewerIdx].video;
  }
  return $('cvVideo');
}

function updateViewerStreamBadge(ch) {
  const btn = $('btnCvStreamMode');
  if (!btn) return;
  const hasSub = !!(ch && ch.sub && ch.sub !== playableMainStream(ch));
  const isSub = state.viewerStreamMode === 'sub' && hasSub;
  btn.textContent = isSub ? 'SUB' : 'MAIN';
  btn.classList.toggle('is-sub', isSub);
  btn.disabled = !hasSub;
  btn.style.cursor = hasSub ? 'pointer' : 'default';
  btn.title = hasSub
    ? (isSub ? 'กำลังแสดงสตรีมรอง (ต่อเนื่องทันที/ลื่นไหล) — คลิกเพื่อสลับเป็นสตรีมหลัก (HD)' : 'กำลังแสดงสตรีมหลัก (คมชัดสูง HD) — คลิกเพื่อสลับเป็นสตรีมรอง (ลื่นไหล)')
    : 'กล้องนี้มีเฉพาะสตรีมหลัก';
}

function viewerStatus(status) {
  const colors = { live: '#34e2a8', connecting: '#fbbf24', reconnecting: '#fbbf24', videoloss: '#fb5b78', offline: '#fb5b78' };
  const texts = { live: 'ออนไลน์', connecting: 'กำลังเชื่อมต่อ', reconnecting: 'กำลังเชื่อมต่อใหม่', videoloss: 'วิดีโอขาดหาย', offline: 'ออฟไลน์' };
  const camViewer = $('camViewer');
  const isPassthrough = !!(camViewer && camViewer.classList.contains('is-passthrough'));
  const activeTile = (state.viewerIdx !== null && state.tiles && state.tiles[state.viewerIdx]) ? state.tiles[state.viewerIdx] : null;
  const tileHasVisual = !!(activeTile && activeTile.video && (activeTile.video.videoWidth > 0 || activeTile.video.poster || (activeTile.cam && activeTile.cam.isLive)));
  const cvVid = $('cvVideo');
  const cvHasVisual = !!(cvVid && (cvVid.videoWidth > 0 || cvVid.poster));

  // ห้ามแสดงป้าย "กำลังเชื่อมต่อ..." บังหน้าจอเด็ดขาด यदिมีภาพสดจากช่องตาราง (Passthrough) หรือมีเฟรมภาพแสดงอยู่แล้ว
  if ((status === 'connecting' || status === 'reconnecting') && (isPassthrough || tileHasVisual || cvHasVisual)) {
    status = 'live';
  }

  const dot = $('cvStatus').querySelector('.dot');
  dot.style.cssText = `background:${colors[status] || '#fb5b78'}; box-shadow:0 0 8px ${colors[status] || '#fb5b78'};`;
  $('cvStatusText').textContent = texts[status] || status;
  $('cvStatusText').style.color = colors[status] || '#fb5b78';
  const center = $('cvCenter');
  if (status === 'live') {
    if (state.viewerAutoSubT) {
      clearTimeout(state.viewerAutoSubT);
      state.viewerAutoSubT = null;
    }
    center.hidden = true;
    return;
  }
  center.hidden = false;
  center.classList.toggle('loss', status === 'videoloss');
  const streamLabel = state.viewerStreamMode === 'sub' ? 'สตรีมรอง' : 'สตรีมหลัก';
  $('cvCenterText').textContent = status === 'reconnecting'
    ? 'กำลังเชื่อมต่อใหม่ — โปรดรอสักครู่...'
    : status === 'videoloss'
    ? 'สัญญาณวิดีโอขาดหาย — กำลังลองใหม่อัตโนมัติ'
    : `กำลังเชื่อมต่อ${streamLabel}…`;
}

function startViewerCameraStream(ch, video, mode, tile) {
  const camViewer = $('camViewer');
  if (state.viewerAutoSubT) {
    clearTimeout(state.viewerAutoSubT);
    state.viewerAutoSubT = null;
  }
  if (state.viewerCam) {
    state.viewerCam.destroy();
    state.viewerCam = null;
  }
  const mainSrc = playableMainStream(ch);
  const hasSub = !!(ch.sub && ch.sub !== mainSrc);
  const useSub = (mode === 'sub' && hasSub);
  state.viewerStreamMode = useSub ? 'sub' : 'main';
  updateViewerStreamBadge(ch);

  // หากสลับกลับมาเป็น SUB และช่องตารางเดิมเป็น SUB อยู่แล้ว ให้สลับกลับไปใช้วิดีโอสดของช่องตารางทันที (0.00ms)
  if (useSub && tile && tile.cam && tile.video && (tile.streamMode || 'sub') === 'sub') {
    if (typeof tile.cam.resumeFromViewer === 'function') {
      tile.cam.resumeFromViewer();
    } else if (typeof tile.cam.resume === 'function') {
      tile.cam.resume();
    }
    tile.el.classList.add('viewer-active-tile');
    if (camViewer) camViewer.classList.add('is-passthrough');
    if (state.unmutedSrc === ch.src) {
      tile.video.muted = false;
      tile.video.volume = 1.0;
      if (tile.cam) tile.cam.unmutedByUser = true;
      if (video) video.muted = true;
    }
    viewerStatus('live');
    return;
  }

  // หากสลับเป็น MAIN (HD) ขณะมีวิดีโอสดของช่องตาราง ให้คงภาพสดเดิมไว้บนหน้าจอ (Passthrough) ระหว่างรอสตรีม HD ถอดรหัสเฟรมแรกเสร็จในพื้นหลัง
  const canKeepPassthroughWhileLoading = !!(tile && tile.cam && tile.video);
  if (canKeepPassthroughWhileLoading) {
    tile.el.classList.add('viewer-active-tile');
    if (camViewer) camViewer.classList.add('is-passthrough');
    viewerStatus('live');
  } else {
    if (camViewer) camViewer.classList.remove('is-passthrough');
    viewerStatus('connecting');
  }

  const targetSrc = useSub ? ch.sub : mainSrc;
  state.viewerCam = new Camera(targetSrc, video, st => {
    if (st === 'live') {
      // เมื่อสตรีมใหม่บน #cvVideo ถอดรหัสเฟรมแรกเสร็จแล้ว จึงสลับหน้าจอจาก Passthrough มายัง #cvVideo แบบไร้รอยต่อ 100%
      if (camViewer && camViewer.classList.contains('is-passthrough')) {
        camViewer.classList.remove('is-passthrough');
        if (tile && tile.cam && typeof tile.cam.pauseForViewer === 'function') {
          tile.cam.pauseForViewer();
        }
        if (state.unmutedSrc === ch.src) {
          video.muted = false;
          video.volume = 1.0;
          if (tile && tile.video) tile.video.muted = true;
        }
      }
      viewerStatus('live');
      return;
    }
    if (!canKeepPassthroughWhileLoading) {
      viewerStatus(st);
    }
  }, {
    chName: ch.name,
    preferMSE: streamTransportState.preferMSE
  });

  if (state.unmutedSrc === ch.src) {
    state.viewerCam.unmutedByUser = true;
    if (!canKeepPassthroughWhileLoading) {
      video.muted = false;
      video.volume = 1.0;
    }
  }
}

function openViewer(i) {
  const ch = cfg.channels[i] || { src: '', name: '' };
  if (!cfg.demo && !ch.src) return; // ช่องว่างไม่มีอะไรให้ดู
  closeViewer();

  $('cvChip').textContent = chLabel(i);
  const demoInfo = DEMO_CAMS[i % DEMO_CAMS.length];
  $('cvName').textContent = cfg.demo ? demoInfo[0] : displayCameraName(ch.src, ch.name);

  const camViewer = $('camViewer');
  const video = $('cvVideo');
  const demoBg = $('cvDemoBg');
  const tile = state.tiles[i];
  const initialPoster = (tile && tile.video) ? (captureVideoPoster(tile.video, 640) || tile.video.poster || '') : '';

  state.viewerIdx = i;
  state.viewingSrc = ch.src;

  const btnMode = $('btnCvStreamMode');
  if (btnMode) {
    btnMode.onclick = (e) => {
      e.stopPropagation();
      if (cfg.demo || !ch.sub || ch.sub === playableMainStream(ch)) return;
      const nextMode = state.viewerStreamMode === 'sub' ? 'main' : 'sub';
      startViewerCameraStream(ch, video, nextMode, tile);
      if (typeof toast === 'function') {
        toast(nextMode === 'main' ? 'สลับเป็นสตรีมหลัก (คมชัดสูง HD)' : 'สลับเป็นสตรีมรอง (เชื่อมต่อไว ลื่นไหล)');
      }
    };
  }

  if (cfg.demo) {
    if (camViewer) camViewer.classList.remove('is-passthrough');
    video.hidden = true;
    demoBg.hidden = false;
    demoBg.style.background = DEMO_SCENES[i % DEMO_SCENES.length];
    viewerStatus(demoInfo[1]);
  } else if (tile && tile.cam && tile.video) {
    // Direct Zero-Load Live Passthrough:
    // ยกวิดีโอสดจากช่องตารางเดิมขึ้นแสดงเต็มจอทันที (0.00ms) โดยไม่ตัดสตรีมและไม่ขึ้น "กำลังเชื่อมต่อ..."
    video.hidden = false;
    demoBg.hidden = true;
    if (tile.cam.viewerPaused || tile.cam.paused || tile.cam.suspended) {
      if (typeof tile.cam.resumeFromViewer === 'function') {
        tile.cam.resumeFromViewer();
      } else if (typeof tile.cam.resume === 'function') {
        tile.cam.resume();
      }
    }
    tile.el.classList.add('viewer-active-tile');
    if (camViewer) camViewer.classList.add('is-passthrough');
    const hasSub = !!(ch.sub && ch.sub !== playableMainStream(ch));
    state.viewerStreamMode = (tile.streamMode === 'main' || !hasSub) ? 'main' : 'sub';
    updateViewerStreamBadge(ch);
    viewerStatus('live');
  } else {
    if (camViewer) camViewer.classList.remove('is-passthrough');
    video.hidden = false;
    demoBg.hidden = true;
    const hasSub = !!(ch.sub && ch.sub !== playableMainStream(ch));
    const initialMode = hasSub ? 'sub' : 'main';
    if (initialPoster) video.poster = initialPoster;
    startViewerCameraStream(ch, video, initialMode, tile);
  }

  const activeVid = activeViewerVideo();
  const isCurrentlyUnmuted = (state.unmutedSrc === ch.src) || (tile && tile.audioUnmuted);
  const cvAudio = $('btnCvAudio');
  if (isCurrentlyUnmuted) {
    state.unmutedSrc = ch.src;
    if (activeVid) {
      activeVid.muted = false;
      activeVid.volume = 1.0;
      if (activeVid.srcObject && activeVid.srcObject.getAudioTracks) {
        activeVid.srcObject.getAudioTracks().forEach(tr => { tr.enabled = true; });
      }
      activeVid.play().catch(() => {});
    }
    if (state.viewerCam) state.viewerCam.unmutedByUser = true;
    if (tile && tile.cam) tile.cam.unmutedByUser = true;
    if (cvAudio) {
      cvAudio.classList.add('audio-on');
      cvAudio.innerHTML = CV_SVG_AUDIO_ON;
      cvAudio.title = 'ปิดเสียง (กำลังเปิดเสียงสด)';
    }
    if (tile && tile.video && tile.video !== activeVid) {
      tile.video.muted = true;
    }
  } else {
    if (video) video.muted = true;
    if (tile && tile.video) tile.video.muted = true;
    if (cvAudio) {
      cvAudio.classList.remove('audio-on');
      cvAudio.innerHTML = CV_SVG_AUDIO_MUTE;
      cvAudio.title = 'เปิดเสียง (คลิกเพื่อฟังเสียงสด)';
    }
  }
  const cvRec = $('btnCvRec');
  if (cvRec) {
    const isRec = !!(state.activeNvrRecordings && state.activeNvrRecordings.has(ch.src));
    cvRec.classList.toggle('rec-on', isRec);
    cvRec.title = isRec ? 'กำลังบันทึกลง NVR (คลิกเพื่อหยุด)' : 'บันทึกวิดีโอลงระบบ NVR';
  }
  // Warm-Pause เฉพาะช่องตารางอื่นที่อยู่เบื้องหลัง (ไม่แตะต้องช่องที่กำลังดูเต็มจอ!)
  state.tiles.forEach((t, idx) => {
    if (idx === i) return;
    if (t.cam) {
      if (typeof t.cam.pauseForViewer === 'function') {
        t.cam.pauseForViewer();
      } else if (typeof t.cam.suspend === 'function') {
        t.cam.suspend();
      }
    }
  });
  state.viewerOpen = true;
  if (camViewer) camViewer.hidden = false;
}

function closeViewer() {
  if (!state.viewerOpen) return;
  const viewingSrc = state.viewingSrc;
  const viewingIdx = state.viewerIdx;
  const wasUnmuted = (state.unmutedSrc === viewingSrc);
  const camViewer = $('camViewer');
  const wasPassthrough = !!(camViewer && camViewer.classList.contains('is-passthrough'));

  if (state.viewerAutoSubT) {
    clearTimeout(state.viewerAutoSubT);
    state.viewerAutoSubT = null;
  }
  const cvVid = $('cvVideo');
  // หากมีการสลับไปใช้ #cvVideo (โหมด MAIN) ให้ส่งต่อเฟรมภาพล่าสุดกลับไปยังช่องตารางก่อนปิด
  if (!wasPassthrough && cvVid && viewingIdx !== null && state.tiles[viewingIdx] && state.tiles[viewingIdx].video) {
    const latestSnap = captureVideoPoster(cvVid, 480);
    if (latestSnap) {
      state.tiles[viewingIdx].video.poster = latestSnap;
    }
  }

  state.tiles.forEach(t => {
    if (t.el) t.el.classList.remove('viewer-active-tile');
  });
  if (camViewer) camViewer.classList.remove('is-passthrough');

  if (state.cvRec && state.cvRec.state === 'recording') { try { state.cvRec.stop(); } catch (e) {} } // เซฟที่อัดค้าง
  if (state.viewerCam) { state.viewerCam.destroy(); state.viewerCam = null; }
  const cvAudio = $('btnCvAudio');
  if (cvAudio) {
    cvAudio.classList.remove('audio-on');
    cvAudio.innerHTML = CV_SVG_AUDIO_MUTE;
    cvAudio.title = 'เปิดเสียง (คลิกเพื่อฟังเสียงสด)';
  }
  if (cvVid) {
    cvVid.muted = true;
    cvVid.removeAttribute('poster');
    cvVid.srcObject = null;
    if (cvVid.src) { cvVid.removeAttribute('src'); try { cvVid.load(); } catch (e) {} }
  }
  state.viewerOpen = false;
  if (camViewer) camViewer.hidden = true;

  // Resume ช่องตารางทั้งหมดจาก Warm-Pause ทันทีแบบ Synchronous (0.00ms) โดยไม่เกิดการโหลดใหม่
  state.tiles.forEach((t, idx) => {
    if (!t.cam) return;
    if (t.cam.viewerPaused && !t.cam.suspended) {
      if (typeof t.cam.resumeFromViewer === 'function') {
        t.cam.resumeFromViewer();
      }
    } else if (t.cam.suspended) {
      setTimeout(() => {
        if (!state.viewerOpen && t.cam && t.cam.suspended) {
          if (typeof t.cam.resumeFromSuspend === 'function') {
            t.cam.resumeFromSuspend();
          }
        }
      }, idx * 25);
    }
  });

  if (wasUnmuted && viewingIdx !== null && state.tiles[viewingIdx]) {
    const t = state.tiles[viewingIdx];
    t.audioUnmuted = true;
    if (t.video) {
      t.video.muted = false;
      t.video.volume = 1.0;
      if (t.cam) t.cam.unmutedByUser = true;
      if (t.video.srcObject && t.video.srcObject.getAudioTracks) {
        t.video.srcObject.getAudioTracks().forEach(tr => { tr.enabled = true; });
      }
      t.video.play().catch(() => {});
    }
    if (t.audioBtn) {
      t.audioBtn.classList.add('audio-on');
      t.audioBtn.innerHTML = TILE_SVG_AUDIO_ON;
      t.audioBtn.title = 'ปิดเสียง (กำลังเปิดเสียงสด)';
    }
  }
}

/* ============ clip player ============ */
function openPlayer(ev) {
  if (!cfg.demo && !ev.hasClip) { toast('เหตุการณ์นี้ไม่มีคลิปวิดีโอ'); return; }
  state.playerEv = ev;
  state.demoPlay = { t: 0, playing: true };

  const meta = typeMeta(ev.label);
  $('pvTypeLabel').textContent = meta.label;
  const chip = $('pvTypeChip');
  chip.style.color = meta.color;
  chip.style.border = `1px solid ${meta.color}55`;
  chip.querySelector('.type-dot').style.cssText = `background:${meta.color}; box-shadow:0 0 6px ${meta.color};`;
  $('pvChLabel').textContent = ev.camIdx !== null ? chLabel(ev.camIdx) : 'NVR';
  $('pvCamName').textContent = ev.camIdx !== null && cfg.channels[ev.camIdx]
    ? displayCameraName(cfg.channels[ev.camIdx].src, cfg.channels[ev.camIdx].name)
    : ev.camera;
  const evDate = new Date(ev.startTime * 1000);
  $('pvTimeFull').textContent = fmtTime(evDate) + ' น.';
  $('pvConf').textContent = 'ความแม่นยำ ' + ev.conf + '%';
  $('pvConf').style.color = meta.color;
  $('pvFileName').textContent =
    ($('pvChLabel').textContent) + '_' + ev.label + '_' + fmtTime(evDate).replace(/:/g, '') + '.mp4';

  const stage = $('pvStage');
  const video = $('pvVideo');
  state.dlToken++; // ตัดงานดาวน์โหลดค้างของ event ก่อนหน้า ไม่ให้มาเขียนทับปุ่มของ event นี้
  clearInterval(state.dlTimer);
  resetDlBtn();
  $('sharePop').hidden = true;
  $('btnShare').setAttribute('aria-expanded', 'false');

  if (cfg.demo) {
    stage.classList.add('demo');
    stage.style.background = ev.demoBg;
    setPlayingUi(true);
    renderDemoSeek();
  } else {
    stage.classList.remove('demo');
    stage.style.background = '#05060c';
    if (isIOSBrowser) {
      prepareAndPlayVideoCompat({ purpose: 'playback', event_id: ev.id }, video, () => setPlayingUi(true), () => setPlayingUi(false));
    } else {
      video.src = apiUrl('/api/events/' + encodeURIComponent(ev.id) + '/clip.mp4');
      video.play().then(() => setPlayingUi(true)).catch(() => setPlayingUi(false));
    }
  }
  $('playerOverlay').hidden = false;
}

function closePlayer() {
  const video = $('pvVideo');
  video.pause(); cleanupCompatJob(video); video.removeAttribute('src'); video.load();
  if (pvZoom) pvZoom.reset(); // ไม่ให้ซูมค้างไป event ถัดไป
  state.playerEv = null;
  state.dlToken++;
  clearInterval(state.dlTimer);
  $('playerOverlay').hidden = true;
}

function setPlayingUi(playing) {
  if (cfg.demo) state.demoPlay.playing = playing;
  $('btnCenterPlay').classList.toggle('playing', playing);
  $('pvPlaySvgBig').style.display = playing ? 'none' : 'block';
  $('pvPauseSvgBig').style.display = playing ? 'block' : 'none';
  $('pvPlaySvgSm').style.display = playing ? 'none' : 'block';
  $('pvPauseSvgSm').style.display = playing ? 'block' : 'none';
}

function togglePlay() {
  if (!state.playerEv) return;
  if (cfg.demo) { setPlayingUi(!state.demoPlay.playing); return; }
  const video = $('pvVideo');
  if (video.paused) video.play().catch(() => {});
  else video.pause();
}

function renderSeek(cur, dur) {
  $('pvSeekFill').style.width = dur ? Math.min(100, (cur / dur) * 100) + '%' : '0%';
  $('pvTimeLabel').textContent = fmtDur(cur) + ' / ' + fmtDur(dur);
  $('pvSeek').setAttribute('aria-valuenow', Math.round(cur));
}
function renderDemoSeek() { renderSeek(state.demoPlay.t, state.playerEv ? state.playerEv.dur : 0); }

function seekTo(pct) {
  if (!state.playerEv) return;
  if (cfg.demo) { state.demoPlay.t = Math.round(pct * state.playerEv.dur); renderDemoSeek(); return; }
  const video = $('pvVideo');
  if (video.duration) { video.currentTime = pct * video.duration; }
}

function resetDlBtn() {
  const b = $('btnDownload');
  b.classList.remove('downloading', 'done');
  $('dlLabel').textContent = 'ดาวน์โหลดลง Storage';
  b.disabled = false;
}

async function downloadClip() {
  const ev = state.playerEv;
  if (!ev) return;
  const b = $('btnDownload');
  if (b.classList.contains('downloading') || b.classList.contains('done')) return;
  const fname = $('pvFileName').textContent;

  const token = state.dlToken; // ถ้าปิด player/เปิด event อื่นระหว่างทาง token จะเปลี่ยน → เลิกอัปเดต UI

  if (cfg.demo) { // จำลอง progress ตาม prototype
    b.classList.add('downloading');
    let pct = 0;
    clearInterval(state.dlTimer);
    state.dlTimer = setInterval(() => {
      if (token !== state.dlToken) { clearInterval(state.dlTimer); return; }
      pct = Math.min(100, pct + 6 + Math.floor(Math.random() * 7));
      $('dlLabel').textContent = 'กำลังดาวน์โหลด ' + pct + '%';
      if (pct >= 100) {
        clearInterval(state.dlTimer);
        b.classList.remove('downloading'); b.classList.add('done');
        $('dlLabel').textContent = 'บันทึกลง Storage แล้ว';
        toast('บันทึกคลิปลง Storage แล้ว — ' + fname);
      }
    }, 130);
    return;
  }

  b.classList.add('downloading');
  $('dlLabel').textContent = 'กำลังดาวน์โหลด 0%';
  try {
    const res = await fetch(apiUrl('/api/events/' + encodeURIComponent(ev.id) + '/clip.mp4'));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = +res.headers.get('content-length') || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      if (token !== state.dlToken) { try { reader.cancel(); } catch (e) {} return; }
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      $('dlLabel').textContent = total
        ? 'กำลังดาวน์โหลด ' + Math.round((got / total) * 100) + '%'
        : 'กำลังดาวน์โหลด ' + (got / 1048576).toFixed(1) + ' MB';
    }
    if (token !== state.dlToken) return;
    const url = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    b.classList.remove('downloading'); b.classList.add('done');
    $('dlLabel').textContent = 'บันทึกลง Storage แล้ว';
    toast('บันทึกคลิปลง Storage แล้ว — ' + fname);
  } catch (e) {
    if (token !== state.dlToken) return;
    b.classList.remove('downloading');
    $('dlLabel').textContent = 'ดาวน์โหลดลง Storage';
    toast('ดาวน์โหลดคลิปไม่สำเร็จ');
  }
}

function clipLink(ev) { return cfg.demo ? location.href : apiUrl('/api/events/' + encodeURIComponent(ev.id) + '/clip.mp4'); }

async function shareAction(kind) {
  const ev = state.playerEv;
  if (!ev) return;
  $('sharePop').hidden = true;
  $('btnShare').setAttribute('aria-expanded', 'false');
  if (kind === 'copy') {
    try { await copyText(clipLink(ev)); toast('คัดลอกลิงก์คลิปแล้ว'); }
    catch (e) { toast('คัดลอกลิงก์ไม่สำเร็จ'); }
  } else if (kind === 'email') {
    location.href = 'mailto:?subject=' + encodeURIComponent('คลิปเหตุการณ์ ' + $('pvFileName').textContent)
      + '&body=' + encodeURIComponent(clipLink(ev));
    toast('เปิดหน้าต่างส่งอีเมลแล้ว');
  } else if (kind === 'export') {
    downloadClip();
  }
}

/* ============ Event Manager (คลังวิดีโอเหตุการณ์) ============ */
function emgrThumb(ev) {
  if (cfg.demo) return null; // demo ใช้ demoBg แทน
  // VIGI / Edge webhook events: เสิร์ฟภาพจริงจาก /lpr-crops/ แทนเรียก Frigate API
  const isVigiApiEvent = (ev.data && ev.data.type === 'api') || 
                         (ev.sub_label && (ev.sub_label.includes('Detection') || ev.sub_label.includes('ตรวจพบ') || ev.sub_label.includes('PEOPLE') || ev.sub_label.includes('VEHICLE'))) ||
                         String(ev.id).startsWith('vigi_') || String(ev.id).startsWith('ext_');
  if (ev.source === 'vigi_edge_ai' || ev.source === 'edge_camera' || isVigiApiEvent) {
    if (ev.crop_path) return '/lpr-crops/' + encodeURIComponent(ev.crop_path);
    return '/lpr-crops/' + encodeURIComponent(ev.id + '.jpg');
  }
  // เหตุการณ์ของ Frigate ให้ใช้ภาพเต็มเฟรมพร้อมตีกรอบของ Frigate (snapshot.jpg?bbox=1) แทนภาพ crop ป้าย
  return apiUrl('/api/events/' + encodeURIComponent(ev.id) + (ev.has_snapshot ? '/snapshot.jpg?bbox=1' : '/thumbnail.jpg'));
}

// Populate the archive scope controls from the configured camera inventory.
// The blank option is deliberately “all cameras”, not the active tile only.
function populateEmgrArchiveScope() {
  const select = $('emgrCameraFilter');
  if (!select) return;
  const previous = state.emgrCameraFilter || '';
  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = ''; all.textContent = 'ทุกกล้อง'; select.appendChild(all);

  const activeCams = pbCamList();
  if (activeCams.length > 0) {
    const groupActive = document.createElement('optgroup');
    groupActive.label = 'กล้องบนแดชบอร์ด (เปิดใช้งาน)';
    activeCams.forEach(camera => {
      const option = document.createElement('option');
      option.value = camera; option.textContent = pbCamLabel(camera); groupActive.appendChild(option);
    });
    select.appendChild(groupActive);
  }

  const historicalCams = new Set();
  if (state.cameraNames) {
    Object.keys(state.cameraNames).forEach(c => {
      if (!activeCams.includes(c)) historicalCams.add(c);
    });
  }
  if (state.emgrEvents) {
    state.emgrEvents.forEach(e => {
      if (e.camera && !activeCams.includes(e.camera)) historicalCams.add(e.camera);
    });
  }
  if (historicalCams.size > 0) {
    const groupHistory = document.createElement('optgroup');
    groupHistory.label = 'กล้องอื่นๆ / ประวัติย้อนหลัง';
    Array.from(historicalCams).sort().forEach(camera => {
      const option = document.createElement('option');
      option.value = camera;
      const dName = displayCameraName(camera, state.cameraNames?.[camera] || camera);
      option.textContent = dName && dName !== camera ? `${dName} (${camera})` : camera;
      groupHistory.appendChild(option);
    });
    select.appendChild(groupHistory);
  }

  select.value = Array.from(select.options).some(option => option.value === previous) ? previous : '';
  state.emgrCameraFilter = select.value;
  const date = $('emgrDateFilter');
  if (date) date.value = state.emgrDateFilter || '';
}

// Convert a calendar day in the browser's local timezone to Frigate's epoch
// bounds. An empty value intentionally has no bounds and represents all days.
function emgrArchiveDayBounds(day) {
  if (!day) return null;
  const [year, month, date] = day.split('-').map(Number);
  const start = new Date(year, month - 1, date, 0, 0, 0);
  const end = new Date(year, month - 1, date, 23, 59, 59, 999);
  return {
    after: Math.floor(start.getTime() / 1000),
    before: Math.floor(end.getTime() / 1000)
  };
}

function emgrDateLabel(d) {
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  const isYesterday = d.getFullYear() === yest.getFullYear() && d.getMonth() === yest.getMonth() && d.getDate() === yest.getDate();

  if (isToday) return `วันนี้ — ${fmtDate(d)}`;
  if (isYesterday) return `เมื่อวานนี้ — ${fmtDate(d)}`;
  return fmtDate(d);
}

// Read a small server page on demand. Older records are paged via infinite scroll.
async function fetchEmgrArchivePage(before = null, limit = 50) {
  const bounds = emgrArchiveDayBounds(state.emgrDateFilter);
  const params = new URLSearchParams({ limit: String(limit) });
  if (state.emgrCameraFilter) params.set('camera', state.emgrCameraFilter);
  if (bounds) params.set('after', String(bounds.after));

  params.set('labels', 'car,motorcycle,truck,bus,person');

  let effectiveBefore = null;
  if (before !== null && before !== undefined) {
    effectiveBefore = bounds ? Math.min(before, bounds.before) : before;
  } else if (bounds) {
    effectiveBefore = bounds.before;
  }
  if (effectiveBefore !== null) {
    params.set('before', String(effectiveBefore));
  }

  let response = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(apiUrl('/api/events?' + params.toString()), { signal: timeoutSignal(15000) });
      if (response && response.ok) break;
      if (response && [502, 503, 504].includes(response.status) && attempt < 2) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      break;
    } catch (err) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }

  if (!response || !response.ok) throw new Error('events ' + (response ? response.status : 'network error'));
  const page = await response.json();
  if (!Array.isArray(page) || !page.length) return { page: [], nextBefore: null, hasMore: false };
  const oldest = page.reduce((candidate, event) => Number(event.start_time) < Number(candidate.start_time) ? event : candidate, page[0]);
  const nextBefore = Math.floor(Number(oldest.start_time)) - 1;
  const hasMore = page.length === limit && Number.isFinite(nextBefore) && (!bounds || nextBefore >= bounds.after);
  return { page, nextBefore: hasMore ? nextBefore : null, hasMore };
}

const MMCR_BODY_TYPES = ['รถตู้', 'รถกระบะ', 'รถ SUV', 'รถเก๋ง', 'รถมอเตอร์ไซค์', 'รถบรรทุก', 'รถบัส', 'รถยนต์'];
const MMCR_COLORS = ['สีขาว', 'สีดำ', 'สีบรอนซ์เงิน', 'สีเทา', 'สีแดง', 'สีน้ำเงิน', 'สีฟ้า', 'สีเขียว', 'สีเหลือง', 'สีส้ม', 'สีทอง', 'สีน้ำตาล', 'สีม่วง'];

function parseMmcrFromDescription(ev) {
  if (!ev || !ev.description) return;
  const desc = ev.description;
  if (!ev.vehicle_type) {
    for (const t of MMCR_BODY_TYPES) {
      if (desc.includes(t)) {
        ev.vehicle_type = t;
        break;
      }
    }
  }
  if (!ev.vehicle_color) {
    for (const c of MMCR_COLORS) {
      if (desc.includes(c)) {
        ev.vehicle_color = c;
        break;
      }
    }
  }
  if (!ev.plate) {
    const m = desc.match(/\[(.*?)\]/);
    if (m && m[1]) {
      ev.plate = m[1].trim();
    }
  }
}

function hydrateEventMmcr(ev) {
  if (!ev) return;
  const mmcr = state.emgrMmcrByEvent?.get(ev.id);
  if (mmcr) {
    if (mmcr.plateStr && !ev.plate) ev.plate = mmcr.plateStr;
    if (mmcr.vehicle_color) ev.vehicle_color = mmcr.vehicle_color;
    if (mmcr.vehicle_type) ev.vehicle_type = mmcr.vehicle_type;
    if (mmcr.vehicle_brand) ev.vehicle_brand = mmcr.vehicle_brand;
    if (mmcr.vehicle_model) ev.vehicle_model = mmcr.vehicle_model;
    if (mmcr.description && !ev.description) ev.description = mmcr.description;
  }
  parseMmcrFromDescription(ev);
}

// Normalize a page once so paging cannot change filtering/search behavior.
function appendEmgrArchivePage(events) {
  const now = Date.now() / 1000;
  const known = new Set(state.emgrEvents.map(event => event.id));
  events.forEach(ev => {
    if (known.has(ev.id)) return;
    const score = (ev.data && (ev.data.top_score || ev.data.score)) || ev.top_score || 0;
    const camIdx = cfg.channels.findIndex(c => c.src === ev.camera);
    const subLabelStr = Array.isArray(ev.sub_label) ? String(ev.sub_label[0] || '') : String(ev.sub_label || '');
    const desc = (ev.data && ev.data.description) || subLabelStr || '';
    const isVigiApiEvent = (ev.data && ev.data.type === 'api') || 
                           (subLabelStr && (subLabelStr.includes('Detection') || subLabelStr.includes('ตรวจพบ') || subLabelStr.includes('PEOPLE') || subLabelStr.includes('VEHICLE'))) ||
                           String(ev.id).startsWith('vigi_') || String(ev.id).startsWith('ext_');
    const faceInfo = extractFaceInfo(ev);
    const newEv = {
      id: ev.id, camera: ev.camera, camIdx: camIdx >= 0 ? camIdx : null,
      label: ev.label, type: typeOf(ev.label),
      startTime: ev.start_time, mins: Math.max(0, (now - ev.start_time) / 60),
      dur: ev.end_time ? Math.max(1, ev.end_time - ev.start_time) : 0,
      conf: Math.round(score * 100),
      has_snapshot: !!ev.has_snapshot, has_clip: !!ev.has_clip,
      description: desc,
      plate: plateOf(ev),
      subLabel: faceInfo.subLabel,
      subLabelScore: faceInfo.subLabelScore,
      frameTime: ev.frame_time || null,
      source: isVigiApiEvent ? 'vigi_edge_ai' : 'frigate',
      crop_path: isVigiApiEvent ? (ev.id + '.jpg') : '',
    };
    hydrateEventMmcr(newEv);
    state.emgrEvents.push(newEv);
  });
  state.emgrEvents.sort((a, b) => b.startTime - a.startTime);
}

let emgrFetchCooldown = 0;

async function fetchEmgrEvents() {
  const gen = (state.emgrGen = (state.emgrGen || 0) + 1); // กัน response เก่ามาทับใหม่
  $('emgrFilters').innerHTML = '';
  if (cfg.demo) {
    state.emgrEvents = normalizeDemoEvents().map(e => ({
      id: e.id, camera: e.camera, camIdx: e.camIdx, label: e.label, type: e.type,
      startTime: e.startTime, mins: e.mins, dur: e.dur, conf: e.conf,
      has_snapshot: false, has_clip: true, demoBg: e.demoBg, description: '',
    }));
    state.emgrArchiveHasMore = false;
    state.emgrArchiveNextBefore = null;
    renderEventMgr();
    return;
  }
  const previousEvents = Array.isArray(state.emgrEvents) ? [...state.emgrEvents] : [];
  if (!previousEvents.length) {
    $('emgrBody').innerHTML = '<div class="emgr-empty"><div class="emgr-loading-spinner" style="margin: 0 auto 10px;"></div>กำลังเปิดคลังเหตุการณ์…</div>';
  }
  state.emgrArchiveLoadingMore = false;
  try {
    const result = await fetchEmgrArchivePage(null, 50);
    if (gen !== state.emgrGen) return; // มีการโหลดใหม่ระหว่างรอ — ทิ้งผลเก่า
    state.emgrEvents = [];
    appendEmgrArchivePage(result.page);
    state.emgrArchiveNextBefore = result.nextBefore;
    state.emgrArchiveHasMore = result.hasMore;
    renderEventMgr(); // Immediate 50ms display for user
    await fetchEmgrLprIndex(true);
  } catch (e) {
    if (gen !== state.emgrGen) return;
    console.warn('[fetchEmgrEvents] Failed to fetch archive events:', e);
    if (previousEvents.length > 0) {
      state.emgrEvents = previousEvents;
      if (window.bppToast) window.bppToast('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ NVR ได้ชั่วคราว แสดงประวัติที่แคชไว้', true);
    } else {
      state.emgrEvents = [];
    }
    state.emgrArchiveHasMore = false;
  }
  if (gen === state.emgrGen) {
    renderEventMgr();
  }
}

function getFilteredEmgrEvents() {
  const q = (state.emgrQuery || '').trim();
  let evs = state.emgrEvents.filter(e => emgrMatch(e, q));
  if (state.emgrTypeFilter === 'plate') {
    evs = evs.filter(e => {
      const lprTag = lprTagForEvent(e);
      return lprTag && lprTag.isPlateCategory;
    });
  } else if (state.emgrTypeFilter !== 'all') {
    evs = evs.filter(e => e.type === state.emgrTypeFilter);
  }
  if (state.emgrDescOnly) evs = evs.filter(e => e.description);
  if (state.emgrSourceFilter && state.emgrSourceFilter !== 'all') {
    evs = evs.filter(e => e.source === state.emgrSourceFilter);
  }
  if (state.emgrLprFilter !== 'all') {
    evs = evs.filter(event => state.emgrLprByEvent?.get(event.id)?.has(state.emgrLprFilter));
  }
  return evs;
}

let emgrCooldownTimer = null;
async function fetchEmgrNextPage(manual = false) {
  const now = Date.now();
  if (state.emgrArchiveLoadingMore || !state.emgrArchiveHasMore || !state.emgrArchiveNextBefore) return;
  if (!manual && now - emgrFetchCooldown < 300) {
    clearTimeout(emgrCooldownTimer);
    emgrCooldownTimer = setTimeout(() => fetchEmgrNextPage(), 350);
    return;
  }
  emgrFetchCooldown = now;

  const gen = state.emgrGen;
  state.emgrArchiveLoadingMore = true;
  const sentinel = $('emgrSentinel');
  if (sentinel) {
    sentinel.innerHTML = '<div class="emgr-loading-spinner"></div><span>กำลังโหลดเหตุการณ์เพิ่มเติม…</span>';
  }

  const prevFilteredCount = getFilteredEmgrEvents().length;
  const isFiltered = state.emgrTypeFilter !== 'all' || state.emgrDescOnly || (state.emgrQuery && state.emgrQuery.trim()) || state.emgrLprFilter !== 'all';

  try {
    let loopCount = 0;
    while (state.emgrArchiveHasMore && state.emgrArchiveNextBefore && gen === state.emgrGen) {
      const result = await fetchEmgrArchivePage(state.emgrArchiveNextBefore, 50);
      if (gen !== state.emgrGen) break;
      const prevTotal = state.emgrEvents.length;
      appendEmgrArchivePage(result.page);
      state.emgrArchiveNextBefore = result.nextBefore;
      state.emgrArchiveHasMore = result.hasMore;
      if (state.emgrEvents.length === prevTotal) {
        state.emgrArchiveHasMore = false;
        break;
      }
      loopCount++;
      const currentFilteredCount = getFilteredEmgrEvents().length;
      // If unfiltered, 1 batch (50 items) is enough. If filtered, keep fetching until >= 1 new matching item or up to 20 batches (1,000 items).
      if (!isFiltered || currentFilteredCount > prevFilteredCount || loopCount >= 20 || !state.emgrArchiveHasMore) {
        break;
      }
      if (sentinel) {
        const searchSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:5px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
        sentinel.innerHTML = `<div class="emgr-loading-spinner"></div><span>${searchSvg}กำลังค้นหาประวัติย้อนหลัง... (ตรวจค้นแล้ว ${state.emgrEvents.length} รายการ)</span>`;
      }
    }
  } catch (e) {
    console.warn('Failed to load next event page:', e);
    if (gen !== state.emgrGen) return;
  } finally {
    if (gen === state.emgrGen) {
      state.emgrArchiveLoadingMore = false;
      renderEventMgr();
    }
  }
}

let isAutoSeekingPlates = false;
async function autoSeekPlateEvents(minCount = 12, maxScanned = 5000) {
  if (isAutoSeekingPlates || !state.emgrArchiveHasMore || !state.emgrArchiveNextBefore) return;
  isAutoSeekingPlates = true;
  const gen = state.emgrGen;
  const body = $('emgrBody');

  try {
    while (state.emgrArchiveHasMore && state.emgrArchiveNextBefore && gen === state.emgrGen && state.emgrTypeFilter === 'plate') {
      const currentPlates = state.emgrEvents.filter(e => lprTagForEvent(e)?.isPlateCategory).length;
      if (currentPlates >= minCount || state.emgrEvents.length >= maxScanned) {
        break;
      }
      
      const statusText = `กำลังค้นหาป้ายทะเบียนในประวัติย้อนหลัง... (ตรวจค้นแล้ว ${state.emgrEvents.length} รายการ, พบป้ายทะเบียน ${currentPlates} รายการ)`;
      const searchSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:5px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
      const statusBox = body?.querySelector('.emgr-auto-seek-status');
      if (statusBox) {
        statusBox.innerHTML = `<div class="emgr-loading-spinner"></div><span>${searchSvg}${escapeHtml(statusText)}</span>`;
      } else if (body) {
        const wrap = body.querySelector('.emgr-empty-wrap');
        if (wrap) {
          wrap.innerHTML = `<div class="emgr-sentinel emgr-auto-seek-status"><div class="emgr-loading-spinner"></div><span>${searchSvg}${escapeHtml(statusText)}</span></div>`;
        }
      }

      const result = await fetchEmgrArchivePage(state.emgrArchiveNextBefore, 50);
      if (gen !== state.emgrGen || state.emgrTypeFilter !== 'plate') break;
      const prevCount = state.emgrEvents.length;
      appendEmgrArchivePage(result.page);
      state.emgrArchiveNextBefore = result.nextBefore;
      state.emgrArchiveHasMore = result.hasMore;
      if (state.emgrEvents.length === prevCount) {
        state.emgrArchiveHasMore = false;
        break;
      }
    }
  } catch (err) {
    console.warn('Auto-seek plate events error:', err);
  } finally {
    isAutoSeekingPlates = false;
    if (gen === state.emgrGen && state.emgrTypeFilter === 'plate') {
      renderEventMgr();
    }
  }
}

function setupEmgrSentinelObserver(sentinel, body) {
  if (!sentinel || !body) return;
  if (!('IntersectionObserver' in window)) {
    body.onscroll = () => {
      if (state.emgrArchiveHasMore && !state.emgrArchiveLoadingMore) {
        if (body.scrollTop + body.clientHeight >= body.scrollHeight - 300) {
          fetchEmgrNextPage();
        }
      }
    };
    return;
  }
  state.emgrScrollObserver = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) {
      fetchEmgrNextPage();
    }
  }, { root: body, rootMargin: '300px 0px', threshold: 0.01 });
  state.emgrScrollObserver.observe(sentinel);
}

// Convert backend candidate truth into the five operator-facing archive states.
function lprCandidateBucket(candidate) {
  if (candidate.review_state === 'conflict') return 'conflict';
  if (candidate.status === 'not_found' || candidate.operational_visible === false || Boolean(candidate.non_plate_reason)) return 'non_plate';
  if (candidate.status === 'detected_unreadable') return 'unreadable';
  if (candidate.status === 'partial') return 'partial';
  if (candidate.human_confirmed && candidate.status === 'readable') return 'confirmed';
  if (!candidate.human_confirmed && candidate.review_state === 'pending' && candidate.status === 'readable') return 'ai_pending';
  return null;
}

function lprTagForEvent(ev) {
  if (!ev) return null;
  const lprInfo = state.emgrLprByEvent?.get(ev.id);
  if (lprInfo) {
    if (lprInfo.isNonPlate) {
      if (lprInfo.isReviewed) {
        return { tag: '[สอนแล้ว: ไม่ใช่ป้าย]', type: 'non_plate', isPlateCategory: false };
      }
      return null;
    }
    if (lprInfo.isReviewed) {
      if (lprInfo.status === 'detected_unreadable') {
        return { tag: '[สอนแล้ว: อ่านไม่ได้]', type: 'unreadable_reviewed', isPlateCategory: true };
      }
      const plateStr = [lprInfo.plateText, lprInfo.province].filter(Boolean).join(' ');
      if (plateStr) {
        return { tag: '[ยืนยันแล้ว: ' + plateStr + ']', type: 'confirmed', isPlateCategory: true };
      }
      return { tag: '[สอนแล้ว]', type: 'confirmed', isPlateCategory: true };
    }
    if (lprInfo.status === 'detected_unreadable' || lprInfo.status === 'pending_review') {
      if (!lprInfo.plateText) {
        return null;
      }
      return { tag: '[รอสอน AI]', type: 'unreadable_pending', isPlateCategory: true };
    }
    const plateStr = [lprInfo.plateText, lprInfo.province].filter(Boolean).join(' ');
    if (plateStr) {
      if (lprInfo.status === 'partial' || lprInfo.reviewState === 'adjudicated') {
        return { tag: plateStr, type: 'partial', isPlateCategory: true };
      }
      return { tag: plateStr + ' [รอตรวจ]', type: 'ai_pending', isPlateCategory: true };
    }
    return null;
  }
  if (ev.plate && isPlateString(ev.plate)) {
    if (ev.plate.includes('รอสอน')) {
      return { tag: '[รอสอน AI]', type: 'pending', isPlateCategory: true };
    }
    return { tag: ev.plate, type: 'partial', isPlateCategory: true };
  }
  return null;
}

// Build an event-to-status index from the candidate API and hydrate plate events.
async function fetchEmgrLprIndex(forceFull = false) {
  if (!state.emgrLprByEvent) state.emgrLprByEvent = new Map();
  if (!state.emgrMmcrByEvent) state.emgrMmcrByEvent = new Map();
  if (cfg.demo || !SAME_ORIGIN) return;
  try {
    const isEmgrOpen = forceFull || Boolean($('eventMgrOverlay') && !$('eventMgrOverlay').hidden);
    const limit = isEmgrOpen ? 2000 : 120;
    let url = `/api/watchlist/lpr/candidates?limit=${limit}`;
    if (state.emgrSourceFilter && state.emgrSourceFilter !== 'all') {
      url += `&source=${encodeURIComponent(state.emgrSourceFilter)}`;
    }
    const response = await fetch(url, { signal: timeoutSignal(12000) });
    if (!response.ok) throw new Error('LPR candidates ' + response.status);
    const candidates = await response.json();
    const newMap = new Map();
    const mmcrMap = new Map();
    const bounds = emgrArchiveDayBounds(state.emgrDateFilter);
    const existingEventMap = new Map();
    state.emgrEvents.forEach(e => existingEventMap.set(e.id, e));
    let addedCount = 0;

    candidates.forEach(candidate => {
      const bucket = lprCandidateBucket(candidate);
      const isNoiseCandidate = (candidate.status === 'detected_unreadable' || candidate.status === 'pending_review') &&
                               !candidate.plate_text && !candidate.human_confirmed;
      const isNonPlate = candidate.status === 'not_found' ||
                         candidate.operational_visible === false ||
                         Boolean(candidate.non_plate_reason) ||
                         isNoiseCandidate;
      const isReviewed = Boolean(Number(candidate.human_confirmed) === 1 || candidate.review_state === 'confirmed');
      const plateStr = [candidate.plate_text, candidate.province].filter(Boolean).join(' ');
      const info = {
        bucket,
        isNonPlate,
        isReviewed,
        status: candidate.status,
        reviewState: candidate.review_state,
        plateText: candidate.plate_text || '',
        province: candidate.province || '',
        source: candidate.source || '',
      };
      const mmcr = {
        plateStr,
        vehicle_color: candidate.vehicle_color || '',
        vehicle_type: candidate.vehicle_type || '',
        vehicle_brand: candidate.vehicle_brand || '',
        vehicle_model: candidate.vehicle_model || '',
        description: candidate.description || '',
      };
      const eventIds = new Set([candidate.event_id]);
      (candidate.linked_events || []).forEach(link => eventIds.add(link.event_id));
      eventIds.forEach(eventId => {
        if (!eventId) return;
        newMap.set(eventId, info);
        mmcrMap.set(eventId, mmcr);
      });

      // Hydrate vehicle MMCR (type/color/brand/model) into state.emgrEvents
      if (candidate.event_id) {
        const existing = existingEventMap.get(candidate.event_id);
        const descStr = candidate.description || '';
        if (existing) {
          if (plateStr) existing.plate = plateStr;
          if (candidate.vehicle_color) existing.vehicle_color = candidate.vehicle_color;
          if (candidate.vehicle_type) existing.vehicle_type = candidate.vehicle_type;
          if (candidate.vehicle_brand) existing.vehicle_brand = candidate.vehicle_brand;
          if (candidate.vehicle_model) existing.vehicle_model = candidate.vehicle_model;
          if (descStr && !existing.description) existing.description = descStr;
          if (candidate.source) existing.source = candidate.source;
        } else if (!isNonPlate && candidate.crop_path && (candidate.plate_text || candidate.human_confirmed || (candidate.source === 'vigi_edge_ai' && candidate.description))) {
          // Defensive noise filter (ADR-0029): Reject digits-only strings on motorcycles, cars, pickups
          const rawPlate = (candidate.plate_text || '').replace(/\s+/g, '');
          const hasThaiLetter = /[\u0E01-\u0E2E]/.test(rawPlate);
          const vType = (candidate.vehicle_type || '').toLowerCase();
          const isNonTruck = vType.includes('มอเตอร์ไซค์') || vType.includes('กระบะ') || vType.includes('เก๋ง') || vType.includes('suv') || vType.includes('รถยนต์');
          if (!hasThaiLetter && isNonTruck && /^\d+$/.test(rawPlate)) {
            return;
          }

          let eventTime = 0;
          const match = candidate.event_id.match(/^(\d+(\.\d+)?)/);
          if (match) {
            eventTime = parseFloat(match[1]);
          } else if (candidate.created_at) {
            eventTime = new Date(candidate.created_at).getTime() / 1000;
          }

          // Deduplication: If another card on same camera with identical plate exists within 45s, skip duplicate
          const isDup = state.emgrEvents.some(e => e.camera === candidate.camera && e.plate === plateStr && Math.abs(e.startTime - eventTime) < 45);
          if (isDup) {
            return;
          }

          // Apply camera filter if active
          if (state.emgrCameraFilter && candidate.camera && candidate.camera !== state.emgrCameraFilter) {
            return;
          }

          // Apply date filter bounds if active
          if (bounds && (eventTime < bounds.after || eventTime > bounds.before)) {
            return;
          }

          const camIdx = cfg.channels.findIndex(c => c.src === candidate.camera);
          const now = Date.now() / 1000;
          let label = 'car';
          if (candidate.source === 'vigi_edge_ai') {
            const descLower = (descStr || '').toLowerCase();
            if (descLower.includes('person') || descLower.includes('บุคคล') || descLower.includes('คน')) label = 'person';
            else if (descLower.includes('vehicle') || descLower.includes('car') || descLower.includes('รถยนต์')) label = 'car';
            else if (descLower.includes('motion') || descLower.includes('เคลื่อนไหว')) label = 'motion';
            else label = 'motion';
          }
          const isOldMedia = (now - eventTime) > (14 * 86400);
          const newEv = {
            id: candidate.event_id,
            camera: candidate.camera || '',
            camIdx: camIdx >= 0 ? camIdx : null,
            label: label,
            type: label,
            source: candidate.source || '',
            crop_path: candidate.crop_path || '',
            startTime: eventTime,
            mins: Math.max(0, (now - eventTime) / 60),
            dur: 5,
            conf: Math.round((candidate.detector_confidence || 0.85) * 100),
            has_snapshot: !isOldMedia || Boolean(candidate.crop_path),
            has_clip: !isOldMedia,
            description: descStr,
            plate: plateStr,
            vehicle_color: candidate.vehicle_color || '',
            vehicle_type: candidate.vehicle_type || '',
            vehicle_brand: candidate.vehicle_brand || '',
            vehicle_model: candidate.vehicle_model || '',
            frameTime: null,
          };
          existingEventMap.set(candidate.event_id, newEv);
          state.emgrEvents.push(newEv);
          addedCount++;
        }
      }
    });

    state.emgrLprByEvent = newMap;
    state.emgrMmcrByEvent = mmcrMap;

    // Apply MMCR hydration to all events in memory
    state.emgrEvents.forEach(hydrateEventMmcr);
    if (Array.isArray(state.events)) {
      state.events.forEach(ev => {
        const info = newMap.get(ev.id);
        if (info && !info.isNonPlate) {
          const p = [info.plateText, info.province].filter(Boolean).join(' ');
          if (p) ev.plate = p;
        }
      });
    }

    if (addedCount > 0) {
      state.emgrEvents.sort((a, b) => b.startTime - a.startTime);
    }
    renderEvents();
  } catch (error) {
    console.warn('Unable to load LPR archive filters:', error);
  }
}

function emgrMatch(ev, q) {
  if (!q) return true;
  const camName = (ev.camIdx !== null && cfg.channels[ev.camIdx])
    ? displayCameraName(cfg.channels[ev.camIdx].src, cfg.channels[ev.camIdx].name)
    : '';
  // เพิ่มคำพ้องความหมาย (Synonyms) สำหรับประเภทรถ เช่น "ตู้", "van", "กระบะ", "ตอนเดียว", "4 ประตู", "hatchback", "เก๋ง"
  let typeAliases = '';
  if (ev.vehicle_type === 'รถตู้') {
    typeAliases = ' รถตู้ ตู้ van commuter hiace h1 ';
  } else if (ev.vehicle_type && ev.vehicle_type.includes('รถกระบะ')) {
    typeAliases = ' รถกระบะ กระบะ pickup truck revo vigo dmax ranger triton ';
    if (ev.vehicle_type.includes('ตอนเดียว')) typeAliases += ' ตอนเดียว single cab singlecab single ';
    if (ev.vehicle_type.includes('4 ประตู')) typeAliases += ' 4 ประตู 4-door สี่ประตู double cab doublecab ';
  } else if (ev.vehicle_type === 'รถ SUV') {
    typeAliases = ' รถ suv ppv fortuner mux crv everest ';
  } else if (ev.vehicle_type && ev.vehicle_type.includes('Hatchback')) {
    typeAliases = ' รถ hatchback 5 ประตู ท้ายตัด แฮทช์แบ็ก เก๋ง รถเก๋ง ';
  } else if (ev.vehicle_type === 'รถเก๋ง') {
    typeAliases = ' รถเก๋ง เก๋ง sedan car civic city yaris vios ';
  } else if (ev.vehicle_type === 'รถมอเตอร์ไซค์' || ev.label === 'motorcycle') {
    typeAliases = ' รถมอเตอร์ไซค์ มอเตอร์ไซค์ มอไซค์ มอไซ รถจักรยานยนต์ จักรยานยนต์ motorcycle motorbike bike ';
  }
  const modelAndDesc = ((ev.vehicle_model || '') + ' ' + (ev.vehicle_brand || '') + ' ' + (ev.plate || '') + ' ' + (ev.description || '')).toLowerCase();
  if (modelAndDesc.includes('ไททัน') || modelAndDesc.includes('ไทตั้น') || modelAndDesc.includes('triton')) {
    typeAliases += ' ไททัน ไทตั้น มิตซู มิตซูบิชิ triton mitsubishi กระบะ 4 ประตู ';
  }

  // รวมป้ายทะเบียน, ใบหน้า (subLabel), คุณลักษณะ MMCR (สี, ประเภท, ยี่ห้อ, รุ่น) และคำอธิบายเข้า haystack
  const hay = (
    (ev.description || '') + ' ' +
    (ev.subLabel || '') + ' ' +
    typeMeta(ev.label).label + ' ' +
    ev.label + ' ' +
    ev.camera + ' ' +
    camName + ' ' +
    (ev.plate || '') + ' ' +
    (ev.vehicle_color || '') + ' ' +
    (ev.vehicle_type || '') + ' ' +
    typeAliases + ' ' +
    (ev.vehicle_brand || '') + ' ' +
    (ev.vehicle_model || '')
  ).toLowerCase();

  // Multi-token dynamic search: ทุกลักษณะคำค้นหา (เช่น "กระบะ โตโยต้า สีขาว", "ตู้ สีขาว") ต้องตรงกับข้อมูลในเหตุการณ์
  const tokens = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return tokens.every(token => hay.includes(token));
}

function renderEmgrFilters(searched) {
  const wrap = $('emgrFilters');
  const counts = {};
  let plateCount = 0;
  searched.forEach(e => { 
    counts[e.type] = (counts[e.type] || 0) + 1; 
    const lprTag = lprTagForEvent(e);
    if (lprTag && lprTag.isPlateCategory) plateCount++;
  });
  wrap.innerHTML = '';
  const chip = (label, count, active, color, onClick, svgIcon = '') => {
    const b = document.createElement('button');
    b.className = 'filter-chip';
    b.setAttribute('aria-pressed', String(active));
    if (active && color) b.style.borderColor = color;
    b.innerHTML = (svgIcon ? svgIcon : '') + '<span class="chip-txt"></span><span class="cnt"></span>';
    b.querySelector('.chip-txt').textContent = label;
    b.lastChild.textContent = count !== null && count !== undefined ? count : '';
    b.addEventListener('click', onClick);
    wrap.appendChild(b);
  };
  chip('ทั้งหมด', state.emgrTypeFilter === 'all' ? searched.length : (counts['all'] || searched.length), state.emgrTypeFilter === 'all', null, () => {
    if (state.emgrTypeFilter === 'all') return;
    state.emgrTypeFilter = 'all';
    renderEventMgr();
  });
  const plateSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>';
  chip('ป้ายทะเบียน', state.emgrTypeFilter === 'plate' ? searched.filter(e => lprTagForEvent(e)?.isPlateCategory).length : (plateCount || 0), state.emgrTypeFilter === 'plate', '#3b82f6', () => {
    if (state.emgrTypeFilter === 'plate') return;
    state.emgrTypeFilter = 'plate';
    renderEventMgr();
    if (searched.filter(e => lprTagForEvent(e)?.isPlateCategory).length < 12 && state.emgrArchiveHasMore) {
      autoSeekPlateEvents(12, 5000);
    }
  }, plateSvg);
  ['car', 'truck', 'motorcycle', 'person'].forEach(t => {
    const meta = typeMeta(t);
    const cnt = counts[t] || (state.emgrTypeFilter === t ? searched.length : 0);
    chip(meta.label, cnt, state.emgrTypeFilter === t, meta.color, () => {
      if (state.emgrTypeFilter === t) return;
      state.emgrTypeFilter = t;
      renderEventMgr();
    });
  });
  const descCount = searched.filter(e => e.description).length;
  const descSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';
  chip('มีคำอธิบาย', descCount, state.emgrDescOnly, '#34e2a8', () => {
    state.emgrDescOnly = !state.emgrDescOnly;
    renderEventMgr();
  }, descSvg);
  const tagSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>';
  const tritonEvents = state.emgrEvents.filter(e => emgrMatch(e, 'ไททัน'));
  const isTritonTagActive = (state.emgrQuery || '').trim() === 'ไททัน';
  if (tritonEvents.length > 0 || isTritonTagActive) {
    chip('ไททัน', tritonEvents.length, isTritonTagActive, '#10b981', () => {
      const nextQ = isTritonTagActive ? '' : 'ไททัน';
      state.emgrQuery = nextQ;
      const search = $('emgrSearch');
      const clearBtn = $('btnEmgrSearchClear');
      if (search) search.value = nextQ;
      if (clearBtn) clearBtn.hidden = !nextQ;
      renderEventMgr();
    }, tagSvg);
  }
  const kranuanQ = 'นักบินกระนวล 2.4 ล้านเม็ด';
  const kranuanEvents = state.emgrEvents.filter(e => emgrMatch(e, kranuanQ));
  const isKranuanTagActive = (state.emgrQuery || '').trim() === kranuanQ;
  if (kranuanEvents.length > 0 || isKranuanTagActive) {
    chip(kranuanQ, kranuanEvents.length, isKranuanTagActive, '#f59e0b', () => {
      const nextQ = isKranuanTagActive ? '' : kranuanQ;
      state.emgrQuery = nextQ;
      const search = $('emgrSearch');
      const clearBtn = $('btnEmgrSearchClear');
      if (search) search.value = nextQ;
      if (clearBtn) clearBtn.hidden = !nextQ;
      renderEventMgr();
    }, tagSvg);
  }
}

// Start each Snapshot request only shortly before its card enters the scrolling
// viewport. Background images otherwise bypass native img lazy-loading and made
// an archive page issue every large Snapshot request concurrently.
function enableEmgrLazyThumbs(body) {
  const loadThumb = thumb => {
    const url = thumb.dataset.thumb;
    if (!url) return;
    delete thumb.dataset.thumb;
    const img = new Image();
    img.onload = () => {
      thumb.style.backgroundImage = `url("${url}")`;
    };
    img.onerror = () => {
      // Smart Media Integrity: Hide card completely if media file is absent
      const card = thumb.closest('.emgr-card');
      if (card) card.style.display = 'none';
    };
    img.src = url;
  };
  if (!('IntersectionObserver' in window)) {
    Array.from(body.querySelectorAll('.emgr-card-thumb[data-thumb]')).slice(0, 12).forEach(loadThumb);
    return;
  }
  state.emgrThumbObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      loadThumb(entry.target);
      state.emgrThumbObserver?.unobserve(entry.target);
    });
  }, { root: body, rootMargin: '240px 0px', threshold: 0.01 });
  body.querySelectorAll('.emgr-card-thumb[data-thumb]').forEach(thumb => state.emgrThumbObserver.observe(thumb));
}

function renderEventMgr() {
  const body = $('emgrBody');
  state.emgrThumbObserver?.disconnect();
  state.emgrThumbObserver = null;
  state.emgrScrollObserver?.disconnect();
  state.emgrScrollObserver = null;

  const q = state.emgrQuery.trim();
  const searched = state.emgrEvents.filter(e => emgrMatch(e, q));
  renderEmgrFilters(searched);

  let evs = getFilteredEmgrEvents();
  // Auto-seek if fewer than 12 plates found and more events exist
  if (state.emgrTypeFilter === 'plate' && evs.length < 12 && state.emgrArchiveHasMore && !isAutoSeekingPlates && !state.emgrArchiveLoadingMore && state.emgrEvents.length < 5000) {
    setTimeout(() => autoSeekPlateEvents(12, 5000), 10);
  }

  const countSuffix = state.emgrArchiveHasMore ? '+' : '';
  $('emgrCount').textContent = evs.length + countSuffix + ' รายการ';
  body.innerHTML = '';

  if (!evs.length) {
    const emptyWrap = document.createElement('div');
    emptyWrap.className = 'emgr-empty-wrap';
    if (isAutoSeekingPlates && state.emgrTypeFilter === 'plate') {
      const statusBox = document.createElement('div');
      statusBox.className = 'emgr-sentinel emgr-auto-seek-status';
      const searchSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:5px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
      statusBox.innerHTML = `<div class="emgr-loading-spinner"></div><span>${searchSvg}กำลังค้นหาป้ายทะเบียนในประวัติย้อนหลัง... (ตรวจค้นแล้ว ${state.emgrEvents.length} รายการ)</span>`;
      emptyWrap.appendChild(statusBox);
      body.appendChild(emptyWrap);
      return;
    }
    const emptyText = state.emgrArchiveLoadingMore
      ? 'กำลังโหลดเหตุการณ์…'
      : (q || state.emgrTypeFilter !== 'all' || state.emgrDescOnly
        ? 'ยังไม่พบเหตุการณ์ที่ตรงกับตัวกรองในชุดข้อมูลล่าสุด'
        : 'ยังไม่มีเหตุการณ์ในช่วงที่เลือก');
    
    const msg = document.createElement('div');
    msg.className = 'emgr-empty';
    msg.textContent = emptyText;
    emptyWrap.appendChild(msg);

    if (state.emgrArchiveHasMore) {
      if (state.emgrArchiveLoadingMore) {
        const loadingBox = document.createElement('div');
        loadingBox.className = 'emgr-sentinel';
        loadingBox.innerHTML = '<div class="emgr-loading-spinner"></div><span>กำลังค้นหาเหตุการณ์เก่ากว่าในระบบ…</span>';
        emptyWrap.appendChild(loadingBox);
      } else {
        const btnMore = document.createElement('button');
        btnMore.type = 'button';
        btnMore.className = 'btn-ghost emgr-load-more';
        btnMore.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>ค้นหาในประวัติที่เก่ากว่า (50 รายการ)</span>';
        btnMore.addEventListener('click', () => fetchEmgrNextPage(true));
        emptyWrap.appendChild(btnMore);
      }
    }
    body.appendChild(emptyWrap);
    return;
  }

  // Render Tactical Chronological Vehicle Movement Timeline (ผ่านกล้องไหนก่อน ➔ ไปกล้องไหนต่อ) when a search/tag query is active
  if (q && evs.length >= 2 && evs.length <= 40) {
    const chrono = evs.slice().sort((a, b) => a.startTime - b.startTime);
    const trips = [];
    let curTrip = [];
    chrono.forEach(ev => {
      if (curTrip.length > 0 && (ev.startTime - curTrip[curTrip.length - 1].startTime) > 3600) {
        trips.push(curTrip);
        curTrip = [];
      }
      curTrip.push(ev);
    });
    if (curTrip.length > 0) trips.push(curTrip);

    const fmtDeltaSec = sec => {
      const s = Math.max(0, Math.round(sec));
      if (s < 60) return `+${s} วินาที`;
      const m = Math.floor(s / 60);
      const remS = s % 60;
      if (m < 60) return remS > 0 ? `+${m} นาที ${remS} วินาที` : `+${m} นาที`;
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return `+${h} ชม. ${remM} นาที`;
    };

    const routeBox = document.createElement('div');
    routeBox.className = 'emgr-route-timeline';
    routeBox.style.cssText = 'margin: 0 0 14px 0; padding: 12px 14px; border-radius: 10px; background: linear-gradient(135deg, rgba(15,23,42,0.92), rgba(30,41,59,0.88)); border: 1px solid rgba(245,158,11,0.38); box-shadow: 0 4px 16px rgba(0,0,0,0.28);';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:10px;';
    header.innerHTML = `<div style="display:flex; align-items:center; gap:8px; font-weight:700; font-size:13.5px; color:#fbbf24;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"></circle><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"></path><circle cx="18" cy="5" r="3"></circle></svg>
      <span>ไทม์ไลน์เส้นทางการเคลื่อนที่ (เรียงจากผ่านกล้องไหนก่อน ➔ ไปกล้องไหนต่อ): "${escapeHtml(q)}"</span>
    </div>
    <span style="font-size:11.5px; color:#94a3b8;">คลิกที่แต่ละจุดเพื่อเปิดดูคลิป/ภาพเหตุการณ์ทันที · รวม ${chrono.length} จุดตรวจพบ (${trips.length} ช่วงเวลา)</span>`;
    routeBox.appendChild(header);

    trips.forEach((trip, tIdx) => {
      const tripWrap = document.createElement('div');
      tripWrap.style.cssText = 'margin-top:' + (tIdx > 0 ? '10px' : '0') + '; padding-top:' + (tIdx > 0 ? '10px' : '0') + '; border-top:' + (tIdx > 0 ? '1px dashed rgba(148,163,184,0.22)' : 'none') + ';';

      const firstD = new Date(trip[0].startTime * 1000);
      const hour = firstD.getHours();
      const periodTh = hour < 12 ? 'ช่วงเช้า' : (hour < 17 ? 'ช่วงบ่าย' : 'ช่วงค่ำ/กลางคืน');
      const tripTitle = document.createElement('div');
      tripTitle.style.cssText = 'font-size:11.5px; font-weight:600; color:#38bdf8; margin-bottom:6px; display:flex; align-items:center; gap:6px;';
      tripTitle.textContent = `📍 ช่วงการเดินทางที่ ${tIdx + 1} (${emgrDateLabel(firstD)} — ${periodTh} · ผ่าน ${trip.length} จุด)`;
      tripWrap.appendChild(tripTitle);

      const stepsRow = document.createElement('div');
      stepsRow.style.cssText = 'display:flex; align-items:center; flex-wrap:wrap; gap:6px;';

      trip.forEach((stepEv, sIdx) => {
        if (sIdx > 0) {
          const deltaSec = stepEv.startTime - trip[sIdx - 1].startTime;
          const arrow = document.createElement('div');
          arrow.style.cssText = 'display:flex; flex-direction:column; align-items:center; padding:0 4px; color:#f59e0b; font-size:10.5px; font-weight:700;';
          arrow.innerHTML = `<span>⏱️ ${escapeHtml(fmtDeltaSec(deltaSec))}</span><span style="font-size:14px; line-height:1;">➔</span>`;
          stepsRow.appendChild(arrow);
        }

        const stepCam = (stepEv.camIdx !== null && cfg.channels[stepEv.camIdx])
          ? displayCameraName(cfg.channels[stepEv.camIdx].src, cfg.channels[stepEv.camIdx].name)
          : (displayCameraName(stepEv.camera, stepEv.camera) || stepEv.camera);
        const stepTime = fmtTime(new Date(stepEv.startTime * 1000)) + ' น.';

        const stepBtn = document.createElement('button');
        stepBtn.type = 'button';
        stepBtn.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:8px; background:rgba(15,23,42,0.85); border:1px solid rgba(56,189,248,0.35); color:#f8fafc; cursor:pointer; text-align:left; transition:all 0.15s;';
        stepBtn.onmouseenter = () => { stepBtn.style.borderColor = '#fbbf24'; stepBtn.style.background = 'rgba(30,41,59,0.95)'; };
        stepBtn.onmouseleave = () => { stepBtn.style.borderColor = 'rgba(56,189,248,0.35)'; stepBtn.style.background = 'rgba(15,23,42,0.85)'; };
        stepBtn.innerHTML = `<span style="display:inline-flex; align-items:center; justify-content:center; min-width:22px; height:22px; padding:0 6px; border-radius:999px; background:#f59e0b; color:#0f172a; font-weight:800; font-size:11px;">จุดที่ ${sIdx + 1}</span>
          <div style="display:flex; flex-direction:column; line-height:1.25;">
            <span style="font-weight:700; font-size:12px; color:#fde68a;">🕒 ${escapeHtml(stepTime)}</span>
            <span style="font-weight:600; font-size:12px; color:#e2e8f0;">📹 ${escapeHtml(stepCam)}</span>
          </div>`;
        stepBtn.addEventListener('click', () => openEmgrDetail(stepEv));
        stepsRow.appendChild(stepBtn);
      });

      tripWrap.appendChild(stepsRow);
      routeBox.appendChild(tripWrap);
    });

    body.appendChild(routeBox);
  }

  // Group events chronologically by day for Timeline Stream separators
  const dateGroups = [];
  let currentGroup = null;

  evs.forEach(ev => {
    const d = new Date(ev.startTime * 1000);
    const dateKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    if (!currentGroup || currentGroup.dateKey !== dateKey) {
      currentGroup = { dateKey, dateObj: d, events: [] };
      dateGroups.push(currentGroup);
    }
    currentGroup.events.push(ev);
  });

  dateGroups.forEach(group => {
    const sep = document.createElement('div');
    sep.className = 'emgr-date-separator';
    const calSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:6px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
    sep.innerHTML = `<span class="emgr-date-icon">${calSvg}</span><span class="emgr-date-text">${escapeHtml(emgrDateLabel(group.dateObj))}</span><span class="emgr-date-count">${group.events.length} รายการ</span>`;
    body.appendChild(sep);

    const grid = document.createElement('div');
    grid.className = 'emgr-grid';

    group.events.forEach(ev => {
      const card = document.createElement('button');
      card.className = 'emgr-card';
      const d = new Date(ev.startTime * 1000);
      const exactTimeStr = fmtTime(d) + ' น.';
      const exactDateStr = fmtDate(d);
      const agoStr = fmtAgo(ev.mins);
      card.setAttribute('aria-label', typeMeta(ev.label).label + ' ' + agoStr + ' (' + exactTimeStr + ')');
      card.innerHTML =
        `<div class="emgr-card-thumb"><span class="emgr-card-conf">${ev.conf}%</span>` +
        (ev.has_clip ? '<span class="emgr-card-clip"><svg width="11" height="11" viewBox="0 0 24 24" fill="#e9d5ff" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></span>' : '') +
        (ev.description ? '<span class="emgr-card-note" title="มีคำอธิบาย"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></span>' : '') +
        `</div><div class="emgr-card-meta">` +
        `<span class="ch-chip">${ev.camIdx !== null ? chLabel(ev.camIdx) : escapeHtml(displayCameraName(ev.camera, state.cameraNames?.[ev.camera]) || ev.camera || 'NVR')}</span>` +
        `<span class="type-dot" style="background:${typeMeta(ev.label).color}; box-shadow:0 0 6px ${typeMeta(ev.label).color}; width:7px; height:7px; border-radius:50%; display:inline-block;" title="${typeMeta(ev.label).label}"></span>` +
        `<span class="emgr-card-time" title="${exactDateStr} ${exactTimeStr}">${agoStr}</span></div>`;

      const thumb = card.querySelector('.emgr-card-thumb');
      const lprTag = lprTagForEvent(ev);
      if (lprTag) {
        const plate = document.createElement('span');
        plate.className = 'emgr-card-plate';
        plate.title = lprTag.tag;
        if (lprTag.type === 'non_plate') {
          plate.style.background = 'rgba(239, 68, 68, 0.85)';
          plate.style.borderColor = '#ef4444';
        } else if (lprTag.type === 'confirmed' || lprTag.type === 'unreadable_reviewed') {
          plate.style.background = 'rgba(16, 185, 129, 0.85)';
          plate.style.borderColor = '#10b981';
        } else if (lprTag.type === 'partial') {
          plate.style.background = 'rgba(59, 130, 246, 0.85)';
          plate.style.borderColor = '#3b82f6';
        } else {
          plate.style.background = 'rgba(168, 85, 247, 0.85)';
          plate.style.borderColor = '#a855f7';
        }
        const badgeIcon = lprTag.type === 'non_plate'
          ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:3px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
          : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:3px;"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>';
        plate.innerHTML = badgeIcon + escapeHtml(lprTag.tag.replace(/^🪪 |^❌ /, ''));
        thumb.appendChild(plate);
      } else if (ev.subLabel) {
        const faceBadge = document.createElement('span');
        faceBadge.className = 'emgr-card-plate emgr-card-face';
        const scorePct = ev.subLabelScore ? ` (${Math.round(ev.subLabelScore * 100)}%)` : '';
        faceBadge.title = `ใบหน้า: ${ev.subLabel}${scorePct}`;
        faceBadge.style.background = 'rgba(147, 51, 234, 0.88)';
        faceBadge.style.borderColor = '#a855f7';
        faceBadge.textContent = `👤 ${ev.subLabel}`;
        thumb.appendChild(faceBadge);
      }
      if (ev.source) {
        let srcLabel = ev.source;
        let srcColor = '#94a3b8';
        if (ev.source === 'vigi_edge_ai') { srcLabel = '⚡ Edge AI'; srcColor = '#eab308'; }
        else if (ev.source === 'edge_camera') { srcLabel = '📷 กล้อง Edge'; srcColor = '#38bdf8'; }
        else if (ev.source === 'ai') { srcLabel = '🤖 AI Server'; srcColor = '#a855f7'; }

        const srcBadge = document.createElement('span');
        srcBadge.className = 'emgr-card-source';
        srcBadge.style.cssText = `position:absolute; bottom:4px; right:4px; font-size:10px; padding:2px 5px; border-radius:3px; background:rgba(15,23,42,0.85); color:${srcColor}; border:1px solid ${srcColor}40; pointer-events:none; z-index:2; font-weight: 500;`;
        srcBadge.textContent = srcLabel;
        thumb.appendChild(srcBadge);
      }

      const mmcrParts = [ev.vehicle_type, ev.vehicle_brand, ev.vehicle_model, ev.vehicle_color].filter(Boolean);
      if (mmcrParts.length > 0) {
        const mmcrBadge = document.createElement('span');
        mmcrBadge.className = 'emgr-card-mmcr';
        mmcrBadge.style.cssText = 'position:absolute; bottom:24px; left:4px; font-size:10px; padding:1px 5px; border-radius:3px; background:rgba(15,23,42,0.85); color:#cbd5e1; border:1px solid rgba(255,255,255,0.15); max-width:92%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; pointer-events:none; z-index:2;';
        mmcrBadge.title = mmcrParts.join(' ');
        mmcrBadge.textContent = mmcrParts.join(' • ');
        thumb.appendChild(mmcrBadge);
      }
      const url = emgrThumb(ev);
      if (url) thumb.dataset.thumb = url;
      else if (ev.demoBg) thumb.style.background = ev.demoBg;
      card.addEventListener('click', () => openEmgrDetail(ev));
      grid.appendChild(card);
    });

    body.appendChild(grid);
  });

  // Infinite Scroll Sentinel or End indicator
  if (state.emgrArchiveHasMore) {
    const sentinel = document.createElement('div');
    sentinel.id = 'emgrSentinel';
    sentinel.className = 'emgr-sentinel';
    sentinel.style.cursor = 'pointer';
    sentinel.title = 'คลิกเพื่อโหลดเหตุการณ์เพิ่มเติมทันที';
    if (state.emgrArchiveLoadingMore) {
      sentinel.innerHTML = '<div class="emgr-loading-spinner"></div><span>กำลังโหลดเหตุการณ์เพิ่มเติม…</span>';
    } else {
      sentinel.innerHTML = '<div class="emgr-loading-spinner"></div><span>เลื่อนลง หรือคลิกที่นี่เพื่อโหลดเพิ่มเติม…</span>';
    }
    sentinel.addEventListener('click', () => fetchEmgrNextPage(true));
    body.appendChild(sentinel);
    setupEmgrSentinelObserver(sentinel, body);
  } else if (evs.length > 0) {
    const endInd = document.createElement('div');
    endInd.className = 'emgr-end-indicator';
    const checkSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:5px;"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    endInd.innerHTML = `${checkSvg}<span>แสดงครบทุกเหตุการณ์แล้ว (${evs.length} รายการ)</span>`;
    body.appendChild(endInd);
  }

  enableEmgrLazyThumbs(body);
}

function switchEmgrView(view = 'detection') {
  state.emgrActiveTab = view;
  const tabDetection = $('tabBtnEmgrDetection');
  const tabNas = $('tabBtnEmgrNas');
  const emgrFilters = $('emgrFilters');
  const emgrBody = $('emgrBody');
  const emgrNasContainer = $('emgrNasContainer');
  const emgrCount = $('emgrCount');
  const emgrSize = $('emgrSizeControls');
  const emgrDetectionActions = $('emgrDetectionActions');

  if (view === 'nas') {
    if (tabDetection) {
      tabDetection.classList.remove('active');
      tabDetection.style.background = 'rgba(255,255,255,0.03)';
      tabDetection.style.color = '#9aa0bd';
      tabDetection.style.borderColor = 'rgba(255,255,255,0.08)';
    }
    if (tabNas) {
      tabNas.classList.add('active');
      tabNas.style.background = 'rgba(192,132,252,0.18)';
      tabNas.style.color = '#c084fc';
      tabNas.style.borderColor = 'rgba(192,132,252,0.45)';
    }
    if (emgrFilters) emgrFilters.hidden = true;
    if (emgrBody) emgrBody.hidden = true;
    if (emgrCount) emgrCount.hidden = true;
    if (emgrSize) emgrSize.hidden = true;
    if (emgrDetectionActions) emgrDetectionActions.hidden = true;
    if (emgrNasContainer) {
      emgrNasContainer.hidden = false;
      if (window.nasArchiveModule && typeof window.nasArchiveModule.onActivate === 'function') {
        window.nasArchiveModule.onActivate();
      }
    }
  } else {
    if (tabDetection) {
      tabDetection.classList.add('active');
      tabDetection.style.background = 'rgba(192,132,252,0.18)';
      tabDetection.style.color = '#c084fc';
      tabDetection.style.borderColor = 'rgba(192,132,252,0.45)';
    }
    if (tabNas) {
      tabNas.classList.remove('active');
      tabNas.style.background = 'rgba(255,255,255,0.03)';
      tabNas.style.color = '#9aa0bd';
      tabNas.style.borderColor = 'rgba(255,255,255,0.08)';
    }
    if (emgrFilters) emgrFilters.hidden = false;
    if (emgrBody) emgrBody.hidden = false;
    if (emgrCount) emgrCount.hidden = false;
    if (emgrSize) emgrSize.hidden = false;
    if (emgrDetectionActions) emgrDetectionActions.hidden = false;
    if (emgrNasContainer) emgrNasContainer.hidden = true;
  }
}

function openEventMgr(view = 'detection') {
  const overlay = $('eventMgrOverlay');
  if (overlay) overlay.hidden = false;
  switchEmgrView(view);
  if (view === 'detection') {
    state.emgrQuery = ''; 
    const search = $('emgrSearch');
    if (search) search.value = '';
    // Opening the existing archive starts from an unfiltered view; reviewers can
    // then choose one mutually independent object-type or LPR-status chip.
    state.emgrTypeFilter = 'all'; state.emgrLprFilter = 'all'; state.emgrDescOnly = false;
    populateEmgrArchiveScope();
    fetchEmgrEvents();
  }
}
function closeEventMgr() {
  const overlay = $('eventMgrOverlay');
  if (overlay) overlay.hidden = true;
}

window.openEventMgr = openEventMgr;
window.switchEmgrView = switchEmgrView;
window.closeEventMgr = closeEventMgr;

function openEmgrDetail(ev) {
  state.emgrEv = ev;
  // A linked LPR candidate may later replace this event's clip with its
  // primary vehicle clip; clear any source retained on a reused card object.
  ev.lprClipEventId = null;
  $('edVideo').dataset.origSrc = '';
  const meta = typeMeta(ev.label);
  $('edTypeLabel').textContent = meta.label;
  const tc = $('edType'); tc.style.color = meta.color; tc.style.border = `1px solid ${meta.color}55`;
  tc.querySelector('.type-dot').style.cssText = `background:${meta.color}; box-shadow:0 0 6px ${meta.color};`;
  $('edCh').textContent = ev.camIdx !== null ? chLabel(ev.camIdx) : 'NVR';
  const camName = (ev.camIdx !== null && cfg.channels[ev.camIdx])
    ? displayCameraName(cfg.channels[ev.camIdx].src, cfg.channels[ev.camIdx].name)
    : (state.cameraNames?.[ev.camera] ? displayCameraName(ev.camera, state.cameraNames[ev.camera]) : (ev.camera || ''));
  $('edCam').textContent = camName;
  const d = new Date(ev.startTime * 1000);
  $('edTime').textContent = fmtTime(d) + ' น.';
  const img = $('edSnapImg'), wrap = img.parentElement;
  let url = '';
  if (ev.source === 'vigi_edge_ai' || ev.source === 'edge_camera' || String(ev.id).startsWith('vigi_') || String(ev.id).startsWith('ext_')) {
    url = ev.crop_path ? '/lpr-crops/' + encodeURIComponent(ev.crop_path) : emgrThumb(ev);
  } else {
    url = apiUrl('/api/events/' + encodeURIComponent(ev.id) + (ev.has_snapshot ? '/snapshot.jpg?bbox=1' : '/thumbnail.jpg'));
  }
  wrap.style.background = '';
  if (url) { img.src = url; img.style.display = ''; }
  else { img.removeAttribute('src'); img.style.display = 'none'; if (ev.demoBg) wrap.style.background = ev.demoBg; }
  $('edInfoType').textContent = meta.label + ' (' + ev.label + ')';
  $('edInfoCam').textContent = camName;
  $('edInfoTime').textContent = fmtDate(d) + ' เวลา ' + fmtTime(d) + ' น.';
  $('edInfoConf').textContent = ev.conf + '%';
  $('edDesc').value = ev.description || '';
  $('edDesc').disabled = cfg.demo; $('btnSaveDesc').disabled = cfg.demo;
  $('edDescMsg').textContent = cfg.demo ? 'โหมดสาธิต — บันทึกจริงไม่ได้' : ''; $('edDescMsg').className = 'sync-msg';
  // ปุ่มดาวน์โหลด snapshot (bestshot ของ Frigate) — มีเฉพาะ event ที่มี snapshot จริง
  // แถบป้ายทะเบียนและปุ่มจัดการ LPR:
  // สำหรับประเภทยานพาหนะ (car, motorcycle, truck, bus) หรือเหตุการณ์ที่มีผลอ่านป้ายทะเบียน
  const isVehicle = ['car', 'motorcycle', 'truck', 'bus'].includes(ev.label);
  const plateRow = $('edPlateRow'), plateImg = $('edPlateCrop'), plateText = $('edPlateText'), plateWrap = $('edPlateCropWrap');
  const btnTrain = $('btnEdPlateTrain'), btnDel = $('btnEdPlateDelete');
  const plateVal = ev.plate || ev.sub_label || '';

  if (plateRow) {
    plateRow.hidden = false;
    if (plateText) {
      const iconSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>`;
      plateText.innerHTML = plateVal ? (iconSvg + escapeHtml(plateVal)) : '<span style="color:#94a3b8; font-weight:400;">ยังไม่ได้ระบุป้ายทะเบียน</span>';
    }
    if (btnTrain) {
      btnTrain.hidden = !['admin', 'superadmin'].includes(userRole);
      btnTrain.innerHTML = plateVal
        ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:3px;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>แก้ไข/สอน AI`
        : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:3px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>ระบุ/สอนป้ายทะเบียน`;
    }
    if (btnDel) {
      btnDel.hidden = !plateVal; // มีปุ่มลบเมื่อมีป้ายทะเบียนติดอยู่
    }
    if (plateWrap) plateWrap.style.display = 'none';

    // Do not request the legacy event-id crop here: it belongs to an older
    // detector and creates a slow, misleading 404 before the selected LPR
    // candidate supplies its actual reviewed crop below.
    if (plateWrap) plateWrap.style.display = 'none';
  } else {
    plateRow.hidden = true;
  }

  $('btnEdSnapDl').disabled = cfg.demo || !ev.has_snapshot;
  $('btnEdSnapDl').title = ev.has_snapshot ? 'บันทึกภาพ Snapshot ลง Downloads' : 'เหตุการณ์นี้ไม่มีภาพ Snapshot';
  const btnDelEv = $('btnDeleteEmgrEvent');
  if (btnDelEv) {
    btnDelEv.hidden = !['admin', 'superadmin'].includes(userRole);
  }
  switchEmgrTab('snap');
  $('emgrDetailOverlay').hidden = false;
  // Candidate state is separate from Frigate's confirmed plate field.  Load it
  // after the detail shell appears so a slow review API never blocks the modal.
  loadEventLprCandidates(ev);
}

function openPlateModal(imgSrc, plateText) {
  const overlay = $('plateModalOverlay');
  if (!overlay) return;
  const img = $('plateModalImg');
  const badge = $('plateModalBadge');
  if (img) {
    img.onload = () => {
      const nw = img.naturalWidth || 100;
      const nh = img.naturalHeight || 100;
      const ratio = nw / nh;
      if (ratio < 1.3) {
        // ป้ายมอเตอร์ไซค์/แนวตั้ง: ขยายตามความสูงให้สูง 320px
        img.style.height = '320px';
        img.style.width = 'auto';
        img.style.maxWidth = '100%';
      } else {
        // ป้ายรถยนต์/แนวนอน: ขยายตามความกว้างให้กว้าง 440px
        img.style.width = 'min(440px, 92%)';
        img.style.height = 'auto';
        img.style.maxHeight = '360px';
      }
    };
    img.src = imgSrc;
  }
  if (badge) {
    const iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>`;
    badge.innerHTML = plateText ? (iconSvg + escapeHtml(plateText)) : 'ภาพป้ายทะเบียน';
  }
  overlay.hidden = false;
}

function closePlateModal() {
  const overlay = $('plateModalOverlay');
  if (overlay) overlay.hidden = true;
}

/* ============ LPR ACTIVE LEARNING & INTERACTIVE ANNOTATION ============ */

const LPR_STATUS_TEXT = {
  not_found: 'ไม่พบป้ายทะเบียน',
  detected_unreadable: 'พบป้ายทะเบียน แต่ไม่สามารถอ่านได้',
  partial: 'อ่านได้บางส่วน',
  readable: 'อ่านได้ครบถ้วน',
  pending_review: 'รอตรวจสอบ',
};

const THAI_PROVINCES = [
  'กรุงเทพมหานคร','กระบี่','กาญจนบุรี','กาฬสินธุ์','กำแพงเพชร','ขอนแก่น','จันทบุรี','ฉะเชิงเทรา','ชลบุรี','ชัยนาท','ชัยภูมิ','ชุมพร','เชียงราย','เชียงใหม่','ตรัง','ตราด','ตาก','นครนายก','นครปฐม','นครพนม','นครราชสีมา','นครศรีธรรมราช','นครสวรรค์','นนทบุรี','นราธิวาส','น่าน','บึงกาฬ','บุรีรัมย์','ปทุมธานี','ประจวบคีรีขันธ์','ปราจีนบุรี','ปัตตานี','พระนครศรีอยุธยา','พะเยา','พังงา','พัทลุง','พิจิตร','พิษณุโลก','เพชรบุรี','เพชรบูรณ์','แพร่','ภูเก็ต','มหาสารคาม','มุกดาหาร','แม่ฮ่องสอน','ยโสธร','ยะลา','ร้อยเอ็ด','ระนอง','ระยอง','ราชบุรี','ลพบุรี','ลำปาง','ลำพูน','เลย','ศรีสะเกษ','สกลนคร','สงขลา','สตูล','สมุทรปราการ','สมุทรสงคราม','สมุทรสาคร','สระแก้ว','สระบุรี','สิงห์บุรี','สุโขทัย','สุพรรณบุรี','สุราษฎร์ธานี','สุรินทร์','หนองคาย','หนองบัวลำภู','อ่างทอง','อำนาจเจริญ','อุดรธานี','อุตรดิตถ์','อุทัยธานี','อุบลราชธานี'
];

async function loadEventLprCandidates(ev) {
  const row = $('edPlateRow'), text = $('edPlateText'), list = $('edPlateCandidates');
  const image = $('edPlateCrop'), imageWrap = $('edPlateCropWrap');
  const reviewButton = $('btnEdPlateTrain'), legacyDelete = $('btnEdPlateDelete');
  if (!row || !text || !list || !ev || cfg.demo || !SAME_ORIGIN) return;
  text.textContent = 'กำลังตรวจสอบผลป้ายทะเบียน…';
  list.replaceChildren();
  try {
    const response = await fetch('/api/watchlist/lpr/events/' + encodeURIComponent(ev.id) + '/candidates');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const candidates = await response.json();
    if (state.emgrEv !== ev) return;
    lprTrainState.eventCandidates = candidates;
    lprTrainState.activeCandidate = candidates[0] || null;
    if (!candidates.length) {
      const rawSub = (ev.sub_label || '').trim();
      const legacyPlate = (ev.plate || (isPlateString(rawSub) && rawSub !== 'รอสอนAI' ? rawSub : '')) || '';
      text.textContent = legacyPlate
        ? 'ผลตรวจจับเดิมยังไม่ได้รับการยืนยัน — กดตรวจสอบ/สอน AI'
        : 'ยังไม่มีผลป้ายทะเบียน — ผู้ดูแลสามารถเพิ่มและสอนจากภาพ/วิดีโอได้';
      if (imageWrap) imageWrap.style.display = 'none';
      if (reviewButton) {
        reviewButton.hidden = !['admin', 'superadmin'].includes(userRole);
        reviewButton.textContent = legacyPlate ? 'ตรวจสอบ/สอน AI' : 'เพิ่ม/สอนป้ายทะเบียน';
      }
      // Legacy deletion remains available only for an old confirmed Frigate
      // value that has not yet been migrated into a candidate.
      if (legacyDelete) legacyDelete.hidden = !(ev.plate || (isPlateString(rawSub) && rawSub));
      return;
    }
    // Candidate actions are rendered per selected crop below.  Do not hide the
    // red action merely because this is a reviewed-candidate record: rejecting
    // it must remain available so the crop becomes a reason-coded hard negative.
    candidates.forEach((candidate, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lpr-candidate-chip' + (index === 0 ? ' active' : '');
      const status = candidate.review_state === 'conflict'
        ? 'คำตอบขัดแย้ง — รอผู้ดูแลระดับสูง'
        : (candidate.human_confirmed ? 'ยืนยันแล้ว' : (candidate.review_state === 'pending' ? 'รอตรวจสอบ' : (LPR_STATUS_TEXT[candidate.status] || candidate.status)));
      const read = [candidate.plate_text, candidate.province].filter(Boolean).join(' ');
      const match = (candidate.watchlist_matches || []).find(item => item.state !== 'cancelled');
      const matchText = match
        ? (match.alert_type === 'confirmed_match'
          ? ` · ตรงรายการเฝ้าระวัง ${match.watchlist_plate}`
          : ` · อาจตรง ${match.watchlist_plate} (ต้องตรวจสอบ)`)
        : '';
      button.textContent = `ป้าย ${index + 1}: ${status}${read ? ' — ' + read : ''}${matchText}`;
      button.addEventListener('click', () => {
        list.querySelectorAll('.lpr-candidate-chip').forEach(chip => chip.classList.remove('active'));
        button.classList.add('active');
        lprTrainState.activeCandidate = candidate;
        renderSelectedLprCandidate(candidate, ev);
      });
      list.appendChild(button);
    });
    renderSelectedLprCandidate(candidates[0], ev);
  } catch (_error) {
    text.textContent = 'ไม่สามารถโหลดผลตรวจป้ายทะเบียนได้';
    if (reviewButton) reviewButton.hidden = true;
  }
}

async function ensureManualLprCandidate(ev) {
  if (lprTrainState.activeCandidate) return lprTrainState.activeCandidate;
  const response = await fetch(
    '/api/watchlist/lpr/events/' + encodeURIComponent(ev.id) + '/manual-candidate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        camera: ev.camera || null,
        plate_text: (ev.plate || (ev.sub_label && ev.sub_label.trim() !== '' && ev.sub_label !== 'รอสอนAI' ? ev.sub_label : '')) || null,
        province: null,
      }),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || ('สร้างรายการสอนไม่สำเร็จ (' + response.status + ')'));
  }
  const candidate = await response.json();
  lprTrainState.activeCandidate = candidate;
  lprTrainState.eventCandidates = [candidate];
  return candidate;
}

async function openOrCreateLprTraining(ev, initialDecision = null) {
  // A caller may preselect non_plate for the red reject action.  The same
  // modal still requires a reason and a final human save before removing crop.
  if (!ev) return;
  try {
    const candidate = await ensureManualLprCandidate(ev);
    openLprTrainModal(ev, candidate, initialDecision);
  } catch (error) {
    toast('เปิดหน้าสอน AI ไม่สำเร็จ: ' + error.message);
  }
}

function selectLprPrimaryClip(candidate, ev) {
  // Candidate links distinguish the primary vehicle event from associated
  // person events. The selected primary id is an in-memory playback hint only;
  // it does not mutate Frigate or the reviewed candidate record.
  if (!candidate || !ev) return;
  const primaryLink = (candidate.event_links || []).find(
    link => link.relation === 'primary' && link.event_id,
  );
  const nextEventId = primaryLink ? primaryLink.event_id : candidate.event_id;
  if (!nextEventId || ev.lprClipEventId === nextEventId) return;
  ev.lprClipEventId = nextEventId;
  // If the operator opened Video before candidate loading finished, retry the
  // newly resolved primary clip immediately instead of leaving a stale error.
  if (!$('edPaneVideo').hidden) switchEmgrTab('video', true);
}

function renderSelectedLprCandidate(candidate, ev) {
  // Playback follows the same candidate selection as crop/review controls so
  // a plate linked from a person event still opens the vehicle's real clip.
  selectLprPrimaryClip(candidate, ev);
  const text = $('edPlateText'), image = $('edPlateCrop'), imageWrap = $('edPlateCropWrap');
  const reviewButton = $('btnEdPlateTrain'), rejectButton = $('btnEdPlateDelete');
  const status = candidate.review_state === 'conflict'
    ? 'คำตอบขัดแย้ง — รอผู้ดูแลระบบระดับสูง'
    : (candidate.human_confirmed ? 'ยืนยันแล้ว' : (candidate.review_state === 'pending' ? 'รอตรวจสอบ' : (LPR_STATUS_TEXT[candidate.status] || candidate.status)));
  const match = (candidate.watchlist_matches || []).find(item => item.state !== 'cancelled');
  const matchText = match
    ? (match.alert_type === 'confirmed_match'
      ? ` — ยืนยันตรงรายการเฝ้าระวัง ${match.watchlist_plate}`
      : ` — อาจตรงรายการเฝ้าระวัง ${match.watchlist_plate} ต้องตรวจสอบ`)
    : '';
  text.textContent = (status || 'รอตรวจสอบ') + matchText;
  if (candidate.crop_path && image && imageWrap) {
    image.onload = () => { imageWrap.style.display = ''; };
    image.onerror = () => { imageWrap.style.display = 'none'; };
    image.src = '/lpr-crops/' + encodeURIComponent(candidate.crop_path) + '?cb=' + Date.now();
    imageWrap.onclick = () => openPlateModal(image.src, text.textContent);
  } else if (imageWrap) {
    // Manual/snapshot-only candidates have no saved crop until the reviewer
    // draws one. Make that state explicit instead of showing a broken image.
    text.textContent += ' · ยังไม่มีภาพครอบ — กดตรวจสอบ/สอน AI เพื่อครอบจาก Snapshot';
    imageWrap.style.display = 'none';
  }
  // Both review actions share the same authorization/finality rule.  Showing
  // the red action for every editable candidate fixes the previous candidate
  // branch that exposed review but silently hid reject/delete-and-teach.
  const mayReview = ['admin', 'superadmin'].includes(userRole)
    && (!candidate.human_confirmed || userRole === 'superadmin' || candidate.review_state !== 'adjudicated')
    && (candidate.review_state !== 'conflict' || userRole === 'superadmin');
  if (reviewButton) {
    reviewButton.hidden = !mayReview;
    reviewButton.textContent = candidate.review_state === 'conflict' && userRole === 'superadmin'
      ? 'ตัดสินคำตอบขัดแย้ง'
      : 'ตรวจสอบ/สอน AI';
  }
  if (rejectButton) {
    rejectButton.hidden = !mayReview;
    rejectButton.textContent = 'ไม่ใช่ป้าย/ลบและสอน AI';
    rejectButton.title = 'ระบุสาเหตุ เก็บเป็นตัวอย่างลบ และลบเฉพาะภาพ crop';
  }
}

// Reviewed crops use an ordinary rectangle. These natural-pixel limits protect
// readable/partial OCR labels, while a human-confirmed unreadable detector crop
// may preserve the only exact evidence frame even when it is smaller.
const LPR_TRAIN_MIN_CROP_WIDTH = 64;
const LPR_TRAIN_MIN_CROP_HEIGHT = 20;

function lprTrainingMedia() {
  return lprTrainState.usingFullSnapshot ? $('lprTrainSnapshot') : $('lprTrainVideo');
}

function lprMediaSize(media) {
  if (!media) return { width: 0, height: 0 };
  if (media.tagName === 'IMG') {
    return { width: Number(media.naturalWidth || 0), height: Number(media.naturalHeight || 0) };
  }
  return { width: Number(media.videoWidth || 0), height: Number(media.videoHeight || 0) };
}

// Keep every training rectangle inside the current snapshot/video and large
// enough for both detector and OCR training; callers receive a clean axis-
// aligned box rather than independent perspective corners.
function lprClampRect(box, size) {
  if (!box || !size.width || !size.height) return null;
  const maxWidth = Math.max(1, size.width);
  const maxHeight = Math.max(1, size.height);
  const minWidth = Math.min(LPR_TRAIN_MIN_CROP_WIDTH, maxWidth);
  const minHeight = Math.min(LPR_TRAIN_MIN_CROP_HEIGHT, maxHeight);
  const w = Math.max(minWidth, Math.min(maxWidth, Number(box.w) || minWidth));
  const h = Math.max(minHeight, Math.min(maxHeight, Number(box.h) || minHeight));
  return {
    x: Math.max(0, Math.min(maxWidth - w, Number(box.x) || 0)),
    y: Math.max(0, Math.min(maxHeight - h, Number(box.y) || 0)),
    w,
    h,
  };
}

// Convert a pointer position into a rectangle that keeps the opposite corner
// fixed. This preserves a normal resize interaction on both video and image.
function lprResizeRect(startBox, corner, nextX, nextY, size) {
  if (!startBox) return null;
  const left = startBox.x, top = startBox.y;
  const right = startBox.x + startBox.w, bottom = startBox.y + startBox.h;
  const minWidth = Math.min(LPR_TRAIN_MIN_CROP_WIDTH, size.width);
  const minHeight = Math.min(LPR_TRAIN_MIN_CROP_HEIGHT, size.height);
  let box;
  if (corner === 'tl') box = { x: Math.min(nextX, right - minWidth), y: Math.min(nextY, bottom - minHeight), w: right - Math.min(nextX, right - minWidth), h: bottom - Math.min(nextY, bottom - minHeight) };
  else if (corner === 'tr') box = { x: left, y: Math.min(nextY, bottom - minHeight), w: Math.max(minWidth, nextX - left), h: bottom - Math.min(nextY, bottom - minHeight) };
  else if (corner === 'bl') box = { x: Math.min(nextX, right - minWidth), y: top, w: right - Math.min(nextX, right - minWidth), h: Math.max(minHeight, nextY - top) };
  else box = { x: left, y: top, w: Math.max(minWidth, nextX - left), h: Math.max(minHeight, nextY - top) };
  return lprClampRect(box, size);
}

let lprTrainState = {
  activeEv: null,
  activeCandidate: null,
  eventCandidates: [],
  cropPoints: null,
  cropBox: null, // {x, y, w, h} in natural image coordinates
  isDrawing: false,
  isDragging: false,
  isResizing: false,
  resizeCorner: null,
  mediaRequestId: 0, // Monotonic token prevents an older modal load from repainting a new review.
  usingFullSnapshot: false, // Lets a too-small detected crop be replaced by its full event Snapshot.
  startX: 0,
  startY: 0,
  startBox: null,
  startPoints: null,
};

function lprPointsToBox(points) {
  if (!points || points.length !== 4) return null;
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function lprRectPoints(box) {
  return [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ];
}

function openLprTrainModal(
  ev,
  candidate = lprTrainState.activeCandidate,
  initialDecision = null,
) {
  if (!ev) return;
  if (!candidate) {
    toast('ยังไม่มีรายการป้ายที่ AI ส่งมารอตรวจสอบ');
    return;
  }
  lprTrainState.activeEv = ev;
  lprTrainState.activeCandidate = candidate;
  const overlay = $('lprTrainOverlay');
  if (!overlay) return;
  const video = $('lprTrainVideo');
  const snapshot = $('lprTrainSnapshot');
  const box = $('lprCropBox');
  const inpPlate = $('inpLprPlate');
  const selProv = $('selLprProvince');
  const reason = $('selLprNonPlateReason');
  const reasonDetail = $('inpLprNonPlateReasonDetail');
  const msg = $('lprTrainMsg');
  const seek = $('lprVideoSeek');
  const timeLbl = $('lprVideoTime');
  const videoControls = $('lprTrainVideoControls');
  const useSnapshotButton = $('btnLprUseSnapshot');
  const btnSave = $('btnLprTrainSave');

  const mediaRequestId = ++lprTrainState.mediaRequestId;
  lprTrainState.usingFullSnapshot = false;

  msg.textContent = '';
  msg.className = 'sync-msg';
  box.hidden = true;
  lprTrainState.cropBox = null;
  lprTrainState.cropPoints = null;

  if (btnSave) btnSave.disabled = false;
  if (useSnapshotButton) useSnapshotButton.hidden = true;

  const previewCanvas = $('lprTrainCanvas');
  if (previewCanvas) previewCanvas.width = previewCanvas.width;

  inpPlate.value = candidate.plate_text || '';
  selProv.value = candidate.province || '';
  if (reason) reason.value = candidate.non_plate_reason || '';
  if (reasonDetail) reasonDetail.value = candidate.non_plate_reason_detail || '';
  const decision = $('selLprDecision');
  if (decision) {
    const inferredDecision = candidate.status === 'readable'
      ? 'readable'
      : (candidate.status === 'partial' || (candidate.source === 'manual-review' && candidate.plate_text)
        ? 'partial'
        : 'unreadable');
    decision.value = initialDecision || inferredDecision;
    updateLprDecisionFields();
  }

  // โหลดวิดีโอคลิป Mainstream เสมอสำหรับการสอน AI
  const primaryLink = (candidate.event_links || []).find(link => link.relation === 'primary');
  const clipEventId = primaryLink ? primaryLink.event_id : ev.id;
  const clipSrc = apiUrl('/api/events/' + encodeURIComponent(clipEventId) + '/clip.mp4');

  if (snapshot) {
    snapshot.hidden = true;
    snapshot.removeAttribute('src');
  }

  video.style.display = '';
  if (videoControls) videoControls.hidden = false;
  timeLbl.textContent = 'กำลังโหลดวิดีโอ...';

  const handleSeek = (newTime) => {
    const clamped = Math.max(0, Math.min(video.duration || 100, newTime));
    seek.value = clamped;
    timeLbl.textContent = clamped.toFixed(2) + 's';
    video.currentTime = clamped;
  };

  function onVideoReady() {
    if (lprTrainState.mediaRequestId !== mediaRequestId) return;
    const media = lprTrainingMedia();
    const size = lprMediaSize(media);
    if (!size.width || !size.height) return;
    if (!lprTrainState.cropPoints) {
      let initialBox = null;
      if (candidate && candidate.polygon && candidate.polygon.length === 4) {
        const polyBox = lprPointsToBox(candidate.polygon);
        if (polyBox && polyBox.w >= 16 && polyBox.h >= 10) {
          initialBox = polyBox;
        }
      }
      if (!initialBox && ev && ev.data && Array.isArray(ev.data.box) && ev.data.box.length === 4) {
        const [ymin, xmin, ymax, xmax] = ev.data.box;
        const carW = (xmax - xmin) * size.width;
        const carH = (ymax - ymin) * size.height;
        initialBox = {
          x: Math.round(xmin * size.width + carW * 0.15),
          y: Math.round(ymin * size.height + carH * 0.55),
          w: Math.max(LPR_TRAIN_MIN_CROP_WIDTH, Math.round(carW * 0.7)),
          h: Math.max(LPR_TRAIN_MIN_CROP_HEIGHT, Math.round(carH * 0.35))
        };
      }
      if (!initialBox) {
        initialBox = {
          x: Math.round(size.width * 0.35),
          y: Math.round(size.height * 0.4),
          w: Math.max(LPR_TRAIN_MIN_CROP_WIDTH, Math.round(size.width * 0.3)),
          h: Math.max(LPR_TRAIN_MIN_CROP_HEIGHT, Math.round(size.height * 0.15))
        };
      }
      lprTrainState.cropPoints = lprRectPoints(lprClampRect(initialBox, size));
    }
    lprTrainState.cropBox = lprClampRect(lprPointsToBox(lprTrainState.cropPoints), size);
    lprTrainState.cropPoints = lprRectPoints(lprTrainState.cropBox);
    updateLprBoxUI();
    renderLprCropPreview();
  }

  video.onloadedmetadata = () => {
    if (lprTrainState.mediaRequestId !== mediaRequestId) return;
    seek.max = video.duration || 10;
    seek.step = '0.05';
    // ข้ามไปยังวินาทีที่ AI ตรวจพบป้ายอัตโนมัติ
    const initTime = (ev.frameTime && ev.startTime && ev.frameTime >= ev.startTime)
      ? Math.min(video.duration || 10, Math.max(0, ev.frameTime - ev.startTime))
      : ((video.duration || 3) * 0.5);
    handleSeek(initTime);
    onVideoReady();
  };

  video.onerror = () => {
    if (lprTrainState.mediaRequestId !== mediaRequestId) return;
    const isVigi = (ev && ev.crop_path) || (lprTrainState.candidate && lprTrainState.candidate.crop_path) ||
                   (ev && ev.source === 'vigi_edge_ai') || String(clipEventId).startsWith('vigi_') || String(clipEventId).startsWith('ext_');
    const cropFile = (ev && ev.crop_path) || (lprTrainState.candidate && lprTrainState.candidate.crop_path) || (isVigi ? (clipEventId + '.jpg') : '');
    const snapSrc = cropFile
      ? '/lpr-crops/' + encodeURIComponent(cropFile)
      : apiUrl('/api/events/' + encodeURIComponent(clipEventId) + '/snapshot.jpg');
    video.style.display = 'none';
    if (videoControls) videoControls.hidden = true;
    lprTrainState.usingFullSnapshot = true;
    if (snapshot) {
      snapshot.hidden = false;
      snapshot.onload = () => {
        if (lprTrainState.mediaRequestId !== mediaRequestId) return;
        timeLbl.textContent = 'ภาพ Snapshot';
        msg.textContent = 'วิดีโอหมดอายุ — สลับมาใช้ภาพ Snapshot สำหรับครอบป้าย';
        msg.className = 'sync-msg info';
        if (btnSave) btnSave.disabled = false;
        onVideoReady();
      };
      snapshot.onerror = () => {
        timeLbl.textContent = 'ไม่มีภาพ/วิดีโอ';
        msg.textContent = 'ไม่พบทั้งไฟล์วิดีโอและ Snapshot ของเหตุการณ์นี้';
        msg.className = 'sync-msg err';
        if (btnSave) btnSave.disabled = true;
      };
      snapshot.src = snapSrc;
    } else {
      timeLbl.textContent = 'ไม่มีวิดีโอ';
      msg.textContent = 'เหตุการณ์นี้ไม่มีไฟล์วิดีโอ Mainstream ไม่สามารถสอน AI ได้';
      msg.className = 'sync-msg err';
      if (btnSave) btnSave.disabled = true;
    }
  };

  video.onseeked = () => {
    timeLbl.textContent = video.currentTime.toFixed(2) + 's';
    renderLprCropPreview();
  };

  video.ontimeupdate = () => {
    renderLprCropPreview();
  };

  seek.oninput = () => { handleSeek(parseFloat(seek.value)); };
  seek.onchange = () => { handleSeek(parseFloat(seek.value)); };

  $('btnLprPrevFrame').onclick = () => { handleSeek(video.currentTime - 0.1); };
  $('btnLprNextFrame').onclick = () => { handleSeek(video.currentTime + 0.1); };

  if (video.src && video.src.startsWith('blob:')) {
    URL.revokeObjectURL(video.src);
  }
  video.removeAttribute('src');

  fetch(clipSrc)
    .then(res => {
      if (!res.ok) throw new Error('Clip not found');
      return res.blob();
    })
    .then(blob => {
      if (lprTrainState.mediaRequestId !== mediaRequestId) return;
      const blobUrl = URL.createObjectURL(blob);
      video.style.display = '';
      if (videoControls) videoControls.hidden = false;
      video.src = blobUrl;
      video.load();
    })
    .catch(() => {
      if (lprTrainState.mediaRequestId !== mediaRequestId) return;
      // Fallback to event Snapshot image so user can crop and train AI even without video clip!
      const isVigi = (ev && ev.crop_path) || (lprTrainState.candidate && lprTrainState.candidate.crop_path) ||
                     (ev && ev.source === 'vigi_edge_ai') || String(clipEventId).startsWith('vigi_') || String(clipEventId).startsWith('ext_');
      const cropFile = (ev && ev.crop_path) || (lprTrainState.candidate && lprTrainState.candidate.crop_path) || (isVigi ? (clipEventId + '.jpg') : '');
      const snapSrc = cropFile
        ? '/lpr-crops/' + encodeURIComponent(cropFile)
        : apiUrl('/api/events/' + encodeURIComponent(clipEventId) + '/snapshot.jpg');
      video.style.display = 'none';
      if (videoControls) videoControls.hidden = true;
      lprTrainState.usingFullSnapshot = true;
      if (snapshot) {
        snapshot.hidden = false;
        snapshot.onload = () => {
          if (lprTrainState.mediaRequestId !== mediaRequestId) return;
          timeLbl.textContent = 'ภาพ Snapshot';
          msg.textContent = 'วิดีโอหมดอายุ — สลับมาใช้ภาพ Snapshot สำหรับครอบป้าย';
          msg.className = 'sync-msg info';
          if (btnSave) btnSave.disabled = false;
          onVideoReady();
        };
        snapshot.onerror = () => {
          timeLbl.textContent = 'ไม่มีภาพ/วิดีโอ';
          msg.textContent = 'ไม่พบทั้งไฟล์วิดีโอและ Snapshot ของเหตุการณ์นี้';
          msg.className = 'sync-msg err';
          if (btnSave) btnSave.disabled = true;
        };
        snapshot.src = snapSrc;
      } else {
        timeLbl.textContent = 'ไม่มีวิดีโอ';
        msg.textContent = 'เหตุการณ์นี้ไม่มีไฟล์วิดีโอ Mainstream ไม่สามารถสอน AI ได้';
        msg.className = 'sync-msg err';
        if (btnSave) btnSave.disabled = true;
      }
    });

  overlay.hidden = false;
}

function closeLprTrainModal() {
  const overlay = $('lprTrainOverlay');
  if (overlay) overlay.hidden = true;
  const video = $('lprTrainVideo');
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  // Invalidate pending asynchronous image/video callbacks after closing.
  lprTrainState.mediaRequestId += 1;
  lprTrainState.activeEv = null;
}

function updateLprBoxUI() {
  const video = lprTrainingMedia();
  const box = $('lprCropBox');
  const stage = $('lprCropStage');
  if (!lprTrainState.cropBox || !video || !box || !stage) {
    if (box) box.hidden = true;
    return;
  }

  const stageRect = stage.getBoundingClientRect();
  const vidRect = video.getBoundingClientRect();

  const size = lprMediaSize(video);
  if (vidRect.width === 0 || vidRect.height === 0 || size.width === 0 || size.height === 0) return;

  const scaleX = vidRect.width / size.width;
  const scaleY = vidRect.height / size.height;
  const offsetX = vidRect.left - stageRect.left;
  const offsetY = vidRect.top - stageRect.top;

  const points = lprTrainState.cropPoints;
  const b = lprPointsToBox(points);
  if (!b) return;
  lprTrainState.cropBox = b;
  box.style.left = (offsetX + b.x * scaleX) + 'px';
  box.style.top = (offsetY + b.y * scaleY) + 'px';
  box.style.width = Math.max(16, b.w * scaleX) + 'px';
  box.style.height = Math.max(12, b.h * scaleY) + 'px';
  // Rectangle handles are positioned by CSS, not independent perspective points.
  box.style.removeProperty('--lpr-perspective-polygon');
  box.hidden = false;
}

function lprAffineTransform(source, destination) {
  // Solve the six affine coefficients mapping a source triangle to a
  // destination triangle.  Two triangles together rectify the four-corner crop.
  const [s0, s1, s2] = source, [d0, d1, d2] = destination;
  const denominator = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
  if (Math.abs(denominator) < 0.0001) return null;
  const solveX = values => [
    (values[0] * (s1[1] - s2[1]) + values[1] * (s2[1] - s0[1]) + values[2] * (s0[1] - s1[1])) / denominator,
    (values[0] * (s2[0] - s1[0]) + values[1] * (s0[0] - s2[0]) + values[2] * (s1[0] - s0[0])) / denominator,
    (values[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + values[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + values[2] * (s0[0] * s1[1] - s1[0] * s0[1])) / denominator,
  ];
  const x = solveX([d0[0], d1[0], d2[0]]);
  const y = solveX([d0[1], d1[1], d2[1]]);
  return [x[0], y[0], x[1], y[1], x[2], y[2]];
}

function drawLprTriangle(ctx, video, source, destination) {
  const transform = lprAffineTransform(source, destination);
  if (!transform) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(destination[0][0], destination[0][1]);
  ctx.lineTo(destination[1][0], destination[1][1]);
  ctx.lineTo(destination[2][0], destination[2][1]);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(...transform);
  ctx.drawImage(video, 0, 0);
  ctx.restore();
}

function renderLprCropPreview() {
  const video = lprTrainingMedia();
  const canvas = $('lprTrainCanvas');
  const points = lprTrainState.cropPoints;
  const size = lprMediaSize(video);
  if (!canvas || !video || !points || points.length !== 4 || !size.width) return;
  const ctx = canvas.getContext('2d');
  const crop = lprPointsToBox(points);
  // Preview must mirror the selected crop even when it is too small to save.
  // Save validation remains strict, but showing it avoids a stale prior plate.
  if (!crop || crop.w <= 0 || crop.h <= 0) return;
  const naturalWidth = Math.round(crop.w);
  const naturalHeight = Math.round(crop.h);
  const scale = Math.min(1, 1200 / naturalWidth, 600 / naturalHeight);
  canvas.width = Math.max(20, Math.round(naturalWidth * scale));
  canvas.height = Math.max(15, Math.round(naturalHeight * scale));
  try {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
  } catch (e) {}
}

function initLprAnnotationStage() {
  const stage = $('lprCropStage');
  const box = $('lprCropBox');
  const video = $('lprTrainVideo');
  if (!stage || !video) return;

  window.addEventListener('resize', () => {
    if (!$('lprTrainOverlay').hidden) updateLprBoxUI();
  });

  stage.addEventListener('mousedown', (e) => {
    if (e.target === box || (box && box.contains(e.target))) return;
    e.preventDefault();
    const activeMedia = lprTrainingMedia();
    const mediaSize = lprMediaSize(activeMedia);
    const vidRect = activeMedia.getBoundingClientRect();
    if (e.clientX < vidRect.left || e.clientX > vidRect.right || e.clientY < vidRect.top || e.clientY > vidRect.bottom) return;

    lprTrainState.isDrawing = true;
    const scaleX = mediaSize.width / vidRect.width;
    const scaleY = mediaSize.height / vidRect.height;
    lprTrainState.startX = (e.clientX - vidRect.left) * scaleX;
    lprTrainState.startY = (e.clientY - vidRect.top) * scaleY;
    lprTrainState.cropBox = { x: lprTrainState.startX, y: lprTrainState.startY, w: 1, h: 1 };
    lprTrainState.cropPoints = lprRectPoints(lprTrainState.cropBox);
    updateLprBoxUI();
  });

  window.addEventListener('mousemove', (e) => {
    if (!lprTrainState.activeEv || $('lprTrainOverlay').hidden) return;
    const activeMedia = lprTrainingMedia();
    const mediaSize = lprMediaSize(activeMedia);
    const vidRect = activeMedia.getBoundingClientRect();
    if (vidRect.width === 0 || vidRect.height === 0 || !mediaSize.width || !mediaSize.height) return;
    const scaleX = mediaSize.width / vidRect.width;
    const scaleY = mediaSize.height / vidRect.height;

    if (lprTrainState.isDrawing) {
      const curX = Math.max(0, Math.min(mediaSize.width, (e.clientX - vidRect.left) * scaleX));
      const curY = Math.max(0, Math.min(mediaSize.height, (e.clientY - vidRect.top) * scaleY));
      const x = Math.min(lprTrainState.startX, curX);
      const y = Math.min(lprTrainState.startY, curY);
      const w = Math.abs(curX - lprTrainState.startX);
      const h = Math.abs(curY - lprTrainState.startY);
      lprTrainState.cropBox = { x, y, w, h };
      lprTrainState.cropPoints = lprRectPoints(lprTrainState.cropBox);
      updateLprBoxUI();
      renderLprCropPreview();
    } else if (lprTrainState.isDragging && lprTrainState.startPoints) {
      const dx = (e.clientX - lprTrainState.dragStartX) * scaleX;
      const dy = (e.clientY - lprTrainState.dragStartY) * scaleY;
      const startBox = lprPointsToBox(lprTrainState.startPoints);
      // Translate the whole rectangle, bounded by the active image/video.
      const boundedDx = Math.max(-startBox.x, Math.min(mediaSize.width - startBox.x - startBox.w, dx));
      const boundedDy = Math.max(-startBox.y, Math.min(mediaSize.height - startBox.y - startBox.h, dy));
      lprTrainState.cropBox = lprClampRect({ ...startBox, x: startBox.x + boundedDx, y: startBox.y + boundedDy }, mediaSize);
      lprTrainState.cropPoints = lprRectPoints(lprTrainState.cropBox);
      updateLprBoxUI();
      renderLprCropPreview();
    } else if (lprTrainState.isResizing && lprTrainState.startPoints) {
      // Resize only the selected corner while retaining a rectangular crop.
      const nextX = Math.max(0, Math.min(mediaSize.width, (e.clientX - vidRect.left) * scaleX));
      const nextY = Math.max(0, Math.min(mediaSize.height, (e.clientY - vidRect.top) * scaleY));
      lprTrainState.cropBox = lprResizeRect(lprTrainState.startBox, lprTrainState.resizeCorner, nextX, nextY, mediaSize);
      lprTrainState.cropPoints = lprRectPoints(lprTrainState.cropBox);
      updateLprBoxUI();
      renderLprCropPreview();
    }
  });

  window.addEventListener('mouseup', () => {
    if (lprTrainState.isDrawing || lprTrainState.isDragging || lprTrainState.isResizing) {
      lprTrainState.isDrawing = false;
      lprTrainState.isDragging = false;
      lprTrainState.isResizing = false;
      // Mouse-up clamps an accidental tiny draw to the same trainable minimum.
      const mediaSize = lprMediaSize(lprTrainingMedia());
      if (lprTrainState.cropBox && mediaSize.width && mediaSize.height) {
        lprTrainState.cropBox = lprClampRect(lprTrainState.cropBox, mediaSize);
        lprTrainState.cropPoints = lprRectPoints(lprTrainState.cropBox);
        updateLprBoxUI();
      }
      renderLprCropPreview();
    }
  });

  if (box) {
    box.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('lpr-crop-handle')) {
        lprTrainState.isResizing = true;
        lprTrainState.resizeCorner = e.target.classList.contains('tl') ? 'tl' : (e.target.classList.contains('tr') ? 'tr' : (e.target.classList.contains('bl') ? 'bl' : 'br'));
      } else {
        lprTrainState.isDragging = true;
      }
      e.preventDefault();
      e.stopPropagation();
      lprTrainState.dragStartX = e.clientX;
      lprTrainState.dragStartY = e.clientY;
      lprTrainState.startBox = { ...lprTrainState.cropBox };
      lprTrainState.startPoints = lprTrainState.cropPoints.map(point => [...point]);
    });
  }

  $('btnResetLprBox')?.addEventListener('click', () => {
    // Reset uses the currently visible medium so snapshot-only events work too.
    const size = lprMediaSize(lprTrainingMedia());
    const nw = size.width || 640;
    const nh = size.height || 480;
    lprTrainState.cropBox = lprClampRect({
      x: Math.round(nw * 0.35),
      y: Math.round(nh * 0.4),
      w: Math.max(LPR_TRAIN_MIN_CROP_WIDTH, Math.round(nw * 0.3)),
      h: Math.max(LPR_TRAIN_MIN_CROP_HEIGHT, Math.round(nh * 0.15))
    }, { width: nw, height: nh });
    lprTrainState.cropPoints = lprRectPoints(lprTrainState.cropBox);
    updateLprBoxUI();
    renderLprCropPreview();
  });
}

function updateLprDecisionFields() {
  const decision = $('selLprDecision')?.value || 'unreadable';
  const textAllowed = ['readable', 'partial'].includes(decision);
  const isNonPlate = decision === 'non_plate';
  const plate = $('inpLprPlate');
  const province = $('selLprProvince');
  const reasonWrap = $('lprNonPlateReasonFields');
  const reason = $('selLprNonPlateReason');
  const detailField = $('lprNonPlateReasonDetailField');
  const detail = $('inpLprNonPlateReasonDetail');
  const hint = $('lprDecisionHint');

  if (plate) plate.disabled = !textAllowed;
  if (province) province.disabled = !textAllowed;
  if (!textAllowed) {
    if (plate) plate.value = '';
    if (province) province.value = '';
  }
  if (reasonWrap) reasonWrap.hidden = !isNonPlate;
  if (detailField) detailField.hidden = !isNonPlate || reason?.value !== 'other';
  if (!isNonPlate) {
    if (reason) reason.value = '';
    if (detail) detail.value = '';
  }
  if (hint) {
    hint.textContent = decision === 'unreadable'
      ? 'เก็บเป็นตัวอย่างบวกเพื่อสอนว่ารูปทรงนี้คือป้ายจริง โดยไม่สร้างคำตอบ OCR'
      : (isNonPlate
        ? 'เก็บเป็นตัวอย่างลบพร้อมสาเหตุ เพื่อให้โมเดลแยกสิ่งที่คล้ายป้ายได้ดีขึ้น'
        : (decision === 'partial'
          ? 'สอนตำแหน่งป้ายและเฉพาะตัวอักษร/จังหวัดที่มองเห็นจริง โดยไม่เดาส่วนที่ขาด'
          : 'สอนทั้งตำแหน่งป้ายและตัวอักษรที่ผู้ดูแลยืนยัน'));
  }
}

async function saveLprTrainingSample() {
  const ev = lprTrainState.activeEv;
  const candidate = lprTrainState.activeCandidate;
  if (!ev || !candidate) return;
  const decision = $('selLprDecision').value;
  const plateInp = $('inpLprPlate').value.trim();
  const provInp = $('selLprProvince').value.trim();
  const nonPlateReason = $('selLprNonPlateReason')?.value || '';
  const nonPlateReasonDetail = $('inpLprNonPlateReasonDetail')?.value.trim() || '';
  const msg = $('lprTrainMsg');
  const btn = $('btnLprTrainSave');

  if (decision === 'readable' && (!plateInp || !provInp)) {
    msg.textContent = 'ผลอ่านได้ครบถ้วนต้องระบุทะเบียนและจังหวัด';
    msg.className = 'sync-msg err';
    return;
  }
  if (decision === 'partial' && !plateInp && !provInp) {
    msg.textContent = 'ผลอ่านได้บางส่วนต้องใส่เฉพาะส่วนที่มองเห็นจริงอย่างน้อยหนึ่งช่อง';
    msg.className = 'sync-msg err';
    return;
  }
  if (decision === 'non_plate' && !nonPlateReason) {
    msg.textContent = 'กรุณาเลือกสาเหตุที่ไม่ใช่ป้ายทะเบียน';
    msg.className = 'sync-msg err';
    return;
  }
  if (decision === 'non_plate' && nonPlateReason === 'other' && !nonPlateReasonDetail) {
    msg.textContent = 'กรุณาระบุรายละเอียดของสาเหตุอื่น ๆ';
    msg.className = 'sync-msg err';
    return;
  }

  const canvas = $('lprTrainCanvas');
  const crop = lprPointsToBox(lprTrainState.cropPoints);
  // Readable and partial saves require the normal natural-pixel floor.
  // Non-plate decisions (ไม่ใช่ป้ายทะเบียน) reject false positives and do not require drawing a plate box.
  if (decision !== 'non_plate') {
    const isExactLowQualityEvidence = decision === 'unreadable'
      && Boolean(candidate.crop_path)
      && !lprTrainState.usingFullSnapshot;
    if (!crop || ((!isExactLowQualityEvidence)
      && (crop.w < LPR_TRAIN_MIN_CROP_WIDTH || crop.h < LPR_TRAIN_MIN_CROP_HEIGHT))) {
      msg.textContent = 'กรุณาครอบป้ายอย่างน้อย ' + LPR_TRAIN_MIN_CROP_WIDTH + '×' + LPR_TRAIN_MIN_CROP_HEIGHT + ' พิกเซลก่อนบันทึก';
      msg.className = 'sync-msg err';
      return;
    }
  }
  const cropBase64 = (canvas && lprTrainState.cropPoints) ? canvas.toDataURL('image/jpeg', 0.95) : null;
  const polygon = lprTrainState.cropPoints
    ? lprTrainState.cropPoints.map(point => point.map(value => Math.round(value)))
    : null;

  btn.disabled = true;
  msg.textContent = 'กำลังบันทึกคำยืนยันของผู้ตรวจสอบ…';
  msg.className = 'sync-msg info';

  try {
    const isAdjudication = candidate.review_state === 'conflict' && userRole === 'superadmin';
    const action = isAdjudication ? 'adjudicate' : 'reviews';
    const res = await fetch('/api/watchlist/lpr/candidates/' + encodeURIComponent(candidate.id) + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision,
        plate_text: ['readable', 'partial'].includes(decision) ? plateInp : null,
        province: ['readable', 'partial'].includes(decision) ? provInp : null,
        non_plate_reason: decision === 'non_plate' ? nonPlateReason : null,
        non_plate_reason_detail: decision === 'non_plate' ? nonPlateReasonDetail : null,
        polygon,
        crop_base64: cropBase64
      })
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.detail || ('บันทึกไม่สำเร็จ (' + res.status + ')'));
    }
    const result = await res.json();
    msg.textContent = result.review_state === 'conflict'
      ? 'บันทึกแล้ว แต่คำตอบขัดแย้งและถูกส่งให้ผู้ดูแลระบบระดับสูงตัดสิน'
      : 'ยืนยันสำเร็จ และสร้างข้อมูลฝึกจากคำตอบของผู้ตรวจสอบแล้ว';
    msg.className = 'sync-msg done';
    toast(msg.textContent);

    if (result.status === 'readable') {
      const display = [result.plate_text, result.province].filter(Boolean).join(' ');
      ev.plate = display;
      ev.sub_label = display;
      if (ev.data) ev.data.recognized_license_plate = result.plate_text || '';
    } else {
      ev.plate = '';
      ev.sub_label = '';
      if (ev.data) ev.data.recognized_license_plate = '';
    }

    await fetchEmgrLprIndex();
    setTimeout(() => {
      closeLprTrainModal();
      btn.disabled = false;
      loadEventLprCandidates(ev);
      renderEventMgr();
      renderEvents();
    }, 1000);
  } catch (err) {
    msg.textContent = 'เกิดข้อผิดพลาด: ' + err.message;
    msg.className = 'sync-msg warn';
    btn.disabled = false;
  }
}

function closeEmgrDetail() {
  const v = $('edVideo'); v.pause(); cleanupCompatJob(v); v.removeAttribute('src'); v.load();
  v.dataset.origSrc = '';
  if (edZoom) edZoom.reset();
  v.setAttribute('controls', ''); // belt-and-braces: คืน native controls เสมอ (zoom ถอดชั่วคราว)
  $('edSharePop').hidden = true;
  $('emgrDetailOverlay').hidden = true; state.emgrEv = null;
}

function reloadEmgrVideo() {
  switchEmgrTab('video', true);
}

// Frigate can retire an event-specific clip while its continuous recording is
// still retained locally.  Keep a short, bounded window around the event so an
// operator can still review old LPR evidence without asking the browser to
// download an entire day's recording.
function emgrRecordingFallback(ev) {
  const camera = ev && String(ev.camera || '').trim();
  const startTime = Number(ev && ev.startTime);
  if (!camera || !Number.isFinite(startTime) || startTime <= 0) return null;
  const preCapture = Math.max(0, Number(state.frigatePreCapture ?? 5));
  const duration = Math.min(300, Math.max(5, Number(ev.dur) || 0));
  const from = Math.floor(startTime - preCapture);
  const to = Math.ceil(startTime + duration + 10);
  const base = '/api/' + encodeURIComponent(camera);
  return {
    recordingsUrl: apiUrl(base + '/recordings?after=' + from + '&before=' + to),
    clipUrl: apiUrl(base + '/start/' + from + '/end/' + to + '/clip.mp4'),
  };
}

// Explain historical missing media truthfully.  A retry is useful only for a
// newly-finalizing clip; an older event with no recording segment was saved as
// a snapshot only and cannot be rebuilt from local storage.
function emgrPlaybackErrorMessage(ev, err) {
  if (err && err.code === 'NO_LOCAL_RECORDING' && ev && Number(ev.startTime) > 0) {
    const when = new Date(Number(ev.startTime) * 1000).toLocaleString('th-TH', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    return 'เหตุการณ์นี้มีเฉพาะภาพ Snapshot — ไม่พบ video segment ของกล้อง ' + (ev.camera || 'นี้') + ' ในช่วง ' + when;
  }
  return 'คลิปยังไม่พร้อมหรือไม่มีคลิป — ลองกดโหลดใหม่';
}

async function fetchEmgrClipBlob(ev, clipEventId, forceReload, onRecordingFallback) {
  const eventUrl = apiUrl('/api/events/' + encodeURIComponent(clipEventId) + '/clip.mp4');
  const fetchUrl = forceReload ? eventUrl + '?t=' + Date.now() : eventUrl;
  const eventResponse = await fetch(fetchUrl, { signal: timeoutSignal(15000) });
  if (eventResponse.ok) return { blob: await eventResponse.blob(), source: 'event' };

  const fallback = emgrRecordingFallback(ev);
  if (!fallback) throw new Error('Event clip unavailable and recording window is unknown');
  if (typeof onRecordingFallback === 'function') onRecordingFallback();
  const recordingResponse = await fetch(fallback.recordingsUrl, { signal: timeoutSignal(10000) });
  if (!recordingResponse.ok) throw new Error('Recording availability request failed');
  const segments = await recordingResponse.json();
  if (!Array.isArray(segments) || segments.length === 0) {
    const error = new Error('No local recording for event window');
    error.code = 'NO_LOCAL_RECORDING';
    throw error;
  }
  // Frigate creates this local clip on demand; it can take longer than a
  // normal event clip, especially for evidence older than the clip retention.
  const clipResponse = await fetch(fallback.clipUrl, { signal: timeoutSignal(45000) });
  if (!clipResponse.ok) throw new Error('Local recording clip request failed');
  const blob = await clipResponse.blob();
  if (blob.size === 0) throw new Error('Local recording clip was empty');
  return { blob, source: 'recording' };
}

function switchEmgrTab(tab, forceReload = false) {
  $('edTabSnapBtn').classList.toggle('active', tab === 'snap');
  $('edTabVideoBtn').classList.toggle('active', tab === 'video');
  $('edTabTrackBtn').classList.toggle('active', tab === 'track');
  $('edPaneSnap').hidden = tab !== 'snap';
  $('edPaneVideo').hidden = tab !== 'video';
  $('edPaneTrack').hidden = tab !== 'track';
  const v = $('edVideo'), ev = state.emgrEv;
  if (tab !== 'video') v.pause(); // หยุดวิดีโอเมื่อออกจากแท็บวิดีโอ
  if (tab === 'track') { loadTrackDetails(ev); return; }
  if (tab !== 'video') return;
  if (cfg.demo) { v.style.display = 'none'; $('edNoClip').hidden = false; $('edNoClip').textContent = 'โหมดสาธิต — ไม่มีคลิปจริง'; return; }
  // `has_clip` from the event list can be stale while Frigate finalizes a
  // recording. Always try the current/primary event endpoint and trust its HTTP
  // result; this also supports LPR candidates opened through a linked person.
  if (ev) {
    const clipEventId = ev.lprClipEventId || ev.id;
    const srcUrl = apiUrl('/api/events/' + encodeURIComponent(clipEventId) + '/clip.mp4');
    if (v.dataset.origSrc !== srcUrl || forceReload) {
      if (forceReload) {
        const btn = document.querySelector('#edIncompleteWarning button');
        if (btn) { btn.disabled = true; btn.textContent = 'กำลังโหลด...'; }
      }
      v.pause();
      if (v.src && v.src.startsWith('blob:')) URL.revokeObjectURL(v.src);
      cleanupCompatJob(v); v.removeAttribute('src');
      v.load();
      v.dataset.origSrc = srcUrl;
      const setupSeek = () => {
        if (v.dataset.origSrc !== srcUrl) return;
        const curEv = state.emgrEv;
        const w = $('edIncompleteWarning');
        if (curEv && curEv.frameTime && curEv.startTime && v.duration > 0 && !isNaN(v.duration)) {
          const preCapture = state.frigatePreCapture ?? 5;
          const bestShotOffset = Math.max(0, curEv.frameTime - curEv.startTime);
          const expectedLength = preCapture + bestShotOffset;
          if (w) w.hidden = (expectedLength < v.duration - 1);
        } else {
          if (w) w.hidden = true;
        }
      };

      if (isIOSBrowser) {
        v.style.display = '';
        $('edNoClip').hidden = true;
        v.addEventListener('loadedmetadata', setupSeek, { once: true });
        prepareAndPlayVideoCompat({ purpose: 'playback', event_id: clipEventId }, v, () => {
          if (forceReload) {
            const btn = document.querySelector('#edIncompleteWarning button');
            if (btn) { btn.disabled = false; btn.textContent = 'โหลดใหม่'; }
            const w = $('edIncompleteWarning');
            if (w) w.hidden = true;
          }
        }, () => {
          if (v.dataset.origSrc === srcUrl) {
            $('edNoClip').hidden = false;
            $('edNoClip').textContent = 'คลิปยังไม่พร้อมหรือไม่มีคลิป — ลองกดโหลดใหม่';
            v.style.display = 'none';
            const w = $('edIncompleteWarning');
            if (w) w.hidden = false;
            if (forceReload) {
              const btn = document.querySelector('#edIncompleteWarning button');
              if (btn) { btn.disabled = false; btn.textContent = 'โหลดใหม่'; }
            }
          }
        });
      } else {
        // In-memory Blob URL for 100% full seeking/scrubbing support across all browsers
        v.style.display = '';
        $('edNoClip').hidden = false;
        $('edNoClip').textContent = 'กำลังโหลดวิดีโอคลิป...';
        fetchEmgrClipBlob(ev, clipEventId, forceReload, () => {})
          .then(({ blob, source }) => {
            if (v.dataset.origSrc === srcUrl) {
              $('edNoClip').hidden = true;
              v.style.display = '';
              v.src = URL.createObjectURL(blob);
              if (source === 'recording') toast('กำลังเล่นคลิปจากวิดีโอที่บันทึกไว้ในเครื่อง');
              v.addEventListener('loadedmetadata', setupSeek, { once: true });
              v.play().catch(() => {});
            }
          })
          .catch(err => {
            if (v.dataset.origSrc === srcUrl) {
              $('edNoClip').hidden = false;
              $('edNoClip').textContent = emgrPlaybackErrorMessage(ev, err);
              v.style.display = 'none';
              const w = $('edIncompleteWarning');
              if (w) w.hidden = (err && err.code === 'NO_LOCAL_RECORDING');
            }
          });
      }
    } else if (v.src) {
      $('edNoClip').hidden = true;
      v.style.display = '';
      v.play().catch(() => {});
    }
  } else { v.style.display = 'none'; $('edNoClip').hidden = false; $('edNoClip').textContent = 'ไม่พบข้อมูลเหตุการณ์สำหรับเปิดคลิป'; }
}

/* ============ Tracked Object Details (แท็บ 3 — lifecycle + path + stats จาก Frigate) ============ */
// ช่วงชีวิตวัตถุ (class_type จาก /api/timeline) — ชื่อไทย + SVG ไอคอน
const LIFECYCLE_TH = {
  visible: { t: 'ตรวจพบวัตถุ', svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' },
  entered_zone: { t: 'เข้าสู่โซน', svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>' },
  active: { t: 'เริ่มเคลื่อนไหว', svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>' },
  stationary: { t: 'หยุดนิ่ง', svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>' },
  attribute: { t: 'พบลักษณะเด่น', svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>' },
  sub_label: { t: 'ระบุชนิดย่อย', svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>' },
  gone: { t: 'ออกจากเฟรม', svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>' },
  heard: { t: 'ได้ยินเสียง', svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>' },
  external: { t: 'ตรวจจับภายนอก', svg: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>' },
};
const SEVERITY_TH = { alert: 'แจ้งเตือน (Alert)', detection: 'ตรวจจับ (Detection)', significant_motion: 'การเคลื่อนไหวสำคัญ' };
let trackGen = 0;

async function loadTrackDetails(ev) {
  if (!ev) return;
  const gen = ++trackGen; // กันสลับ event/แท็บระหว่างรอ response
  const img = $('edTrackImg'), url = emgrThumb(ev);
  if (url) { img.src = url; img.style.display = ''; } else { img.removeAttribute('src'); img.style.display = 'none'; }
  $('edTrackPath').innerHTML = '';
  $('edTrackStats').innerHTML = '<div class="emgr-track-loading">กำลังโหลด…</div>';
  $('edTrackLife').innerHTML = '';
  if (cfg.demo) { $('edTrackStats').innerHTML = '<div class="emgr-track-loading">โหมดสาธิต — ไม่มีข้อมูลจริง</div>'; return; }
  let detail = null, timeline = [];
  try {
    const [dRes, tRes] = await Promise.all([
      fetch(apiUrl('/api/events/' + encodeURIComponent(ev.id)), { signal: timeoutSignal(9000) }),
      fetch(apiUrl('/api/timeline?source_id=' + encodeURIComponent(ev.id)), { signal: timeoutSignal(9000) }),
    ]);
    if (dRes.ok) detail = await dRes.json();
    if (tRes.ok) timeline = await tRes.json();
  } catch (e) { /* เข้าถึงไม่ได้ — จะแสดงเท่าที่มี */ }
  if (gen !== trackGen) return;
  renderTrackDetails(ev, detail, timeline);
}

function renderTrackDetails(ev, detail, timeline) {
  const data = (detail && detail.data) || {};
  const zones = (detail && detail.zones) || [];
  const subLabel = (detail && detail.sub_label) || '';
  const topScore = data.top_score || (detail && detail.top_score) || 0;
  const finalScore = data.score || 0;
  const start = (detail && detail.start_time) || ev.startTime;
  const end = detail && detail.end_time;
  const durSec = end ? Math.max(1, end - start) : (ev.dur || 0);

  const rows = [];
  rows.push(['ชนิดวัตถุ', typeMeta(ev.label).label + (subLabel ? ' — ' + subLabel : '') + ' (' + ev.label + ')']);
  // แถวเฉพาะป้ายทะเบียน — แยกจาก sub_label ทั่วไปด้านบนเพื่อให้เห็นชัดว่าเป็นผลจาก
  // ระบบ LPR (lpr-service) จริง ๆ ไม่ใช่ label ที่ผู้ใช้ตั้งเอง; ใช้ recognized_license_plate
  // (ทะเบียนล้วน) เป็นหลัก และแสดงจังหวัดแยกถ้า sub_label มีต่อท้าย
  const plate = data.recognized_license_plate || '';
  if (plate && subLabel !== ' ') {
    const province = subLabel.startsWith(plate) ? subLabel.slice(plate.length).trim() : '';
    rows.push(['ป้ายทะเบียน (LPR)', plate + (province ? ' — ' + province : '')]);
  }
  rows.push(['ความมั่นใจสูงสุด', Math.round(topScore * 100) + '%']);
  if (finalScore) rows.push(['คะแนนล่าสุด', Math.round(finalScore * 100) + '%']);
  if (data.max_severity) rows.push(['ระดับความสำคัญ', SEVERITY_TH[data.max_severity] || data.max_severity]);
  rows.push(['โซนที่ผ่าน', zones.length ? zones.join(', ') : '—']);
  if (data.average_estimated_speed > 0) rows.push(['ความเร็วประมาณ', data.average_estimated_speed.toFixed(1)]);
  if (durSec) rows.push(['ระยะเวลา', fmtDur(durSec) + ' นาที']);
  if (data.path_data && data.path_data.length) rows.push(['จำนวนจุดเส้นทาง', data.path_data.length + ' จุด']);
  const stats = $('edTrackStats');
  stats.replaceChildren();
  rows.forEach(([key, value]) => {
    // Labels and values can include persisted event metadata (zones, sub-labels,
    // and plates), so each field is assigned only through textContent.
    const row = document.createElement('div');
    row.className = 'emgr-info-row';
    const keyNode = document.createElement('span');
    keyNode.className = 'emgr-info-k';
    keyNode.textContent = key;
    const valueNode = document.createElement('span');
    valueNode.className = 'emgr-info-v';
    valueNode.textContent = value;
    row.append(keyNode, valueNode);
    stats.appendChild(row);
  });

  // เส้นทางการเคลื่อนที่ (path_data = [[[x,y], ts], ...] normalized 0-1) วาดทับ snapshot
  let pd = data.path_data;
  if ((!pd || pd.length === 0) && timeline && timeline.length > 0) {
    pd = timeline
      .filter(t => t.data && t.data.box && t.data.box.length === 4)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(t => {
        const box = t.data.box;
        // box = [x, y, w, h] (normalized 0-1)
        const cx = box[0] + (box[2] / 2);
        const cy = box[1] + (box[3] / 2);
        return [[cx, cy], t.timestamp];
      });
  }
  const svg = $('edTrackPath');
  if (pd && pd.length >= 2) {
    const pts = pd.map(p => (p[0][0] * 100).toFixed(2) + ',' + (p[0][1] * 100).toFixed(2)).join(' ');
    const a = pd[0][0], z = pd[pd.length - 1][0];
    svg.innerHTML =
      '<polyline points="' + pts + '" fill="none" stroke="#c084fc" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round" opacity="0.92"/>' +
      '<circle cx="' + (a[0] * 100).toFixed(2) + '" cy="' + (a[1] * 100).toFixed(2) + '" r="1.7" fill="#34e2a8"/>' +
      '<circle cx="' + (z[0] * 100).toFixed(2) + '" cy="' + (z[1] * 100).toFixed(2) + '" r="1.7" fill="#fb5b78"/>';
  } else { svg.innerHTML = ''; }

  const life = $('edTrackLife');
  if (!timeline.length) { life.innerHTML = '<div class="emgr-track-loading">ไม่มีข้อมูล lifecycle สำหรับเหตุการณ์นี้</div>'; return; }
  life.replaceChildren();
  timeline.slice().sort((a, b) => a.timestamp - b.timestamp).forEach(t => {
    const m = LIFECYCLE_TH[t.class_type] || { t: t.class_type, i: '•' };
    const td = t.data || {}, extra = [];
    if (td.score) extra.push(Math.round(td.score * 100) + '%');
    if (td.attribute) extra.push(td.attribute);
    if (td.sub_label) extra.push(td.sub_label);
    // Lifecycle class names, attributes, and sub-labels are backend data. Build
    // each node explicitly so none of those values can become markup.
    const item = document.createElement('div');
    item.className = 'emgr-life-item';
    const icon = document.createElement('span');
    icon.className = 'emgr-life-ico';
    icon.innerHTML = m.svg || '•';
    const label = document.createElement('span');
    label.className = 'emgr-life-label';
    label.textContent = m.t;
    const time = document.createElement('span');
    time.className = 'emgr-life-time';
    time.textContent = fmtTime(new Date(t.timestamp * 1000));
    item.append(icon, label, time);
    if (extra.length) {
      const extraNode = document.createElement('span');
      extraNode.className = 'emgr-life-extra';
      extraNode.textContent = extra.join(' · ');
      item.appendChild(extraNode);
    }
    life.appendChild(item);
  });
}

async function saveEmgrDesc() {
  const ev = state.emgrEv; if (!ev || cfg.demo) return;
  const desc = $('edDesc').value.trim();
  const btn = $('btnSaveDesc'), spin = $('edSaveSpin'), msg = $('edDescMsg');
  if (btn.disabled) return;
  btn.disabled = true;
  if (spin) { spin.hidden = false; spin.style.display = 'inline-block'; }
  msg.className = 'sync-msg busy'; msg.textContent = 'กำลังบันทึก…';
  try {
    const res = await fetch(apiUrl('/api/events/' + encodeURIComponent(ev.id) + '/description'), {
      method: 'POST', headers: FRIGATE_WRITE_HEADERS,
      body: JSON.stringify({ description: desc }), signal: timeoutSignal(8000),
    });
    if (!res.ok) throw new Error();
    ev.description = desc;
    const src = state.emgrEvents.find(e => e.id === ev.id); if (src) src.description = desc;
    msg.className = 'sync-msg done'; msg.textContent = 'บันทึกคำอธิบายแล้ว';
    toast('บันทึกคำอธิบายเหตุการณ์แล้ว — ใช้ค้นหาได้');
    renderEventMgr();
  } catch (e) { msg.className = 'sync-msg warn'; msg.textContent = 'บันทึกไม่สำเร็จ — ลองใหม่'; }
  finally { btn.disabled = false; if (spin) { spin.hidden = true; spin.style.display = 'none'; } }
}

async function deleteCurrentEmgrEvent() {
  const ev = state.emgrEv;
  if (!ev || !ev.id) return;
  if (cfg.demo) {
    toast('โหมดสาธิต — ไม่สามารถลบเหตุการณ์ได้');
    return;
  }
  const confirmed = await window.bppConfirm('คุณแน่ใจหรือไม่ว่าต้องการลบเหตุการณ์นี้ออกจากระบบอย่างถาวร?');
  if (!confirmed) return;

  const btn = $('btnDeleteEmgrEvent');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังลบ...'; }

  try {
    const res = await fetch('/api/watchlist/lpr/event/' + encodeURIComponent(ev.id), {
      method: 'DELETE',
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok && res.status !== 404) {
      throw new Error('HTTP ' + res.status);
    }

    state.emgrEvents = state.emgrEvents.filter(e => e.id !== ev.id);
    state.events = state.events.filter(e => e.id !== ev.id);

    toast('ลบเหตุการณ์เรียบร้อยแล้ว');
    closeEmgrDetail();
    renderEventMgr();
    renderEvents();
  } catch (err) {
    console.error('Delete event failed:', err);
    toast('เกิดข้อผิดพลาดในการลบเหตุการณ์: ' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>ลบเหตุการณ์';
    }
  }
}

async function emgrDownload() {
  // Download uses the same resolved primary LPR event as on-screen playback;
  // stale `has_clip=false` metadata must not suppress a real MP4 request.
  const ev = state.emgrEv; if (!ev || cfg.demo) { toast('ไม่มีคลิปให้ดาวน์โหลด'); return; }
  const clipEventId = ev.lprClipEventId || ev.id;
  const btn = $('btnEdDownload'), lbl = $('edDlLabel');
  if (btn.classList.contains('downloading')) return;
  const fname = $('edCh').textContent + '_' + ev.label + '_' + fmtTime(new Date(ev.startTime * 1000)).replace(/:/g, '') + '.mp4';
  btn.classList.add('downloading'); lbl.textContent = 'กำลังดาวน์โหลด…';
  try {
    const res = await fetch(apiUrl('/api/events/' + encodeURIComponent(clipEventId) + '/clip.mp4'));
    if (!res.ok) throw new Error();
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    lbl.textContent = 'ดาวน์โหลดแล้ว'; toast('บันทึกคลิปแล้ว — ' + fname);
    setTimeout(() => { lbl.textContent = 'ดาวน์โหลด'; }, 2500);
  } catch (e) { lbl.textContent = 'ดาวน์โหลด'; toast('ดาวน์โหลดไม่สำเร็จ'); }
  finally { btn.classList.remove('downloading'); }
}
async function emgrShare(kind) {
  const ev = state.emgrEv; if (!ev) return;
  $('edSharePop').hidden = true; $('btnEdShare').setAttribute('aria-expanded', 'false');
  // Shared links match the clip currently selected for LPR playback.
  const clipEventId = ev.lprClipEventId || ev.id;
  const link = cfg.demo ? location.href : apiUrl('/api/events/' + encodeURIComponent(clipEventId) + '/clip.mp4');
  if (kind === 'copy') { try { await copyText(link); toast('คัดลอกลิงก์คลิปแล้ว'); } catch (e) { toast('คัดลอกลิงก์ไม่สำเร็จ'); } }
  else if (kind === 'email') { location.href = 'mailto:?subject=' + encodeURIComponent('คลิปเหตุการณ์ ' + typeMeta(ev.label).label) + '&body=' + encodeURIComponent(link); }
}

/* ============ Media capture (snapshot / record → Downloads) ============ */
// บันทึก Blob เป็นไฟล์ลง Downloads (pattern เดียวกับ downloadClip/emgrDownload)
function saveBlobFile(blob, fname) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const tsStamp = () => { const d = new Date(); return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()); };

// ถ่ายภาพนิ่งจากเฟรมปัจจุบันของ <video> (ทั้ง MediaStream สดและคลิป same-origin — ไม่ taint)
function snapVideoFrame(video, baseName) {
  if (!video || !video.videoWidth) { toast('ยังไม่มีภาพให้บันทึก'); return; }
  try {
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    c.toBlob(b => {
      if (!b) { toast('บันทึกภาพไม่สำเร็จ'); return; }
      saveBlobFile(b, baseName + '_' + tsStamp() + '.png');
      toast('บันทึกภาพลง Downloads แล้ว');
    }, 'image/png');
  } catch (e) { toast('บันทึกภาพไม่สำเร็จ (แหล่งวิดีโอข้าม origin)'); }
}

// ควบคุมการบันทึกวิดีโอ NVR รายกล้อง (Demand-Driven Smart Recording)
async function toggleNvrManualRecord(camSrc, btnEl, camName) {
  if (!camSrc) return;
  if (!state.activeNvrRecordings) state.activeNvrRecordings = new Set();
  
  if (btnEl) btnEl.disabled = true;
  try {
    const res = await fetch(`/api/config/cameras/${encodeURIComponent(camSrc)}/record_toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.status === 'success') {
      const isRec = !!data.recording;
      if (isRec) {
        state.activeNvrRecordings.add(camSrc);
      } else {
        state.activeNvrRecordings.delete(camSrc);
      }
      updateAllRecButtons(camSrc, isRec);
      if (window.bppToast) {
        window.bppToast(isRec 
          ? `🔴 เริ่มบันทึกลง NVR สำหรับ ${displayCameraName(camSrc, camName)} แล้ว` 
          : `⏹️ หยุดบันทึก NVR สำหรับ ${displayCameraName(camSrc, camName)} แล้ว`);
      }
    } else {
      if (window.bppToast) window.bppToast('ไม่สามารถเปลี่ยนสถานะบันทึก NVR: ' + (data.detail || data.message || 'Error'), true);
    }
  } catch (err) {
    console.error('[toggleNvrManualRecord]', err);
    if (window.bppToast) window.bppToast('เกิดข้อผิดพลาดในการเชื่อมต่อ NVR', true);
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

function updateAllRecButtons(camSrc, isRec) {
  document.querySelectorAll(`.tile-act-btn[data-src="${CSS.escape(camSrc)}"]`).forEach(b => {
    b.classList.toggle('rec-on', isRec);
    b.title = isRec ? 'กำลังบันทึกลง NVR (คลิกเพื่อหยุด)' : 'บันทึกวิดีโอลงระบบ NVR (กดซ้ำเพื่อหยุด)';
  });
  const cvRec = $('btnCvRec');
  if (cvRec && state.viewingSrc === camSrc) {
    cvRec.classList.toggle('rec-on', isRec);
    cvRec.title = isRec ? 'กำลังบันทึกลง NVR (คลิกเพื่อหยุด)' : 'บันทึกวิดีโอลงระบบ NVR';
  }
}

async function syncNvrRecordStatus() {
  try {
    const res = await fetch('/api/config/cameras/record_status');
    if (res.ok) {
      const data = await res.json();
      state.activeNvrRecordings = new Set(data.active_recordings || []);
      state.activeNvrRecordings.forEach(src => {
        updateAllRecButtons(src, true);
      });
    }
  } catch (e) {}
}

// อัดวิดีโอจาก MediaStream ของ tile สด — toggle เริ่ม/หยุด, จำกัด 10 นาทีกัน memory
const REC_MAX_MS = 10 * 60 * 1000;
function startTileRecord(t, chName, onDone) {
  let stream = t.video && t.video.srcObject;
  if (!stream && t.video && typeof t.video.captureStream === 'function') {
    try { stream = t.video.captureStream(); } catch (e) {}
  }
  if (!stream) { toast('ยังไม่มีภาพสดให้อัด'); return null; }
  if (typeof MediaRecorder === 'undefined') { toast('เบราว์เซอร์นี้ไม่รองรับการอัดวิดีโอ'); return null; }
  // Chrome ใหม่อัด mp4 ได้ตรงๆ; รุ่นเก่าลง webm (เล่นได้ใน Chrome/VLC)
  const mime = MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/mp4')
    ? 'video/mp4' : 'video/webm';
  let rec;
  try { rec = new MediaRecorder(stream, { mimeType: mime }); }
  catch (e) { try { rec = new MediaRecorder(stream); } catch (e2) { toast('เริ่มอัดวิดีโอไม่สำเร็จ'); return null; } }
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    clearTimeout(rec._maxTimer);
    if (chunks.length) {
      const ext = (rec.mimeType || mime).indexOf('mp4') >= 0 ? '.mp4' : '.webm';
      saveBlobFile(new Blob(chunks, { type: rec.mimeType || mime }), chName + '_live_' + tsStamp() + ext);
      toast('บันทึกวิดีโอลง Downloads แล้ว');
    }
    if (onDone) onDone();
  };
  rec.onerror = () => { try { rec.stop(); } catch (e) {} }; // stream หลุด (reconnect) → ปิดและเซฟที่มี
  rec.start(1000); // เก็บ chunk ทุก 1 วิ
  rec._maxTimer = setTimeout(() => { if (rec.state === 'recording') { toast('ครบ 10 นาที — หยุดอัดอัตโนมัติ'); rec.stop(); } }, REC_MAX_MS);
  return rec;
}

/* ============ Digital zoom (วิดีโอย้อนหลัง: เลือกระดับ 2-5x → ตีกรอบแดง) ============ */
// ใช้ CSS transform บน <video> (container ทุกจุดเป็น relative+overflow:hidden อยู่แล้ว)
// เก็บ translate เป็น % ของ element → ทนต่อการ resize จอ/modal
// สูตร: view = k·(p + t) (origin กลาง) → จุดที่เลือก P (วัดจากกึ่งกลาง): p = P/k_cur − t_cur (inverse
// รองรับซูมซ้ำขณะซูมอยู่), t_new = −p แล้ว clamp |t%| ≤ 50·(1 − 1/k) กันขอบวิดีโอหลุดเห็นพื้นหลัง
let pvZoom = null, edZoom = null, pbMainZoom = null; // สร้างจริงตอน wiring (DOM พร้อม)

function makeVideoZoom(container, video, opts) {
  opts = opts || {};
  if (!container || !video) {
    return {
      hasSrc: () => false,
      arm: () => {},
      reset: () => {},
      level: () => 0,
      zoomAt: () => {},
    };
  }
  const st = { k: 1, tx: 0, ty: 0, level: 0, layer: null };
  function apply() {
    video.style.transform = st.k === 1 ? '' : 'scale(' + st.k + ') translate(' + st.tx + '%, ' + st.ty + '%)';
    // native controls ขยายตาม transform จนใช้ไม่ได้ + ขวางการลากกรอบ — ถอดชั่วคราวระหว่าง armed/zoomed
    if (opts.nativeControls) {
      if (st.k > 1 || st.layer) video.removeAttribute('controls');
      else video.setAttribute('controls', '');
    }
    if (opts.onChange) opts.onChange();
  }
  
  video.addEventListener('click', () => {
    // Allows play/pause by clicking the video when zoomed (controls are hidden)
    if (opts.nativeControls && !video.hasAttribute('controls')) {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    }
  });
  function zoomAt(level, px, py) { // px,py = จุดที่เลือก หน่วย px จากกึ่งกลาง container (พิกัดที่เห็นบนจอ)
    const r = container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const vx = px / r.width * 100, vy = py / r.height * 100; // → % ของ element
    const cx = vx / st.k - st.tx, cy = vy / st.k - st.ty;    // inverse transform ปัจจุบัน → พิกัด content
    const lim = 50 * (1 - 1 / level);
    st.tx = Math.max(-lim, Math.min(lim, -cx));
    st.ty = Math.max(-lim, Math.min(lim, -cy));
    st.k = level;
    apply();
  }
  function cancelArm() {
    if (st.layer) { st.layer.remove(); st.layer = null; }
    st.level = 0;
    apply(); // คืน controls ถ้าไม่ได้ซูมค้าง
  }
  function arm(level) {
    cancelArm();
    st.level = level;
    const layer = document.createElement('div');
    layer.className = 'zoom-layer';
    const box = document.createElement('div');
    box.className = 'zoom-box'; box.hidden = true;
    layer.appendChild(box);
    let sx = 0, sy = 0, dragging = false;
    const ptXY = e => { // ตำแหน่ง pointer ภายใน layer (clamp ขอบ) — ใช้ rect ของ layer ไม่ใช่ video ที่ transform แล้ว
      const r = layer.getBoundingClientRect();
      return [Math.max(0, Math.min(r.width, e.clientX - r.left)), Math.max(0, Math.min(r.height, e.clientY - r.top)), r];
    };
    layer.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { layer.setPointerCapture(e.pointerId); } catch (err) { /* browser เก่าบางตัว — ลากหลุด layer อาจค้าง ยอมรับได้ */ }
      const p = ptXY(e); sx = p[0]; sy = p[1]; dragging = true;
      box.hidden = false;
      box.style.left = sx + 'px'; box.style.top = sy + 'px'; box.style.width = '0'; box.style.height = '0';
    });
    layer.addEventListener('pointermove', e => {
      if (!dragging) return;
      const p = ptXY(e);
      box.style.left = Math.min(sx, p[0]) + 'px'; box.style.top = Math.min(sy, p[1]) + 'px';
      box.style.width = Math.abs(p[0] - sx) + 'px'; box.style.height = Math.abs(p[1] - sy) + 'px';
    });
    layer.addEventListener('pointerup', e => {
      if (!dragging) return;
      dragging = false;
      const p = ptXY(e), r = p[2];
      const isClick = Math.abs(p[0] - sx) < 4 && Math.abs(p[1] - sy) < 4; // คลิกเฉยๆ = ซูมที่จุดคลิก
      const cxp = isClick ? p[0] : (sx + p[0]) / 2; // ลาก = ศูนย์กลางกรอบ
      const cyp = isClick ? p[1] : (sy + p[1]) / 2;
      const lvl = st.level;
      cancelArm(); // เอา layer ออกก่อนซูม
      zoomAt(lvl, cxp - r.width / 2, cyp - r.height / 2);
      if (api.onApplied) api.onApplied(api); // playback: ปลดโหมดตีกรอบของ cell อื่นที่ยังรอ
    });
    st.layer = layer;
    container.appendChild(layer);
    apply(); // ถอด controls ระหว่าง armed
  }
  function reset() { cancelArm(); st.k = 1; st.tx = 0; st.ty = 0; apply(); }
  const api = {
    arm: arm, reset: reset, cancelArm: cancelArm,
    zoomed: () => st.k > 1,
    armed: () => !!st.layer,
    level: () => st.k,
    hasSrc: () => !!video.getAttribute('src'),
    onApplied: null,
  };
  return api;
}

// รวม zoom instance ทั้งหมดที่มีตอนนี้ (follower ของ playback เปลี่ยนตาม layout)
function pbAllZooms() {
  const list = [];
  if (pbMainZoom) list.push(pbMainZoom);
  (pb.followers || []).forEach(f => { if (f.zoom) list.push(f.zoom); });
  return list;
}
function allZoomInstances() {
  const list = pbAllZooms();
  if (pvZoom) list.push(pvZoom);
  if (edZoom) list.push(edZoom);
  return list;
}
function pbZoomApplied(self) { pbAllZooms().forEach(zi => { if (zi !== self) zi.cancelArm(); }); }
function updatePvZoomUi() {
  const z = pvZoom.zoomed();
  $('btnPvZoomOut').disabled = !z;
  $('pvZoomLvl').hidden = !z;
  $('pvZoomLvl').textContent = z ? pvZoom.level() + '×' : '';
}
function updateEdZoomUi() {
  const z = edZoom.zoomed();
  $('btnEdZoomOut').disabled = !z;
  $('edZoomLvl').hidden = !z;
  $('edZoomLvl').textContent = z ? edZoom.level() + '×' : '';
}
function updatePbZoomUi() {
  $('btnPbZoomOut').disabled = !pbAllZooms().some(zi => zi.zoomed());
}

// ESC: ยกเลิกโหมดตีกรอบก่อน → แล้วค่อยปิด popover ระดับซูม (เรียกจากบนสุดของ ESC chain)
const ZOOM_POPS = []; // { pop, btn }
function zoomEscape() {
  const armed = allZoomInstances().filter(zi => zi.armed());
  if (armed.length) { armed.forEach(zi => zi.cancelArm()); return true; }
  const open = ZOOM_POPS.filter(o => !o.pop.hidden);
  if (open.length) { open.forEach(o => { o.pop.hidden = true; o.btn.setAttribute('aria-expanded', 'false'); }); return true; }
  return false;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (zoomEscape()) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
});

// ผูกปุ่มแว่น+ (popover 2-5×) + แว่น− ของแต่ละ surface — o: {btnIn, pop, btnOut, canArm, arm, reset}
function wireZoomControls(o) {
  const btnIn = $(o.btnIn), pop = $(o.pop), btnOut = $(o.btnOut);
  if (!btnIn || !pop || !btnOut) return;
  ZOOM_POPS.push({ pop: pop, btn: btnIn });
  [2, 3, 4, 5].forEach(z => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'zoom-item'; b.textContent = z + '×';
    b.addEventListener('click', () => {
      pop.hidden = true; btnIn.setAttribute('aria-expanded', 'false');
      if (!o.canArm()) { toast('ยังไม่มีวิดีโอให้ซูม'); return; }
      o.arm(z);
      toast('ลากกรอบ (หรือคลิก) บริเวณที่ต้องการซูม ' + z + '× — กด ESC เพื่อยกเลิก');
    });
    pop.appendChild(b);
  });
  btnIn.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    btnIn.setAttribute('aria-expanded', String(!pop.hidden));
  });
  btnOut.addEventListener('click', o.reset);
}

/* ============ Playback (ดูย้อนหลัง — recordings + timeline + speed) ============ */
const pb = {
  cam: null, dayStart: 0, dayEnd: 0, segments: [], winStart: 0, winEnd: 0, speed: 1,
  viewStart: 0, viewEnd: 0, zoomIdx: 0, // ช่วงเวลาที่ไทม์ไลน์แสดง (zoom/pan)
  events: [], evCache: {}, evClassSel: null, // event ของวัน + cache ต่อ cam:day + filter class (null = ทั้งหมด)
  recDays: new Set(), calYm: null,      // ปฏิทิน: วันที่มีบันทึก + เดือนที่แสดง
  layout: 1, followers: [],             // จอเพิ่ม (follower) — จอหลัก #pbVideo/ไทม์ไลน์ = cell 0 เส้นทางเดิมไม่แตะ
  recCache: {},                         // segments ต่อ `${cam}:${dayStart}` (follower ใช้ร่วมกัน)
};
const PB_CHUNK = 90; // วินาทีที่โหลดต่อครั้ง (เล่นเป็นช่วงๆ ผ่าน clip.mp4)
const PB_ZOOMS = [86400, 21600, 3600, 600, 60]; // ระดับซูม: ทั้งวัน/6ชม/1ชม/10นาที/1นาที
const fmtClock = ts => fmtTime(new Date(ts * 1000));
// map เวลา ↔ ตำแหน่ง % บนไทม์ไลน์ — ทุกจุดต้องผ่านคู่นี้ (ห้ามหาร 86400 ตรงๆ อีก)
const pbT2pct = t => (t - pb.viewStart) / (pb.viewEnd - pb.viewStart) * 100;
const pbPct2t = p => pb.viewStart + p * (pb.viewEnd - pb.viewStart);

function pbCamList() {
  const cams = [];
  cfg.channels.forEach(c => { if (c.src && !cams.includes(c.src)) cams.push(c.src); });
  if (!cams.length) cams.push('cam11');
  return cams;
}
function pbCamLabel(name) {
  const idx = cfg.channels.findIndex(c => c.src === name);
  const rawName = idx >= 0
    ? cfg.channels[idx].name
    : (state.cameraNames?.[name] || DEFAULT_SPECIAL_CAMERA_NAMES[name] || name);
  const displayName = displayCameraName(name, rawName);
  return displayName && displayName !== name ? displayName + ' (' + name + ')' : (displayName || name);
}

function pbPopulateCamSelect(sel, includeBlank = false) {
  if (!sel) return [];
  sel.innerHTML = '';
  if (includeBlank) {
    const o0 = document.createElement('option');
    o0.value = '';
    o0.textContent = '— เลือกกล้อง —';
    sel.appendChild(o0);
  }
  const activeCams = pbCamList();
  const groupActive = document.createElement('optgroup');
  groupActive.label = 'กล้องบนหน้าจอหลัก (เปิดใช้งาน)';
  activeCams.forEach(name => {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = pbCamLabel(name);
    groupActive.appendChild(o);
  });
  sel.appendChild(groupActive);

  const extraSet = new Set([
    'nonburi1', 'nonburi2', 'nonburi4', 'nonburi5', 'nonburi6',
    'Doonsad1', 'Doonsad5', 'Doonsad6',
    'D_BPP215_1', 'D_BPP215_2', 'D_BPP215_3',
    'nongwang1', 'nongwang2', 'nongwang3', 'nongwang4', 'nongwang5',
    'nongwang6', 'nongwang7', 'nongwang8', 'nongwang9', 'nongwang10',
    'nongwang11', 'nongwang12', 'nongwang13', 'nongwang14', 'nongwang15'
  ]);
  if (Array.isArray(window._hpCatalogCameras)) {
    window._hpCatalogCameras.forEach(c => { if (c) extraSet.add(c); });
  }
  if (state.cameraNames) {
    Object.keys(state.cameraNames).forEach(c => {
      if (c && !activeCams.includes(c)) extraSet.add(c);
    });
  }
  const extraCams = Array.from(extraSet).filter(c => !activeCams.includes(c));
  if (extraCams.length > 0) {
    extraCams.sort((a, b) => {
      const aNb = /^nonburi/i.test(a) ? 0 : 1;
      const bNb = /^nonburi/i.test(b) ? 0 : 1;
      if (aNb !== bNb) return aNb - bNb;
      return a.localeCompare(b);
    });
    const groupExtra = document.createElement('optgroup');
    groupExtra.label = 'กล้องโนนบุรี & กล้องในระบบอื่นๆ';
    extraCams.forEach(name => {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = pbCamLabel(name);
      groupExtra.appendChild(o);
    });
    sel.appendChild(groupExtra);
  }
  return activeCams.concat(extraCams);
}

function openPlayback(preferredCam, preferredDate) {
  const sel = $('pbCam');
  const cams = pbPopulateCamSelect(sel, false);
  pb.cam = (preferredCam && cams.includes(preferredCam))
    ? preferredCam
    : ((cfg.channels[state.activeIdx] && cfg.channels[state.activeIdx].src) || cams[0]);
  sel.value = pb.cam;
  const now = new Date();
  const dstr = preferredDate || (now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()));
  $('pbDate').value = dstr; // hidden input — flow เดิม (pbLoadDay/pbDownload) อ่านค่านี้เหมือนเดิม
  const [sy, sm] = dstr.split('-').map(Number);
  pb.calYm = [sy || now.getFullYear(), (sm || (now.getMonth() + 1)) - 1];
  pbRenderCalButton();
  pbLoadRecDays(); // จุดแดงบนปฏิทิน (summary คืนทุกวันที่มีบันทึก — โหลดครั้งเดียวพอ)
  $('playbackOverlay').hidden = false;
  pbSetLayout(cfg.pbLayout); // สร้างจอ follower ตาม layout ที่จำไว้
  pbResetVideo(); pbLoadDay();
}
function closePlayback() {
  const v = $('pbVideo'); v.pause(); cleanupCompatJob(v); v.removeAttribute('src'); v.load();
  pb.followers.forEach(pbTeardownFollower); // กัน <video> ที่ซ่อนอยู่ดูดคลิปต่อ
  $('playbackOverlay').hidden = true;
}
function pbResetVideo() {
  const v = $('pbVideo'); v.dataset.compatTried = ''; v.pause(); cleanupCompatJob(v); v.removeAttribute('src'); v.load(); v.style.display = 'none';
  pb.winStart = pb.winEnd = 0;
  pb.followers.forEach(f => { pbTeardownFollower(f); f.winStart = f.winEnd = 0; if (f.cam) pbCellMsg(f, 'เลือกช่วงเวลาบนไทม์ไลน์'); });
  pbAllZooms().forEach(zi => zi.reset()); // เปลี่ยนวัน/กล้อง = เริ่มมุมมองใหม่ (แต่ไม่ reset ตอนเปลี่ยน chunk)
  $('pbTlWindow').hidden = true; $('pbTlPlayhead').hidden = true;
  $('pbCenter').hidden = false; $('pbSpin').hidden = true;
  $('pbCenterText').textContent = 'เลือกช่วงเวลาบนไทม์ไลน์เพื่อเล่นย้อนหลัง';
  $('pbTime').textContent = '--:-- น.'; setPbPlayUi(false);
}

async function pbLoadDay() {
  const gen = (pb.loadGen = (pb.loadGen || 0) + 1); // กันสลับกล้อง/วันแล้ว response เก่ามาทับ
  const parts = $('pbDate').value.split('-').map(Number);
  const start = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0);
  pb.dayStart = Math.floor(start.getTime() / 1000); pb.dayEnd = pb.dayStart + 86400;
  pb.zoomIdx = 0; pb.viewStart = pb.dayStart; pb.viewEnd = pb.dayEnd; // reset zoom เมื่อเปลี่ยนวัน/กล้อง
  pb.segments = []; pb.events = []; pb.evClassSel = null; // filter class ผูกกับชุด event ของวันนั้น
  $('pbTlSegments').innerHTML = '<div class="pb-tl-loading">กำลังโหลด…</div>';
  $('pbDayInfo').textContent = '';
  if (cfg.demo) { $('pbDayInfo').textContent = 'โหมดสาธิต (ไม่มีบันทึกจริง)'; pbApplyView(); return; }
  pbLoadDayEvents(); // แถบ event โหลดขนานกับ recordings (มี cache + gen guard ของตัวเอง)
  try {
    const res = await fetch(apiUrl('/api/' + encodeURIComponent(pb.cam) + '/recordings?after=' + pb.dayStart + '&before=' + pb.dayEnd), { signal: timeoutSignal(9000) });
    if (!res.ok) throw new Error();
    const segs = await res.json();
    if (gen !== pb.loadGen) return;
    pb.segments = segs;
  } catch (e) { if (gen !== pb.loadGen) return; pb.segments = []; }
  pbApplyView();
}

// event ของวันนั้น → แถบสีตามชนิดบนเลนล่างของไทม์ไลน์
// limit ต้องสูง: วันเดียวมีได้เกินพันเหตุการณ์ (วัดจริง 1,163) — default ของ API จะวาดขาด
async function pbLoadDayEvents() {
  const key = pb.cam + ':' + pb.dayStart;
  if (pb.evCache[key]) { pb.events = pb.evCache[key]; pbRenderEvents(); return; }
  const gen = (pb.evGen = (pb.evGen || 0) + 1);
  try {
    const res = await fetch(apiUrl('/api/events?camera=' + encodeURIComponent(pb.cam) + '&after=' + pb.dayStart + '&before=' + pb.dayEnd + '&limit=5000'), { signal: timeoutSignal(9000) });
    if (!res.ok) return;
    const evs = await res.json();
    if (gen !== pb.evGen) return; // สลับวัน/กล้องระหว่างรอ — ทิ้ง response เก่า
    pb.events = evs; pb.evCache[key] = evs;
  } catch (e) { return; }
  pbRenderEvents();
}

// icon ต่อ class บนแถบ event — Lucide SVGs (10x10 inline)
const ICON_OF = {
  person: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  bicycle: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>',
  car: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>',
  motorcycle: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="16" r="3"/><circle cx="19" cy="16" r="3"/><path d="M12 17h1l3-6 2 2h2"/><path d="M7 16l3-6h4"/></svg>',
  airplane: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>',
  bus: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>',
  train: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="m8 19-2 3"/><path d="m18 22-2-3"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></svg>',
  truck: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18.5" r="2.5"/><circle cx="7" cy="18.5" r="2.5"/></svg>',
  boat: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M12 10v4"/><path d="M12 2v3"/></svg>',
  bird: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 18z"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/></svg>',
  cat: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7A10 10 0 0 1 12 22a10 10 0 0 1-8-12s-1.82-6.42-.42-7c1.39-.58 4.64.26 6.42 2.26.65-.17 1.33-.26 2-.26z"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75z"/></svg>',
  dog: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5.172C10 3.782 8.423 2.679 6.5 3c-2.823.47-4.113 6.006-4 7 .08.703 1.8 1.5 3.5 1.5 1.74 0 4-1.343 4-2.828v-3.5z"/><path d="M14.267 5.172c0-1.39 1.577-2.493 3.5-2.172 2.823.47 4.113 6.006 4 7-.08.703-1.8 1.5-3.5 1.5-1.74 0-4-1.343-4-2.828v-3.5z"/><path d="M9 14v.5"/><path d="M15 14v.5"/><path d="M10 18a2 2 0 0 0 4 0"/></svg>',
  horse: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a2 2 0 0 1-2 2h-2.5a4 4 0 0 1-3.5-2l-3-5a2 2 0 0 0-1.7-1H8l-2 2-4-2 1-3 5-3h4a6 6 0 0 1 6 6v3l3 2a2 2 0 0 1 .7 1.5v.5z"/><path d="m8 11 2 9"/></svg>',
  sheep: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M10 15c.67.67 1.33 1 2 1s1.33-.33 2-1"/></svg>',
  cow: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5 3 7l2 4"/><path d="m17 5 4 2-2 4"/><rect width="14" height="12" x="5" y="8" rx="4"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M10 17h4"/></svg>',
  elephant: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="12" r="7"/><path d="M18 12h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1"/><circle cx="9" cy="10" r="1"/></svg>',
  bear: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><circle cx="5" cy="6" r="3"/><circle cx="19" cy="6" r="3"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M11 16h2"/></svg>',
  zebra: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h16"/><path d="M6 14h12"/><path d="M8 10h8"/><path d="M10 6h4"/></svg>',
  giraffe: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><path d="M12 8v13"/><path d="M9 21h6"/></svg>',
  knife: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 5 5"/></svg>',
  scissors: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/><path d="m20 4-8.58 8.58"/><path d="m8.12 15.88 3.38-3.38"/></svg>',
  backpack: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M8 21v-5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v5"/><path d="M8 10h8"/></svg>',
  handbag: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  suitcase: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  'baseball bat': '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="22" x2="22" y2="2"/></svg>',
  umbrella: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12a10.06 10.06 0 0 0-20 0Z"/><path d="M12 12v8a2 2 0 0 0 4 0"/><path d="M12 2v1"/></svg>',
  'cell phone': '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>',
  bottle: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6v3H9z"/><path d="M10 5v3a2 2 0 0 1-1 1.73l-1.5.87A3 3 0 0 0 6 13.2V20a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6.8a3 3 0 0 0-1.5-2.6L15 9.73A2 2 0 0 1 14 8V5"/></svg>',
};
function pbRenderEvents() {
  const lane = $('pbTlEvents'); if (!lane) return;
  lane.innerHTML = '';
  const nowTs = Date.now() / 1000;
  const span = pb.viewEnd - pb.viewStart;
  const laneW = lane.clientWidth || 1;
  (pb.events || []).forEach(ev => {
    if (pb.evClassSel) {
      const isPlate = !!plateOf(ev);
      const isType = pb.evClassSel.has(typeOf(ev.label));
      const hasPlateSel = pb.evClassSel.has('__plate');
      if (!isType && !(hasPlateSel && isPlate)) return;
    }
    const s = ev.start_time;
    const e = ev.end_time || Math.min(nowTs, pb.dayEnd); // event กำลังดำเนิน: end_time = null → clamp
    if (e < pb.viewStart || s > pb.viewEnd) return;
    const el = document.createElement('div');
    el.className = 'pb-tl-event';
    const m = typeMeta(ev.label);
    el.style.background = m.color;
    const wPct = Math.max(0, (Math.min(e, pb.viewEnd) - Math.max(s, pb.viewStart)) / span * 100);
    el.style.left = Math.max(0, pbT2pct(Math.max(s, pb.viewStart))) + '%';
    el.style.width = wPct + '%';
    el.title = m.label + ' — ' + fmtClock(s);
    // แถบกว้างพอ (≥14px จริง) ค่อยวาง icon — day zoom แถบบางเกิน อ่านไม่ออก
    if (wPct / 100 * laneW >= 14) {
      const ic = document.createElement('span');
      ic.className = 'pb-tl-evicon';
      ic.innerHTML = ICON_OF[typeOf(ev.label)] || '•';
      el.appendChild(ic);
    }
    el.addEventListener('click', evt => { evt.stopPropagation(); pbLoadClip(s); });
    lane.appendChild(el);
  });
}

// dropdown multi-select เลือก class ที่จะโชว์บนไทม์ไลน์ (จาก event ที่มีจริงในวันนั้น)
function pbRenderEvClassPop() {
  const pop = $('pbEvClassPop'); if (!pop) return;
  pop.innerHTML = '';
  const counts = {};
  let plateCount = 0;
  (pb.events || []).forEach(ev => { 
    const t = typeOf(ev.label); 
    counts[t] = (counts[t] || 0) + 1; 
    if (plateOf(ev)) plateCount++;
  });
  const types = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  types.unshift('__plate');
  if (!types.length) { const d = document.createElement('div'); d.className = 'pb-evclass-empty'; d.textContent = 'ไม่มีเหตุการณ์ในวันนี้'; pop.appendChild(d); return; }
  const mkRow = (key, label, checked) => {
    const row = document.createElement('label');
    row.className = 'pb-evclass-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = checked; cb.dataset.key = key;
    row.appendChild(cb);
    const sp = document.createElement('span'); sp.style.display = 'inline-flex'; sp.style.alignItems = 'center'; sp.style.gap = '6px'; sp.innerHTML = label; row.appendChild(sp);
    pop.appendChild(row);
    return cb;
  };
  const allCb = mkRow('__all', 'ทั้งหมด', !pb.evClassSel);
  allCb.addEventListener('change', () => { pb.evClassSel = null; pbRenderEvClassPop(); pbRenderEvents(); });
  types.forEach(t => {
    let labelText = '';
    if (t === '__plate') {
      labelText = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><rect width="20" height="12" x="2" y="6" rx="2"/><path d="M12 12h.01"/><path d="M17 12h.01"/><path d="M7 12h.01"/></svg> ป้ายทะเบียน (' + plateCount + ')';
    } else {
      labelText = (ICON_OF[t] ? ICON_OF[t] + ' ' : '') + typeMeta(t).label + ' (' + counts[t] + ')';
    }
    const cb = mkRow(t, labelText, !pb.evClassSel || pb.evClassSel.has(t));
    cb.addEventListener('change', () => {
      // เริ่มจาก "ทั้งหมด" → เซ็ตเป็นทุก type ก่อนแล้วค่อย toggle ตัวที่กด
      if (!pb.evClassSel) pb.evClassSel = new Set(types);
      cb.checked ? pb.evClassSel.add(t) : pb.evClassSel.delete(t);
      if (pb.evClassSel.size === types.length) pb.evClassSel = null; // ครบทุกตัว = ทั้งหมด
      pbRenderEvClassPop(); pbRenderEvents();
    });
  });
}

/* ---- zoom/pan ไทม์ไลน์ ---- */
function pbZoomLabel() {
  const s = PB_ZOOMS[pb.zoomIdx];
  return s >= 86400 ? 'ทั้งวัน' : (s >= 3600 ? (s / 3600) + ' ชม.' : (s / 60) + ' นาที');
}
// วาดไทม์ไลน์ใหม่ตาม view ปัจจุบัน + วางตำแหน่ง window/playhead ใหม่ (clamp แบบเลื่อน ไม่หด)
function pbApplyView() {
  const span = pb.viewEnd - pb.viewStart;
  if (pb.viewStart < pb.dayStart) { pb.viewStart = pb.dayStart; pb.viewEnd = pb.dayStart + span; }
  if (pb.viewEnd > pb.dayEnd) { pb.viewEnd = pb.dayEnd; pb.viewStart = pb.dayEnd - span; }
  pbRenderTimeline(pb.segments);
  if (pb.winStart) {
    const win = $('pbTlWindow');
    win.style.left = pbT2pct(pb.winStart) + '%';
    win.style.width = ((pb.winEnd - pb.winStart) / span * 100) + '%';
    pbUpdatePlayhead();
  }
  $('pbZoomInfo').textContent = pbZoomLabel();
  $('pbPanL').hidden = $('pbPanR').hidden = pb.zoomIdx === 0;
  $('pbZoomIn').disabled = pb.zoomIdx >= PB_ZOOMS.length - 1;
  $('pbZoomOut').disabled = pb.zoomIdx === 0;
}
function pbZoom(dir) {
  pb.zoomIdx = Math.max(0, Math.min(PB_ZOOMS.length - 1, pb.zoomIdx + dir));
  const span = PB_ZOOMS[pb.zoomIdx];
  // center ที่ playhead ถ้ากำลังเล่น ไม่งั้นกลาง view เดิม
  const center = pb.winStart
    ? Math.min(pb.winEnd, pb.winStart + $('pbVideo').currentTime)
    : (pb.viewStart + pb.viewEnd) / 2;
  pb.viewStart = center - span / 2; pb.viewEnd = center + span / 2;
  pbApplyView();
}
function pbPan(dir) {
  const shift = (pb.viewEnd - pb.viewStart) / 2 * dir;
  pb.viewStart += shift; pb.viewEnd += shift;
  pbApplyView();
}

/* ---- หลายจอ (follower cells) — จอหลักคือเส้นทางเดิม ไม่แตะ ----
   follower แต่ละจอ: เลือกกล้องเอง, โหลด segments ของตัวเอง (pb.recCache),
   snap+window ของตัวเอง (ตรรกะเดียวกับจอหลัก), seek ให้ตรงเวลา absolute เดียวกัน */
function pbSetLayout(n) {
  n = [1, 2, 4].includes(n) ? n : 1;
  pb.layout = n; cfg.pbLayout = n; saveCfg();
  document.querySelectorAll('.pb-layout-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.n, 10) === n));
  $('btnPbSync').hidden = n === 1;
  pbBuildFollowers();
}

function pbTeardownFollower(f) {
  if (!f || !f.video) return;
  f.video.pause(); cleanupCompatJob(f.video); f.video.removeAttribute('src'); f.video.load();
}

function pbCellMsg(f, text) {
  f.video.style.display = 'none';
  f.msgEl.hidden = false;
  f.msgEl.textContent = text;
}

// เวลา absolute ปัจจุบันของจอหลัก (0 = ยังไม่ได้เลือกช่วง) — expression เดียวกับ pbUpdatePlayhead
function pbCurrentAbs() {
  return pb.winStart ? Math.min(pb.winEnd, pb.winStart + $('pbVideo').currentTime) : 0;
}

function pbBuildFollowers() {
  pb.followers.forEach(pbTeardownFollower); // เก็บกวาดของเดิมก่อนสร้างใหม่
  pb.followers = [];
  const grid = $('pbGrid');
  grid.className = 'pb-grid layout-' + pb.layout;
  grid.querySelectorAll('.pb-cell.follower').forEach(el => el.remove());
  for (let i = 0; i < pb.layout - 1; i++) {
    const cell = document.createElement('div');
    cell.className = 'pb-cell follower';
    const v = document.createElement('video');
    v.className = 'pb-video'; v.setAttribute('playsinline', ''); v.preload = 'metadata';
    v.style.display = 'none';
    const msg = document.createElement('div');
    msg.className = 'pb-center pb-cell-msg';
    msg.textContent = 'เลือกกล้องสำหรับจอนี้';
    const sel = document.createElement('select');
    sel.className = 'pb-select pb-cell-sel';
    sel.setAttribute('aria-label', 'เลือกกล้องจอที่ ' + (i + 2));
    pbPopulateCamSelect(sel, true);
    const f = { cam: '', video: v, msgEl: msg, segs: [], gen: 0, winStart: 0, winEnd: 0 };
    f.zoom = makeVideoZoom(cell, v, { onChange: updatePbZoomUi });
    f.zoom.onApplied = pbZoomApplied;
    sel.addEventListener('change', () => { f.cam = sel.value; f.zoom.reset(); pbSyncFollower(f, pbCurrentAbs()); });
    v.addEventListener('canplay', () => { v.playbackRate = pb.speed; f.msgEl.hidden = true; v.style.display = ''; if (!$('pbVideo').paused && $('pbVideo').getAttribute('src')) v.play().catch(() => {}); });
    v.addEventListener('error', () => {
      if (!v.getAttribute('src')) return;
      if (v.dataset.compatTried !== '1' && f.cam && f.winStart && f.winEnd) {
        v.dataset.compatTried = '1';
        prepareAndPlayVideoCompat(
          { purpose: 'playback', camera: f.cam, start: Math.floor(f.winStart), end: Math.floor(f.winEnd) },
          v,
          () => { f.msgEl.hidden = true; v.style.display = ''; v.playbackRate = pb.speed; },
          () => pbCellMsg(f, 'โหลดวิดีโอจอนี้ไม่สำเร็จ')
        );
        return;
      }
      pbCellMsg(f, 'โหลดวิดีโอจอนี้ไม่สำเร็จ');
    });
    v.addEventListener('ended', () => pbCellMsg(f, 'จบช่วง — จะตามจอหลักช่วงถัดไป')); // ไม่ auto-advance เอง กัน drift
    const snapBtn = document.createElement('button');
    snapBtn.type = 'button'; snapBtn.className = 'zoom-btn pb-cell-snap'; snapBtn.title = 'บันทึกภาพนิ่งจอนี้ลง Downloads';
    snapBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';
    snapBtn.addEventListener('click', e => { e.stopPropagation(); snapVideoFrame(v, f.cam || 'cell'); });
    cell.appendChild(v); cell.appendChild(msg); cell.appendChild(sel); cell.appendChild(snapBtn);
    grid.appendChild(cell);
    pb.followers.push(f);
  }
}

// segments ของกล้อง cam ในวันปัจจุบัน — cache ต่อ cam:day
async function pbGetSegs(cam) {
  const key = cam + ':' + pb.dayStart;
  if (pb.recCache[key]) return pb.recCache[key];
  const res = await fetch(apiUrl('/api/' + encodeURIComponent(cam) + '/recordings?after=' + pb.dayStart + '&before=' + pb.dayEnd), { signal: timeoutSignal(9000) });
  if (!res.ok) throw new Error('recordings ' + res.status);
  const segs = await res.json();
  pb.recCache[key] = segs;
  return segs;
}

async function pbSyncFollower(f, absT) {
  const gen = ++f.gen; // กัน response เก่าทับ (สลับกล้อง/กด Sync รัว)
  pbTeardownFollower(f);
  f.winStart = f.winEnd = 0;
  if (!f.cam) { pbCellMsg(f, 'เลือกกล้องสำหรับจอนี้'); return; }
  if (!absT) { pbCellMsg(f, 'เลือกช่วงเวลาบนไทม์ไลน์'); return; }
  pbCellMsg(f, 'กำลังโหลด…');
  let segs;
  try { segs = await pbGetSegs(f.cam); } catch (e) { if (gen === f.gen) pbCellMsg(f, 'โหลดข้อมูลบันทึกไม่สำเร็จ'); return; }
  if (gen !== f.gen) return;
  f.segs = segs;
  const t = pbSnapToRecorded(absT, segs);
  // เล่นเฉพาะเมื่อกล้องนี้มีภาพ "ณ เวลานั้นจริง" (ยอม snap ไปหน้าไม่เกิน 60 วิ) —
  // ถ้า snap ข้ามไปไกลถือว่าไม่มีภาพ ไม่เอาคนละเวลามาหลอกว่า sync กัน
  if (t === null || t - absT > 60) { pbCellMsg(f, 'ไม่มีภาพช่วงนี้'); return; }
  const end = Math.max(t + 1, Math.min(t + pbChunkLen(f.cam), pbContiguousEnd(t, segs), pb.dayEnd));
  f.winStart = t; f.winEnd = end;
  const seekTo = Math.max(0, absT - t);
  f.video.dataset.compatTried = '';
  f.video.addEventListener('loadedmetadata', () => { if (gen === f.gen) f.video.currentTime = seekTo; }, { once: true });
  if (isIOSBrowser) {
    f.video.dataset.compatTried = '1';
    prepareAndPlayVideoCompat({ purpose: 'playback', camera: f.cam, start: Math.floor(t), end: Math.floor(end) }, f.video, () => { f.msgEl.hidden = true; f.video.style.display = ''; f.video.playbackRate = pb.speed; }, () => {});
  } else {
    f.video.src = apiUrl('/api/' + encodeURIComponent(f.cam) + '/start/' + Math.floor(t) + '/end/' + Math.floor(end) + '/clip.mp4');
    f.video.playbackRate = pb.speed;
  }
}

function pbSyncFollowers(absT) {
  pb.followers.forEach(f => { if (f.cam) pbSyncFollower(f, absT); });
}

function pbRenderTimeline(segs) {
  const segWrap = $('pbTlSegments'); segWrap.innerHTML = '';
  const lab = $('pbTlLabels'); lab.innerHTML = '';
  const span = pb.viewEnd - pb.viewStart;
  // ป้ายเวลา: ระยะห่างตามซูม (≥12h→3ชม, ≥3h→1ชม, ≥1h→10นาที, ต่ำกว่านั้น→1นาที)
  const step = span >= 43200 ? 10800 : (span >= 10800 ? 3600 : (span >= 3600 ? 600 : 60));
  // align tick กับเที่ยงคืนท้องถิ่น (dayStart) ไม่ใช่ epoch — ไม่งั้นวันเต็มจะได้ 01:00/04:00 แทน 00:00/03:00
  const firstTick = pb.dayStart + Math.ceil((pb.viewStart - pb.dayStart) / step) * step;
  for (let t = firstTick; t <= pb.viewEnd; t += step) {
    const s = document.createElement('span');
    const d = new Date(t * 1000);
    s.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    s.style.left = pbT2pct(t) + '%';
    lab.appendChild(s);
  }
  let total = 0; const blocks = [];
  segs.slice().sort((a, b) => a.start_time - b.start_time).forEach(s => {
    total += (s.end_time - s.start_time);
    const last = blocks[blocks.length - 1];
    if (last && s.start_time - last.end <= 60) last.end = Math.max(last.end, s.end_time);
    else blocks.push({ start: s.start_time, end: s.end_time });
  });
  blocks.forEach(b => {
    if (b.end < pb.viewStart || b.start > pb.viewEnd) return; // นอก view — ข้าม
    const el = document.createElement('div'); el.className = 'pb-tl-block';
    el.style.left = Math.max(0, pbT2pct(Math.max(b.start, pb.viewStart))) + '%';
    el.style.width = Math.max(0.15, (Math.min(b.end, pb.viewEnd) - Math.max(b.start, pb.viewStart)) / span * 100) + '%';
    el.title = fmtClock(b.start) + ' – ' + fmtClock(b.end);
    segWrap.appendChild(el);
  });
  const mins = Math.round(total / 60);
  $('pbDayInfo').textContent = segs.length ? ('บันทึก ~' + mins + ' นาที / ' + blocks.length + ' ช่วง') : 'ไม่มีบันทึกในวันนี้';
  $('pbTlHint').textContent = segs.length ? 'แถบม่วง = ช่วงบันทึก / แถบสีล่าง = เหตุการณ์ AI — คลิกเพื่อเล่นจากจุดนั้น' : 'เลือกวันอื่นที่มีการบันทึก';
  pbRenderEvents(); // เลน event วาดตาม view เดียวกันเสมอ
}

// segsIn (optional) — follower ส่ง segments ของกล้องตัวเอง; ไม่ส่ง = ใช้ของจอหลัก
function pbSnapToRecorded(ts, segsIn) {
  const segs = (segsIn || pb.segments).slice().sort((a, b) => a.start_time - b.start_time);
  for (const s of segs) if (ts >= s.start_time && ts <= s.end_time) return ts;
  for (const s of segs) if (s.start_time >= ts) return s.start_time; // เลื่อนไปช่วงบันทึกถัดไป
  return null;
}
// ปลายของช่วงบันทึก "ต่อเนื่อง" (ไม่มี gap เกิน 2 วิ) เริ่มจาก t — ใช้จำกัด window
// ให้ไม่คร่อม gap เพื่อให้เวลาในคลิป map กับเวลาจริงแบบ 1:1 (clip.mp4 ตัด gap ทิ้ง)
function pbContiguousEnd(t, segsIn) {
  const segs = (segsIn || pb.segments).slice().sort((a, b) => a.start_time - b.start_time);
  let end = t;
  for (const s of segs) {
    if (s.end_time <= t) continue;
    if (s.start_time <= end + 2) end = Math.max(end, s.end_time);
    else break;
  }
  return end;
}

function pbLoadClip(startTs) {
  const t = pbSnapToRecorded(startTs);
  if (t === null) { toast('ไม่มีบันทึกช่วงเวลานี้'); return; }
  // จำกัดไม่ให้ยาวเกิน chunk (ยาวขึ้นเมื่อ speed สูง) และไม่คร่อม gap → เวลาแม่นยำ
  const end = Math.max(t + 1, Math.min(t + pbChunkLen(pb.cam), pbContiguousEnd(t), pb.dayEnd));
  pb.winStart = t; pb.winEnd = end;
  const v = $('pbVideo');
  v.dataset.compatTried = '';
  $('pbCenter').hidden = false; $('pbSpin').hidden = false; $('pbCenterText').textContent = 'กำลังโหลดวิดีโอ ' + fmtClock(t) + '…';
  v.style.display = 'none';
  if (isIOSBrowser) {
    v.dataset.compatTried = '1';
    prepareAndPlayVideoCompat({ purpose: 'playback', camera: pb.cam, start: Math.floor(t), end: Math.floor(end) }, v, () => { $('pbCenter').hidden = true; $('pbSpin').hidden = true; v.style.display = ''; v.playbackRate = pb.speed; }, () => {});
  } else {
    v.src = apiUrl('/api/' + encodeURIComponent(pb.cam) + '/start/' + Math.floor(t) + '/end/' + Math.floor(end) + '/clip.mp4');
    v.playbackRate = pb.speed; v.play().catch(() => {});
  }
  const win = $('pbTlWindow'); win.hidden = false;
  win.style.left = pbT2pct(t) + '%';
  win.style.width = ((end - t) / (pb.viewEnd - pb.viewStart) * 100) + '%';
  $('pbTlPlayhead').hidden = false;
  pbSyncFollowers(t); // จอ follower ตามมาที่เวลาเดียวกัน (ต่างกล้อง ต่าง segments)
}

function pbUpdatePlayhead() {
  const v = $('pbVideo');
  if (!pb.winStart) return;
  // window ไม่คร่อม gap → เวลาในคลิป (currentTime) = เวลาจริงที่ผ่านไป (แม่นยำ)
  const abs = Math.min(pb.winEnd, pb.winStart + v.currentTime);
  // auto-follow เมื่อซูม: playhead วิ่งพ้นขอบขวาของ view → เลื่อน view ไปครึ่งช่วง
  if (pb.zoomIdx > 0 && abs > pb.viewEnd) { pbPan(1); return; } // pbApplyView จะวาด playhead ตำแหน่งใหม่ให้
  $('pbTlPlayhead').style.left = pbT2pct(abs) + '%';
  $('pbTime').textContent = fmtClock(abs) + ' น.';
}

function setPbPlayUi(playing) {
  $('pbPlay').classList.toggle('playing', playing);
  $('pbPlaySvg').style.display = playing ? 'none' : 'block';
  $('pbPauseSvg').style.display = playing ? 'block' : 'none';
}
// browser จำกัด playbackRate ที่ 0.0625–16 (เกิน = NotSupportedError ทันที) — clamp + กันพัง
function pbSafeRate(video, rate) {
  try { video.playbackRate = Math.max(0.0625, Math.min(16, rate)); } catch (e) { /* browser แปลกๆ — คงค่าเดิม */ }
}
// chunk ยาวขึ้นเมื่อเร็ว — ที่ 16× chunk 90 วิ จะ reload ทุก ~5.6 วิ → ใช้ 300 วิเมื่อ speed สูง
function pbChunkLen(camName) { if (isIOSBrowser || /^nonburi/i.test(camName || pb.cam || '')) return 60; return pb.speed >= 8 ? 300 : PB_CHUNK; }

function pbSetSpeed(rate) {
  pb.speed = rate; pbSafeRate($('pbVideo'), rate);
  pb.followers.forEach(f => { pbSafeRate(f.video, rate); }); // ทุกจอวิ่งความเร็วเดียวกัน
  document.querySelectorAll('.pb-speed').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.rate) === rate));
}
/* ---- ปฏิทินเลือกวัน (custom — จุดแดง = วันที่มีบันทึก) ----
   ใช้ hidden #pbDate เก็บ 'YYYY-MM-DD' เหมือนเดิม → pbLoadDay/pbDownload ไม่ต้องแก้
   จุดแดงจาก /recordings/summary?timezone=<local> — default เป็น UTC ซึ่งจะวางวันผิด
   สำหรับบันทึกช่วง 00:00-07:00 ไทย จึงต้องส่ง timezone เสมอ */
async function pbLoadRecDays() {
  pb.recDays = new Set();
  if (cfg.demo) { pbRenderCal(); return; }
  const targetCam = pb.cam;
  try {
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Asia/Bangkok';
    const res = await fetch(apiUrl('/api/' + encodeURIComponent(targetCam) + '/recordings/summary?timezone=' + encodeURIComponent(tz)), { signal: timeoutSignal(9000) });
    if (res.ok) (await res.json()).forEach(d => { if (d && d.day) pb.recDays.add(d.day); });
  } catch (e) { /* ไม่มี summary — ปฏิทินยังใช้ได้ แค่ไม่มีจุด */ }
  if (pb.cam !== targetCam) return;
  const curDay = $('pbDate').value;
  if (pb.recDays.size > 0 && !pb.recDays.has(curDay)) {
    const latestDay = Array.from(pb.recDays).sort().pop();
    if (latestDay) {
      $('pbDate').value = latestDay;
      const [sy, sm] = pbSelectedYmd();
      pb.calYm = [sy, sm - 1];
      pbRenderCalButton();
      pbRenderCal();
      pbResetVideo();
      pbLoadDay();
      toast('📅 เลื่อนไปยังวันที่มีบันทึกย้อนหลังล่าสุด (' + $('btnPbCal').textContent + ')');
      return;
    }
  }
  pbRenderCal();
}
function pbSelectedYmd() { return ($('pbDate').value || '').split('-').map(Number); }
function pbRenderCalButton() {
  const [y, m, d] = pbSelectedYmd();
  $('btnPbCal').textContent = new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}
function pbRenderCal() {
  const grid = $('pbCalGrid'); if (!grid) return;
  grid.innerHTML = '';
  if (!pb.calYm) { const [sy, sm] = pbSelectedYmd(); pb.calYm = [sy, sm - 1]; }
  const y = pb.calYm[0], m0 = pb.calYm[1];
  $('pbCalTitle').textContent = new Date(y, m0, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
  const firstDow = new Date(y, m0, 1).getDay(); // 0 = อาทิตย์
  const days = new Date(y, m0 + 1, 0).getDate();
  const now = new Date();
  const todayYmd = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  for (let i = 0; i < firstDow; i++) grid.appendChild(document.createElement('span'));
  for (let d = 1; d <= days; d++) {
    const ymd = y + '-' + pad2(m0 + 1) + '-' + pad2(d);
    const b = document.createElement('button');
    b.type = 'button';
    // เทียบ day string ตรงๆ (zero-padded เรียงตามตัวอักษร = เรียงตามเวลา) — ห้ามใช้
    // new Date('YYYY-MM-DD') เพราะ parse เป็น UTC แล้ววันจะเพี้ยน
    b.className = 'pb-cal-day' + (ymd === $('pbDate').value ? ' sel' : '') + (pb.recDays && pb.recDays.has(ymd) ? ' rec' : '');
    b.disabled = ymd > todayYmd; // วันอนาคตเลือกไม่ได้
    b.textContent = d;
    b.addEventListener('click', () => {
      $('pbDate').value = ymd;
      pbRenderCalButton(); pbCalClose();
      pbResetVideo(); pbLoadDay();
    });
    grid.appendChild(b);
  }
}
function pbCalClose() { $('pbCalPop').hidden = true; $('btnPbCal').setAttribute('aria-expanded', 'false'); }

function pbDownload() {
  if (cfg.demo || !pb.winStart) { toast('เลือกช่วงเวลาบนไทม์ไลน์ก่อน'); return; }
  const fname = pb.cam + '_' + $('pbDate').value + '_' + fmtClock(pb.winStart).replace(/:/g, '') + '.mp4';
  const a = document.createElement('a');
  a.href = apiUrl('/api/' + encodeURIComponent(pb.cam) + '/start/' + Math.floor(pb.winStart) + '/end/' + Math.floor(pb.winEnd) + '/clip.mp4');
  a.download = fname; document.body.appendChild(a); a.click(); a.remove();
  toast('กำลังบันทึกช่วง ' + fmtClock(pb.winStart) + ' — ' + fmtClock(pb.winEnd));
}

/* ============ settings modal ============ */
function openSettings() {
  state.selCh = Math.min(state.activeIdx, MAX_CH - 1);
  state.dirty = {}; state.connDirty = false; state.storageDirty = false;
  state.frigateCams = null; state.objDirty = {};

  // ADR-0021: Bidirectional Personal Grid Synchronization in Settings
  // Tab 2 always initializes with the user's active screen channels (cfg.channels)
  // so any operator/admin can immediately toggle AI, LPR, or visibility for active feeds.
  state.draft = cfg.channels.map(c => ({ ...c }));
  state.impersonatingUser = ''; // draft above is always the viewer's own grid

  // Update Tab 2 banner text & controls according to role
  const isSuperAdmin = ['admin', 'superadmin'].includes(userRole) || ['arm215', 'suchakree', 'bpp215'].includes((window.bppSession && window.bppSession.username) || '');
  const isAdminOrSuper = ['admin', 'superadmin'].includes(userRole);

  // Incident 2.45: Role-based tab visibility in Settings modal.
  // Tab 1 (NVR กล้องในระบบ): admin/superadmin only — prevents regular users from deleting cameras.
  // Tab 2 (Dashboard จัดช่องจอ): ALL roles — users need this to toggle AI, LPR, visibility.
  // Tab 3 (LPR Learning): superadmin only — critical ML training operations.
  // Tab 4 (การแจ้งเตือน): ALL roles — every user configures their own Telegram alerts.
  if ($('btnTabNvr')) { $('btnTabNvr').style.display = isAdminOrSuper ? '' : 'none'; }
  if ($('btnTabLprLearning')) { $('btnTabLprLearning').style.display = isSuperAdmin ? '' : 'none'; }
  if ($('btnTabSystemUpdate')) { $('btnTabSystemUpdate').style.display = isAdminOrSuper ? 'inline-flex' : 'none'; }

  // Admin Profile Impersonation (Incident 2.52)
  if (isAdminOrSuper && $('impersonateDropdownWrap')) {
    $('impersonateDropdownWrap').style.display = 'inline-block';
    
    const populateDropdown = (profiles) => {
      const menu = $('impersonateDropdownMenu');
      const txt = $('txtImpersonateSelected');
      menu.innerHTML = '';
      
      // Default option
      const optDefault = document.createElement('div');
      optDefault.className = 'custom-dropdown-item';
      optDefault.style.padding = '8px 12px'; optDefault.style.cursor = 'pointer'; optDefault.style.borderBottom = '1px solid var(--border-color)';
      optDefault.textContent = '-- หน้าจอของคุณ --';
      optDefault.onclick = () => selectImpersonateUser('');
      menu.appendChild(optDefault);

      Object.keys(profiles).sort().forEach(u => {
        if (u !== (window.bppSession?.username || '')) {
          const profile = profiles[u];
          const disabledSet = new Set((profile && profile.disabled_ai_cameras) || []);
          let activeCams = 0;
          let aiCams = 0;
          const chArr = (profile && Array.isArray(profile.channels) && profile.channels.length)
            ? profile.channels
            : ((profile && Array.isArray(profile.active_channels)) ? profile.active_channels : []);
          if (chArr.length) {
             activeCams = chArr.filter(c => c && c.src && c.enabled !== false).length;
             aiCams = chArr.filter(c => c && c.src && c.enabled !== false && c.detect === true && !disabledSet.has(c.src)).length;
          }

          const opt = document.createElement('div');
          opt.className = 'custom-dropdown-item';
          opt.style.padding = '8px 12px'; opt.style.cursor = 'pointer'; opt.style.borderBottom = '1px solid var(--border-color)';
          opt.style.display = 'flex'; opt.style.justifyContent = 'space-between'; opt.style.alignItems = 'center';

          const nameSpan = document.createElement('span');
          if (window.bppAccountLabel) nameSpan.innerHTML = window.bppAccountLabel.labelHtml(u, 22);
          else nameSpan.textContent = u;
          opt.appendChild(nameSpan);

          const badgeSpan = document.createElement('span');
          badgeSpan.style.fontSize = '10px'; badgeSpan.style.color = '#aaa';
          badgeSpan.textContent = `📷 ${activeCams} | 🤖 ${aiCams}`;
          opt.appendChild(badgeSpan);

          opt.onclick = () => selectImpersonateUser(u);
          menu.appendChild(opt);
        }
      });
      txt.textContent = state.impersonatingUser ? (window.bppAccountLabel ? window.bppAccountLabel.text(state.impersonatingUser) : state.impersonatingUser) : '-- หน้าจอของคุณ --';
    };

    if (state.allUserProfilesCache) {
      populateDropdown(state.allUserProfilesCache);
    }
    fetch('/api/nas-bot/admin/user-profiles', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.profiles) {
          state.allUserProfilesCache = data.profiles;
          populateDropdown(state.allUserProfilesCache);
        }
      }).catch(e => console.warn('Failed to load user profiles', e));
  }

  // For non-admin users: default to Tab 2 (Dashboard) since Tab 1 is hidden
  if (!isAdminOrSuper) {
    if ($('tabNvr')) $('tabNvr').style.display = 'none';
    if ($('tabDash')) $('tabDash').style.display = 'flex';
    if ($('tabLprLearning')) $('tabLprLearning').style.display = 'none';
    if ($('tabMyAlerts')) $('tabMyAlerts').style.display = 'none';
    if ($('tabSystemUpdate')) $('tabSystemUpdate').style.display = 'none';
    if ($('btnTabDash')) {
      $('btnTabDash').style.borderBottomColor = '#a855f7';
      $('btnTabDash').style.color = '#fff';
    }
    if ($('btnTabMyAlerts')) {
      $('btnTabMyAlerts').style.borderBottomColor = 'transparent';
      $('btnTabMyAlerts').style.color = '#9aa0bd';
    }
  }
  if ($('lblPropagateMaster')) $('lblPropagateMaster').style.display = isSuperAdmin ? 'inline-flex' : 'none';
  if ($('btnLoadMasterToDraft')) $('btnLoadMasterToDraft').style.display = isSuperAdmin ? 'inline-flex' : 'none';
  if ($('btnCopyCurrentToMaster')) $('btnCopyCurrentToMaster').style.display = isSuperAdmin ? 'inline-flex' : 'none';
  if ($('chkPropagateMaster')) $('chkPropagateMaster').checked = false;
  updateKillSwitchUi();
  if ($('txtGridBannerTitle')) $('txtGridBannerTitle').textContent = 'ผังหน้าจอของคุณ (Personal Screen Grid)';
  if ($('tagGridBanner')) {
    $('tagGridBanner').textContent = 'ผังหน้าจอ';
    $('tagGridBanner').style.background = 'rgba(168,85,247,0.2)';
    $('tagGridBanner').style.color = '#c084fc';
  }
  $('inpBase').value = cfg.base;
  $('inpApi').value = cfg.api;
  $('inpDemo').checked = cfg.demo;
  loadNvrCameras();
  loadWebRtcIp();
  renderChList(); renderChForm(); renderSyncMsg();
  const overlay = $('settingsOverlay');
  if (overlay) {
    overlay.style.removeProperty('display');
    overlay.hidden = false;
  }
  $('btnSettings').setAttribute('aria-pressed', 'true');
  pingNvr();
  loadStorageThreshold();
  loadLprSettings(); // สถานะเปิด LPR รายกล้อง + โซนจับป้าย (ไฟล์ runtime — ดู section LPR)
  loadLprLearningStatus();
  loadFrigateObjects(); // โหลดกล้อง+object จริงจาก Frigate → เติม grid
  loadMyAlertsSettings(); // โหลดการตั้งค่าการแจ้งเตือนส่วนตัว
}

async function loadLprLearningStatus() {
  const summary = $('lprLearningSummary'), modelsBox = $('lprModelVersions');
  if (!summary || !['admin', 'superadmin'].includes(userRole)) return;
  summary.textContent = 'กำลังโหลดสถานะ…';
  try {
    const responses = await Promise.all([
      fetch('/api/watchlist/lpr/learning/settings', { cache: 'no-store' }),
      fetch('/api/watchlist/lpr/learning/jobs', { cache: 'no-store' }),
      fetch('/api/watchlist/lpr/learning/models', { cache: 'no-store' }),
      fetch('/api/watchlist/lpr/dataset', { cache: 'no-store' }),
      fetch('/api/watchlist/lpr/review-queue?state=pending', { cache: 'no-store' }),
    ]);
    if (responses.some(response => !response.ok)) throw new Error('โหลดสถานะไม่สำเร็จ');
    const values = await Promise.all(responses.map(response => response.json()));
    const settings = values[0], jobs = values[1], models = values[2], samples = values[3], pending = values[4];
    const minimum = Number(settings.min_new_samples && settings.min_new_samples.value) || 500;
    const unused = samples.filter(sample => sample.approved && !sample.used_model_version).length;
    const latestJob = jobs[0];
    const isJobActive = latestJob && ['queued', 'running'].includes(latestJob.state);
    const jobText = latestJob
      ? `งานล่าสุด #${latestJob.id}: ${latestJob.state} (${Math.round((latestJob.progress || 0) * 100)}%) ${escapeHtml(latestJob.detail || '')}`
      : 'ยังไม่มีงานฝึก';
    const queueSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:5px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';
    const targetSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:5px;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>';
    const gearSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:5px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
    summary.innerHTML = `<div style="line-height:1.6;">
      <div>${queueSvg}<b>รอตรวจโดยคน:</b> ${pending.length} รายการ</div>
      <div>${targetSvg}<b>ตัวอย่างพร้อมฝึก (ยังไม่เคยใช้):</b> <span style="color:#22c55e;font-weight:bold;">${unused}</span> / ${minimum} ตัวอย่าง</div>
      <div style="margin-top:4px;color:${isJobActive ? '#38bdf8' : '#94a3b8'};">${gearSvg}<b>สถานะงานฝึก:</b> ${jobText}</div>
    </div>`;
    $('inpLprMinSamples').value = minimum;
    $('inpLprMinSamples').disabled = userRole !== 'superadmin';
    $('btnSaveLprMinSamples').hidden = userRole !== 'superadmin';
    const btnTrain = $('btnTriggerLprTrainNow');
    if (btnTrain) {
      btnTrain.hidden = !['admin', 'superadmin'].includes(userRole);
      btnTrain.disabled = isJobActive;
      const zapSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
      btnTrain.innerHTML = isJobActive ? `กำลังเทรน (${Math.round((latestJob.progress || 0) * 100)}%)…` : zapSvg + 'สั่งเทรนโมเดลทันที';
    }
    $('lprLearningPermission').textContent = userRole === 'superadmin'
      ? 'ผู้ดูแลระบบระดับสูงสามารถปรับเกณฑ์ สั่งเทรนโมเดล และย้อนกลับโมเดลได้'
      : 'ดูสถานะได้ การปรับเกณฑ์และย้อนกลับสงวนให้ผู้ดูแลระบบระดับสูง arm215';
    modelsBox.replaceChildren();
    if (!models.length) {
      modelsBox.textContent = 'ยังไม่มีรุ่นที่ฝึกจากข้อมูลยืนยัน — ระบบเดิมยังทำงานเป็นรุ่นตั้งต้น';
    } else {
      models.forEach(model => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:7px;';
        const label = document.createElement('span');
        label.style.flex = '1';
        const isActive = model.state === 'active';
        label.innerHTML = `<b style="color:${isActive ? '#22c55e' : '#cbd5e1'};">${escapeHtml(model.version_id)}</b> — <span style="color:${isActive ? '#22c55e' : '#94a3b8'};">${escapeHtml(model.state)}</span>`;
        row.appendChild(label);
        if (userRole === 'superadmin' && model.state === 'rolled_back') {
          const rollback = document.createElement('button');
          rollback.type = 'button';
          rollback.className = 'btn-ghost';
          rollback.textContent = 'ย้อนกลับรุ่นนี้';
          rollback.addEventListener('click', () => rollbackLprModel(model.version_id));
          row.appendChild(rollback);
        }
        modelsBox.appendChild(row);
      });
    }
    // Auto refresh while job is running
    if (isJobActive && !state._lprTrainTimer) {
      state._lprTrainTimer = setTimeout(() => {
        state._lprTrainTimer = null;
        if ($('tabLprLearning') && $('tabLprLearning').style.display !== 'none') {
          loadLprLearningStatus();
        }
      }, 3000);
    }
  } catch (_error) {
    summary.textContent = 'โหลดสถานะการเรียนรู้ไม่สำเร็จ — ลองรีเฟรชอีกครั้ง';
  }
}

async function triggerLprTrainingNow() {
  if (!['admin', 'superadmin'].includes(userRole)) return;
  if (!await window.bppConfirm('ยืนยันสั่งเทรนและอัปเกรดโมเดล AI LPR ทันทีจากชุดข้อมูลตัวอย่างที่สอนไว้ทั้งหมดหรือไม่?')) return;
  const btn = $('btnTriggerLprTrainNow');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังส่งคำสั่งเทรน…'; }
  try {
    const response = await fetch('/api/watchlist/lpr/learning/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ detail: 'manual_training_upgrade' }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      toast(err.detail || 'สั่งเทรนโมเดลไม่สำเร็จ');
      return;
    }
    const data = await response.json();
    toast(`เริ่มคิวเทรนและอัปเกรด AI แล้ว (Job #${data.job_id} จาก ${data.sample_count} ตัวอย่าง)`);
    loadLprLearningStatus();
  } catch (err) {
    toast('เกิดข้อผิดพลาดในการสั่งเทรนโมเดล');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function saveLprLearningThreshold() {
  if (userRole !== 'superadmin') return;
  const value = Number($('inpLprMinSamples').value);
  if (!Number.isInteger(value) || value < 50 || value > 100000) {
    toast('เกณฑ์ต้องเป็นจำนวนเต็มตั้งแต่ 50 ถึง 100,000');
    return;
  }
  const response = await fetch('/api/watchlist/lpr/learning/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ min_new_samples: value }),
  });
  if (!response.ok) { toast('บันทึกเกณฑ์ไม่สำเร็จ'); return; }
  toast('บันทึกเกณฑ์เริ่มฝึกอัตโนมัติแล้ว');
  loadLprLearningStatus();
}

async function rollbackLprModel(versionId) {
  if (userRole !== 'superadmin') return;
  if (!await window.bppConfirm(`ยืนยันย้อนกลับไปใช้โมเดล ${versionId} หรือไม่`)) return;
  const response = await fetch('/api/watchlist/lpr/learning/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version_id: versionId }),
  });
  if (!response.ok) { toast('ส่งคำขอย้อนกลับโมเดลไม่สำเร็จ'); return; }
  toast('เข้าคิวย้อนกลับโมเดลแล้ว');
  loadLprLearningStatus();
}

/* เพดานพื้นที่ว่างขั้นต่ำของดิสก์ (%) — เก็บเป็นไฟล์ฝั่งเซิร์ฟเวอร์ผ่าน endpoint
   /settings/storage_threshold ของ nginx (dashboard) แล้ว Frigate อ่านเองทุกรอบเช็ค
   (≤5 นาที) — ใช้ได้เฉพาะเมื่อเปิดผ่านหน้าเว็บ dashboard เท่านั้น (same-origin) */
const STORAGE_MIN = 5, STORAGE_MAX = 90;
async function loadStorageThreshold() {
  const inp = $('inpStorageMin'), hint = $('storageHint');
  if (!SAME_ORIGIN) {
    inp.disabled = true;
    hint.textContent = 'ตั้งค่าได้เมื่อเปิดผ่านหน้าเว็บ dashboard (พอร์ต 8080) เท่านั้น';
    return;
  }
  inp.disabled = false;
  try {
    const res = await fetch('/settings/storage_threshold', { signal: timeoutSignal(5000), cache: 'no-store' });
    // ถ้าผู้ใช้เริ่มพิมพ์ค่าใหม่ไปแล้วระหว่างรอ GET — อย่าทับค่าที่กำลังพิมพ์
    if (res.ok) {
      const v = parseFloat((await res.text()).trim());
      if (!Number.isNaN(v) && !state.storageDirty) inp.value = v;
    } else if (!state.storageDirty) {
      inp.value = ''; // ยังไม่เคยตั้งจากหน้านี้ → ระบบใช้ค่าจาก .env หรือ default 15
    }
  } catch (e) { /* อ่านไม่ได้ — ปล่อยว่างให้เห็น placeholder (default 15) */ }
  // แสดงพื้นที่ว่างจริงตอนนี้ประกอบการตัดสินใจ (best-effort — พังก็ไม่เป็นไร)
  if (!cfg.demo) {
    try {
      const res = await fetch(apiUrl('/api/stats'), { signal: timeoutSignal(5000) });
      // จงใจไม่ใช้ optional chaining — kiosk/จอเก่าบางตัวเป็นเบราว์เซอร์ก่อน Chrome 80
      // (?. เป็น SyntaxError ตอน parse จะพาให้ทั้งไฟล์ตาย ไม่ใช่แค่ฟีเจอร์นี้)
      const data = await res.json();
      const svc = data && data.service;
      const st = svc && svc.storage && svc.storage['/media/frigate/recordings'];
      if (st && st.total) {
        const freePct = Math.round((st.free / st.total) * 100);
        hint.textContent = `ระบบจะลบวิดีโอเก่าสุดอัตโนมัติเมื่อพื้นที่ว่างต่ำกว่าค่านี้ (${STORAGE_MIN}–${STORAGE_MAX}) — ตอนนี้ดิสก์ว่าง ${freePct}%`;
      }
    } catch (e) { /* คงข้อความ hint เดิม */ }
  }
}
function saveStorageThreshold() {
  if (!state.storageDirty || !SAME_ORIGIN) return;
  const raw = parseFloat($('inpStorageMin').value);
  if (Number.isNaN(raw)) { state.storageDirty = false; return; } // ค่าว่าง = ไม่เปลี่ยนแปลง
  const v = Math.min(STORAGE_MAX, Math.max(STORAGE_MIN, raw));
  fetch('/settings/storage_threshold', { method: 'PUT', body: String(v), signal: timeoutSignal(8000) })
    .then(res => {
      if (!res.ok) throw new Error();
      state.storageDirty = false;
      $('inpStorageMin').value = v; // โชว์ค่าหลัง clamp ให้ตรงกับที่บันทึกจริง
      renderSyncMsg();
    })
    .catch(() => toast('บันทึกเพดานพื้นที่ว่างไม่สำเร็จ — ลองใหม่อีกครั้ง'));
}
function closeSettings() {
  const overlay = $('settingsOverlay');
  if (overlay) {
    overlay.hidden = true;
    overlay.style.setProperty('display', 'none', 'important');
  }
  const btn = $('btnSettings');
  if (btn) btn.setAttribute('aria-pressed', 'false');
}

/* ============ LPR: เปิดรายกล้อง + โซนจับป้าย (ไฟล์ runtime ผ่าน nginx PUT) ============ */
// GET/PUT /settings/lpr_cameras (text บรรทัดละชื่อกล้อง) + /settings/lpr_zones (JSON
// {"cam":[x,y,w,h] normalized}) — lpr-service hot-reload ทั้งคู่ทุก ≤60 วิ ไม่มี restart
// (pattern เดียวกับ storage_threshold: nginx dav PUT, same-origin, ไม่ต้องมี CSRF header)

// โหลดสถานะ LPR ทั้งสองไฟล์ตอนเปิด settings — โหลดพังให้ปุ่มซ่อน (ไม่เดาสถานะมั่ว)
async function loadLprSettings() {
  state.lprDirty = false;
  if (cfg.demo || !SAME_ORIGIN) { state.lprCams = null; state.lprZones = {}; state.objectAlerts = {}; return; }
  try {
    const res = await fetch('/settings/lpr_cameras', { cache: 'no-store' });
    if (res.ok) {
      const txt = await res.text();
      state.lprCams = new Set(txt.split(/\r?\n/).map(s => s.split('#')[0].trim()).filter(Boolean));
    } else if (res.status === 404) {
      state.lprCams = new Set(['cam11']);
    } else { state.lprCams = null; }
  } catch (e) { state.lprCams = null; }
  try {
    const res = await fetch('/settings/lpr_zones', { cache: 'no-store' });
    state.lprZones = res.ok ? ((await res.json()) || {}) : {};
  } catch (e) { state.lprZones = {}; }
  try {
    const res = await fetch('/settings/object_alerts', { cache: 'no-store' });
    state.objectAlerts = res.ok ? ((await res.json()) || {}) : {};
  } catch (e) { state.objectAlerts = {}; }
  try {
    const res = await fetch('/api/watchlist/faces/cameras', { cache: 'no-store' });
    if (res.ok) {
      const fcfg = await res.json();
      state.disabledFaceCams = new Set(Array.isArray(fcfg.disabled_cameras) ? fcfg.disabled_cameras : []);
    } else {
      state.disabledFaceCams = new Set();
    }
  } catch (e) { state.disabledFaceCams = new Set(); }
  renderChForm();
}


let pairPollTimer = null;
async function requestTelegramPairCode(targetUsername) {
  const curUser = (window.bppSession && window.bppSession.username) || '';
  const uname = targetUsername || state.alertTargetUser || curUser || 'admin';
  
  const box = document.getElementById('boxPairCodeDisplay');
  const valCode = document.getElementById('valPairCode');
  const txtSample = document.getElementById('txtPairSample');
  const stWaiting = document.getElementById('stPairWaiting');
  
  if (valCode) valCode.textContent = '...';
  if (box) box.style.display = 'block';
  
  try {
    const res = await fetch('/api/nas-bot/pair/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uname })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const code = data.pairing_code;
    
    if (valCode) valCode.textContent = code;
    if (txtSample) txtSample.textContent = code;
    if (stWaiting) stWaiting.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin" style="vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>กำลังรอการยืนยันจาก Telegram สำหรับบัญชี ' + escapeHtml(uname) + ' (รหัสหมดอายุใน 10 นาที)…';
    
    // Start polling to detect successful pairing
    if (pairPollTimer) clearInterval(pairPollTimer);
    pairPollTimer = setInterval(async () => {
      try {
        const checkUrl = targetUsername 
          ? '/api/nas-bot/admin/subscriptions/' + encodeURIComponent(uname) + '/cameras?t=' + Date.now()
          : '/api/nas-bot/subscriptions/me?t=' + Date.now();
        const chkRes = await fetch(checkUrl, { cache: 'no-store' });
        if (chkRes.ok) {
          const chkData = await chkRes.json();
          if (chkData.is_paired || (chkData.pairings && chkData.pairings.length > 0)) {
            clearInterval(pairPollTimer);
            pairPollTimer = null;
            if (stWaiting) {
              stWaiting.innerHTML = '<b style="color:#10b981;display:inline-flex;align-items:center;gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>ผูกบัญชี Telegram สำเร็จเรียบร้อยแล้ว!</b>';
            }
            if (window.bppToast) window.bppToast('ผูกบัญชี Telegram สำหรับ ' + uname + ' สำเร็จแล้ว');
            setTimeout(() => {
              if (box) box.style.display = 'none';
              loadMyAlertsSettings();
            }, 2500);
          }
        }
      } catch (e) {}
    }, 3000);
    
  } catch (e) {
    if (stWaiting) stWaiting.innerHTML = '<span style="color:#fb5b78;display:inline-flex;align-items:center;gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fb5b78" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>ไม่สามารถขอรหัสผูกบัญชีได้: ' + escapeHtml(e.message) + '</span>';
  }
}

async function loadMyAlertsSettings() {
  state.myAlertsLoaded = false;
  state.myAlertsDirty = false;
  const targetUser = state.alertTargetUser || '';
  const url = targetUser 
    ? '/api/nas-bot/admin/subscriptions/' + encodeURIComponent(targetUser) + '/cameras'
    : '/api/nas-bot/subscriptions/me';

  renderMyAlertsMatrix();
  
  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.mySubscription = data.subscription || {};
    state.myAlertsLoaded = true;
    
    const pEl = document.getElementById('stMyTelegramPair');
    const bName = data.bot_username || '@Sloth_bpp215bot';
    if (pEl) {
      if (data.is_paired || (data.pairings && data.pairings.length > 0)) {
        const okDot = '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981; margin-right:6px; vertical-align:middle;"></span>';
        const pairInfo = targetUser ? ('บัญชี ' + escapeHtml(targetUser) + ' ผูก Telegram แล้ว') : ('ผูกบัญชีแล้ว (' + escapeHtml(bName) + ')');
        pEl.innerHTML = okDot + pairInfo;
        pEl.style.background = 'rgba(16, 185, 129, 0.15)';
        pEl.style.color = '#10b981';
      } else {
        const redDot = '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ef4444; margin-right:6px; vertical-align:middle;"></span>';
        const pairInfo = targetUser ? ('บัญชี ' + escapeHtml(targetUser) + ' ยังไม่ได้ผูก Telegram') : 'ยังไม่ได้ผูก Telegram';
        pEl.innerHTML = redDot + pairInfo;
        pEl.style.background = 'rgba(239, 68, 68, 0.15)';
        pEl.style.color = '#ef4444';
      }
    }
    
    initAll24hSelects();
    const myStart = state.mySubscription.schedule_start || '00:00';
    const myEnd = state.mySubscription.schedule_end || '23:59';
    const [mshRaw, msmRaw] = String(myStart).split(':');
    const [mehRaw, memRaw] = String(myEnd).split(':');
    const mshPadded = String(mshRaw || '00').padStart(2, '0');
    const msmPadded = String(msmRaw || '00').padStart(2, '0');
    const mehPadded = String(mehRaw || '23').padStart(2, '0');
    const memPadded = String(memRaw || '59').padStart(2, '0');

    if (document.getElementById('selMySchedStartH')) document.getElementById('selMySchedStartH').value = mshPadded;
    if (document.getElementById('selMySchedStartM')) document.getElementById('selMySchedStartM').value = msmPadded;
    if (document.getElementById('selMySchedEndH')) document.getElementById('selMySchedEndH').value = mehPadded;
    if (document.getElementById('selMySchedEndM')) document.getElementById('selMySchedEndM').value = memPadded;
    if (document.getElementById('inpMyScheduleStart')) document.getElementById('inpMyScheduleStart').value = `${mshPadded}:${msmPadded}`;
    if (document.getElementById('inpMyScheduleEnd')) document.getElementById('inpMyScheduleEnd').value = `${mehPadded}:${memPadded}`;

    const syncMySchedFromSelects = () => {
      const sh = (document.getElementById('selMySchedStartH')?.value || '00').padStart(2, '0');
      const sm = (document.getElementById('selMySchedStartM')?.value || '00').padStart(2, '0');
      const eh = (document.getElementById('selMySchedEndH')?.value || '23').padStart(2, '0');
      const em = (document.getElementById('selMySchedEndM')?.value || '59').padStart(2, '0');
      if (document.getElementById('inpMyScheduleStart')) document.getElementById('inpMyScheduleStart').value = `${sh}:${sm}`;
      if (document.getElementById('inpMyScheduleEnd')) document.getElementById('inpMyScheduleEnd').value = `${eh}:${em}`;
      state.myAlertsDirty = true;
    };

    ['selMySchedStartH', 'selMySchedStartM', 'selMySchedEndH', 'selMySchedEndM'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el._dirtyWired) {
        el._dirtyWired = true;
        el.addEventListener('change', syncMySchedFromSelects);
      }
    });

    ['chkMyMasterAlert', 'chkMyScheduleAlert', 'chkAdminBroadcast'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el._dirtyWired) {
        el._dirtyWired = true;
        el.addEventListener('change', () => { state.myAlertsDirty = true; });
      }
    });

    if (document.getElementById('chkMyMasterAlert')) document.getElementById('chkMyMasterAlert').checked = (state.mySubscription.master_enabled === true);
    if (document.getElementById('chkMyScheduleAlert')) document.getElementById('chkMyScheduleAlert').checked = (state.mySubscription.schedule_enabled === true);
    
    const curUser = (window.bppSession && window.bppSession.username) || data.username || '';
    const curRole = (window.bppSession && window.bppSession.role) || data.role || (typeof userRole !== 'undefined' ? userRole : '') || '';
    const isSuperAdmin = (curRole === 'superadmin' || curRole === 'admin') || ['arm215', 'suchakree', 'bpp215'].includes(curUser);
    
    const box = document.getElementById('boxAdminBroadcast');
    if (box) {
      box.hidden = !isSuperAdmin;
      box.style.display = isSuperAdmin ? 'block' : 'none';
    }

    const wrapSelector = document.getElementById('wrapAlertTargetUser');
    if (wrapSelector) {
      wrapSelector.style.display = isSuperAdmin ? 'flex' : 'none';
    }
    
    if (isSuperAdmin && !targetUser) {
      if (document.getElementById('chkAdminBroadcast')) document.getElementById('chkAdminBroadcast').checked = !!state.mySubscription.broadcast_to_all;
      loadAdminUserAlerts();
    }
    
    renderMyAlertsMatrix();
  } catch (e) {
    // Keep rendered matrix visible
  }
}

async function loadAdminUserAlerts() {
  const container = document.getElementById('adminUserAlertsList');
  if (!container) return;
  const accText = (name) => (window.bppAccountLabel ? window.bppAccountLabel.text(name) : String(name || ''));
  if (window.bppAccountLabel) { await window.bppAccountLabel.load(); }
  
  try {
    const [res, presRes] = await Promise.all([
      fetch('/api/nas-bot/admin/subscriptions?t=' + Date.now(), { cache: 'no-store' }),
      fetch('/auth/presence?t=' + Date.now(), { cache: 'no-store' }).catch(() => null)
    ]);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const users = data.users || [];

    const presences = (presRes && presRes.ok) ? (await presRes.json()) : [];
    const presenceMap = {};
    if (Array.isArray(presences)) {
      presences.forEach(p => {
        presenceMap[p.username] = p;
      });
    }
    
    const countBadge = document.getElementById('badgeAdminUserCount');
    if (countBadge) countBadge.textContent = users.length + ' บัญชี';
    
    if (!users.length) {
      container.innerHTML = '<div class="field-hint" style="color:#94a3b8; padding:6px 0;">ไม่พบรายชื่อผู้ใช้งาน</div>';
      return;
    }
    
    const selTarget = document.getElementById('selAlertTargetUser');
    if (selTarget) {
      const myUsername = (window.bppSession && window.bppSession.username) || 'ฉัน';
      const curVal = state.alertTargetUser || '';
      selTarget.innerHTML = '<option value="">บัญชีของฉัน (' + escapeHtml(myUsername) + ')</option>' +
        users.map(u => '<option value="' + escapeHtml(u.username) + '" ' + (curVal === u.username ? 'selected' : '') + '>' + escapeHtml(accText(u.username)) + (u.is_paired ? ' (ผูกแล้ว)' : ' (ยังไม่ผูก)') + '</option>').join('');
    }

    container.innerHTML = '';
    users.forEach(u => {
      const row = document.createElement('div');
      row.className = 'admin-user-row';
      row.style.cssText = 'display:flex; flex-direction:column; gap:8px; background:rgba(0,0,0,0.25); padding:10px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06); width:100%; box-sizing:border-box;';
      
      const topLine = document.createElement('div');
      topLine.className = 'admin-user-top-line';
      topLine.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%;';
      
      const left = document.createElement('div');
      left.style.cssText = 'display:flex; align-items:center; gap:8px; min-width:0; flex:1;';
      
      const icon = window.bppAccountLabel
        ? window.bppAccountLabel.avatarHtml(u.username, 28)
        : '<span style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:50%; background:rgba(168,85,247,0.15); color:#c084fc; font-size:13px; font-weight:600; flex-shrink:0;">' + (u.username ? u.username[0].toUpperCase() : 'U') + '</span>';
      
      const roleBadge = u.role === 'superadmin'
        ? '<span style="font-size:10px; color:#c084fc; background:rgba(168,85,247,0.2); padding:1px 5px; border-radius:4px; font-weight:700; margin-left:4px; border:1px solid rgba(168,85,247,0.4); flex-shrink:0;">SUPERADMIN</span>'
        : (u.role === 'admin'
          ? '<span style="font-size:10px; color:#ec4899; background:rgba(236,72,153,0.15); padding:1px 5px; border-radius:4px; font-weight:600; margin-left:4px; flex-shrink:0;">ADMIN</span>'
          : '<span style="font-size:10px; color:#38bdf8; background:rgba(56,189,248,0.12); padding:1px 5px; border-radius:4px; font-weight:500; margin-left:4px; flex-shrink:0;">OFFICER</span>');

      const pInfo = presenceMap[u.username];
      const isOnline = pInfo ? pInfo.is_online : false;
      const isSharing = pInfo ? pInfo.location_sharing : false;

      const onlineBadge = isOnline
        ? '<span style="display:inline-flex; align-items:center; gap:4px; font-size:10px; color:#10b981; background:rgba(16,185,129,0.14); padding:1px 6px; border-radius:10px; border:1px solid rgba(16,185,129,0.3); font-weight:600; margin-left:4px;"><span style="width:6px; height:6px; border-radius:50%; background:#10b981; box-shadow:0 0 6px #10b981;"></span>ออนไลน์</span>'
        : '<span style="display:inline-flex; align-items:center; gap:4px; font-size:10px; color:#94a3b8; background:rgba(255,255,255,0.05); padding:1px 6px; border-radius:10px; border:1px solid rgba(255,255,255,0.1); font-weight:500; margin-left:4px;"><span style="width:6px; height:6px; border-radius:50%; background:#64748b;"></span>ออฟไลน์</span>';

      const sharingBadge = isSharing
        ? '<span style="font-size:10px; color:#38bdf8; background:rgba(56,189,248,0.14); padding:1px 5px; border-radius:4px; font-weight:600; border:1px solid rgba(56,189,248,0.3); margin-left:4px; display:inline-flex; align-items:center; gap:2px;">📍 เปิดพิกัด</span>'
        : '';
        
      const info = document.createElement('div');
      info.style.cssText = 'min-width:0; flex:1; overflow:hidden;';
      info.innerHTML = '<div style="font-weight:600; color:#f8fafc; font-size:13px; display:flex; align-items:center; flex-wrap:wrap; gap:3px;"><span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:170px;">' + (window.bppAccountLabel ? window.bppAccountLabel.nameHtml(u.username) : escapeHtml(u.username)) + '</span>' + roleBadge + onlineBadge + sharingBadge + '</div>';
        
      left.innerHTML = icon;
      left.appendChild(info);
      
      const swLbl = document.createElement('label');
      swLbl.className = 'switch';
      swLbl.style.cssText = 'flex-shrink:0; margin:0;';
      swLbl.title = 'สวิตช์เปิด/ปิดการรับแจ้งเตือนของ ' + escapeHtml(u.username);
      swLbl.innerHTML = '<input type="checkbox" data-user-alert="' + escapeHtml(u.username) + '" ' + (u.master_enabled ? 'checked' : '') + '><span class="slider round"></span>';
      
      const chk = swLbl.querySelector('input');
      chk.addEventListener('change', async () => {
        const enabled = chk.checked;
        try {
          const uRes = await fetch('/api/nas-bot/admin/subscriptions/' + encodeURIComponent(u.username), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ master_enabled: enabled })
          });
          if (uRes.ok) {
            toast((enabled ? 'เปิด' : 'ปิด') + 'การแจ้งเตือนสำหรับ ' + u.username + ' เรียบร้อยแล้ว');
          } else {
            chk.checked = !enabled;
            toast('ไม่สามารถปรับสถานะแจ้งเตือนได้');
          }
        } catch (err) {
          chk.checked = !enabled;
          toast('เกิดข้อผิดพลาดในการเชื่อมต่อ');
        }
      });

      topLine.appendChild(left);
      topLine.appendChild(swLbl);

      // Line 2: Telegram connection status badge & action buttons
      const actionsLine = document.createElement('div');
      actionsLine.className = 'admin-user-actions-line';
      actionsLine.style.cssText = 'display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; width:100%; padding-top:6px; border-top:1px solid rgba(255,255,255,0.04);';

      const pairBadge = u.is_paired 
        ? '<span style="font-size:10.5px; color:#10b981; background:rgba(16,185,129,0.12); padding:2px 7px; border-radius:10px; border:1px solid rgba(16,185,129,0.3); font-weight:500; display:inline-flex; align-items:center; gap:4px; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><svg width="8" height="8" viewBox="0 0 24 24" fill="#34e2a8" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/></svg>ผูก Telegram แล้ว' + (u.chat_ids && u.chat_ids.length ? ' (' + u.chat_ids.join(', ') + ')' : '') + '</span>'
        : '<span style="font-size:10.5px; color:#94a3b8; background:rgba(255,255,255,0.05); padding:2px 7px; border-radius:10px; border:1px solid rgba(255,255,255,0.1); display:inline-flex; align-items:center; gap:4px;"><svg width="8" height="8" viewBox="0 0 24 24" fill="#94a3b8" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/></svg>ยังไม่ผูก Telegram</span>';

      const statusBox = document.createElement('div');
      statusBox.style.cssText = 'display:flex; align-items:center; min-width:0;';
      statusBox.innerHTML = pairBadge;

      const btnsGroup = document.createElement('div');
      btnsGroup.style.cssText = 'display:inline-flex; align-items:center; flex-wrap:wrap; gap:5px; margin-left:auto;';

      // Button: ขอรหัสผูก Telegram
      const btnReqCode = document.createElement('button');
      btnReqCode.type = 'button';
      btnReqCode.style.cssText = 'display:inline-flex; align-items:center; gap:4px; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); padding:3px 7px; border-radius:5px; font-size:11px; cursor:pointer; font-weight:600; white-space:nowrap;';
      btnReqCode.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>ขอรหัสผูก';
      btnReqCode.title = 'สร้างรหัส 6 หลักสำหรับผูก Telegram ให้ ' + escapeHtml(u.username);
      btnReqCode.addEventListener('click', () => {
        state.alertTargetUser = u.username;
        const selTarget = document.getElementById('selAlertTargetUser');
        if (selTarget) selTarget.value = u.username;
        requestTelegramPairCode(u.username);
        const pBox = document.getElementById('boxPairCodeDisplay');
        if (pBox) pBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });

      // Button: ระบุ Chat ID โดยตรง
      const btnDirectPair = document.createElement('button');
      btnDirectPair.type = 'button';
      btnDirectPair.style.cssText = 'display:inline-flex; align-items:center; gap:4px; background:rgba(234,179,8,0.12); color:#fbbf24; border:1px solid rgba(234,179,8,0.3); padding:3px 7px; border-radius:5px; font-size:11px; cursor:pointer; font-weight:600; white-space:nowrap;';
      btnDirectPair.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Chat ID';
      btnDirectPair.title = 'ระบุหรือย้าย Telegram Chat ID ให้ ' + escapeHtml(u.username);
      btnDirectPair.addEventListener('click', async () => {
        const curCid = (u.chat_ids && u.chat_ids[0]) || '';
        const cid = await window.bppPrompt('กรุณาระบุ Telegram Chat ID สำหรับบัญชี ' + u.username + ':', curCid);
        if (cid && cid.trim()) {
          try {
            const res = await fetch('/api/nas-bot/admin/pair/direct', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: u.username, chat_id: cid.trim() })
            });
            if (res.ok) {
              toast('ผูก Chat ID ' + cid.trim() + ' กับบัญชี ' + u.username + ' สำเร็จแล้ว');
              loadAdminUserAlerts();
              loadMyAlertsSettings();
            } else {
              toast('เกิดข้อผิดพลาดในการผูก Chat ID', true);
            }
          } catch (err) {
            toast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', true);
          }
        }
      });

      // Button: ตั้งค่ากล้อง
      const btnCfgCam = document.createElement('button');
      btnCfgCam.type = 'button';
      btnCfgCam.style.cssText = 'display:inline-flex; align-items:center; gap:4px; background:rgba(99,102,241,0.15); color:#818cf8; border:1px solid rgba(99,102,241,0.3); padding:3px 7px; border-radius:5px; font-size:11px; cursor:pointer; font-weight:600; white-space:nowrap;';
      btnCfgCam.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>กล้อง';
      btnCfgCam.title = 'คลิกเพื่อเลือกดูและติ๊กเลือกกล้องแจ้งเตือนให้ ' + escapeHtml(u.username);
      btnCfgCam.addEventListener('click', () => {
        state.alertTargetUser = u.username;
        const selTarget = document.getElementById('selAlertTargetUser');
        if (selTarget) selTarget.value = u.username;
        loadMyAlertsSettings();
        const mat = document.getElementById('myAlertsCamMatrix');
        if (mat) mat.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });

      btnsGroup.appendChild(btnReqCode);
      btnsGroup.appendChild(btnDirectPair);

      // Button: ยกเลิกการผูก (ถ้าผูกอยู่)
      if (u.is_paired) {
        const btnUnpair = document.createElement('button');
        btnUnpair.type = 'button';
        btnUnpair.style.cssText = 'display:inline-flex; align-items:center; gap:4px; background:rgba(239,68,68,0.12); color:#f87171; border:1px solid rgba(239,68,68,0.3); padding:3px 7px; border-radius:5px; font-size:11px; cursor:pointer; font-weight:600; white-space:nowrap;';
        btnUnpair.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>ยกเลิก';
        btnUnpair.title = 'ยกเลิกการผูก Telegram ของ ' + escapeHtml(u.username);
        btnUnpair.addEventListener('click', async () => {
          if (await window.bppConfirm('คุณต้องการยกเลิกการผูก Telegram ของบัญชี ' + u.username + ' ใช่หรือไม่?')) {
            try {
              const res = await fetch('/api/nas-bot/admin/pair/unpair', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u.username })
              });
              if (res.ok) {
                toast('ยกเลิกการผูก Telegram ของ ' + u.username + ' แล้ว');
                loadAdminUserAlerts();
                loadMyAlertsSettings();
              }
            } catch (err) {
              toast('เกิดข้อผิดพลาดในการยกเลิก', true);
            }
          }
        });
        btnsGroup.appendChild(btnUnpair);
      }

      btnsGroup.appendChild(btnCfgCam);
      actionsLine.appendChild(statusBox);
      actionsLine.appendChild(btnsGroup);

      row.appendChild(topLine);
      row.appendChild(actionsLine);
      container.appendChild(row);
    });
  } catch (e) {
    container.innerHTML = '<div class="field-hint" style="color:#ef4444; padding:6px 0;">ไม่สามารถดึงข้อมูลผู้ใช้งานได้</div>';
  }
}

/**
 * เรนเดอร์รายการกล้องและชนิดวัตถุสำหรับการแจ้งเตือน Telegram (Settings Tab 4: แจ้งเตือนของฉัน)
 * ปรับดีไซน์เป็น Clickable Pill/Chip เหมือนกับ YOLO Detection บนหน้าจอกล้อง
 * แบ่งเป็น 3 กลุ่ม: ความปลอดภัย (person, knife, backpack), ยานพาหนะ (car, motorcycle, bicycle, bus, truck), และ ทะเบียนเฝ้าระวัง (watchlist_plate)
 * มีปุ่มลัด "ชุดแนะนำ" (เปิดทั้ง 9 ชนิด) และ "ล้างทั้งหมด" (ปิดทั้งหมด) ประจำแต่ละกล้อง
 */
function renderMyAlertsMatrix() {
  const container = document.getElementById('myAlertsCamMatrix');
  if (!container) return;
  container.innerHTML = '';
  
  const cams = [];
  const channelsSource = (state.draft && state.draft.length) ? state.draft : (cfg.channels || []);
  channelsSource.forEach((c, idx) => {
    const chNum = `CH${String(idx + 1).padStart(2, '0')}`;
    const srcId = c.src || c.name;
    const isBound = c.enabled !== false && srcId && srcId.trim() !== '' && !srcId.includes('ว่าง');
    
    if (isBound) {
      const thaiName = displayCameraName(c.src, c.name);
      const dispTitle = (thaiName && thaiName !== srcId) ? `${chNum} (${thaiName})` : `${chNum} (${srcId})`;
      if (!cams.some(x => x.srcId === srcId)) {
        const activeProf = state.impersonatingUser ? (state.allUserProfilesCache?.[state.impersonatingUser] || {}) : (state.userProfile || {});
        const disabledAiSet = new Set(activeProf.disabled_ai_cameras || []);
        let isAiOn = (c.detect !== undefined)
          ? (c.detect === true)
          : (state.frigateDetect && state.frigateDetect.hasOwnProperty(srcId) ? state.frigateDetect[srcId] !== false : true);
        if (disabledAiSet.has(srcId)) isAiOn = false;
        cams.push({ srcId, name: thaiName, title: dispTitle, isAiOn });
      }
    }
  });

  if (!cams.length && state.nvrCameras && Array.isArray(state.nvrCameras)) {
    state.nvrCameras.forEach(nc => {
      const srcId = nc.id || nc.name;
      if (srcId && nc.enabled !== false) {
        const dispTitle = nc.name ? `${nc.name} (${srcId})` : srcId;
        if (!cams.some(x => x.srcId === srcId)) {
          let isAiOn = nc.ai_enabled !== undefined ? (nc.ai_enabled !== false) : true;
          if (state.frigateDetect && state.frigateDetect.hasOwnProperty(srcId)) {
            isAiOn = state.frigateDetect[srcId] !== false;
          }
          cams.push({ srcId, name: nc.name || '', title: dispTitle, isAiOn });
        }
      }
    });
  }

  if (!cams.length) {
    container.innerHTML = '<div class="field-hint" style="padding:10px; color:#94a3b8;">ไม่มีกล้องที่เปิดใช้งานบนหน้าจอกล้อง (Dashboard) ในขณะนี้</div>';
    return;
  }
  
  const curCams = (state.mySubscription && state.mySubscription.cameras) || {};
  
  // นิยาม 3 กลุ่มสำหรับแจ้งเตือน พร้อมไอคอนและรายการวัตถุ
  const alertGroups = [
    {
      title: 'กลุ่มความปลอดภัย',
      icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
      items: ALERT_SECURITY_GROUP
    },
    {
      title: 'กลุ่มยานพาหนะ',
      icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H7c-.7 0-1.3.3-1.8.7C4.3 8.6 3 10 3 10s-2.7.6-4.5 1.1C-2.3 11.3-3 12.1-3 13v3c0 .6.4 1 1 1h2"></path><circle cx="7" cy="17" r="2"></circle><circle cx="17" cy="17" r="2"></circle></svg>',
      items: ALERT_VEHICLE_GROUP
    },
    {
      title: 'ทะเบียนเฝ้าระวัง',
      icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="6" y1="10" x2="18" y2="10"></line><line x1="6" y1="14" x2="14" y2="14"></line></svg>',
      items: ALERT_WATCHLIST_GROUP
    }
  ];
  
  cams.forEach(camObj => {
    const card = document.createElement('div');
    card.className = 'my-alerts-cam-card';
    
    // Header row: กล้องชื่อ + สถานะ AI NVR + ปุ่มลัด "ชุดแนะนำ" / "ล้างทั้งหมด"
    const head = document.createElement('div');
    head.className = 'my-alerts-card-head';
    
    const isAiOn = camObj.isAiOn !== false;
    const aiBadge = isAiOn
      ? '<span class="my-alerts-ai-badge on"><span class="my-alerts-ai-dot on"></span>AI เปิด</span>'
      : '<span class="my-alerts-ai-badge off"><span class="my-alerts-ai-dot off"></span>AI ปิด (NVR)</span>';

    const titleEl = document.createElement('div');
    titleEl.className = 'my-alerts-card-title';
    titleEl.innerHTML = '<span class="my-alerts-title-left"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> กล้อง: <span class="my-alerts-card-cam-name">' + escapeHtml(camObj.title) + '</span></span>' + aiBadge;
    
    const quickDiv = document.createElement('div');
    quickDiv.className = 'my-alerts-quick-actions';
    
    const btnPreset = document.createElement('button');
    btnPreset.type = 'button';
    btnPreset.className = 'obj-chip-btn my-alerts-quick-btn';
    btnPreset.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>ชุดแนะนำ';
    btnPreset.title = 'เลือกเปิดแจ้งเตือนวัตถุแนะนำทั้งหมด (9 ชนิด) สำหรับกล้องนี้';
    
    const btnClear = document.createElement('button');
    btnClear.type = 'button';
    btnClear.className = 'obj-chip-btn my-alerts-quick-btn';
    btnClear.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>ล้างทั้งหมด';
    btnClear.title = 'ปิดการแจ้งเตือนวัตถุทั้งหมดสำหรับกล้องนี้';
    
    quickDiv.appendChild(btnPreset);
    quickDiv.appendChild(btnClear);
    head.appendChild(titleEl);
    head.appendChild(quickDiv);
    card.appendChild(head);

    if (!isAiOn) {
      const warnBox = document.createElement('div');
      warnBox.className = 'my-alerts-ai-warn';
      warnBox.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none; margin-top:2px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg><span><b>กล้องนี้ปิดระบบ AI บน NVR:</b> การตรวจจับวัตถุ (คน/ยานพาหนะ) จะไม่ทำงานและไม่มีการแจ้งเตือน จนกว่าผู้ดูแลระบบจะเปิด AI ที่หน้าตั้งค่ากล้องแดชบอร์ด</span>';
      card.appendChild(warnBox);
    }
    
    // กล่องบรรจุ Chip กลุ่มวัตถุ (ใช้คลาส .my-alerts-cam-grid ซึ่งแต่งเป็น container แบบเดียวกับ .obj-grid)
    const wrap = document.createElement('div');
    wrap.className = 'my-alerts-cam-grid';
    
    const camCfg = curCams[camObj.srcId] || (camObj.name && curCams[camObj.name]) || {};
    
    // สร้างกลุ่มและชิปในแต่ละกลุ่ม
    alertGroups.forEach(g => {
      const grpEl = document.createElement('div');
      grpEl.className = 'obj-group';
      
      const grpHead = document.createElement('div');
      grpHead.className = 'obj-group-head';
      grpHead.innerHTML = g.icon + escapeHtml(g.title);
      grpEl.appendChild(grpHead);

      const itemsWrap = document.createElement('div');
      itemsWrap.className = 'obj-grid-items';

      g.items.forEach(objKey => {
        const isChecked = camCfg[objKey] === true;
        const isAiObj = objKey !== 'watchlist_plate';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'obj-item' + (isChecked ? ' on' : '');
        b.setAttribute('aria-pressed', String(isChecked));
        b.setAttribute('data-cam', camObj.srcId);
        b.setAttribute('data-obj', objKey);
        b.textContent = ALERT_LABEL_TH[objKey] || objKey;
        
        if (!isAiOn && isAiObj) {
          b.title = '⚠️ กล้องนี้ปิดระบบ AI บน NVR (ต้องเปิด AI ที่หน้าตั้งค่ากล้องแดชบอร์ดเพื่อให้ระบบตรวจจับและแจ้งเตือนได้)';
        } else {
          b.title = (isChecked ? 'กำลังเปิดแจ้งเตือน: ' : 'คลิกเพื่อเปิดแจ้งเตือน: ') + (ALERT_LABEL_TH[objKey] || objKey);
        }
        
        b.addEventListener('click', () => {
          const active = b.classList.toggle('on');
          b.setAttribute('aria-pressed', String(active));
          state.myAlertsDirty = true;
          if (active && document.getElementById('chkMyMasterAlert') && !document.getElementById('chkMyMasterAlert').checked) {
            document.getElementById('chkMyMasterAlert').checked = true;
          }
          if (!isAiOn && isAiObj) {
            b.title = '⚠️ กล้องนี้ปิดระบบ AI บน NVR (ต้องเปิด AI ที่หน้าตั้งค่ากล้องแดชบอร์ดเพื่อให้ระบบตรวจจับและแจ้งเตือนได้)';
            if (active && window.bppToast) {
              window.bppToast('ข้อควรทราบ: กล้องนี้ปิด AI อยู่บน NVR — ต้องเปิด AI ที่หน้าตั้งค่ากล้องแดชบอร์ดด้วยจึงจะตรวจจับและแจ้งเตือนได้');
            }
          } else {
            b.title = (active ? 'กำลังเปิดแจ้งเตือน: ' : 'คลิกเพื่อเปิดแจ้งเตือน: ') + (ALERT_LABEL_TH[objKey] || objKey);
          }
        });
        
        itemsWrap.appendChild(b);
      });

      grpEl.appendChild(itemsWrap);
      wrap.appendChild(grpEl);
    });
    
    // ผูก Event Listener ให้ปุ่มลัดประจำกล้อง
    btnPreset.addEventListener('click', () => {
      state.myAlertsDirty = true;
      if (document.getElementById('chkMyMasterAlert') && !document.getElementById('chkMyMasterAlert').checked) {
        document.getElementById('chkMyMasterAlert').checked = true;
      }
      const chips = wrap.querySelectorAll('.obj-item');
      chips.forEach(chip => {
        chip.classList.add('on');
        chip.setAttribute('aria-pressed', 'true');
        const key = chip.getAttribute('data-obj');
        chip.title = 'กำลังเปิดแจ้งเตือน: ' + (ALERT_LABEL_TH[key] || key);
      });
    });
    
    btnClear.addEventListener('click', () => {
      state.myAlertsDirty = true;
      const chips = wrap.querySelectorAll('.obj-item');
      chips.forEach(chip => {
        chip.classList.remove('on');
        chip.setAttribute('aria-pressed', 'false');
        const key = chip.getAttribute('data-obj');
        chip.title = 'คลิกเพื่อเปิดแจ้งเตือน: ' + (ALERT_LABEL_TH[key] || key);
      });
    });
    
    card.appendChild(wrap);
    container.appendChild(card);
  });
}

async function saveMyAlertsSettings() {
  const master = document.getElementById('chkMyMasterAlert') ? document.getElementById('chkMyMasterAlert').checked : true;
  const broadcast = document.getElementById('chkAdminBroadcast') ? document.getElementById('chkAdminBroadcast').checked : false;
  
  const camObjMap = {};
  const allChips = document.querySelectorAll('#myAlertsCamMatrix .obj-item[data-cam][data-obj]');
  allChips.forEach(chip => {
    const c = chip.getAttribute('data-cam');
    const o = chip.getAttribute('data-obj');
    if (c && o) {
      if (!camObjMap[c]) camObjMap[c] = {};
      camObjMap[c][o] = chip.classList.contains('on');
    }
  });

  const targetUser = state.alertTargetUser || '';
  const url = targetUser 
    ? '/api/nas-bot/admin/subscriptions/' + encodeURIComponent(targetUser) + '/cameras'
    : '/api/nas-bot/subscriptions/me';

  const schedEnabled = document.getElementById('chkMyScheduleAlert') ? document.getElementById('chkMyScheduleAlert').checked : false;
  const schedStart = document.getElementById('inpMyScheduleStart') ? document.getElementById('inpMyScheduleStart').value : '00:00';
  const schedEnd = document.getElementById('inpMyScheduleEnd') ? document.getElementById('inpMyScheduleEnd').value : '23:59';

  const basePayload = { 
    master_enabled: master, 
    cameras: camObjMap,
    schedule_enabled: schedEnabled,
    schedule_start: schedStart,
    schedule_end: schedEnd
  };
  
  const payload = targetUser 
    ? basePayload
    : { ...basePayload, broadcast_to_all: broadcast };
  
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      state.myAlertsDirty = false;
      if (state.mySubscription && !targetUser) {
        state.mySubscription.master_enabled = master;
        state.mySubscription.broadcast_to_all = broadcast;
        state.mySubscription.cameras = camObjMap;
      }

      // Synchronize userProfile.disabled_ai_cameras with personal alert subscriptions
      if (state.userProfile && !targetUser) {
        if (!state.userProfile.disabled_ai_cameras) state.userProfile.disabled_ai_cameras = [];
        let profileChanged = false;
        Object.keys(camObjMap).forEach(camId => {
          const hasAnyOn = Object.values(camObjMap[camId]).some(v => v === true);
          if (hasAnyOn && state.userProfile.disabled_ai_cameras.includes(camId)) {
            state.userProfile.disabled_ai_cameras = state.userProfile.disabled_ai_cameras.filter(x => x !== camId);
            profileChanged = true;
          }
        });
        if (profileChanged) {
          try { await saveUserProfile(); } catch (e) {}
        }
      }

      triggerDemandReconciliation(false);
      const uName = targetUser ? ('สำหรับ ' + targetUser) : 'ส่วนตัว';
      toast('บันทึกการแจ้งเตือน' + uName + 'เรียบร้อยแล้ว');
    }
    return res.ok;
  } catch (e) {
    return false;
  }
}

// เขียนรายชื่อกล้อง LPR ทั้งไฟล์ (เรียกจาก saveSettings เมื่อ lprDirty เท่านั้น)
async function saveLprCameras() {
  if (!state.lprDirty || !state.lprCams || cfg.demo || !SAME_ORIGIN) return false;
  try {
    const body = '# เขียนโดย dashboard (Settings) — lpr-service reload ทุก ~60 วิ\n'
      + Array.from(state.lprCams).join('\n') + '\n';
    const res = await fetch('/settings/lpr_cameras', { method: 'PUT', body: body });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.lprDirty = false;
    toast('บันทึกกล้อง LPR แล้ว — มีผลภายใน ~60 วินาที');
    
    // Config synchronization belongs to the transactional admin backend, not the
    // read-only raw Frigate /nvr/api/config namespace.
    const syncRes = await fetch('/api/config/lpr_streams_sync', { method: 'POST' });
    if (syncRes.ok) {
      const syncData = await syncRes.json();
      return syncData.changed === true;
    }
    return false;
  } catch (e) { toast('บันทึกรายชื่อกล้อง LPR ไม่สำเร็จ — ลองใหม่อีกครั้ง'); return false; }
}

// สถานะสำหรับ LPR Zone Editor — เก็บกล้องที่เลือก, กรอบโซน, สถานะการวาด
const lz = { cam: null, rect: null, drawing: false, sx: 0, sy: 0 };

// คำนวณตำแหน่งและขนาดของเนื้อภาพใน lzImg (อิงจาก object-fit: contain)
function lzContentRect() {
  const img = $('lzImg');
  const stage = img.parentElement;
  const stRect = stage.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();
  const natW = img.naturalWidth || 1, natH = img.naturalHeight || 1;
  const scale = Math.min(imgRect.width / natW, imgRect.height / natH);
  const w = natW * scale, h = natH * scale;
  const left = imgRect.left + (imgRect.width - w) / 2;
  const top = imgRect.top + (imgRect.height - h) / 2;
  return { left, top, w, h, stLeft: stRect.left, stTop: stRect.top };
}

// วาด/อัปเดตกรอบสีแดงบนภาพตาม lz.rect (normalized 0-1)
function lzRenderBox() {
  const box = $('lzBox');
  if (!lz.rect) { box.hidden = true; return; }
  const c = lzContentRect();
  box.hidden = false;
  box.style.left = (c.left - c.stLeft + lz.rect[0] * c.w) + 'px';
  box.style.top = (c.top - c.stTop + lz.rect[1] * c.h) + 'px';
  box.style.width = (lz.rect[2] * c.w) + 'px';
  box.style.height = (lz.rect[3] * c.h) + 'px';
}

// เขียนโซนทั้งไฟล์ (เรียกทันทีจากปุ่มบันทึกใน zone editor — อิสระจาก settings save)
async function saveLprZones() {
  try {
    const res = await fetch('/settings/lpr_zones', { method: 'PUT', body: JSON.stringify(state.lprZones || {}) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return true;
  } catch (e) { toast('บันทึกโซนไม่สำเร็จ — ลองใหม่อีกครั้ง'); return false; }
}

// แปลงตำแหน่ง pointer → normalized 0-1 อิงเนื้อภาพ (clamp ให้อยู่ในภาพเสมอ)
function lzPointNorm(e) {
  const c = lzContentRect();
  return [
    Math.max(0, Math.min(1, (e.clientX - c.left) / c.w)),
    Math.max(0, Math.min(1, (e.clientY - c.top) / c.h)),
  ];
}

// เปิด editor ของกล้อง camName — โหลดภาพสด (cache-bust ให้ได้เฟรมปัจจุบัน) + โซนเดิมถ้ามี
function openLprZone(camName) {
  lz.cam = camName;
  lz.rect = (state.lprZones && state.lprZones[camName]) ? state.lprZones[camName].slice() : null;
  $('lzCamName').textContent = camName;
  const msg = $('lzMsg'); msg.hidden = false; msg.textContent = 'กำลังโหลดภาพสดจากกล้อง…';
  const img = $('lzImg');
  img.onload = () => { msg.hidden = true; lzRenderBox(); };
  img.onerror = () => { msg.textContent = 'โหลดภาพจากกล้องไม่สำเร็จ — กล้องอาจออฟไลน์'; };
  img.src = apiUrl('/api/' + encodeURIComponent(camName) + '/latest.jpg?height=1080&cb=' + Date.now());
  $('lzBox').hidden = true;
  $('lprZoneOverlay').hidden = false;
}
function closeLprZone() { $('lprZoneOverlay').hidden = true; lz.drawing = false; }

const lzLayer = $('lzDrawLayer');
if (lzLayer) {
  lzLayer.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { lzLayer.setPointerCapture(e.pointerId); } catch(err){}
    lz.drawing = true;
    const [nx, ny] = lzPointNorm(e);
    lz.sx = nx; lz.sy = ny;
    lz.rect = [nx, ny, 0, 0];
    lzRenderBox();
  });
  lzLayer.addEventListener('pointermove', e => {
    if (!lz.drawing) return;
    e.preventDefault();
    const [nx, ny] = lzPointNorm(e);
    lz.rect[0] = Math.min(lz.sx, nx);
    lz.rect[1] = Math.min(lz.sy, ny);
    lz.rect[2] = Math.abs(nx - lz.sx);
    lz.rect[3] = Math.abs(ny - lz.sy);
    lzRenderBox();
  });
  lzLayer.addEventListener('pointerup', e => {
    if (!lz.drawing) return;
    lz.drawing = false;
    if (lz.rect[2] < 0.02 || lz.rect[3] < 0.02) lz.rect = null; // too small, clear
    lzRenderBox();
  });
}
const btnLzSave = $('btnLzSave'), btnLzClear = $('btnLzClear');
if (btnLzSave) btnLzSave.addEventListener('click', async () => {
  if (lz.cam) {
    if (lz.rect) state.lprZones[lz.cam] = lz.rect.slice();
    else delete state.lprZones[lz.cam];
    await saveLprZones();
    renderChForm();
  }
  closeLprZone();
});
if (btnLzClear) btnLzClear.addEventListener('click', () => {
  lz.rect = null;
  lzRenderBox();
});

/* ============ เพิ่มกล้องใหม่เข้า Frigate จากหน้าตั้งค่า ============ */
// ช่อง Main/Sub stream รับ 2 แบบ: ชื่อ stream ที่มีอยู่ (เช่น cam11) ทำงานแบบเดิม
// หรือ URL เต็ม (rtsp/rtmp/http) → ระบบสร้าง go2rtc stream + camera block ใน Frigate ให้
// แล้วรีสตาร์ท 1 ครั้ง (go2rtc รับ stream ใหม่เฉพาะตอน start — จำเป็นสำหรับภาพสด WebRTC)
// URL credentials must use {FRIGATE_*} placeholders; Config API rejects literal
// userinfo/query secrets before the Git-managed config or backups are written.
const STREAM_URL_RE = /^(rtsps?|rtmps?|https?):\/\//i;
const sanitizeCamName = s => (s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);

// Provision through the narrow admin Config API. It serializes the full
// transaction, validates with pinned Frigate, backs up, and rejects raw secrets.
async function provisionCamera(camName, mainUrl, subUrl) {
  // One structured payload represents exactly the fields this workflow owns;
  // the server derives safe go2rtc/ffmpeg blocks and commits them atomically.
  const res = await fetch('/api/config/cameras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: camName,
      rtsp_url: mainUrl,
      sub_url: subUrl || '',
      ai_enabled: true,
      group: '',
      track: RECOMMENDED_PRESET.slice(),
    }),
    signal: timeoutSignal(15000),
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.text()).slice(0, 300); } catch (e) {}
    throw new Error('HTTP ' + res.status + ' ' + msg);
  }
}

async function restartFrigate() {
  try {
    await fetch(apiUrl('/api/restart'), { method: 'POST', headers: FRIGATE_WRITE_HEADERS, signal: timeoutSignal(10000) });
  } catch (e) {
    // การรีสตาร์ทกระบวนการอาจทำให้ Socket/HTTP หลุดชั่วคราว — ถือเป็นพฤติกรรมปกติของ Frigate
  }
}

// รอจนกล้องใหม่โผล่ใน /api/config (Frigate boot เสร็จ) — poll ทุก 1 วิ
async function waitForCamera(camName, timeoutMs = 25000) {
  const maxTimeout = Math.min(timeoutMs, 15000);
  const deadline = Date.now() + maxTimeout;
  let wentDown = false;
  // ให้เวลา Frigate 2 วินาทีเพื่อเริ่ม reload/restart
  await new Promise(r => setTimeout(r, 2000));
  while (Date.now() < deadline) {
    try {
      const res = await fetch(apiUrl('/api/config?t=' + Date.now()), { signal: timeoutSignal(2000) });
      if (res.ok) {
        if (wentDown || (Date.now() >= deadline - maxTimeout + 2500)) {
          return true;
        }
      } else {
        wentDown = true;
      }
    } catch (e) {
      wentDown = true;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

// สแกน draft ทุกช่อง: ช่องที่กรอกเป็น URL → เพิ่มเข้า Frigate + เปลี่ยนช่องให้ชี้ชื่อ stream ใหม่
async function provisionNewCameras() {
  if (cfg.demo || !SAME_ORIGIN || !state.draft) return { provisioned: 0 };
  const jobs = [];
  state.draft.forEach((ch, i) => { if (ch && ch.src && STREAM_URL_RE.test(ch.src)) jobs.push({ ch, i }); });
  if (!jobs.length) return { provisioned: 0 };
  if (!(await window.bppConfirm('พบกล้องใหม่ ' + jobs.length + ' ช่องที่กรอกเป็น Stream URL\n' +
    'ระบบจะเพิ่มกล้องเข้า Frigate แล้วรีสตาร์ทระบบ 1 ครั้ง (ภาพสด/บันทึกขาดช่วง ~20-30 วินาที)\n\nดำเนินการเลยหรือไม่?'))) {
    return { provisioned: 0, cancelled: true };
  }
  let existing = {};
  try { const res = await fetch(apiUrl('/api/config'), { signal: timeoutSignal(6000) }); if (res.ok) existing = (await res.json()).cameras || {}; } catch (e) {}
  const m = $('syncMsg');
  let ok = 0, lastName = null;
  for (const job of jobs) {
    const base = sanitizeCamName(job.ch.name) || 'cam_ch' + (job.i + 1);
    let name = base, n = 2;
    while (existing[name]) name = base + '_' + (n++); // กันชนชื่อกล้องเดิม
    m.textContent = 'กำลังเพิ่มกล้อง "' + name + '" เข้าระบบ…';
    try {
      const subUrl = (job.ch.sub && STREAM_URL_RE.test(job.ch.sub)) ? job.ch.sub : null;
      await provisionCamera(name, job.ch.src, subUrl);
      // ชี้ช่องนี้ไปที่ชื่อ stream ใหม่ (URL ย้ายไปอยู่ใน Frigate แล้ว)
      job.ch.src = name;
      if (subUrl) {
        job.ch.sub = name + '_sub';
        // สตรีมสำหรับดูเต็มจอ: config-api สร้าง <name>_hd (main + NVENC) ให้เฉพาะกล้อง
        // ที่มีสตรีมรอง เพราะ <name> เปล่าๆ ถูกตั้งเป็น copy ไว้ให้การบันทึก ซึ่งอาจเป็น
        // HEVC ที่เบราว์เซอร์เล่นผ่าน WebRTC ไม่ได้
        job.ch.hd = name + '_hd';
      }
      existing[name] = true; ok++; lastName = name;
    } catch (e) {
      toast('เพิ่มกล้อง "' + name + '" ไม่สำเร็จ: ' + e.message);
      // คง URL ไว้ในช่องเดิมให้ผู้ใช้แก้/ลองใหม่
    }
  }
  if (!ok) return { provisioned: 0 };
  m.textContent = 'กำลังรีสตาร์ทระบบเพื่อเปิดใช้กล้องใหม่…';
  toast('กำลังรีสตาร์ทระบบ ~20-30 วินาที — ภาพสดจะกลับมาเอง');
  try { await restartFrigate(); } catch (e) { toast('สั่งรีสตาร์ทไม่สำเร็จ: ' + e.message); return { provisioned: ok, ready: false }; }
  const ready = await waitForCamera(lastName, 90000);
  return { provisioned: ok, ready: ready };
}

async function pingNvr() {
  const chip = $('nvrStatusChip'), txt = $('nvrStatusText');
  if (cfg.demo) { chip.classList.remove('off'); txt.textContent = 'โหมดสาธิต (ไม่เชื่อมต่อจริง)'; return; }
  try {
    const res = await fetch(apiUrl('/api/version'), { signal: timeoutSignal(5000) });
    if (!res.ok) throw new Error();
    chip.classList.remove('off'); txt.textContent = `${window.BRANDING.name} ${window.BRANDING.sub} เชื่อมต่อแล้ว`;
  } catch (e) {
    chip.classList.add('off'); txt.textContent = `เข้าถึง ${window.BRANDING.name} ${window.BRANDING.sub} ไม่ได้`;
  }
}

function chStatusColor(i) {
  const t = state.tiles[i];
  const st = t ? t.status : 'offline';
  return { live: '#34e2a8', connecting: '#fbbf24', offline: '#fb5b78', videoloss: '#fb5b78' }[st];
}
function chStatusText(i) {
  const t = state.tiles[i];
  const st = t ? t.status : 'offline';
  return { live: 'ออนไลน์', connecting: 'กำลังเชื่อมต่อ', videoloss: 'วิดีโอขาดหาย', offline: 'ออฟไลน์' }[st];
}

function renderChList() {
  const wrap = $('chList');
  wrap.innerHTML = '';
  const activeProf = state.impersonatingUser ? (state.allUserProfilesCache?.[state.impersonatingUser] || {}) : (state.userProfile || {});
  const hiddenSet = new Set(activeProf.hidden_channels || []);

  const curCh = (state.draft || cfg.channels)[state.selCh];
  if ($('chCurrentHint') && curCh) {
    const curDName = displayCameraName(curCh.src, curCh.name) || (curCh.src ? curCh.src : 'ว่าง');
    $('chCurrentHint').textContent = `${chLabel(state.selCh)}: ${curDName}`;
  }

  (state.draft || cfg.channels).forEach((ch, i) => {
    const chNum = chLabel(i);
    const isHiddenByMe = !!(ch.src && hiddenSet.has(ch.src));
    const isSysOff = ch.src && (ch.enabled === false);
    const isVisible = !isHiddenByMe && !isSysOff;

    const b = document.createElement('button');
    b.className = 'ch-item';
    b.setAttribute('aria-pressed', String(i === state.selCh));
    const sysBadge = isSysOff ? '<span style="font-size:10.5px; color:#fbbf24; margin-left:auto; margin-right:4px;">(สตรีมปิด)</span>' : '';
    const hideBadge = (isHiddenByMe && !isSysOff) ? '<span style="font-size:10.5px; color:#94a3b8; margin-left:auto; margin-right:4px;">(ซ่อน)</span>' : '';
    b.innerHTML = `<span class="ch-chip">${chNum}</span><span class="ch-item-name"></span>` +
      sysBadge + hideBadge +
      `<span class="st-dot" style="background:${isVisible ? chStatusColor(i) : (isSysOff ? '#f59e0b' : '#64748b')}; box-shadow:0 0 6px ${isVisible ? chStatusColor(i) : 'transparent'};"></span>`;
    b.querySelector('.ch-item-name').textContent = displayCameraName(ch.src, ch.name) || '— ว่าง —';
    b.addEventListener('click', () => { 
      state.selCh = i; 
      renderChList(); 
      renderChForm(); 
      if (b.scrollIntoView) {
        b.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });
    wrap.appendChild(b);
  });
}

function renderChForm() {
  const i = state.selCh, ch = (state.draft || cfg.channels)[i];
  const chNum = chLabel(i);
  $('selChLabel').textContent = chNum;
  const curDName = displayCameraName(ch.src, ch.name) || (ch.src ? ch.src : 'ว่าง');
  $('selChName').textContent = displayCameraName(ch.src, ch.name) || '— ว่าง —';
  if ($('chCurrentHint')) {
    $('chCurrentHint').textContent = `${chNum}: ${curDName}`;
  }
  const stEl = $('selChStatus');
  stEl.style.color = chStatusColor(i);
  stEl.querySelector('.dot').style.cssText = `background:${chStatusColor(i)}; box-shadow:0 0 6px ${chStatusColor(i)};`;
  stEl.querySelector('span:last-child').textContent = chStatusText(i);
  // The editable field changes the shared display name only; source stays the
  // stable Frigate identifier selected in the NVR dropdown below.
  $('inpName').value = ch.src ? displayCameraName(ch.src, ch.name) : '';
  $('inpName').disabled = !ch.src;
  $('inpName').placeholder = ch.src
    ? 'เช่น ประตูหน้า'
    : 'เลือกกล้องจาก NVR ก่อน';
  if($('inpCamSelect')) {
    $('inpCamSelect').value = ch.src || '';
    if (typeof updateSelectedCamText === 'function') updateSelectedCamText(ch.src || '');
  }
  if($('inpSub')) $('inpSub').value = ch.sub || '';

  // System stream enabled check (Quick Toggle) — Admin/Superadmin only
  const isSysEnabled = ch.src && (ch.enabled !== false);
  const sysBtn = $('btnSysStream');
  const isSuperOrAdmin = ['admin', 'superadmin'].includes(userRole);
  if (sysBtn) {
    // CLAUDE.md Section 10: Non-admin users must never access system stream toggle to prevent system-wide disruptions
    sysBtn.hidden = !ch.src || !isSuperOrAdmin;
    sysBtn.classList.remove('busy');
    sysBtn.classList.toggle('off', !isSysEnabled);
    sysBtn.innerHTML = isSysEnabled 
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>สตรีมระบบ: เปิด' 
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><rect width="4" height="16" x="6" y="4"/><rect width="4" height="16" x="14" y="4"/></svg>สตรีมระบบ: ปิด';
    sysBtn.title = isSysEnabled 
      ? 'คลิกเพื่อหยุดดึงภาพสดกล้องนี้จาก NVR ชั่วคราว (หยุด RTSP / บันทึก / AI ระดับระบบ)' 
      : 'คลิกเพื่อเริ่มดึงภาพสดกล้องนี้จาก NVR (เปิด RTSP ระดับระบบ)';
  }

  // Personal visibility check for button state
  const activeProf = state.impersonatingUser ? (state.allUserProfilesCache?.[state.impersonatingUser] || {}) : (state.userProfile || {});
  const hiddenSet = new Set(activeProf.hidden_channels || []);
  const isHiddenByMe = !!(ch.src && hiddenSet.has(ch.src));
  const personallyVisible = !isHiddenByMe && isSysEnabled;

  // ปุ่มเปิด/ปิดกล้องบนหน้าจอส่วนตัว — โชว์เฉพาะช่องที่มีสตรีม
  const eb = $('btnChEnabled');
  eb.hidden = !ch.src;
  if (!isSysEnabled) {
    eb.classList.add('off');
    eb.disabled = true;
    eb.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="22" x2="22" y2="22"/></svg>ซ่อน (สตรีมระบบปิดอยู่)';
    eb.title = 'กล้องนี้ถูกปิดดึงสัญญาณสดในระดับระบบ (คลิก "สตรีมระบบ: ปิด" ด้านซ้ายเพื่อเปิดดึงภาพ)';
  } else {
    eb.disabled = false;
    eb.classList.toggle('off', !personallyVisible);
    eb.innerHTML = personallyVisible 
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>แสดงบนจอของฉัน' 
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="22" x2="22" y2="22"/></svg>ซ่อนจากจอของฉัน';
    eb.title = personallyVisible 
      ? 'คลิกเพื่อซ่อนกล้องนี้จากหน้าจอ Dashboard ส่วนตัวของคุณ (ไม่กระทบผู้อื่น)' 
      : 'คลิกเพื่อแสดงกล้องนี้กลับมาบนหน้าจอ Dashboard ส่วนตัวของคุณ';
  }

  // Authoritative AI detection status (ADR-0022 / ADR-0024)
  const disabledAiSet = new Set(activeProf.disabled_ai_cameras || []);
  const isSysAiOn = (ch.detect === true) && !(ch.src && disabledAiSet.has(ch.src));

  const disabledLprSet = new Set(activeProf.disabled_lpr_cameras || []);
  const isLprDisabledByMe = !!(ch.src && disabledLprSet.has(ch.src));
  const lprOn = !isLprDisabledByMe && !!(state.lprCams && ch.src && state.lprCams.has(ch.src));

  // ปุ่มเปิด/ปิด AI (ch.detect)
  // Incident 2.45: AI toggle enabled for ALL roles — every operator controls AI per-channel
  const db = $('btnChDetect');
  if (db) {
    db.hidden = !ch.src;
    db.classList.toggle('off', !isSysAiOn);
    const botSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>';
    const ownDemand = isSysAiOn && ch.enabled !== false;
    const otherDemand = (ch.src && state.aiDemandCounts)
      ? Math.max(0, (state.aiDemandCounts[ch.src] || 0) - (ownDemand ? 1 : 0)) : 0;
    const rawUsers = (ch.src && state.aiDemandUsers && state.aiDemandUsers[ch.src]) || [];
    const myUname = (activeProf && activeProf.username) || '';
    const otherUsersList = rawUsers.filter(u => u !== myUname);
    const usersSuffix = otherUsersList.length > 0 ? ` (${otherUsersList.join(', ')})` : '';

    db.innerHTML = botSvg + (isSysAiOn ? 'AI เปิด' : 'AI ปิด') +
      (!isSysAiOn && otherDemand > 0 ? ` · ยังเปิดโดย ${otherDemand} บัญชีอื่น${usersSuffix}` : '');
    db.disabled = false;
    db.title = isSysAiOn 
      ? 'คลิกเพื่อปิดระบบตรวจจับ AI (Frigate) สำหรับกล้องนี้' 
      : (otherUsersList.length > 0
          ? `เปิดใช้งานโดย: ${otherUsersList.join(', ')} — คลิกเพื่อเปิด AI ร่วมด้วย`
          : 'คลิกเพื่อเปิดระบบตรวจจับ AI (Frigate) สำหรับกล้องนี้');
  }
  // ปุ่ม LPR + โซนจับป้าย
  const lb = $('btnChLpr'), zb = $('btnChLprZone');
  lb.hidden = !ch.src || !state.lprCams;
  lb.classList.toggle('off', !lprOn);
  const lprSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>';
  lb.innerHTML = lprSvg + (lprOn ? 'LPR เปิด' : 'LPR ปิด');
  lb.title = (lprOn ? 'คลิกเพื่อปิด' : 'คลิกเพื่อเปิด') + 'ระบบอ่านป้ายทะเบียนของกล้องนี้ (เฉพาะบัญชีของคุณ)';
  zb.hidden = !ch.src || !state.lprCams;
  zb.title = 'ตีกรอบบริเวณที่ป้ายทะเบียนเห็นชัด — รถแตะกรอบ = ระบบดึงภาพเต็มความละเอียดมาอ่าน';

  // ปุ่มเปิด/ปิดระบบตรวจจับใบหน้า & เทียบหมายจับ (Face AI 512-D)
  const fb = $('btnChFace');
  if (fb) {
    fb.hidden = !ch.src;
    const disabledFaceSet = new Set([
      ...(activeProf.disabled_face_cameras || []),
      ...(state.disabledFaceCams ? Array.from(state.disabledFaceCams) : []),
    ]);
    const faceOn = isSysAiOn && !(ch.src && disabledFaceSet.has(ch.src));
    fb.classList.toggle('off', !faceOn);
    const faceSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
    fb.innerHTML = faceSvg + (faceOn ? 'ใบหน้า เปิด' : 'ใบหน้า ปิด');
    fb.title = (faceOn ? 'คลิกเพื่อปิด' : 'คลิกเพื่อเปิด') + 'ระบบตรวจจับใบหน้า & เทียบหมายจับ (ArcFace 512-D) ของกล้องนี้';
  }
  const gpsb = $('btnChGps');
  if (gpsb) {
    gpsb.hidden = !ch.src;
    gpsb.onclick = () => {
      if (ch.src && typeof window.flyToCameraOnHeatmap === 'function') {
        window.flyToCameraOnHeatmap(ch.src);
      }
    };
  }
  if($('btnTestMain')) resetTestBtn($('btnTestMain'));
  if($('btnTestSub')) resetTestBtn($('btnTestSub'));
  renderObjGrid();
  renderAiSchedule();
}

const DEFAULT_AI_SCHED = { enabled: false, start_time: '18:00', end_time: '06:00', days: [1, 2, 3, 4, 5, 6, 7] };

function cloneSchedEntry(raw) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  const days = Array.isArray(s.days) && s.days.length
    ? Array.from(new Set(s.days.map(Number).filter(d => d >= 1 && d <= 7))).sort((a, b) => a - b)
    : [1, 2, 3, 4, 5, 6, 7];
  return {
    enabled: !!s.enabled,
    start_time: (typeof s.start_time === 'string' && /^\d{2}:\d{2}$/.test(s.start_time)) ? s.start_time : '18:00',
    end_time: (typeof s.end_time === 'string' && /^\d{2}:\d{2}$/.test(s.end_time)) ? s.end_time : '06:00',
    days: days.length ? days : [1, 2, 3, 4, 5, 6, 7],
  };
}

function populate24hSelect(sel, max) {
  if (!sel || sel.options.length > 0) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < max; i++) {
    const val = String(i).padStart(2, '0');
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    frag.appendChild(opt);
  }
  sel.appendChild(frag);
}

function initAll24hSelects() {
  ['selAiSchedStartH', 'selAiSchedEndH', 'selMySchedStartH', 'selMySchedEndH'].forEach(id => {
    const el = document.getElementById(id);
    if (el) populate24hSelect(el, 24);
  });
  ['selAiSchedStartM', 'selAiSchedEndM', 'selMySchedStartM', 'selMySchedEndM'].forEach(id => {
    const el = document.getElementById(id);
    if (el) populate24hSelect(el, 60);
  });
}

/* ============ object detection ต่อกล้อง (ผ่าน admin Config API) ============ */
// โหลดกล้องจริง + object ที่ track อยู่ + ตารางเวลา AI จาก Frigate (เรียกตอนเปิด settings)
async function loadFrigateObjects() {
  state.frigateCams = new Set();
  state.frigateDetect = {};
  state.objBase = {}; state.objDraft = {}; state.objDirty = {};
  state.schedBase = {}; state.schedDraft = {}; state.schedDirty = {};
  if (cfg.demo || !SAME_ORIGIN) { renderObjGrid(); renderAiSchedule(); return; }
  try {
    let loaded = false;
    try {
      const catRes = await fetch('/api/public-config/cameras-catalog?t=' + Date.now(), { signal: timeoutSignal(8000) });
      if (catRes.ok) {
        const cat = await catRes.json();
        state.busTruckReady = cat.bus_truck_ready !== false;
        const globalTrack = Array.isArray(cat.global_track) ? cat.global_track : ['person', 'car', 'motorcycle'];
        const cams = Array.isArray(cat.cameras) ? cat.cameras : [];
        const schedMap = (cat.schedules && typeof cat.schedules === 'object') ? cat.schedules : {};
        cams.forEach(c => {
          if (!c || !c.name) return;
          state.frigateCams.add(c.name);
          const track = (Array.isArray(c.track) && c.track.length) ? c.track : globalTrack;
          state.objBase[c.name] = track.slice();
          state.objDraft[c.name] = track.slice();
          state.frigateDetect[c.name] = c.ai_enabled !== false;
          const sc = cloneSchedEntry(c.schedule || schedMap[c.name] || DEFAULT_AI_SCHED);
          state.schedBase[c.name] = cloneSchedEntry(sc);
          state.schedDraft[c.name] = cloneSchedEntry(sc);
        });
        loaded = state.frigateCams.size > 0;
      }
    } catch (e) {}

    if (!loaded) {
      const res = await fetch(apiUrl('/api/config?t=' + Date.now()), { signal: timeoutSignal(6000) });
      if (!res.ok) throw new Error();
      const conf = await res.json();
      // bus/truck เลือกได้ต่อเมื่อ model.labelmap override {5,7} ถูก restart แล้ว
      // (ไม่งั้น save ผ่าน validation ไม่ได้ / detector ไม่รู้จัก) — degrade เป็น chip disabled
      const lm = (conf.model && conf.model.labelmap) || {};
      state.busTruckReady = (lm['5'] === 'bus' || lm[5] === 'bus') && (lm['7'] === 'truck' || lm[7] === 'truck');
      const globalTrack = (conf.objects && conf.objects.track) || [];
      const cams = conf.cameras || {};
      Object.keys(cams).forEach(name => {
        state.frigateCams.add(name);
        const camObj = cams[name].objects;
        const track = (camObj && camObj.track) ? camObj.track : globalTrack;
        state.objBase[name] = track.slice();
        state.objDraft[name] = track.slice();
        const det = cams[name].detect;
        state.frigateDetect[name] = det ? (det.enabled !== false) : true;
        state.schedBase[name] = cloneSchedEntry(DEFAULT_AI_SCHED);
        state.schedDraft[name] = cloneSchedEntry(DEFAULT_AI_SCHED);
      });
    }

    // ADR-0024: a channel's `detect` is the account's own AI demand; it is no longer
    // overwritten from Frigate. state.frigateDetect only tells us when Frigate must be toggled.
  } catch (e) {
    // Frigate config unreachable: own AI-demand flags stay as saved.
  }
  fetchAiDemandCounts().then(c => { if (c) renderChForm(); });
  renderObjGrid();
  renderAiSchedule();
}


function selectedCamName() {
  const ch = (state.draft || cfg.channels)[state.selCh];
  return ch && ch.src ? ch.src : null;
}

function renderObjGrid() {
  const grid = $('objGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const name = selectedCamName();
  const isReal = !!(name && state.frigateCams && state.frigateCams.has(name));
  const dt = (state.draft || cfg.channels)[state.selCh].detect !== false;
  $('btnObjSecurity').disabled = !isReal || !dt;
  $('btnObjClear').disabled = !isReal || !dt;
  const note = msg => { grid.innerHTML = ''; const d = document.createElement('div'); d.className = 'obj-note'; d.textContent = msg; grid.appendChild(d); };
  if (cfg.demo) return note('โหมดสาธิต — ตั้งค่าการตรวจจับจริงไม่ได้');
  if (!SAME_ORIGIN) return note('ตั้งค่าได้เมื่อเปิดผ่านหน้าเว็บ dashboard (พอร์ต 8080) เท่านั้น');
  if (!name) return note('ใส่ชื่อสตรีมหลัก (go2rtc src) ของกล้องนี้ก่อน');
  
  const chDraft = (state.draft || cfg.channels)[state.selCh];
  if (chDraft && chDraft.detect === false) {
    return note('AI ปิดอยู่ — คลิกที่ปุ่มด้านบนเพื่อเปิดการทำงาน AI ก่อนตั้งค่าชนิดวัตถุ');
  }

  if (!state.frigateCams) return note('กำลังโหลดจากระบบ…');
  if (!isReal) return note('กล้อง "' + name + '" ยังไม่มีในระบบ NVR — ตั้งค่าการตรวจจับได้เฉพาะกล้องที่ตั้งค่าไว้');
  const sel = new Set(state.objDraft[name] || []);
  const full = sel.size >= MAX_OBJECTS;
  // ตัวนับโควตา — กล้องที่ค่าเดิมเกิน 10 (seed มาก่อนมีโควตา) ไม่ถูก truncate:
  // เอาออกได้เสมอ/save ได้ แต่เพิ่มไม่ได้จนกว่าจะต่ำกว่าโควตา
  const count = document.createElement('div');
  count.className = 'obj-count' + (sel.size > MAX_OBJECTS ? ' over' : (full ? ' full' : ''));
  count.textContent = 'เลือกแล้ว ' + sel.size + '/' + MAX_OBJECTS +
    (sel.size > MAX_OBJECTS ? ' — เกินโควตา เอาบางชนิดออกก่อนจึงเพิ่มได้' : (full ? ' — ครบโควตาแล้ว' : ''));
  grid.appendChild(count);
  [
    { title: 'กลุ่มความปลอดภัย', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', items: SECURITY_GROUP },
    { title: 'กลุ่มสัตว์', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 20.08A3.5 3.5 0 0 1 5.5 15Z"/></svg>', items: ANIMAL_GROUP },
    { title: 'กลุ่มตรวจจับวัตถุทั่วไป', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>', items: GENERAL_GROUP },
  ].forEach(g => {
    const secEl = document.createElement('div');
    secEl.className = 'obj-group';
    const head = document.createElement('div');
    head.className = 'obj-group-head';
    head.innerHTML = g.icon + escapeHtml(g.title);
    secEl.appendChild(head);
    const wrap = document.createElement('div');
    wrap.className = 'obj-grid-items';
    g.items.forEach(obj => {
      const on = sel.has(obj);
      const needRestart = (obj === 'bus' || obj === 'truck') && !state.busTruckReady;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'obj-item' + (on ? ' on' : '');
      b.setAttribute('aria-pressed', String(on));
      b.title = needRestart ? obj + ' — ต้องรีสตาร์ทระบบก่อนจึงเลือกได้' : obj;
      b.textContent = LABEL_TH[obj] || obj;
      b.disabled = needRestart || (!on && full); // ที่เลือกอยู่กดออกได้เสมอ
      b.addEventListener('click', () => toggleObj(name, obj));
      wrap.appendChild(b);
    });
    secEl.appendChild(wrap);
    grid.appendChild(secEl);
  });
}

function toggleObj(name, obj) {
  const cur = new Set(state.objDraft[name] || []);
  // guard จริงอยู่ที่นี่ (ปุ่ม disabled อย่างเดียวไม่พอ — preset/โค้ดอื่นข้าม chip ได้)
  if (!cur.has(obj) && cur.size >= MAX_OBJECTS) {
    toast('เลือกได้สูงสุด ' + MAX_OBJECTS + ' ชนิดต่อกล้อง — เอาบางชนิดออกก่อน');
    return;
  }
  cur.has(obj) ? cur.delete(obj) : cur.add(obj);
  state.objDraft[name] = OBJECT_ORDER.filter(o => cur.has(o)); // เก็บตามลำดับคงที่
  recomputeObjDirty(name);
  renderObjGrid(); renderSyncMsg();
}

function setObjPreset(name, list) {
  if (!name) return;
  let lst = OBJECT_ORDER.filter(o => list.includes(o));
  if (!state.busTruckReady) lst = lst.filter(o => o !== 'bus' && o !== 'truck'); // ยังไม่ restart — ข้าม
  state.objDraft[name] = lst.slice(0, MAX_OBJECTS); // กัน preset เกินโควตา
  recomputeObjDirty(name);
  renderObjGrid(); renderSyncMsg();
}

function recomputeObjDirty(name) {
  const base = (state.objBase[name] || []).slice().sort().join(',');
  const draft = (state.objDraft[name] || []).slice().sort().join(',');
  if (base === draft) delete state.objDirty[name]; else state.objDirty[name] = true;
}

// Replace object.track through the bounded Config API. The caller keeps failed
// cameras dirty, while the server commits labels + detect.enabled atomically.
async function applyObjectChanges() {
  const names = Object.keys(state.objDirty).filter(name => name && name.trim());
  if (!names.length || cfg.demo || !SAME_ORIGIN) return { changed: 0, failed: 0, ok: true };
  let applied = 0;
  for (const name of names) {
    try {
      const track = state.objDraft[name] || [];
      const res = await fetch(`/api/public-config/cameras/${encodeURIComponent(name)}/objects`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track: track }),
        signal: timeoutSignal(30000),
      });
      if (res.ok) {
        state.objBase[name] = (state.objDraft[name] || []).slice();
        delete state.objDirty[name];
        applied++;
      } else {
        const errTxt = await res.text().catch(() => '');
        console.warn(`[applyObjectChanges] Failed for camera ${name}: HTTP ${res.status}`, errTxt);
      }
    } catch (e) {
      console.warn(`[applyObjectChanges] Network/Timeout error for camera ${name}:`, e);
      /* กล้องนี้ยังคงค้างใน objDirty (ผู้ใช้เห็นว่ายังไม่บันทึก) */
    }
  }
  return { changed: applied, failed: names.length - applied, ok: applied === names.length };
}

/**
 * Evaluate whether a camera's schedule permits AI detection right now in Asia/Bangkok (UTC+7).
 *
 * @param {Object} sched - Schedule object with enabled, start_time, end_time, days.
 * @returns {boolean} True when schedule is disabled (24h) or current time is inside window.
 */
function evaluateClientSchedule(sched) {
  if (!sched || !sched.enabled) return true;
  const days = Array.isArray(sched.days) && sched.days.length ? sched.days : [1, 2, 3, 4, 5, 6, 7];
  // Calculate current Asia/Bangkok (UTC+7) day and HH:MM
  const nowUtcMs = Date.now();
  const bkkDate = new Date(nowUtcMs + (7 * 60 * 60 * 1000));
  const jsDay = bkkDate.getUTCDay(); // 0=Sun..6=Sat
  const isoDay = jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun
  if (!days.includes(isoDay)) return false;

  const [sh, sm] = String(sched.start_time || '18:00').split(':').map(Number);
  const [eh, em] = String(sched.end_time || '06:00').split(':').map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return true;

  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  const nowMins = bkkDate.getUTCHours() * 60 + bkkDate.getUTCMinutes();

  if (startMins === endMins) return true;
  if (startMins < endMins) return nowMins >= startMins && nowMins <= endMins;
  return nowMins >= startMins || nowMins <= endMins;
}

/**
 * Render the Per-Camera AI Detection Schedule controls in the Settings modal.
 */
function renderAiSchedule() {
  const mainWrap = $('aiSchedMainWrap');
  const noteEl = $('aiSchedNote');
  if (!mainWrap || !noteEl) return;

  const name = selectedCamName();
  const isReal = !!(name && state.frigateCams && state.frigateCams.has(name));
  const chDraft = (state.draft || cfg.channels)[state.selCh];
  const dt = !!(chDraft && chDraft.detect !== false);

  const btnNight = $('btnSchedPresetNight');
  const btnLate = $('btnSchedPresetLate');
  const btnWork = $('btnSchedPresetWork');
  const btn24h = $('btnSchedPreset24h');
  if (btnNight) btnNight.disabled = !isReal || !dt;
  if (btnLate) btnLate.disabled = !isReal || !dt;
  if (btnWork) btnWork.disabled = !isReal || !dt;
  if (btn24h) btn24h.disabled = !isReal || !dt;

  const showNote = (msg) => {
    mainWrap.hidden = true;
    noteEl.hidden = false;
    noteEl.textContent = msg;
  };

  if (cfg.demo) return showNote('โหมดสาธิต — ตั้งเวลาตรวจจับจริงไม่ได้');
  if (!SAME_ORIGIN) return showNote('ตั้งค่าได้เมื่อเปิดผ่านหน้าเว็บ dashboard เท่านั้น');
  if (!name) return showNote('เลือกกล้องจาก NVR สำหรับช่องนี้ก่อน');
  if (chDraft && chDraft.detect === false) {
    return showNote('AI ปิดอยู่ — คลิกปุ่ม "AI ปิด" ด้านบนให้เป็น "AI เปิด" ก่อนกำหนดช่วงเวลา');
  }
  if (!state.frigateCams) return showNote('กำลังโหลดตารางเวลาจากระบบ…');
  if (!isReal) return showNote('กล้อง "' + name + '" ยังไม่มีในระบบ NVR');

  mainWrap.hidden = false;
  noteEl.hidden = true;

  if (!state.schedDraft) state.schedDraft = {};
  if (!state.schedBase) state.schedBase = {};
  if (!state.schedDraft[name]) {
    state.schedDraft[name] = cloneSchedEntry(state.schedBase[name] || DEFAULT_AI_SCHED);
  }
  const sched = state.schedDraft[name];

  initAll24hSelects();

  const chk = $('chkAiSchedEnabled');
  const inpStart = $('inpAiSchedStart');
  const inpEnd = $('inpAiSchedEnd');
  const selStartH = $('selAiSchedStartH');
  const selStartM = $('selAiSchedStartM');
  const selEndH = $('selAiSchedEndH');
  const selEndM = $('selAiSchedEndM');
  const controls = $('aiSchedControls');
  const overnightTag = $('aiSchedOvernightTag');
  const badge = $('aiSchedStatusBadge');

  if (chk) chk.checked = !!sched.enabled;

  const [shRaw, smRaw] = String(sched.start_time || '18:00').split(':');
  const [ehRaw, emRaw] = String(sched.end_time || '06:00').split(':');
  const shPadded = String(shRaw || '18').padStart(2, '0');
  const smPadded = String(smRaw || '00').padStart(2, '0');
  const ehPadded = String(ehRaw || '06').padStart(2, '0');
  const emPadded = String(emRaw || '00').padStart(2, '0');

  if (selStartH) selStartH.value = shPadded;
  if (selStartM) selStartM.value = smPadded;
  if (selEndH) selEndH.value = ehPadded;
  if (selEndM) selEndM.value = emPadded;

  if (inpStart) inpStart.value = `${shPadded}:${smPadded}`;
  if (inpEnd) inpEnd.value = `${ehPadded}:${emPadded}`;

  if (controls) controls.classList.toggle('dimmed', !sched.enabled);

  // Check if overnight (start > end)
  const isOvernight = (Number(shPadded) * 60 + Number(smPadded)) > (Number(ehPadded) * 60 + Number(emPadded));
  if (overnightTag) overnightTag.hidden = !isOvernight;

  // Update day buttons
  const daysSet = new Set(Array.isArray(sched.days) ? sched.days.map(Number) : [1, 2, 3, 4, 5, 6, 7]);
  document.querySelectorAll('#aiSchedDaysWrap .ai-sched-day-btn').forEach(btn => {
    const d = Number(btn.dataset.day);
    const on = daysSet.has(d);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  });

  // Update live status badge
  if (badge) {
    if (!sched.enabled) {
      badge.className = 'ai-sched-badge mode-24h';
      badge.textContent = '🕒 ทำงานตลอด 24 ชม.';
    } else {
      const inWin = evaluateClientSchedule(sched);
      if (inWin) {
        badge.className = 'ai-sched-badge mode-active';
        badge.textContent = `🟢 อยู่ในช่วงเวลาตรวจจับ (${sched.start_time}–${sched.end_time} น.)`;
      } else {
        badge.className = 'ai-sched-badge mode-paused';
        badge.textContent = `⏸️ อยู่นอกช่วงเวลา — AI พักการทำงาน (เริ่ม ${sched.start_time} น.)`;
      }
    }
  }
}

function serializeSched(s) {
  const c = cloneSchedEntry(s);
  return `${c.enabled ? 1 : 0}|${c.start_time}|${c.end_time}|${c.days.join(',')}`;
}

function recomputeSchedDirty(name) {
  if (!name) return;
  if (!state.schedDirty) state.schedDirty = {};
  const base = serializeSched((state.schedBase && state.schedBase[name]) || DEFAULT_AI_SCHED);
  const draft = serializeSched((state.schedDraft && state.schedDraft[name]) || DEFAULT_AI_SCHED);
  if (base === draft) delete state.schedDirty[name];
  else state.schedDirty[name] = true;
}

function setSchedPreset(name, preset) {
  if (!name) return;
  if (!state.schedDraft) state.schedDraft = {};
  state.schedDraft[name] = cloneSchedEntry(preset);
  recomputeSchedDirty(name);
  renderAiSchedule();
  renderSyncMsg();
}

/**
 * Persist modified per-camera AI schedules to config-api and sync runtime detect state.
 */
async function applyScheduleChanges() {
  const names = Object.keys(state.schedDirty || {}).filter(n => n && n.trim());
  if (!names.length || cfg.demo || !SAME_ORIGIN) return { changed: 0, failed: 0, ok: true };
  let applied = 0;
  for (const name of names) {
    try {
      const payload = cloneSchedEntry(state.schedDraft[name] || DEFAULT_AI_SCHED);
      const res = await fetch(`/api/public-config/cameras/${encodeURIComponent(name)}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: timeoutSignal(15000),
      });
      if (res.ok) {
        const resData = await res.json().catch(() => ({}));
        state.schedBase[name] = cloneSchedEntry(payload);
        delete state.schedDirty[name];
        if (typeof resData.runtime_detect_enabled === 'boolean') {
          await sendFrigateWsCommands([
            { topic: `${name}/detect/set`, payload: resData.runtime_detect_enabled ? 'ON' : 'OFF' },
          ]);
        }
        applied++;
      } else {
        const errTxt = await res.text().catch(() => '');
        console.warn(`[applyScheduleChanges] Failed for camera ${name}: HTTP ${res.status}`, errTxt);
      }
    } catch (e) {
      console.warn(`[applyScheduleChanges] Network/Timeout error for camera ${name}:`, e);
    }
  }
  return { changed: applied, failed: names.length - applied, ok: applied === names.length };
}

// เปิด/ปิดกล้องที่ Frigate — ใช้ camera-level `enabled` (ปิดลึกจริง: หยุด ffmpeg/decode/
// transcode/detection/record → คืน GPU). กลไกนี้มีผลเฉพาะตอน Frigate restart (camera/maintainer
// เช็ค enabled_in_config ตอน spawn process เท่านั้น) → saveSettings จะสั่ง restart ให้หลัง apply.
// Config API persists lifecycle state only; saveSettings restarts once after all
// sequential mutations, avoiding concurrent restarts and partial UI success.
async function applyEnabledChanges(changes) {
  if (!changes.length || cfg.demo || !SAME_ORIGIN) return { changed: 0, failed: 0 };
  let applied = 0;
  for (const c of changes) {
    try {
      // Re-enable restores the detector preference from authoritative camera data.
      // The server also enables recording with an enabled camera and stops it
      // with a disabled camera, so storage never records an inactive channel.
      let shouldDetect = false;
      if (c.enabled) {
        shouldDetect = c.detect === true;
      }
      let res = null;
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          res = await fetch(`/api/config/cameras/${encodeURIComponent(c.name)}/enabled`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enabled: c.enabled,
              detect_enabled: c.enabled ? shouldDetect : null,
            }),
            signal: timeoutSignal(30000),
          });
          if (res.status === 503 && attempt < 2) {
            await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
            continue;
          }
          break;
        } catch (netErr) {
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
            continue;
          }
          throw netErr;
        }
      }
      if (res && (res.ok || res.status === 404)) applied++;
      else {
        const errTxt = res ? await res.text().catch(() => '') : '';
        console.warn(`[applyEnabledChanges] Failed for camera ${c.name}: HTTP ${res ? res.status : 'unknown'}`, errTxt);
      }
    } catch (e) {
      console.warn(`[applyEnabledChanges] Network/Timeout error for camera ${c.name}:`, e);
      /* กล้องนี้ยังปรับที่ Frigate ไม่สำเร็จ */
    }
  }
  return { changed: applied, failed: changes.length - applied };
}

function markDirty(i) { state.dirty[i] = true; renderSyncMsg(); renderChList(); }
function renderSyncMsg() {
  // นับรวม lprDirty และ schedDirty ด้วย — สถานะเปิด LPR และตารางเวลา AI รายกล้องเป็น pending change
  const n = Object.keys(state.dirty).length + (state.connDirty ? 1 : 0) + (state.storageDirty ? 1 : 0) + Object.keys(state.objDirty).length + Object.keys(state.schedDirty || {}).length + (state.lprDirty ? 1 : 0);
  const el = $('syncMsg');
  el.className = 'sync-msg' + (n ? ' warn' : '');
  el.textContent = n ? `แก้ไขแล้ว ${n} รายการ — ยังไม่บันทึก` : '';
}

function resetTestBtn(b) { b.className = 'test-btn'; b.textContent = 'ทดสอบ'; }

async function runTest(btn, src, chAtStart) {
  // ผลทดสอบผูกกับ channel ที่กดตอนเริ่ม — ถ้าสลับ channel ระหว่างรอ อย่าเอาผลไปแปะปุ่มของ channel อื่น
  const stale = () => state.selCh !== chAtStart || $('settingsOverlay').hidden;
  if (!src) { btn.className = 'test-btn fail'; btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> ล้มเหลว'; return; }
  btn.className = 'test-btn testing'; btn.textContent = 'กำลังทดสอบ…';
  if (cfg.demo) {
    setTimeout(() => { if (stale()) return; btn.className = 'test-btn ok'; btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><polyline points="20 6 9 17 4 12"></polyline></svg> สำเร็จ'; }, 900);
    return;
  }
  try {
    // ดึงภาพนิ่งจาก go2rtc ผ่าน Frigate proxy — 200 อย่างเดียวไม่พอ ต้องมีเนื้อภาพจริง
    const base = $('inpBase').value.trim().replace(/\/+$/, '');
    const res = await fetch(base + '/api/frame.jpeg?src=' + encodeURIComponent(src), { signal: timeoutSignal(15000) });
    const blob = await res.blob();
    if (!res.ok || blob.size < 1000) throw new Error();
    if (stale()) return;
    btn.className = 'test-btn ok'; btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><polyline points="20 6 9 17 4 12"></polyline></svg> สำเร็จ';
  } catch (e) {
    if (stale()) return;
    btn.className = 'test-btn fail'; btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> ล้มเหลว';
  }
}

/**
 * Persist the shared camera-ID-to-display-name map through the admin endpoint.
 *
 * @returns {Promise<boolean>} True after a durable write, or no-op success in
 * demo/cross-origin modes. A failed response is never silently treated as saved.
 */
async function saveCameraDisplayNames() {
  if (cfg.demo || !SAME_ORIGIN) return true;
  let mergedNames = { ...DEFAULT_SPECIAL_CAMERA_NAMES, ...(state.cameraNames || {}) };
  try {
    const curRes = await fetch('/settings/camera_names?t=' + Date.now());
    if (curRes.ok) {
      const serverNames = await curRes.json();
      mergedNames = { ...DEFAULT_SPECIAL_CAMERA_NAMES, ...(serverNames || {}), ...(state.cameraNames || {}) };
      state.cameraNames = mergedNames;
    }
  } catch (e) {}
  const response = await fetch('/settings/admin/camera_names', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mergedNames),
    signal: timeoutSignal(8000)
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return true;
}

// Persist the complete Dashboard channel map through the admin-only WebDAV
// endpoint. The function has no inputs, returns true after a durable server
// write, and throws a Thai operator-facing error on authorization/network
// failure; demo and cross-origin sessions intentionally perform no side effect.
async function saveServerChannels() {
  if (cfg.demo || !SAME_ORIGIN) return true;
  try {
    // Save names before channels so a refreshed dashboard never renders a newly
    // selected source with an outdated display name.
    await saveCameraDisplayNames();
    
    // ADR-0019: Use state.draft if present (System Master Grid draft from Settings modal)
    // to decouple from client's active cfg.channels (which may be a Personal User Grid)
    const payload = (state.draft && state.draft.length) ? state.draft : cfg.channels;
    const res = await fetch('/settings/admin/channels', {
      method: 'PUT', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), 
      signal: timeoutSignal(8000) 
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.masterChannels = payload.map(c => ({ ...c }));
    return true;
  } catch (e) {
    throw new Error('ไม่สามารถบันทึกรายการกล้องส่วนกลางลงเซิร์ฟเวอร์ได้ (' + e.message + ')');
  }
}

// applyBatchAction — ใช้หลังจาก updateAllChannels() ปรับ cfg.channels แล้ว
// บันทึกลงเซิร์ฟเวอร์ + sync ไป Frigate + restart ถ้าจำเป็น + อัปเดต Dashboard grid
window.applyBatchAction = async function applyBatchAction(type) {
  const m = $('syncMsg');
  m.className = 'sync-msg busy';
  m.textContent = 'กำลังบันทึกและปรับใช้การตั้งค่า…';

  try {
    // 1. sync state.draft ให้ตรงกับ cfg.channels เสมอ (สร้างใหม่เลยถ้าไม่มี)
    state.draft = cfg.channels.map(c => ({ ...c }));

    // 2. บันทึกลง localStorage + Server
    saveCfg();
    await saveServerChannels();

    // 3. รวบรวมสถานะแบบ OR สำหรับแหล่งวิดีโอ (Source) ที่ถูกใช้ในหลายช่อง
    const srcMap = {};
    cfg.channels.filter(c => c.src).forEach(c => {
      const en = c.enabled !== false;
      const det = c.detect !== false;
      if (!srcMap[c.src]) srcMap[c.src] = { enabled: false, detect: false };
      srcMap[c.src].enabled = srcMap[c.src].enabled || en;
      srcMap[c.src].detect = srcMap[c.src].detect || (en && det);
    });
    const changes = Object.keys(srcMap).map(src => ({ 
      name: src, 
      enabled: srcMap[src].enabled,
      detect: srcMap[src].detect
    }));

    const enRes = await applyEnabledChanges(changes);

    // 4. ซิงค์ detect roles
    let rolesChanged = false;
    try {
      const active = Object.keys(srcMap).filter(src => srcMap[src].enabled);
      const rRes = await fetch('/api/config/sync_detect_roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_cameras: active })
      });
      if (rRes.ok) { const rd = await rRes.json(); rolesChanged = rd.changed === true; }
    } catch (e) { console.error('sync detect roles failed', e); }

    // 5. Restart Frigate ถ้ามีการเปลี่ยนแปลง
    if (enRes.changed > 0 || rolesChanged) {
      m.textContent = 'กำลังรีสตาร์ทเอนจิน AI…';
      try {
        await restartFrigate();
        await waitForCamera((cfg.channels.find(c => c.src) || {}).src || '', 20000);
      } catch (e) { console.error('Restart failed (ok):', e); }
    }

    // 6. อัปเดต Dashboard grid และ Modal form ให้สัมพันธ์กับ cfg.channels ที่เปลี่ยนแปลง
    applyAutoLayout(true);
    rebuildGrid();
    fetchEvents();
    renderChList();
    renderChForm(); // อัปเดตปุ่มสถานะกล้องใน Tab 2 ให้แสดงสถานะที่ถูกต้อง

    // 7. แสดงผลลัพธ์
    const enabledCount = cfg.channels.filter(c => c.src && c.enabled !== false).length;
    const totalCount = cfg.channels.filter(c => c.src).length;
    if (type === 'ai') {
      const aiOnCount = cfg.channels.filter(c => c.src && c.detect !== false && c.enabled !== false).length;
      m.className = 'sync-msg done';
      m.textContent = `ปรับ AI เรียบร้อย — เปิด ${aiOnCount} ช่อง`;
      if (window.bppToast) window.bppToast(`ปรับ AI เรียบร้อย — เปิด ${aiOnCount} ช่อง`);
    } else {
      m.className = 'sync-msg done';
      m.textContent = `บันทึกสำเร็จ — กล้องเปิดใช้งาน ${enabledCount}/${totalCount} ช่อง`;
      if (window.bppToast) window.bppToast(`บันทึกสำเร็จ — กล้องเปิดใช้งาน ${enabledCount}/${totalCount} ช่อง`);
    }
  } catch (err) {
    console.error('applyBatchAction error:', err);
    m.className = 'sync-msg warn';
    m.textContent = 'บันทึกไม่สำเร็จ: ' + err.message;
    if (window.bppToast) window.bppToast('บันทึกไม่สำเร็จ: ' + err.message, true);
  }
};

function saveSettings() {
  const saveBtn = $('btnSave');
  if (saveBtn.classList.contains('busy')) return;

  saveBtn.classList.add('busy');
  const spinEl = $('saveSpin');
  if (spinEl) { spinEl.hidden = false; spinEl.style.display = 'inline-block'; }
  $('saveLabel').textContent = 'กำลังบันทึก…';
  const syncSpinEl = $('syncSpin');
  if (syncSpinEl) { syncSpinEl.hidden = false; syncSpinEl.style.display = 'inline-block'; }
  const m = $('syncMsg'); 
  m.className = 'sync-msg busy';
  m.textContent = 'กำลังบันทึกการตั้งค่า…';

  (async () => {
    let successSteps = [];
    let errorDetails = [];

    try {
      // ADR-0024: Global Layout Broadcast needs an explicit confirmation before anything is saved
      const broadcastRequested = userRole === 'superadmin' && !state.impersonatingUser &&
        !!($('chkBroadcastGrid') && $('chkBroadcastGrid').checked);
      if (broadcastRequested) {
        await refreshUserProfilesCache();
        const n = countAccountsWithGrid();
        if (!await window.bppConfirm(`กระจายผังนี้ไปยังบัญชีผู้ใช้ทุกคน\n\nผังของ ${n} บัญชีที่มีผังของตัวเองจะถูกแทนที่ด้วยผังนี้ (กล้อง ชื่อ สตรีม AI LPR)\nบัญชีอื่นจะได้รับผังนี้ผ่านผังแม่แบบระบบ ผังของคุณไม่ถูกเปลี่ยน\nผู้ใช้ที่ออนไลน์จะเห็นผลภายใน 1 นาที\n\nยืนยันดำเนินการ?`)) {
          m.className = 'sync-msg';
          m.textContent = 'ยกเลิกการกระจายผัง';
          return;
        }
      }

      // 1. บันทึกโปรไฟล์มุมมองกล้องส่วนตัว (Personal Profile: Layout, Visible/Hidden Channels)
      await saveUserProfile();
      successSteps.push('มุมมองกล้องส่วนตัว');

      // 2. บันทึกการแจ้งเตือนส่วนตัว (My Alerts) — บันทึกเฉพาะเมื่อโหลดสำเร็จและมีการแก้ไขหรือเปิดอยู่บนหน้า Tab 4
      const isTabMyAlertsVisible = !!(document.getElementById('tabMyAlerts') && document.getElementById('tabMyAlerts').style.display !== 'none' && !document.getElementById('tabMyAlerts').hidden);
      if (state.myAlertsLoaded && (state.myAlertsDirty || isTabMyAlertsVisible)) {
        try {
          await saveMyAlertsSettings();
          successSteps.push('การแจ้งเตือนส่วนตัว');
        } catch (e) {
          errorDetails.push('ไม่สามารถบันทึกการแจ้งเตือนส่วนตัวได้');
        }
      }

      // 3. จัดการระบบ NVR ส่วนกลาง (เฉพาะ Superadmin เท่านั้น)
      const curUser = (window.bppSession && window.bppSession.username) || '';
      const curRole = (window.bppSession && window.bppSession.role) || (typeof userRole !== 'undefined' ? userRole : '') || '';
      const isSuperAdmin = (curRole === 'superadmin' || curRole === 'admin') || ['arm215', 'suchakree', 'bpp215'].includes(curUser);

      // ADR-0021: Always synchronize Tab 2 draft back to active screen & user profile
      if (state.draft && state.draft.length) {
        const affectedCams = new Set();
        state.draft.forEach(c => { if (c && c.src) affectedCams.add(c.src); });
        if (state.impersonatingUser) {
          const targetProf = state.allUserProfilesCache?.[state.impersonatingUser] || {};
          ((targetProf && targetProf.channels) || []).forEach(c => { if (c && c.src) affectedCams.add(c.src); });
          targetProf.channels = state.draft.map(c => ({ ...c }));
          const disabledSet = new Set(targetProf.disabled_ai_cameras || []);
          targetProf.channels.forEach(c => {
            if (!c || !c.src) return;
            if (c.detect === false) disabledSet.add(c.src);
            else if (c.detect === true) disabledSet.delete(c.src);
          });
          targetProf.disabled_ai_cameras = Array.from(disabledSet);
          try {
            await fetch('/api/nas-bot/admin/user-profile/' + encodeURIComponent(state.impersonatingUser), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(targetProf)
            });
            await refreshUserProfilesCache();
            const counts = await fetchAiDemandCounts();
            if (counts) {
              for (const cam of affectedCams) {
                const wantOn = (counts[cam] || 0) > 0;
                if (!wantOn || wantOn !== liveFrigateAiOn(cam)) {
                  await setFrigateAi(cam, wantOn);
                }
              }
            }
            if (Object.keys(state.objDirty || {}).length > 0) {
              const objRes = await applyObjectChanges();
              if (objRes.failed > 0) {
                errorDetails.push(`ปรับตั้งค่า AI ตรวจจับวัตถุไม่สำเร็จ ${objRes.failed} ช่อง`);
              }
            }
            if (Object.keys(state.schedDirty || {}).length > 0) {
              const schedRes = await applyScheduleChanges();
              if (schedRes.failed > 0) {
                errorDetails.push(`บันทึกตารางเวลาตรวจจับ AI ไม่สำเร็จ ${schedRes.failed} ช่อง`);
              } else if (schedRes.changed > 0) {
                successSteps.push('ตารางเวลาตรวจจับ AI');
              }
            }
            triggerDemandReconciliation(false);
            successSteps.push(`ผังหน้าจอของ ${state.impersonatingUser}`);
          } catch(e) {
             errorDetails.push(`ไม่สามารถบันทึกผังหน้าจอของ ${state.impersonatingUser} ได้`);
          }
        } else {
          cfg.channels = state.draft.map(c => ({ ...c }));
          saveCfg();
          if (!state.userProfile) state.userProfile = {};
          state.userProfile.channels = cfg.channels.map(c => ({ ...c }));
          const disabledSet = new Set(state.userProfile.disabled_ai_cameras || []);
          cfg.channels.forEach(c => {
            if (!c || !c.src) return;
            if (c.detect === false) disabledSet.add(c.src);
            else if (c.detect === true) disabledSet.delete(c.src);
          });
          state.userProfile.disabled_ai_cameras = Array.from(disabledSet);
          try {
            await saveUserProfile();
            const counts = await fetchAiDemandCounts();
            if (counts) {
              for (const cam of affectedCams) {
                const wantOn = (counts[cam] || 0) > 0;
                if (!wantOn || wantOn !== liveFrigateAiOn(cam)) {
                  await setFrigateAi(cam, wantOn);
                }
              }
            }
            if (Object.keys(state.objDirty || {}).length > 0) {
              const objRes = await applyObjectChanges();
              if (objRes.failed > 0) {
                errorDetails.push(`ปรับตั้งค่า AI ตรวจจับวัตถุไม่สำเร็จ ${objRes.failed} ช่อง`);
              }
            }
            if (Object.keys(state.schedDirty || {}).length > 0) {
              const schedRes = await applyScheduleChanges();
              if (schedRes.failed > 0) {
                errorDetails.push(`บันทึกตารางเวลาตรวจจับ AI ไม่สำเร็จ ${schedRes.failed} ช่อง`);
              } else if (schedRes.changed > 0) {
                successSteps.push('ตารางเวลาตรวจจับ AI');
              }
            }
            triggerDemandReconciliation(false);
          } catch (e) {
            console.warn('saveUserProfile in saveSettings error:', e);
          }
        }
      }

      const isImpersonating = !!state.impersonatingUser;
      const propagateMaster = !isImpersonating && !!($('chkPropagateMaster') && $('chkPropagateMaster').checked);

      if (isSuperAdmin && !isImpersonating) {
        cfg.base = $('inpBase').value.trim() || DEFAULTS.base;
        cfg.api = $('inpApi').value.trim() || DEFAULTS.api;
        cfg.demo = $('inpDemo').checked;

        // ADR-0021: Explicit Admin Master Grid Propagation
        if (propagateMaster) {
          try {
            await saveServerChannels();
            successSteps.push('ผังแม่แบบระบบส่วนกลาง (System Master Grid)');
          } catch (e) {
            errorDetails.push(e.message);
          }
        }

        // ADR-0024: Global Layout Broadcast (Superadmin, confirmed above)
        if (broadcastRequested) {
          try {
            m.textContent = 'กำลังกระจายผังไปยังทุกบัญชี…';
            if (!propagateMaster) await saveServerChannels(); // grid-less accounts inherit the master grid
            const bres = await fetch('/api/nas-bot/admin/grid/broadcast', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ channels: (state.draft && state.draft.length ? state.draft : cfg.channels).map(c => ({ ...c })) }),
            });
            if (!bres.ok) throw new Error('HTTP ' + bres.status);
            const bdata = await bres.json();
            const aiFailed = await applyAiDeltaToFrigate(bdata);
            await refreshUserProfilesCache();
            successSteps.push(`กระจายผังไปยัง ${(bdata.updated_users || []).length} บัญชี`);
            if (aiFailed > 0) errorDetails.push(`ปรับ AI ใน Frigate ไม่สำเร็จ ${aiFailed} กล้อง`);
            if (window.bppToast) window.bppToast(`กระจายผังไปยัง ${(bdata.updated_users || []).length} บัญชีเรียบร้อย — ผู้ใช้ที่ออนไลน์จะได้รับภายใน 1 นาที`);
          } catch (e) {
            errorDetails.push('กระจายผังไม่สำเร็จ: ' + e.message);
          }
          if ($('chkBroadcastGrid')) $('chkBroadcastGrid').checked = false;
        }

        try { saveStorageThreshold(); } catch (e) {}
        let lprStreamsChanged = false;
        try { lprStreamsChanged = await saveLprCameras(); } catch (e) {}

        const prov = await provisionNewCameras();

        // ดำเนินการ Reconfigure กล้อง Frigate และ sync detect roles เฉพาะเมื่อ:
        // 1. มีการติ๊ก อัปเดตผังแม่แบบระบบส่วนกลาง (propagateMaster), หรือ
        // 2. มีการแก้ไขการตรวจจับวัตถุใน Tab 1 (state.objDirty), หรือ
        // 3. มีการแก้ไขกล้องระบบส่วนกลางใน Tab 1 (state.dirty), หรือ
        // 4. มีการเพิ่มกล้อง RTSP ใหม่ (prov.provisioned > 0)
        const hasSysCameraEdits = propagateMaster ||
                                 (Object.keys(state.dirty || {}).length > 0) ||
                                 (Object.keys(state.objDirty || {}).length > 0) ||
                                 (prov && prov.provisioned > 0);

        if (hasSysCameraEdits) {
          const srcMap = {};
          const channelsForIngest = (state.draft && state.draft.length) ? state.draft : cfg.channels;
          channelsForIngest.forEach(c => {
            if (c.src) {
              const en = c.enabled !== false;
              const isCore = ['D_BPP215_1', 'D_BPP215_2', 'D_BPP215_3'].includes(c.src);
              const det = isCore ? true : (c.detect === true);
              if (!srcMap[c.src]) srcMap[c.src] = { enabled: false, detect: false };
              srcMap[c.src].enabled = srcMap[c.src].enabled || en;
              srcMap[c.src].detect = srcMap[c.src].detect || (en && det);
            }
          });
          if (propagateMaster && Array.isArray(state.nvrCameras) && state.nvrCameras.length) {
            state.nvrCameras.forEach(nc => {
              const camName = nc && nc.name;
              if (camName && !srcMap[camName] && nc.enabled === true) {
                const isCore = ['D_BPP215_1', 'D_BPP215_2', 'D_BPP215_3'].includes(camName);
                if (!isCore) {
                  srcMap[camName] = { enabled: false, detect: false };
                }
              }
            });
          }
          const allChanges = Object.keys(srcMap).map(src => ({ 
            name: src, 
            enabled: srcMap[src].enabled,
            detect: srcMap[src].detect
          }));

          // กรองเฉพาะกล้องที่สถานะเปิด/ปิด หรือ AI เปลี่ยนแปลงไปจากค่า authoritative ใน state.nvrCameras
          const enabledChanges = allChanges.filter(c => {
            if (Array.isArray(state.nvrCameras) && state.nvrCameras.length) {
              const live = state.nvrCameras.find(nc => nc.name === c.name);
              if (live) {
                const liveEnabled = live.enabled === true;
                const liveDetect = live.ai_enabled === true;
                const targetDetect = c.enabled ? (c.detect !== undefined ? c.detect : true) : false;
                if (liveEnabled === c.enabled && (c.enabled ? (liveDetect === targetDetect) : true)) {
                  return false;
                }
              } else if (!c.enabled) {
                return false;
              }
            }
            return true;
          });

          const objRes = await applyObjectChanges();
          const enRes = await applyEnabledChanges(enabledChanges);

          if (enRes.failed > 0) {
            errorDetails.push(`ปรับสถานะเปิด/ปิดกล้องที่ Frigate ไม่สำเร็จ ${enRes.failed} ช่อง`);
          }
          if (objRes.failed > 0) {
            errorDetails.push(`ปรับตั้งค่า AI ตรวจจับวัตถุไม่สำเร็จ ${objRes.failed} ช่อง`);
          }

          let rolesChanged = false;
          try {
            const active_cameras = channelsForIngest.filter(c => c.enabled !== false && c.src).map(c => c.src);
            const roleRes = await fetch('/api/config/sync_detect_roles', { 
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ active_cameras: active_cameras })
            });
            if (roleRes.ok) {
              const roleData = await roleRes.json();
              rolesChanged = roleData.changed === true;
            }
          } catch (e) {
            console.error('sync detect roles failed', e);
          }

          const needRestart = (enRes.changed > 0) || (objRes.changed > 0) || rolesChanged || (prov && prov.provisioned > 0);
          if (needRestart) {
            m.textContent = 'กำลังรีสตาร์ทเอนจิน AI…';
            try {
              await restartFrigate();
              await waitForCamera((cfg.channels.find(c => c.src) || {}).src || '', 15000);
            } catch (e) {
              console.error('Restart failed (ok):', e);
            }
          }
        }
      }

      // อัปเดต UI หน้าจอ
      applyAutoLayout(true);
      rebuildGrid();
      fetchEvents();
      state.dirty = {}; 
      state.connDirty = false;
      renderChList();
      renderChForm();
      renderObjGrid();
      renderAiSchedule();

      // สรุปรายงานตามความเป็นจริง 100%
      if (errorDetails.length > 0) {
        m.className = 'sync-msg warn';
        const errTxt = errorDetails.join(' | ');
        m.textContent = 'บันทึกไม่สำเร็จบางส่วน: ' + errTxt;
        if (window.bppToast) window.bppToast('บันทึกไม่สำเร็จบางส่วน: ' + errTxt, true);
        else toast('บันทึกไม่สำเร็จบางส่วน: ' + errTxt, true);
      } else {
        m.className = 'sync-msg done';
        m.textContent = 'บันทึกการตั้งค่าทั้งหมดสำเร็จเรียบร้อยแล้ว';
        if (window.bppToast) window.bppToast('บันทึกการตั้งค่าทั้งหมดสำเร็จเรียบร้อยแล้ว');
        else toast('บันทึกการตั้งค่าสำเร็จ');
      }

    } catch (err) {
      console.error('saveSettings critical error:', err);
      m.className = 'sync-msg warn';
      m.textContent = 'บันทึกไม่สำเร็จ: ' + err.message;
      if (window.bppToast) window.bppToast('บันทึกไม่สำเร็จ: ' + err.message, true);
      else toast('บันทึกไม่สำเร็จ: ' + err.message, true);
    } finally {
      saveBtn.classList.remove('busy');
      const spinEl = $('saveSpin');
      if (spinEl) { spinEl.hidden = true; spinEl.style.display = 'none'; }
      $('saveLabel').textContent = 'บันทึก';
      const syncSpinEl = $('syncSpin');
      if (syncSpinEl) { syncSpinEl.hidden = true; syncSpinEl.style.display = 'none'; }
    }
  })();
}

function reconnectAll() {
  state.reconnecting = true;
  $('btnReconnect').classList.add('spinning', 'on');
  rebuildGrid();
  fetchEvents();
  setTimeout(() => {
    state.reconnecting = false;
    $('btnReconnect').classList.remove('spinning', 'on');
  }, 1200);
}

/* ============ event bindings ============ */
function bind() {
  if (window.innerWidth <= 899) setEventsOpen(false);
  const btnMobileMenu = $('btnMobileMenu');
  if (btnMobileMenu) {
    btnMobileMenu.addEventListener('click', () => {
      document.querySelector('.topbar').classList.toggle('topbar-expanded');
    });
  }

  // Logout is a server-side cookie invalidation. The browser cannot clear an
  // HttpOnly cookie itself, so always complete the endpoint before redirecting.
  const logoutButton = $('btnLogout');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      try {
        await fetch('/api/nas-bot/user/logout', { method: 'POST' }).catch(() => {});
        await fetch('/auth/logout', { method: 'POST' });
      } finally {
        window.location.replace('/login.html');
      }
    });
  }
  const searchInput = $('searchInput');
  const btnSearchClear = $('btnSearchClear');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      state.query = e.target.value;
      if (btnSearchClear) btnSearchClear.hidden = !e.target.value;
      applySearch();
    });
    if (btnSearchClear) {
      btnSearchClear.addEventListener('click', () => {
        searchInput.value = '';
        state.query = '';
        btnSearchClear.hidden = true;
        searchInput.focus();
        applySearch();
      });
    }
  }

  function updateResponsiveSearchPlaceholders() {
    if (searchInput) {
      if (window.innerWidth <= 640) {
        searchInput.placeholder = 'ค้นหากล้อง...';
      } else if (window.innerWidth <= 1240) {
        searchInput.placeholder = 'ค้นหากล้อง / ช่อง...';
      } else {
        searchInput.placeholder = 'ค้นหากล้อง / ช่อง / ตำแหน่ง';
      }
    }
    const emgrIn = $('emgrSearch');
    if (emgrIn) {
      if (window.innerWidth <= 640) {
        emgrIn.placeholder = 'ค้นหาเหตุการณ์...';
      } else {
        emgrIn.placeholder = 'ค้นหา — คำอธิบาย / ชนิด / กล้อง';
      }
    }
    const wlIn = $('wlSearch');
    if (wlIn) {
      if (window.innerWidth <= 640) {
        wlIn.placeholder = 'ค้นหาทะเบียน...';
      } else {
        wlIn.placeholder = 'ค้นหาทะเบียน / ชื่อ / เครือข่าย';
      }
    }
  }
  window.addEventListener('resize', updateResponsiveSearchPlaceholders, { passive: true });
  try { updateResponsiveSearchPlaceholders(); } catch (e) {}

  // ---- Events Rail & Backdrop Dismiss ----
  try {
    $('btnEvents')?.addEventListener('click', () => setEventsOpen($('eventsRail')?.hidden));
    $('btnHideEvents')?.addEventListener('click', () => setEventsOpen(false));
    $('railTab')?.addEventListener('click', () => setEventsOpen(true));

    // Incident 2.172: Mobile Events Drawer Backdrop Dismiss & Swipe-to-Close
    const eventsBackdrop = $('eventsBackdrop');
    if (eventsBackdrop) {
      eventsBackdrop.addEventListener('click', () => setEventsOpen(false));
    }
    document.addEventListener('click', e => {
      if (window.innerWidth <= 899 && $('eventsRail') && !$('eventsRail').hidden) {
        if (!e.target.closest('#eventsRail') && !e.target.closest('#btnEvents') && !e.target.closest('#railTab') && !e.target.closest('#eventsBackdrop')) {
          setEventsOpen(false);
        }
      }
    });
    const railEl = $('eventsRail');
    if (railEl) {
      let tStartX = 0;
      let tStartY = 0;
      railEl.addEventListener('touchstart', e => {
        if (e.touches && e.touches[0]) {
          tStartX = e.touches[0].clientX;
          tStartY = e.touches[0].clientY;
        }
      }, { passive: true });
      railEl.addEventListener('touchend', e => {
        if (e.changedTouches && e.changedTouches[0]) {
          const dx = e.changedTouches[0].clientX - tStartX;
          const dy = e.changedTouches[0].clientY - tStartY;
          if (window.innerWidth <= 899 && dx > 45 && Math.abs(dx) > Math.abs(dy)) {
            setEventsOpen(false);
          }
        }
      }, { passive: true });
    }
    // เลือก class โฟกัสของแถบเหตุการณ์
    $('btnRailClasses')?.addEventListener('click', () => {
      const pop = $('railClassPop');
      if (!pop) return;
      pop.hidden = !pop.hidden;
      $('btnRailClasses')?.setAttribute('aria-expanded', String(!pop.hidden));
      if (!pop.hidden) renderRailClassPop();
    });
    document.addEventListener('click', e => {
      const pop = $('railClassPop');
      if (pop && !pop.hidden && !e.target.closest('.rail-pick-wrap')) {
        pop.hidden = true; $('btnRailClasses')?.setAttribute('aria-expanded', 'false');
      }
    });
  } catch (errEvents) {
    console.error('[BPP-VMS] Error binding events drawer:', errEvents);
  }

  // ---- Viewer & Layout Controls ----
  try {
    $('btnCloseViewer')?.addEventListener('click', closeViewer);
    $('btnReconnect')?.addEventListener('click', reconnectAll);
    $('btnEditLayout')?.addEventListener('click', () => setEditLayout(!state.editLayout));
    const btnResetLayout = $('btnResetLayout');
    if (btnResetLayout) {
      btnResetLayout.addEventListener('click', () => {
        window.resetUserChannelsToDefault();
      });
    }
  } catch (errLayout) {
    console.error('[BPP-VMS] Error binding layout controls:', errLayout);
  }
  $('btnLayoutSave').addEventListener('click', async () => {
    saveCfg();
    // CLAUDE.md Section 10: Save dragged layout to user profile channels
    if (!state.userProfile) state.userProfile = {};
    state.userProfile.channels = cfg.channels.map(c => ({ ...c }));
    await saveUserProfile();

    // Admin Master Grid Auto-Sync: keep central channels.json aligned when admin/superadmin saves layout
    if (['admin', 'superadmin'].includes(userRole) || !userRole) {
      try {
        state.draft = cfg.channels.map(c => ({ ...c }));
        await saveServerChannels();
      } catch (syncErr) {
        console.warn('Auto-sync server channels on layout save failed:', syncErr);
      }
    }

    updateResetLayoutButton();
    setEditLayout(false);
    toast('บันทึกการจัดเรียงช่องสำหรับหน้าจอของคุณเรียบร้อยแล้ว');
  });
  $('btnLayoutCancel').addEventListener('click', () => {
    if (state.layoutSnapshot) { cfg.channels = state.layoutSnapshot.map(c => ({ ...c })); rebuildGrid(); }
    setEditLayout(false); toast('ยกเลิกการจัดเรียง — คืนตำแหน่งเดิม');
  });
  // ---- window controls (min / max / close ตามธีม) ----
  // maximize = สลับเต็มจอ (Fullscreen API, ทำได้จริง); close = window.close()
  // minimize: เบราว์เซอร์ "ย่อ" หน้าต่างจาก JS ไม่ได้ (ไม่มี Web API) — desktop shortcut ถูกตั้งเป็น
  // Chrome --app (machine-local, ไม่อยู่ใน repo) จึงย่อผ่าน taskbar/Win+↓ ได้ ปุ่มนี้ออกจากเต็มจอ + แนะนำวิธี
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const reqFs = el => { (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el); };
  const exitFs = () => { (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document); };
  // Window controls removed
  /*
  $('winMax').addEventListener('click', () => { isFs() ? exitFs() : reqFs(document.documentElement); });
  $('winMin').addEventListener('click', () => {
    if (isFs()) exitFs();
    else toast('ย่อหน้าต่างจาก taskbar ได้เลย (คลิกไอคอน หรือกด Win+↓) — เบราว์เซอร์ย่อจากปุ่มในเว็บไม่ได้');
    try { window.blur(); } catch (e) {}
  });
  $('winClose').addEventListener('click', async () => { if (await window.bppConfirm(`ปิดหน้าต่าง ${window.BRANDING.name} ${window.BRANDING.sub}?`)) { try { window.close(); } catch (e) {} } });
  const syncMaxIcon = () => {
    const fs = isFs();
    $('winMaxIcon').style.display = fs ? 'none' : 'block';
    $('winRestoreIcon').style.display = fs ? 'block' : 'none';
    $('winMax').title = fs ? 'คืนขนาด (ออกจากเต็มจอ)' : 'ขยาย / เต็มจอ';
  };
  document.addEventListener('fullscreenchange', syncMaxIcon);
  document.addEventListener('webkitfullscreenchange', syncMaxIcon);
  */

  // ---- Event Manager (คลังวิดีโอเหตุการณ์) ----
  $('btnEventMgr').addEventListener('click', () => openEventMgr('detection'));
  const tabBtnEmgrDetection = $('tabBtnEmgrDetection');
  if (tabBtnEmgrDetection) tabBtnEmgrDetection.addEventListener('click', () => switchEmgrView('detection'));
  const tabBtnEmgrNas = $('tabBtnEmgrNas');
  if (tabBtnEmgrNas) tabBtnEmgrNas.addEventListener('click', () => switchEmgrView('nas'));
  $('btnCloseEmgr').addEventListener('click', closeEventMgr);
  $('eventMgrOverlay').addEventListener('click', e => { if (e.target === $('eventMgrOverlay')) closeEventMgr(); });
  let emgrSearchDebounce = null;
  const emgrSearch = $('emgrSearch');
  const btnEmgrSearchClear = $('btnEmgrSearchClear');
  if (emgrSearch) {
    emgrSearch.addEventListener('input', e => {
      state.emgrQuery = e.target.value;
      if (btnEmgrSearchClear) btnEmgrSearchClear.hidden = !e.target.value;
      renderEventMgr();
      const q = (state.emgrQuery || '').trim();
    if (q.length >= 2) {
      clearTimeout(emgrSearchDebounce);
      emgrSearchDebounce = setTimeout(async () => {
        try {
          const res = await fetch('/api/watchlist/lpr/candidates?q=' + encodeURIComponent(q) + '&limit=500', { signal: timeoutSignal(8000) });
          if (res.ok) {
            const foundCands = await res.json();
            if (Array.isArray(foundCands) && foundCands.length > 0) {
              if (!state.emgrLprByEvent) state.emgrLprByEvent = new Map();
              if (!state.emgrMmcrByEvent) state.emgrMmcrByEvent = new Map();
              const knownIds = new Set(state.emgrEvents.map(ev => ev.id));
              let added = 0;
              foundCands.forEach(c => {
                const pStr = [c.plate_text, c.province].filter(Boolean).join(' ');
                const isReviewed = Boolean(Number(c.human_confirmed) === 1 || c.review_state === 'confirmed');
                if (c.event_id) {
                  state.emgrLprByEvent.set(c.event_id, {
                    bucket: lprCandidateBucket(c),
                    isNonPlate: false,
                    isReviewed,
                    status: c.status,
                    reviewState: c.review_state,
                    plateText: c.plate_text || '',
                    province: c.province || '',
                    source: c.source || '',
                  });
                  state.emgrMmcrByEvent.set(c.event_id, {
                    plateStr: pStr,
                    vehicle_color: c.vehicle_color || '',
                    vehicle_type: c.vehicle_type || '',
                    vehicle_brand: c.vehicle_brand || '',
                    vehicle_model: c.vehicle_model || '',
                    description: c.description || '',
                  });
                }
                if (c.event_id && !knownIds.has(c.event_id)) {
                  knownIds.add(c.event_id);
                  let eventTime = 0;
                  const match = c.event_id.match(/^(\d+(\.\d+)?)/);
                  if (match) eventTime = parseFloat(match[1]);
                  else if (c.created_at) eventTime = new Date(c.created_at).getTime() / 1000;
                  const camIdx = cfg.channels.findIndex(ch => ch.src === c.camera);
                  state.emgrEvents.push({
                    id: c.event_id,
                    camera: c.camera || '',
                    camIdx: camIdx >= 0 ? camIdx : null,
                    label: 'car',
                    type: 'car',
                    source: c.source || '',
                    crop_path: c.crop_path || '',
                    startTime: eventTime,
                    mins: Math.max(0, (Date.now() / 1000 - eventTime) / 60),
                    dur: 5,
                    conf: Math.round((c.detector_confidence || 0.85) * 100),
                    has_snapshot: true,
                    has_clip: true,
                    description: c.description || '',
                    plate: pStr,
                    vehicle_color: c.vehicle_color || '',
                    vehicle_type: c.vehicle_type || '',
                    vehicle_brand: c.vehicle_brand || '',
                    vehicle_model: c.vehicle_model || '',
                    frameTime: null,
                  });
                  added++;
                } else if (c.event_id && knownIds.has(c.event_id)) {
                  const existing = state.emgrEvents.find(ev => ev.id === c.event_id);
                  if (existing) {
                    if (pStr) existing.plate = pStr;
                    if (c.vehicle_color) existing.vehicle_color = c.vehicle_color;
                    if (c.vehicle_type) existing.vehicle_type = c.vehicle_type;
                    if (c.vehicle_brand) existing.vehicle_brand = c.vehicle_brand;
                    if (c.vehicle_model) existing.vehicle_model = c.vehicle_model;
                    if (c.description) existing.description = c.description;
                  }
                }
              });
              if (added > 0) {
                state.emgrEvents.sort((a, b) => b.startTime - a.startTime);
              }
              renderEventMgr();
            }
          }
        } catch (err) {
          // ignore search network error
        }
      }, 350);
    }
  });
  if (btnEmgrSearchClear) {
    btnEmgrSearchClear.addEventListener('click', () => {
      emgrSearch.value = '';
      state.emgrQuery = '';
      btnEmgrSearchClear.hidden = true;
      emgrSearch.focus();
      renderEventMgr();
    });
  }
}
  // Scope changes reload from Frigate so “all” is not limited to the initial
  // recent-events page shown by the archive.
  $('emgrCameraFilter')?.addEventListener('change', e => { state.emgrCameraFilter = e.target.value; fetchEmgrEvents(); });
  $('emgrDateFilter')?.addEventListener('change', e => { state.emgrDateFilter = e.target.value; fetchEmgrEvents(); });
  $('btnEmgrAllDates')?.addEventListener('click', () => { state.emgrDateFilter = ''; const field = $('emgrDateFilter'); if (field) field.value = ''; fetchEmgrEvents(); });
  $('btnEmgrRefresh').addEventListener('click', fetchEmgrEvents);

  $('btnObjClear').addEventListener('click', () => {
    const name = selectedCamName();
    if (!name || !state.objDraft[name]) return;
    state.objDraft[name] = [];
    recomputeObjDirty(name);
    renderObjGrid();
    renderSyncMsg();
  });

  $('btnObjSecurity').addEventListener('click', () => {
    const name = selectedCamName();
    if (!name || !state.objDraft[name]) return;
    let lst = OBJECT_ORDER.filter(o => RECOMMENDED_PRESET.includes(o));
    if (!state.busTruckReady) lst = lst.filter(o => o !== 'bus' && o !== 'truck');
    state.objDraft[name] = lst.slice(0, MAX_OBJECTS);
    recomputeObjDirty(name);
    renderObjGrid();
    renderSyncMsg();
  });

  // ---- Per-Camera AI Detection Schedule Event Listeners ----
  $('btnSchedPresetNight')?.addEventListener('click', () => {
    const name = selectedCamName();
    if (!name) return;
    setSchedPreset(name, { enabled: true, start_time: '18:00', end_time: '06:00', days: [1, 2, 3, 4, 5, 6, 7] });
  });
  $('btnSchedPresetLate')?.addEventListener('click', () => {
    const name = selectedCamName();
    if (!name) return;
    setSchedPreset(name, { enabled: true, start_time: '22:00', end_time: '05:00', days: [1, 2, 3, 4, 5, 6, 7] });
  });
  $('btnSchedPresetWork')?.addEventListener('click', () => {
    const name = selectedCamName();
    if (!name) return;
    setSchedPreset(name, { enabled: true, start_time: '08:00', end_time: '17:00', days: [1, 2, 3, 4, 5] });
  });
  $('btnSchedPreset24h')?.addEventListener('click', () => {
    const name = selectedCamName();
    if (!name) return;
    const cur = (state.schedDraft && state.schedDraft[name]) || DEFAULT_AI_SCHED;
    setSchedPreset(name, { ...cur, enabled: false });
  });
  $('chkAiSchedEnabled')?.addEventListener('change', (e) => {
    const name = selectedCamName();
    if (!name) return;
    if (!state.schedDraft) state.schedDraft = {};
    const cur = cloneSchedEntry(state.schedDraft[name] || DEFAULT_AI_SCHED);
    cur.enabled = !!e.target.checked;
    state.schedDraft[name] = cur;
    recomputeSchedDirty(name);
    renderAiSchedule();
    renderSyncMsg();
  });
  const onAiSchedTimeChange = () => {
    const name = selectedCamName();
    if (!name) return;
    if (!state.schedDraft) state.schedDraft = {};
    const cur = cloneSchedEntry(state.schedDraft[name] || DEFAULT_AI_SCHED);
    const sh = ($('selAiSchedStartH')?.value || '18').padStart(2, '0');
    const sm = ($('selAiSchedStartM')?.value || '00').padStart(2, '0');
    const eh = ($('selAiSchedEndH')?.value || '06').padStart(2, '0');
    const em = ($('selAiSchedEndM')?.value || '00').padStart(2, '0');
    cur.start_time = `${sh}:${sm}`;
    cur.end_time = `${eh}:${em}`;
    cur.enabled = true;
    if ($('inpAiSchedStart')) $('inpAiSchedStart').value = cur.start_time;
    if ($('inpAiSchedEnd')) $('inpAiSchedEnd').value = cur.end_time;
    state.schedDraft[name] = cur;
    recomputeSchedDirty(name);
    renderAiSchedule();
    renderSyncMsg();
  };
  ['selAiSchedStartH', 'selAiSchedStartM', 'selAiSchedEndH', 'selAiSchedEndM'].forEach(id => {
    $(id)?.addEventListener('change', onAiSchedTimeChange);
  });
  $('inpAiSchedStart')?.addEventListener('change', (e) => {
    const name = selectedCamName();
    if (!name) return;
    if (!state.schedDraft) state.schedDraft = {};
    const cur = cloneSchedEntry(state.schedDraft[name] || DEFAULT_AI_SCHED);
    if (/^\d{2}:\d{2}$/.test(e.target.value)) {
      cur.start_time = e.target.value;
      cur.enabled = true;
    }
    state.schedDraft[name] = cur;
    recomputeSchedDirty(name);
    renderAiSchedule();
    renderSyncMsg();
  });
  $('inpAiSchedEnd')?.addEventListener('change', (e) => {
    const name = selectedCamName();
    if (!name) return;
    if (!state.schedDraft) state.schedDraft = {};
    const cur = cloneSchedEntry(state.schedDraft[name] || DEFAULT_AI_SCHED);
    if (/^\d{2}:\d{2}$/.test(e.target.value)) {
      cur.end_time = e.target.value;
      cur.enabled = true;
    }
    state.schedDraft[name] = cur;
    recomputeSchedDirty(name);
    renderAiSchedule();
    renderSyncMsg();
  });
  document.querySelectorAll('#aiSchedDaysWrap .ai-sched-day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = selectedCamName();
      if (!name) return;
      if (!state.schedDraft) state.schedDraft = {};
      const cur = cloneSchedEntry(state.schedDraft[name] || DEFAULT_AI_SCHED);
      const day = Number(btn.dataset.day);
      const set = new Set(cur.days);
      if (set.has(day)) {
        if (set.size <= 1) {
          toast('ต้องเลือกอย่างน้อย 1 วันในสัปดาห์');
          return;
        }
        set.delete(day);
      } else {
        set.add(day);
      }
      cur.days = Array.from(set).sort((a, b) => a - b);
      cur.enabled = true;
      state.schedDraft[name] = cur;
      recomputeSchedDirty(name);
      renderAiSchedule();
      renderSyncMsg();
    });
  });

  // ขนาดภาพย่อ (sm/md/lg) — CSS var ตัวเดียว inherit ลง .emgr-grid ทุกกลุ่ม + persist ใน cfg
  try {
    const EMGR_THUMB_MIN = { sm: '110px', md: '150px', lg: '240px', xl: '480px', xxl: '720px' };
    const applyEmgrThumb = () => {
      const emgrBodyEl = $('emgrBody');
      if (emgrBodyEl && emgrBodyEl.style) {
        emgrBodyEl.style.setProperty('--emgr-thumb-min', EMGR_THUMB_MIN[cfg.emgrThumb] || EMGR_THUMB_MIN.md);
      }
      document.querySelectorAll('.emgr-size-btn').forEach(b => b.classList.toggle('on', b.dataset.size === cfg.emgrThumb));
    };
    document.querySelectorAll('.emgr-size-btn').forEach(b =>
      b.addEventListener('click', () => { cfg.emgrThumb = b.dataset.size; saveCfg(); applyEmgrThumb(); }));
    applyEmgrThumb();
    $('btnCloseDetail')?.addEventListener('click', closeEmgrDetail);
    $('emgrDetailOverlay')?.addEventListener('click', e => { if (e.target === $('emgrDetailOverlay')) closeEmgrDetail(); });
    $('btnClosePlateModal')?.addEventListener('click', closePlateModal);
    $('plateModalOverlay')?.addEventListener('click', e => { if (e.target === $('plateModalOverlay')) closePlateModal(); });
  } catch (errEmgrThumb) {
    console.error('[BPP-VMS] Error in emgrThumb init:', errEmgrThumb);
  }
  
  // ---- LPR Interactive Training & Annotation ----
  try {
    $('btnEdPlateTrain')?.addEventListener('click', () => {
      if (state.emgrEv) openOrCreateLprTraining(state.emgrEv);
    });
    $('btnEdPlateAdd')?.addEventListener('click', () => {
      if (state.emgrEv) openOrCreateLprTraining(state.emgrEv);
    });
    $('btnEdPlateDelete')?.addEventListener('click', () => {
      if (state.emgrEv) openOrCreateLprTraining(state.emgrEv, 'non_plate');
    });
    $('btnCloseLprTrain')?.addEventListener('click', closeLprTrainModal);
    $('btnLprTrainCancel')?.addEventListener('click', closeLprTrainModal);
    $('lprTrainOverlay')?.addEventListener('click', e => { if (e.target === $('lprTrainOverlay')) closeLprTrainModal(); });
    $('btnLprTrainSave')?.addEventListener('click', saveLprTrainingSample);
    const provinceList = $('lprProvinceList');
    if (provinceList && !provinceList.childElementCount) {
      THAI_PROVINCES.forEach(province => {
        const option = document.createElement('option');
        option.value = province;
        provinceList.appendChild(option);
      });
    }
    $('selLprDecision')?.addEventListener('change', updateLprDecisionFields);
    $('selLprNonPlateReason')?.addEventListener('change', updateLprDecisionFields);
    initLprAnnotationStage();
  } catch (errLpr) {
    console.error('[BPP-VMS] Error in LPR training init:', errLpr);
  }

  // ---- Event Manager Details & Tabs ----
  try {
    $('edTabSnapBtn')?.addEventListener('click', () => switchEmgrTab('snap'));
    $('edTabVideoBtn')?.addEventListener('click', () => switchEmgrTab('video'));
    $('edTabTrackBtn')?.addEventListener('click', () => switchEmgrTab('track'));
    $('btnSaveDesc')?.addEventListener('click', saveEmgrDesc);
    $('btnDeleteEmgrEvent')?.addEventListener('click', deleteCurrentEmgrEvent);
    $('btnEdDownload')?.addEventListener('click', emgrDownload);
    $('btnEdShare')?.addEventListener('click', () => {
      const p = $('edSharePop');
      if (p) {
        p.hidden = !p.hidden;
        $('btnEdShare')?.setAttribute('aria-expanded', String(!p.hidden));
      }
    });
    document.querySelectorAll('#edSharePop .share-item').forEach(b => b.addEventListener('click', () => emgrShare(b.dataset.edshare)));
  } catch (errEmgr) {
    console.error('[BPP-VMS] Error in event manager detail:', errEmgr);
  }

  // ---- Playback (ดูย้อนหลัง) ----
  try {
    $('btnPlayback')?.addEventListener('click', openPlayback);
    $('btnClosePb')?.addEventListener('click', closePlayback);
    $('playbackOverlay')?.addEventListener('click', e => { if (e.target === $('playbackOverlay')) closePlayback(); });
    $('pbCam')?.addEventListener('change', e => { pb.cam = e.target.value; pbResetVideo(); pbLoadDay(); pbLoadRecDays(); });
    // ปฏิทิน custom (จุดแดง = วันมีบันทึก) — เขียนค่าลง hidden #pbDate แล้วเรียก flow เดิมเอง
    $('btnPbCal')?.addEventListener('click', () => {
      const pop = $('pbCalPop');
      if (!pop) return;
      pop.hidden = !pop.hidden;
      $('btnPbCal')?.setAttribute('aria-expanded', String(!pop.hidden));
      if (!pop.hidden) { const [sy, sm] = pbSelectedYmd(); pb.calYm = [sy, sm - 1]; pbRenderCal(); }
    });
    $('pbCalPrev')?.addEventListener('click', () => { pb.calYm = pb.calYm[1] === 0 ? [pb.calYm[0] - 1, 11] : [pb.calYm[0], pb.calYm[1] - 1]; pbRenderCal(); });
    $('pbCalNext')?.addEventListener('click', () => { pb.calYm = pb.calYm[1] === 11 ? [pb.calYm[0] + 1, 0] : [pb.calYm[0], pb.calYm[1] + 1]; pbRenderCal(); });
    document.addEventListener('click', e => {
      const pop = $('pbCalPop');
      if (pop && !pop.hidden && !e.target.closest('.pb-cal-wrap')) pbCalClose();
    });
    $('pbTimeline')?.addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); pbLoadClip(pbPct2t(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))); });
    $('pbZoomIn')?.addEventListener('click', () => pbZoom(1));
    $('pbZoomOut')?.addEventListener('click', () => pbZoom(-1));
    $('pbPanL')?.addEventListener('click', () => pbPan(-1));
    $('pbPanR')?.addEventListener('click', () => pbPan(1));
    // dropdown เลือก class บนไทม์ไลน์ (multi-select)
    $('btnPbEvClass')?.addEventListener('click', () => {
      const pop = $('pbEvClassPop');
      if (!pop) return;
      pop.hidden = !pop.hidden;
      $('btnPbEvClass')?.setAttribute('aria-expanded', String(!pop.hidden));
      if (!pop.hidden) pbRenderEvClassPop();
    });
    document.addEventListener('click', e => {
      const pop = $('pbEvClassPop');
      if (pop && !pop.hidden && !e.target.closest('.pb-evclass-wrap')) {
        pop.hidden = true; $('btnPbEvClass')?.setAttribute('aria-expanded', 'false');
      }
    });
    $('pbPlay')?.addEventListener('click', () => {
      const v = $('pbVideo'); if (!v || !v.getAttribute('src')) return;
      const fvs = pb.followers.filter(f => f.video && f.video.getAttribute('src')).map(f => f.video);
      if (v.paused) { v.play().catch(() => {}); fvs.forEach(fv => fv.play().catch(() => {})); }
      else { v.pause(); fvs.forEach(fv => fv.pause()); }
    });
    document.querySelectorAll('.pb-layout-btn').forEach(b => b.addEventListener('click', () => pbSetLayout(parseInt(b.dataset.n, 10))));
    $('btnPbSync')?.addEventListener('click', () => {
      const abs = pbCurrentAbs();
      if (!abs) { toast('เลือกช่วงเวลาบนไทม์ไลน์ก่อน'); return; }
      pbSyncFollowers(abs);
      toast('ซิงค์ทุกจอที่ ' + fmtClock(abs));
    });
  } catch (errPlayback) {
    console.error('[BPP-VMS] Error in playback init:', errPlayback);
  }

  // ---- Digital zoom (ตีกรอบแดงซูม 2-5×) — 3 surface: player modal / คลังวิดีโอ / playback ----
  try {
    pvZoom = makeVideoZoom($('pvStage'), $('pvVideo'), { onChange: updatePvZoomUi });
    edZoom = makeVideoZoom(document.querySelector('.emgr-video-wrap'), $('edVideo'), { nativeControls: true, onChange: updateEdZoomUi });
    pbMainZoom = makeVideoZoom(document.querySelector('#pbGrid .pb-cell-main'), $('pbVideo'), { onChange: updatePbZoomUi });
    if (pbMainZoom) pbMainZoom.onApplied = pbZoomApplied;
    wireZoomControls({ btnIn: 'btnPvZoomIn', pop: 'pvZoomPop', btnOut: 'btnPvZoomOut',
      canArm: () => !cfg.demo && pvZoom && pvZoom.hasSrc(), arm: l => pvZoom && pvZoom.arm(l), reset: () => pvZoom && pvZoom.reset() });
    wireZoomControls({ btnIn: 'btnEdZoomIn', pop: 'edZoomPop', btnOut: 'btnEdZoomOut',
      canArm: () => !cfg.demo && edZoom && edZoom.hasSrc(), arm: l => edZoom && edZoom.arm(l), reset: () => edZoom && edZoom.reset() });
    wireZoomControls({ btnIn: 'btnPbZoomIn', pop: 'pbZoomPop', btnOut: 'btnPbZoomOut',
      canArm: () => !cfg.demo && pbAllZooms().some(zi => zi && zi.hasSrc()),
      arm: l => pbAllZooms().forEach(zi => { if (zi && zi.hasSrc()) zi.arm(l); }),
      reset: () => pbAllZooms().forEach(zi => { if (zi) zi.reset(); }) });
    document.addEventListener('click', e => {
      if (e.target.closest('.zoom-wrap')) return;
      ZOOM_POPS.forEach(o => { if (o && o.pop && !o.pop.hidden) { o.pop.hidden = true; o.btn?.setAttribute('aria-expanded', 'false'); } });
    });
  } catch (errZoom) {
    console.error('[BPP-VMS] Error in zoom controls init:', errZoom);
  }

  // ---- Snapshot / Record → Downloads ----
  try {
    $('btnPvSnap')?.addEventListener('click', () => snapVideoFrame($('pvVideo'), 'event_' + ((state.playerEv && state.playerEv.label) || 'clip')));
    $('btnEdVideoSnap')?.addEventListener('click', () => snapVideoFrame($('edVideo'), 'event_' + ((state.emgrEv && state.emgrEv.label) || 'clip')));
    $('btnPbSnap')?.addEventListener('click', () => snapVideoFrame($('pbVideo'), pb.cam || 'playback'));
    $('btnEdSnapDl')?.addEventListener('click', () => {
      const ev = state.emgrEv; if (!ev || !ev.has_snapshot || cfg.demo) return;
      const dlUrl = emgrThumb(ev) || apiUrl('/api/events/' + encodeURIComponent(ev.id) + '/snapshot.jpg?download=1');
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = `snapshot-${ev.id}.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
      toast('กำลังบันทึกภาพ Snapshot ลง Downloads');
    });
    const btnCvAudio = $('btnCvAudio');
    if (btnCvAudio) {
      btnCvAudio.addEventListener('click', () => {
        const cvVid = activeViewerVideo();
        if (!cvVid) return;
        const willUnmute = cvVid.muted;
        if (willUnmute) {
          state.unmutedSrc = state.viewingSrc;
          cvVid.muted = false;
          cvVid.volume = 1.0;
          if (state.viewerCam) state.viewerCam.unmutedByUser = true;
          if (cvVid.srcObject && cvVid.srcObject.getAudioTracks) {
            cvVid.srcObject.getAudioTracks().forEach(tr => { tr.enabled = true; });
          }
          cvVid.play().catch(() => {});
          btnCvAudio.classList.add('audio-on');
          btnCvAudio.innerHTML = CV_SVG_AUDIO_ON;
          btnCvAudio.title = 'ปิดเสียง (กำลังเปิดเสียงสด)';
          if (state.viewerIdx !== null && state.tiles[state.viewerIdx]) {
            const t = state.tiles[state.viewerIdx];
            t.audioUnmuted = true;
            if (t.cam) t.cam.unmutedByUser = true;
            if (t.audioBtn) {
              t.audioBtn.classList.add('audio-on');
              t.audioBtn.innerHTML = TILE_SVG_AUDIO_ON;
              t.audioBtn.title = 'ปิดเสียง (กำลังเปิดเสียงสด)';
            }
          }
          toast('🔊 เปิดเสียง: ' + ($('cvName') ? $('cvName').textContent : 'สตรีมหลัก'));
        } else {
          state.unmutedSrc = null;
          cvVid.muted = true;
          const rawCvVid = $('cvVideo');
          if (rawCvVid) rawCvVid.muted = true;
          if (state.viewerCam) state.viewerCam.unmutedByUser = false;
          btnCvAudio.classList.remove('audio-on');
          btnCvAudio.innerHTML = CV_SVG_AUDIO_MUTE;
          btnCvAudio.title = 'เปิดเสียง (คลิกเพื่อฟังเสียงสด)';
          if (state.viewerIdx !== null && state.tiles[state.viewerIdx]) {
            const t = state.tiles[state.viewerIdx];
            t.audioUnmuted = false;
            if (t.cam) t.cam.unmutedByUser = false;
            if (t.video) t.video.muted = true;
            if (t.audioBtn) {
              t.audioBtn.classList.remove('audio-on');
              t.audioBtn.innerHTML = TILE_SVG_AUDIO_MUTE;
              t.audioBtn.title = 'เปิดเสียง (สตรีมสด)';
            }
          }
          toast('🔇 ปิดเสียงกล้องแล้ว');
        }
      });
    }
    $('btnCvSnap')?.addEventListener('click', () => snapVideoFrame(activeViewerVideo(), ($('cvChip')?.textContent || 'camera') + '_main'));
    $('btnCvRec')?.addEventListener('click', () => {
      if (!state.viewingSrc) return;
      const ch = (cfg.channels && cfg.channels[state.viewerIdx]) || {};
      const recBtn = $('btnCvRec');
      if (recBtn) toggleNvrManualRecord(state.viewingSrc, recBtn, ch.name);
    });
  } catch (errSnap) {
    console.error('[BPP-VMS] Error in snap/audio init:', errSnap);
  }
  document.querySelectorAll('.pb-speed').forEach(b => b.addEventListener('click', () => pbSetSpeed(parseFloat(b.dataset.rate))));
  $('btnPbDownload').addEventListener('click', pbDownload);
  const pbv = $('pbVideo');
  pbv.addEventListener('canplay', () => { $('pbCenter').hidden = true; $('pbSpin').hidden = true; pbv.style.display = ''; pbv.playbackRate = pb.speed; });
  pbv.addEventListener('timeupdate', pbUpdatePlayhead);
  pbv.addEventListener('play', () => setPbPlayUi(true));
  pbv.addEventListener('pause', () => setPbPlayUi(false));
  pbv.addEventListener('ended', () => { const nx = pbSnapToRecorded(pb.winEnd + 1); if (nx !== null) pbLoadClip(nx); }); // เล่นช่วงถัดไปต่อ
  pbv.addEventListener('error', () => {
    if (!pbv.getAttribute('src')) return;
    if (pbv.dataset.compatTried !== '1' && pb.cam && pb.winStart && pb.winEnd) {
      pbv.dataset.compatTried = '1';
      $('pbCenter').hidden = false; $('pbSpin').hidden = false; $('pbCenterText').textContent = 'กำลังแปลงวิดีโอ H.265 ➔ H.264 (NVENC)…';
      prepareAndPlayVideoCompat(
        { purpose: 'playback', camera: pb.cam, start: Math.floor(pb.winStart), end: Math.floor(pb.winEnd) },
        pbv,
        () => { $('pbCenter').hidden = true; $('pbSpin').hidden = true; pbv.style.display = ''; pbv.playbackRate = pb.speed; },
        () => { $('pbCenter').hidden = false; $('pbSpin').hidden = true; $('pbCenterText').textContent = 'โหลดวิดีโอช่วงนี้ไม่สำเร็จ — ลองช่วงอื่น'; pbv.style.display = 'none'; }
      );
      return;
    }
    $('pbCenter').hidden = false; $('pbSpin').hidden = true; $('pbCenterText').textContent = 'โหลดวิดีโอช่วงนี้ไม่สำเร็จ — ลองช่วงอื่น'; pbv.style.display = 'none';
  });

  // Watchlist
  const btnWatchlist = $('btnWatchlist');
  const watchlistOverlay = $('watchlistOverlay');
  if (btnWatchlist && watchlistOverlay) {
    btnWatchlist.addEventListener('click', () => { watchlistOverlay.hidden = false; });
    const btnCloseWatchlist = $('btnCloseWatchlist');
    if (btnCloseWatchlist) btnCloseWatchlist.addEventListener('click', () => watchlistOverlay.hidden = true);
    watchlistOverlay.addEventListener('click', e => { if (e.target === watchlistOverlay) watchlistOverlay.hidden = true; });
    
    const btnWlAdd = $('btnWlAdd');
    const wlFormOverlay = $('wlFormOverlay');
    const btnWlFormClose2 = $('btnWlFormClose2');
    if (btnWlAdd && wlFormOverlay) {
      btnWlAdd.addEventListener('click', () => wlFormOverlay.hidden = false);
      if (btnWlFormClose2) btnWlFormClose2.addEventListener('click', () => wlFormOverlay.hidden = true);
      wlFormOverlay.addEventListener('click', e => { if (e.target === wlFormOverlay) wlFormOverlay.hidden = true; });
    }
  }

  // settings
  $('btnSettings').addEventListener('click', openSettings);
  
  window.selectImpersonateUser = function(u) {
    state.impersonatingUser = u;
    const txt = $('txtImpersonateSelected');
    if (txt) txt.textContent = u ? (window.bppAccountLabel ? window.bppAccountLabel.text(u) : u) : '-- หน้าจอของคุณ --';
    const menu = $('impersonateDropdownMenu');
    if (menu) menu.style.display = 'none';

    if (!u) {
      state.draft = cfg.channels.map(c => ({ ...c }));
      if ($('txtGridBannerTitle')) $('txtGridBannerTitle').textContent = 'ผังหน้าจอของคุณ (Personal Screen Grid)';
      toast('กลับสู่หน้าจอของคุณ');
    } else {
      const profile = state.allUserProfilesCache?.[u];
      const disabledAi = new Set((profile && profile.disabled_ai_cameras) || []);
      let userChannels = profile?.channels;
      if (!userChannels || !userChannels.length) {
        if (profile && Array.isArray(profile.active_channels) && profile.active_channels.length) {
          userChannels = Array.from({ length: 16 }, (_, idx) => {
            const ac = profile.active_channels[idx];
            if (ac && ac.src) {
              const src = String(ac.src);
              return normalizeChannelStreams({
                src,
                name: displayCameraName(src, ac.name) || src,
                sub: ac.sub || '',
                hd: ac.hd || '',
                enabled: ac.enabled !== false,
                detect: ac.detect !== undefined ? (ac.detect === true && !disabledAi.has(src)) : !disabledAi.has(src)
              });
            }
            return { src: '', name: '', sub: '', enabled: true, detect: false };
          });
        } else {
          userChannels = Array.from({ length: 16 }).map(() => ({ src: '', name: '', sub: '', enabled: true, detect: false }));
        }
      } else {
        userChannels = userChannels.map(c => {
          const copy = normalizeChannelStreams({ ...c });
          if (copy.src && disabledAi.has(copy.src)) copy.detect = false;
          else if (copy.src && copy.detect === undefined) copy.detect = !disabledAi.has(copy.src);
          return copy;
        });
      }
      state.draft = userChannels.map(c => ({ ...c }));
      if ($('txtGridBannerTitle')) $('txtGridBannerTitle').textContent = `ผังหน้าจอของบัญชี: ${u}`;
      toast(`กำลังดูหน้าจอของ: ${u}`);
    }

    updateKillSwitchUi();
    renderChList();
    renderChForm();
    renderMyAlertsMatrix();
    fetchAiDemandCounts().then(() => {
      renderChForm();
    });
  };

  if ($('btnImpersonateToggle')) {
    $('btnImpersonateToggle').addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = $('impersonateDropdownMenu');
      if (menu.style.display === 'none') {
        menu.style.display = 'block';
      } else {
        menu.style.display = 'none';
      }
    });
  }

  document.addEventListener('click', (e) => {
    const wrap = $('impersonateDropdownWrap');
    const menu = $('impersonateDropdownMenu');
    if (wrap && menu && menu.style.display === 'block' && !wrap.contains(e.target)) {
      menu.style.display = 'none';
    }
  });

  /* ================== NVR SCANNER ================== */
  const scanNvrOverlay = $('scanNvrOverlay');
  const btnScanNvr = $('btnScanNvr');
  const btnCloseScanNvr = $('btnCloseScanNvr');
  const btnCancelScan = $('btnCancelScan');
  const btnStartScan = $('btnStartScan');
  const btnSubmitScan = $('btnSubmitScan');
  const chkSelectAllScan = $('chkSelectAllScan');
  const scanResultsList = $('scanResultsList');
  
  let currentScanResults = [];

  const nvrBrandMap = {
    'vigi': 'TP-Link VIGI',
    'TP-Link VIGI': 'TP-Link VIGI',
    'dahua': 'Dahua / DH',
    'Dahua / DH': 'Dahua / DH',
    'hikvision': 'Hikvision / HIK',
    'Hikvision / HIK': 'Hikvision / HIK'
  };

  function openScanNvrModal() {
    if (!scanNvrOverlay) return;
    scanNvrOverlay.hidden = false;
    currentScanResults = [];
    if (scanResultsList) {
      scanResultsList.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #94a3b8; padding: 25px; font-size: 13px;">กรุณากรอกข้อมูล NVR ด้านบน แล้วกดปุ่ม "เริ่มค้นหากล้อง (Scan)"...</div>';
    }
    if (chkSelectAllScan) {
      chkSelectAllScan.disabled = true;
      chkSelectAllScan.checked = false;
    }
    if (btnSubmitScan) {
      btnSubmitScan.disabled = true;
      btnSubmitScan.innerText = 'นำเข้ากล้องที่เลือก';
    }
    
    // Default group info based on settings if needed
    const defaultUnit = localStorage.getItem('defaultUnitCode') || 'BPP215';
    if ($('inpScanUnitCode') && !$('inpScanUnitCode').value) {
      $('inpScanUnitCode').value = defaultUnit;
    }
  }
  
  function closeScanNvrModal() {
    if (scanNvrOverlay) scanNvrOverlay.hidden = true;
  }
  
  if (btnScanNvr) btnScanNvr.addEventListener('click', openScanNvrModal);
  if (btnCloseScanNvr) btnCloseScanNvr.addEventListener('click', closeScanNvrModal);
  if (btnCancelScan) btnCancelScan.addEventListener('click', closeScanNvrModal);
  if (scanNvrOverlay) {
    scanNvrOverlay.addEventListener('click', e => {
      if (e.target === scanNvrOverlay) closeScanNvrModal();
    });
  }
  
  if (btnStartScan) {
    btnStartScan.addEventListener('click', async () => {
      const ip = $('inpScanIp').value.trim();
      const port = parseInt($('inpScanPort').value.trim() || '554', 10);
      const username = $('inpScanUser').value.trim();
      const password = $('inpScanPass').value.trim();
      const brandRaw = $('inpScanBrand').value;
      const targetBrand = nvrBrandMap[brandRaw] || brandRaw;
      
      if (!ip || !username || !password) {
        alert('กรุณากรอก IP, Username, และ Password ให้ครบถ้วน');
        return;
      }
      
      btnStartScan.disabled = true;
      btnStartScan.innerHTML = '<div class="spinner small" style="margin-right:8px;"></div> กำลังสแกน...';
      scanResultsList.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #60a5fa; padding: 20px; font-size: 13px;"><div class="spinner" style="margin-bottom:10px;"></div><br>กำลังทดสอบเชื่อมต่อทุกช่องสัญญาณ (1-64)... อาจใช้เวลา 10-30 วินาที</div>';
      
      try {
        const resp = await fetch('/api/config/scan_nvr', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            ip_address: ip,
            port: port,
            username: username,
            password: password,
            brand: targetBrand,
            max_channels: 64
          })
        });
        
        if (!resp.ok) {
          let errDetail = await resp.text();
          try {
            const errJson = JSON.parse(errDetail);
            if (errJson.detail) errDetail = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
          } catch (_) {}
          throw new Error(errDetail);
        }
        const data = await resp.json();
        
        if (data && Array.isArray(data.found)) {
          currentScanResults = data.found;
          renderScanResults();
        } else {
          throw new Error(data.message || data.detail || 'ไม่สามารถสแกนช่องสัญญาณ NVR ได้');
        }
      } catch (err) {
        console.error(err);
        scanResultsList.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 20px; font-size: 13px;">เกิดข้อผิดพลาด: ' + escapeHtml(err.message) + '</div>';
      } finally {
        btnStartScan.disabled = false;
        btnStartScan.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> เริ่มค้นหากล้อง (Scan)';
      }
    });
  }
  
  function renderScanResults() {
    if (!currentScanResults || currentScanResults.length === 0) {
      scanResultsList.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #a8a29e; padding: 20px; font-size: 13px;">ไม่พบช่องสัญญาณกล้องที่เปิดใช้งานบน NVR เครื่องนี้ (หรือรหัสผ่าน/พอร์ตไม่ถูกต้อง)</div>';
      chkSelectAllScan.disabled = true;
      chkSelectAllScan.checked = false;
      btnSubmitScan.disabled = true;
      return;
    }
    
    chkSelectAllScan.disabled = false;
    chkSelectAllScan.checked = true;
    
    scanResultsList.innerHTML = '';
    currentScanResults.forEach((ch, idx) => {
      const channelNum = ch.ch || ch.channel;
      const label = document.createElement('label');
      label.style.display = 'flex';
      label.style.flexDirection = 'column';
      label.style.gap = '5px';
      label.style.background = 'rgba(255,255,255,0.04)';
      label.style.padding = '10px';
      label.style.borderRadius = '6px';
      label.style.border = '1px solid rgba(255,255,255,0.08)';
      label.style.cursor = 'pointer';
      label.style.transition = 'all 0.2s';
      
      const checkRow = document.createElement('div');
      checkRow.style.display = 'flex';
      checkRow.style.alignItems = 'center';
      checkRow.style.gap = '8px';
      
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = true;
      chk.className = 'scan-ch-checkbox';
      chk.dataset.chIndex = idx;
      
      const title = document.createElement('span');
      title.style.fontWeight = '600';
      title.style.fontSize = '13px';
      title.style.color = '#fff';
      title.innerText = 'ช่องสัญญาณ ' + channelNum;
      
      checkRow.appendChild(chk);
      checkRow.appendChild(title);
      
      const infoRow = document.createElement('div');
      infoRow.style.fontSize = '11px';
      infoRow.style.color = '#a8a29e';
      infoRow.style.paddingLeft = '22px';
      const codec = ch.video_codec ? ch.video_codec.toUpperCase() : 'พบสัญญาณภาพ';
      const latency = ch.latency_ms ? ' (' + Math.round(ch.latency_ms) + 'ms)' : '';
      infoRow.innerText = codec + latency;
      
      label.appendChild(checkRow);
      label.appendChild(infoRow);
      
      scanResultsList.appendChild(label);
      
      chk.addEventListener('change', updateScanSubmitBtn);
    });
    
    updateScanSubmitBtn();
  }
  
  if (chkSelectAllScan) {
    chkSelectAllScan.addEventListener('change', (e) => {
      const chks = document.querySelectorAll('.scan-ch-checkbox');
      chks.forEach(c => c.checked = e.target.checked);
      updateScanSubmitBtn();
    });
  }
  
  function updateScanSubmitBtn() {
    const checked = document.querySelectorAll('.scan-ch-checkbox:checked').length;
    btnSubmitScan.disabled = checked === 0;
    btnSubmitScan.innerText = checked > 0 ? ('นำเข้ากล้องที่เลือก (' + checked + ' ช่อง)') : 'นำเข้ากล้องที่เลือก';
  }
  
  if (btnSubmitScan) {
    btnSubmitScan.addEventListener('click', async () => {
      const ip = $('inpScanIp').value.trim();
      const port = parseInt($('inpScanPort').value.trim() || '554', 10);
      const username = $('inpScanUser').value.trim();
      const password = $('inpScanPass').value.trim();
      const brandRaw = $('inpScanBrand').value;
      const targetBrand = nvrBrandMap[brandRaw] || brandRaw;
      const unitCode = $('inpScanUnitCode').value.trim();
      const groupName = $('inpScanGroup').value.trim();
      
      const selectedIndexes = Array.from(document.querySelectorAll('.scan-ch-checkbox:checked')).map(c => parseInt(c.dataset.chIndex, 10));
      const selectedChannels = selectedIndexes.map(idx => currentScanResults[idx]);
      
      if (selectedChannels.length === 0) return;
      
      if (!await window.bppConfirm('คุณต้องการเพิ่มกล้องจำนวน ' + selectedChannels.length + ' ช่อง เข้าระบบใช่หรือไม่?\n(ระบบจะสร้างคอนฟิกและบันทึกข้อมูลกล้องให้อัตโนมัติ)')) {
        return;
      }
      
      btnSubmitScan.disabled = true;
      btnSubmitScan.innerHTML = '<div class="spinner small" style="margin-right:8px;"></div> กำลังเพิ่ม...';
      
      const cleanUnit = (unitCode || 'cam').toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const channelsPayload = selectedChannels.map(ch => {
        const cNum = ch.ch || ch.channel;
        return {
          channel: cNum,
          camera_name: cleanUnit + '_ch' + cNum
        };
      });

      try {
        const resp = await fetch('/api/config/batch_add_cameras', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            ip_address: ip,
            port: port,
            username: username,
            password: password,
            brand: targetBrand,
            channels: channelsPayload,
            group: groupName || unitCode || 'NVR Auto-Import',
            ai_enabled: true
          })
        });
        
        if (!resp.ok) {
          let errDetail = await resp.text();
          try {
            const errJson = JSON.parse(errDetail);
            if (errJson.detail) errDetail = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
          } catch (_) {}
          throw new Error(errDetail);
        }
        const data = await resp.json();
        
        // Update local display names
        const nextCameraNames = Object.assign({}, state.cameraNames || {});
        channelsPayload.forEach(cp => {
          const thaiPrefix = groupName ? ('[' + groupName + '] ') : (unitCode ? ('[' + unitCode + '] ') : '');
          nextCameraNames[cp.camera_name] = thaiPrefix + 'ช่อง ' + cp.channel;
        });
        state.cameraNames = nextCameraNames;
        try {
          await saveCameraDisplayNames();
        } catch (_) {}

        const addedCount = data.added ? data.added.length : channelsPayload.length;
        alert('นำเข้ากล้องสำเร็จ ' + addedCount + ' ช่อง!\n\nระบบกำลังรีสตาร์ทตัวเองเพื่อโหลดคอนฟิกใหม่ กรุณารอสักครู่และรีเฟรชหน้าเว็บ');
        closeScanNvrModal();
        if (typeof openSettings === 'function') {
           setTimeout(() => location.reload(), 2000);
        }
      } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดในการนำเข้า: ' + err.message);
      } finally {
        btnSubmitScan.disabled = false;
        updateScanSubmitBtn();
      }
    });
  }

  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('btnCloseSettings2').addEventListener('click', closeSettings);
  $('btnSave').addEventListener('click', saveSettings);
  $('settingsOverlay').addEventListener('click', e => { if (e.target === $('settingsOverlay')) closeSettings(); });
  function setActiveSettingsTab(activeTabId, activeBtnId) {
    ['tabNvr', 'tabDash', 'tabLprLearning', 'tabMyAlerts', 'tabSystemUpdate'].forEach(id => {
      const el = $(id);
      if (!el) return;
      if (id === activeTabId) {
        el.style.display = id === 'tabNvr' ? 'block' : 'flex';
      } else {
        el.style.display = 'none';
      }
    });
    ['btnTabNvr', 'btnTabDash', 'btnTabLprLearning', 'btnTabMyAlerts', 'btnTabSystemUpdate'].forEach(id => {
      const btn = $(id);
      if (!btn) return;
      if (id === activeBtnId) {
        btn.style.borderBottomColor = '#a855f7';
        btn.style.color = '#fff';
      } else {
        btn.style.borderBottomColor = 'transparent';
        btn.style.color = '#9aa0bd';
      }
    });
  }

  async function loadSystemUpdateStatus(forceRefresh = false) {
    const summaryEl = $('sysUpdateSummary');
    const commitsEl = $('sysUpdateCommitsList');
    const badgeEl = $('badgeSysUpdateState');
    if (!summaryEl) return;
    if (forceRefresh) {
      summaryEl.textContent = 'กำลังดึงข้อมูลล่าสุดจาก Git Repository…';
    }
    try {
      const res = await fetch('/api/config/system/update/status' + (forceRefresh ? '?refresh=true' : ''), {
        signal: timeoutSignal(25000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const st = await res.json();
      if ($('chkAutoWebSync')) $('chkAutoWebSync').checked = st.auto_web_sync !== false;
      if ($('inpAutoWebSyncMins') && st.interval_minutes) $('inpAutoWebSyncMins').value = st.interval_minutes;

      const lastWebStr = st.last_web_sync_at ? new Date(st.last_web_sync_at).toLocaleString('th-TH') : 'ยังไม่เคยซิงค์';
      const lastFullStr = st.last_full_update_at ? new Date(st.last_full_update_at).toLocaleString('th-TH') : '—';
      const behind = Number(st.behind_count || 0);

      if (badgeEl) {
        if (behind > 0) {
          badgeEl.textContent = `มีอัปเดตใหม่ (${behind} รายการ)`;
          badgeEl.style.background = 'rgba(245,158,11,0.2)';
          badgeEl.style.color = '#fbbf24';
          badgeEl.style.borderColor = 'rgba(245,158,11,0.45)';
        } else {
          badgeEl.textContent = 'เป็นเวอร์ชันล่าสุดแล้ว';
          badgeEl.style.background = 'rgba(16,185,129,0.18)';
          badgeEl.style.color = '#34d399';
          badgeEl.style.borderColor = 'rgba(16,185,129,0.4)';
        }
      }

      summaryEl.innerHTML =
        `<div>• <b>กิ่งพัฒนา (Branch):</b> <code>${escapeHtml(st.branch || 'main')}</code> · <b>เวอร์ชันเครื่องนี้:</b> <code>${escapeHtml(st.local_commit || 'unknown')}</code> · <b>เวอร์ชันบนเซิร์ฟเวอร์ Git:</b> <code>${escapeHtml(st.remote_commit || 'unknown')}</code></div>` +
        `<div>• <b>สถานะ:</b> ${behind > 0 ? `<span style="color:#fbbf24; font-weight:700;">มีอัปเดตใหม่ ${behind} รายการ (หน้าเว็บ ${st.web_files_changed || 0} ไฟล์, ระบบหลังบ้าน/AI ${st.backend_files_changed || 0} ไฟล์)</span>` : '<span style="color:#34d399; font-weight:600;">เป็นเวอร์ชันล่าสุดตรงกับ Git Repository แล้ว</span>'}</div>` +
        `<div>• <b>ซิงค์หน้าเว็บล่าสุด:</b> ${escapeHtml(lastWebStr)} · <b>อัปเดตเต็มรูปแบบล่าสุด:</b> ${escapeHtml(lastFullStr)}</div>` +
        (st.last_error ? `<div style="color:#f87171;">• <b>ข้อผิดพลาดล่าสุด:</b> ${escapeHtml(st.last_error)}</div>` : '');

      if (commitsEl) {
        const list = Array.isArray(st.pending_commits) ? st.pending_commits : [];
        if (!list.length) {
          commitsEl.innerHTML = '<span style="color:#34d399;">✓ ไม่มีรายการอัปเดตค้าง ระบบเป็นปัจจุบันแล้ว</span>';
        } else {
          commitsEl.innerHTML = list.map(c =>
            `<div style="padding:6px 10px; border-radius:6px; background:rgba(15,23,42,0.7); border:1px solid rgba(148,163,184,0.18);"><code style="color:#38bdf8; margin-right:8px;">${escapeHtml(c.hash || '')}</code><span style="color:#e2e8f0;">${escapeHtml(c.message || '')}</span></div>`
          ).join('');
        }
      }

      // Fetch Native .exe / All-GPU / RTMP / DuckDNS diagnostics if running in Native Edition
      const diagEl = $('nativeRuntimeDiagSummary');
      const modeBadge = $('badgeNativeMode');
      if (diagEl) {
        try {
          const nRes = await fetch('/api/native/health', { signal: timeoutSignal(5000) });
          if (nRes.ok) {
            const nh = await nRes.json();
            const g = (nh.diagnostics && nh.diagnostics.gpu) || {};
            const rtmp = nh.rtmp || {};
            const net = nh.network || {};
            const up = nh.field_uplink || {};
            if (modeBadge) {
              modeBadge.textContent = '🟢 Native Windows .exe (Zero-Docker)';
              modeBadge.style.background = 'rgba(16,185,129,0.2)';
              modeBadge.style.color = '#34d399';
              modeBadge.style.borderColor = 'rgba(16,185,129,0.45)';
            }
            const gpus = Array.isArray(g.gpu_names) && g.gpu_names.length ? g.gpu_names.join(' + ') : 'CPU';
            const provs = Array.isArray(g.ort_selected_providers) ? g.ort_selected_providers.join(', ') : 'CPUExecutionProvider';
            diagEl.innerHTML =
              `<div>• <b>การ์ดจอที่ตรวจพบ (All-GPU):</b> <span style="color:#38bdf8; font-weight:600;">${escapeHtml(gpus)}</span> · <b>Video Encoder:</b> <code>${escapeHtml(g.ffmpeg_h264_encoder || 'libx264')}</code></div>` +
              `<div>• <b>ONNX AI Providers:</b> <code>${escapeHtml(provs)}</code> · <b>โมเดลที่โหลดพร้อมใช้งาน:</b> <code>thlprv2.onnx (384×640)</code>, <code>color.onnx (15 สี)</code>, <code>brand.onnx (24 ยี่ห้อ)</code>, <code>face.onnx + w600k_r50.onnx</code></div>` +
              `<div>• <b>เซิร์ฟเวอร์รับสตรีมโดรน RTMP (:1935):</b> ${rtmp.running ? '<span style="color:#34d399; font-weight:600;">🟢 ออนไลน์พร้อมรับสตรีม</span>' : '<span style="color:#fbbf24;">พร้อมเปิดใช้งาน</span>'} (<code>${escapeHtml(rtmp.rtmp_ingest_url || 'rtmp://<host-ip>:1935/live/<stream>')}</code>)</div>` +
              `<div>• <b>การเชื่อมต่อเว็บ &amp; ศูนย์กลาง:</b> รองรับเข้าผ่านเบราว์เซอร์ · HQ: <code>${escapeHtml(up.hq_url || 'https://vms.local')}</code> · DuckDNS: <code>${escapeHtml(net.duckdns_domain || 'bpp215')}.duckdns.org</code></div>`;
          } else {
            if (modeBadge) modeBadge.textContent = '🌐 HQ Server Mode (vms.local)';
          }
        } catch (_) {
          if (modeBadge) modeBadge.textContent = '🌐 HQ Server Mode (vms.local)';
        }
      }
    } catch (e) {
      summaryEl.textContent = 'ไม่สามารถตรวจสอบสถานะอัปเดตได้: ' + (e.message || e);
    }
  }

  $('btnTabNvr').addEventListener('click', () => {
    setActiveSettingsTab('tabNvr', 'btnTabNvr');
  });
  $('btnTabDash').addEventListener('click', () => {
    setActiveSettingsTab('tabDash', 'btnTabDash');
    renderChList();
    renderChForm();
  });
  $('btnTabLprLearning').addEventListener('click', () => {
    setActiveSettingsTab('tabLprLearning', 'btnTabLprLearning');
    loadLprLearningStatus();
  });
  if ($('btnTabMyAlerts')) {
    $('btnTabMyAlerts').addEventListener('click', () => {
      setActiveSettingsTab('tabMyAlerts', 'btnTabMyAlerts');
      loadMyAlertsSettings();
    });
  }
  if ($('btnTabSystemUpdate')) {
    $('btnTabSystemUpdate').addEventListener('click', () => {
      setActiveSettingsTab('tabSystemUpdate', 'btnTabSystemUpdate');
      loadSystemUpdateStatus(true);
    });
  }
  if ($('btnCheckSystemUpdate')) {
    $('btnCheckSystemUpdate').addEventListener('click', () => loadSystemUpdateStatus(true));
  }
  if ($('btnSaveUpdateSettings')) {
    $('btnSaveUpdateSettings').addEventListener('click', async () => {
      try {
        const autoWebSync = $('chkAutoWebSync') ? $('chkAutoWebSync').checked : true;
        const mins = Math.max(5, Math.min(1440, parseInt($('inpAutoWebSyncMins')?.value || '15', 10) || 15));
        const res = await fetch('/api/config/system/update/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto_web_sync: autoWebSync, interval_minutes: mins }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        toast('บันทึกการตั้งค่าซิงค์หน้าเว็บอัตโนมัติเรียบร้อยแล้ว');
        loadSystemUpdateStatus(false);
      } catch (e) {
        toast('บันทึกการตั้งค่าไม่สำเร็จ: ' + (e.message || e), true);
      }
    });
  }
  if ($('btnSyncWebUiNow')) {
    $('btnSyncWebUiNow').addEventListener('click', async () => {
      try {
        toast('กำลังซิงค์ไฟล์หน้าเว็บล่าสุดแบบ Zero-Downtime…');
        const res = await fetch('/api/config/system/update/web-sync', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || ('HTTP ' + res.status));
        toast('✓ ซิงค์หน้าเว็บสำเร็จ (' + (data.synced_commit || 'latest') + ') — รีเฟรชหน้าจอได้ทันที');
        loadSystemUpdateStatus(false);
      } catch (e) {
        toast('ซิงค์หน้าเว็บไม่สำเร็จ: ' + (e.message || e), true);
      }
    });
  }
  if ($('btnApplyFullUpdate')) {
    $('btnApplyFullUpdate').addEventListener('click', async () => {
      const ok = await window.bppConfirm(
        'ต้องการอัปเดตระบบทั้งหมด (หน้าเว็บ + Backend + โมเดล AI) ใช่หรือไม่?\n\n• ระบบจะสำรองไฟล์ config.yml อัตโนมัติก่อนอัปเดต\n• สตรีมวิดีโอสดจะไม่ถูกล้างค่ากล้อง'
      );
      if (!ok) return;
      try {
        toast('กำลังสำรองการตั้งค่าและอัปเดตระบบทั้งหมด…');
        const res = await fetch('/api/config/system/update/apply', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || ('HTTP ' + res.status));
        toast('✓ อัปเดตระบบสำเร็จ (' + (data.updated_commit || 'latest') + ') — กำลังรีโหลดหน้าเว็บใน 3 วินาที');
        loadSystemUpdateStatus(false);
        setTimeout(() => location.reload(), 3000);
      } catch (e) {
        toast('อัปเดตระบบไม่สำเร็จ: ' + (e.message || e), true);
      }
    });
  }

  // ADR-0021: Admin Master Grid Propagation & Template Loader Controls
  const btnLoadMaster = $('btnLoadMasterToDraft');
  if (btnLoadMaster) {
    btnLoadMaster.addEventListener('click', async () => {
      const ok = await window.bppConfirm('ต้องการโหลด "ผังแม่แบบระบบส่วนกลาง (System Master Grid)" เข้ามาดูหรือแก้ไขใช่หรือไม่?\n\n(หากต้องการให้การแก้ไขมีผลเป็นผังระบบ ต้องเปิดติ๊กถูก "อัปเดตผังแม่แบบระบบส่วนกลาง" และกด "บันทึก")');
      if (!ok) return;
      const master = await fetchServerMasterChannels();
      if (master) {
        state.draft = master.map(c => ({ ...c }));
        state.dirty = state.dirty || {};
        state.dirty.channels = true;
        if ($('chkPropagateMaster')) $('chkPropagateMaster').checked = true;
        if ($('txtGridBannerTitle')) $('txtGridBannerTitle').textContent = 'ผังแม่แบบระบบส่วนกลาง (กำลังแก้ไข Master Template)';
        if ($('tagGridBanner')) {
          $('tagGridBanner').textContent = 'แม่แบบระบบ';
          $('tagGridBanner').style.background = 'rgba(239,68,68,0.2)';
          $('tagGridBanner').style.color = '#f87171';
        }
        renderChList();
        renderChForm();
        toast('โหลดผังแม่แบบระบบส่วนกลางเข้าสู่ฟอร์มเรียบร้อย');
      }
    });
  }

  const chkPropMaster = $('chkPropagateMaster');
  if (chkPropMaster) {
    chkPropMaster.addEventListener('change', () => {
      if (chkPropMaster.checked) {
        if ($('txtGridBannerTitle')) $('txtGridBannerTitle').textContent = 'ผังแม่แบบระบบส่วนกลาง (จะถูกบันทึกเป็นค่ามาตรฐานระบบ)';
        if ($('tagGridBanner')) {
          $('tagGridBanner').textContent = 'แม่แบบระบบ';
          $('tagGridBanner').style.background = 'rgba(239,68,68,0.2)';
          $('tagGridBanner').style.color = '#f87171';
        }
      } else {
        if ($('txtGridBannerTitle')) $('txtGridBannerTitle').textContent = 'ผังหน้าจอของคุณ (Personal Screen Grid)';
        if ($('tagGridBanner')) {
          $('tagGridBanner').textContent = 'ผังหน้าจอ';
          $('tagGridBanner').style.background = 'rgba(168,85,247,0.2)';
          $('tagGridBanner').style.color = '#c084fc';
        }
      }
    });
  }

  const btnCopyCurrent = $('btnCopyCurrentToMaster');
  if (btnCopyCurrent) {
    btnCopyCurrent.addEventListener('click', () => {
      state.draft = cfg.channels.map(c => ({ ...c }));
      state.dirty = state.dirty || {};
      state.dirty.channels = true;
      renderChList();
      renderChForm();
      toast('ดึงผังหน้าจอสดของคุณขณะนี้เข้ามาในฟอร์มเรียบร้อย');
    });
  }

  const btnReqPair = $('btnReqPairCode');
  if (btnReqPair) {
    btnReqPair.addEventListener('click', () => {
      requestTelegramPairCode(state.alertTargetUser || '');
    });
  }
  const btnClosePairBox = $('btnClosePairCodeBox');
  if (btnClosePairBox) {
    btnClosePairBox.addEventListener('click', () => {
      if (pairPollTimer) { clearInterval(pairPollTimer); pairPollTimer = null; }
      const b = $('boxPairCodeDisplay');
      if (b) b.style.display = 'none';
    });
  }

  const selAlertTarget = $('selAlertTargetUser');
  if (selAlertTarget) {
    selAlertTarget.addEventListener('change', e => {
      state.alertTargetUser = e.target.value;
      loadMyAlertsSettings();
    });
  }

  const btnToggleAdminUsers = $('btnToggleAdminUsersList');
  if (btnToggleAdminUsers) {
    btnToggleAdminUsers.addEventListener('click', () => {
      const list = $('adminUserAlertsList');
      const lbl = $('lblToggleAdminUsers');
      const icon = $('iconToggleAdminUsers');
      if (!list) return;
      const isHidden = (list.style.display === 'none' || list.hidden);
      list.style.display = isHidden ? 'flex' : 'none';
      list.hidden = !isHidden;
      if (lbl) lbl.textContent = isHidden ? 'กดย่อเพื่อซ่อน' : 'กดเพื่อเปิดดูรายชื่อ';
      if (icon) icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    });
  }
  $('btnRefreshLprLearning').addEventListener('click', loadLprLearningStatus);
  $('btnSaveLprMinSamples').addEventListener('click', saveLprLearningThreshold);
  if ($('btnTriggerLprTrainNow')) $('btnTriggerLprTrainNow').addEventListener('click', triggerLprTrainingNow);
  if($('inpCamSelect')) {
    $('inpCamSelect').addEventListener('change', e => { 
      const selName = e.target.value;
      const draftChannel = state.draft[state.selCh];
      // Keep the channel fallback technical as well. Display text belongs only
      // to camera_names.json, preventing one channel from renaming another.
      draftChannel.src = selName;
      draftChannel.name = selName;
      draftChannel.sub = '';
      draftChannel.hd = '';
      normalizeChannelStreams(draftChannel);
      markDirty(state.selCh); 
      renderChList();
      renderChForm(); 
    });
  }
  $('inpName').addEventListener('input', e => { 
    const d = state.draft[state.selCh]; 
    if (!d.src) return;
    const displayName = e.target.value.trim();
    if (!state.cameraNames) state.cameraNames = {};
    // A blank value removes only the optional presentation override and keeps
    // the canonical source usable with its technical-ID fallback.
    if (displayName) state.cameraNames[d.src] = displayName;
    else delete state.cameraNames[d.src];
    markDirty(state.selCh); 
    $('selChName').textContent = displayCameraName(d.src, d.name) || '- ไม่มี -'; 
  });

  if ($('btnClearDashboard')) {
    $('btnClearDashboard').addEventListener('click', async () => {
      const ok = await window.bppConfirm('คุณแน่ใจว่าต้องการเคลียร์แดชบอร์ด?\n\nกล้องทั้งหมดจะถูกซ่อน และ AI จะถูกปิดเฉพาะหน้าจอของคุณ\n(ไม่กระทบผู้ใช้คนอื่น)');
      if (!ok) return;

      if (!state.userProfile) state.userProfile = { hidden_channels: [], visible_channels: [] };
      
      // 1. ซ่อนกล้องทั้งหมด (user-only)
      state.userProfile.hidden_channels = cfg.channels
        .map((c, idx) => c.src || `CH${String(idx + 1).padStart(2, '0')}`)
        .filter(Boolean);
      
      // 2. ปิด AI ทั้งหมด (user-only)
      if (!state.userProfile.disabled_ai_cameras) state.userProfile.disabled_ai_cameras = [];
      state.userProfile.disabled_ai_cameras = cfg.channels
        .map((c, idx) => c.src || ('CH' + String(idx + 1).padStart(2, '0')))
        .filter(Boolean);
      
      await saveUserProfile();
      
      renderChList();
      renderChForm();
      applyAutoLayout(true);
      rebuildGrid();
      renderObjGrid();
      
      if (window.bppToast) window.bppToast('เคลียร์แดชบอร์ดเรียบร้อย — กล้องถูกซ่อน และ AI ถูกปิดเฉพาะคุณ');
    });
  }

  // ADR-0024: Account / Global Kill-Switch (Admin / Superadmin; backend re-checks the role)
  [
    ['btnAcctStreamOff', 'stream_off', 'account'], ['btnAcctAiOff', 'ai_off', 'account'], ['btnAcctStreamOn', 'stream_on', 'account'],
    ['btnAllStreamOff', 'stream_off', 'all'], ['btnAllAiOff', 'ai_off', 'all'], ['btnAllStreamOn', 'stream_on', 'all'],
  ].forEach(([id, action, scope]) => {
    const b = $(id);
    if (b) b.addEventListener('click', () => { if (isKillSwitchAuthorized()) runGridKillSwitch(action, scope); });
  });

  const btnSysStream = $('btnSysStream');
  if (btnSysStream) {
    btnSysStream.addEventListener('click', async () => {
      // CLAUDE.md Section 10: Guard against unauthorized stream control
      if (!['admin', 'superadmin'].includes(userRole)) return;
      const d = (state.draft || cfg.channels)[state.selCh]; 
      if (!d || !d.src) return;
      
      const chNum = chLabel(state.selCh);
      const camName = d.src;
      const currentEnabled = d.enabled !== false;
      const targetEnabled = !currentEnabled;
      
      btnSysStream.classList.add('busy');
      btnSysStream.innerHTML = targetEnabled 
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin" style="vertical-align:-2px;margin-right:4px;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>กำลังเปิด…' 
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin" style="vertical-align:-2px;margin-right:4px;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>กำลังปิด…';
      
      try {
        // 1. Update local draft & cfg.channels
        d.enabled = targetEnabled;
        if (state.draft && state.draft[state.selCh]) {
          state.draft[state.selCh].enabled = targetEnabled;
        }
        if (cfg.channels[state.selCh]) {
          cfg.channels[state.selCh].enabled = targetEnabled;
        }
        
        // 2. Persist to central channels settings on server
        saveCfg();
        await saveServerChannels();
        
        // 3. Trigger Demand-Driven Provisioning Reconciliation (ADR-0020)
        triggerDemandReconciliation(false);
        
        // 6. Provide immediate feedback & UI update
        const actionText = targetEnabled ? 'เปิดดึงภาพสด (ระดับระบบ)' : 'หยุดดึงภาพสด (ระดับระบบ)';
        if (window.bppToast) {
          window.bppToast(`${actionText} สำหรับ ${chNum} (${camName}) เรียบร้อย`);
        }
        
        renderChList();
        renderChForm();
        applyAutoLayout(true);
        rebuildGrid();
      } catch (err) {
        console.error('Quick toggle system stream failed:', err);
        if (window.bppToast) {
          window.bppToast(`เกิดข้อผิดพลาดในการเปลี่ยนสถานะสตรีม: ${err.message}`, true);
        }
        btnSysStream.classList.remove('busy');
        renderChForm();
      }
    });
  }

  $('btnChEnabled').addEventListener('click', async () => {
    const d = (state.draft || cfg.channels)[state.selCh]; if (!d || !d.src) return;
    const chNum = chLabel(state.selCh);
    const imp = state.impersonatingUser;
    const targetProf = imp ? (state.allUserProfilesCache?.[imp] || {}) : (state.userProfile || (state.userProfile = { hidden_channels: [], visible_channels: [] }));
    if (!targetProf.hidden_channels) targetProf.hidden_channels = [];
    
    const hiddenSet = new Set(targetProf.hidden_channels);
    const isHidden = !!(d.src && hiddenSet.has(d.src));
    
    if (!isHidden) {
      if (d.src && !targetProf.hidden_channels.includes(d.src)) targetProf.hidden_channels.push(d.src);
    } else {
      targetProf.hidden_channels = targetProf.hidden_channels.filter(x => x !== d.src);
    }
    
    if (imp) {
      if (state.allUserProfilesCache) state.allUserProfilesCache[imp] = targetProf;
      try {
        await fetch('/api/nas-bot/admin/user-profile/' + encodeURIComponent(imp), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(targetProf)
        });
      } catch (e) {}
    } else {
      await saveUserProfile();
    }
    renderChList();
    renderChForm();
    if (!imp) {
      applyAutoLayout(true);
      rebuildGrid();
    }
    if (window.bppToast) window.bppToast(!isHidden ? `ซ่อน ${chNum} จากหน้าจอแล้ว` : `แสดง ${chNum} บนหน้าจอแล้ว`);
  });
  const btnChDetect = $('btnChDetect');
  if (btnChDetect) {
    btnChDetect.addEventListener('click', async () => {
      const d = (state.draft || cfg.channels)[state.selCh]; if (!d || !d.src) return;
      const chNum = chLabel(state.selCh);
      // ADR-0024: this button sets THIS account's AI demand. Frigate is toggled only when
      // the camera's total demand across accounts changes between none and some.
      const imp = state.impersonatingUser;
      const targetProf = imp ? (state.allUserProfilesCache?.[imp] || {}) : (state.userProfile || {});
      const disabledAiSet = new Set(targetProf.disabled_ai_cameras || []);
      const currentOn = (d.detect === true) && !disabledAiSet.has(d.src);
      const targetOn = !currentOn;

      const applyOwnFlag = (val) => {
        d.detect = val;
        if (state.draft && state.draft[state.selCh]) state.draft[state.selCh].detect = val;
        if (imp) {
          if (!Array.isArray(targetProf.channels) || !targetProf.channels.length) {
            targetProf.channels = (state.draft || []).map(c => ({ ...c }));
            if (state.allUserProfilesCache) state.allUserProfilesCache[imp] = targetProf;
          }
          if (targetProf.channels[state.selCh]) targetProf.channels[state.selCh].detect = val;
        } else {
          if (cfg.channels[state.selCh]) cfg.channels[state.selCh].detect = val;
          if (!state.userProfile) state.userProfile = {};
          state.userProfile.channels = cfg.channels.map(c => ({ ...c }));
        }
        if (!targetProf.disabled_ai_cameras) targetProf.disabled_ai_cameras = [];
        if (val) {
          targetProf.disabled_ai_cameras = targetProf.disabled_ai_cameras.filter(
            x => x !== d.src && x !== chNum && x !== String(state.selCh)
          );
        } else if (d.src && !targetProf.disabled_ai_cameras.includes(d.src)) {
          targetProf.disabled_ai_cameras.push(d.src);
        }
      };
      const persistOwnFlag = async () => {
        if (imp) {
          try {
            await fetch('/api/nas-bot/admin/user-profile/' + encodeURIComponent(imp), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(targetProf)
            });
          } catch (e) {}
        } else {
          await saveUserProfile();
        }
      };

      applyOwnFlag(targetOn);
      renderChForm();
      await persistOwnFlag();

      const counts = await fetchAiDemandCounts();
      const wantFrigate = counts ? (counts[d.src] || 0) > 0 : targetOn;
      // Always enforce setFrigateAi when wantFrigate is false (to self-heal out-of-sync Frigate runtime state) or when state differs
      if (wantFrigate && wantFrigate === liveFrigateAiOn(d.src)) {
        const others = counts ? Math.max(0, (counts[d.src] || 0) - (targetOn ? 1 : 0)) : 0;
        if (window.bppToast) {
          window.bppToast(targetOn
            ? `เปิด AI ${chNum} (${d.src}) ให้บัญชีนี้แล้ว`
            : `ปิด AI ${chNum} (${d.src}) ของบัญชีนี้แล้ว` + (others > 0 ? ` — Frigate ยังเปิดอยู่เพราะอีก ${others} บัญชีใช้งาน` : ''));
        }
      } else {
        const r = await setFrigateAi(d.src, wantFrigate);
        if (r.ok) {
          const others = counts ? Math.max(0, (counts[d.src] || 0) - (targetOn ? 1 : 0)) : 0;
          if (window.bppToast) {
            window.bppToast(wantFrigate
              ? (targetOn ? `เปิด AI ${chNum} (${d.src}) แล้ว` : `ปิด AI ${chNum} (${d.src}) ของบัญชีนี้แล้ว — Frigate ยังเปิดอยู่เพราะอีก ${others} บัญชีใช้งาน`)
              : `ปิด AI ${chNum} (${d.src}) ใน Frigate แล้ว (ไม่มีบัญชีใดใช้งาน)`);
          }
        } else {
          applyOwnFlag(currentOn);
          await persistOwnFlag();
          await fetchAiDemandCounts();
          const msg = r.status === 409
            ? (r.detail || 'สตรีมระบบของกล้องนี้ถูกปิดอยู่ ต้องเปิดสตรีมระบบก่อนจึงจะเปิด AI ได้')
            : (r.status ? `ไม่สามารถเปลี่ยนสถานะ AI ได้ (HTTP ${r.status})` : 'ไม่สามารถเชื่อมต่อ Config API ได้');
          if (window.bppToast) window.bppToast(msg, true);
        }
      }

      renderChList();
      renderChForm();
      renderObjGrid();
      renderMyAlertsMatrix();
    });
  }

  const btnChLpr = $('btnChLpr');
  if (btnChLpr) {
    btnChLpr.addEventListener('click', async () => {
      const d = (state.draft || cfg.channels)[state.selCh]; if (!d || !d.src) return;
      const chNum = chLabel(state.selCh);
      const targetProf = state.impersonatingUser ? (state.allUserProfilesCache?.[state.impersonatingUser] || {}) : (state.userProfile || {});
      if (!targetProf.disabled_lpr_cameras) targetProf.disabled_lpr_cameras = [];
      
      if (!state.lprCams) state.lprCams = new Set();
      const inLprSet = state.lprCams.has(d.src);
      const disabledLprSet = new Set(targetProf.disabled_lpr_cameras);
      const isLprDisabledByMe = disabledLprSet.has(d.src);
      const currentOn = inLprSet && !isLprDisabledByMe;
      const targetOn = !currentOn;
      
      // 1. Update state.lprCams
      if (targetOn) {
        state.lprCams.add(d.src);
        targetProf.disabled_lpr_cameras = targetProf.disabled_lpr_cameras.filter(
          x => x !== d.src && x !== chNum && x !== String(state.selCh)
        );
      } else {
        state.lprCams.delete(d.src);
        if (d.src && !targetProf.disabled_lpr_cameras.includes(d.src)) {
          targetProf.disabled_lpr_cameras.push(d.src);
        }
      }
      state.lprDirty = true;
      
      // 2. Save user profile
      if (state.impersonatingUser) {
        try {
          await fetch('/api/nas-bot/admin/user-profile/' + encodeURIComponent(state.impersonatingUser), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(targetProf)
          });
        } catch(e) {}
      } else {
        await saveUserProfile();
      }
      
      // 3. Save LPR cameras file to server so lpr-service hot reloads
      try {
        await saveLprCameras();
      } catch (e) {
        console.warn('saveLprCameras error:', e);
      }
      
      renderChForm();
      if (window.bppToast) {
        window.bppToast(targetOn ? (`เปิด LPR อ่านป้ายทะเบียน ${chNum} (${d.src}) เรียบร้อย`) : (`ปิด LPR ${chNum} (${d.src}) เรียบร้อย`));
      }
    });
  }

  const btnChFace = $('btnChFace');
  if (btnChFace) {
    btnChFace.addEventListener('click', async () => {
      const d = (state.draft || cfg.channels)[state.selCh]; if (!d || !d.src) return;
      const chNum = chLabel(state.selCh);
      const targetProf = state.impersonatingUser ? (state.allUserProfilesCache?.[state.impersonatingUser] || {}) : (state.userProfile || {});
      if (!targetProf.disabled_face_cameras) targetProf.disabled_face_cameras = [];
      if (!state.disabledFaceCams) state.disabledFaceCams = new Set();

      const disabledAiSet = new Set(targetProf.disabled_ai_cameras || []);
      const isSysAiOn = (d.detect === true) && !disabledAiSet.has(d.src);
      const isFaceDisabled = state.disabledFaceCams.has(d.src) || targetProf.disabled_face_cameras.includes(d.src);
      const currentOn = isSysAiOn && !isFaceDisabled;
      const targetOn = !currentOn;

      if (targetOn) {
        // Ensure AI (person detect) is also enabled on this camera
        d.detect = true;
        if (Array.isArray(targetProf.disabled_ai_cameras)) {
          targetProf.disabled_ai_cameras = targetProf.disabled_ai_cameras.filter(x => x !== d.src);
        }
        state.disabledFaceCams.delete(d.src);
        targetProf.disabled_face_cameras = targetProf.disabled_face_cameras.filter(x => x !== d.src);
      } else {
        state.disabledFaceCams.add(d.src);
        if (!targetProf.disabled_face_cameras.includes(d.src)) {
          targetProf.disabled_face_cameras.push(d.src);
        }
      }

      // Persist to Face Engine via API
      try {
        await fetch('/api/watchlist/faces/cameras', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            camera: d.src,
            enabled: targetOn,
            disabled_cameras: Array.from(state.disabledFaceCams),
          }),
        });
      } catch (e) {
        console.warn('saveFaceCameras error:', e);
      }

      // Save user profile
      if (state.impersonatingUser) {
        try {
          await fetch('/api/nas-bot/admin/user-profile/' + encodeURIComponent(state.impersonatingUser), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(targetProf),
          });
        } catch (e) {}
      } else {
        await saveUserProfile();
      }

      renderChForm();
      renderChList();
      if (window.bppToast) {
        window.bppToast(targetOn
          ? `เปิดระบบตรวจจับใบหน้า & เทียบหมายจับ ${chNum} (${d.src}) เรียบร้อย`
          : `ปิดระบบตรวจจับใบหน้า ${chNum} (${d.src}) เรียบร้อย`);
      }
    });
  }


  const btnCloseLz = $('btnCloseLz'); if(btnCloseLz) btnCloseLz.addEventListener('click', closeLprZone);
  $('btnChLprZone').addEventListener('click', () => {
    if (window.toast) toast('กำลังเปิดโซนป้าย...');
    const name = selectedCamName();
    if (name) {
      openLprZone(name);
    } else {
      if (window.toast) toast('ไม่สามารถระบุกล้องที่เลือกได้ (selectedCamName is null)');
    }
  });

  window.addEventListener('resize', applyGridCols);
  window.addEventListener('beforeunload', () => {
    state.tiles.forEach(t => { if (t.cam) t.cam.destroy(); });
    if (state.viewerCam) state.viewerCam.destroy();
  });

  // Incident 1.63: pause/resume cameras เมื่อสลับ tab
  // เมื่อ tab hidden → หยุด watchdog+ping เพื่อป้องกัน false positive จาก browser throttle
  // เมื่อ tab visible → ตรวจ PeerConnection state: ถ้ายัง connected = ไม่ต้อง reconnect
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Tab hidden → pause ทุก Camera
      state.hiddenSince = Date.now();
      state.tiles.forEach(t => { if (t.cam && !t.cam.suspended) t.cam.pause(); });
      if (state.viewerCam && !state.viewerCam.suspended) state.viewerCam.pause();
    } else {
      // Tab visible → ตรวจสอบ + resume ทันที (stagger เล็กน้อย 0-200ms)
      if (modalSuspensionDepth > 0) return; // ไม่ resume หากเปิดหน้าต่าง Modal ค้างอยู่
      state.tiles.forEach(t => {
        if (t.cam && !t.cam.suspended && !t.cam.viewerPaused) {
          const delay = Math.random() * 200;
          setTimeout(() => {
            if (modalSuspensionDepth === 0 && t.cam && !t.cam.suspended && !t.cam.viewerPaused) t.cam.resume();
          }, delay);
        }
      });
      if (state.viewerCam && !state.viewerCam.suspended) state.viewerCam.resume();
      state.hiddenSince = null;
    }
  });
} // end init()

let federatedNodes = [];
// Load only administrator-managed peer metadata from the local settings volume.
// Remote nodes are consumed server-side by LPR; this function never contacts a
// peer or changes the browser's Frigate API origin.
async function loadFederationNodes() {
  if (!['admin', 'superadmin'].includes(window.bppSession?.role)) return;
  try {
    const res = await fetch('/settings/nodes');
    if (res.ok) {
      const nodes = await res.json();
      // Settings files are mutable runtime data. Keep only bounded string fields
      // used by the editor so malformed JSON shapes cannot break page startup.
      federatedNodes = Array.isArray(nodes)
        ? nodes.filter(node => node && typeof node === 'object').map(node => ({
          name: typeof node.name === 'string' ? node.name.slice(0, 80) : '',
          ip: typeof node.ip === 'string' ? node.ip.slice(0, 255) : '',
        }))
        : [];
    } else {
      federatedNodes = [];
    }
  } catch (e) {
    federatedNodes = [];
  }

  const btnNodes = $('btnNodes');
  const nodesOverlay = $('nodesOverlay');
  const btnCloseNodes = $('btnCloseNodes');
  const btnAddNode = $('btnAddNode');
  const nodesList = $('nodesList');
  const btnSaveNodes = $('btnSaveNodes');

  if (btnNodes) {
    btnNodes.addEventListener('click', async () => {
      renderNodesList();
      
      // Load Federation Shared Secret
      const inpNodeSecret = $('inpNodeSecret');
      if (inpNodeSecret) {
        inpNodeSecret.value = '';
        try {
          const res = await fetch('/settings/secret?t=' + Date.now());
          if (res.ok) {
            const data = await res.json();
            if (data && data.WATCHLIST_FEDERATION_SHARED_SECRET) {
              inpNodeSecret.value = data.WATCHLIST_FEDERATION_SHARED_SECRET;
            }
          }
        } catch (e) {
          console.error('Failed to load federation secret', e);
        }
      }
      
      nodesOverlay.hidden = false;
    });
  }
  if (btnCloseNodes) {
    btnCloseNodes.addEventListener('click', () => nodesOverlay.hidden = true);
  }

  function renderNodesList() {
    nodesList.innerHTML = '';
    if (federatedNodes.length === 0) {
      nodesList.innerHTML = '<div style=\"color:#9aa0bd; font-size:13px; text-align:center;\">ยังไม่มีการเชื่อมต่อหน่วยงานอื่น</div>';
    }
    federatedNodes.forEach((node, idx) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '10px';
      row.style.alignItems = 'center';
      
      const inpName = document.createElement('input');
      inpName.className = 'inp';
      inpName.placeholder = 'ชื่อหน่วย (เช่น ตชด.214)';
      inpName.value = node.name || '';
      inpName.onchange = (e) => federatedNodes[idx].name = e.target.value;

      const inpIp = document.createElement('input');
      inpIp.className = 'inp';
      // The LPR worker canonicalizes this host to HTTPS and rejects paths,
      // credentials, clear-text schemes, redirects, and invalid TLS certificates.
      inpIp.placeholder = 'HTTPS host หรือ host:port';
      inpIp.value = node.ip || '';
      inpIp.onchange = (e) => federatedNodes[idx].ip = e.target.value;

      const btnDel = document.createElement('button');
      btnDel.className = 'btn-ghost';
      btnDel.textContent = 'ลบ';
      btnDel.onclick = () => {
        federatedNodes.splice(idx, 1);
        renderNodesList();
      };

      row.appendChild(inpName);
      row.appendChild(inpIp);
      row.appendChild(btnDel);
      nodesList.appendChild(row);
    });
  }

  if (btnAddNode) {
    btnAddNode.addEventListener('click', () => {
      federatedNodes.push({ name: '', ip: '' });
      renderNodesList();
    });
  }

  if (btnSaveNodes) {
    btnSaveNodes.addEventListener('click', async () => {
      // Persist only bounded text fields. The server-side Federation client still
      // performs the authoritative HTTPS/host validation before sending a secret.
      federatedNodes = federatedNodes
        .map(node => ({
          name: String(node.name || '').trim().slice(0, 80),
          ip: String(node.ip || '').trim().slice(0, 255),
        }))
        .filter(node => node.ip !== '');
      try {
        // Save Nodes
        const res = await fetch('/settings/admin/nodes', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(federatedNodes)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        
        // Save Secret
        const inpNodeSecret = $('inpNodeSecret');
        if (inpNodeSecret) {
          const secretValue = inpNodeSecret.value.trim();
          await fetch('/settings/secret', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ WATCHLIST_FEDERATION_SHARED_SECRET: secretValue })
          });
        }
        
        toast('บันทึกข้อมูลโหนดและรหัสผ่านสำเร็จ');
        nodesOverlay.hidden = true;
      } catch (e) {
        toast('เกิดข้อผิดพลาดในการบันทึกโหนด');
      }
    });
  }

  // ========== Camera Manager Module Removed (Use config-api instead) ==========
  
  // ========== End Federation Module ==========
}

let watchlistSSE = null;
let frigateRealtimeWS = null;
let frigateWsRetryT = null;
let _rtEventRefreshT = null;
let _rtPendingLpr = false;

function scheduleRealtimeEventRefresh(opts = {}) {
  if (opts.includeLpr) _rtPendingLpr = true;
  if (_rtEventRefreshT) return;
  _rtEventRefreshT = setTimeout(async () => {
    _rtEventRefreshT = null;
    const wantLpr = _rtPendingLpr;
    _rtPendingLpr = false;
    if (wantLpr) {
      lastLprFetchTs = Date.now() / 1000;
      fetchEmgrLprIndex();
    }
    await fetchEvents();
  }, 350);
}

function connectWatchlistSSE() {
  if (cfg.demo) return;
  if (watchlistSSE) {
    try { watchlistSSE.close(); } catch (e) {}
  }
  try {
    watchlistSSE = new EventSource('/api/watchlist/stream');
    watchlistSSE.onmessage = (e) => {
      const raw = String(e.data || '').trim();
      if (!raw || raw === 'ping' || raw === 'keepalive') return;
      if (raw === 'new_vigi_event' || raw.includes('lpr') || raw.includes('event') || raw.includes('plate') || raw.startsWith('{')) {
        scheduleRealtimeEventRefresh({ includeLpr: true });
      }
    };
    watchlistSSE.onerror = () => {
      try { watchlistSSE.close(); } catch (e) {}
      setTimeout(connectWatchlistSSE, 5000);
    };
  } catch (e) {}
}

function connectFrigateRealtimeWS() {
  if (cfg.demo) return;
  clearTimeout(frigateWsRetryT);
  if (frigateRealtimeWS) {
    frigateRealtimeWS.onclose = frigateRealtimeWS.onerror = frigateRealtimeWS.onmessage = null;
    try { frigateRealtimeWS.close(); } catch (e) {}
    frigateRealtimeWS = null;
  }
  try {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/nvr/ws`);
    frigateRealtimeWS = ws;
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data);
        const topic = String(msg.topic || '');
        if (topic === 'events' || topic.endsWith('/events')) {
          scheduleRealtimeEventRefresh({ includeLpr: true });
        }
      } catch (e) {}
    };
    ws.onclose = () => {
      frigateWsRetryT = setTimeout(connectFrigateRealtimeWS, 5000);
    };
    ws.onerror = () => {
      try { ws.close(); } catch (e) {}
    };
  } catch (e) {
    frigateWsRetryT = setTimeout(connectFrigateRealtimeWS, 8000);
  }
}

let _wakeLockSentinel = null;
async function acquireScreenWakeLock() {
  if (!('wakeLock' in navigator) || document.hidden) return;
  try {
    if (_wakeLockSentinel) return;
    _wakeLockSentinel = await navigator.wakeLock.request('screen');
    _wakeLockSentinel.addEventListener('release', () => {
      _wakeLockSentinel = null;
    });
  } catch (e) {}
}

function run24x7HealthScrubber() {
  // 1. Re-verify Screen WakeLock for 24/7 wallboard monitors
  acquireScreenWakeLock();

  // 2. Trim MSE buffers & nudge drifted live streams back to live edge
  const activeCams = [];
  if (Array.isArray(state.tiles)) {
    state.tiles.forEach(t => { if (t && t.cam) activeCams.push(t.cam); });
  }
  if (state.viewerCam) activeCams.push(state.viewerCam);

  activeCams.forEach(cam => {
    if (!cam || cam.dead || cam.paused || cam.viewerPaused || cam.suspended) return;
    const v = cam.video;
    if (cam.sb && !cam.sb.updating && cam.sb.buffered && cam.sb.buffered.length > 0) {
      try {
        const start0 = cam.sb.buffered.start(0);
        const end = cam.sb.buffered.end(cam.sb.buffered.length - 1);
        if (end - start0 > 10) {
          cam.sb.remove(start0, end - 6);
        }
        if (v && end - v.currentTime > 3.5) {
          v.currentTime = Math.max(0, end - 0.6);
        }
      } catch (e) {}
    }
  });

  // 3. Bound in-memory caches so 24/7 tabs never leak RAM over weeks of uptime
  try {
    if (typeof pb !== 'undefined' && pb) {
      if (pb.evCache instanceof Map && pb.evCache.size > 30) {
        const keys = Array.from(pb.evCache.keys());
        keys.slice(0, keys.length - 20).forEach(k => pb.evCache.delete(k));
      }
      if (pb.recCache instanceof Map && pb.recCache.size > 30) {
        const keys = Array.from(pb.recCache.keys());
        keys.slice(0, keys.length - 20).forEach(k => pb.recCache.delete(k));
      }
    }
    const emgrOpen = Boolean($('eventMgrOverlay') && !$('eventMgrOverlay').hidden);
    if (!emgrOpen && Array.isArray(state.emgrEvents) && state.emgrEvents.length > 500) {
      state.emgrEvents.length = 500;
    }
  } catch (e) {}
}

let _lastNamesDigest = '';
async function syncRealtimeConfigDigest() {
  if (cfg.demo || state.editLayout) return;
  const settingsOpen = Boolean($('settingsOverlay') && !$('settingsOverlay').hidden);
  if (settingsOpen) return;
  try {
    const res = await fetch('/settings/camera_names?t=' + Date.now(), { cache: 'no-store', signal: timeoutSignal(5000) });
    if (res.ok) {
      const names = await res.json();
      if (names && typeof names === 'object') {
        const digest = JSON.stringify(names);
        if (_lastNamesDigest && _lastNamesDigest !== digest) {
          state.cameraNames = names;
          syncGridDiffSmoothly();
          renderEvents();
        }
        _lastNamesDigest = digest;
      }
    }
  } catch (e) {}
}

let _currentCssVer = null;
let _currentJsVer = null;
let _pendingJsReload = false;

function isAnyModalOrViewerActive() {
  if (state.viewerOpen || state.editLayout || modalSuspensionDepth > 0) return true;
  const overlays = ['settingsOverlay', 'eventMgrOverlay', 'playerOverlay', 'playbackOverlay', 'edOverlay', 'watchlistOverlay'];
  return overlays.some(id => {
    const el = $(id);
    return el && !el.hidden;
  });
}

function performWarmSoftReload() {
  try {
    const map = {};
    (state.tiles || []).forEach((t, i) => {
      const ch = cfg.channels[i];
      if (ch && ch.src && t && t.video) {
        const snap = captureVideoPoster(t.video, 480);
        if (snap) map[ch.src] = snap;
      }
    });
    sessionStorage.setItem('bpp_warm_posters', JSON.stringify({ ts: Date.now(), map }));
  } catch (e) {}
  window.location.reload();
}

function initLiveAssetVersionWatcher() {
  const cssLink = document.querySelector('link[href*="assets/app.css"]');
  const jsScript = document.querySelector('script[src*="assets/app.js"]');
  if (cssLink) {
    const m = (cssLink.getAttribute('href') || '').match(/app\.css\?v=([^&"']+)/);
    if (m) _currentCssVer = m[1];
  }
  if (jsScript) {
    const m = (jsScript.getAttribute('src') || '').match(/app\.js\?v=([^&"']+)/);
    if (m) _currentJsVer = m[1];
  }

  setInterval(async () => {
    if (_pendingJsReload && !isAnyModalOrViewerActive()) {
      performWarmSoftReload();
      return;
    }
    try {
      const res = await fetch('/index.html?_hc=' + Date.now(), { cache: 'no-store', signal: timeoutSignal(6000) });
      if (!res.ok) return;
      const html = await res.text();
      const cssMatch = html.match(/assets\/app\.css\?v=([^&"'>\s]+)/);
      const jsMatch = html.match(/assets\/app\.js\?v=([^&"'>\s]+)/);

      if (cssMatch && _currentCssVer && cssMatch[1] !== _currentCssVer) {
        _currentCssVer = cssMatch[1];
        const linkEl = document.querySelector('link[href*="assets/app.css"]');
        if (linkEl) {
          linkEl.setAttribute('href', `assets/app.css?v=${_currentCssVer}&_t=${Date.now()}`);
          console.log('[BPP-VMS] Hot-reloaded app.css to v=' + _currentCssVer);
        }
      }
      if (jsMatch && _currentJsVer && jsMatch[1] !== _currentJsVer) {
        _currentJsVer = jsMatch[1];
        _pendingJsReload = true;
        if (!isAnyModalOrViewerActive()) {
          performWarmSoftReload();
        }
      }
    } catch (e) {}
  }, 45000);
}

async function init() {
  // 1. Clock starts immediately in 0ms so the screen displays live system time right away
  try {
    tickClock();
    setInterval(tickClock, 1000);
  } catch (errClock) {
    console.error('[BPP-VMS] tickClock failed:', errClock);
  }

  // 2. Hide events drawer on mobile screen widths so UI is never obstructed
  try {
    if (window.innerWidth <= 899) {
      setEventsOpen(false);
    }
  } catch (errEvents) {
    console.error('[BPP-VMS] setEventsOpen failed:', errEvents);
  }

  // 3. Restore cached camera names & user profile from localStorage so initial render uses local state
  try {
    if (cfg._cachedCameraNames && typeof cfg._cachedCameraNames === 'object') {
      state.cameraNames = { ...DEFAULT_SPECIAL_CAMERA_NAMES, ...state.cameraNames, ...cfg._cachedCameraNames };
    }
    if (cfg._cachedUserProfile && typeof cfg._cachedUserProfile === 'object' && !state.userProfile) {
      state.userProfile = cfg._cachedUserProfile;
    }
  } catch (errCache) {
    console.error('[BPP-VMS] Cache restore failed:', errCache);
  }

  // 4. Render layout switch and camera grid IMMEDIATELY (0ms) so the viewport is NEVER blank
  try {
    state.manualLayoutOverride = false;
    cfg.layout = getOptimalAutoLayout();
    buildLayoutSwitch();
    rebuildGrid();
  } catch (errGrid) {
    console.error('[BPP-VMS] rebuildGrid failed:', errGrid);
  }

  // 5. Bind UI event listeners in isolated try/catch so listener issues never break the grid or clock
  try {
    bind();
  } catch (errBind) {
    console.error('[BPP-VMS] bind() uncaught error:', errBind);
  }

  // Stop initialization when the authoritative server session is absent; this
  // avoids briefly issuing protected API calls while the login redirect runs.
  const session = await window.bppSessionPromise;
  if (!session) return;

  window.DYNAMIC_HLS_MAP = window.DYNAMIC_HLS_MAP || {};

  const hlsPromise = fetch('/api/public-config/hls-map', { signal: timeoutSignal(3500) })
    .then(r => (r.ok ? r.json() : {}))
    .then(data => {
      if (data && typeof data === 'object') {
        window.DYNAMIC_HLS_MAP = { ...window.DYNAMIC_HLS_MAP, ...data };
      }
    })
    .catch(e => console.error('Failed to load HLS map', e));

  if (!window.bppCameraGpsPromise) {
    window.bppCameraGpsPromise = fetch('/settings/camera_gps?t=' + Date.now(), { signal: timeoutSignal(6000) })
      .then(r => (r.ok ? r.json() : null))
      .catch(e => {
        console.warn('Failed to preload camera_gps in app.js', e);
        return null;
      });
  }
  // Load 161KB camera_gps in background without blocking initial camera grid render
  window.bppCameraGpsPromise.then(gpsData => {
    if (gpsData && typeof gpsData === 'object') {
      window.cachedCameraGPS = gpsData;
      let addedHls = false;
      for (const [cid, cdata] of Object.entries(gpsData)) {
        if (cdata && cdata.url && !window.DYNAMIC_HLS_MAP[cid]) {
          window.DYNAMIC_HLS_MAP[cid] = cdata.url;
          addedHls = true;
        }
      }
      if (addedHls && typeof syncGridDiffSmoothly === 'function') {
        syncGridDiffSmoothly();
      }
    }
  });

  // Fire profile fetch in parallel with loadServerChannels, then apply in order
  // (system master channels first, personal user profile override second).
  const profileFetchPromise = (!cfg.demo && SAME_ORIGIN)
    ? fetch('/api/nas-bot/user/profile', { signal: timeoutSignal(3500) }).catch(() => null)
    : null;

  await Promise.race([
    (async () => {
      await loadServerChannels();
      await loadUserProfile(profileFetchPromise);
    })(),
    new Promise(r => setTimeout(r, 3500))
  ]);
  await Promise.race([
    hlsPromise,
    new Promise(r => setTimeout(r, 600))
  ]);
  loadNvrCameras().catch(e => console.warn('Failed to load NVR cameras on init:', e));

  // คำนวณและปรับขนาดกริดอัตโนมัติตามจำนวนกล้องที่เปิดจริงทุกครั้งที่โหลด/รีเฟรชหน้าแดชบอร์ด
  state.manualLayoutOverride = false;
  cfg.layout = getOptimalAutoLayout();
  if (window.innerWidth <= 899) {
    setEventsOpen(false);
  } else {
    setEventsOpen(Boolean(cfg.eventsOpen));
  }
  saveCfg();

  buildLayoutSwitch();
  rebuildGrid();
  syncNvrRecordStatus();
  fetchEvents();
  fetchFrigatePreCapture(); // ดึง pre_capture สำหรับ auto-seek วิดีโอ — ไม่ต้อง await
  setInterval(fetchEvents, 15000);
  connectWatchlistSSE();
  connectFrigateRealtimeWS();
  acquireScreenWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) acquireScreenWakeLock();
  });
  setInterval(run24x7HealthScrubber, 5 * 60 * 1000);
  setInterval(syncRealtimeConfigDigest, 30000);
  initLiveAssetVersionWatcher();
  if (typeof loadFederationNodes === 'function') loadFederationNodes();
  loadBranding();
  initUserHeartbeat();
}

// ---- Demand-Driven Camera Provisioning (ADR-0020 / ADR-0021) ----
async function sendUserHeartbeat() {
  if (cfg.demo) return false;
  const activeCams = (cfg.channels || [])
    .filter(c => c && c.src && c.enabled !== false)
    .map(c => ({ src: c.src, enabled: true }));
  try {
    const res = await fetch('/api/nas-bot/user/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channels: activeCams, grid_revision: state.gridRevision }),
    });
    if (res.ok) {
      const hb = await res.json().catch(() => null);
      // ADR-0024: server grid is newer (Superadmin changed it) -> reload it
      if (hb && hb.stale) applyServerGridReload('ผู้ดูแลระบบปรับผังหน้าจอของคุณ');
    }
    return res.ok;
  } catch (e) {
    return false;
  }
}

let isReconcilingDemand = false;
async function triggerDemandReconciliation(waitForReboot = false) {
  if (isReconcilingDemand || cfg.demo) return;
  isReconcilingDemand = true;
  try {
    await sendUserHeartbeat();
    const res = await fetch('/api/public-config/reconcile', {
      method: 'POST',
      signal: timeoutSignal(20000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.changed && waitForReboot) {
        console.log('[DemandReconciliation] Provisioning changed, waiting for Frigate...', data);
        await waitForCamera((cfg.channels.find(c => c.src) || {}).src || '', 25000);
      }
    }
  } catch (e) {
    console.warn('[DemandReconciliation] Error:', e);
  } finally {
    isReconcilingDemand = false;
  }
}

// ---- Online Presence & Real-time Location Tracking (ADR-0013) ----
let lastAnnouncedMissionId = null;

async function sendPresenceHeartbeat() {
  try {
    const res = await fetch('/auth/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true
    });
    if (res.ok) {
      const data = await res.json();
      // Handle mission announcement popup if a mission was started
      if (data.active_mission && data.active_mission.id) {
        if (data.active_mission.id !== lastAnnouncedMissionId) {
          lastAnnouncedMissionId = data.active_mission.id;
          handleMissionAlert(data.active_mission);
        }
      } else {
        lastAnnouncedMissionId = null;
      }
      // Sync local button state strictly with server's sharing_enabled / force_all_enabled
      if (window.bppLocationTracker) {
        const localWasEnabled = (localStorage.getItem('bpp_gps_user_enabled') === '1' && localStorage.getItem('bpp_gps_user_disabled') !== '1');
        if (!data.location_sharing && !data.force_all_enabled) {
          try {
            localStorage.removeItem('bpp_gps_user_enabled');
            localStorage.removeItem('bpp_gps_auto_persist');
          } catch (_) {}
          if (window.bppLocationTracker.isSharing) {
            console.log('[Heartbeat] Server location_sharing is off — stopping local tracker');
            window.bppLocationTracker.stop(false, 'ระบบส่วนกลางปิดแชร์พิกัดของคุณ');
          } else {
            window.bppLocationTracker.updateUI();
          }
        } else if ((data.location_sharing && localWasEnabled) || (data.force_all_enabled && localStorage.getItem('bpp_gps_user_disabled') !== '1')) {
          window.bppLocationTracker._userDisabled = false;
          try {
            localStorage.removeItem('bpp_gps_user_disabled');
            localStorage.setItem('bpp_gps_user_enabled', '1');
          } catch (_) {}
          if (!window.bppLocationTracker.isSharing || window.bppLocationTracker.watchId === null) {
            window.bppLocationTracker.start(null, true, false).catch(() => {});
          } else {
            window.bppLocationTracker.updateUI();
          }
        }
      }
    }
  } catch (err) {
    // Non-blocking background error
  }
}

function handleMissionAlert(mission) {
  // If user is already sharing location, just notify via toast
  if (window.bppLocationTracker && window.bppLocationTracker.isSharing) {
    if (typeof toast === 'function') toast('🚩 เริ่มภารกิจ: ' + mission.name, 4000);
    return;
  }
  
  // Create and show custom modal instead of native confirm
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);backdrop-filter:blur(3px);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:Prompt,sans-serif;';
  
  const box = document.createElement('div');
  box.style.cssText = 'background:#1e293b;border:1px solid #334155;border-radius:12px;width:90%;max-width:400px;padding:24px;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.5);color:#f8fafc;';
  
  const icon = document.createElement('div');
  icon.innerHTML = '<div style="font-size:32px;margin-bottom:12px;animation:myLocPulse 1.5s infinite;">🚩</div>';
  
  const title = document.createElement('h3');
  title.style.cssText = 'margin:0 0 12px;font-size:1.1rem;font-weight:700;';
  title.textContent = 'ประกาศภารกิจใหม่!';
  
  const msg = document.createElement('p');
  msg.style.cssText = 'margin:0 0 24px;font-size:0.95rem;color:#cbd5e1;line-height:1.5;';
  msg.innerHTML = `ผู้บังคับบัญชาขอให้เปิดพิกัดสำหรับภารกิจ:<br><b style="color:#60a5fa;">"${mission.name}"</b><br><br>ต้องการเปิดแชร์พิกัดเพื่อปฏิบัติภารกิจตอนนี้หรือไม่?`;
  
  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'display:flex;gap:12px;justify-content:center;';
  
  const btnCancel = document.createElement('button');
  btnCancel.textContent = 'ยังไม่เปิด';
  btnCancel.style.cssText = 'padding:10px 16px;border-radius:8px;border:1px solid #475569;background:#334155;color:#f8fafc;font-weight:600;cursor:pointer;flex:1;';
  
  const btnOk = document.createElement('button');
  btnOk.textContent = 'เปิดพิกัด (GPS)';
  btnOk.style.cssText = 'padding:10px 16px;border-radius:8px;border:none;background:#3b82f6;color:#ffffff;font-weight:600;cursor:pointer;flex:1;box-shadow:0 0 12px rgba(59,130,246,0.4);';
  
  btnGroup.appendChild(btnCancel);
  btnGroup.appendChild(btnOk);
  
  box.appendChild(icon);
  box.appendChild(title);
  box.appendChild(msg);
  box.appendChild(btnGroup);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  
  btnCancel.onclick = () => {
    document.body.removeChild(overlay);
  };
  
  btnOk.onclick = () => {
    document.body.removeChild(overlay);
    if (window.bppLocationTracker) {
      window.bppLocationTracker.start();
    }
  };
}

window.bppLocationTracker = {
  watchId: null,
  watchIdLow: null,
  isSharing: false,
  lastPostedAt: 0,
  lastFreshPostAt: 0,
  lastFixReceivedAt: 0,
  _lastTickProcessedAt: 0,
  _gpsRequestInFlight: false,
  _gpsRequestStartedAt: 0,
  _lastWatchRestartAt: 0,
  minIntervalMs: 1000, // Real-time 1s interval (Incident 2.51 / 2.149)
  lastCoords: null,
  _watchAttempted: false,
  _userDisabled: false,
  _wakeLock: null,
  _webLockRelease: null,
  _audioKeepalive: null,
  _audioBlobUrl: null,
  _audioCtx: null,
  _oscillator: null,
  _scriptNode: null,
  _mediaStreamDest: null,
  _audioArmed: false,
  _rtcPc1: null,
  _rtcPc2: null,
  _rtcDc1: null,
  _rtcDc2: null,
  _rtcAudioEl: null,
  _rtcPulseTimer: null,
  _worker: null,
  _workerTickTimer: null,
  _lifecycleInitialized: false,
  _stealthOverlay: null,

  // 1. Screen Wake Lock & Web Locks API (Prevents tab freeze/discard by mobile OS)
  async acquireWakeLock() {
    if ('wakeLock' in navigator && !this._wakeLock) {
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => {
          this._wakeLock = null;
        });
      } catch (e) {}
    }
    this.acquireWebLock();
  },

  releaseWakeLock() {
    if (this._wakeLock) {
      try { this._wakeLock.release(); } catch (e) {}
      this._wakeLock = null;
    }
    this.releaseWebLock();
  },

  acquireWebLock() {
    if (this._webLockRelease) return;
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      try {
        navigator.locks.request('bpp_life360_gps_keepalive', { mode: 'exclusive' }, () => {
          return new Promise((resolve) => {
            this._webLockRelease = resolve;
          });
        }).catch(() => {});
      } catch (e) {}
    }
  },

  releaseWebLock() {
    if (this._webLockRelease) {
      try { this._webLockRelease(); } catch (e) {}
      this._webLockRelease = null;
    }
  },

  // 2. Zero-Widget Stealth Background Keepalive (WebAudio Hardware DMA + WebRTC DataChannel + SSE Network Stream + Motion Sensors)
  // NEVER creates an HTML5 <audio> element or MediaSession metadata, so iOS/Android Lock Screen NEVER shows a music player widget!
  startAudioKeepalive() {
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
      } catch (e) {}
    }
    if ('audioSession' in navigator && navigator.audioSession) {
      try {
        navigator.audioSession.type = 'transient';
      } catch (e) {
        try { navigator.audioSession.type = 'auto'; } catch (_) {}
      }
    }

    this.startWebAudioKeepalive();
    this.startWebRtcKeepalive();
    this.startStreamKeepalive();
    this.startSensorKeepalive();
  },

  stopAudioKeepalive() {
    if (this._audioKeepalive) {
      try {
        const a = this._audioKeepalive;
        this._audioKeepalive = null;
        a.pause();
        a.src = '';
      } catch (e) {}
    }
    this.stopStreamKeepalive();
    this.stopSensorKeepalive();
    this.stopWebRtcKeepalive();
    this.stopWebAudioKeepalive();
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      } catch (e) {}
    }
  },

  startStreamKeepalive() {
    if (!this.isSharing || this._userDisabled) return;
    if (this._sseKeepalive || typeof EventSource === 'undefined') return;
    try {
      const es = new EventSource('/auth/location/stream-keepalive');
      es.onmessage = (ev) => {
        if (!this.isSharing || this._userDisabled) {
          this.stopStreamKeepalive();
          return;
        }
        try {
          const d = JSON.parse(ev.data || '{}');
          if (d && d.type === 'STOP') {
            this.stop(false, 'ระบบส่วนกลางได้สั่งปิดการแชร์พิกัดแล้ว');
            return;
          }
        } catch (_) {}
        this.onWorkerTick(true);
      };
      es.onerror = () => {
        this.stopStreamKeepalive();
        if (this.isSharing && !this._userDisabled) {
          this._sseReconnectTimer = setTimeout(() => {
            if (this.isSharing && !this._userDisabled) this.startStreamKeepalive();
          }, 2500);
        }
      };
      this._sseKeepalive = es;
    } catch (e) {}
  },

  stopStreamKeepalive() {
    if (this._sseReconnectTimer) {
      clearTimeout(this._sseReconnectTimer);
      this._sseReconnectTimer = null;
    }
    if (this._sseKeepalive) {
      try { this._sseKeepalive.close(); } catch (_) {}
      this._sseKeepalive = null;
    }
  },

  startSensorKeepalive() {
    if (this._sensorListenerBound) return;
    this._sensorListenerBound = true;
    this._onSensorMotion = () => {
      if (this.isSharing) {
        this.onWorkerTick();
      }
    };
    try {
      window.addEventListener('devicemotion', this._onSensorMotion, { passive: true });
      window.addEventListener('deviceorientation', this._onSensorMotion, { passive: true });
    } catch (_) {}
  },

  stopSensorKeepalive() {
    if (!this._sensorListenerBound) return;
    this._sensorListenerBound = false;
    try {
      if (this._onSensorMotion) {
        window.removeEventListener('devicemotion', this._onSensorMotion);
        window.removeEventListener('deviceorientation', this._onSensorMotion);
      }
    } catch (_) {}
  },

  startWebAudioKeepalive() {
    try {
      if ('audioSession' in navigator && navigator.audioSession) {
        try {
          navigator.audioSession.type = 'transient';
        } catch (_) {
          try { navigator.audioSession.type = 'auto'; } catch (__) {}
        }
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this._audioCtx) {
        this._audioCtx = new AudioCtx();
        this._audioCtx.addEventListener('statechange', () => {
          if (this.isSharing && this._audioCtx && this._audioCtx.state === 'suspended') {
            this._audioCtx.resume().catch(() => {});
          }
        });
      }
      if (this._audioCtx.state !== 'running') {
        this._audioCtx.resume().catch(() => {});
      }
      if (!this._oscillator) {
        const osc = this._audioCtx.createOscillator();
        const gain = this._audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(18, this._audioCtx.currentTime);
        gain.gain.setValueAtTime(0.00001, this._audioCtx.currentTime);
        osc.connect(gain);

        // Attach ScriptProcessorNode on the real-time hardware audio thread (~10x/sec callback without Lock Screen UI)
        if (typeof this._audioCtx.createScriptProcessor === 'function' && !this._scriptNode) {
          const sp = this._audioCtx.createScriptProcessor(4096, 1, 1);
          sp.onaudioprocess = (ev) => {
            try {
              const out = ev.outputBuffer.getChannelData(0);
              for (let i = 0; i < out.length; i++) {
                // Sub-LSB -114dB non-zero dither prevents iOS CoreAudio & Android AudioTrack silence detector from suspending DMA
                out[i] = (i & 1) ? 0.000002 : -0.000002;
              }
            } catch (_) {}
            if (this.isSharing) {
              this.onWorkerTick();
            }
          };
          gain.connect(sp);
          sp.connect(this._audioCtx.destination);
          if (typeof this._audioCtx.createMediaStreamDestination === 'function') {
            this._mediaStreamDest = this._audioCtx.createMediaStreamDestination();
            sp.connect(this._mediaStreamDest);
          }
          this._scriptNode = sp;
        } else {
          gain.connect(this._audioCtx.destination);
          if (typeof this._audioCtx.createMediaStreamDestination === 'function') {
            this._mediaStreamDest = this._audioCtx.createMediaStreamDestination();
            gain.connect(this._mediaStreamDest);
          }
        }

        osc.start();
        this._oscillator = osc;
      }
    } catch (e) {}
  },

  stopWebAudioKeepalive() {
    if (this._scriptNode) {
      try { this._scriptNode.disconnect(); } catch (e) {}
      this._scriptNode.onaudioprocess = null;
      this._scriptNode = null;
    }
    if (this._oscillator) {
      try { this._oscillator.stop(); } catch (e) {}
      this._oscillator = null;
    }
    this._mediaStreamDest = null;
    if (this._audioCtx) {
      try { this._audioCtx.close(); } catch (e) {}
      this._audioCtx = null;
    }
  },

  // 3B. In-Memory WebRTC Active-Call Loopback (Elevates tab priority to Active VoIP Call on iOS Safari & Android Chrome)
  async startWebRtcKeepalive() {
    if (this._rtcPc1 || typeof RTCPeerConnection === 'undefined') return;
    try {
      const pc1 = new RTCPeerConnection({ iceServers: [] });
      const pc2 = new RTCPeerConnection({ iceServers: [] });
      this._rtcPc1 = pc1;
      this._rtcPc2 = pc2;

      pc1.onicecandidate = (e) => {
        if (e.candidate && this._rtcPc2) {
          this._rtcPc2.addIceCandidate(e.candidate).catch(() => {});
        }
      };
      pc2.onicecandidate = (e) => {
        if (e.candidate && this._rtcPc1) {
          this._rtcPc1.addIceCandidate(e.candidate).catch(() => {});
        }
      };

      // Connect remote WebRTC stream to an in-memory <audio playsinline> element (RealtimeMediaSource)
      // WebKit/Blink grants full VoIP/RTC background location & process priority without showing a Lock Screen music widget!
      pc2.ontrack = (ev) => {
        try {
          if (ev.streams && ev.streams[0]) {
            if (!this._rtcAudioEl) {
              const a = document.createElement('audio');
              a.playsInline = true;
              a.setAttribute('playsinline', '');
              a.setAttribute('webkit-playsinline', '');
              a.autoplay = true;
              a.volume = 0.01;
              this._rtcAudioEl = a;
            }
            this._rtcAudioEl.srcObject = ev.streams[0];
            const p = this._rtcAudioEl.play();
            if (p && typeof p.then === 'function') {
              p.then(() => {
                if ('mediaSession' in navigator) {
                  try {
                    navigator.mediaSession.metadata = null;
                    navigator.mediaSession.playbackState = 'none';
                  } catch (_) {}
                }
              }).catch(() => {});
            }
          }
        } catch (_) {}
      };

      // Attach WebAudio MediaStreamTrack so OS sees an active WebRTC voice call
      if (this._mediaStreamDest && this._mediaStreamDest.stream) {
        this._mediaStreamDest.stream.getTracks().forEach((track) => {
          pc1.addTrack(track, this._mediaStreamDest.stream);
        });
      }

      // DataChannel 1Hz C++ network thread wakeup pulse
      const dc1 = pc1.createDataChannel('bpp-life360-gps');
      this._rtcDc1 = dc1;
      pc2.ondatachannel = (ev) => {
        const dc2 = ev.channel;
        this._rtcDc2 = dc2;
        dc2.onmessage = () => {
          if (this.isSharing) {
            this.onWorkerTick();
          }
        };
      };

      const offer = await pc1.createOffer();
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);
      const answer = await pc2.createAnswer();
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);

      if (this._rtcPulseTimer) clearInterval(this._rtcPulseTimer);
      this._rtcPulseTimer = setInterval(() => {
        if (!this.isSharing) return;
        if (this._rtcDc1 && this._rtcDc1.readyState === 'open') {
          try { this._rtcDc1.send('1'); } catch (_) {}
        }
      }, 1000);
    } catch (e) {
      this.stopWebRtcKeepalive();
    }
  },

  stopWebRtcKeepalive() {
    if (this._rtcPulseTimer) {
      clearInterval(this._rtcPulseTimer);
      this._rtcPulseTimer = null;
    }
    if (this._rtcAudioEl) {
      try {
        this._rtcAudioEl.pause();
        this._rtcAudioEl.srcObject = null;
      } catch (_) {}
      this._rtcAudioEl = null;
    }
    if (this._rtcDc1) {
      try { this._rtcDc1.close(); } catch (_) {}
      this._rtcDc1 = null;
    }
    if (this._rtcDc2) {
      try { this._rtcDc2.close(); } catch (_) {}
      this._rtcDc2 = null;
    }
    if (this._rtcPc1) {
      try { this._rtcPc1.close(); } catch (_) {}
      this._rtcPc1 = null;
    }
    if (this._rtcPc2) {
      try { this._rtcPc2.close(); } catch (_) {}
      this._rtcPc2 = null;
    }
  },

  // 4. Dedicated Web Worker Timer & Secondary Fallback Ticker
  startWorkerTimer() {
    if (!this._worker) {
      try {
        const workerScript = `
          var timer = null;
          self.onmessage = function(e) {
            if (e.data === 'START') {
              if (timer) clearInterval(timer);
              timer = setInterval(function() {
                self.postMessage('TICK');
              }, 900);
            } else if (e.data === 'STOP') {
              if (timer) clearInterval(timer);
              timer = null;
            }
          };
        `;
        const blob = new Blob([workerScript], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);
        worker.onmessage = (e) => {
          if (e.data === 'TICK' && this.isSharing) {
            this.onWorkerTick();
          }
        };
        worker.postMessage('START');
        this._worker = worker;
      } catch (e) {}
    }

    if (this._workerTickTimer) clearInterval(this._workerTickTimer);
    this._workerTickTimer = setInterval(() => {
      if (this.isSharing) {
        this.onWorkerTick();
      }
    }, 950);
  },

  stopWorkerTimer() {
    if (this._worker) {
      try {
        this._worker.postMessage('STOP');
        this._worker.terminate();
      } catch (e) {}
      this._worker = null;
    }
    if (this._workerTickTimer) {
      clearInterval(this._workerTickTimer);
      this._workerTickTimer = null;
    }
  },

  syncWithServiceWorker() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      try {
        navigator.serviceWorker.controller.postMessage({
          type: 'SYNC_STATE',
          isSharing: this.isSharing,
          coords: this.lastCoords,
          lastFixAt: this.lastFixReceivedAt,
          lastPostedAt: this.lastFreshPostAt
        });
      } catch (e) {}
    }
  },

  _restartGeoWatchers(silent = true, forceClear = false) {
    if (!navigator.geolocation) return;
    // CRITICAL WebKit/iOS Rule: NEVER call clearWatch() while document.hidden is true!
    // Calling clearWatch() in background destroys the foreground-authorized watcher, and WebKit blocks new watchPosition() calls initiated while hidden.
    if (document.hidden && !forceClear && (this.watchId !== null || this.watchIdLow !== null)) {
      return;
    }
    this._lastWatchRestartAt = Date.now();
    if (forceClear || !document.hidden) {
      if (this.watchId !== null) {
        try { navigator.geolocation.clearWatch(this.watchId); } catch (_) {}
        this.watchId = null;
      }
      if (this.watchIdLow !== null) {
        try { navigator.geolocation.clearWatch(this.watchIdLow); } catch (_) {}
        this.watchIdLow = null;
      }
    }
    if (this.watchId === null) {
      try {
        this.watchId = navigator.geolocation.watchPosition(
          (pos) => this.onPosition(pos),
          (err) => {
            if (err && err.code === 1) {
              if (this.watchId !== null) {
                try { navigator.geolocation.clearWatch(this.watchId); } catch (_) {}
                this.watchId = null;
              }
              if (!silent && typeof toast === 'function') {
                toast('⚠️ กรุณาอนุญาตการเข้าถึงพิกัด (GPS) ในเบราว์เซอร์');
              }
            }
          },
          {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 20000
          }
        );
      } catch (e) {}
    }

    if (this.watchIdLow === null) {
      try {
        this.watchIdLow = navigator.geolocation.watchPosition(
          (pos) => {
            // When backgrounded (document.hidden), accept every Fused/Wi-Fi/Cell fix immediately
            if (document.hidden || (Date.now() - (this.lastFixReceivedAt || 0) >= 3000)) {
              this.onPosition(pos);
            }
          },
          () => {},
          {
            enableHighAccuracy: false,
            maximumAge: 0,
            timeout: 15000
          }
        );
      } catch (e) {}
    }
  },

  // Handles periodic tick from ScriptProcessorNode, SSE stream, WebRTC DataChannel, WebWorker, Motion Sensors, and ServiceWorker
  onWorkerTick(forcePulse = false) {
    if (!this.isSharing) return;
    const now = Date.now();
    if (!forcePulse && (now - this._lastTickProcessedAt < 500)) {
      return;
    }
    this._lastTickProcessedAt = now;

    if (this._audioCtx && this._audioCtx.state === 'suspended') {
      this._audioCtx.resume().catch(() => {});
    }
    if (this._rtcAudioEl && this._rtcAudioEl.paused) {
      this._rtcAudioEl.play().catch(() => {});
    }
    if (!this._sseKeepalive) {
      this.startStreamKeepalive();
    }

    // Clear any in-flight request that was dropped by OS during app switch (prevents deadlock without cutting off active fixes)
    if (this._gpsRequestInFlight && (now - (this._gpsRequestStartedAt || 0) > 4000)) {
      this._gpsRequestInFlight = false;
    }

    const elapsedSincePost = now - this.lastPostedAt;
    const elapsedSinceFreshPost = now - (this.lastFreshPostAt || 0);
    const elapsedSinceFix = now - (this.lastFixReceivedAt || 0);

    // Only re-bind watchers if both were cleared (NEVER tear down active watchers while document.hidden is true!)
    if (this.watchId === null && this.watchIdLow === null && (now - (this._lastWatchRestartAt || 0) >= 3500)) {
      this._restartGeoWatchers(true, false);
    }

    // Dual-Accuracy Active GPS Pulse:
    // Poll OS Location Service; fuse GNSS + FusedLocationProvider (WiFi/Cell) so indoor & folded/backgrounded screens still return real coordinates
    if ((forcePulse || elapsedSinceFix >= 1800) && !this._gpsRequestInFlight && navigator.geolocation && navigator.geolocation.getCurrentPosition) {
      this._gpsRequestInFlight = true;
      this._gpsRequestStartedAt = now;
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            this._gpsRequestInFlight = false;
            this.onPosition(pos);
          },
          () => {
            navigator.geolocation.getCurrentPosition(
              (posLow) => {
                this._gpsRequestInFlight = false;
                this.onPosition(posLow);
              },
              () => {
                this._gpsRequestInFlight = false;
              },
              { enableHighAccuracy: false, timeout: 3500, maximumAge: 0 }
            );
          },
          {
            enableHighAccuracy: true,
            timeout: 3000,
            maximumAge: 0
          }
        );
      } catch (e) {
        this._gpsRequestInFlight = false;
      }
    }

    // Transmit whenever a new GPS fix was received (tracked via lastFreshPostAt so cached keepalives never block fresh fixes!)
    if (this.lastCoords && this.lastFixReceivedAt > 0) {
      if (this.lastFixReceivedAt > (this.lastFreshPostAt || 0) && elapsedSinceFreshPost >= this.minIntervalMs) {
        this.transmitLocation(this.lastCoords, false);
      } else if (elapsedSincePost >= 4000) {
        this.transmitLocation(this.lastCoords, true);
      }
    }
  },

  // 5. Start tracking (Persists continuously across background/folded screen once enabled by officer)
  async start(customToastMsg = null, silent = false, notifyServer = true) {
    if (!navigator.geolocation) {
      if (!silent && typeof toast === 'function') toast('เบราว์เซอร์นี้ไม่รองรับการระบุพิกัด GPS');
      return false;
    }

    this._userDisabled = false;
    try {
      localStorage.removeItem('bpp_gps_user_disabled');
      localStorage.setItem('bpp_gps_user_enabled', '1');
      localStorage.setItem('bpp_gps_auto_persist', '1');
    } catch (_) {}

    this.initLifecycleListeners();
    this._armAudioOnInteraction();

    this.isSharing = true;
    this.updateUI();

    if (notifyServer) {
      try {
        await fetch('/auth/location/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
          keepalive: true
        });
      } catch (e) {}
    }

    // Activate all stealth background persistence engines (Zero Lock-Screen Media Widget)
    this.acquireWakeLock();
    this.acquireWebLock();
    this.startAudioKeepalive();
    this.startWorkerTimer();
    this.syncWithServiceWorker();

    if (this.lastCoords && this.lastFixReceivedAt && (Date.now() - this.lastFixReceivedAt < 10000)) {
      this.transmitLocation(this.lastCoords, false);
    }

    // Immediate fresh fix from OS Location Service (with FusedLocationProvider fallback)
    if (navigator.geolocation.getCurrentPosition) {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => this.onPosition(pos),
          () => {
            navigator.geolocation.getCurrentPosition(
              (posLow) => this.onPosition(posLow),
              () => {},
              { enableHighAccuracy: false, timeout: 5000, maximumAge: 15000 }
            );
          },
          { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 }
        );
      } catch (e) {}
    }

    if (this.watchId === null) {
      this._restartGeoWatchers(silent, true);
    }

    this.registerBackgroundSync();
    if (!silent && typeof toast === 'function') {
      toast(customToastMsg || 'เปิดการแชร์พิกัดเรียลไทม์แล้ว (พับแอปไปทำอย่างอื่นได้ทันที)');
    }
    return true;
  },

  // 6. Stop tracking
  async stop(notifyServer = true, customToastMsg = null) {
    this.isSharing = false;
    this._watchAttempted = false;
    this._userDisabled = true;
    this._gpsRequestInFlight = false;
    if (this.watchId !== null) {
      try { navigator.geolocation.clearWatch(this.watchId); } catch (_) {}
      this.watchId = null;
    }
    if (this.watchIdLow !== null) {
      try { navigator.geolocation.clearWatch(this.watchIdLow); } catch (_) {}
      this.watchIdLow = null;
    }
    try {
      localStorage.setItem('bpp_gps_user_disabled', '1');
      localStorage.removeItem('bpp_gps_user_enabled');
      localStorage.removeItem('bpp_gps_auto_persist');
    } catch (_) {}

    this.exitStealthMode();
    this.releaseWakeLock();
    this.stopAudioKeepalive();
    this.stopWorkerTimer();
    this.syncWithServiceWorker();
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      try {
        navigator.serviceWorker.controller.postMessage({ type: 'STOP_SHARING' });
      } catch (_) {}
    }
    if ('caches' in window) {
      try {
        window.caches.delete('bpp-vms-loc-state-v5').catch(() => {});
        window.caches.delete('bpp-vms-loc-state-v6').catch(() => {});
        window.caches.delete('bpp-vms-loc-state-v7').catch(() => {});
        window.caches.delete('bpp-vms-loc-state-v8').catch(() => {});
      } catch (_) {}
    }

    const curUser = (window.bppSession && window.bppSession.username) || localStorage.getItem('vms_user') || localStorage.getItem('auth_user') || localStorage.getItem('username') || '';
    if (curUser && window.officerMarkersMap) {
      const matchKey = Array.from(window.officerMarkersMap.keys()).find(k => k.toLowerCase() === curUser.toLowerCase());
      if (matchKey) {
        const marker = window.officerMarkersMap.get(matchKey);
        if (marker) {
          if (typeof marker.remove === 'function') {
            try { marker.remove(); } catch (e) {}
          }
          if (window.officerPointLayer) {
            try { window.officerPointLayer.removeLayer(marker); } catch (e) {}
          }
        }
        window.officerMarkersMap.delete(matchKey);
      }
    }

    this.updateUI();

    if (notifyServer) {
      try {
        await fetch('/auth/location/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
          keepalive: true
        });
      } catch (e) {}
    }
    if (typeof toast === 'function') toast(customToastMsg || 'ปิดการแชร์พิกัดแล้ว');
  },

  async toggle() {
    if (this.isSharing) {
      await this.stop();
    } else {
      await this.start();
    }
  },

  // 7. Tactical Stealth & Pocket Mode (OLED Black Screen, Touch Lock, Active GPS WakeLock)
  enterStealthMode() {
    if (this._stealthOverlay) return;
    this.acquireWakeLock();

    const overlay = document.createElement('div');
    overlay.id = 'bppStealthOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#000000;z-index:9999999;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:30px 20px 40px;box-sizing:border-box;touch-action:none;user-select:none;-webkit-user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#334155;';

    overlay.innerHTML = `
      <div style="text-align: center; margin-top: 20px;">
        <div style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); padding: 5px 14px; border-radius: 20px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
          TACTICAL BEACON ACTIVE
        </div>
        <div style="font-size: 11.5px; color: #475569; margin-top: 6px;">ระบบติดตามพิกัด ตชด.215 (ส่งสัญญาณสด 1s)</div>
      </div>

      <div id="bppStealthStats" style="text-align: center; font-family: monospace; font-size: 12px; color: #64748b; line-height: 1.8;">
        <div>กำลังค้นหาสัญญาณดาวเทียม...</div>
      </div>

      <div style="text-align: center; margin-bottom: 20px;">
        <div id="bppStealthUnlockProgress" style="width: 54px; height: 54px; border-radius: 50%; border: 2px dashed #334155; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center; font-size: 20px; color: #475569; transition: all 0.2s;">
          🔒
        </div>
        <div style="font-size: 12.5px; color: #64748b; font-weight: 500;">
          แตะหน้าจอค้างไว้ 1.5 วินาที เพื่อปลดล็อค
        </div>
        <div style="font-size: 10.5px; color: #334155; margin-top: 4px;">
          (จอภาพปิดเม็ดสีดำสนิท ประหยัดพลังงาน 100% ปลอดภัยเมื่อใส่ในกระเป๋าเสื้อ/กางเกง)
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._stealthOverlay = overlay;
    this._updateStealthHUD();

    let holdTimer = null;
    const circle = overlay.querySelector('#bppStealthUnlockProgress');

    const startHold = () => {
      if (circle) {
        circle.style.borderColor = '#10b981';
        circle.style.color = '#10b981';
        circle.style.transform = 'scale(1.15)';
      }
      holdTimer = setTimeout(() => {
        this.exitStealthMode();
      }, 1400);
    };

    const cancelHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (circle) {
        circle.style.borderColor = '#334155';
        circle.style.color = '#475569';
        circle.style.transform = 'scale(1)';
      }
    };

    overlay.addEventListener('pointerdown', startHold);
    overlay.addEventListener('pointerup', cancelHold);
    overlay.addEventListener('pointercancel', cancelHold);

    let lastTap = 0;
    overlay.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastTap < 400) {
        this.exitStealthMode();
      }
      lastTap = now;
    });

    if (typeof toast === 'function') toast('เข้าสู่โหมดพรางหน้าจอ (ใส่กระเป๋าได้ ไม่กินแบตเตอรี่ พิกัดส่งสด 100%)', 4000);
  },

  exitStealthMode() {
    if (this._stealthOverlay) {
      try { this._stealthOverlay.remove(); } catch (e) {}
      this._stealthOverlay = null;
      if (typeof toast === 'function') toast('ปลดล็อคหน้าจอกลับสู่โหมดปกติแล้ว', 3000);
    }
  },

  _updateStealthHUD() {
    if (!this._stealthOverlay) return;
    const statsEl = this._stealthOverlay.querySelector('#bppStealthStats');
    if (!statsEl) return;
    if (this.lastCoords) {
      const lat = this.lastCoords.latitude.toFixed(5);
      const lng = this.lastCoords.longitude.toFixed(5);
      const acc = this.lastCoords.accuracy ? `±${Math.round(this.lastCoords.accuracy)} ม.` : 'ไม่ระบุ';
      const spd = (this.lastCoords.speed && this.lastCoords.speed > 0.5) ? `${(this.lastCoords.speed * 3.6).toFixed(1)} กม./ชม.` : 'หยุดนิ่ง';
      statsEl.innerHTML = `
        <div style="color: #94a3b8; font-weight: 700; font-size: 13.5px;">${lat}, ${lng}</div>
        <div style="color: #64748b; font-size: 11.5px; margin-top: 2px;">ความแม่นยำ: <span style="color:#10b981;">${acc}</span> · ความเร็ว: <span style="color:#38bdf8;">${spd}</span></div>
        <div style="color: #475569; font-size: 10.5px; margin-top: 4px;">ส่งสัญญาณล่าสุด: ${new Date().toLocaleTimeString('th-TH')}</div>
      `;
    }
  },

  // 8. Handle position update from watchPosition or getCurrentPosition
  async onPosition(pos) {
    if (!this.isSharing || this._userDisabled) return;
    if (!pos || !pos.coords) return;
    const coords = pos.coords;
    const now = Date.now();
    const incomingAcc = Number(coords.accuracy || 999);
    if (
      !document.hidden &&
      this.lastCoords &&
      this.lastFixReceivedAt &&
      (now - this.lastFixReceivedAt < 5000) &&
      Number(this.lastCoords.accuracy || 999) <= 12 &&
      incomingAcc > 65
    ) {
      // Only ignore extreme cell-tower jumps when foregrounded with an ultra-fresh satellite lock
      return;
    }
    this.lastFixReceivedAt = now;
    this.lastCoords = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      heading: coords.heading,
      speed: coords.speed
    };

    try {
      localStorage.setItem('bpp_gps_permitted', '1');
      localStorage.setItem('bpp_gps_permitted_at', String(now));
      localStorage.setItem('bpp_last_coords', JSON.stringify(this.lastCoords));
    } catch (_) {}

    if (this._stealthOverlay) {
      this._updateStealthHUD();
    }

    this.syncWithServiceWorker();

    if (now - (this.lastFreshPostAt || 0) < this.minIntervalMs) {
      return;
    }
    await this.transmitLocation(this.lastCoords, false);
  },

  async transmitLocation(coords, isCachedRelay = false) {
    if (!coords || !this.isSharing) return;
    const now = Date.now();
    this.lastPostedAt = now;
    if (!isCachedRelay) {
      this.lastFreshPostAt = now;
    }
    this.syncWithServiceWorker();

    const fixAgeMs = isCachedRelay
      ? Math.max(9000, now - (this.lastFixReceivedAt || 0))
      : Math.max(0, Math.min(4000, now - (this.lastFixReceivedAt || now)));

    const payload = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      heading: coords.heading,
      speed: coords.speed,
      is_background: Boolean(document.hidden),
      timestamp: now,
      fix_age_ms: fixAgeMs
    };

    try {
      const res = await fetch('/auth/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.sharing_disabled) {
          if (this.isSharing || this.watchId !== null) {
            await this.stop(false, 'ระบบส่วนกลางได้สั่งปิดการแชร์พิกัดแล้ว');
          }
        }
      }
    } catch (err) {}
  },

  refreshPosition() {
    if (!this.isSharing || !navigator.geolocation) return;
    this.onWorkerTick(true);
  },

  // 9. Page Visibility and Lifecycle Event Listeners
  initLifecycleListeners() {
    if (this._lifecycleInitialized) return;
    this._lifecycleInitialized = true;

    document.addEventListener('visibilitychange', () => {
      if (!this.isSharing) return;
      if (document.visibilityState === 'visible') {
        this.acquireWakeLock();
        this.startAudioKeepalive();
        this._restartGeoWatchers(true, true);
        this.refreshPosition();
        if (typeof sendPresenceHeartbeat === 'function') {
          sendPresenceHeartbeat().catch(() => {});
        }
        if (typeof window.loadOfficerLocations === 'function') {
          window.loadOfficerLocations().catch(() => {});
        }
      } else {
        // Entering background / switching app / locking screen:
        // Arm all background engines while keeping existing watchId & watchIdLow alive (never call clearWatch while hidden!)
        this.acquireWebLock();
        this.startAudioKeepalive();
        this.syncWithServiceWorker();
        this.refreshPosition();
        if (this.lastCoords && this.lastFixReceivedAt > (this.lastFreshPostAt || 0)) {
          this.transmitLocation(this.lastCoords, false);
        }
        setTimeout(() => {
          if (this.isSharing) {
            this.onWorkerTick(true);
          }
        }, 300);
        setTimeout(() => {
          if (this.isSharing) {
            this.onWorkerTick(true);
          }
        }, 1500);
      }
    });

    window.addEventListener('focus', () => {
      if (this.isSharing) {
        this.startAudioKeepalive();
        this.refreshPosition();
      }
    });

    window.addEventListener('blur', () => {
      if (this.isSharing) {
        this.startAudioKeepalive();
        this.syncWithServiceWorker();
        this.refreshPosition();
        if (this.lastCoords && this.lastFixReceivedAt > (this.lastFreshPostAt || 0)) {
          this.transmitLocation(this.lastCoords, false);
        }
      }
    });

    window.addEventListener('pagehide', () => {
      if (this.isSharing && this.lastCoords && this.lastFixReceivedAt > (this.lastFreshPostAt || 0)) {
        this.syncWithServiceWorker();
        this.transmitLocation(this.lastCoords, false);
      }
    });

    document.addEventListener('freeze', () => {
      if (this.isSharing && this.lastCoords && this.lastFixReceivedAt > (this.lastFreshPostAt || 0)) {
        this.syncWithServiceWorker();
        this.transmitLocation(this.lastCoords, false);
      }
    });

    document.addEventListener('resume', () => {
      if (this.isSharing) {
        this.startAudioKeepalive();
        this.refreshPosition();
      }
    });

    window.addEventListener('pageshow', () => {
      if (this.isSharing) {
        this.startAudioKeepalive();
        this.refreshPosition();
      }
    });

    window.addEventListener('online', () => {
      if (this.isSharing) {
        this.refreshPosition();
      }
    });
  },

  _armAudioOnInteraction() {
    if (this._audioArmed) return;
    this._audioArmed = true;
    const arm = () => {
      // Only unlock/resume background WebAudio, SSE & WebRTC engines when user has ACTUALLY enabled location sharing!
      if (!this.isSharing || this._userDisabled) return;
      this.startAudioKeepalive();
      if (this._audioCtx && this._audioCtx.state !== 'running') {
        this._audioCtx.resume().catch(() => {});
      }
      if (!this._rtcPc1 || this._rtcPc1.connectionState === 'closed' || this._rtcPc1.connectionState === 'failed') {
        this.startWebRtcKeepalive();
      }
      if (Date.now() - (this.lastFixReceivedAt || 0) >= 2000) {
        this.refreshPosition();
      }
    };
    window.addEventListener('touchend', arm, { passive: true });
    window.addEventListener('pointerup', arm, { passive: true });
    window.addEventListener('click', arm, { passive: true });
    window.addEventListener('keydown', arm, { passive: true });
  },

  updateUI() {
    const isUserDisabled = Boolean(this._userDisabled);
    const isAct = isUserDisabled ? false : Boolean(this.isSharing);
    const btn = document.getElementById('btnToggleOfficerLocation');
    const txt = document.getElementById('officerLocText');
    if (btn) {
      btn.classList.toggle('active', isAct);
      btn.title = isAct
        ? 'กำลังแชร์พิกัดแบบเรียลไทม์ต่อเนื่อง - คลิกเพื่อปิด'
        : 'เปิด/ปิด การแชร์พิกัดของฉันสำหรับการปฏิบัติภารกิจ';
    }
    if (txt) {
      txt.textContent = isAct ? 'กำลังแชร์พิกัด' : 'เปิดพิกัด';
    }
  },

  async registerBackgroundSync() {
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if ('periodicSync' in reg) {
          const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
          if (status.state === 'granted') {
            await reg.periodicSync.register('bpp-location-sync', {
              minInterval: 15 * 1000
            });
          }
        }
        if ('sync' in reg) {
          await reg.sync.register('bpp-location-sync').catch(() => {});
        }
      } catch (e) {}
    }
  }
};

function initUserHeartbeat() {
  sendUserHeartbeat();
  setInterval(sendUserHeartbeat, 60000);
  setTimeout(() => { triggerDemandReconciliation(false); }, 2000);

  // Register stealth background service worker (v8) for background sync & 1Hz wakeup
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw-location.js?v=8').catch(err => {
      console.debug('ServiceWorker registration skipped:', err);
    });
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'BG_LOCATION_PING') {
        if (window.bppLocationTracker && window.bppLocationTracker.isSharing) {
          window.bppLocationTracker.onWorkerTick(true);
        }
      }
    });
  }

  // Start in OFF state unless user explicitly enabled sharing on this device;
  // sendPresenceHeartbeat (below) will verify server's sharing_enabled and resume if active.
  if (window.bppLocationTracker) {
    window.bppLocationTracker._armAudioOnInteraction();
    const localWasEnabled = (localStorage.getItem('bpp_gps_user_enabled') === '1' && localStorage.getItem('bpp_gps_user_disabled') !== '1');
    window.bppLocationTracker._userDisabled = !localWasEnabled;
    window.bppLocationTracker.isSharing = false;
    window.bppLocationTracker.updateUI();
  }

  // Online presence heartbeat (every 15s for continuous presence lock)
  setTimeout(sendPresenceHeartbeat, 200);
  setInterval(sendPresenceHeartbeat, 15000);
}

const startDashboardApp = () => {
  try {
    const p = init();
    if (p && typeof p.catch === 'function') {
      p.catch(e => console.error('[BPP-VMS] init() top-level rejected:', e));
    }
  } catch (err) {
    console.error('[BPP-VMS] startDashboardApp sync throw:', err);
  }
};

if ($('grid') && $('scanNvrOverlay')) {
  startDashboardApp();
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startDashboardApp);
} else {
  startDashboardApp();
}

// ---- NVR Camera Settings UI (config-api) ----
async function loadNvrCameras(retries = 2, delayMs = 800) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let [res, namesRes] = await Promise.all([
        fetch('/api/config/cameras?t=' + Date.now()),
        fetch('/settings/camera_names?t=' + Date.now()).catch(() => null)
      ]);
      if (namesRes && namesRes.ok) {
        try {
          const freshNames = await namesRes.json();
          state.cameraNames = { ...DEFAULT_SPECIAL_CAMERA_NAMES, ...(state.cameraNames || {}), ...(freshNames || {}) };
        } catch (e) {}
      }
      if (res.status === 401 || res.status === 403) {
        res = await fetch('/api/public-config/cameras-catalog?t=' + Date.now());
      }
      if (res.status === 503 && attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      if (!res.ok) throw new Error(`API config-api error (HTTP ${res.status})`);
      const data = await res.json();
      const internalAliases = new Set(['bodyarm', 'drone_flip215', 'falcon1', 'gopronook', 'drone_live', 'live', '101', '201', '301', 'rtmp_live_1', 'rtmp_live_2']);
      state.nvrCameras = Array.isArray(data.cameras)
        ? data.cameras.filter(c => c && c.name && !internalAliases.has(c.name) && c.group)
        : [];
      state.nvrCameras.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
      let anyStreamHealed = false;
      if (Array.isArray(cfg.channels)) {
        cfg.channels.forEach(c => {
          if (!c || !c.src) return;
          const prevSub = c.sub || '';
          const prevHd = c.hd || '';
          normalizeChannelStreams(c);
          if ((c.sub || '') !== prevSub || (c.hd || '') !== prevHd) {
            anyStreamHealed = true;
          }
        });
      }
      if (anyStreamHealed) {
        if (state.userProfile && Array.isArray(state.userProfile.channels) && state.userProfile.channels.length > 0) {
          state.userProfile.channels = cfg.channels.map(c => ({ ...c }));
        }
        saveCfg();
        if (Array.isArray(state.tiles) && state.tiles.length > 0 && typeof syncGridDiffSmoothly === 'function') {
          syncGridDiffSmoothly();
        }
      }
      renderNvrCameras();
      populateCamSelect();
      // ADR-0024: own AI-demand flags are not reconciled from camera status.
      return;
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      console.error('Failed to load NVR cameras:', err);
      if ($('camerasList')) {
        $('camerasList').innerHTML = `<div class="obj-note">ไม่สามารถโหลดข้อมูลกล้องจากระบบได้ (config-api)</div>`;
      }
    }
  }
}

let camPickerInitialized = false;

function initCamPicker() {
  if (camPickerInitialized) return;
  const btn = $('btnOpenCamPicker');
  const dropdown = $('camSelectDropdown');
  const searchInput = $('inpCamSearch');
  if (!btn || !dropdown) return;
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = dropdown.style.display === 'none';
    dropdown.style.display = isHidden ? 'flex' : 'none';
    if (isHidden && searchInput) {
      searchInput.focus();
    }
  });
  
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const groups = document.querySelectorAll('.cam-group-details');
      groups.forEach(group => {
        let hasVisibleChild = false;
        const items = group.querySelectorAll('.cam-item');
        items.forEach(item => {
          const text = item.textContent.toLowerCase();
          if (text.includes(q)) {
            item.style.display = 'block';
            hasVisibleChild = true;
          } else {
            item.style.display = 'none';
          }
        });
        group.style.display = hasVisibleChild ? 'block' : 'none';
        if (q && hasVisibleChild) {
          group.setAttribute('open', '');
        } else if (!q) {
          group.removeAttribute('open');
        }
      });
    });
  }

  camPickerInitialized = true;
}

function updateSelectedCamText(selName) {
    const txtSpan = $('txtSelectedCam');
    if (!txtSpan) return;
    if (!selName) {
        txtSpan.textContent = '-- ไม่เลือก (ว่าง) --';
        return;
    }
    const displayName = displayCameraName(selName, selName);
    txtSpan.textContent = displayName !== selName ? `${displayName} (${selName})` : selName;
}

function populateCamSelect() {
  initCamPicker();
  const sel = $('inpCamSelect');
  const accordion = $('camSelectAccordion');
  if (!sel || !state.nvrCameras || !accordion) return;
  const curCh = (state.draft || (typeof cfg !== 'undefined' && cfg.channels) || [])[state.selCh];
  const oldVal = (curCh && curCh.src) || '';
  const groups = {};
  state.nvrCameras.forEach(cam => {
    const g = cam.group || 'อื่นๆ';
    if (!groups[g]) groups[g] = [];
    groups[g].push(cam);
  });
  
  accordion.innerHTML = '';
  
  const emptyItem = document.createElement('div');
  emptyItem.className = 'cam-item';
  emptyItem.textContent = '-- ไม่เลือก (ว่าง) --';
  emptyItem.style.padding = '8px';
  emptyItem.style.cursor = 'pointer';
  emptyItem.style.borderBottom = '1px solid var(--border-color)';
  emptyItem.onclick = () => {
      sel.value = '';
      sel.dispatchEvent(new Event('change'));
      updateSelectedCamText('');
      $('camSelectDropdown').style.display = 'none';
  };
  emptyItem.onmouseenter = () => emptyItem.style.background = 'var(--bg-hover)';
  emptyItem.onmouseleave = () => emptyItem.style.background = 'transparent';
  accordion.appendChild(emptyItem);

  Object.keys(groups).sort().forEach(g => {
    const details = document.createElement('details');
    details.className = 'cam-group-details';
    details.style.marginBottom = '4px';
    details.style.border = '1px solid var(--border-color)';
    details.style.borderRadius = '4px';
    details.style.background = 'var(--bg-panel)';
    
    const summary = document.createElement('summary');
    summary.style.padding = '8px';
    summary.style.cursor = 'pointer';
    summary.style.fontWeight = 'bold';
    summary.style.userSelect = 'none';
    summary.textContent = `${g} (${groups[g].length})`;
    details.appendChild(summary);
    
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    
    groups[g].forEach(cam => {
        const item = document.createElement('div');
        item.className = 'cam-item';
        item.style.padding = '8px 8px 8px 24px';
        item.style.cursor = 'pointer';
        item.style.borderTop = '1px solid var(--border-color)';
        
        const displayName = displayCameraName(cam.name, cam.name);
        item.textContent = displayName !== cam.name ? `${displayName} (${cam.name})` : cam.name;
        item.dataset.val = cam.name;
        
        item.onmouseenter = () => item.style.background = 'var(--bg-hover)';
        item.onmouseleave = () => item.style.background = 'transparent';
        
        item.onclick = () => {
            sel.value = cam.name;
            sel.dispatchEvent(new Event('change'));
            updateSelectedCamText(cam.name);
            $('camSelectDropdown').style.display = 'none';
        };
        list.appendChild(item);
    });
    
    details.appendChild(list);
    accordion.appendChild(details);
  });
  
  sel.value = oldVal;
  updateSelectedCamText(oldVal);
}


function renderNvrCameras() {
  const wrap = $('camerasList');
  wrap.innerHTML = '';
  if (!state.nvrCameras || state.nvrCameras.length === 0) {
    wrap.innerHTML = `<div class="obj-note">ยังไม่มีกล้องในระบบ</div>`;
    return;
  }
  
  // Group cameras
  const groups = {};
  state.nvrCameras.forEach(cam => {
    const g = cam.group || 'อื่นๆ (ไม่ได้จัดกลุ่ม)';
    if (!groups[g]) groups[g] = [];
    groups[g].push(cam);
  });
  
  const allGroupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  allGroupNames.forEach(gName => {
    const gCams = groups[gName];
    gCams.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
    
    const gWrap = document.createElement('div');
    gWrap.className = 'nvr-group-wrap';
    
    const gHead = document.createElement('div');
    gHead.className = 'nvr-group-header';
    // Build only the fixed group shell as markup, then place the config-owned
    // group name with textContent so a stored name cannot create executable DOM.
    const isSingleGroup = allGroupNames.length === 1;
    const openClass = isSingleGroup ? ' open' : '';

    gHead.innerHTML = `
      <div class="nvr-group-title">
        <span class="nvr-group-name"></span>
        <span class="nvr-group-badge"></span>
      </div>
      <svg class="nvr-group-icon${openClass}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
    `;
    gHead.querySelector('.nvr-group-name').textContent = gName;
    gHead.querySelector('.nvr-group-badge').textContent = String(gCams.length);
    
    const gContent = document.createElement('div');
    gContent.className = 'nvr-group-content' + openClass;
    
    gHead.onclick = () => {
      const icon = gHead.querySelector('.nvr-group-icon');
      if (gContent.classList.contains('open')) {
        gContent.classList.remove('open');
        icon.classList.remove('open');
      } else {
        gContent.classList.add('open');
        icon.classList.add('open');
      }
    };
    
    gCams.forEach(cam => {
      const item = document.createElement('div');
      item.className = 'wl-table-wrap';
      item.style.padding = '12px 15px';
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      
      const info = document.createElement('div');
      info.style.flex = '1';
      
      const label = document.createElement('div');
      label.style.fontWeight = '600';
      label.style.color = '#fff';
      label.style.fontSize = '15px';
      label.style.fontFamily = "var(--font-ui), sans-serif";
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.flexWrap = 'wrap';
      label.style.gap = '6px';
      // Camera names originate in persisted config, so render the name only as
      // text and create the optional status badge as a separate trusted node.
      const cameraName = document.createElement('span');
      const displayName = displayCameraName(cam.name, cam.name);
      cameraName.textContent = displayName;
      label.appendChild(cameraName);
      if (displayName !== cam.name) {
        // Keep a compact, non-editable source hint so operators can correlate
        // the friendly name with the precise NVR identifier when needed.
        const sourceId = document.createElement('span');
        sourceId.className = 'type-chip';
        sourceId.style.position = 'static';
        sourceId.style.fontSize = '11px';
        sourceId.style.padding = '2px 6px';
        sourceId.textContent = cam.name;
        label.appendChild(sourceId);
      }
      if (cam.ai_enabled) {
        const aiBadge = document.createElement('span');
        aiBadge.className = 'type-chip';
        aiBadge.style.position = 'static';
        aiBadge.style.fontSize = '11px';
        aiBadge.style.padding = '2px 6px';
        aiBadge.textContent = 'AI Detect';
        label.appendChild(aiBadge);
      }
      info.appendChild(label);
      
      const urlWrap = document.createElement('div');
      urlWrap.style.display = 'flex';
      urlWrap.style.alignItems = 'center';
      urlWrap.style.gap = '8px';
      urlWrap.style.marginTop = '4px';

      let displayUrlText = window.maskFrigateSecret(cam.rtsp_url) || '- ไม่มี -';
      let copyUrlValue = window.maskFrigateSecret(cam.rtsp_url);

      // Helper for RTMP Push cameras: Show the external IP instead of 127.0.0.1
      if (copyUrlValue && copyUrlValue.startsWith('rtmp://')) {
        const externalUrl = copyUrlValue.replace('127.0.0.1', 'bpp215.duckdns.org');
        displayUrlText = `👉 ยิง RTMP เข้ามาที่: ${externalUrl}`;
        copyUrlValue = externalUrl;
      }

      const urlText = document.createElement('div');
      urlText.style.color = displayUrlText.includes('ยิง RTMP') ? '#34e2a8' : '#9aa0bd';
      urlText.style.fontSize = '13px';
      urlText.style.fontFamily = 'monospace';
      urlText.style.wordBreak = 'break-all';
      urlText.style.userSelect = 'all'; // Easy to highlight all
      urlText.textContent = displayUrlText;
      urlWrap.appendChild(urlText);
      
      if (copyUrlValue) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-ghost';
        copyBtn.style.padding = '2px 6px';
        copyBtn.style.color = '#38bdf8';
        copyBtn.style.minWidth = '0';
        copyBtn.title = 'คัดลอกลิงก์';
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        copyBtn.onclick = (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(copyUrlValue);
          const oldHtml = copyBtn.innerHTML;
          copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          setTimeout(() => copyBtn.innerHTML = oldHtml, 1500);
        };
        urlWrap.appendChild(copyBtn);
      }
      
      info.appendChild(urlWrap);
      
      item.appendChild(info);
      
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-ghost';
      editBtn.style.color = '#c084fc';
      editBtn.style.borderColor = 'rgba(192,132,252,0.3)';
      editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> แก้ไข';
      editBtn.onclick = (e) => { e.stopPropagation(); editNvrCamera(cam); };
      actions.appendChild(editBtn);
      
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-ghost';
      delBtn.style.color = '#f43f5e';
      delBtn.style.borderColor = 'rgba(244,63,94,0.3)';
      delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg> ลบ';
      delBtn.onclick = (e) => { e.stopPropagation(); deleteNvrCamera(cam.name); };
      actions.appendChild(delBtn);
      
      item.appendChild(actions);
      gContent.appendChild(item);
    });
    
    gWrap.appendChild(gHead);
    gWrap.appendChild(gContent);
    wrap.appendChild(gWrap);
  });
}

async function deleteNvrCamera(name) {
  if (!await window.bppConfirm(`คุณต้องการลบกล้อง "${name}" ออกจากระบบใช่หรือไม่?\n\nคำเตือน: หลังลบ ระบบ NVR จะถูกรีสตาร์ทอัตโนมัติ ซึ่งจะทำให้ภาพดับไปประมาณ 1-3 นาที`)) return;
  
  try {
    // Treat the persisted camera name as one URL segment so it cannot alter the
    // protected config route when older configs predate current validation.
    const res = await fetch(`/api/config/cameras/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    toast(`ลบกล้อง ${name} เรียบร้อย... กำลังรีสตาร์ทระบบ`);
    
    // Reuse the CSRF-aware admin restart helper after the validated delete.
    loadNvrCameras();
    restartFrigate().catch(() => {});
  } catch(e) {
    toast(`ลบกล้องไม่สำเร็จ: ${e.message || ''}`);
  }
}

let editingCameraName = null;

function editNvrCamera(cam) {
  editingCameraName = cam.name;
  $('camListView').hidden = true;
  $('camEditView').hidden = false;
  const displayName = displayCameraName(cam.name, cam.name);
  // Keep the source visible in the title only when it adds diagnostic value.
  $('camEditTitle').textContent = displayName !== cam.name
    ? `แก้ไขกล้อง: ${displayName} (${cam.name})`
    : `แก้ไขกล้อง: ${cam.name}`;
  $('inpCamName').value = cam.name;
  if ($('inpCamDisplayName')) {
     $('inpCamDisplayName').value = state.cameraNames[cam.name] || '';
  }
  $('inpCamMain').dataset.original = cam.rtsp_url || '';
  $('inpCamMain').value = window.maskFrigateSecret(cam.rtsp_url) || '';
  $('inpCamSub').dataset.original = cam.sub_url || '';
  $('inpCamSub').value = window.maskFrigateSecret(cam.sub_url) || '';
  $('inpCamDetect').checked = cam.ai_enabled;
  $('inpCamGroup').value = cam.group || '';
  const selPreset = $('selCamPreset');
  if (selPreset) {
    if (!cam.ai_enabled) {
      const url = (cam.rtsp_url || '').toLowerCase();
      if (url.includes('itc') || url.includes('lpr')) {
        selPreset.value = 'lpr_edge';
      } else {
        selPreset.value = 'vigi_ai';
      }
    } else {
      selPreset.value = 'general';
    }
    selPreset.dispatchEvent(new Event('change'));
  }
}

async function loadWebRtcIp() {
  try {
    const res = await fetch('/api/config/webrtc');
    if(res.ok) {
      const data = await res.json();
      $('inpWebRtcIp').value = data.ip || '';
    }
  } catch(e) { console.error('Failed to load WebRTC IP', e); }
}

document.addEventListener('DOMContentLoaded', () => {
  if ($('btnSaveWebRtcIp')) {
    $('btnAutoWebRtcIp').addEventListener('click', () => {
    const ip = window.location.hostname;
    if (ip === 'localhost' || ip === '127.0.0.1') {
      toast('ระบบตรวจพบ IP เป็น ' + ip + ' (ใช้บนเครื่องตัวเอง) ถ้าต้องการให้เครื่องอื่นดูได้ด้วย โปรดพิมพ์ IP วงแลนของเครื่องนี้แทน');
    }
    $('inpWebRtcIp').value = ip;
    toast('ดึง IP อัตโนมัติ: ' + ip);
  });

  $('btnSaveWebRtcIp').addEventListener('click', async () => {
      const ip = $('inpWebRtcIp').value.trim();
      if(!ip) return;
      const b = $('btnSaveWebRtcIp');
      b.disabled = true; b.textContent = '...';
      try {
        const res = await fetch('/api/config/webrtc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip })
        });
        if(!res.ok) throw new Error();
        // The shared helper supplies Frigate's CSRF header and the admin gateway
        // route after the candidate was committed by Config API.
        toast('บันทึก WebRTC IP เรียบร้อย... กำลังรีสตาร์ทระบบ');
        restartFrigate().catch(() => {});
      } catch(e) {
        toast('ไม่สามารถบันทึก IP ได้');
      }
      b.disabled = false; b.textContent = 'บันทึกและรีสตาร์ท';
    });
  }

  if ($('btnShowAddCam')) {
    $('btnShowAddCam').addEventListener('click', () => {
      editingCameraName = null;
      $('camListView').hidden = true;
      $('camEditView').hidden = false;
      $('camEditTitle').textContent = 'เพิ่มกล้องใหม่';
      $('inpCamName').value = '';
      if ($('inpCamDisplayName')) $('inpCamDisplayName').value = '';
      $('inpCamMain').dataset.original = '';
      $('inpCamMain').value = '';
      $('inpCamSub').dataset.original = '';
      $('inpCamSub').value = '';
      $("inpCamDetect").checked = true;
      $("inpCamGroup").value = "";
      const selPreset = $('selCamPreset');
      if (selPreset) {
        selPreset.value = 'general';
        selPreset.dispatchEvent(new Event('change'));
      }
    });
    
    $('btnCancelCamEdit').addEventListener('click', () => {
      $('camListView').hidden = false;
      $('camEditView').hidden = true;
    });
    
    $('btnConfirmCamEdit').addEventListener('click', async () => {
      const name = $('inpCamName').value.trim();
      let rtsp = $('inpCamMain').value.trim();
      rtsp = window.unmaskFrigateSecret(rtsp, $('inpCamMain').dataset.original);
      const displayName = $('inpCamDisplayName') ? $('inpCamDisplayName').value.trim() : '';
      let sub = $('inpCamSub').value.trim();
      sub = window.unmaskFrigateSecret(sub, $('inpCamSub').dataset.original);
      const detect = $("inpCamDetect").checked;
      const group = $("inpCamGroup").value.trim();
      
      if (!name || !/^[A-Za-z0-9_]+$/.test(name)) {
        toast('กรุณากรอกชื่อกล้อง (ภาษาอังกฤษ/ตัวเลข/ขีดล่าง ห้ามเว้นวรรค)');
        return;
      }
      if (!rtsp || !/^(rtsp|rtmp|http|https):\/\//i.test(rtsp)) {
        toast('กรุณากรอก Stream URL ที่ถูกต้อง (rtsp://, rtmp://)');
        return;
      }

      // Defer the display-name write until Config API has accepted the camera.
      // This keeps camera_names.json from gaining orphaned entries after a
      // failed camera validation or a rejected RTSP configuration.
      const previousCameraNames = { ...(state.cameraNames || {}) };
      const nextCameraNames = { ...previousCameraNames };
      if (editingCameraName && editingCameraName !== name) {
        delete nextCameraNames[editingCameraName];
      }
      if (displayName) nextCameraNames[name] = displayName;
      else delete nextCameraNames[name];
      
      try {
        const b = $('btnConfirmCamEdit');
        b.disabled = true; b.textContent = 'กำลังบันทึก...';
        
        let url = '/api/config/cameras';
        let method = 'POST';
        if (editingCameraName) {
          // Older stored names may not follow today's validator, so preserve the
          // name as data by encoding it before composing the admin-only route.
          url = `/api/config/cameras/${encodeURIComponent(editingCameraName)}`;
          method = 'PUT';
        }
        
        const res = await fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, rtsp_url: rtsp, sub_url: sub, ai_enabled: detect, group: group })
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt);
        }
        let displayNameSaved = true;
        state.cameraNames = nextCameraNames;
        try {
          await saveCameraDisplayNames();
        } catch (displayNameError) {
          // Restore only the browser state when the name map was not durable;
          // the camera itself has already been saved by Config API.
          state.cameraNames = previousCameraNames;
          displayNameSaved = false;
          console.error('Failed saving camera display names:', displayNameError);
        }
        toast(displayNameSaved
          ? `บันทึกกล้อง ${name} เรียบร้อย... กำลังรีสตาร์ทระบบ`
          : `บันทึกกล้อง ${name} แล้ว แต่บันทึกชื่อแสดงผลไม่สำเร็จ`);
        
        $('camListView').hidden = false;
        $('camEditView').hidden = true;
        // Reuse the CSRF-aware admin restart helper after the validated save.
        loadNvrCameras();
        restartFrigate().catch(() => {});
      } catch(e) {
        toast('บันทึกไม่สำเร็จ: ' + e.message);
      } finally {
        const b = $('btnConfirmCamEdit');
        b.disabled = false; b.textContent = 'ตกลง';
      }
    });
  }
});







  async function loadBranding() {
    try {
      const res = await fetch('/settings/branding.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        if (data.name) window.BRANDING.name = data.name;
        if (data.sub) window.BRANDING.sub = data.sub;
      }
    } catch(e) {}
    try {
      const logoRes = await fetch('/settings/logo.png', { method: 'HEAD' });
      if (logoRes.ok) window.BRANDING.logo = '/settings/logo.png?t=' + Date.now();
    } catch(e) {}
    
    // Apply branding
    const bName = $('brandName'); if (bName) bName.textContent = window.BRANDING.name;
    const bSub = $('brandSub'); if (bSub) bSub.textContent = window.BRANDING.sub;
    document.title = window.BRANDING.name + ' ' + window.BRANDING.sub + ' - NVR';
    const bLogo = $('mainLogo'); if (bLogo && window.BRANDING.logo !== 'assets/BPP215.png') bLogo.src = window.BRANDING.logo;
    
    if (['admin', 'superadmin'].includes(userRole)) {
      const saveBranding = async () => {
        try {
          const res = await fetch('/settings/branding.json', { method: 'PUT', body: JSON.stringify({ name: window.BRANDING.name, sub: window.BRANDING.sub }) });
          if (res.ok) toast('บันทึกชื่อสำเร็จ');
          else toast('บันทึกไม่สำเร็จ ' + res.status);
        } catch(e) { toast('Error saving branding'); }
      };
      if (bName) {
        bName.style.cursor = 'pointer';
        bName.addEventListener('click', async () => {
          const v = await window.bppPrompt('ชื่อหลัก', window.BRANDING.name);
          if (v !== null && v.trim()) { window.BRANDING.name = v.trim().substring(0, 100); bName.textContent = window.BRANDING.name; saveBranding(); }
        });
      }
      if (bSub) {
        bSub.style.cursor = 'pointer';
        bSub.addEventListener('click', async () => {
          const v = await window.bppPrompt('ชื่อรอง', window.BRANDING.sub);
          if (v !== null && v.trim()) { window.BRANDING.sub = v.trim().substring(0, 100); bSub.textContent = window.BRANDING.sub; saveBranding(); }
        });
      }
      if (bLogo) {
        bLogo.style.cursor = 'pointer';
        const fileInp = $('logoUpload');
        bLogo.addEventListener('click', () => fileInp.click());
        fileInp.addEventListener('change', async e => {
          const file = e.target.files[0];
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) return toast('ไฟล์ใหญ่เกินไป (สูงสุด 2MB)');
          toast('กำลังอัปโหลดโลโก้...');
          try {
            const res = await fetch('/settings/admin/logo.png', { method: 'PUT', body: file });
            if (res.ok) { toast('เปลี่ยนโลโก้สำเร็จ'); bLogo.src = '/settings/logo.png?t=' + Date.now(); window.BRANDING.logo = bLogo.src; }
            else toast('อัปโหลดไม่สำเร็จ ' + res.status);
          } catch(err) { toast('Error uploading logo'); }
        });
      }
    }
  }

  // Export to window for admin.js to access
  window.cfg = cfg;
  window.state = state;
  window.saveCfg = saveCfg;
  window.saveServerChannels = saveServerChannels;
  window.rebuildGrid = rebuildGrid;
  window.renderChList = renderChList;
  window.renderChForm = renderChForm;
  window.getOptimalAutoLayout = getOptimalAutoLayout;
  window.applyAutoLayout = applyAutoLayout;
  window.displayCameraName = displayCameraName;
  window.toast = toast;

  // CLAUDE.md Section 10: Map & Grid camera assignment function
  // Intent: Assign camera to a personal grid slot for this user only, completely decoupled from global system channels.
  // Never overwrites /settings/admin/channels and never causes Frigate restarts for other users.
  window.assignCameraToChannel = async function(camId, chIdx) {
    if (chIdx < 0 || chIdx >= MAX_CH) {
      toast('หมายเลขช่องสัญญาณไม่ถูกต้อง (CH01 - CH16)');
      return false;
    }
    const ch = cfg.channels[chIdx] || { src: '', name: '', sub: '', enabled: true, detect: false };
    if (!camId) {
      ch.src = '';
      ch.name = '';
      ch.sub = '';
      ch.hd = '';
      ch.enabled = true;
      ch.detect = false;
    } else {
      let thaiName = displayCameraName(camId);
      if (thaiName === camId && window.cachedCameraGPS && window.cachedCameraGPS[camId] && window.cachedCameraGPS[camId].name) {
        thaiName = window.cachedCameraGPS[camId].name;
      }
      ch.src = camId;
      ch.name = thaiName;
      ch.enabled = true;
      if (typeof ch.detect !== 'boolean') ch.detect = false;
      ch.sub = '';
      ch.hd = '';
      normalizeChannelStreams(ch);

      // Immediately ensure HLS stream mapping exists for this camera
      if (window.cachedCameraGPS && window.cachedCameraGPS[camId] && window.cachedCameraGPS[camId].url) {
        if (!window.DYNAMIC_HLS_MAP) window.DYNAMIC_HLS_MAP = {};
        window.DYNAMIC_HLS_MAP[camId] = window.cachedCameraGPS[camId].url;
      }
    }
    cfg.channels[chIdx] = ch;

    if (state.draft && state.draft.length > chIdx) {
      state.draft[chIdx] = { ...ch };
    }

    // CLAUDE.md Section 10: Save to user profile personal channels (isolated per user)
    if (!state.userProfile) state.userProfile = {};
    state.userProfile.channels = cfg.channels.map(c => ({ ...c }));

    saveCfg();

    if (camId && state.userProfile && state.userProfile.hidden_channels) {
      state.userProfile.hidden_channels = state.userProfile.hidden_channels.filter(s => s !== camId);
    }

    // อัปเดตเฉพาะช่องที่เปลี่ยนทันที (Surgical Single-Slot Diff) โดยไม่ต้องรอ API ตอบกลับและไม่กระทบช่องอื่น
    syncGridDiffSmoothly();
    if (typeof renderChList === 'function') renderChList();
    if (typeof renderChForm === 'function') renderChForm();

    const chLabelStr = `CH${String(chIdx + 1).padStart(2, '0')}`;
    if (camId) {
      const thaiName = displayCameraName(camId);
      toast(`นำกล้อง "${thaiName || camId}" เข้าสู่ช่อง ${chLabelStr} บนหน้าจอของคุณเรียบร้อย`);
    } else {
      toast(`ล้างช่องสัญญาณ ${chLabelStr} บนหน้าจอของคุณเรียบร้อย`);
    }

    await saveUserProfile();

    // Admin Master Grid Auto-Sync: keep central channels.json aligned with admin viewport in real time
    if (['admin', 'superadmin'].includes(userRole)) {
      try {
        await saveServerChannels();
      } catch (syncErr) {
        console.warn('Auto-sync server channels on slot change failed:', syncErr);
      }
    }

    await sendUserHeartbeat();
    triggerDemandReconciliation(false);
    updateResetLayoutButton();

    if (typeof window.refreshCameraHeatmapMarkers === 'function') {
      window.refreshCameraHeatmapMarkers();
    }
    return true;
  };

  /**
   * CLAUDE.md Section 10: Quick Camera Picker Modal for Dashboard Grid Slots
   * Allows any operator to easily search and switch cameras on their personal grid.
   * @param {number} slotIdx 0-based channel index (0..15)
   */
  window.openCameraPickerForSlot = function(slotIdx) {
    if (slotIdx < 0 || slotIdx >= MAX_CH) return;
    
    // Remove existing picker modal if any
    const existing = document.getElementById('bppSlotCamPickerModal');
    if (existing) existing.remove();

    const chNum = chLabel(slotIdx);
    const currentCh = cfg.channels[slotIdx] || {};
    const currentCamId = currentCh.src || '';

    // Build camera map with deduplication (case-insensitive merge)
    // Key: lower_id -> Value: { id: real_id, name: string, group: string }
    const camMap = new Map();
    const addCam = (rawId, name, prov, grp) => {
      const lower = rawId.toLowerCase();
      let c = camMap.get(lower) || { id: rawId, name: rawId, group: '' };
      
      // Prefer the exact NVR camera ID If it exists
      if (rawId === lower) c.id = rawId; 
      else if (!camMap.has(lower)) c.id = rawId;

      if (name && name !== rawId && name !== lower) c.name = name;
      if (grp) c.group = grp;
      else if (prov && !c.group) c.group = prov; // fallback to province as group if no NVR group

      camMap.set(lower, c);
    };

    if (state.cameraNames) {
      for (const [id, name] of Object.entries(state.cameraNames)) {
        if (id) addCam(id, name, null, null);
      }
    }
    if (Array.isArray(state.nvrCameras)) {
      state.nvrCameras.forEach(c => {
        if (c && c.name) addCam(c.name, null, null, c.group);
      });
    }
    if (window.cachedCameraGPS && typeof window.cachedCameraGPS === 'object') {
      for (const [id, cdata] of Object.entries(window.cachedCameraGPS)) {
        if (id) {
          addCam(id, cdata.name, cdata.province, null);
        }
      }
    }

    // Group cameras
    const grouped = {};
    for (const c of camMap.values()) {
      const gName = c.group || 'อื่นๆ (ไม่ได้ระบุ)';
      if (!grouped[gName]) grouped[gName] = [];
      grouped[gName].push(c);
    }
    const allGroupNames = Object.keys(grouped).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    // Modal DOM
    const modal = document.createElement('div');
    modal.id = 'bppSlotCamPickerModal';
    modal.className = 'bpp-picker-overlay';

    const card = document.createElement('div');
    card.className = 'bpp-picker-card';

    // Header
    let html = `
      <style>
        .slot-picker-group { border-bottom: 1px solid #1e293b; }
        .slot-picker-group:last-child { border-bottom: none; }
        .slot-picker-group-header {
          padding: 10px 15px; background: #0f172a; cursor: pointer; display: flex; align-items: center; justify-content: space-between; font-weight: 600; font-size: 14px; color: #cbd5e1; user-select: none;
        }
        .slot-picker-group-header::-webkit-details-marker { display: none; }
        .slot-picker-group[open] .chevron { transform: rotate(180deg); }
        .chevron { transition: transform 0.2s; color: #64748b; }
        .slot-picker-group-content { padding: 4px; background: #1e293b; }
      </style>
      <div class="bpp-picker-header">
        <div>
          <div class="bpp-picker-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>
            <span>เลือกกล้องสำหรับช่อง ${chNum}</span>
          </div>
          <div class="bpp-picker-sub">เปลี่ยนเฉพาะหน้าจอของคุณ (ไม่กระทบผู้อื่นและระบบ)</div>
        </div>
        <button id="btnCloseSlotPicker" class="bpp-picker-close" type="button" title="ปิด">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      
      <div class="bpp-picker-toolbar">
        <div class="bpp-picker-search-box">
          <span class="bpp-picker-search-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </span>
          <input type="text" id="slotPickerSearch" class="bpp-picker-search-input" placeholder="ค้นหารหัสกล้อง หรือชื่อไทย..." autofocus>
        </div>
        <button id="btnClearSlotBtn" class="bpp-picker-clear-slot" type="button" title="เว้นว่างช่องนี้">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
          <span>เว้นว่างช่องนี้</span>
        </button>
      </div>

      <div id="slotPickerList" class="bpp-picker-list">
    `;

    // Find currently used slots for indicator
    const usedSlotMap = new Map();
    cfg.channels.forEach((c, idx) => {
      if (c.src) usedSlotMap.set(c.src, chLabel(idx));
    });

    allGroupNames.forEach(gName => {
      const gCams = grouped[gName].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));
      html += `
        <details class="slot-picker-group" data-group-name="${escapeHtml(gName.toLowerCase())}">
          <summary class="slot-picker-group-header">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
              <span>${escapeHtml(gName)} <span style="font-size:11px; opacity:0.71; margin-left:4px;">(${gCams.length})</span></span>
              <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </summary>
          <div class="slot-picker-group-content">
      `;

      gCams.forEach(({ id, name }) => {
        const isCurrentThisSlot = id === currentCamId;
        const otherSlot = usedSlotMap.get(id);
        const isAssigned = !!otherSlot;

        html += `
          <div class="slot-cam-opt${isCurrentThisSlot ? ' current-slot' : ''}" data-id="${escapeHtml(id)}" data-name="${escapeHtml((name || '').toLowerCase())}">
            <div style="display:flex;flex-direction:column;gap:2px;overflow:hidden;padding-right:8px;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-weight:700;color:${isCurrentThisSlot ? '#c084fc' : '#f1f5f9'};font-size:13px;font-family:var(--font-mono,monospace);">${escapeHtml(id)}</span>
                ${isCurrentThisSlot ? '<span style="font-size:10.5px;color:#c084fc;font-weight:700;background:rgba(168,85,247,0.2);padding:1px 6px;border-radius:4px;">ช่องนี้</span>' : ''}
                ${(!isCurrentThisSlot && isAssigned) ? `<span style="font-size:10.5px;color:#94a3b8;background:rgba(148,163,184,0.15);padding:1px 6px;border-radius:4px;">(อยู่ ${otherSlot})</span>` : ''}
              </div>
              ${name && name !== id ? `<div style="font-size:12px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</div>` : ''}
            </div>
            <button type="button" class="slot-cam-btn-select">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>เลือก</span>
            </button>
          </div>
        `;
      });
      html += `\</div></details>`;
    });

    html += `</div>`;
    card.innerHTML = html;
    modal.appendChild(card);
    document.body.appendChild(modal);

    // Search filter
    const searchInp = card.querySelector('#slotPickerSearch');
    if (searchInp) {
      searchInp.addEventListener('input', () => {
        const q = searchInp.value.toLowerCase().trim();
        const groups = card.querySelectorAll('.slot-picker-group');
        groups.forEach(g => {
          let hasVisible = false;
          const items = g.querySelectorAll('.slot-cam-opt');
          items.forEach(el => {
            const id = el.getAttribute('data-id').toLowerCase();
            const name = el.getAttribute('data-name') || '';
            if (!q || id.includes(q) || name.includes(q)) {
              el.style.display = 'flex';
              hasVisible = true;
            } else {
              el.style.display = 'none';
            }
          });
          g.style.display = hasVisible ? 'block' : 'none';
        });
      });
    }

    // Select camera
    card.querySelectorAll('.slot-cam-opt').forEach(el => {
      el.addEventListener('click', async () => {
        const cid = el.getAttribute('data-id');
        modal.remove();
        await window.assignCameraToChannel(cid, slotIdx);
      });
    });

    // Clear slot
    const clearBtn = card.querySelector('#btnClearSlotBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        modal.remove();
        await window.assignCameraToChannel('', slotIdx);
      });
    }

    // Close on X
    const closeBtn = card.querySelector('#btnCloseSlotPicker');
    if (closeBtn) closeBtn.addEventListener('click', () => modal.remove());

    // Close on overlay click or ESC
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.remove();
    });
    const onEsc = e => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);
  };

  window.handleAssignFromMap = async function(camId) {
    const sel = document.getElementById('camChSelect_' + camId);
    if (!sel) return;
    const chIdx = parseInt(sel.value, 10);
    if (isNaN(chIdx)) return;
    await window.assignCameraToChannel(camId, chIdx);
    if (typeof leafletMap !== 'undefined' && leafletMap && typeof leafletMap.closePopup === 'function') {
      try { leafletMap.closePopup(); } catch (e) {}
    }
  };

  window.handleHideFromMap = async function(camId) {
    if (!camId) return;
    if (!state.userProfile) state.userProfile = { hidden_channels: [], visible_channels: [] };
    if (!state.userProfile.hidden_channels) state.userProfile.hidden_channels = [];
    if (!state.userProfile.hidden_channels.includes(camId)) {
      state.userProfile.hidden_channels.push(camId);
    }
    await saveUserProfile();
    renderChList();
    renderChForm();
    applyAutoLayout(true);
    rebuildGrid();
    if (window.bppToast) window.bppToast(`ซ่อนกล้อง ${camId} จากหน้าจอของคุณแล้ว`);
  };

  window.flyToCameraOnHeatmap = function(camId) {
    if (!camId) return;
    const btn = $('btnAnalytics');
    const modal = $('analyticsModal');
    if (!modal || !modal.classList.contains('open')) {
      if (btn) btn.click();
    }
    setTimeout(() => {
      if (typeof window.focusCameraMarker === 'function') {
        window.focusCameraMarker(camId);
      }
    }, 450);
  };

  // =========================================================================
  // MULTI-CAMERA HISTORICAL PULL & AI VEHICLE SCANNER CONTROLLER
  // =========================================================================
  function hpEsc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const HP_DEFAULT_GROUPS = [
    {
      group_id: 'nonburi',
      group_name: 'กล้องโนนบุรี (Uniview NVR 16x Fast Replay)',
      camera_count: 5,
      cameras: [
        { id: 'nonburi1', name: 'โนนบุรี 1 (สามแยกวัดกัลยาณบริหาร)' },
        { id: 'nonburi2', name: 'โนนบุรี 2 (ลานร้านค้า)' },
        { id: 'nonburi4', name: 'โนนบุรี 4 (แยกไฟแดง)' },
        { id: 'nonburi5', name: 'โนนบุรี 5 (สามแยกไฟกระพริบ)' },
        { id: 'nonburi6', name: 'โนนบุรี 6 (สี่แยกเกาะกลาง)' }
      ]
    },
    {
      group_id: 'nongwang',
      group_name: 'ทต.หนองแวง (TVT NVMS-9000 WebSocket 1080p)',
      camera_count: 15,
      cameras: [
        { id: 'nongwang1', name: 'หนองแวง 1 (หน้าเทศบาลหนองแวง)' },
        { id: 'nongwang2', name: 'หนองแวง 2 (ลานจอดรถเทศบาลฯ)' },
        { id: 'nongwang3', name: 'หนองแวง 3 (รร.บ้านร่วมจิต)' },
        { id: 'nongwang4', name: 'หนองแวง 4 (บ้านศรีทายาท)' },
        { id: 'nongwang5', name: 'หนองแวง 5 (ศูนย์ศิลปาชีพทหาร)' },
        { id: 'nongwang6', name: 'หนองแวง 6 (บ้านผไทรวมพล)' },
        { id: 'nongwang7', name: 'หนองแวง 7 (รร.บ้านปากช่อง)' },
        { id: 'nongwang8', name: 'หนองแวง 8 (ตลาดบ้านหนองหว้า)' },
        { id: 'nongwang9', name: 'หนองแวง 9 (สามแยกวัดเขาดิน)' },
        { id: 'nongwang10', name: 'หนองแวง 10 (บ้านปากช่อง 1)' },
        { id: 'nongwang11', name: 'หนองแวง 11 (บ้านปากช่อง 2)' },
        { id: 'nongwang12', name: 'หนองแวง 12 (บ้านหนองแวง)' },
        { id: 'nongwang13', name: 'หนองแวง 13 (ศูนย์เด็กเล็กบ้านหงอนไก่)' },
        { id: 'nongwang14', name: 'หนองแวง 14 (สี่แยกบ้านหงอนไก่)' },
        { id: 'nongwang15', name: 'หนองแวง 15 (ในบ้านหงอนไก่)' }
      ]
    },
    {
      group_id: 'doonsad',
      group_name: 'อบต.ดูนสาด (Dahua NVR RTSP Playback 1080p)',
      camera_count: 3,
      cameras: [
        { id: 'Doonsad1', name: 'ดูนสาด 1 (โค้งดูนสาดไปนาคำน้อย)' },
        { id: 'Doonsad5', name: 'ดูนสาด 5 (อบต.ดูนสาด)' },
        { id: 'Doonsad6', name: 'ดูนสาด 6 (อบต.ดูนสาด)' }
      ]
    },
    {
      group_id: 'bpp215',
      group_name: 'ตชด.215 BPP215 (Local NVR Storage + Hikvision)',
      camera_count: 3,
      cameras: [
        { id: 'D_BPP215_1', name: 'ตชด.215 กล้อง 1 (หน้ากองร้อย)' },
        { id: 'D_BPP215_2', name: 'ตชด.215 กล้อง 2 (ป้อมยามหน้าค่าย)' },
        { id: 'D_BPP215_3', name: 'ตชด.215 กล้อง 3 (คลังอาวุธ)' }
      ]
    }
  ];

  let _hpGroups = HP_DEFAULT_GROUPS.slice();
  let _hpSelectedCams = new Set(['nonburi1', 'nonburi2', 'nonburi4', 'nonburi5', 'nonburi6']);
  let _hpActiveJobId = null;
  let _hpPollTimer = null;
  let _hpLastCompletedJob = null;

  function hpUpdateSelectedBadge() {
    const badge = $('hpSelectedCamBadge');
    if (badge) badge.textContent = `เลือกแล้ว ${_hpSelectedCams.size} กล้อง`;
    const container = $('hpCameraGroupsContainer');
    if (!container) return;
    container.querySelectorAll('.hp-cam-cb').forEach(cb => {
      const checked = _hpSelectedCams.has(cb.value);
      cb.checked = checked;
      const itemLabel = cb.closest('.hp-cam-item');
      if (itemLabel) itemLabel.classList.toggle('is-selected', checked);
    });
    container.querySelectorAll('.hp-group-cb').forEach(gcb => {
      const gid = gcb.getAttribute('data-group');
      const grp = _hpGroups.find(g => g.group_id === gid);
      if (!grp || !grp.cameras || !grp.cameras.length) {
        gcb.checked = false;
        return;
      }
      const allIn = grp.cameras.every(c => _hpSelectedCams.has(c.id));
      gcb.checked = allIn;
    });
  }

  function hpRenderCameraGroups() {
    const container = $('hpCameraGroupsContainer');
    if (!container) return;
    if (!_hpGroups.length) {
      _hpGroups = HP_DEFAULT_GROUPS.slice();
    }
    let html = '';
    _hpGroups.forEach(grp => {
      const cams = grp.cameras || [];
      html += `
        <div class="hp-group-card">
          <div class="hp-group-head">
            <label class="hp-group-label">
              <input type="checkbox" class="hp-group-cb" data-group="${hpEsc(grp.group_id)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
              <span>${hpEsc(grp.group_name)}</span>
            </label>
            <span class="events-total" style="flex:none;">${cams.length} กล้อง</span>
          </div>
          <div class="hp-cam-grid">
            ${cams.map(c => {
              const isSel = _hpSelectedCams.has(c.id);
              return `
                <label class="hp-cam-item${isSel ? ' is-selected' : ''}">
                  <input type="checkbox" class="hp-cam-cb" value="${hpEsc(c.id)}" data-group="${hpEsc(grp.group_id)}"${isSel ? ' checked' : ''}>
                  <svg class="hp-cam-item-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                  <span class="hp-cam-item-name" title="${hpEsc(c.name)} (${hpEsc(c.id)})">${hpEsc(c.name)}</span>
                </label>
              `;
            }).join('')}
          </div>
        </div>
      `;
    });
    container.innerHTML = html;

    container.querySelectorAll('.hp-cam-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) _hpSelectedCams.add(cb.value);
        else _hpSelectedCams.delete(cb.value);
        hpUpdateSelectedBadge();
      });
    });

    container.querySelectorAll('.hp-group-cb').forEach(gcb => {
      gcb.addEventListener('change', () => {
        const gid = gcb.getAttribute('data-group');
        const grp = _hpGroups.find(g => g.group_id === gid);
        if (!grp || !grp.cameras) return;
        grp.cameras.forEach(c => {
          if (gcb.checked) _hpSelectedCams.add(c.id);
          else _hpSelectedCams.delete(c.id);
        });
        hpUpdateSelectedBadge();
      });
    });

    hpUpdateSelectedBadge();
  }

  async function hpLoadCatalog() {
    // Render instant default catalog immediately so operator never waits
    hpRenderCameraGroups();
    try {
      const res = await fetch('/api/nas-bot/history-pull/cameras');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.groups) && data.groups.length > 0) {
        _hpGroups = data.groups;
      }
      const allIds = [];
      _hpGroups.forEach(g => (g.cameras || []).forEach(c => allIds.push(c.id)));
      window._hpCatalogCameras = allIds;
      hpRenderCameraGroups();
    } catch (e) {}
  }

  function hpRenderJobStatus(job) {
    if (!job) return;
    const titleEl = $('hpJobStatusTitle');
    const pctEl = $('hpJobPercentLabel');
    const barEl = $('hpJobProgressBar');
    const pillsEl = $('hpJobCameraPills');
    const actionsEl = $('hpJobResultsActions');
    const startBtn = $('btnHpStartJob');
    const cancelBtn = $('btnHpCancelJob');

    const pct = Math.max(0, Math.min(100, Number(job.percent || 0)));
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (barEl) barEl.style.width = `${pct}%`;

    const st = job.status || 'queued';
    const segs = Number(job.segments_imported || 0);
    const evs = Number(job.events_created || 0);

    if (st === 'queued') {
      if (titleEl) {
        titleEl.innerHTML = `<span class="sync-spin"></span><span>อยู่ในคิวรอประมวลผล (${(job.cameras || []).length} กล้อง)...</span>`;
      }
      if (startBtn) startBtn.disabled = true;
      if (cancelBtn) cancelBtn.hidden = false;
      if (actionsEl) actionsEl.hidden = true;
    } else if (st === 'running') {
      const curCam = job.current_camera_name || job.current_camera || '';
      if (titleEl) {
        titleEl.innerHTML = `<span class="sync-spin"></span><span>กำลังดึงภาพ &amp; สแกน AI: ${hpEsc(curCam)} (ดึงสำเร็จ ${segs} ไฟล์ • พบรถ ${evs} เหตุการณ์)</span>`;
      }
      if (startBtn) startBtn.disabled = true;
      if (cancelBtn) cancelBtn.hidden = false;
      if (actionsEl) actionsEl.hidden = false;
    } else if (st === 'completed') {
      if (titleEl) {
        titleEl.innerHTML = `<span class="dot green small"></span><span>เสร็จสมบูรณ์ — ดึงวิดีโอย้อนหลัง ${segs} ไฟล์ • บันทึกเหตุการณ์ AI ${evs} รายการ</span>`;
      }
      if (startBtn) startBtn.disabled = false;
      if (cancelBtn) cancelBtn.hidden = true;
      if (actionsEl) actionsEl.hidden = false;
      _hpLastCompletedJob = job;
    } else if (st === 'cancelled' || st === 'cancel_requested') {
      if (titleEl) {
        titleEl.innerHTML = `<span class="dot amber small"></span><span>ยกเลิกคำสั่งแล้ว (ดึงแล้ว ${segs} ไฟล์ • พบรถ ${evs} รายการ)</span>`;
      }
      if (startBtn) startBtn.disabled = false;
      if (cancelBtn) cancelBtn.hidden = true;
      if (actionsEl) actionsEl.hidden = (segs === 0 && evs === 0);
    } else {
      if (titleEl) {
        titleEl.innerHTML = `<span class="dot green small"></span><span>สถานะ: ${hpEsc(st)}</span>`;
      }
      if (startBtn) startBtn.disabled = false;
      if (cancelBtn) cancelBtn.hidden = true;
    }

    if (pillsEl && job.camera_progress) {
      const entries = Object.values(job.camera_progress);
      pillsEl.innerHTML = entries.map(cp => {
        let cls = '';
        let dotHtml = '<span class="dot small" style="background:#6b7099;"></span>';
        if (cp.status === 'pulling') {
          cls = 'pulling';
          dotHtml = '<span class="sync-spin" style="width:11px; height:11px; border-width:1.8px;"></span>';
        } else if (cp.status === 'scanning') {
          cls = 'scanning';
          dotHtml = '<span class="sync-spin" style="width:11px; height:11px; border-width:1.8px;"></span>';
        } else if (cp.status === 'done') {
          cls = 'done';
          dotHtml = '<span class="dot green small"></span>';
        } else if (cp.status === 'no_video') {
          cls = 'no_video';
          dotHtml = '<span class="dot amber small"></span>';
        }
        const evTxt = cp.events_found > 0 ? ` • พบรถ ${cp.events_found}` : '';
        return `<span class="hp-status-pill ${cls}">${dotHtml}<span>${hpEsc(cp.name || cp.camera)} (${cp.segments_ok || 0}/${cp.segments_total || 0} นาที${evTxt})</span></span>`;
      }).join('');
    }
  }

  async function hpPollJob() {
    if (!_hpActiveJobId) return;
    try {
      const res = await fetch(`/api/nas-bot/history-pull/jobs/${encodeURIComponent(_hpActiveJobId)}`);
      if (!res.ok) return;
      const data = await res.json();
      const job = data.job;
      if (!job) return;
      hpRenderJobStatus(job);
      if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
        if (_hpPollTimer) { clearInterval(_hpPollTimer); _hpPollTimer = null; }
        if (job.status === 'completed' && window.bppToast) {
          window.bppToast(`ดึงภาพย้อนหลังสำเร็จ (${job.segments_imported || 0} ไฟล์, พบรถ ${job.events_created || 0} เหตุการณ์)`);
        }
      }
    } catch (e) {}
  }

  function openHistoryPullModal() {
    const ov = $('historyPullOverlay');
    if (!ov) return;
    const dateIn = $('hpInputDate');
    if (dateIn && !dateIn.value) {
      const pbDateEl = $('pbDate');
      if (pbDateEl && pbDateEl.value) {
        dateIn.value = pbDateEl.value;
      } else {
        const now = new Date();
        dateIn.value = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      }
    }
    ov.hidden = false;
    hpLoadCatalog();
  }

  function closeHistoryPullModal() {
    const ov = $('historyPullOverlay');
    if (ov) ov.hidden = true;
  }

  function initHistoryPullModal() {
    const btnEmgr = $('btnOpenHistoryPullFromEmgr');
    const btnPb = $('btnOpenHistoryPullFromPb');
    const btnClose = $('btnCloseHistoryPull');
    const ov = $('historyPullOverlay');

    if (btnEmgr) btnEmgr.addEventListener('click', openHistoryPullModal);
    if (btnPb) btnPb.addEventListener('click', openHistoryPullModal);
    if (btnClose) btnClose.addEventListener('click', closeHistoryPullModal);
    if (ov) {
      ov.addEventListener('click', e => {
        if (e.target === ov) closeHistoryPullModal();
      });
    }

    const btnAll = $('btnHpSelectAllCams');
    if (btnAll) {
      btnAll.addEventListener('click', () => {
        _hpGroups.forEach(g => (g.cameras || []).forEach(c => _hpSelectedCams.add(c.id)));
        hpUpdateSelectedBadge();
      });
    }

    const btnClear = $('btnHpClearAllCams');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        _hpSelectedCams.clear();
        hpUpdateSelectedBadge();
      });
    }

    const aiCb = $('hpInputAiScan');
    const aiFields = $('hpAiFilterFields');
    if (aiCb && aiFields) {
      aiCb.addEventListener('change', () => {
        aiFields.style.opacity = aiCb.checked ? '1' : '0.4';
        aiFields.style.pointerEvents = aiCb.checked ? 'auto' : 'none';
      });
    }

    document.querySelectorAll('.hp-dur-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.hp-dur-preset').forEach(b => b.classList.toggle('active', b === btn));
        const mins = parseInt(btn.getAttribute('data-mins') || '15', 10);
        const stEl = $('hpInputStartTime');
        const etEl = $('hpInputEndTime');
        if (!stEl || !etEl || !stEl.value) return;
        const [hh, mm] = stEl.value.split(':').map(Number);
        const totalMins = Math.min(23 * 60 + 59, hh * 60 + mm + mins);
        const eh = Math.floor(totalMins / 60);
        const em = totalMins % 60;
        etEl.value = `${pad2(eh)}:${pad2(em)}`;
      });
    });

    const btnStart = $('btnHpStartJob');
    if (btnStart) {
      btnStart.addEventListener('click', async () => {
        const cams = Array.from(_hpSelectedCams);
        if (!cams.length) {
          alert('กรุณาเลือกกล้องที่ต้องการดึงภาพย้อนหลังอย่างน้อย 1 กล้อง');
          return;
        }
        const dateVal = ($('hpInputDate') && $('hpInputDate').value) || '';
        const stVal = ($('hpInputStartTime') && $('hpInputStartTime').value) || '';
        const etVal = ($('hpInputEndTime') && $('hpInputEndTime').value) || '';
        if (!dateVal || !stVal || !etVal) {
          alert('กรุณาระบุวันที่ เวลาเริ่มต้น และเวลาสิ้นสุดให้ครบถ้วน');
          return;
        }
        const startEpoch = Math.floor(new Date(`${dateVal}T${stVal}:00+07:00`).getTime() / 1000);
        const endEpoch = Math.floor(new Date(`${dateVal}T${etVal}:00+07:00`).getTime() / 1000);
        if (isNaN(startEpoch) || isNaN(endEpoch) || endEpoch <= startEpoch) {
          alert('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น');
          return;
        }
        if (endEpoch - startEpoch > 3600) {
          alert('สามารถดึงย้อนหลังได้สูงสุดครั้งละไม่เกิน 60 นาทีต่อชุดคำสั่ง');
          return;
        }

        const payload = {
          cameras: cams,
          start_ts: startEpoch,
          end_ts: endEpoch,
          ai_scan: $('hpInputAiScan') ? $('hpInputAiScan').checked : true,
          vehicle_type: ($('hpInputVehicleType') && $('hpInputVehicleType').value) || 'all',
          vehicle_color: ($('hpInputVehicleColor') && $('hpInputVehicleColor').value) || 'all',
          case_tag: ($('hpInputCaseTag') && $('hpInputCaseTag').value.trim()) || ''
        };

        btnStart.disabled = true;
        try {
          const res = await fetch('/api/nas-bot/history-pull/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok) {
            alert(data.detail || 'ไม่สามารถสร้างงานดึงภาพย้อนหลังได้');
            btnStart.disabled = false;
            return;
          }
          _hpActiveJobId = data.job.job_id;
          _hpLastCompletedJob = data.job;
          hpRenderJobStatus(data.job);
          if (_hpPollTimer) clearInterval(_hpPollTimer);
          _hpPollTimer = setInterval(hpPollJob, 1500);
        } catch (e) {
          alert('เกิดข้อผิดพลาดในการส่งคำสั่ง: ' + e.message);
          btnStart.disabled = false;
        }
      });
    }

    const btnCancel = $('btnHpCancelJob');
    if (btnCancel) {
      btnCancel.addEventListener('click', async () => {
        if (!_hpActiveJobId) return;
        try {
          await fetch(`/api/nas-bot/history-pull/jobs/${encodeURIComponent(_hpActiveJobId)}/cancel`, { method: 'POST' });
          hpPollJob();
        } catch (e) {}
      });
    }

    const btnOpenPbRes = $('btnHpOpenPlaybackResult');
    if (btnOpenPbRes) {
      btnOpenPbRes.addEventListener('click', () => {
        const job = _hpLastCompletedJob;
        const dateVal = ($('hpInputDate') && $('hpInputDate').value) || '';
        const firstCam = (job && job.cameras && job.cameras[0]) || Array.from(_hpSelectedCams)[0] || 'nonburi1';
        closeHistoryPullModal();
        openPlayback(firstCam, dateVal);
      });
    }

    const btnOpenEmgrRes = $('btnHpOpenEmgrResult');
    if (btnOpenEmgrRes) {
      btnOpenEmgrRes.addEventListener('click', () => {
        const tagVal = ($('hpInputCaseTag') && $('hpInputCaseTag').value.trim()) || '';
        closeHistoryPullModal();
        openEventMgr('detection');
        if (tagVal) {
          setTimeout(() => {
            const sIn = $('emgrSearch');
            if (sIn) {
              sIn.value = tagVal;
              sIn.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, 250);
        }
      });
    }
  }

  initHistoryPullModal();
  window.openHistoryPullModal = openHistoryPullModal;

})();







/* ============ Face Recognition & 512-D ArcFace Watchlist UI (Phase P1 + SLOTH Fusion + Warrant Compare) ============ */
(function initFaceWatchlistUi() {
  let _allRegisteredFaces = [];
  let _faceFilterCategory = 'all'; // 'all' | 'warrant' | 'watchlist' | 'general'
  let _currentWcDossierId = '';

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
      reader.readAsDataURL(file);
    });
  }

  function openWarrantCompareModal(info) {
    if (!info) return;
    const overlay = document.getElementById('warrantCompareOverlay');
    if (!overlay) return;

    const wComp = info.warrant_comparison || {};
    const wInfo = info.warrant_info || wComp || {};
    const suspectName = info.person || info.best_person || info.person_name || info.name || wComp.person_name || '-';
    const idCard = info.id_card || wComp.id_card || wInfo.id_card || '-';
    const warrantNo = wInfo.warrant_no || wComp.warrant_no || '-';
    const court = wInfo.court || wComp.court || '-';
    const station = wInfo.station_name || wComp.station_name || '-';
    const caseNo = wInfo.case_no || wComp.case_no || '-';
    const effectiveDate = wInfo.effective_date || wComp.effective_date || '-';
    const expirationDate = wInfo.expiration_date || wComp.expiration_date || '-';
    const countdown = wInfo.countdown_text || wComp.countdown_text || 'มีผลบังคับใช้ตามกฎหมาย';
    const status = wInfo.status || wComp.status || 'มีผลบังคับใช้ตามกฎหมาย';
    const charge = wInfo.charge || wComp.charge || info.notes || '-';
    const simPct = Number(info.similarity_pct || info.best_similarity_pct || 95.0).toFixed(1);
    const cosine = Number(info.cosine || info.best_cosine || 0.85).toFixed(3);
    const dossierId = info.dossier_id || wComp.dossier_id || '';

    _currentWcDossierId = dossierId;

    // Images
    const queryImgEl = document.getElementById('wcQueryImg');
    const warrantImgEl = document.getElementById('wcWarrantImg');
    const queryLabelEl = document.getElementById('wcQueryLabel');
    const queryMetaEl = document.getElementById('wcQueryMeta');
    const warrantMetaEl = document.getElementById('wcWarrantMeta');

    const queryThumb = info.query_thumbnail || info.queryImg || info.thumbnail || 'assets/arm215-logo.png';
    const warrantThumb = wComp.thumbnail || info.thumbnail || (info.candidates && info.candidates[0] && info.candidates[0].thumbnail) || 'assets/arm215-logo.png';

    if (queryImgEl) queryImgEl.src = queryThumb;
    if (warrantImgEl) warrantImgEl.src = warrantThumb;
    if (queryLabelEl) queryLabelEl.textContent = info.queryLabel || (info.camera ? `ภาพจากกล้อง (${info.camera})` : 'ภาพถ่ายเปรียบเทียบ / ตรวจจับ');
    if (queryMetaEl) queryMetaEl.textContent = info.queryMeta || (info.created_at ? `ตรวจพบเมื่อ: ${info.created_at}` : 'ArcFace 512-D Feature Vector');
    if (warrantMetaEl) warrantMetaEl.textContent = dossierId ? `แฟ้มคลังข้อมูล: ${dossierId}` : 'ฐานข้อมูลหมายจับ ตชด.215';

    // Scores
    const scoreTextEl = document.getElementById('wcSimilarityScoreText');
    const simBarEl = document.getElementById('wcSimilarityBar');
    const matchBadgeEl = document.getElementById('wcMatchBadge');
    if (scoreTextEl) scoreTextEl.textContent = `ความคล้ายคลึง: ${simPct}% (Cosine: ${cosine})`;
    if (simBarEl) simBarEl.style.width = `${Math.min(100, Math.max(10, simPct))}%`;
    if (matchBadgeEl) {
      const isMatch = Number(simPct) >= 50.0 || (info.matched !== false);
      matchBadgeEl.textContent = isMatch ? 'MATCH' : 'POSSIBLE';
      matchBadgeEl.style.color = isMatch ? '#34d399' : '#fbbf24';
      matchBadgeEl.style.borderColor = isMatch ? 'rgba(52,211,153,0.4)' : 'rgba(251,191,36,0.4)';
    }

    // Legal details
    const elSuspect = document.getElementById('wcSuspectName');
    const elIdCard = document.getElementById('wcIdCard');
    const elWarrantNo = document.getElementById('wcWarrantNo');
    const elCourt = document.getElementById('wcCourt');
    const elStation = document.getElementById('wcStation');
    const elCaseNo = document.getElementById('wcCaseNo');
    const elDates = document.getElementById('wcDates');
    const elStatus = document.getElementById('wcStatus');
    const elCountdown = document.getElementById('wcCountdownBadge');
    const elCharge = document.getElementById('wcCharge');
    const elDossierText = document.getElementById('wcDossierIdText');

    if (elSuspect) elSuspect.textContent = suspectName;
    if (elIdCard) elIdCard.textContent = idCard;
    if (elWarrantNo) elWarrantNo.textContent = warrantNo;
    if (elCourt) elCourt.textContent = court;
    if (elStation) elStation.textContent = station;
    if (elCaseNo) elCaseNo.textContent = caseNo;
    if (elDates) elDates.textContent = `${effectiveDate} ถึง ${expirationDate}`;
    if (elStatus) elStatus.textContent = status;
    if (elCountdown) elCountdown.textContent = `⏳ ${countdown}`;
    if (elCharge) elCharge.textContent = charge;
    if (elDossierText) elDossierText.textContent = dossierId || '-';

    overlay.hidden = false;
  }

  window.openWarrantCompareModal = openWarrantCompareModal;

  function renderRegisteredFaces(items) {
    _allRegisteredFaces = Array.isArray(items) ? items : [];
    const grid = document.getElementById('wlFaceRegisteredGrid');
    const badge = document.getElementById('wlFaceTotalBadge');
    const q = (document.getElementById('inpFaceFilterQuery')?.value || '').trim().toLowerCase();

    const warrantCnt = _allRegisteredFaces.filter(i => i.is_warrant).length;
    const wlCnt = _allRegisteredFaces.filter(i => i.source === 'watchlist').length;
    const generalCnt = _allRegisteredFaces.filter(i => i.source === 'dossier' && !i.is_warrant).length;

    const elW = document.getElementById('cntWarrantFilter');
    const elWl = document.getElementById('cntWatchlistFilter');
    const elGen = document.getElementById('cntGeneralFilter');
    if (elW) elW.textContent = warrantCnt;
    if (elWl) elWl.textContent = wlCnt;
    if (elGen) elGen.textContent = generalCnt;

    if (badge) {
      badge.textContent = `${_allRegisteredFaces.length} รายชื่อ (หมายจับ ${warrantCnt} • เฝ้าระวัง ${wlCnt} • อื่นๆ ${generalCnt})`;
    }
    if (!grid) return;

    // Filter by Category
    let categoryFiltered = _allRegisteredFaces;
    if (_faceFilterCategory === 'warrant') {
      categoryFiltered = _allRegisteredFaces.filter(i => i.is_warrant);
    } else if (_faceFilterCategory === 'watchlist') {
      categoryFiltered = _allRegisteredFaces.filter(i => i.source === 'watchlist');
    } else if (_faceFilterCategory === 'general') {
      categoryFiltered = _allRegisteredFaces.filter(i => i.source === 'dossier' && !i.is_warrant);
    }

    // Filter by Search Query
    const filtered = q
      ? categoryFiltered.filter(it => {
          const winfo = it.warrant_info || {};
          const hay = `${it.name || ''} ${it.id_card || ''} ${it.role_or_group || ''} ${it.notes || ''} ${it.dossier_id || ''} ${winfo.warrant_no || ''} ${winfo.court || ''} ${winfo.charge || ''}`.toLowerCase();
          return hay.includes(q);
        })
      : categoryFiltered;

    if (!filtered.length) {
      grid.innerHTML = '<div style="grid-column:1/-1; padding:18px; text-align:center; color:#6b7099; background:rgba(15,23,42,0.45); border-radius:10px; border:1px dashed rgba(148,163,184,0.2);">ไม่พบรายชื่อใบหน้าที่ตรงกับตัวกรองหรือคำค้นหา</div>';
      return;
    }

    grid.innerHTML = filtered.slice(0, 90).map(item => {
      const safeName = escapeHtml(item.name || '');
      const isWarrant = !!item.is_warrant;
      const isDossier = item.source === 'dossier';
      const winfo = item.warrant_info || {};
      const warrantNo = escapeHtml(winfo.warrant_no || '');
      const court = escapeHtml(winfo.court || '');
      const countdown = escapeHtml(winfo.countdown_text || '');
      const group = escapeHtml(item.role_or_group || (isWarrant ? 'ผู้ต้องหาตามหมายจับ' : (isDossier ? 'คลังข้อมูลจับกุม' : 'บุคคลเฝ้าระวัง')));
      const idCard = escapeHtml(item.id_card || '');
      const notes = escapeHtml(item.notes || '');
      const thumb = item.thumbnail || 'assets/arm215-logo.png';

      let srcBadge = '';
      if (isWarrant) {
        srcBadge = `<span style="font-size:10px; font-weight:700; padding:1px 7px; border-radius:999px; background:rgba(239,68,68,0.25); color:#fca5a5; border:1px solid rgba(239,68,68,0.55);">⚖️ หมายจับ ${warrantNo ? '#' + warrantNo : ''}</span>`;
      } else if (isDossier) {
        srcBadge = '<span style="font-size:10px; padding:1px 6px; border-radius:999px; background:rgba(16,185,129,0.18); color:#34d399; border:1px solid rgba(16,185,129,0.4);">📁 คลังข้อมูล</span>';
      } else {
        srcBadge = '<span style="font-size:10px; padding:1px 6px; border-radius:999px; background:rgba(244,63,94,0.2); color:#fda4af; border:1px solid rgba(244,63,94,0.45);">🚨 เฝ้าระวัง</span>';
      }

      const cardBorder = isWarrant
        ? 'border:1px solid rgba(239,68,68,0.55); box-shadow:0 0 12px rgba(239,68,68,0.15); background:linear-gradient(135deg, rgba(35,16,28,0.9), rgba(20,16,42,0.85));'
        : (isDossier
          ? 'border:1px solid rgba(16,185,129,0.28); background:rgba(22,19,44,0.82);'
          : 'border:1px solid rgba(168,85,247,0.35); background:rgba(22,19,44,0.82);');

      return `
        <div style="display:flex; flex-direction:column; gap:8px; padding:10px 12px; border-radius:10px; ${cardBorder}">
          <div style="display:flex; gap:10px; align-items:flex-start;">
            <img src="${thumb}" alt="${safeName}" style="width:54px; height:54px; border-radius:8px; object-fit:cover; border:1px solid ${isWarrant ? 'rgba(239,68,68,0.6)' : 'rgba(168,85,247,0.5)'}; flex:none;">
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <div style="font-weight:700; font-size:13px; color:#f8fafc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${safeName}">👤 ${safeName}</div>
                ${srcBadge}
              </div>
              <div style="font-size:11px; color:#c084fc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${group} • ${Number(item.photo_count || 1)} รูป</div>
              ${idCard ? `<div style="font-size:10.5px; color:#38bdf8; font-family:monospace;">🪪 ${idCard}</div>` : ''}
              ${court ? `<div style="font-size:10.5px; color:#fca5a5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">🏛️ ${court}</div>` : ''}
              ${countdown ? `<div style="font-size:10px; color:#fcd34d; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${countdown}">⏳ ${countdown}</div>` : ''}
              ${notes ? `<div style="font-size:10.5px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${notes}">${notes}</div>` : ''}
            </div>
          </div>
          <div style="display:flex; gap:6px; justify-content:flex-end; border-top:1px solid rgba(255,255,255,0.06); padding-top:6px;">
            ${isWarrant ? `<button type="button" class="btn-ghost wl-face-compare-btn" data-person="${safeName}" style="padding:4px 8px; font-size:11px; color:#fca5a5; border-color:rgba(239,68,68,0.45); background:rgba(239,68,68,0.12);">⚖️ ตรวจเทียบหมาย</button>` : ''}
            ${item.dossier_id ? `<button type="button" class="btn-ghost wl-face-dossier-btn" data-dossier="${escapeHtml(item.dossier_id)}" style="padding:4px 8px; font-size:11px; color:#34d399; border-color:rgba(16,185,129,0.35);">📁 เปิดแฟ้ม</button>` : ''}
            ${!isDossier ? `<button type="button" class="btn-ghost wl-face-del-btn" data-person="${safeName}" title="ลบออกจากบัญชีเฝ้าระวัง" style="padding:4px 8px; font-size:11px; color:#fb5b78; border-color:rgba(251,91,120,0.35);">🗑</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Wire Warrant Compare Buttons
    grid.querySelectorAll('.wl-face-compare-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pname = btn.getAttribute('data-person');
        const item = _allRegisteredFaces.find(i => i.name === pname);
        if (item) openWarrantCompareModal(item);
      });
    });

    // Wire Dossier Open Buttons
    grid.querySelectorAll('.wl-face-dossier-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const did = btn.getAttribute('data-dossier');
        if (did && window.openDossierDetail) {
          const wlOverlay = document.getElementById('watchlistOverlay');
          if (wlOverlay) wlOverlay.hidden = true;
          window.openDossierDetail(did, 'personal');
        }
      });
    });

    // Wire Delete Buttons
    grid.querySelectorAll('.wl-face-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pname = btn.getAttribute('data-person') || '';
        if (!pname) return;
        const ok = window.bppConfirm ? await window.bppConfirm(`ต้องการลบใบหน้าของ "${pname}" ออกจากบัญชีเฝ้าระวังหรือไม่?`) : confirm(`ลบ "${pname}"?`);
        if (!ok) return;
        try {
          const res = await fetch('/api/watchlist/faces/' + encodeURIComponent(pname), { method: 'DELETE' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || data.error || ('HTTP ' + res.status));
          toast(`ลบรายชื่อ "${pname}" เรียบร้อยแล้ว`);
          loadFaceWatchlistData();
        } catch (err) {
          toast('ลบรายชื่อไม่สำเร็จ: ' + (err.message || err), true);
        }
      });
    });
  }

  function renderRecentFaceDetections(items) {
    const grid = document.getElementById('wlFaceRecentGrid');
    if (!grid) return;
    if (!Array.isArray(items) || !items.length) {
      grid.innerHTML = '<div style="grid-column:1/-1; padding:14px; text-align:center; color:#6b7099; background:rgba(15,23,42,0.45); border-radius:10px; border:1px dashed rgba(148,163,184,0.2);">ยังไม่มีรายการตรวจจับใบหน้าล่าสุดจากกล้อง</div>';
      return;
    }
    grid.innerHTML = items.slice(0, 16).map((det, idx) => {
      const matched = !!det.matched;
      const isWarrant = !!det.is_warrant;
      const person = escapeHtml(det.person || 'บุคคลไม่ทราบชื่อ');
      const cam = escapeHtml(displayCameraName(det.camera || '') || det.camera || 'กล้อง');
      const simPct = Number(det.similarity_pct || 0).toFixed(1);
      const thumb = det.thumbnail || '';
      const winfo = det.warrant_info || {};
      const wNo = escapeHtml(winfo.warrant_no || '');

      let badgeStyle = 'background:rgba(56,189,248,0.16); color:#7dd3fc; border:1px solid rgba(56,189,248,0.35);';
      let badgeText = '👤 ตรวจพบใบหน้า';
      let cardBorder = 'border:1px solid rgba(148,163,184,0.2);';

      if (isWarrant) {
        badgeStyle = 'background:rgba(239,68,68,0.28); color:#fca5a5; border:1px solid rgba(239,68,68,0.6); box-shadow:0 0 8px rgba(239,68,68,0.2);';
        badgeText = `🚨 ตรงกับหมายจับ: ${person} (${simPct}%) ${wNo ? '#' + wNo : ''}`;
        cardBorder = 'border:1px solid rgba(239,68,68,0.55); box-shadow:0 0 10px rgba(239,68,68,0.15); background:linear-gradient(135deg, rgba(35,16,28,0.9), rgba(20,16,42,0.85));';
      } else if (matched) {
        badgeStyle = 'background:rgba(244,63,94,0.22); color:#fda4af; border:1px solid rgba(244,63,94,0.5);';
        badgeText = `🚨 พบเป้าหมาย: ${person} (${simPct}%)`;
        cardBorder = 'border:1px solid rgba(244,63,94,0.45);';
      }

      return `
        <div style="display:flex; flex-direction:column; gap:6px; padding:10px; border-radius:10px; background:rgba(18,16,36,0.82); ${cardBorder}">
          <div style="display:flex; gap:9px; align-items:center;">
            ${thumb ? `<img src="${thumb}" alt="${person}" style="width:48px; height:48px; border-radius:8px; object-fit:cover; flex:none; border:1px solid ${isWarrant ? 'rgba(239,68,68,0.6)' : 'rgba(56,189,248,0.4)'};">` : ''}
            <div style="flex:1; min-width:0;">
              <span style="font-size:11px; font-weight:700; padding:2px 7px; border-radius:999px; ${badgeStyle}">${badgeText}</span>
              <div style="font-size:11px; color:#cbd5e1; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">📹 ${cam}</div>
              <div style="font-size:10.5px; color:#64748b;">${escapeHtml(det.created_at || '')}</div>
            </div>
          </div>
          <div style="display:flex; gap:6px; margin-top:4px;">
            ${isWarrant ? `<button type="button" class="btn-ghost wl-face-wc-det-btn" data-idx="${idx}" style="flex:1; padding:4px 8px; font-size:11px; color:#fca5a5; border-color:rgba(239,68,68,0.5); background:rgba(239,68,68,0.15);">⚖️ ตรวจเทียบหมาย</button>` : ''}
            ${thumb ? `<button type="button" class="btn-ghost wl-face-quick-enroll" data-idx="${idx}" style="flex:1; padding:4px 8px; font-size:11px;">➕ เพิ่มเฝ้าระวัง</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Wire Warrant Compare on Recent Detection
    grid.querySelectorAll('.wl-face-wc-det-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx') || 0);
        const det = items[idx];
        if (det) {
          openWarrantCompareModal({
            ...det,
            queryImg: det.thumbnail,
            queryLabel: `ภาพที่ตรวจพบจากกล้อง (${det.camera || ''})`,
            queryMeta: `เวลาที่บันทึก: ${det.created_at || ''}`,
          });
        }
      });
    });

    // Wire Quick Enroll
    grid.querySelectorAll('.wl-face-quick-enroll').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.getAttribute('data-idx') || 0);
        const det = items[idx];
        if (!det || !det.thumbnail) return;
        const name = prompt('ระบุชื่อ-สกุล หรือฉายาของบุคคลเฝ้าระวัง:', det.person || '');
        if (!name || !name.trim()) return;
        try {
          const res = await fetch('/api/watchlist/faces/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: name.trim(),
              image_b64: det.thumbnail,
              group: 'บุคคลเฝ้าระวัง',
              notes: `บันทึกจากกล้อง ${det.camera || ''} (${det.created_at || ''})`,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || data.error || ('HTTP ' + res.status));
          toast(`✅ ลงทะเบียนใบหน้า "${name.trim()}" สำเร็จ`);
          loadFaceWatchlistData();
        } catch (err) {
          toast('ลงทะเบียนใบหน้าไม่สำเร็จ: ' + (err.message || err), true);
        }
      });
    });
  }

  async function loadFaceWatchlistData() {
    try {
      const res = await fetch('/api/watchlist/faces');
      if (!res.ok) return;
      const data = await res.json();
      renderRegisteredFaces(data.items || []);
      renderRecentFaceDetections(data.recent_detections || []);
    } catch (err) {
      console.warn('loadFaceWatchlistData error:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btnTabPlates = document.getElementById('btnWlTabPlates');
    const btnTabFaces = document.getElementById('btnWlTabFaces');
    const panePlates = document.getElementById('wlPanePlates');
    const paneFaces = document.getElementById('wlPaneFaces');

    if (btnTabPlates && btnTabFaces && panePlates && paneFaces) {
      btnTabPlates.addEventListener('click', () => {
        panePlates.style.display = 'flex';
        paneFaces.style.display = 'none';
        btnTabPlates.style.background = 'rgba(168,85,247,0.18)';
        btnTabPlates.style.color = '#fff';
        btnTabPlates.style.borderColor = 'rgba(168,85,247,0.45)';
        btnTabFaces.style.background = 'transparent';
        btnTabFaces.style.color = '#9aa0bd';
        btnTabFaces.style.borderColor = 'transparent';
      });
      btnTabFaces.addEventListener('click', () => {
        panePlates.style.display = 'none';
        paneFaces.style.display = 'flex';
        btnTabFaces.style.background = 'rgba(168,85,247,0.18)';
        btnTabFaces.style.color = '#fff';
        btnTabFaces.style.borderColor = 'rgba(168,85,247,0.45)';
        btnTabPlates.style.background = 'transparent';
        btnTabPlates.style.color = '#9aa0bd';
        btnTabPlates.style.borderColor = 'transparent';
        loadFaceWatchlistData();
      });
    }

    // Category Filter Buttons
    const btnFilterAll = document.getElementById('btnFaceFilterAll');
    const btnFilterWarrant = document.getElementById('btnFaceFilterWarrant');
    const btnFilterWatchlist = document.getElementById('btnFaceFilterWatchlist');
    const btnFilterGeneral = document.getElementById('btnFaceFilterGeneral');

    const updateFilterStyles = (activeBtn) => {
      [btnFilterAll, btnFilterWarrant, btnFilterWatchlist, btnFilterGeneral].forEach(b => {
        if (!b) return;
        b.classList.remove('active');
        b.style.background = 'transparent';
      });
      if (activeBtn) {
        activeBtn.classList.add('active');
        if (activeBtn === btnFilterWarrant) {
          activeBtn.style.background = 'rgba(239,68,68,0.25)';
        } else if (activeBtn === btnFilterWatchlist) {
          activeBtn.style.background = 'rgba(168,85,247,0.25)';
        } else if (activeBtn === btnFilterGeneral) {
          activeBtn.style.background = 'rgba(16,185,129,0.25)';
        } else {
          activeBtn.style.background = 'rgba(168,85,247,0.22)';
        }
      }
    };

    if (btnFilterAll) {
      btnFilterAll.addEventListener('click', () => {
        _faceFilterCategory = 'all';
        updateFilterStyles(btnFilterAll);
        renderRegisteredFaces(_allRegisteredFaces);
      });
    }
    if (btnFilterWarrant) {
      btnFilterWarrant.addEventListener('click', () => {
        _faceFilterCategory = 'warrant';
        updateFilterStyles(btnFilterWarrant);
        renderRegisteredFaces(_allRegisteredFaces);
      });
    }
    if (btnFilterWatchlist) {
      btnFilterWatchlist.addEventListener('click', () => {
        _faceFilterCategory = 'watchlist';
        updateFilterStyles(btnFilterWatchlist);
        renderRegisteredFaces(_allRegisteredFaces);
      });
    }
    if (btnFilterGeneral) {
      btnFilterGeneral.addEventListener('click', () => {
        _faceFilterCategory = 'general';
        updateFilterStyles(btnFilterGeneral);
        renderRegisteredFaces(_allRegisteredFaces);
      });
    }

    // Close Warrant Compare Modal Buttons
    const btnCloseWc = document.getElementById('btnCloseWarrantCompare');
    const btnWcClose = document.getElementById('btnWcClose');
    const wcOverlay = document.getElementById('warrantCompareOverlay');
    if (btnCloseWc && wcOverlay) btnCloseWc.addEventListener('click', () => { wcOverlay.hidden = true; });
    if (btnWcClose && wcOverlay) btnWcClose.addEventListener('click', () => { wcOverlay.hidden = true; });

    // Open full dossier from Warrant Compare Modal
    const btnWcOpenDossier = document.getElementById('btnWcOpenDossier');
    if (btnWcOpenDossier) {
      btnWcOpenDossier.addEventListener('click', () => {
        if (_currentWcDossierId && window.openDossierDetail) {
          if (wcOverlay) wcOverlay.hidden = true;
          const wlOverlay = document.getElementById('watchlistOverlay');
          if (wlOverlay) wlOverlay.hidden = true;
          window.openDossierDetail(_currentWcDossierId, 'personal');
        } else {
          toast('ไม่พบรหัสแฟ้มคลังข้อมูลสำหรับรายการนี้', true);
        }
      });
    }

    const btnReload = document.getElementById('btnFaceReloadAll');
    if (btnReload) btnReload.addEventListener('click', loadFaceWatchlistData);

    const inpFilter = document.getElementById('inpFaceFilterQuery');
    if (inpFilter) {
      inpFilter.addEventListener('input', () => renderRegisteredFaces(_allRegisteredFaces));
    }

    const btnSyncDossiers = document.getElementById('btnFaceSyncDossiers');
    if (btnSyncDossiers) {
      btnSyncDossiers.addEventListener('click', async () => {
        try {
          btnSyncDossiers.disabled = true;
          toast('กำลังซิงค์ใบหน้าและหมายจับจากคลังข้อมูลจับกุม (Arrest Vault)…');
          const res = await fetch('/api/watchlist/faces/sync-dossiers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: false }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || data.error || ('HTTP ' + res.status));
          toast(`✅ ซิงค์คลังข้อมูลสำเร็จ: ${data.dossier_persons || 0} แฟ้มบุคคล (${data.total_photos || 0} รูปใบหน้า)`);
          loadFaceWatchlistData();
        } catch (err) {
          toast('ซิงค์คลังข้อมูลไม่สำเร็จ: ' + (err.message || err), true);
        } finally {
          btnSyncDossiers.disabled = false;
        }
      });
    }

    const btnReg = document.getElementById('btnFaceRegisterSubmit');
    if (btnReg) {
      btnReg.addEventListener('click', async () => {
        const nameEl = document.getElementById('inpFacePersonName');
        const groupEl = document.getElementById('inpFacePersonGroup');
        const notesEl = document.getElementById('inpFacePersonNotes');
        const fileEl = document.getElementById('inpFaceRegisterFile');
        const name = (nameEl?.value || '').trim();
        if (!name) {
          toast('กรุณาระบุชื่อ-สกุล หรือฉายาของบุคคล', true);
          return;
        }
        const file = fileEl?.files?.[0];
        if (!file) {
          toast('กรุณาเลือกรูปใบหน้าที่ชัดเจน', true);
          return;
        }
        try {
          btnReg.disabled = true;
          toast('กำลังสกัดอัตลักษณ์ใบหน้า 512 มิติ…');
          const b64 = await readFileAsDataUrl(file);
          const res = await fetch('/api/watchlist/faces/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              group: (groupEl?.value || 'บุคคลเฝ้าระวัง').trim(),
              notes: (notesEl?.value || '').trim(),
              image_b64: b64,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || data.error || ('HTTP ' + res.status));
          toast(`✅ ลงทะเบียนใบหน้า "${data.person}" สำเร็จ (${data.photo_count} รูป)`);
          if (nameEl) nameEl.value = '';
          if (notesEl) notesEl.value = '';
          if (fileEl) fileEl.value = '';
          loadFaceWatchlistData();
        } catch (err) {
          toast('ลงทะเบียนใบหน้าไม่สำเร็จ: ' + (err.message || err), true);
        } finally {
          btnReg.disabled = false;
        }
      });
    }

    const btnSearch1N = document.getElementById('btnFaceSearch1N');
    if (btnSearch1N) {
      btnSearch1N.addEventListener('click', async () => {
        const f1 = document.getElementById('inpFaceSearchFile1')?.files?.[0];
        const resBox = document.getElementById('wlFaceSearchResultBox');
        if (!f1) {
          toast('กรุณาเลือกรูปใบหน้าในช่องที่ 1 เพื่อค้นหา', true);
          return;
        }
        try {
          btnSearch1N.disabled = true;
          if (resBox) resBox.textContent = 'กำลังค้นหาอัตลักษณ์ 512 มิติในฐานข้อมูล…';
          const b64 = await readFileAsDataUrl(f1);
          const res = await fetch('/api/watchlist/faces/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_b64: b64 }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || data.error || ('HTTP ' + res.status));
          const cands = Array.isArray(data.candidates) ? data.candidates : [];
          if (!cands.length) {
            resBox.innerHTML = `<div style="display:flex; align-items:center; gap:10px;"><img src="${data.query_thumbnail || ''}" style="width:44px;height:44px;border-radius:6px;object-fit:cover;"><span>ตรวจพบใบหน้าแล้ว แต่ยังไม่มีรายชื่อในฐานข้อมูล (${data.latency_ms || 0} ms)</span></div>`;
            return;
          }
          const top = cands[0];
          const isWarrant = !!(data.is_warrant || top.is_warrant);
          const verdictColor = isWarrant ? '#f87171' : (data.matched ? '#34d399' : '#fbbf24');
          const winfo = data.warrant_info || top.warrant_info || {};
          const wNo = winfo.warrant_no ? ` [หมายจับ #${winfo.warrant_no}]` : '';

          let warrantBanner = '';
          if (isWarrant) {
            warrantBanner = `
              <div style="margin-top:8px; padding:8px 10px; border-radius:8px; background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.5); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                <div style="color:#fecaca; font-size:11.5px; font-weight:700;">🚨 ตรงกับผู้ต้องหาตามหมายจับ! (ศาล: ${escapeHtml(winfo.court || '-')})</div>
                <button type="button" id="btnWcFromSearch" class="btn-primary" style="padding:4px 10px; font-size:11.5px; background:linear-gradient(135deg, #ef4444, #dc2626); border-color:#ef4444;">⚖️ ตรวจเทียบหมายจับฉบับเต็ม</button>
              </div>
            `;
          }

          resBox.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:6px;">
              <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                <img src="${data.query_thumbnail || ''}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid #38bdf8;" title="รูปค้นหา">
                <span>➜</span>
                <img src="${top.thumbnail || ''}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid ${verdictColor};" title="${escapeHtml(top.person || '')}">
                <div style="flex:1; min-width:180px;">
                  <div style="font-weight:700; color:${verdictColor};">${data.matched ? `✅ ตรงกับเป้าหมาย: ${escapeHtml(top.person)}${wNo}` : `ใกล้เคียงที่สุด: ${escapeHtml(top.person)} (ต่ำกว่าเกณฑ์)`}</div>
                  <div style="font-size:12px; color:#cbd5e1;">ความคล้ายคลึง: <b>${top.similarity_pct}%</b> (Cosine: ${top.cosine}) • ใช้เวลา ${data.latency_ms} ms</div>
                </div>
              </div>
              ${warrantBanner}
            </div>
          `;

          const btnWcSearch = document.getElementById('btnWcFromSearch');
          if (btnWcSearch) {
            btnWcSearch.addEventListener('click', () => {
              openWarrantCompareModal({
                ...data,
                ...top,
                queryImg: data.query_thumbnail,
                queryLabel: 'ภาพที่อัปโหลดค้นหา (1:N Search)',
                queryMeta: `AI Cosine: ${top.cosine} (${top.similarity_pct}%)`,
              });
            });
          }
        } catch (err) {
          if (resBox) resBox.textContent = 'ค้นหาไม่สำเร็จ: ' + (err.message || err);
        } finally {
          btnSearch1N.disabled = false;
        }
      });
    }

    const btnCompare11 = document.getElementById('btnFaceCompare11');
    if (btnCompare11) {
      btnCompare11.addEventListener('click', async () => {
        const f1 = document.getElementById('inpFaceSearchFile1')?.files?.[0];
        const f2 = document.getElementById('inpFaceSearchFile2')?.files?.[0];
        const resBox = document.getElementById('wlFaceSearchResultBox');
        if (!f1 || !f2) {
          toast('กรุณาเลือกรูปทั้งช่องที่ 1 และช่องที่ 2 เพื่อเปรียบเทียบ 1:1', true);
          return;
        }
        try {
          btnCompare11.disabled = true;
          if (resBox) resBox.textContent = 'กำลังเปรียบเทียบอัตลักษณ์ใบหน้า 512 มิติทั้ง 2 รูป…';
          const [b1, b2] = await Promise.all([readFileAsDataUrl(f1), readFileAsDataUrl(f2)]);
          const res = await fetch('/api/watchlist/faces/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image1_b64: b1, image2_b64: b2 }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.detail || data.error || ('HTTP ' + res.status));
          const col = data.is_match ? '#34d399' : '#fb5b78';
          resBox.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
              <img src="${data.face1_crop || ''}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid ${col};">
              <span style="font-weight:700; color:${col};">VS</span>
              <img src="${data.face2_crop || ''}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid ${col};">
              <div style="flex:1; min-width:180px;">
                <div style="font-weight:700; color:${col};">${data.is_match ? '✅ เป็นบุคคลคนเดียวกัน (MATCH)' : '❌ คนละบุคคล (NOT MATCH)'}</div>
                <div style="font-size:12px; color:#cbd5e1;">ความคล้ายคลึง: <b>${data.similarity_percent}%</b> (Cosine: ${data.cosine_similarity}) • ใช้เวลา ${data.latency_ms} ms</div>
              </div>
            </div>
          `;
        } catch (err) {
          if (resBox) resBox.textContent = 'เปรียบเทียบไม่สำเร็จ: ' + (err.message || err);
        } finally {
          btnCompare11.disabled = false;
        }
      });
    }
  });
})();
