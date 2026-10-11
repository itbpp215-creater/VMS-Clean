/**
 * BPP-VMS NAS Video Archive & On-Demand Restore Module
 * Handles querying dates/hours across SSD and NAS, live auto-sync status,
 * and background video retrieval (Evidence MP4 Concatenation & Timeline Restoration).
 */

(function () {
  'use strict';

  // DOM Elements
  const btnNasVideoArchive = document.getElementById('btnNasVideoArchive');
  const nasArchiveOverlay = document.getElementById('nasArchiveOverlay');
  const btnCloseNasArchive = document.getElementById('btnCloseNasArchive');

  // Status Elements
  const nasSyncStatusBadge = document.getElementById('nasSyncStatusBadge');
  const nasHostLabel = document.getElementById('nasHostLabel');
  const nasShareLabel = document.getElementById('nasShareLabel');
  const nasPendingSyncCount = document.getElementById('nasPendingSyncCount');
  const nasLastSyncTime = document.getElementById('nasLastSyncTime');
  const btnTestNasConn = document.getElementById('btnTestNasConn');

  // Form Controls
  const selArchiveCamera = document.getElementById('selArchiveCamera');
  const selArchiveDate = document.getElementById('selArchiveDate');
  const selArchiveStartHour = document.getElementById('selArchiveStartHour');
  const selArchiveEndHour = document.getElementById('selArchiveEndHour');
  const dateStorageTag = document.getElementById('dateStorageTag');
  const availableHoursHint = document.getElementById('availableHoursHint');
  const radModeEvidence = document.getElementById('radModeEvidence');
  const radModeTimeline = document.getElementById('radModeTimeline');
  const btnStartRestore = document.getElementById('btnStartRestore');

  // Progress & Result Box
  const restoreProgressBox = document.getElementById('restoreProgressBox');
  const restoreProgressBar = document.getElementById('restoreProgressBar');
  const restoreProgressPct = document.getElementById('restoreProgressPct');
  const restoreProgressMsg = document.getElementById('restoreProgressMsg');
  const restoreResultBox = document.getElementById('restoreResultBox');

  let activeTaskId = null;
  let pollTimer = null;
  let archiveDatesData = [];

  // --------------------------------------------------------------------------
  // Initialization & Event Listeners
  // --------------------------------------------------------------------------

  function init() {
    if (btnNasVideoArchive) {
      btnNasVideoArchive.addEventListener('click', openModal);
    }
    if (btnCloseNasArchive) {
      btnCloseNasArchive.addEventListener('click', closeModal);
    }
    if (nasArchiveOverlay) {
      nasArchiveOverlay.addEventListener('click', (e) => {
        if (e.target === nasArchiveOverlay) closeModal();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nasArchiveOverlay && !nasArchiveOverlay.hidden) {
        closeModal();
      }
    });

    if (btnTestNasConn) {
      btnTestNasConn.addEventListener('click', testNasConnection);
    }

    if (selArchiveDate) {
      selArchiveDate.addEventListener('change', onDateChanged);
    }

    if (selArchiveCamera) {
      selArchiveCamera.addEventListener('change', onCameraChanged);
    }

    if (btnStartRestore) {
      btnStartRestore.addEventListener('click', startRestoreJob);
    }

    // Populate hour options 00-23
    populateHourSelects();

    // Check status periodically in background
    loadSyncStatus();
    loadAvailableCameras();
    setInterval(loadSyncStatus, 30000);
  }

  function populateHourSelects() {
    if (!selArchiveStartHour || !selArchiveEndHour) return;
    selArchiveStartHour.innerHTML = '';
    selArchiveEndHour.innerHTML = '';

    for (let h = 0; h < 24; h++) {
      const hStr = h.toString().padStart(2, '0');
      const optStart = document.createElement('option');
      optStart.value = h;
      optStart.textContent = `${hStr}:00 น.`;
      selArchiveStartHour.appendChild(optStart);

      const optEnd = document.createElement('option');
      optEnd.value = h;
      optEnd.textContent = `${hStr}:59 น.`;
      selArchiveEndHour.appendChild(optEnd);
    }
    selArchiveStartHour.value = 0;
    selArchiveEndHour.value = 0;
  }

  function openModal() {
    if (typeof window.openEventMgr === 'function') {
      window.openEventMgr('nas');
      return;
    }
    if (nasArchiveOverlay) {
      nasArchiveOverlay.hidden = false;
      document.body.classList.add('modal-open');
      loadSyncStatus();
      loadAvailableCameras().then(() => loadAvailableDates());
    }
  }

  function closeModal() {
    if (typeof window.closeEventMgr === 'function') {
      window.closeEventMgr();
    }
    if (nasArchiveOverlay) {
      nasArchiveOverlay.hidden = true;
      document.body.classList.remove('modal-open');
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // Expose global module for in-place tab integration
  window.nasArchiveModule = {
    openModal,
    closeModal,
    onActivate: () => {
      loadSyncStatus();
      loadAvailableCameras().then(() => loadAvailableDates());
    },
    loadSyncStatus,
    loadAvailableCameras,
    loadAvailableDates
  };

  // --------------------------------------------------------------------------
  // Status & Connectivity
  // --------------------------------------------------------------------------

  async function loadSyncStatus() {
    try {
      const res = await fetch('/api/nas-bot/sync/status', {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) return;
      const data = await res.json();
      updateStatusUI(data);
    } catch (e) {
      console.warn('loadSyncStatus error:', e);
    }
  }

  function updateStatusUI(data) {
    if (!nasSyncStatusBadge) return;

    if (data.connected) {
      nasSyncStatusBadge.className = 'nvr-chip green';
      nasSyncStatusBadge.innerHTML = '<span class="dot green small"></span><span>🟢 NAS ออนไลน์ (เชื่อมต่อแล้ว)</span>';
    } else {
      nasSyncStatusBadge.className = 'nvr-chip yellow';
      nasSyncStatusBadge.innerHTML = '<span class="dot yellow small"></span><span>🟡 NAS รอเชื่อมต่อ / ออฟไลน์</span>';
    }

    if (nasHostLabel) nasHostLabel.textContent = data.nas_host || '-';
    if (nasShareLabel) nasShareLabel.textContent = data.nas_share || '-';
    if (nasPendingSyncCount) nasPendingSyncCount.textContent = `${data.pending_sync_count || 0} ไฟล์`;

    if (nasLastSyncTime) {
      if (data.last_sync_time) {
        const d = new Date(data.last_sync_time);
        nasLastSyncTime.textContent = d.toLocaleTimeString('th-TH');
      } else {
        nasLastSyncTime.textContent = 'ยังไม่มีรอบซิงค์';
      }
    }
  }

  async function testNasConnection() {
    if (!btnTestNasConn) return;
    btnTestNasConn.disabled = true;
    btnTestNasConn.textContent = 'กำลังทดสอบ...';

    try {
      const res = await fetch('/api/nas-bot/sync/test-connection', {
        method: 'POST',
        headers: { 'Accept': 'application/json' }
      });
      const data = await res.json();
      if (data.connected) {
        alert(`✅ เชื่อมต่อ Synology NAS สำเร็จ!\nHost: ${data.nas_host}\nShare: ${data.nas_share}\nUser: ${data.nas_user}`);
      } else {
        alert(`⚠️ ไม่สามารถติดต่อ NAS ได้ในขณะนี้\nรายละเอียด: ${data.error || 'Connection timed out'}\n\nระบบยังคงทำงานบน SSD ตามปกติ และจะเชื่อมต่ออัตโนมัติเมื่อ NAS เปิดทำงาน`);
      }
      loadSyncStatus();
    } catch (e) {
      alert(`❌ เกิดข้อผิดพลาดในการเชื่อมต่อ: ${e.message}`);
    } finally {
      btnTestNasConn.disabled = false;
      btnTestNasConn.textContent = '🔄 ทดสอบเชื่อมต่อใหม่';
    }
  }

  // --------------------------------------------------------------------------
  // Dates & Cameras Query
  // --------------------------------------------------------------------------

  let camerasData = [];
  let isCamerasLoaded = false;

  async function loadAvailableCameras() {
    if (!selArchiveCamera) return;
    if (isCamerasLoaded && selArchiveCamera.options.length > 1) return;

    try {
      const res = await fetch('/api/nas-bot/video-archive/cameras', {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      camerasData = data.groups || [];

      const currentVal = selArchiveCamera.value;
      selArchiveCamera.innerHTML = '';

      // Default option: all cameras
      const optAll = document.createElement('option');
      optAll.value = '';
      optAll.textContent = '🌐 ทุกกล้องในระบบ (ดูภาพรวมทั้งหมด)';
      selArchiveCamera.appendChild(optAll);

      camerasData.forEach(grp => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = `🏷️ ${grp.group_name} (${grp.cameras.length} กล้อง)`;

        grp.cameras.forEach(cam => {
          const opt = document.createElement('option');
          opt.value = cam.id;
          opt.textContent = cam.display;
          optgroup.appendChild(opt);
        });

        selArchiveCamera.appendChild(optgroup);
      });

      if (currentVal) {
        selArchiveCamera.value = currentVal;
      }
      isCamerasLoaded = true;
    } catch (e) {
      console.warn('loadAvailableCameras error:', e);
    }
  }

  async function loadAvailableDates() {
    if (!selArchiveDate) return;
    selArchiveDate.innerHTML = '<option value="">กำลังโหลดข้อมูลจากคลัง...</option>';

    const cam = selArchiveCamera ? selArchiveCamera.value : '';
    const queryUrl = `/api/nas-bot/video-archive/dates${cam ? '?camera=' + encodeURIComponent(cam) : ''}`;

    try {
      const res = await fetch(queryUrl, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      archiveDatesData = await res.json();

      // Populate Dates
      populateDatesDropdown();

    } catch (e) {
      selArchiveDate.innerHTML = '<option value="">ไม่สามารถโหลดรายการวันที่ได้</option>';
      console.error('loadAvailableDates error:', e);
    }
  }

  function populateDatesDropdown() {
    if (!selArchiveDate) return;
    selArchiveDate.innerHTML = '';

    if (!archiveDatesData || archiveDatesData.length === 0) {
      const camLabel = selArchiveCamera && selArchiveCamera.value ? `สำหรับกล้อง ${selArchiveCamera.value}` : '';
      selArchiveDate.innerHTML = `<option value="">ไม่พบไฟล์วิดีโอบันทึก${camLabel}</option>`;
      if (dateStorageTag) dateStorageTag.textContent = '';
      if (availableHoursHint) availableHoursHint.textContent = '';
      return;
    }

    archiveDatesData.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.date;

      let tag = '[⚡ SSD]';
      const loc = item.storage_location || '';
      if (loc.includes('ssd') && loc.includes('archive_e') && loc.includes('nas')) {
        tag = '[⚡ SSD + 💾 คลัง E + ☁️ NAS]';
      } else if (loc.includes('ssd') && loc.includes('archive_e')) {
        tag = '[⚡ SSD + 💾 คลัง E]';
      } else if (loc.includes('archive_e') && loc.includes('nas')) {
        tag = '[💾 คลัง E + ☁️ NAS]';
      } else if (loc.includes('ssd') && loc.includes('nas')) {
        tag = '[⚡ SSD + ☁️ NAS]';
      } else if (loc.includes('archive_e')) {
        tag = '[💾 คลังไดรฟ์ E]';
      } else if (loc.includes('nas')) {
        tag = '[☁️ Synology NAS]';
      }

      opt.textContent = `${item.date} ${tag} (${item.hours.length} ชม.)`;
      selArchiveDate.appendChild(opt);
    });

    onDateChanged();
  }

  function onCameraChanged() {
    // Dynamically query available dates specifically for the newly chosen camera
    loadAvailableDates();
  }

  function onDateChanged() {
    const selectedDate = selArchiveDate ? selArchiveDate.value : null;
    if (!selectedDate) {
      if (dateStorageTag) dateStorageTag.textContent = '';
      if (availableHoursHint) availableHoursHint.textContent = '';
      return;
    }

    const item = archiveDatesData.find(d => d.date === selectedDate);
    if (!item) return;

    if (dateStorageTag) {
      const loc = item.storage_location || '';
      const badges = [];

      if (loc.includes('ssd')) {
        badges.push('<span style="color:#34e2a8; background:rgba(52,226,168,0.15); padding:3px 8px; border-radius:6px; font-size:11.5px; border:1px solid rgba(52,226,168,0.3); margin-right:4px;">⚡ SSD D: (' + (item.ssd_hours || []).length + ' ชม.)</span>');
      }
      if (loc.includes('archive_e')) {
        badges.push('<span style="color:#f59e0b; background:rgba(245,158,11,0.15); padding:3px 8px; border-radius:6px; font-size:11.5px; border:1px solid rgba(245,158,11,0.3); margin-right:4px;">💾 คลังไดรฟ์ E: (' + (item.archive_e_hours || []).length + ' ชม.)</span>');
      }
      if (loc.includes('nas')) {
        badges.push('<span style="color:#60a5fa; background:rgba(96,165,250,0.15); padding:3px 8px; border-radius:6px; font-size:11.5px; border:1px solid rgba(96,165,250,0.3);">☁️ Synology NAS (' + (item.nas_hours || []).length + ' ชม.)</span>');
      }

      dateStorageTag.innerHTML = badges.join('') || '<span style="color:#94a3b8; font-size:11.5px;">-</span>';
    }

    if (availableHoursHint) {
      const hoursList = (item.hours || []).map(h => `${h.toString().padStart(2, '0')}:00`).join(', ');
      availableHoursHint.textContent = `ชั่วโมงที่มีไฟล์: ${hoursList || 'ไม่มี'}`;
    }

    // Auto-select valid range if available
    if (item.hours && item.hours.length > 0) {
      if (selArchiveStartHour) selArchiveStartHour.value = item.hours[0];
      if (selArchiveEndHour) selArchiveEndHour.value = item.hours[0];
    }
  }

  // --------------------------------------------------------------------------
  // Restore Execution & Polling
  // --------------------------------------------------------------------------

  async function startRestoreJob() {
    const camera = selArchiveCamera ? selArchiveCamera.value : null;
    const date = selArchiveDate ? selArchiveDate.value : null;
    const startHour = selArchiveStartHour ? parseInt(selArchiveStartHour.value, 10) : 0;
    const endHour = selArchiveEndHour ? parseInt(selArchiveEndHour.value, 10) : 0;
    const mode = radModeTimeline && radModeTimeline.checked ? 'timeline' : 'evidence';

    if (!camera || !date) {
      alert('กรุณาเลือกกล้องและวันที่ต้องการกู้คืน');
      return;
    }

    if (startHour > endHour) {
      alert('ชั่วโมงเริ่มต้นต้องน้อยกว่าหรือเท่ากับชั่วโมงสิ้นสุด');
      return;
    }

    if (btnStartRestore) {
      btnStartRestore.disabled = true;
      btnStartRestore.textContent = '⏳ กำลังส่งคำสั่ง...';
    }

    // Reset UI
    if (restoreProgressBox) restoreProgressBox.hidden = false;
    if (restoreProgressBar) restoreProgressBar.style.width = '5%';
    if (restoreProgressPct) restoreProgressPct.textContent = '5%';
    if (restoreProgressMsg) restoreProgressMsg.textContent = 'กำลังส่งคำสั่งกู้คืนวิดีโอไปยัง Engine...';
    if (restoreResultBox) restoreResultBox.hidden = true;

    try {
      const payload = {
        camera: camera,
        date: date,
        start_hour: startHour,
        end_hour: endHour,
        mode: mode
      };

      const res = await fetch('/api/nas-bot/video-archive/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();
      activeTaskId = data.task_id;

      // Start polling
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(pollRestoreStatus, 1500);

    } catch (e) {
      alert(`❌ ไม่สามารถเริ่มการกู้คืนได้: ${e.message}`);
      if (restoreProgressBox) restoreProgressBox.hidden = true;
      if (btnStartRestore) {
        btnStartRestore.disabled = false;
        btnStartRestore.textContent = '🚀 เริ่มการกู้คืนวิดีโอ';
      }
    }
  }

  async function pollRestoreStatus() {
    if (!activeTaskId) return;

    try {
      const res = await fetch(`/api/nas-bot/video-archive/status/${activeTaskId}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) return;

      const task = await res.json();
      const progress = task.progress || 0;

      if (restoreProgressBar) restoreProgressBar.style.width = `${progress}%`;
      if (restoreProgressPct) restoreProgressPct.textContent = `${progress}%`;
      if (restoreProgressMsg) restoreProgressMsg.textContent = task.message || 'กำลังประมวลผล...';

      if (task.status === 'completed') {
        clearInterval(pollTimer);
        pollTimer = null;
        onRestoreCompleted(task);
      } else if (task.status === 'failed') {
        clearInterval(pollTimer);
        pollTimer = null;
        onRestoreFailed(task);
      }
    } catch (e) {
      console.warn('pollRestoreStatus error:', e);
    }
  }

  function onRestoreCompleted(task) {
    if (btnStartRestore) {
      btnStartRestore.disabled = false;
      btnStartRestore.textContent = '🚀 เริ่มการกู้คืนวิดีโอ';
    }

    if (!restoreResultBox) return;
    restoreResultBox.hidden = false;

    if (task.mode === 'evidence') {
      const sizeMB = (task.size_bytes / (1024 * 1024)).toFixed(2);
      restoreResultBox.innerHTML = `
        <div style="background:rgba(52,226,168,0.1); border:1px solid rgba(52,226,168,0.3); border-radius:10px; padding:15px; margin-top:10px;">
          <div style="color:#34e2a8; font-weight:600; font-size:14px; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            รวมไฟล์วิดีโอหลักฐานสำเร็จ (${sizeMB} MB)
          </div>
          <div style="font-size:12px; color:#cbd5e1; margin-bottom:12px;">
            ไฟล์: <strong style="color:#fff;">${task.filename}</strong><br>
            คลิปวิดีโอถูกรวมเข้าด้วยกันแบบ Stream-Copy คมชัดสมบูรณ์ 100% พร้อมใช้งาน
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <a href="${task.download_url}" download="${task.filename}" class="btn-primary" style="text-decoration:none; padding:8px 16px; font-size:13px; font-weight:600; display:inline-flex; align-items:center; gap:6px; background:#10b981;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              ⬇️ ดาวน์โหลดไฟล์วิดีโอหลักฐาน MP4
            </a>
            <button id="btnPreviewVideo" class="btn-ghost" style="padding:8px 14px; font-size:12.5px;">
              👁️ เล่นดูตัวอย่างทันที
            </button>
          </div>
          <div id="videoPreviewContainer" style="margin-top:12px;" hidden>
            <video controls style="width:100%; max-height:360px; border-radius:8px; background:#000; outline:none;" src="${task.download_url}"></video>
          </div>
        </div>
      `;

      const btnPreview = document.getElementById('btnPreviewVideo');
      const vContainer = document.getElementById('videoPreviewContainer');
      if (btnPreview && vContainer) {
        btnPreview.addEventListener('click', () => {
          vContainer.hidden = !vContainer.hidden;
          if (!vContainer.hidden) {
            const v = vContainer.querySelector('video');
            if (v) v.play();
          }
        });
      }

    } else {
      // Timeline Mode
      restoreResultBox.innerHTML = `
        <div style="background:rgba(124,58,237,0.15); border:1px solid rgba(168,85,247,0.35); border-radius:10px; padding:15px; margin-top:10px;">
          <div style="color:#c084fc; font-weight:600; font-size:14px; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            กู้คืนคลิปกลับสู่ Timeline ของระบบสำเร็จ!
          </div>
          <div style="font-size:12px; color:#cbd5e1; margin-bottom:12px;">
            ไฟล์คลิปวิดีโอจาก NAS ได้รับการดาวน์โหลดกลับมาบรรจุลงในโฟลเดอร์ recordings บน SSD ของเครื่องแล้ว ท่านสามารถเปิดดูวิดีโอย้อนหลังผ่านแถบ Timeline ได้ตามปกติ
          </div>
          <button id="btnOpenTimelineFromRestore" class="btn-primary" style="padding:8px 16px; font-size:13px; font-weight:600;">
            📼 เปิดแถบ Timeline ตรวจสอบทันที
          </button>
        </div>
      `;

      const btnTimeline = document.getElementById('btnOpenTimelineFromRestore');
      if (btnTimeline) {
        btnTimeline.addEventListener('click', () => {
          closeModal();
          const mainTimelineBtn = document.getElementById('btnTimeline');
          if (mainTimelineBtn) mainTimelineBtn.click();
        });
      }
    }
  }

  function onRestoreFailed(task) {
    if (btnStartRestore) {
      btnStartRestore.disabled = false;
      btnStartRestore.textContent = '🚀 เริ่มการกู้คืนวิดีโอ';
    }

    if (!restoreResultBox) return;
    restoreResultBox.hidden = false;
    restoreResultBox.innerHTML = `
      <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:10px; padding:15px; margin-top:10px;">
        <div style="color:#f87171; font-weight:600; font-size:14px; margin-bottom:6px;">
          ❌ การกู้คืนไม่สำเร็จ
        </div>
        <div style="font-size:12px; color:#fca5a5;">
          ${task.error || task.message || 'เกิดข้อผิดพลาดในการประมวลผล'}
        </div>
      </div>
    `;
  }

  // Self-register on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
