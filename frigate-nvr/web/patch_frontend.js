const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');

// 1. Add #btnScanNvr before #btnSettings
const btnSettingsCode = `        <button id="btnSettings" class="icon-btn admin-only" title="ตั้งค่าระบบ"`;
const scanBtnCode = `        <!-- ปุ่ม NVR Auto-Discovery (Admin Only) -->
        <button id="btnScanNvr" class="icon-btn admin-only" title="ค้นหากล้องในเครือข่ายอัตโนมัติ (Auto-Discovery)" aria-label="ค้นหากล้องอัตโนมัติ" aria-pressed="false" hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            <line x1="11" y1="8" x2="11" y2="14"></line>
            <line x1="8" y1="11" x2="14" y2="11"></line>
          </svg>
        </button>
        <button id="btnSettings" class="icon-btn admin-only" title="ตั้งค่าระบบ"`;

if (!indexHtml.includes('btnScanNvr') && indexHtml.includes(btnSettingsCode)) {
  indexHtml = indexHtml.replace(btnSettingsCode, scanBtnCode);
} else {
  console.log('Skipping index.html button injection (already exists or target not found)');
}

// 2. Add Modal before </body>
const bodyEndCode = `</body>`;
const modalCode = `
    <!-- ========== NVR AUTO-DISCOVERY MODAL ========== -->
    <div id="scanNvrOverlay" class="overlay" hidden>
      <div class="modal scan-nvr-modal" role="dialog" aria-modal="true" aria-label="ค้นหากล้อง NVR อัตโนมัติ" style="width: 700px; max-width: 95vw;">
        <div class="modal-head">
          <div class="modal-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="11" y1="8" x2="11" y2="14"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </div>
          <div class="modal-head-text">
            <div class="modal-title">NVR Auto-Discovery Wizard</div>
            <div class="modal-sub">ค้นหาและเพิ่มกล้องจาก NVR เครือข่ายเข้าสู่ระบบอัตโนมัติ (รองรับสูงสุด 64 ช่อง)</div>
          </div>
          <button id="btnCloseScanNvr" class="modal-close" aria-label="ปิด">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        
        <div class="modal-body" style="display: flex; flex-direction: column; gap: 15px;">
          <!-- Section 1: NVR Connection Info -->
          <div style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
            <div style="font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 10px;">ข้อมูลเครื่อง NVR</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <label class="field">
                <span class="field-label">IP Address (Public/Local)</span>
                <input id="inpScanIp" class="inp mono" type="text" placeholder="e.g. 192.168.1.100 or public-ip.com">
              </label>
              <label class="field">
                <span class="field-label">RTSP Port (ค่าเริ่มต้น 554)</span>
                <input id="inpScanPort" class="inp mono" type="number" placeholder="554" value="554">
              </label>
              <label class="field">
                <span class="field-label">Username</span>
                <input id="inpScanUser" class="inp mono" type="text" placeholder="admin">
              </label>
              <label class="field">
                <span class="field-label">Password</span>
                <input id="inpScanPass" class="inp mono" type="password" placeholder="••••••••">
              </label>
              <label class="field">
                <span class="field-label">ยี่ห้อ (Brand)</span>
                <select id="inpScanBrand" class="inp">
                  <option value="vigi">TP-Link VIGI</option>
                  <option value="dahua">Dahua</option>
                  <option value="hikvision">Hikvision</option>
                </select>
              </label>
              <div style="display: flex; align-items: flex-end;">
                <button id="btnStartScan" class="btn-primary" style="width: 100%; height: 38px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  เริ่มค้นหากล้อง (Scan)
                </button>
              </div>
            </div>
          </div>

          <!-- Section 2: Grouping Info -->
          <div style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
            <div style="font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 10px;">การจัดกลุ่มกล้อง (Grouping)</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <label class="field">
                <span class="field-label">รหัสหน่วยงาน (Unit Code)</span>
                <input id="inpScanUnitCode" class="inp" type="text" placeholder="เช่น BPP215" value="BPP215">
              </label>
              <label class="field">
                <span class="field-label">กลุ่มย่อย (Camera Group)</span>
                <input id="inpScanGroup" class="inp" type="text" placeholder="เช่น อาคาร A, ป้อมหน้า">
              </label>
            </div>
          </div>

          <!-- Section 3: Scan Results -->
          <div style="flex: 1; min-height: 250px; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column;">
            <div style="padding: 10px 15px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 13px; font-weight: 600; color: #a78bfa;">ผลการค้นหา</span>
              <label style="font-size: 13px; display: flex; align-items: center; gap: 6px; cursor: pointer; color: #cbd5e1;">
                <input type="checkbox" id="chkSelectAllScan" disabled> เลือกทั้งหมด
              </label>
            </div>
            <div id="scanResultsList" style="padding: 10px; overflow-y: auto; flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; max-height: 300px; align-items: start; align-content: start;">
              <div style="grid-column: 1 / -1; text-align: center; color: #666; padding: 20px; font-size: 13px;">กรุณากรอกข้อมูลและกดปุ่ม Scan...</div>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
            <button id="btnCancelScan" class="btn-ghost">ยกเลิก</button>
            <button id="btnSubmitScan" class="btn-primary" disabled>นำเข้ากล้องที่เลือก</button>
          </div>
        </div>
      </div>
    </div>
</body>`;

if (!indexHtml.includes('id="scanNvrOverlay"')) {
  indexHtml = indexHtml.replace(bodyEndCode, modalCode);
} else {
  console.log('Skipping modal injection (already exists)');
}

fs.writeFileSync(indexPath, indexHtml, 'utf8');
console.log('index.html patched');

// Now for app.js
const appPath = path.join(__dirname, 'assets', 'app.js');
let appJs = fs.readFileSync(appPath, 'utf8');

// I will find a good place to inject the logic.
// A safe place is just before the bottom `})();` IIFE closing, or right after settings modal handlers.
// Let's search for "btnSettings" listener
const listenerSearch = `$('btnSettings').addEventListener('click', openSettings);`;

const scanLogic = `
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

  function openScanNvrModal() {
    scanNvrOverlay.hidden = false;
    currentScanResults = [];
    scanResultsList.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #666; padding: 20px; font-size: 13px;">กรุณากรอกข้อมูลและกดปุ่ม Scan...</div>';
    chkSelectAllScan.disabled = true;
    chkSelectAllScan.checked = false;
    btnSubmitScan.disabled = true;
    
    // Default group info based on settings if needed
    const defaultUnit = localStorage.getItem('defaultUnitCode') || 'BPP215';
    $('inpScanUnitCode').value = defaultUnit;
  }
  
  function closeScanNvrModal() {
    scanNvrOverlay.hidden = true;
  }
  
  if (btnScanNvr) btnScanNvr.addEventListener('click', openScanNvrModal);
  if (btnCloseScanNvr) btnCloseScanNvr.addEventListener('click', closeScanNvrModal);
  if (btnCancelScan) btnCancelScan.addEventListener('click', closeScanNvrModal);
  
  if (btnStartScan) {
    btnStartScan.addEventListener('click', async () => {
      const ip = $('inpScanIp').value.trim();
      const port = parseInt($('inpScanPort').value.trim() || '554', 10);
      const username = $('inpScanUser').value.trim();
      const password = $('inpScanPass').value.trim();
      const brand = $('inpScanBrand').value;
      
      if (!ip || !username || !password) {
        alert('กรุณากรอก IP, Username, และ Password ให้ครบถ้วน');
        return;
      }
      
      btnStartScan.disabled = true;
      btnStartScan.innerHTML = '<div class="spinner small" style="margin-right:8px;"></div> กำลังสแกน...';
      scanResultsList.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #60a5fa; padding: 20px; font-size: 13px;"><div class="spinner" style="margin-bottom:10px;"></div><br>กำลังทดสอบเชื่อมต่อทุกช่อง (1-64)... อาจใช้เวลาสักครู่</div>';
      
      try {
        const resp = await fetch('/api/config/scan_nvr', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            nvr_ip: ip,
            nvr_port: port,
            username: username,
            password: password,
            brand: brand
          })
        });
        
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        
        if (data.status === 'success') {
          currentScanResults = data.found_channels || [];
          renderScanResults();
        } else {
          throw new Error(data.message || 'Scan failed');
        }
      } catch (err) {
        console.error(err);
        scanResultsList.innerHTML = \`<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 20px; font-size: 13px;">\${escapeHtml(err.message)}</div>\`;
      } finally {
        btnStartScan.disabled = false;
        btnStartScan.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> เริ่มค้นหากล้อง (Scan)';
      }
    });
  }
  
  function renderScanResults() {
    if (!currentScanResults || currentScanResults.length === 0) {
      scanResultsList.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #a8a29e; padding: 20px; font-size: 13px;">ไม่พบกล้องที่สามารถเชื่อมต่อได้</div>';
      chkSelectAllScan.disabled = true;
      btnSubmitScan.disabled = true;
      return;
    }
    
    chkSelectAllScan.disabled = false;
    chkSelectAllScan.checked = true;
    
    scanResultsList.innerHTML = '';
    currentScanResults.forEach((ch, idx) => {
      const label = document.createElement('label');
      label.style.display = 'flex';
      label.style.flexDirection = 'column';
      label.style.gap = '5px';
      label.style.background = 'rgba(255,255,255,0.04)';
      label.style.padding = '10px';
      label.style.borderRadius = '6px';
      label.style.border = '1px solid rgba(255,255,255,0.08)';
      label.style.cursor = 'pointer';
      
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
      title.innerText = \`Channel \${ch.channel}\`;
      
      checkRow.appendChild(chk);
      checkRow.appendChild(title);
      
      const infoRow = document.createElement('div');
      infoRow.style.fontSize = '11px';
      infoRow.style.color = '#a8a29e';
      infoRow.style.paddingLeft = '22px'; // Align under title
      infoRow.innerText = \`\${ch.video_codec || 'N/A'} • \${ch.resolution || 'N/A'}\`;
      
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
    btnSubmitScan.innerText = checked > 0 ? \`นำเข้ากล้องที่เลือก (\${checked} ช่อง)\` : 'นำเข้ากล้องที่เลือก';
  }
  
  if (btnSubmitScan) {
    btnSubmitScan.addEventListener('click', async () => {
      const ip = $('inpScanIp').value.trim();
      const port = parseInt($('inpScanPort').value.trim() || '554', 10);
      const username = $('inpScanUser').value.trim();
      const password = $('inpScanPass').value.trim();
      const brand = $('inpScanBrand').value;
      const unitCode = $('inpScanUnitCode').value.trim();
      const groupName = $('inpScanGroup').value.trim();
      
      const selectedIndexes = Array.from(document.querySelectorAll('.scan-ch-checkbox:checked')).map(c => parseInt(c.dataset.chIndex, 10));
      const selectedChannels = selectedIndexes.map(idx => currentScanResults[idx]);
      
      if (selectedChannels.length === 0) return;
      
      if (!confirm(\`คุณต้องการเพิ่มกล้องจำนวน \${selectedChannels.length} ช่อง เข้าระบบใช่หรือไม่?\`)) {
        return;
      }
      
      btnSubmitScan.disabled = true;
      btnSubmitScan.innerHTML = '<div class="spinner small" style="margin-right:8px;"></div> กำลังเพิ่ม...';
      
      try {
        const resp = await fetch('/api/config/batch_add_cameras', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            nvr_ip: ip,
            nvr_port: port,
            username: username,
            password: password,
            brand: brand,
            unit_code: unitCode,
            camera_group: groupName,
            selected_channels: selectedChannels
          })
        });
        
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        
        alert(\`นำเข้ากล้องสำเร็จ!\n\${data.message || ''}\nระบบกำลังรีสตาร์ทตัวเองเพื่อโหลดค่าใหม่ กรุณารอสักครู่และรีเฟรชหน้าเว็บ\`);
        closeScanNvrModal();
        if (typeof openSettings === 'function') {
           // Optionally reopen settings or refresh
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
`;

if (!appJs.includes('scanNvrOverlay') && appJs.includes(listenerSearch)) {
  appJs = appJs.replace(listenerSearch, listenerSearch + '\\n' + scanLogic);
  fs.writeFileSync(appPath, appJs, 'utf8');
  console.log('app.js patched');
} else {
  console.log('Skipping app.js injection (already exists or target not found)');
}
