/**
 * SLOTH × BPP-VMS: Tactical Drone & QCS Ground Control Station (GCS) Controller
 * Incident 2.192 (v2) — Redesigned with BPP-VMS Cyber Purple Glassmorphism
 * and 100% Crisp Vector SVG Icons matching the web & native application theme.
 */
(function () {
  'use strict';

  const API_BASE = '/api/config';
  let modalEl = null;
  let activeTab = 'fleet'; // 'fleet' | 'map' | 'qcs'
  let dronesList = [];
  let tunnelInfo = null;
  let selectedDroneId = null;
  let pollTimer = null;
  let leafletMap = null;
  let droneMarkers = {};
  let dronePaths = {};
  let followDrone = true;
  let currentLens = 'normal';
  let currentZoom = 1;
  let currentQuality = 0;

  // Crisp Vector SVG Icons (Lucide / BPP-VMS Cyber Vector Standard)
  const ICONS = {
    drone: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 10h4v4h-4z"/><path d="M10 10 6.5 6.5"/><path d="M14 10 17.5 6.5"/><path d="M10 14 6.5 17.5"/><path d="M14 14 17.5 17.5"/><circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/></svg>`,
    droneLg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 10h4v4h-4z"/><path d="M10 10 6.5 6.5"/><path d="M14 10 17.5 6.5"/><path d="M10 14 6.5 17.5"/><path d="M14 14 17.5 17.5"/><circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/></svg>`,
    list: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 8h10"/><path d="M7 12h10"/><path d="M7 16h6"/></svg>`,
    radar: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/><circle cx="12" cy="12" r="3"/></svg>`,
    link: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    wifi: `<svg class="dq-svg dq-text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/></svg>`,
    globe: `<svg class="dq-svg dq-text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
    shield: `<svg class="dq-svg dq-text-violet" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`,
    zap: `<svg class="dq-svg dq-text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    copy: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
    refresh: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
    plus: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    play: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3" fill="currentColor" fill-opacity="0.2"/></svg>`,
    takeoff: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22h20"/><path d="M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z"/></svg>`,
    stop: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="5" y="5" rx="2" fill="currentColor" fill-opacity="0.25"/></svg>`,
    sliders: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/></svg>`,
    qr: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>`,
    trash: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
    altitude: `<svg class="dq-svg dq-text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>`,
    battery: `<svg class="dq-svg dq-text-emerald" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="10" x="2" y="7" rx="2" ry="2"/><line x1="22" x2="22" y1="11" y2="13"/><line x1="6" x2="6" y1="11" y2="13"/><line x1="10" x2="10" y1="11" y2="13"/><line x1="14" x2="14" y1="11" y2="13"/></svg>`,
    speed: `<svg class="dq-svg dq-text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>`,
    compass: `<svg class="dq-svg dq-text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
    mapPin: `<svg class="dq-svg dq-text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
    camera: `<svg class="dq-svg dq-text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
    flame: `<svg class="dq-svg dq-text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
    zoomIn: `<svg class="dq-svg dq-text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></svg>`,
    crosshair: `<svg class="dq-svg dq-text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>`,
    signal: `<svg class="dq-svg dq-text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/></svg>`,
    book: `<svg class="dq-svg dq-text-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    save: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
    close: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    eraser: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`,
    arrowDown: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>`,
    arrowDownRight: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 7 10 10"/><path d="M17 7v10H7"/></svg>`,
    arrowRight: `<svg class="dq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`
  };

  function notify(msg, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
      return;
    }
    console.log(`[DroneQCS:${type}]`, msg);
  }

  async function apiFetch(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const token = localStorage.getItem('bpp_session_token') || localStorage.getItem('token') || '';
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${API_BASE}${path}`, Object.assign({}, options, {
      headers,
      credentials: 'same-origin'
    }));
    if (!res.ok) {
      let errText = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        errText = data.detail || data.error || errText;
      } catch (_) {}
      throw new Error(errText);
    }
    return res.json();
  }

  function copyText(text, label = 'คัดลอกสำเร็จ') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => notify(`${label}: ${text}`, 'success'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      notify(`${label}: ${text}`, 'success');
    }
  }

  // Deterministic visual QR matrix SVG generator with BPP-VMS dark purple modules
  function renderVisualQrSvg(text, size = 148) {
    let hash = 2166136261;
    const str = String(text || 'SLOTH-BPP215');
    const cells = 21;
    const grid = Array.from({ length: cells }, () => Array(cells).fill(false));

    function drawFinder(r0, c0) {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const border = r === 0 || r === 6 || c === 0 || c === 6;
          const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[r0 + r][c0 + c] = border || inner;
        }
      }
    }
    drawFinder(0, 0);
    drawFinder(0, cells - 7);
    drawFinder(cells - 7, 0);

    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        const inFinder =
          (r < 8 && c < 8) ||
          (r < 8 && c >= cells - 8) ||
          (r >= cells - 8 && c < 8);
        if (inFinder) continue;
        const ch = str.charCodeAt((r * cells + c) % str.length);
        hash ^= ch + ((r * 31) ^ (c * 17));
        hash = Math.imul(hash, 16777619);
        grid[r][c] = (Math.abs(hash) % 10) < 5;
      }
    }

    const cellPx = size / cells;
    let rects = '';
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        if (grid[r][c]) {
          rects += `<rect x="${(c * cellPx).toFixed(1)}" y="${(r * cellPx).toFixed(1)}" width="${(cellPx + 0.3).toFixed(1)}" height="${(cellPx + 0.3).toFixed(1)}" fill="#16112c"/>`;
        }
      }
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="background:#f8fafc;padding:8px;border-radius:11px;border:2px solid rgba(168,85,247,0.55);box-shadow:0 6px 20px rgba(124,58,237,0.3);">${rects}</svg>`;
  }

  function injectStyles() {
    if (document.getElementById('droneQcsStyles')) return;
    const style = document.createElement('style');
    style.id = 'droneQcsStyles';
    style.textContent = `
      .dq-svg {
        width: 15px;
        height: 15px;
        flex-shrink: 0;
        vertical-align: middle;
      }
      .dq-text-purple { color: #c084fc !important; stroke: #c084fc !important; }
      .dq-text-violet { color: #a855f7 !important; stroke: #a855f7 !important; }
      .dq-text-cyan   { color: #38bdf8 !important; stroke: #38bdf8 !important; }
      .dq-text-emerald{ color: #34e2a8 !important; stroke: #34e2a8 !important; }
      .dq-text-amber  { color: #fbbf24 !important; stroke: #fbbf24 !important; }
      .dq-text-rose   { color: #fb5b78 !important; stroke: #fb5b78 !important; }

      .dq-overlay {
        position: fixed;
        inset: 0;
        background: rgba(6, 7, 15, 0.86);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        z-index: 9998;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 14px;
        font-family: var(--font-body, "Noto Sans Thai", "Leelawadee UI", sans-serif);
      }
      .dq-overlay.open {
        display: flex;
      }
      .dq-modal {
        width: min(1460px, 98vw);
        height: min(900px, 93vh);
        background: linear-gradient(180deg, rgba(22, 17, 44, 0.98) 0%, rgba(10, 8, 22, 0.99) 100%);
        border: 1px solid rgba(168, 85, 247, 0.45);
        border-radius: 16px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85), 0 0 36px rgba(124, 58, 237, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: #eef0f8;
      }
      .dq-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        background: linear-gradient(180deg, rgba(35, 27, 66, 0.88), rgba(18, 14, 38, 0.65));
        border-bottom: 1px solid rgba(168, 85, 247, 0.32);
        gap: 12px;
        flex-wrap: wrap;
      }
      .dq-title-wrap {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .dq-icon-tile {
        width: 42px;
        height: 42px;
        border-radius: 11px;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at 50% 40%, rgba(168, 85, 247, 0.28), rgba(124, 58, 237, 0.12));
        border: 1px solid rgba(168, 85, 247, 0.45);
        box-shadow: 0 0 14px rgba(168, 85, 247, 0.25);
        flex-shrink: 0;
      }
      .dq-badge-live {
        background: rgba(168, 85, 247, 0.18);
        color: #e9d5ff;
        border: 1px solid rgba(192, 132, 252, 0.45);
        font-size: 11px;
        font-weight: 600;
        padding: 2px 9px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .dq-tabs {
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
        align-items: center;
      }
      .dq-tab-btn {
        background: rgba(10, 8, 22, 0.65);
        color: #9aa0bd;
        border: 1px solid rgba(168, 85, 247, 0.24);
        padding: 8px 14px;
        border-radius: 10px;
        font-family: var(--font-ui, inherit);
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        transition: all 0.15s ease;
      }
      .dq-tab-btn:hover {
        color: #eef0f8;
        border-color: rgba(168, 85, 247, 0.55);
        background: rgba(168, 85, 247, 0.14);
      }
      .dq-tab-btn.active {
        background: linear-gradient(150deg, rgba(168, 85, 247, 0.38), rgba(124, 58, 237, 0.28));
        color: #eef0f8;
        border-color: #c084fc;
        box-shadow: inset 0 0 0 1px rgba(192, 132, 252, 0.45), 0 0 16px rgba(168, 85, 247, 0.28);
      }
      .dq-tab-btn.active .dq-svg {
        stroke: #c084fc;
      }
      .dq-body {
        flex: 1;
        overflow-y: auto;
        padding: 18px 20px;
      }
      .dq-banner-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
        gap: 12px;
        margin-bottom: 16px;
      }
      .dq-channel-card {
        background: linear-gradient(180deg, rgba(28, 22, 54, 0.65), rgba(14, 11, 28, 0.78));
        border: 1px solid rgba(168, 85, 247, 0.28);
        border-radius: 12px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 7px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      }
      .dq-channel-title {
        font-size: 12px;
        font-weight: 700;
        color: #e9d5ff;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      .dq-code-row {
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(6, 7, 15, 0.78);
        border: 1px solid rgba(168, 85, 247, 0.24);
        padding: 6px 9px;
        border-radius: 8px;
        font-family: var(--font-mono, Consolas, monospace);
        font-size: 12px;
        color: #eef0f8;
        overflow-x: auto;
      }
      .dq-btn {
        background: linear-gradient(150deg, #7c3aed, #a855f7);
        color: #ffffff;
        border: 1px solid rgba(192, 132, 252, 0.65);
        padding: 7px 13px;
        border-radius: 9px;
        font-family: var(--font-ui, inherit);
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.15s ease;
      }
      .dq-btn:hover {
        filter: brightness(1.12);
        box-shadow: 0 0 12px rgba(168, 85, 247, 0.35);
      }
      .dq-btn.secondary {
        background: rgba(10, 8, 22, 0.68);
        border: 1px solid rgba(168, 85, 247, 0.28);
        color: #cbd5e1;
      }
      .dq-btn.secondary:hover {
        border-color: #c084fc;
        color: #eef0f8;
        background: rgba(168, 85, 247, 0.2);
      }
      .dq-btn.success {
        background: linear-gradient(150deg, #059669, #10b981);
        border-color: rgba(52, 226, 168, 0.6);
      }
      .dq-btn.warn {
        background: linear-gradient(150deg, #b45309, #d97706);
        border-color: rgba(251, 191, 36, 0.65);
      }
      .dq-btn.danger {
        background: rgba(251, 91, 120, 0.16);
        border: 1px solid rgba(251, 91, 120, 0.45);
        color: #fb5b78;
      }
      .dq-btn.danger:hover {
        background: rgba(251, 91, 120, 0.3);
        color: #ffffff;
      }
      .dq-table {
        width: 100%;
        border-collapse: collapse;
        background: rgba(14, 11, 28, 0.78);
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid rgba(168, 85, 247, 0.25);
      }
      .dq-table th, .dq-table td {
        padding: 11px 13px;
        text-align: left;
        border-bottom: 1px solid rgba(168, 85, 247, 0.14);
        font-size: 13px;
      }
      .dq-table th {
        background: rgba(28, 22, 54, 0.85);
        color: #c084fc;
        font-weight: 700;
        font-size: 12px;
        letter-spacing: 0.3px;
      }
      .dq-table tr:hover td {
        background: rgba(168, 85, 247, 0.06);
      }
      .dq-map-layout {
        display: grid;
        grid-template-columns: 1fr 415px;
        gap: 16px;
        height: calc(93vh - 130px);
        min-height: 560px;
      }
      @media (max-width: 1024px) {
        .dq-map-layout {
          grid-template-columns: 1fr;
          height: auto;
        }
      }
      .dq-hud-panel {
        background: linear-gradient(180deg, rgba(28, 22, 54, 0.78), rgba(14, 11, 28, 0.92));
        border: 1px solid rgba(168, 85, 247, 0.35);
        border-radius: 14px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      }
      .dq-telemetry-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      .dq-stat-box {
        background: rgba(6, 7, 15, 0.75);
        border: 1px solid rgba(168, 85, 247, 0.24);
        border-radius: 10px;
        padding: 9px 11px;
      }
      .dq-stat-label {
        font-size: 11px;
        color: #9aa0bd;
        display: flex;
        align-items: center;
        gap: 5px;
        margin-bottom: 2px;
      }
      .dq-stat-val {
        font-size: 17px;
        font-weight: 700;
        color: #e9d5ff;
        font-family: var(--font-mono, Consolas, monospace);
      }
      .dq-guide-card {
        background: linear-gradient(180deg, rgba(28, 22, 54, 0.65), rgba(14, 11, 28, 0.82));
        border: 1px solid rgba(168, 85, 247, 0.28);
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 14px;
        line-height: 1.65;
      }
      .dq-guide-card h4 {
        margin: 0 0 10px 0;
        color: #c084fc;
        font-size: 15px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dq-input {
        width: 100%;
        background: rgba(10, 8, 22, 0.85);
        border: 1px solid rgba(168, 85, 247, 0.32);
        color: #eef0f8;
        padding: 8px 11px;
        border-radius: 8px;
        font-size: 13px;
        font-family: var(--font-body, inherit);
        box-sizing: border-box;
        outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .dq-input:focus {
        border-color: #c084fc;
        box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.2);
      }
    `;
    document.head.appendChild(style);
  }

  function buildModalDom() {
    if (modalEl) return modalEl;
    injectStyles();
    modalEl = document.createElement('div');
    modalEl.id = 'droneQcsOverlay';
    modalEl.className = 'dq-overlay';
    modalEl.innerHTML = `
      <div class="dq-modal" role="dialog" aria-label="SLOTH Drone & QCS Ground Control Station">
        <div class="dq-header">
          <div class="dq-title-wrap">
            <div class="dq-icon-tile">${ICONS.droneLg}</div>
            <div>
              <div style="font-size:16px;font-weight:700;color:#eef0f8;display:flex;align-items:center;gap:9px;letter-spacing:0.3px;">
                ศูนย์ควบคุมอากาศยานไร้คนขับและสถานีภาคพื้นดิน (Drone & QCS)
                <span class="dq-badge-live" id="dqLiveCountBadge">0 ลำ</span>
              </div>
              <div style="font-size:12px;color:#9aa0bd;margin-top:2px;">
                DJI Pilot 2 Cloud API · DJI Fly (RC 2) · Autel Enterprise · MAVLink v2 · RTMP Stream (LAN / DuckDNS / Tailscale / Bore)
              </div>
            </div>
          </div>
          <div class="dq-tabs">
            <button class="dq-tab-btn active" data-tab="fleet">${ICONS.list} 1. จัดการโดรน & ลิงก์ RTMP</button>
            <button class="dq-tab-btn" data-tab="map">${ICONS.radar} 2. แผนที่การบิน & QCS HUD</button>
            <button class="dq-tab-btn" data-tab="qcs">${ICONS.link} 3. จับคู่รีโมท & คู่มือใช้งาน</button>
            <button class="dq-btn secondary" id="dqCloseBtn" title="ปิดหน้าต่าง">${ICONS.close} ปิด</button>
          </div>
        </div>
        <div class="dq-body" id="dqBodyContainer"></div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.querySelector('#dqCloseBtn').addEventListener('click', closeDroneQcsModal);
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeDroneQcsModal();
    });

    modalEl.querySelectorAll('.dq-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab');
        modalEl.querySelectorAll('.dq-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
        renderActiveTab();
      });
    });

    return modalEl;
  }

  async function refreshData() {
    try {
      const [dronesRes, tunnelRes] = await Promise.all([
        apiFetch('/drones'),
        apiFetch('/drones/tunnel')
      ]);
      dronesList = Array.isArray(dronesRes) ? dronesRes : [];
      tunnelInfo = tunnelRes || {};
      if (!selectedDroneId && dronesList.length > 0) {
        selectedDroneId = dronesList[0].id;
      }
      const badge = document.getElementById('dqLiveCountBadge');
      if (badge) {
        const onlineCount = dronesList.filter((d) => d.status === 'online').length;
        badge.textContent = `${dronesList.length} ลำ (กำลังบิน ${onlineCount})`;
      }
    } catch (err) {
      console.warn('[DroneQCS] refreshData error:', err);
    }
  }

  function renderActiveTab() {
    const body = document.getElementById('dqBodyContainer');
    if (!body) return;
    if (activeTab === 'fleet') {
      renderFleetTab(body);
    } else if (activeTab === 'map') {
      renderMapHudTab(body);
    } else if (activeTab === 'qcs') {
      renderQcsAndGuideTab(body);
    }
  }

  function renderFleetTab(container) {
    const lanUrl = (tunnelInfo && tunnelInfo.lan_rtmp_base) || 'rtmp://192.168.1.200:1935/live';
    const duckUrl = (tunnelInfo && tunnelInfo.duckdns_rtmp_base) || 'rtmp://bpp215.duckdns.org:1935/live';
    const tsUrl = (tunnelInfo && tunnelInfo.tailscale_rtmp_base) || lanUrl;
    const boreUrl = (tunnelInfo && tunnelInfo.url) || 'กดปุ่ม "เปิด Bore Tunnel" เมื่อต้องการทะลุ 4G/5G CGNAT';

    const rowsHtml = dronesList.length === 0
      ? `<tr><td colspan="7" style="text-align:center;padding:28px;color:#9aa0bd;">ยังไม่มีโดรนในระบบ — กดปุ่ม <b>"เพิ่มโดรนใหม่"</b> ด้านบนเพื่อสร้างลิงก์ RTMP และเพิ่มเข้าตารางกล้องอัตโนมัติ</td></tr>`
      : dronesList.map((d) => {
          const t = d.telemetry || {};
          const isOnline = d.status === 'online';
          const isSim = !!d.simulating;
          const statusBadge = isOnline
            ? `<span style="background:rgba(52,226,168,0.16);border:1px solid rgba(52,226,168,0.45);color:#34e2a8;padding:3px 9px;border-radius:99px;font-size:11.5px;font-weight:600;display:inline-flex;align-items:center;gap:5px;"><span style="width:7px;height:7px;border-radius:50%;background:#34e2a8;box-shadow:0 0 6px #34e2a8;"></span>กำลังบิน ${isSim ? '(จำลอง)' : '(สด)'}</span>`
            : `<span style="background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.28);color:#9aa0bd;padding:3px 9px;border-radius:99px;font-size:11.5px;display:inline-flex;align-items:center;gap:5px;"><span style="width:7px;height:7px;border-radius:50%;background:#6b7099;"></span>สแตนด์บาย</span>`;
          const fullLanRtmp = `${lanUrl}/${d.stream_key}`;
          const fullDuckRtmp = `${duckUrl}/${d.stream_key}`;
          return `
            <tr>
              <td>
                <div style="font-weight:700;color:#eef0f8;font-size:13.5px;display:flex;align-items:center;gap:7px;">
                  <span class="dq-text-purple">${ICONS.drone}</span> ${d.name || d.id}
                </div>
                <div style="font-size:11.5px;color:#9aa0bd;margin-top:2px;">รหัสกล้อง: <code style="color:#c084fc;">${d.camera_id || ('cam_drone_' + d.id)}</code></div>
              </td>
              <td>
                <span style="text-transform:uppercase;font-weight:700;color:#c084fc;">${d.vendor || 'dji'}</span>
                <div style="font-size:11.5px;color:#9aa0bd;">${d.model || 'Enterprise'}</div>
              </td>
              <td>${statusBadge}</td>
              <td>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <code style="background:rgba(6,7,15,0.85);border:1px solid rgba(168,85,247,0.25);padding:4px 8px;border-radius:6px;color:#e9d5ff;font-size:12px;">${fullLanRtmp}</code>
                  <button class="dq-btn secondary" style="padding:4px 8px;font-size:11px;" data-copy="${fullLanRtmp}">${ICONS.copy} LAN</button>
                  <button class="dq-btn secondary" style="padding:4px 8px;font-size:11px;" data-copy="${fullDuckRtmp}">${ICONS.copy} 4G</button>
                </div>
              </td>
              <td>
                <div style="font-size:12px;line-height:1.55;color:#cbd5e1;">
                  <span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;">${ICONS.altitude} <b>${Number(t.altitude || 0).toFixed(1)} ม.</b></span>
                  <span style="display:inline-flex;align-items:center;gap:4px;">${ICONS.battery} <b>${t.battery != null ? t.battery : 100}%</b></span><br>
                  <span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;">${ICONS.speed} <b>${Number(t.speed || 0).toFixed(1)} m/s</b></span>
                  <span style="display:inline-flex;align-items:center;gap:4px;">${ICONS.compass} <b>${Math.round(t.heading || 0)}°</b></span>
                </div>
              </td>
              <td>
                <div style="font-size:12px;color:#cbd5e1;font-family:var(--font-mono,monospace);display:flex;align-items:center;gap:5px;">
                  ${ICONS.mapPin} ${Number(d.lat || 14.6431).toFixed(5)}, ${Number(d.lng || 103.0855).toFixed(5)}
                </div>
              </td>
              <td>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                  <button class="dq-btn" data-action="watch" data-id="${d.id}" title="เปิดดูภาพสดจากกล้องโดรน">${ICONS.play} ดูภาพสด</button>
                  <button class="dq-btn ${isSim ? 'warn' : 'success'}" data-action="simulate" data-id="${d.id}" title="จำลองการบินลาดตระเวนรอบฐานเพื่อทดสอบแผนที่และ Telemetry">
                    ${isSim ? `${ICONS.stop} หยุดบินจำลอง` : `${ICONS.takeoff} ทดสอบบินจำลอง`}
                  </button>
                  <button class="dq-btn secondary" data-action="control" data-id="${d.id}" title="เปิดแผนที่และแผงควบคุมเลนส์/ซูม QCS">${ICONS.sliders} ควบคุม QCS</button>
                  <button class="dq-btn secondary" data-action="qr" data-id="${d.id}" title="ดู QR Code และลิงก์เชื่อมต่อทั้งหมด">${ICONS.qr} ลิงก์/QR</button>
                  <button class="dq-btn danger" data-action="delete" data-id="${d.id}" title="ลบโดรน">${ICONS.trash}</button>
                </div>
              </td>
            </tr>
          `;
        }).join('');

    container.innerHTML = `
      <div class="dq-banner-grid">
        <div class="dq-channel-card">
          <div class="dq-channel-title">
            <span style="display:inline-flex;align-items:center;gap:6px;">${ICONS.wifi} ช่องทางที่ 1: วง LAN / Wi-Fi หน่วย</span>
            <span style="color:#34e2a8;font-size:11px;">พร้อมใช้งานทันที</span>
          </div>
          <div class="dq-code-row">
            <span style="flex:1;">${lanUrl}/&lt;StreamKey&gt;</span>
            <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${lanUrl}">${ICONS.copy} คัดลอก</button>
          </div>
          <div style="font-size:11.5px;color:#9aa0bd;">ใช้เมื่อรีโมทโดรนจับ Wi-Fi วงเดียวกับเซิร์ฟเวอร์ (ความหน่วงต่ำสุด &lt; 0.5 วินาที)</div>
        </div>

        <div class="dq-channel-card">
          <div class="dq-channel-title">
            <span style="display:inline-flex;align-items:center;gap:6px;">${ICONS.globe} ช่องทางที่ 2: ภาคสนาม 4G/5G (DuckDNS)</span>
            <span style="color:#c084fc;font-size:11px;">ซิมการ์ด / Hotspot</span>
          </div>
          <div class="dq-code-row">
            <span style="flex:1;">${duckUrl}/&lt;StreamKey&gt;</span>
            <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${duckUrl}">${ICONS.copy} คัดลอก</button>
          </div>
          <div style="font-size:11.5px;color:#9aa0bd;">ใช้เมื่อบินนอกที่ตั้งผ่านซิม 4G/5G (ต้อง Forward Port TCP 1935 ที่เราเตอร์)</div>
        </div>

        <div class="dq-channel-card">
          <div class="dq-channel-title">
            <span style="display:inline-flex;align-items:center;gap:6px;">${ICONS.shield} ช่องทางที่ 3: เครือข่าย Tailscale VPN</span>
            <span style="color:#a855f7;font-size:11px;">เข้ารหัสปลอดภัย</span>
          </div>
          <div class="dq-code-row">
            <span style="flex:1;">${tsUrl}/&lt;StreamKey&gt;</span>
            <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${tsUrl}">${ICONS.copy} คัดลอก</button>
          </div>
          <div style="font-size:11.5px;color:#9aa0bd;">ใช้เมื่อรีโมทหรือมือถือแชร์เน็ตเปิดแอป Tailscale เชื่อมต่อวง VPN เดียวกัน</div>
        </div>

        <div class="dq-channel-card">
          <div class="dq-channel-title">
            <span style="display:inline-flex;align-items:center;gap:6px;">${ICONS.zap} ช่องทางที่ 4: Bore Cloud Tunnel</span>
            <button class="dq-btn secondary" id="dqStartBoreBtn" style="padding:3px 8px;font-size:11px;">${ICONS.refresh} เปิด Bore Tunnel</button>
          </div>
          <div class="dq-code-row">
            <span style="flex:1;">${boreUrl}</span>
            ${tunnelInfo && tunnelInfo.url ? `<button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${tunnelInfo.url}">${ICONS.copy} คัดลอก</button>` : ''}
          </div>
          <div style="font-size:11.5px;color:#9aa0bd;">ใช้เมื่อออกพื้นที่แล้วไม่ได้ตั้งค่า Port Forward ที่เราเตอร์</div>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10px;">
        <div style="font-size:14.5px;font-weight:700;color:#eef0f8;display:flex;align-items:center;gap:8px;">
          <span class="dq-text-purple">${ICONS.drone}</span> รายการฝูงบินโดรนยุทธวิธี (Tactical Drone Fleet) — สร้างกล้องวงจรปิด <code style="color:#c084fc;">cam_drone_*</code> อัตโนมัติ
        </div>
        <div style="display:flex;gap:8px;">
          <button class="dq-btn secondary" id="dqRefreshFleetBtn">${ICONS.refresh} รีเฟรชสถานะ</button>
          <button class="dq-btn" id="dqAddDroneBtn">${ICONS.plus} เพิ่มโดรนใหม่ (1-Click Auto Camera)</button>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table class="dq-table">
          <thead>
            <tr>
              <th>ชื่อโดรน / รหัสกล้อง</th>
              <th>ยี่ห้อ / รุ่น</th>
              <th>สถานะการบิน</th>
              <th>RTMP Live Stream URL (ใส่ในรีโมท DJI Pilot 2 / DJI RC 2)</th>
              <th>ข้อมูลการบิน (Telemetry)</th>
              <th>พิกัด GPS ล่าสุด</th>
              <th>เครื่องมือจัดการ / ควบคุม</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <div id="dqSubModalArea" style="margin-top:16px;"></div>
    `;

    container.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => copyText(btn.getAttribute('data-copy')));
    });

    const refreshBtn = container.querySelector('#dqRefreshFleetBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        await refreshData();
        renderFleetTab(container);
        notify('รีเฟรชข้อมูลโดรนเรียบร้อยแล้ว', 'success');
      });
    }

    const boreBtn = container.querySelector('#dqStartBoreBtn');
    if (boreBtn) {
      boreBtn.addEventListener('click', async () => {
        boreBtn.disabled = true;
        boreBtn.innerHTML = `${ICONS.refresh} กำลังเปิด Tunnel...`;
        try {
          tunnelInfo = await apiFetch('/drones/tunnel/start', { method: 'POST', body: '{}' });
          renderFleetTab(container);
          notify('อัปเดตช่องทาง RTMP Tunnel สำเร็จ', 'success');
        } catch (e) {
          notify(`เปิด Tunnel ไม่สำเร็จ: ${e.message}`, 'error');
          boreBtn.disabled = false;
          boreBtn.innerHTML = `${ICONS.refresh} เปิด Bore Tunnel`;
        }
      });
    }

    const addBtn = container.querySelector('#dqAddDroneBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => showAddDroneForm(container.querySelector('#dqSubModalArea')));
    }

    container.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        const drone = dronesList.find((x) => x.id === id);
        if (!drone) return;

        if (action === 'watch' || action === 'control') {
          selectedDroneId = id;
          activeTab = 'map';
          modalEl.querySelectorAll('.dq-tab-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === 'map'));
          renderActiveTab();
        } else if (action === 'simulate') {
          try {
            const res = await apiFetch(`/drones/${id}/simulate`, {
              method: 'POST',
              body: JSON.stringify({ enable: !drone.simulating })
            });
            notify(res.simulating ? `เริ่มจำลองการบินลาดตระเวนของ "${drone.name}" แล้ว` : `หยุดการบินจำลองของ "${drone.name}" แล้ว`, 'success');
            await refreshData();
            renderFleetTab(container);
          } catch (e) {
            notify(`จำลองการบินไม่สำเร็จ: ${e.message}`, 'error');
          }
        } else if (action === 'qr') {
          showDroneQrCard(container.querySelector('#dqSubModalArea'), drone);
        } else if (action === 'delete') {
          if (!confirm(`ยืนยันการลบโดรน "${drone.name}" และกล้อง ${drone.camera_id} ออกจากระบบ?`)) return;
          try {
            await apiFetch(`/drones/${id}`, { method: 'DELETE' });
            notify(`ลบโดรน "${drone.name}" เรียบร้อยแล้ว`, 'success');
            await refreshData();
            renderFleetTab(container);
          } catch (e) {
            notify(`ลบโดรนไม่สำเร็จ: ${e.message}`, 'error');
          }
        }
      });
    });
  }

  function showAddDroneForm(targetEl) {
    if (!targetEl) return;
    targetEl.innerHTML = `
      <div style="background:linear-gradient(180deg,rgba(28,22,54,0.92),rgba(14,11,28,0.96));border:1px solid rgba(192,132,252,0.55);border-radius:12px;padding:16px;box-shadow:0 8px 28px rgba(0,0,0,0.5);">
        <div style="font-size:14.5px;font-weight:700;color:#c084fc;margin-bottom:12px;display:flex;align-items:center;gap:8px;">
          ${ICONS.plus} เพิ่มโดรนยุทธวิธีใหม่ (สร้างกล้องสดบน Dashboard + แผนที่ยุทธวิธีอัตโนมัติ)
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;">
          <div>
            <label style="font-size:12px;color:#9aa0bd;display:block;margin-bottom:4px;">ชื่อโดรน / นามเรียกขาน *</label>
            <input id="dqNewName" class="dq-input" placeholder="เช่น โดรนลาดตระเวน ตชด.215 ลำที่ 1" value="โดรนลาดตระเวน ตชด.215 #${dronesList.length + 1}" />
          </div>
          <div>
            <label style="font-size:12px;color:#9aa0bd;display:block;margin-bottom:4px;">ยี่ห้อ / โปรโตคอล (Vendor)</label>
            <select id="dqNewVendor" class="dq-input">
              <option value="dji">DJI Enterprise / DJI Fly (Pilot 2 / RC 2)</option>
              <option value="autel">Autel Robotics (EVO II / Dragonfish)</option>
              <option value="mavlink">MAVLink v2 / ArduPilot / PX4</option>
              <option value="rtmp">Generic RTMP Streamer (Litchi / Dronelink)</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:#9aa0bd;display:block;margin-bottom:4px;">รุ่นอากาศยาน (Model)</label>
            <input id="dqNewModel" class="dq-input" placeholder="เช่น DJI Mavic 3 Thermal (M3T)" value="DJI Mavic 3 Enterprise" />
          </div>
          <div>
            <label style="font-size:12px;color:#9aa0bd;display:block;margin-bottom:4px;">Stream Key (ภาษาอังกฤษ/ตัวเลข)</label>
            <input id="dqNewKey" class="dq-input" placeholder="เช่น bpp215_drone1" value="bpp215_drone${dronesList.length + 1}" />
          </div>
          <div>
            <label style="font-size:12px;color:#9aa0bd;display:block;margin-bottom:4px;">ละติจูดฐานบิน (Lat)</label>
            <input id="dqNewLat" class="dq-input" type="number" step="0.00001" value="14.64310" />
          </div>
          <div>
            <label style="font-size:12px;color:#9aa0bd;display:block;margin-bottom:4px;">ลองจิจูดฐานบิน (Lng)</label>
            <input id="dqNewLng" class="dq-input" type="number" step="0.00001" value="103.08550" />
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button class="dq-btn secondary" id="dqCancelAddBtn">${ICONS.close} ยกเลิก</button>
          <button class="dq-btn" id="dqConfirmAddBtn">${ICONS.save} บันทึกและสร้างลิงก์ RTMP ทันที</button>
        </div>
      </div>
    `;
    targetEl.querySelector('#dqCancelAddBtn').addEventListener('click', () => {
      targetEl.innerHTML = '';
    });
    targetEl.querySelector('#dqConfirmAddBtn').addEventListener('click', async () => {
      const name = targetEl.querySelector('#dqNewName').value.trim();
      const vendor = targetEl.querySelector('#dqNewVendor').value;
      const model = targetEl.querySelector('#dqNewModel').value.trim();
      const stream_key = targetEl.querySelector('#dqNewKey').value.trim();
      const lat = parseFloat(targetEl.querySelector('#dqNewLat').value) || 14.6431;
      const lng = targetEl.querySelector('#dqNewLng').value ? parseFloat(targetEl.querySelector('#dqNewLng').value) : 103.0855;
      if (!name) {
        notify('กรุณาระบุชื่อโดรน', 'error');
        return;
      }
      try {
        const res = await apiFetch('/drones', {
          method: 'POST',
          body: JSON.stringify({ name, vendor, model, stream_key, lat, lng })
        });
        notify(`เพิ่มโดรน "${name}" และลงทะเบียนกล้อง ${res.drone.camera_id} สำเร็จ`, 'success');
        await refreshData();
        renderActiveTab();
        if (res && res.drone) {
          const sub = document.getElementById('dqSubModalArea');
          if (sub) showDroneQrCard(sub, res.drone);
        }
      } catch (e) {
        notify(`เพิ่มโดรนไม่สำเร็จ: ${e.message}`, 'error');
      }
    });
  }

  function showDroneQrCard(targetEl, drone) {
    if (!targetEl || !drone) return;
    const lanUrl = `${(tunnelInfo && tunnelInfo.lan_rtmp_base) || 'rtmp://192.168.1.200:1935/live'}/${drone.stream_key}`;
    const duckUrl = `${(tunnelInfo && tunnelInfo.duckdns_rtmp_base) || 'rtmp://bpp215.duckdns.org:1935/live'}/${drone.stream_key}`;
    const qrSvg = renderVisualQrSvg(lanUrl, 148);
    targetEl.innerHTML = `
      <div style="background:linear-gradient(180deg,rgba(28,22,54,0.95),rgba(14,11,28,0.98));border:1px solid rgba(192,132,252,0.55);border-radius:12px;padding:16px;display:flex;gap:18px;align-items:center;flex-wrap:wrap;box-shadow:0 8px 28px rgba(0,0,0,0.5);">
        <div>${qrSvg}</div>
        <div style="flex:1;min-width:280px;">
          <div style="font-size:15px;font-weight:700;color:#c084fc;margin-bottom:6px;display:flex;align-items:center;gap:7px;">
            ${ICONS.qr} ข้อมูลการตั้งค่าสตรีมสดสำหรับ: ${drone.name} (${drone.camera_id})
          </div>
          <div style="font-size:12.5px;color:#cbd5e1;margin-bottom:8px;">
            นำค่าด้านล่างไปกรอกในแอป <b>DJI Pilot 2</b> หรือ <b>DJI Fly (RC 2)</b> &rarr; เมนู <b>Transmission</b> &rarr; <b>Live Streaming Platforms</b> &rarr; <b>RTMP</b>:
          </div>
          <div style="display:grid;gap:6px;font-size:12.5px;">
            <div class="dq-code-row">
              <span style="color:#9aa0bd;width:155px;">1. ลิงก์เต็ม (วง LAN):</span>
              <strong style="flex:1;color:#34e2a8;">${lanUrl}</strong>
              <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${lanUrl}">${ICONS.copy} คัดลอก</button>
            </div>
            <div class="dq-code-row">
              <span style="color:#9aa0bd;width:155px;">2. ลิงก์เต็ม (4G/5G):</span>
              <strong style="flex:1;color:#c084fc;">${duckUrl}</strong>
              <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${duckUrl}">${ICONS.copy} คัดลอก</button>
            </div>
            <div class="dq-code-row">
              <span style="color:#9aa0bd;width:155px;">3. Stream Key แยก:</span>
              <strong style="flex:1;color:#fbbf24;">${drone.stream_key}</strong>
              <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${drone.stream_key}">${ICONS.copy} คัดลอก</button>
            </div>
            <div class="dq-code-row">
              <span style="color:#9aa0bd;width:155px;">4. API ส่งพิกัด GPS:</span>
              <strong style="flex:1;color:#eef0f8;">POST ${window.location.origin}/api/config/drones/${drone.id}/telemetry</strong>
              <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${window.location.origin}/api/config/drones/${drone.id}/telemetry">${ICONS.copy} คัดลอก</button>
            </div>
          </div>
        </div>
        <div>
          <button class="dq-btn secondary" id="dqCloseQrBtn">${ICONS.close} ปิดการ์ด</button>
        </div>
      </div>
    `;
    targetEl.querySelectorAll('[data-copy]').forEach((b) => {
      b.addEventListener('click', () => copyText(b.getAttribute('data-copy')));
    });
    targetEl.querySelector('#dqCloseQrBtn').addEventListener('click', () => {
      targetEl.innerHTML = '';
    });
  }

  function renderMapHudTab(container) {
    const selected = dronesList.find((d) => d.id === selectedDroneId) || dronesList[0] || null;
    if (selected) selectedDroneId = selected.id;
    const t = (selected && selected.telemetry) || {};
    const camId = selected ? (selected.camera_id || `cam_drone_${selected.id}`) : '';

    const optionsHtml = dronesList.length === 0
      ? `<option value="">-- ยังไม่มีโดรนในระบบ --</option>`
      : dronesList.map((d) => `<option value="${d.id}" ${d.id === selectedDroneId ? 'selected' : ''}>${d.name} (${d.status === 'online' ? 'กำลังบิน' : 'สแตนด์บาย'})</option>`).join('');

    container.innerHTML = `
      <div class="dq-map-layout">
        <div style="position:relative;border-radius:14px;overflow:hidden;border:1px solid rgba(168,85,247,0.38);background:#06070f;min-height:460px;">
          <div id="dqLeafletMap" style="width:100%;height:100%;min-height:460px;"></div>
          <div style="position:absolute;top:12px;left:54px;z-index:500;display:flex;gap:10px;flex-wrap:wrap;background:rgba(16,13,32,0.9);padding:8px 13px;border-radius:10px;border:1px solid rgba(168,85,247,0.4);box-shadow:0 4px 16px rgba(0,0,0,0.5);">
            <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#eef0f8;cursor:pointer;">
              <input type="checkbox" id="dqFollowCheckbox" ${followDrone ? 'checked' : ''} style="accent-color:#a855f7;" />
              ${ICONS.crosshair} ล็อกเป้าติดตามโดรนอัตโนมัติ (Follow Drone)
            </label>
            <button class="dq-btn secondary" id="dqClearTrailBtn" style="padding:4px 9px;font-size:11.5px;">${ICONS.eraser} ล้างเส้นทางบิน</button>
          </div>
        </div>

        <div class="dq-hud-panel">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <select id="dqDroneSelect" class="dq-input" style="font-weight:700;">${optionsHtml}</select>
            ${selected ? `
              <button class="dq-btn ${selected.simulating ? 'warn' : 'success'}" id="dqHudSimBtn" style="white-space:nowrap;">
                ${selected.simulating ? `${ICONS.stop} หยุดบินจำลอง` : `${ICONS.takeoff} บินจำลอง`}
              </button>
            ` : ''}
          </div>

          <!-- จอพรีวิวภาพสดจากโดรน (go2rtc stream) -->
          <div style="background:#06070f;border-radius:10px;overflow:hidden;border:1px solid rgba(168,85,247,0.35);aspect-ratio:16/9;position:relative;">
            ${selected ? `
              <iframe
                src="/go2rtc/stream.html?src=${encodeURIComponent(camId)}&mode=mse,webrtc,mp4,mjpeg"
                style="width:100%;height:100%;border:0;"
                allow="autoplay; fullscreen"
              ></iframe>
              <div style="position:absolute;top:8px;left:8px;background:rgba(10,8,22,0.82);border:1px solid rgba(168,85,247,0.4);padding:3px 8px;border-radius:6px;font-size:11px;color:#e9d5ff;pointer-events:none;display:inline-flex;align-items:center;gap:5px;">
                <span style="width:7px;height:7px;border-radius:50%;background:#34e2a8;"></span> LIVE: ${camId} (${currentLens.toUpperCase()} · ${currentZoom}x)
              </div>
            ` : `
              <div style="height:100%;display:flex;align-items:center;justify-content:center;color:#6b7099;font-size:13px;">
                ยังไม่ได้เลือกโดรน
              </div>
            `}
          </div>

          <!-- มาตรวัด Telemetry แบบเรียลไทม์ -->
          <div class="dq-telemetry-grid">
            <div class="dq-stat-box">
              <div class="dq-stat-label">${ICONS.altitude} ความสูงเหนือพื้น (Altitude)</div>
              <div class="dq-stat-val" id="dqHudAlt">${Number(t.altitude || 0).toFixed(1)} m</div>
            </div>
            <div class="dq-stat-box">
              <div class="dq-stat-label">${ICONS.battery} แบตเตอรี่ (Battery)</div>
              <div class="dq-stat-val" id="dqHudBat" style="color:#34e2a8;">${t.battery != null ? t.battery : 100}%</div>
            </div>
            <div class="dq-stat-box">
              <div class="dq-stat-label">${ICONS.speed} ความเร็ว (Ground Speed)</div>
              <div class="dq-stat-val" id="dqHudSpd">${Number(t.speed || 0).toFixed(1)} m/s</div>
            </div>
            <div class="dq-stat-box">
              <div class="dq-stat-label">${ICONS.compass} ทิศทางหัวโดรน (Heading)</div>
              <div class="dq-stat-val" id="dqHudHdg">${Math.round(t.heading || 0)}°</div>
            </div>
          </div>

          <div style="font-size:12px;color:#cbd5e1;font-family:var(--font-mono,monospace);background:rgba(6,7,15,0.75);border:1px solid rgba(168,85,247,0.22);padding:7px 10px;border-radius:8px;display:flex;align-items:center;gap:6px;" id="dqHudGps">
            ${ICONS.mapPin} <span>พิกัด GPS: ${selected ? `${Number(selected.lat || 14.6431).toFixed(6)}, ${Number(selected.lng || 103.0855).toFixed(6)}` : '-'}</span>
          </div>

          <!-- แผงควบคุมเลนส์และซูม QCS Payload Control -->
          <div style="border-top:1px solid rgba(168,85,247,0.2);padding-top:10px;">
            <div style="font-size:12.5px;font-weight:700;color:#eef0f8;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
              ${ICONS.camera} โหมดเลนส์กล้อง (QCS Camera Lens)
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
              <button class="dq-btn ${currentLens === 'normal' ? '' : 'secondary'}" data-lens="normal" style="justify-content:center;padding:6px;">ปกติ</button>
              <button class="dq-btn ${currentLens === 'wide' ? '' : 'secondary'}" data-lens="wide" style="justify-content:center;padding:6px;">มุมกว้าง</button>
              <button class="dq-btn ${currentLens === 'zoom' ? '' : 'secondary'}" data-lens="zoom" style="justify-content:center;padding:6px;">ซูมไกล</button>
              <button class="dq-btn ${currentLens === 'thermal' ? 'warn' : 'secondary'}" data-lens="thermal" style="justify-content:center;padding:6px;">${ICONS.flame} ความร้อน</button>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;color:#eef0f8;margin-bottom:6px;">
              <span style="display:flex;align-items:center;gap:6px;">${ICONS.zoomIn} ระดับการซูม (Zoom Factor)</span>
              <span style="color:#c084fc;" id="dqZoomLabel">${currentZoom}x</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:5px;">
              ${[1, 2, 5, 10, 20, 32].map((z) => `
                <button class="dq-btn ${currentZoom === z ? '' : 'secondary'}" data-zoom="${z}" style="justify-content:center;padding:5px;">${z}x</button>
              `).join('')}
            </div>
          </div>

          <div>
            <div style="font-size:12.5px;font-weight:700;color:#eef0f8;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
              ${ICONS.crosshair} ควบคุมมุมก้ม-เงย กิมบอล (Gimbal Pitch)
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
              <button class="dq-btn secondary" data-gimbal="-90" style="justify-content:center;">${ICONS.arrowDown} ก้มดิ่ง -90°</button>
              <button class="dq-btn secondary" data-gimbal="-45" style="justify-content:center;">${ICONS.arrowDownRight} เฉียง -45°</button>
              <button class="dq-btn secondary" data-gimbal="0" style="justify-content:center;">${ICONS.arrowRight} มองตรง 0°</button>
            </div>
          </div>

          <div>
            <div style="font-size:12.5px;font-weight:700;color:#eef0f8;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
              ${ICONS.signal} คุณภาพสตรีมวิดีโอ (Video Quality)
            </div>
            <select id="dqQualitySelect" class="dq-input">
              <option value="0" ${currentQuality === 0 ? 'selected' : ''}>อัตโนมัติ (Adaptive Bitrate)</option>
              <option value="1" ${currentQuality === 1 ? 'selected' : ''}>ไหลลื่นประหยัดเน็ต 4G (540p 1.5 Mbps)</option>
              <option value="2" ${currentQuality === 2 ? 'selected' : ''}>มาตรฐาน (720p HD 3 Mbps)</option>
              <option value="3" ${currentQuality === 3 ? 'selected' : ''}>คมชัดสูง (1080p Full HD 6 Mbps)</option>
              <option value="4" ${currentQuality === 4 ? 'selected' : ''}>สูงสุด (4K Ultra HD)</option>
            </select>
          </div>
        </div>
      </div>
    `;

    const selEl = container.querySelector('#dqDroneSelect');
    if (selEl) {
      selEl.addEventListener('change', () => {
        selectedDroneId = selEl.value;
        renderMapHudTab(container);
      });
    }

    const followCb = container.querySelector('#dqFollowCheckbox');
    if (followCb) {
      followCb.addEventListener('change', () => {
        followDrone = followCb.checked;
      });
    }

    const simBtn = container.querySelector('#dqHudSimBtn');
    if (simBtn && selected) {
      simBtn.addEventListener('click', async () => {
        try {
          await apiFetch(`/drones/${selected.id}/simulate`, {
            method: 'POST',
            body: JSON.stringify({ enable: !selected.simulating })
          });
          await refreshData();
          renderMapHudTab(container);
        } catch (e) {
          notify(`สั่งบินจำลองไม่สำเร็จ: ${e.message}`, 'error');
        }
      });
    }

    const clearBtn = container.querySelector('#dqClearTrailBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        Object.values(dronePaths).forEach((poly) => poly.setLatLngs([]));
        notify('ล้างเส้นทางบินบนแผนที่แล้ว', 'info');
      });
    }

    container.querySelectorAll('[data-lens]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!selected) return;
        currentLens = btn.getAttribute('data-lens');
        try {
          await apiFetch(`/${selected.vendor || 'dji'}/drones/${selected.id}/lens`, {
            method: 'POST',
            body: JSON.stringify({ lens: currentLens })
          });
          notify(`สลับเลนส์กล้องโดรนเป็น "${currentLens.toUpperCase()}" แล้ว`, 'success');
          renderMapHudTab(container);
        } catch (e) {
          notify(`คำสั่งสลับเลนส์ผิดพลาด: ${e.message}`, 'error');
        }
      });
    });

    container.querySelectorAll('[data-zoom]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!selected) return;
        currentZoom = Number(btn.getAttribute('data-zoom'));
        try {
          await apiFetch(`/${selected.vendor || 'dji'}/drones/${selected.id}/zoom`, {
            method: 'POST',
            body: JSON.stringify({ factor: currentZoom, lens: currentLens === 'thermal' ? 'thermal' : 'zoom' })
          });
          notify(`ปรับระดับการซูมเป็น ${currentZoom}x แล้ว`, 'success');
          renderMapHudTab(container);
        } catch (e) {
          notify(`คำสั่งซูมผิดพลาด: ${e.message}`, 'error');
        }
      });
    });

    container.querySelectorAll('[data-gimbal]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!selected) return;
        const pitch = Number(btn.getAttribute('data-gimbal'));
        try {
          await apiFetch(`/${selected.vendor || 'dji'}/drones/${selected.id}/gimbal`, {
            method: 'POST',
            body: JSON.stringify({ pitch, yaw: 0, mode: 'free' })
          });
          notify(`ปรับมุมกิมบอล Pitch ${pitch}° แล้ว`, 'success');
        } catch (e) {
          notify(`คำสั่งกิมบอลผิดพลาด: ${e.message}`, 'error');
        }
      });
    });

    const qualEl = container.querySelector('#dqQualitySelect');
    if (qualEl && selected) {
      qualEl.addEventListener('change', async () => {
        currentQuality = Number(qualEl.value);
        try {
          await apiFetch(`/${selected.vendor || 'dji'}/drones/${selected.id}/quality`, {
            method: 'POST',
            body: JSON.stringify({ quality: currentQuality })
          });
          notify('ปรับคุณภาพสตรีมวิดีโอโดรนเรียบร้อยแล้ว', 'success');
        } catch (e) {
          notify(`ปรับคุณภาพไม่สำเร็จ: ${e.message}`, 'error');
        }
      });
    }

    setTimeout(() => initOrUpdateMap(), 80);
  }

  async function initOrUpdateMap() {
    const mapContainer = document.getElementById('dqLeafletMap');
    if (!mapContainer || !window.L) return;

    if (leafletMap) {
      leafletMap.remove();
      leafletMap = null;
      droneMarkers = {};
      dronePaths = {};
    }

    const selected = dronesList.find((d) => d.id === selectedDroneId) || dronesList[0];
    const centerLat = selected ? Number(selected.lat || 14.6431) : 14.6431;
    const centerLng = selected ? Number(selected.lng || 103.0855) : 103.0855;

    leafletMap = window.L.map(mapContainer, {
      center: [centerLat, centerLng],
      zoom: 16
    });

    const satLayer = window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Esri Satellite'
    });
    const streetLayer = window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: 'OpenStreetMap'
    });
    satLayer.addTo(leafletMap);
    window.L.control.layers({ 'ภาพถ่ายดาวเทียม': satLayer, 'แผนที่ถนน': streetLayer }).addTo(leafletMap);

    await updateMapMarkersAndPaths();
  }

  async function updateMapMarkersAndPaths() {
    if (!leafletMap || !window.L) return;

    for (const d of dronesList) {
      const lat = Number(d.lat || 14.6431);
      const lng = Number(d.lng || 103.0855);
      const t = d.telemetry || {};
      const hdg = Number(t.heading || 0);
      const isOnline = d.status === 'online';
      const strokeColor = isOnline ? '#c084fc' : '#9aa0bd';
      const fillRing = isOnline ? 'rgba(168,85,247,0.35)' : 'rgba(148,163,184,0.2)';

      const iconHtml = `
        <div style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;transform:rotate(${hdg}deg);filter:drop-shadow(0 0 8px rgba(168,85,247,0.85));">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2.2">
            <circle cx="5" cy="5" r="3" fill="${fillRing}"/>
            <circle cx="19" cy="5" r="3" fill="${fillRing}"/>
            <circle cx="5" cy="19" r="3" fill="${fillRing}"/>
            <circle cx="19" cy="19" r="3" fill="${fillRing}"/>
            <line x1="7.5" y1="7.5" x2="16.5" y2="16.5"/>
            <line x1="16.5" y1="7.5" x2="7.5" y2="16.5"/>
            <polygon points="12,2.5 15.2,11 8.8,11" fill="#34e2a8" stroke="none"/>
          </svg>
        </div>
      `;

      const icon = window.L.divIcon({
        className: 'dq-drone-marker',
        html: iconHtml,
        iconSize: [38, 38],
        iconAnchor: [19, 19]
      });

      if (!droneMarkers[d.id]) {
        droneMarkers[d.id] = window.L.marker([lat, lng], { icon }).addTo(leafletMap);
      } else {
        droneMarkers[d.id].setLatLng([lat, lng]);
        droneMarkers[d.id].setIcon(icon);
      }
      droneMarkers[d.id].bindPopup(`
        <div style="font-family:var(--font-body,sans-serif);font-size:12.5px;color:#0f172a;">
          <b>${d.name}</b><br>
          ความสูง: ${Number(t.altitude || 0).toFixed(1)} ม. | แบต: ${t.battery != null ? t.battery : 100}%<br>
          ความเร็ว: ${Number(t.speed || 0).toFixed(1)} m/s | ทิศ: ${Math.round(hdg)}°
        </div>
      `);

      try {
        const hist = await apiFetch(`/drones/${d.id}/history?limit=250`);
        if (Array.isArray(hist) && hist.length > 1) {
          const latlngs = hist.map((pt) => [Number(pt.lat), Number(pt.lng)]);
          if (!dronePaths[d.id]) {
            dronePaths[d.id] = window.L.polyline(latlngs, {
              color: d.id === selectedDroneId ? '#c084fc' : '#34e2a8',
              weight: 3,
              opacity: 0.88,
              dashArray: d.simulating ? '6, 6' : null
            }).addTo(leafletMap);
          } else {
            dronePaths[d.id].setLatLngs(latlngs);
          }
        }
      } catch (_) {}
    }

    const sel = dronesList.find((d) => d.id === selectedDroneId);
    if (sel) {
      const t = sel.telemetry || {};
      const altEl = document.getElementById('dqHudAlt');
      const batEl = document.getElementById('dqHudBat');
      const spdEl = document.getElementById('dqHudSpd');
      const hdgEl = document.getElementById('dqHudHdg');
      const gpsEl = document.getElementById('dqHudGps');
      if (altEl) altEl.textContent = `${Number(t.altitude || 0).toFixed(1)} m`;
      if (batEl) batEl.textContent = `${t.battery != null ? t.battery : 100}%`;
      if (spdEl) spdEl.textContent = `${Number(t.speed || 0).toFixed(1)} m/s`;
      if (hdgEl) hdgEl.textContent = `${Math.round(t.heading || 0)}°`;
      if (gpsEl) gpsEl.innerHTML = `${ICONS.mapPin} <span>พิกัด GPS: ${Number(sel.lat || 14.6431).toFixed(6)}, ${Number(sel.lng || 103.0855).toFixed(6)}</span>`;

      if (followDrone && leafletMap) {
        leafletMap.panTo([Number(sel.lat || 14.6431), Number(sel.lng || 103.0855)], { animate: true });
      }
    }
  }

  async function renderQcsAndGuideTab(container) {
    let pairingData = null;
    try {
      pairingData = await apiFetch('/qcs/dji/pairing', { method: 'POST', body: '{}' });
    } catch (_) {
      pairingData = {
        pairing_code: 'BPP2-1500',
        organization_id: 'BPP215-TACTICAL-ORG',
        workspace_id: 'sloth-bpp215-wks',
        cloud_api_url: `${window.location.origin}/api/config/qcs/dji`
      };
    }

    const qrSvg = renderVisualQrSvg(pairingData.cloud_api_url, 140);

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px;margin-bottom:18px;">
        <!-- การ์ดจับคู่ DJI Pilot 2 Cloud API -->
        <div class="dq-guide-card" style="margin-bottom:0;">
          <h4>${ICONS.link} 1. จับคู่รีโมท DJI Pilot 2 (Enterprise One-Time Cloud Pairing)</h4>
          <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
            <div>${qrSvg}</div>
            <div style="flex:1;min-width:220px;">
              <div style="font-size:12px;color:#9aa0bd;">รหัสจับคู่ 1-Time Pairing Code:</div>
              <div style="font-size:26px;font-weight:800;color:#c084fc;letter-spacing:2px;font-family:var(--font-mono,monospace);margin:4px 0;text-shadow:0 0 12px rgba(168,85,247,0.45);">
                ${pairingData.pairing_code}
              </div>
              <div style="font-size:12px;color:#cbd5e1;margin-bottom:6px;">
                Organization ID: <code style="color:#e9d5ff;">${pairingData.organization_id}</code><br>
                Workspace ID: <code style="color:#e9d5ff;">${pairingData.workspace_id}</code>
              </div>
              <div class="dq-code-row" style="margin-bottom:8px;">
                <span style="flex:1;">${pairingData.cloud_api_url}</span>
                <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${pairingData.cloud_api_url}">${ICONS.copy} คัดลอก URL</button>
              </div>
              <button class="dq-btn" id="dqRegenPairingBtn">${ICONS.refresh} สุ่มรหัสจับคู่ใหม่</button>
            </div>
          </div>
        </div>

        <!-- การ์ดตั้งค่า MAVLink / Autel / UDP Telemetry -->
        <div class="dq-guide-card" style="margin-bottom:0;">
          <h4>${ICONS.wifi} 2. ช่องรับสัญญาณพิกัด MAVLink v2 / Autel / HTTP Telemetry</h4>
          <div style="font-size:13px;color:#cbd5e1;display:grid;gap:8px;">
            <div class="dq-code-row">
              <span style="color:#9aa0bd;width:145px;">HTTP Telemetry API:</span>
              <span style="flex:1;color:#c084fc;">POST ${window.location.origin}/api/config/drones/{id}/telemetry</span>
            </div>
            <div class="dq-code-row">
              <span style="color:#9aa0bd;width:145px;">MAVLink UDP Port:</span>
              <span style="flex:1;color:#34e2a8;">udp://0.0.0.0:14550 (ArduPilot / PX4 / QGroundControl)</span>
            </div>
            <div class="dq-code-row">
              <span style="color:#9aa0bd;width:145px;">MQTT Broker Topic:</span>
              <span style="flex:1;color:#e9d5ff;">thing/product/{device_sn}/osd</span>
            </div>
            <div style="font-size:12px;color:#9aa0bd;">
              ทุกครั้งที่โดรนรุ่นที่รองรับ Telemetry ส่งพิกัดเข้ามา ระบบจะอัปเดตตำแหน่งหมุดกล้อง <code style="color:#c084fc;">cam_drone_*</code> บน <b>แผนที่ยุทธวิธีหลัก (Tactical Map)</b> ให้เคลื่อนที่ตามโดรนแบบเรียลไทม์อัตโนมัติ
            </div>
          </div>
        </div>
      </div>

      <!-- คู่มือวิธีใช้งานแบบละเอียด Step-by-Step -->
      <div class="dq-guide-card">
        <h4>${ICONS.book} คู่มือวิธีใช้งานระบบโดรนและ QCS แบบละเอียด (Step-by-Step Field Manual)</h4>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:10px;">
          <div style="background:rgba(6,7,15,0.72);padding:13px;border-radius:10px;border-left:4px solid #a855f7;">
            <div style="font-weight:700;color:#c084fc;margin-bottom:6px;">ขั้นที่ 1: เพิ่มโดรนเข้าสู่ระบบ (ทำครั้งเดียว)</div>
            <ol style="margin:0;padding-left:18px;font-size:13px;color:#eef0f8;">
              <li>กดปุ่มไอคอนโดรนบนแถบด้านบน เลือกแท็บ <b>"1. จัดการโดรน & ลิงก์ RTMP"</b></li>
              <li>กดปุ่ม <b>"เพิ่มโดรนใหม่"</b> ตั้งชื่อโดรน และกำหนด <code>Stream Key</code> เช่น <code>bpp215_uav1</code> แล้วกดบันทึก</li>
              <li>ระบบจะสร้างกล้องวงจรปิดชื่อ <code>cam_drone_...</code> ให้อัตโนมัติบนหน้าจอหลักทันที</li>
            </ol>
          </div>

          <div style="background:rgba(6,7,15,0.72);padding:13px;border-radius:10px;border-left:4px solid #34e2a8;">
            <div style="font-weight:700;color:#34e2a8;margin-bottom:6px;">ขั้นที่ 2: ตั้งค่าส่งภาพสดจากรีโมท (DJI Pilot 2 / DJI RC 2)</div>
            <ol style="margin:0;padding-left:18px;font-size:13px;color:#eef0f8;">
              <li>ที่รีโมทโดรน เปิดแอป <b>DJI Pilot 2</b> หรือ <b>DJI Fly (รีโมท RC 2)</b> เข้าหน้ากล้อง (Camera View)</li>
              <li>แตะเมนู <b>"..." (มุมขวาบน)</b> &rarr; เลือกแท็บ <b>Transmission</b> &rarr; เลือก <b>Live Streaming Platforms</b> &rarr; เลือก <b>RTMP</b></li>
              <li>นำลิงก์จากตารางไปวาง:
                <ul style="padding-left:16px;margin:4px 0;">
                  <li><b>บินในฐาน (Wi-Fi เดียวกัน):</b> <code>${(tunnelInfo && tunnelInfo.lan_rtmp_base) || 'rtmp://192.168.1.200:1935/live'}/bpp215_uav1</code></li>
                  <li><b>บินนอกพื้นที่ (ซิม 4G/5G):</b> <code>rtmp://bpp215.duckdns.org:1935/live/bpp215_uav1</code></li>
                </ul>
              </li>
              <li>กด <b>Start</b> ภาพสดจะขึ้นที่หน้าจอกล้องหลักและในแท็บที่ 2 ทันที</li>
            </ol>
          </div>

          <div style="background:rgba(6,7,15,0.72);padding:13px;border-radius:10px;border-left:4px solid #fbbf24;">
            <div style="font-weight:700;color:#fbbf24;margin-bottom:6px;">ขั้นที่ 3: แผนที่ควบคุมการบิน & ควบคุมเลนส์/ซูม (เฉพาะรุ่นที่รองรับ QCS)</div>
            <ol style="margin:0;padding-left:18px;font-size:13px;color:#eef0f8;">
              <li>กดที่แท็บ <b>"2. แผนที่การบิน & QCS HUD"</b> หรือกดปุ่ม <b>"ควบคุม QCS"</b> ในตาราง</li>
              <li>สำหรับโดรนรุ่น Enterprise (DJI Pilot 2 Cloud API / MAVLink) แผนที่จะแสดงพิกัดสด ทิศทางหัวโดรน เส้นทางบิน และกดสั่งสลับเลนส์ <b>ปกติ / มุมกว้าง / ซูม 1x–32x / ความร้อน</b> ได้จากหน้าเว็บ</li>
              <li>สำหรับโดรน DJI รุ่นทั่วไปที่ใช้รีโมท <b>DJI RC 2 (DJI Fly)</b> จะรองรับเฉพาะการส่ง <b>ภาพและเสียงสด (RTMP)</b> (ไม่รองรับการส่งพิกัด GPS และการสั่งซูมจากหน้าเว็บ)</li>
            </ol>
          </div>

          <div style="background:rgba(6,7,15,0.72);padding:13px;border-radius:10px;border-left:4px solid #38bdf8;">
            <div style="font-weight:700;color:#38bdf8;margin-bottom:6px;">ขั้นที่ 4: โหมดทดสอบบินจำลอง (Flight Simulator)</div>
            <ol style="margin:0;padding-left:18px;font-size:13px;color:#eef0f8;">
              <li>หากต้องการซ้อมแผนยุทธวิธีหรือสาธิตระบบโดยยังไม่เปิดโดรนจริง ให้กดปุ่มสีเขียว <b>"ทดสอบบินจำลอง"</b></li>
              <li>ระบบจะจำลองโดรนบินลาดตระเวนเป็นวงกลมรัศมี 350 เมตร รอบกองร้อย ตชด.215 พร้อมอัปเดตความสูง ความเร็ว ทิศทาง และวาดเส้นทางบินสดทุก 1.5 วินาที</li>
              <li>เมื่อต้องการหยุด ให้กดปุ่ม <b>"หยุดบินจำลอง"</b> ได้ทันที</li>
            </ol>
          </div>
        </div>
      </div>
    `;

    container.querySelectorAll('[data-copy]').forEach((b) => {
      b.addEventListener('click', () => copyText(b.getAttribute('data-copy')));
    });
    const regenBtn = container.querySelector('#dqRegenPairingBtn');
    if (regenBtn) {
      regenBtn.addEventListener('click', () => renderQcsAndGuideTab(container));
    }
  }

  async function openDroneQcsModal() {
    buildModalDom();
    modalEl.classList.add('open');
    const topBtn = document.getElementById('btnDroneQcs');
    if (topBtn) topBtn.setAttribute('aria-pressed', 'true');
    await refreshData();
    renderActiveTab();

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!modalEl || !modalEl.classList.contains('open')) return;
      await refreshData();
      if (activeTab === 'fleet') {
        const sub = document.getElementById('dqSubModalArea');
        if (!sub || !sub.innerHTML.trim()) {
          renderFleetTab(document.getElementById('dqBodyContainer'));
        }
      } else if (activeTab === 'map') {
        await updateMapMarkersAndPaths();
      }
    }, 2000);
  }

  function closeDroneQcsModal() {
    if (modalEl) {
      modalEl.classList.remove('open');
    }
    const topBtn = document.getElementById('btnDroneQcs');
    if (topBtn) topBtn.setAttribute('aria-pressed', 'false');
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function bindTopbarButton() {
    const btn = document.getElementById('btnDroneQcs');
    if (btn && !btn.dataset.dqBound) {
      btn.dataset.dqBound = '1';
      btn.addEventListener('click', openDroneQcsModal);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindTopbarButton);
  } else {
    bindTopbarButton();
  }

  window.openDroneQcsModal = openDroneQcsModal;
})();
