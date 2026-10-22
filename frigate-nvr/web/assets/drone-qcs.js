/**
 * SLOTH × BPP-VMS: Tactical Drone & QCS Ground Control Station (GCS) Controller
 * Incident 2.192 — Full integration of SLOTH-BPP215 Drone & QCS Module
 * Works seamlessly on both Docker Production (vms.local) and Native Windows (D:\Sloth-BPP215)
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
      navigator.clipboard.writeText(text).then(() => notify(`✅ ${label}: ${text}`, 'success'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      notify(`✅ ${label}: ${text}`, 'success');
    }
  }

  // Deterministic visual QR matrix SVG generator for quick field scanning display
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
          rects += `<rect x="${(c * cellPx).toFixed(1)}" y="${(r * cellPx).toFixed(1)}" width="${(cellPx + 0.3).toFixed(1)}" height="${(cellPx + 0.3).toFixed(1)}" fill="#0f172a"/>`;
        }
      }
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="background:#ffffff;padding:8px;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,0.35);">${rects}</svg>`;
  }

  function injectStyles() {
    if (document.getElementById('droneQcsStyles')) return;
    const style = document.createElement('style');
    style.id = 'droneQcsStyles';
    style.textContent = `
      .dq-overlay {
        position: fixed;
        inset: 0;
        background: rgba(3, 7, 18, 0.85);
        backdrop-filter: blur(8px);
        z-index: 9998;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 16px;
        font-family: 'Prompt', 'Kanit', system-ui, sans-serif;
      }
      .dq-overlay.open {
        display: flex;
      }
      .dq-modal {
        width: min(1460px, 98vw);
        height: min(900px, 94vh);
        background: linear-gradient(180deg, #0b1324 0%, #090f1d 100%);
        border: 1px solid rgba(56, 189, 248, 0.32);
        border-radius: 16px;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.75);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: #e2e8f0;
      }
      .dq-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        background: rgba(15, 23, 42, 0.92);
        border-bottom: 1px solid rgba(56, 189, 248, 0.2);
        gap: 12px;
        flex-wrap: wrap;
      }
      .dq-title-wrap {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .dq-badge-live {
        background: rgba(16, 185, 129, 0.16);
        color: #34d399;
        border: 1px solid rgba(16, 185, 129, 0.4);
        font-size: 11px;
        font-weight: 700;
        padding: 3px 9px;
        border-radius: 999px;
      }
      .dq-tabs {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .dq-tab-btn {
        background: rgba(30, 41, 59, 0.75);
        color: #94a3b8;
        border: 1px solid rgba(148, 163, 184, 0.2);
        padding: 8px 14px;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .dq-tab-btn:hover {
        color: #f8fafc;
        border-color: rgba(56, 189, 248, 0.45);
      }
      .dq-tab-btn.active {
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.28), rgba(37, 99, 235, 0.28));
        color: #38bdf8;
        border-color: #38bdf8;
        box-shadow: 0 0 14px rgba(56, 189, 248, 0.22);
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
        background: rgba(15, 23, 42, 0.85);
        border: 1px solid rgba(56, 189, 248, 0.22);
        border-radius: 12px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .dq-channel-title {
        font-size: 12px;
        font-weight: 700;
        color: #38bdf8;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .dq-code-row {
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(2, 6, 23, 0.75);
        border: 1px solid rgba(148, 163, 184, 0.18);
        padding: 6px 9px;
        border-radius: 8px;
        font-family: 'JetBrains Mono', Consolas, monospace;
        font-size: 12px;
        color: #f8fafc;
        overflow-x: auto;
      }
      .dq-btn {
        background: #0284c7;
        color: #ffffff;
        border: none;
        padding: 7px 13px;
        border-radius: 8px;
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
      }
      .dq-btn.secondary {
        background: rgba(30, 41, 59, 0.9);
        border: 1px solid rgba(148, 163, 184, 0.3);
        color: #e2e8f0;
      }
      .dq-btn.success {
        background: #059669;
      }
      .dq-btn.warn {
        background: #d97706;
      }
      .dq-btn.danger {
        background: rgba(220, 38, 38, 0.85);
      }
      .dq-table {
        width: 100%;
        border-collapse: collapse;
        background: rgba(15, 23, 42, 0.75);
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, 0.16);
      }
      .dq-table th, .dq-table td {
        padding: 11px 13px;
        text-align: left;
        border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        font-size: 13px;
      }
      .dq-table th {
        background: rgba(30, 41, 59, 0.85);
        color: #94a3b8;
        font-weight: 700;
        font-size: 12px;
      }
      .dq-map-layout {
        display: grid;
        grid-template-columns: 1fr 410px;
        gap: 16px;
        height: calc(94vh - 130px);
        min-height: 560px;
      }
      @media (max-width: 1024px) {
        .dq-map-layout {
          grid-template-columns: 1fr;
          height: auto;
        }
      }
      .dq-hud-panel {
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid rgba(56, 189, 248, 0.25);
        border-radius: 14px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
      }
      .dq-telemetry-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      .dq-stat-box {
        background: rgba(2, 6, 23, 0.75);
        border: 1px solid rgba(56, 189, 248, 0.18);
        border-radius: 10px;
        padding: 9px 11px;
      }
      .dq-stat-label {
        font-size: 11px;
        color: #94a3b8;
      }
      .dq-stat-val {
        font-size: 18px;
        font-weight: 700;
        color: #38bdf8;
        font-family: 'JetBrains Mono', monospace;
      }
      .dq-guide-card {
        background: rgba(15, 23, 42, 0.82);
        border: 1px solid rgba(56, 189, 248, 0.24);
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 14px;
        line-height: 1.65;
      }
      .dq-guide-card h4 {
        margin: 0 0 8px 0;
        color: #38bdf8;
        font-size: 15px;
      }
      .dq-input {
        width: 100%;
        background: rgba(2, 6, 23, 0.85);
        border: 1px solid rgba(148, 163, 184, 0.3);
        color: #f8fafc;
        padding: 8px 11px;
        border-radius: 8px;
        font-size: 13px;
        box-sizing: border-box;
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
            <span style="font-size:22px;">🛸</span>
            <div>
              <div style="font-size:16px;font-weight:700;color:#f8fafc;display:flex;align-items:center;gap:8px;">
                ศูนย์ควบคุมอากาศยานไร้คนขับและสถานีภาคพื้นดิน (SLOTH Drone & QCS Ground Control Station)
                <span class="dq-badge-live" id="dqLiveCountBadge">0 ลำ</span>
              </div>
              <div style="font-size:12px;color:#94a3b8;">
                รองรับ DJI Pilot 2 Cloud API · Autel Enterprise · MAVLink v2 · RTMP Live Stream (LAN / 4G-5G DuckDNS / Tailscale / Bore Tunnel)
              </div>
            </div>
          </div>
          <div class="dq-tabs">
            <button class="dq-tab-btn active" data-tab="fleet">📋 1. จัดการโดรน & ลิงก์สตรีม RTMP</button>
            <button class="dq-tab-btn" data-tab="map">🛰️ 2. แผนที่ควบคุมการบิน & QCS HUD</button>
            <button class="dq-tab-btn" data-tab="qcs">🔗 3. จับคู่รีโมท DJI/MAVLink & คู่มือใช้งานละเอียด</button>
            <button class="dq-btn secondary" id="dqCloseBtn" title="ปิดหน้าต่าง">✕ ปิด</button>
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
    const lanUrl = (tunnelInfo && tunnelInfo.lan_rtmp_base) || 'rtmp://192.168.1.93:1935';
    const duckUrl = (tunnelInfo && tunnelInfo.duckdns_rtmp_base) || 'rtmp://bpp215.duckdns.org:1935';
    const tsUrl = (tunnelInfo && tunnelInfo.tailscale_rtmp_base) || lanUrl;
    const boreUrl = (tunnelInfo && tunnelInfo.url) || 'กดปุ่ม "🚀 เปิด Bore Tunnel" ด้านขวาเมื่อต้องการทะลุ 4G/5G CGNAT';

    const rowsHtml = dronesList.length === 0
      ? `<tr><td colspan="7" style="text-align:center;padding:28px;color:#94a3b8;">ยังไม่มีโดรนในระบบ — กดปุ่ม <b>"+ เพิ่มโดรนใหม่"</b> ด้านบนเพื่อสร้างลิงก์ RTMP และเพิ่มเข้ากล้องวงจรปิดอัตโนมัติ</td></tr>`
      : dronesList.map((d) => {
          const t = d.telemetry || {};
          const isOnline = d.status === 'online';
          const isSim = !!d.simulating;
          const statusBadge = isOnline
            ? `<span style="background:rgba(16,185,129,0.2);color:#34d399;padding:3px 8px;border-radius:99px;font-size:11.5px;font-weight:700;">● กำลังบิน ${isSim ? '(จำลอง)' : '(สด)'}</span>`
            : `<span style="background:rgba(148,163,184,0.15);color:#94a3b8;padding:3px 8px;border-radius:99px;font-size:11.5px;">○ สแตนด์บาย</span>`;
          const fullLanRtmp = `${lanUrl}/${d.stream_key}`;
          const fullDuckRtmp = `${duckUrl}/${d.stream_key}`;
          return `
            <tr>
              <td>
                <div style="font-weight:700;color:#f8fafc;font-size:14px;">🛸 ${d.name || d.id}</div>
                <div style="font-size:11.5px;color:#94a3b8;">รหัสกล้อง: <code>${d.camera_id || ('cam_drone_' + d.id)}</code></div>
              </td>
              <td>
                <span style="text-transform:uppercase;font-weight:700;color:#38bdf8;">${d.vendor || 'dji'}</span>
                <div style="font-size:11.5px;color:#94a3b8;">${d.model || 'Enterprise'}</div>
              </td>
              <td>${statusBadge}</td>
              <td>
                <div style="display:flex;align-items:center;gap:6px;">
                  <code style="background:#020617;padding:4px 7px;border-radius:6px;color:#38bdf8;font-size:12px;">${fullLanRtmp}</code>
                  <button class="dq-btn secondary" style="padding:4px 8px;font-size:11px;" data-copy="${fullLanRtmp}">คัดลอก LAN</button>
                  <button class="dq-btn secondary" style="padding:4px 8px;font-size:11px;" data-copy="${fullDuckRtmp}">คัดลอก 4G</button>
                </div>
              </td>
              <td>
                <div style="font-size:12px;line-height:1.45;">
                  ⛰️ สูง: <b>${Number(t.altitude || 0).toFixed(1)} ม.</b> · 🔋 แบต: <b>${t.battery != null ? t.battery : 100}%</b><br>
                  💨 เร็ว: <b>${Number(t.speed || 0).toFixed(1)} m/s</b> · 🧭 ทิศ: <b>${Math.round(t.heading || 0)}°</b>
                </div>
              </td>
              <td>
                <div style="font-size:12px;color:#cbd5e1;font-family:monospace;">
                  ${Number(d.lat || 14.6431).toFixed(5)}, ${Number(d.lng || 103.0855).toFixed(5)}
                </div>
              </td>
              <td>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                  <button class="dq-btn" data-action="watch" data-id="${d.id}" title="เปิดดูภาพสดจากกล้องโดรน">▶ ดูภาพสด</button>
                  <button class="dq-btn ${isSim ? 'warn' : 'success'}" data-action="simulate" data-id="${d.id}" title="จำลองการบินลาดตระเวนรอบฐานเพื่อทดสอบแผนที่และ Telemetry">
                    ${isSim ? '⏹ หยุดบินจำลอง' : '🛫 ทดสอบบินจำลอง'}
                  </button>
                  <button class="dq-btn secondary" data-action="control" data-id="${d.id}" title="เปิดแผนที่และแผงควบคุมเลนส์/ซูม QCS">🎛️ ควบคุม QCS</button>
                  <button class="dq-btn secondary" data-action="qr" data-id="${d.id}" title="ดู QR Code และลิงก์เชื่อมต่อทั้งหมด">🔑 ลิงก์/QR</button>
                  <button class="dq-btn danger" data-action="delete" data-id="${d.id}" title="ลบโดรน">🗑️</button>
                </div>
              </td>
            </tr>
          `;
        }).join('');

    container.innerHTML = `
      <div class="dq-banner-grid">
        <div class="dq-channel-card">
          <div class="dq-channel-title">
            <span>📡 ช่องทางที่ 1: วง LAN / Wi-Fi หน่วย (แนะนำในที่ตั้ง)</span>
            <span style="color:#34d399;font-size:11px;">พร้อมใช้งานทันที</span>
          </div>
          <div class="dq-code-row">
            <span style="flex:1;">${lanUrl}/&lt;StreamKey&gt;</span>
            <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${lanUrl}">คัดลอก</button>
          </div>
          <div style="font-size:11.5px;color:#94a3b8;">ใช้เมื่อรีโมทโดรนจับ Wi-Fi วงเดียวกับเซิร์ฟเวอร์ (ความหน่วงต่ำสุด &lt; 0.5 วินาที)</div>
        </div>

        <div class="dq-channel-card">
          <div class="dq-channel-title">
            <span>🌐 ช่องทางที่ 2: ภาคสนาม 4G/5G (DuckDNS Direct)</span>
            <span style="color:#38bdf8;font-size:11px;">ซิมการ์ด / Hotspot มือถือ</span>
          </div>
          <div class="dq-code-row">
            <span style="flex:1;">${duckUrl}/&lt;StreamKey&gt;</span>
            <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${duckUrl}">คัดลอก</button>
          </div>
          <div style="font-size:11.5px;color:#94a3b8;">ใช้เมื่อบินนอกที่ตั้งผ่านซิม 4G/5G (ต้อง Forward Port TCP 1935 ที่เราเตอร์)</div>
        </div>

        <div class="dq-channel-card">
          <div class="dq-channel-title">
            <span>🛡️ ช่องทางที่ 3: เครือข่าย Tailscale VPN</span>
            <span style="color:#a78bfa;font-size:11px;">เข้ารหัสปลอดภัย</span>
          </div>
          <div class="dq-code-row">
            <span style="flex:1;">${tsUrl}/&lt;StreamKey&gt;</span>
            <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${tsUrl}">คัดลอก</button>
          </div>
          <div style="font-size:11.5px;color:#94a3b8;">ใช้เมื่อรีโมท DJI RC Pro / มือถือ เปิดแอป Tailscale เชื่อมต่อวง VPN เดียวกัน</div>
        </div>

        <div class="dq-channel-card">
          <div class="dq-channel-title">
            <span>🚀 ช่องทางที่ 4: Bore Cloud Tunnel (ทะลุ CGNAT อัตโนมัติ)</span>
            <button class="dq-btn" id="dqStartBoreBtn" style="padding:3px 8px;font-size:11px;">🔄 เปิด Bore Tunnel</button>
          </div>
          <div class="dq-code-row">
            <span style="flex:1;">${boreUrl}</span>
            ${tunnelInfo && tunnelInfo.url ? `<button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${tunnelInfo.url}">คัดลอก</button>` : ''}
          </div>
          <div style="font-size:11.5px;color:#94a3b8;">ใช้เมื่อออกพื้นที่แล้วไม่ได้ตั้งค่า Port Forward ที่เราเตอร์</div>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10px;">
        <div style="font-size:15px;font-weight:700;color:#f8fafc;">
          📋 รายการฝูงบินโดรนยุทธวิธี (Tactical Drone Fleet) — สร้างกล้องวงจรปิด <code>cam_drone_*</code> อัตโนมัติ
        </div>
        <div style="display:flex;gap:8px;">
          <button class="dq-btn secondary" id="dqRefreshFleetBtn">🔄 รีเฟรชสถานะ</button>
          <button class="dq-btn success" id="dqAddDroneBtn">➕ เพิ่มโดรนใหม่ (1-Click Auto Camera)</button>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table class="dq-table">
          <thead>
            <tr>
              <th>ชื่อโดรน / รหัสกล้อง</th>
              <th>ยี่ห้อ / รุ่น</th>
              <th>สถานะการบิน</th>
              <th>RTMP Live Stream URL (ใส่ในรีโมท DJI Pilot 2)</th>
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
        boreBtn.textContent = '⏳ กำลังเปิด Tunnel...';
        try {
          tunnelInfo = await apiFetch('/drones/tunnel/start', { method: 'POST', body: '{}' });
          renderFleetTab(container);
          notify('อัปเดตช่องทาง RTMP Tunnel สำเร็จ', 'success');
        } catch (e) {
          notify(`เปิด Tunnel ไม่สำเร็จ: ${e.message}`, 'error');
          boreBtn.disabled = false;
          boreBtn.textContent = '🔄 เปิด Bore Tunnel';
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

        if (action === 'watch') {
          selectedDroneId = id;
          activeTab = 'map';
          modalEl.querySelectorAll('.dq-tab-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === 'map'));
          renderActiveTab();
        } else if (action === 'control') {
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
            notify(res.simulating ? `🛫 เริ่มจำลองการบินลาดตระเวนของ "${drone.name}" แล้ว` : `⏹ หยุดการบินจำลองของ "${drone.name}" แล้ว`, 'success');
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
      <div style="background:rgba(15,23,42,0.95);border:1px solid #38bdf8;border-radius:12px;padding:16px;">
        <div style="font-size:15px;font-weight:700;color:#38bdf8;margin-bottom:12px;">
          ➕ เพิ่มโดรนยุทธวิธีใหม่ (สร้างกล้องสดบน Dashboard + แผนที่ยุทธวิธีอัตโนมัติ)
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;">
          <div>
            <label style="font-size:12px;color:#94a3b8;">ชื่อโดรน / นามเรียกขาน *</label>
            <input id="dqNewName" class="dq-input" placeholder="เช่น โดรนลาดตระเวน ตชด.215 ลำที่ 1" value="โดรนลาดตระเวน ตชด.215 #${dronesList.length + 1}" />
          </div>
          <div>
            <label style="font-size:12px;color:#94a3b8;">ยี่ห้อ / โปรโตคอล (Vendor)</label>
            <select id="dqNewVendor" class="dq-input">
              <option value="dji">DJI Enterprise (Pilot 2 / Matrice / Mavic 3E/3T)</option>
              <option value="autel">Autel Robotics (EVO II / Dragonfish)</option>
              <option value="mavlink">MAVLink v2 / ArduPilot / PX4</option>
              <option value="rtmp">Generic RTMP Streamer (Litchi / Dronelink)</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:#94a3b8;">รุ่นอากาศยาน (Model)</label>
            <input id="dqNewModel" class="dq-input" placeholder="เช่น DJI Mavic 3 Thermal (M3T)" value="DJI Mavic 3 Enterprise" />
          </div>
          <div>
            <label style="font-size:12px;color:#94a3b8;">Stream Key (ภาษาอังกฤษ/ตัวเลข)</label>
            <input id="dqNewKey" class="dq-input" placeholder="เช่น bpp215_drone1" value="bpp215_drone${dronesList.length + 1}" />
          </div>
          <div>
            <label style="font-size:12px;color:#94a3b8;">ละติจูดฐานบิน (Lat)</label>
            <input id="dqNewLat" class="dq-input" type="number" step="0.00001" value="14.64310" />
          </div>
          <div>
            <label style="font-size:12px;color:#94a3b8;">ลองจิจูดฐานบิน (Lng)</label>
            <input id="dqNewLng" class="dq-input" type="number" step="0.00001" value="103.08550" />
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button class="dq-btn secondary" id="dqCancelAddBtn">ยกเลิก</button>
          <button class="dq-btn success" id="dqConfirmAddBtn">💾 บันทึกและสร้างลิงก์ RTMP ทันที</button>
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
      const lng = parseFloat(targetEl.querySelector('#dqNewLng').value) || 103.0855;
      if (!name) {
        notify('กรุณาระบุชื่อโดรน', 'error');
        return;
      }
      try {
        const res = await apiFetch('/drones', {
          method: 'POST',
          body: JSON.stringify({ name, vendor, model, stream_key, lat, lng })
        });
        notify(`✅ เพิ่มโดรน "${name}" และลงทะเบียนกล้อง ${res.drone.camera_id} สำเร็จ!`, 'success');
        await refreshData();
        renderActiveTab();
        if ( res && res.drone ) {
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
    const lanUrl = `${(tunnelInfo && tunnelInfo.lan_rtmp_base) || 'rtmp://192.168.1.93:1935'}/${drone.stream_key}`;
    const duckUrl = `${(tunnelInfo && tunnelInfo.duckdns_rtmp_base) || 'rtmp://bpp215.duckdns.org:1935'}/${drone.stream_key}`;
    const qrSvg = renderVisualQrSvg(lanUrl, 148);
    targetEl.innerHTML = `
      <div style="background:rgba(15,23,42,0.96);border:1px solid #38bdf8;border-radius:12px;padding:16px;display:flex;gap:18px;align-items:center;flex-wrap:wrap;">
        <div>${qrSvg}</div>
        <div style="flex:1;min-width:280px;">
          <div style="font-size:15px;font-weight:700;color:#38bdf8;margin-bottom:6px;">
            🔑 ข้อมูลการตั้งค่าสตรีมสดสำหรับ: ${drone.name} (${drone.camera_id})
          </div>
          <div style="font-size:12.5px;color:#cbd5e1;margin-bottom:8px;">
            นำค่าด้านล่างไปกรอกในแอป <b>DJI Pilot 2</b> &rarr; เมนู <b>Live Stream (ถ่ายทอดสด)</b> &rarr; เลือก <b>RTMP</b>:
          </div>
          <div style="display:grid;gap:6px;font-size:12.5px;">
            <div class="dq-code-row">
              <span style="color:#94a3b8;width:155px;">1. ลิงก์เต็ม (วง LAN):</span>
              <strong style="flex:1;color:#34d399;">${lanUrl}</strong>
              <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${lanUrl}">คัดลอก</button>
            </div>
            <div class="dq-code-row">
              <span style="color:#94a3b8;width:155px;">2. ลิงก์เต็ม (4G/5G):</span>
              <strong style="flex:1;color:#38bdf8;">${duckUrl}</strong>
              <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${duckUrl}">คัดลอก</button>
            </div>
            <div class="dq-code-row">
              <span style="color:#94a3b8;width:155px;">3. Stream Key แยก:</span>
              <strong style="flex:1;color:#facc15;">${drone.stream_key}</strong>
              <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${drone.stream_key}">คัดลอก</button>
            </div>
            <div class="dq-code-row">
              <span style="color:#94a3b8;width:155px;">4. API ส่งพิกัด GPS:</span>
              <strong style="flex:1;color:#e2e8f0;">POST ${window.location.origin}/api/config/drones/${drone.id}/telemetry</strong>
              <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${window.location.origin}/api/config/drones/${drone.id}/telemetry">คัดลอก</button>
            </div>
          </div>
        </div>
        <div>
          <button class="dq-btn secondary" id="dqCloseQrBtn">✕ ปิดการ์ด</button>
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
      : dronesList.map((d) => `<option value="${d.id}" ${d.id === selectedDroneId ? 'selected' : ''}>🛸 ${d.name} (${d.status === 'online' ? 'กำลังบิน' : 'สแตนด์บาย'})</option>`).join('');

    container.innerHTML = `
      <div class="dq-map-layout">
        <div style="position:relative;border-radius:14px;overflow:hidden;border:1px solid rgba(56,189,248,0.3);background:#020617;min-height:460px;">
          <div id="dqLeafletMap" style="width:100%;height:100%;min-height:460px;"></div>
          <div style="position:absolute;top:12px;left:54px;z-index:500;display:flex;gap:8px;flex-wrap:wrap;background:rgba(15,23,42,0.88);padding:8px 12px;border-radius:10px;border:1px solid rgba(56,189,248,0.3);">
            <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#f8fafc;cursor:pointer;">
              <input type="checkbox" id="dqFollowCheckbox" ${followDrone ? 'checked' : ''} />
              🎯 ล็อกเป้าติดตามโดรนอัตโนมัติ (Follow Drone)
            </label>
            <button class="dq-btn secondary" id="dqClearTrailBtn" style="padding:4px 9px;font-size:11.5px;">🧹 ล้างเส้นทางบิน</button>
          </div>
        </div>

        <div class="dq-hud-panel">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <select id="dqDroneSelect" class="dq-input" style="font-weight:700;">${optionsHtml}</select>
            ${selected ? `
              <button class="dq-btn ${selected.simulating ? 'warn' : 'success'}" id="dqHudSimBtn" style="white-space:nowrap;">
                ${selected.simulating ? '⏹ หยุดบินจำลอง' : '🛫 บินจำลอง'}
              </button>
            ` : ''}
          </div>

          <!-- จอพรีวิวภาพสดจากโดรน (go2rtc stream) -->
          <div style="background:#000;border-radius:10px;overflow:hidden;border:1px solid rgba(56,189,248,0.28);aspect-ratio:16/9;position:relative;">
            ${selected ? `
              <iframe
                src="/go2rtc/stream.html?src=${encodeURIComponent(camId)}&mode=mse,webrtc,mp4,mjpeg"
                style="width:100%;height:100%;border:0;"
                allow="autoplay; fullscreen"
              ></iframe>
              <div style="position:absolute;top:8px;left:8px;background:rgba(2,6,23,0.78);padding:3px 8px;border-radius:6px;font-size:11px;color:#38bdf8;pointer-events:none;">
                LIVE: ${camId} (${currentLens.toUpperCase()} · ${currentZoom}x)
              </div>
            ` : `
              <div style="height:100%;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:13px;">
                ยังไม่ได้เลือกโดรน
              </div>
            `}
          </div>

          <!-- มาตรวัด Telemetry แบบเรียลไทม์ -->
          <div class="dq-telemetry-grid">
            <div class="dq-stat-box">
              <div class="dq-stat-label">⛰️ ความสูงเหนือพื้น (Altitude)</div>
              <div class="dq-stat-val" id="dqHudAlt">${Number(t.altitude || 0).toFixed(1)} m</div>
            </div>
            <div class="dq-stat-box">
              <div class="dq-stat-label">🔋 แบตเตอรี่ (Battery)</div>
              <div class="dq-stat-val" id="dqHudBat" style="color:#34d399;">${t.battery != null ? t.battery : 100}%</div>
            </div>
            <div class="dq-stat-box">
              <div class="dq-stat-label">💨 ความเร็ว (Ground Speed)</div>
              <div class="dq-stat-val" id="dqHudSpd">${Number(t.speed || 0).toFixed(1)} m/s</div>
            </div>
            <div class="dq-stat-box">
              <div class="dq-stat-label">🧭 ทิศทางหัวโดรน (Heading)</div>
              <div class="dq-stat-val" id="dqHudHdg">${Math.round(t.heading || 0)}°</div>
            </div>
          </div>

          <div style="font-size:12px;color:#94a3b8;font-family:monospace;background:rgba(2,6,23,0.7);padding:6px 10px;border-radius:8px;" id="dqHudGps">
            📍 พิกัด GPS: ${selected ? `${Number(selected.lat || 14.6431).toFixed(6)}, ${Number(selected.lng || 103.0855).toFixed(6)}` : '-'}
          </div>

          <!-- แผงควบคุมเลนส์และซูม QCS Payload Control -->
          <div style="border-top:1px solid rgba(148,163,184,0.16);padding-top:10px;">
            <div style="font-size:12.5px;font-weight:700;color:#e2e8f0;margin-bottom:6px;">📷 โหมดเลนส์กล้อง (QCS Camera Lens)</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
              <button class="dq-btn ${currentLens === 'normal' ? '' : 'secondary'}" data-lens="normal" style="justify-content:center;padding:6px;">ปกติ</button>
              <button class="dq-btn ${currentLens === 'wide' ? '' : 'secondary'}" data-lens="wide" style="justify-content:center;padding:6px;">มุมกว้าง</button>
              <button class="dq-btn ${currentLens === 'zoom' ? '' : 'secondary'}" data-lens="zoom" style="justify-content:center;padding:6px;">ซูมไกล</button>
              <button class="dq-btn ${currentLens === 'thermal' ? 'warn' : 'secondary'}" data-lens="thermal" style="justify-content:center;padding:6px;">🔥 ความร้อน</button>
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;color:#e2e8f0;margin-bottom:6px;">
              <span>🔭 ระดับการซูม (Zoom Factor)</span>
              <span style="color:#38bdf8;" id="dqZoomLabel">${currentZoom}x</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:5px;">
              ${[1, 2, 5, 10, 20, 32].map((z) => `
                <button class="dq-btn ${currentZoom === z ? '' : 'secondary'}" data-zoom="${z}" style="justify-content:center;padding:5px;">${z}x</button>
              `).join('')}
            </div>
          </div>

          <div>
            <div style="font-size:12.5px;font-weight:700;color:#e2e8f0;margin-bottom:6px;">🎯 ควบคุมมุมก้ม-เงย กิมบอล (Gimbal Pitch)</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
              <button class="dq-btn secondary" data-gimbal="-90" style="justify-content:center;">⬇ ก้มดิ่ง -90°</button>
              <button class="dq-btn secondary" data-gimbal="-45" style="justify-content:center;">↘ เฉียง -45°</button>
              <button class="dq-btn secondary" data-gimbal="0" style="justify-content:center;">➡ มองตรง 0°</button>
            </div>
          </div>

          <div>
            <div style="font-size:12.5px;font-weight:700;color:#e2e8f0;margin-bottom:6px;">📶 คุณภาพสตรีมวิดีโอ (Video Quality)</div>
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
    window.L.control.layers({ '🛰️ ภาพถ่ายดาวเทียม': satLayer, '🗺️ แผนที่ถนน': streetLayer }).addTo(leafletMap);

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
      const color = isOnline ? '#38bdf8' : '#94a3b8';

      const iconHtml = `
        <div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;transform:rotate(${hdg}deg);filter:drop-shadow(0 2px 6px rgba(0,0,0,0.8));">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2">
            <circle cx="5" cy="5" r="3" fill="rgba(14,165,233,0.3)"/>
            <circle cx="19" cy="5" r="3" fill="rgba(14,165,233,0.3)"/>
            <circle cx="5" cy="19" r="3" fill="rgba(14,165,233,0.3)"/>
            <circle cx="19" cy="19" r="3" fill="rgba(14,165,233,0.3)"/>
            <line x1="7.5" y1="7.5" x2="16.5" y2="16.5"/>
            <line x1="16.5" y1="7.5" x2="7.5" y2="16.5"/>
            <polygon points="12,3 15,11 9,11" fill="#facc15" stroke="none"/>
          </svg>
        </div>
      `;

      const icon = window.L.divIcon({
        className: 'dq-drone-marker',
        html: iconHtml,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });

      if (!droneMarkers[d.id]) {
        droneMarkers[d.id] = window.L.marker([lat, lng], { icon }).addTo(leafletMap);
      } else {
        droneMarkers[d.id].setLatLng([lat, lng]);
        droneMarkers[d.id].setIcon(icon);
      }
      droneMarkers[d.id].bindPopup(`
        <div style="font-family:Prompt,sans-serif;font-size:12.5px;color:#0f172a;">
          <b>🛸 ${d.name}</b><br>
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
              color: d.id === selectedDroneId ? '#38bdf8' : '#a78bfa',
              weight: 3,
              opacity: 0.85,
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
      if (gpsEl) gpsEl.textContent = `📍 พิกัด GPS: ${Number(sel.lat || 14.6431).toFixed(6)}, ${Number(sel.lng || 103.0855).toFixed(6)}`;

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
          <h4>🔗 1. จับคู่รีโมท DJI Pilot 2 (One-Time Cloud Pairing)</h4>
          <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
            <div>${qrSvg}</div>
            <div style="flex:1;min-width:220px;">
              <div style="font-size:12px;color:#94a3b8;">รหัสจับคู่ 1-Time Pairing Code:</div>
              <div style="font-size:26px;font-weight:800;color:#facc15;letter-spacing:2px;font-family:monospace;margin:4px 0;">
                ${pairingData.pairing_code}
              </div>
              <div style="font-size:12px;color:#cbd5e1;margin-bottom:6px;">
                Organization ID: <code>${pairingData.organization_id}</code><br>
                Workspace ID: <code>${pairingData.workspace_id}</code>
              </div>
              <div class="dq-code-row" style="margin-bottom:8px;">
                <span style="flex:1;">${pairingData.cloud_api_url}</span>
                <button class="dq-btn secondary" style="padding:3px 8px;font-size:11px;" data-copy="${pairingData.cloud_api_url}">คัดลอก URL</button>
              </div>
              <button class="dq-btn" id="dqRegenPairingBtn">🔄 สุ่มรหัสจับคู่ใหม่</button>
            </div>
          </div>
        </div>

        <!-- การ์ดตั้งค่า MAVLink / Autel / UDP Telemetry -->
        <div class="dq-guide-card" style="margin-bottom:0;">
          <h4>📡 2. ช่องรับสัญญาณพิกัด MAVLink v2 / Autel / HTTP Telemetry</h4>
          <div style="font-size:13px;color:#cbd5e1;display:grid;gap:8px;">
            <div class="dq-code-row">
              <span style="color:#94a3b8;width:145px;">HTTP Telemetry API:</span>
              <span style="flex:1;color:#38bdf8;">POST ${window.location.origin}/api/config/drones/{id}/telemetry</span>
            </div>
            <div class="dq-code-row">
              <span style="color:#94a3b8;width:145px;">MAVLink UDP Port:</span>
              <span style="flex:1;color:#34d399;">udp://0.0.0.0:14550 (ArduPilot / PX4 / QGroundControl)</span>
            </div>
            <div class="dq-code-row">
              <span style="color:#94a3b8;width:145px;">MQTT Broker Topic:</span>
              <span style="flex:1;color:#a78bfa;">thing/product/{device_sn}/osd</span>
            </div>
            <div style="font-size:12px;color:#94a3b8;">
              💡 ทุกครั้งที่โดรนส่งพิกัดเข้ามา ระบบจะอัปเดตตำแหน่งหมุดกล้อง <code>cam_drone_*</code> บน <b>แผนที่ยุทธวิธีหลัก (Tactical Map)</b> ให้เคลื่อนที่ตามโดรนแบบเรียลไทม์อัตโนมัติ
            </div>
          </div>
        </div>
      </div>

      <!-- คู่มือวิธีใช้งานแบบละเอียด Step-by-Step -->
      <div class="dq-guide-card">
        <h4>📖 คู่มือวิธีใช้งานระบบโดรนและ QCS แบบละเอียด (Step-by-Step Field Manual)</h4>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:10px;">
          <div style="background:rgba(2,6,23,0.65);padding:13px;border-radius:10px;border-left:4px solid #38bdf8;">
            <div style="font-weight:700;color:#38bdf8;margin-bottom:6px;">ขั้นที่ 1: เพิ่มโดรนเข้าสู่ระบบ (ทำครั้งเดียว)</div>
            <ol style="margin:0;padding-left:18px;font-size:13px;color:#e2e8f0;">
              <li>เปิดหน้าต่างนี้ (ปุ่มไอคอนโดรน 🛸 บนแถบด้านบน) เลือกแท็บ <b>"1. จัดการโดรน & ลิงก์สตรีม RTMP"</b></li>
              <li>กดปุ่ม <b>"➕ เพิ่มโดรนใหม่"</b> ตั้งชื่อโดรน และกำหนด <code>Stream Key</code> เช่น <code>bpp215_drone1</code> แล้วกดบันทึก</li>
              <li>ระบบจะสร้างกล้องวงจรปิดชื่อ <code>cam_drone_...</code> ให้อัตโนมัติ (อยู่ในกลุ่ม <b>"🛸 โดรนยุทธวิธี (Tactical Drones)"</b> บนหน้าจอหลัก)</li>
            </ol>
          </div>

          <div style="background:rgba(2,6,23,0.65);padding:13px;border-radius:10px;border-left:4px solid #34d399;">
            <div style="font-weight:700;color:#34d399;margin-bottom:6px;">ขั้นที่ 2: ตั้งค่าส่งภาพสดจากรีโมทโดรน (DJI Pilot 2 / Autel / Litchi)</div>
            <ol style="margin:0;padding-left:18px;font-size:13px;color:#e2e8f0;">
              <li>ที่รีโมทโดรน เปิดแอป <b>DJI Pilot 2</b> เข้าหน้ากล้อง (Camera View)</li>
              <li>แตะเมนู <b>"..." (มุมขวาบน)</b> &rarr; เลือกแท็บ <b>Transmission (การส่งสัญญาณ)</b> &rarr; เลือก <b>Live Streaming Platforms</b> &rarr; เลือก <b>RTMP</b></li>
              <li>นำลิงก์จากตารางไปวาง:
                <ul style="padding-left:16px;margin:4px 0;">
                  <li><b>บินในฐาน (Wi-Fi เดียวกัน):</b> <code>${(tunnelInfo && tunnelInfo.lan_rtmp_base) || 'rtmp://192.168.1.93:1935'}/bpp215_drone1</code></li>
                  <li><b>บินนอกพื้นที่ (ซิม 4G/5G):</b> <code>rtmp://bpp215.duckdns.org:1935/bpp215_drone1</code></li>
                </ul>
              </li>
              <li>กด <b>Start Live Stream</b> ภาพจากโดรนจะขึ้นที่หน้าจอกล้องหลักและในแท็บที่ 2 ทันที!</li>
            </ol>
          </div>

          <div style="background:rgba(2,6,23,0.65);padding:13px;border-radius:10px;border-left:4px solid #facc15;">
            <div style="font-weight:700;color:#facc15;margin-bottom:6px;">ขั้นที่ 3: การดูแผนที่เส้นทางบิน & ควบคุมเลนส์/ซูม (QCS HUD)</div>
            <ol style="margin:0;padding-left:18px;font-size:13px;color:#e2e8f0;">
              <li>กดที่แท็บ <b>"🛰️ 2. แผนที่ควบคุมการบิน & QCS HUD"</b> หรือกดปุ่ม <b>"🎛️ ควบคุม QCS"</b> ในตาราง</li>
              <li>ฝั่งซ้ายคือแผนที่ดาวเทียมแสดงตำแหน่งโดรน หมุนหัวลูกศรตามทิศทางบินจริง พร้อมเส้นประประวัติการบิน (Flight Trail)</li>
              <li>ฝั่งขวาคือหน้าจอภาพสด + มาตรวัดความสูง/แบตเตอรี่/ความเร็ว และปุ่มสั่งสลับเลนส์ <b>ปกติ / มุมกว้าง / ซูม 1x–32x / กล้องความร้อน (Thermal IR)</b> และปรับมุมก้มกิมบอล</li>
            </ol>
          </div>

          <div style="background:rgba(2,6,23,0.65);padding:13px;border-radius:10px;border-left:4px solid #a78bfa;">
            <div style="font-weight:700;color:#a78bfa;margin-bottom:6px;">ขั้นที่ 4: โหมดทดสอบบินจำลอง (Flight Simulator ไม่ต้องเปิดโดรนจริง)</div>
            <ol style="margin:0;padding-left:18px;font-size:13px;color:#e2e8f0;">
              <li>หากต้องการซ้อมแผนยุทธวิธีหรือสาธิตระบบโดยยังไม่เปิดโดรนจริง ให้กดปุ่มสีเขียว <b>"🛫 ทดสอบบินจำลอง"</b></li>
              <li>ระบบจะจำลองโดรนบินลาดตระเวนเป็นวงกลมรัศมี 350 เมตร รอบกองร้อย ตชด.215 พร้อมอัปเดตความสูง ความเร็ว ทิศทาง และวาดเส้นทางบินสดทุก 1.5 วินาที</li>
              <li>เมื่อต้องการหยุด ให้กดปุ่ม <b>"⏹ หยุดบินจำลอง"</b> ได้ทันที</li>
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
    await refreshData();
    renderActiveTab();

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!modalEl || !modalEl.classList.contains('open')) return;
      await refreshData();
      if (activeTab === 'fleet') {
        // Only re-render fleet table if sub-modal form is not open
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
