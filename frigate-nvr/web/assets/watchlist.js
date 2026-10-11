(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // --- Watchlist Elements ---
  const tbody = $('wlTableBody');
  const count = $('wlCount');
  const empty = $('wlEmpty');
  const btnWatchlist = $('btnWatchlist');
  const btnWlAdd = $('btnWlAdd');
  const wlFormOverlay = $('wlFormOverlay');
  const btnCloseWlForm = $('btnCloseWlForm');
  const btnWlFormClose2 = $('btnWlFormClose2');
  const btnWlFormSave = $('btnWlFormSave');
  const wlFormTitle = $('wlFormTitle');
  const wlFormMsg = $('wlFormMsg');
  const wlSearch = $('wlSearch');
  const btnWlSearchClear = $('btnWlSearchClear');
  const btnWlRefresh = $('btnWlRefresh');

  // Form Fields
  const fId = $('wlFormId');
  const fPlatePrefix = $('wlFPlatePrefix');
  const fPlateNumber = $('wlFPlateNumber');
  const fProvince = $('wlFProvince');
  const fPreviewKey = $('wlFPreviewKey');
  const fPreviewDisplay = $('wlFPreviewDisplay');
  const fPlate = $('wlFPlate');
  const fPlateDisplay = $('wlFPlateDisplay');
  const fOwnerName = $('wlFOwnerName');
  const fUserName = $('wlFUserName');
  const fOwnerAddr = $('wlFOwnerAddr');
  const fPhone = $('wlFPhone');
  const fNetwork = $('wlFNetwork');
  const fDanger = $('wlFDanger');
  const fCriminal = $('wlFCriminal');
  const fNotes = $('wlFNotes');
  const fActive = $('wlFActive');

  const THAI_PROVINCES = window.THAI_PROVINCES || [
    'กรุงเทพมหานคร','กระบี่','กาญจนบุรี','กาฬสินธุ์','กำแพงเพชร','ขอนแก่น','จันทบุรี','ฉะเชิงเทรา','ชลบุรี','ชัยนาท','ชัยภูมิ','ชุมพร','เชียงราย','เชียงใหม่','ตรัง','ตราด','ตาก','นครนายก','นครปฐม','นครพนม','นครราชสีมา','นครศรีธรรมราช','นครสวรรค์','นนทบุรี','นราธิวาส','น่าน','บึงกาฬ','บุรีรัมย์','ปทุมธานี','ประจวบคีรีขันธ์','ปราจีนบุรี','ปัตตานี','พระนครศรีอยุธยา','พะเยา','พังงา','พัทลุง','พิจิตร','พิษณุโลก','เพชรบุรี','เพชรบูรณ์','แพร่','ภูเก็ต','มหาสารคาม','มุกดาหาร','แม่ฮ่องสอน','ยโสธร','ยะลา','ร้อยเอ็ด','ระนอง','ระยอง','ราชบุรี','ลพบุรี','ลำปาง','ลำพูน','เลย','ศรีสะเกษ','สกลนคร','สงขลา','สตูล','สมุทรปราการ','สมุทรสงคราม','สมุทรสาคร','สระแก้ว','สระบุรี','สิงห์บุรี','สุโขทัย','สุพรรณบุรี','สุราษฎร์ธานี','สุรินทร์','หนองคาย','หนองบัวลำภู','อ่างทอง','อำนาจเจริญ','อุดรธานี','อุตรดิตถ์','อุทัยธานี','อุบลราชธานี'
  ];

  function initProvinceSelect() {
    if (!fProvince || fProvince.options.length > 1) return;
    THAI_PROVINCES.forEach(prov => {
      const opt = document.createElement('option');
      opt.value = prov;
      opt.textContent = prov;
      fProvince.appendChild(opt);
    });
  }

  function detectProvinceFromText(text) {
    if (!text) return '';
    for (const p of THAI_PROVINCES) {
      if (text.includes(p)) return p;
    }
    return '';
  }

  function parsePlateString(plateStr) {
    if (!plateStr) return { prefix: '', number: '' };
    const s = plateStr.trim();
    // แยกหมวดอักษรและตัวเลข 1-4 หลักท้ายป้าย
    const match = s.match(/^(.*?)[\s-]*([0-9]{1,4})$/);
    if (match && match[1]) {
      return { prefix: match[1].trim(), number: match[2].trim() };
    }
    if (/^[0-9]+$/.test(s)) {
      return { prefix: '', number: s };
    }
    return { prefix: s, number: '' };
  }

  function extractPlateFields(item) {
    let prov = item.province || detectProvinceFromText(item.plate_display) || '';
    let text = (item.plate || '').trim();
    let parsed = parsePlateString(text);

    // กรณีข้อมูลเก่าที่ตัวเลขค้างอยู่ใน plate_display
    if (!parsed.number && item.plate_display) {
      let disp = item.plate_display.trim();
      if (prov) disp = disp.replace(prov, '').trim();
      const dispParsed = parsePlateString(disp);
      if (dispParsed.number) parsed.number = dispParsed.number;
      if (!parsed.prefix && dispParsed.prefix) parsed.prefix = dispParsed.prefix;
    }
    return { prefix: parsed.prefix, number: parsed.number, province: prov };
  }

  function updatePlatePreview() {
    const rawPrefix = fPlatePrefix ? fPlatePrefix.value.trim() : '';
    const rawNum = fPlateNumber ? fPlateNumber.value.trim() : '';
    const prov = fProvince ? fProvince.value.trim() : '';

    const normPrefix = rawPrefix.replace(/[^ก-ฮA-Za-z0-9]/g, '').toUpperCase();
    const normNum = rawNum.replace(/[^0-9]/g, '');
    const key = normPrefix + normNum;

    let display = '';
    if (rawPrefix && rawNum) {
      display = `${rawPrefix} ${rawNum}${prov ? ' ' + prov : ''}`;
    } else if (rawPrefix || rawNum) {
      display = `${rawPrefix || rawNum}${prov ? ' ' + prov : ''}`;
    }

    if (fPreviewKey) fPreviewKey.textContent = key || '-';
    if (fPreviewDisplay) fPreviewDisplay.textContent = display || '-';

    if (fPlate) fPlate.value = key;
    if (fPlateDisplay) fPlateDisplay.value = display;
  }

  let watchlistData = [];

  // --- Chart Instances ---
  let chartCam = null;
  let chartHr = null;
  let chartDy = null;

  // ==========================================
  // LOAD WATCHLIST
  // ==========================================
  /**
   * Load authorized watchlist records and render every persisted field as text.
   * Side effects are replacing table rows and binding local action handlers.
   */
  async function loadWatchlist() {
    if (!tbody) return;
    
    try {
      const res = await fetch('/api/watchlist');
      if (!res.ok) throw new Error('API Error');
      watchlistData = await res.json();
      renderWatchlistTable(wlSearch ? wlSearch.value.trim() : '');
    } catch (e) {
      console.error('Failed to load watchlist', e);
    }
  }

  function renderWatchlistTable(filterQuery = '') {
    if (!tbody) return;
    tbody.replaceChildren();

    const q = (filterQuery || '').trim().toLowerCase();
    const filtered = !q ? watchlistData : watchlistData.filter(item => {
      const plate = (item.plate || '').toLowerCase();
      const disp = (item.plate_display || '').toLowerCase();
      const prov = (item.province || '').toLowerCase();
      const owner = (item.owner_name || '').toLowerCase();
      const user = (item.user_name || '').toLowerCase();
      const net = (item.network || '').toLowerCase();
      const danger = (item.danger_level || '').toLowerCase();
      const notes = (item.notes || '').toLowerCase();
      return plate.includes(q) || disp.includes(q) || prov.includes(q) ||
             owner.includes(q) || user.includes(q) || net.includes(q) ||
             danger.includes(q) || notes.includes(q);
    });

    if (watchlistData.length === 0) {
      empty.hidden = false;
      count.textContent = '0 รายการ';
      return;
    }

    empty.hidden = true;
    if (q) {
      count.textContent = `${filtered.length} / ${watchlistData.length} รายการ`;
    } else {
      count.textContent = `${watchlistData.length} รายการ`;
    }

    if (filtered.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 6;
      emptyCell.style.textAlign = 'center';
      emptyCell.style.color = '#6b7099';
      emptyCell.style.padding = '24px';
      emptyCell.textContent = 'ไม่พบข้อมูลที่ตรงกับคำค้นหา';
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    // Watchlist fields are persisted operator input. Build rows with DOM
    // nodes and textContent so no stored value is ever parsed as markup.
    filtered.forEach(item => {
      const dangerColor = item.danger_level === 'critical' ? '#fb5b78' : 
                          item.danger_level === 'high' ? '#fb923c' : 
                          item.danger_level === 'low' ? '#34e2a8' : '#fbbf24';

      const row = document.createElement('tr');
      row.className = 'wl-row-main';
      const plateCell = document.createElement('td');
      const plateChip = document.createElement('div');
      plateChip.className = 'wl-plate-chip';
      let disp = item.plate_display || item.plate || '';
      if (item.province && !disp.includes(item.province)) {
        disp += ' ' + item.province;
      }
      plateChip.textContent = disp;
      plateCell.appendChild(plateChip);
      const ownerCell = document.createElement('td');
      ownerCell.style.fontWeight = '500';
      ownerCell.style.color = '#eef0f8';
      ownerCell.textContent = item.owner_name || '-';
      const networkCell = document.createElement('td');
      networkCell.style.fontWeight = '500';
      networkCell.style.color = '#eef0f8';
      networkCell.textContent = item.network || '-';
      const dangerCell = document.createElement('td');
      dangerCell.style.color = dangerColor;
      dangerCell.style.fontWeight = '500';
      dangerCell.textContent = String(item.danger_level || 'medium').toUpperCase();
      const statusCell = document.createElement('td');
      statusCell.innerHTML = item.active
        ? '<span style="display:inline-flex;align-items:center;gap:5px;color:#34e2a8;"><svg width="8" height="8" viewBox="0 0 24 24" fill="#34e2a8" stroke="none"><circle cx="12" cy="12" r="10"/></svg>ใช้งาน</span>'
        : '<span style="display:inline-flex;align-items:center;gap:5px;color:#fb5b78;"><svg width="8" height="8" viewBox="0 0 24 24" fill="#fb5b78" stroke="none"><circle cx="12" cy="12" r="10"/></svg>ระงับ</span>';
      const actionsCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';
      actions.style.flexWrap = 'nowrap';

      // Button icons are fixed application markup; record identifiers are
      // assigned through dataset properties and never interpolated into HTML.
      const editButton = document.createElement('button');
      editButton.className = 'icon-btn btn-edit';
      editButton.title = 'ดูรายละเอียด/แก้ไข';
      editButton.dataset.id = String(item.id);
      editButton.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
      editButton.addEventListener('click', () => openWlForm(Number(item.id)));
      const deleteButton = document.createElement('button');
      deleteButton.className = 'icon-btn btn-del';
      deleteButton.title = 'ลบ';
      deleteButton.style.color = '#fb5b78';
      deleteButton.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
      deleteButton.addEventListener('click', () => deleteWatchlist(item.id, item.plate));
      const statsButton = document.createElement('button');
      statsButton.className = 'icon-btn btn-stats';
      statsButton.title = 'วิเคราะห์พฤติกรรม';
      statsButton.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>';
      statsButton.addEventListener('click', () => openBehaviorStats(item.plate));
      // Mirror server RBAC in presentation: authenticated operators retain
      // analysis access, while only the verified admin session sees mutation.
      if (window.bppSession && ['admin', 'superadmin'].includes(window.bppSession.role)) {
        actions.append(editButton, deleteButton);
      }
      actions.appendChild(statsButton);
      actionsCell.appendChild(actions);
      row.append(plateCell, ownerCell, networkCell, dangerCell, statusCell, actionsCell);
      tbody.appendChild(row);
    });
  }

  // ==========================================
  // CRUD LOGIC
  // ==========================================
  function openWlForm(id) {
    initProvinceSelect();
    wlFormMsg.textContent = '';
    wlFormMsg.className = 'sync-msg';
    
    // ปลดล็อกช่องทะเบียนเสมอ สามารถแก้ไขได้ตลอดเวลา
    if (fPlatePrefix) fPlatePrefix.disabled = false;
    if (fPlateNumber) fPlateNumber.disabled = false;
    if (fProvince) fProvince.disabled = false;

    if (id) {
      const item = watchlistData.find(x => x.id === id);
      if (item) {
        wlFormTitle.textContent = 'แก้ไขทะเบียนเฝ้าระวัง';
        fId.value = item.id;
        const extracted = extractPlateFields(item);
        if (fPlatePrefix) fPlatePrefix.value = extracted.prefix;
        if (fPlateNumber) fPlateNumber.value = extracted.number;
        if (fProvince) fProvince.value = extracted.province;
        if (fOwnerName) fOwnerName.value = item.owner_name || '';
        if (fUserName) fUserName.value = item.user_name || '';
        if (fOwnerAddr) fOwnerAddr.value = item.owner_address || '';
        if (fPhone) fPhone.value = item.phone || '';
        if (fNetwork) fNetwork.value = item.network || '';
        if (fDanger) fDanger.value = item.danger_level || 'medium';
        if (fCriminal) fCriminal.value = item.criminal_history || '';
        if (fNotes) fNotes.value = item.notes || '';
        if (fActive) {
          if (fActive.tagName === 'SELECT') fActive.value = String(item.active ?? 1);
          else fActive.checked = item.active === 1;
        }
      }
    } else {
      wlFormTitle.textContent = 'เพิ่มทะเบียนเฝ้าระวัง';
      fId.value = '';
      if (fPlatePrefix) fPlatePrefix.value = '';
      if (fPlateNumber) fPlateNumber.value = '';
      if (fProvince) fProvince.value = '';
      if (fOwnerName) fOwnerName.value = '';
      if (fUserName) fUserName.value = '';
      if (fOwnerAddr) fOwnerAddr.value = '';
      if (fPhone) fPhone.value = '';
      if (fNetwork) fNetwork.value = '';
      if (fDanger) fDanger.value = 'medium';
      if (fCriminal) fCriminal.value = '';
      if (fNotes) fNotes.value = '';
      if (fActive) {
        if (fActive.tagName === 'SELECT') fActive.value = '1';
        else fActive.checked = true;
      }
    }
    updatePlatePreview();
    wlFormOverlay.hidden = false;
  }

  async function saveWatchlist() {
    const rawPrefix = fPlatePrefix ? fPlatePrefix.value.trim() : '';
    const rawNum = fPlateNumber ? fPlateNumber.value.trim() : '';
    const prov = fProvince ? fProvince.value.trim() : '';

    if (!rawPrefix) {
      wlFormMsg.textContent = 'กรุณาระบุหมวดอักษร (เช่น ผท, 1กข)';
      wlFormMsg.className = 'sync-msg error';
      if (fPlatePrefix) fPlatePrefix.focus();
      return;
    }
    if (!rawNum) {
      wlFormMsg.textContent = 'กรุณาระบุหมายเลขทะเบียน (เช่น 1959)';
      wlFormMsg.className = 'sync-msg error';
      if (fPlateNumber) fPlateNumber.focus();
      return;
    }

    const normPrefix = rawPrefix.replace(/[^ก-ฮA-Za-z0-9]/g, '').toUpperCase();
    const normNum = rawNum.replace(/[^0-9]/g, '');
    const plateKey = normPrefix + normNum;

    if (plateKey.length < 2 || plateKey.length > 20) {
      wlFormMsg.textContent = 'ป้ายทะเบียนต้องมีความยาว 2-20 ตัวอักษร';
      wlFormMsg.className = 'sync-msg error';
      return;
    }
    if (false) {
      wlFormMsg.textContent = 'ป้ายทะเบียนต้องมีอย่างน้อย 2 ตัวอักษร';
      wlFormMsg.className = 'sync-msg error';
      return;
    }

    const plateDisplay = `${rawPrefix} ${rawNum}${prov ? ' ' + prov : ''}`;

    if ($('wlFormSpin')) $('wlFormSpin').hidden = false;
    if ($('wlFormSaveLabel')) $('wlFormSaveLabel').textContent = 'กำลังบันทึก...';
    btnWlFormSave.disabled = true;

    const isEdit = fId.value !== '';
    const activeVal = fActive ? (fActive.tagName === 'SELECT' ? Number(fActive.value) : (fActive.checked ? 1 : 0)) : 1;

    const payload = {
      plate: plateKey,
      plate_display: plateDisplay,
      province: prov || null,
      danger_level: fDanger ? fDanger.value : 'medium',
      active: activeVal
    };
    if (fOwnerName) payload.owner_name = fOwnerName.value.trim().substring(0, 100);
    if (fUserName) payload.user_name = fUserName.value.trim().substring(0, 100);
    if (fOwnerAddr) payload.owner_address = fOwnerAddr.value.trim().substring(0, 255);
    if (fPhone) payload.phone = fPhone.value.trim().substring(0, 50);
    if (fNetwork) payload.network = fNetwork.value.trim().substring(0, 100);
    if (fCriminal) payload.criminal_history = fCriminal.value.trim().substring(0, 1000);
    if (fNotes) payload.notes = fNotes.value.trim().substring(0, 1000);

    try {
      const url = isEdit ? `/api/watchlist/${fId.value}` : '/api/watchlist';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let errDetail = 'บันทึกข้อมูลไม่สำเร็จ';
        try {
          const errorText = await res.text();
          try {
            const errJson = JSON.parse(errorText);
            if (errJson && errJson.detail) errDetail = errJson.detail;
            else errDetail = errorText;
          } catch (_) {
            errDetail = errorText;
          }
        } catch (readErr) {
          console.error("Failed to read error response", readErr);
        }
        throw new Error(errDetail);
      }

      wlFormOverlay.hidden = true;
      loadWatchlist();

    } catch (e) {
      console.error(e);
      wlFormMsg.textContent = 'ข้อผิดพลาด: ' + e.message;
      wlFormMsg.className = 'sync-msg error';
    } finally {
      if ($('wlFormSpin')) $('wlFormSpin').hidden = true;
      if ($('wlFormSaveLabel')) $('wlFormSaveLabel').textContent = 'บันทึก';
      btnWlFormSave.disabled = false;
    }
  }

  async function deleteWatchlist(id, plate) {
    const confirmMsg = `ยืนยันการลบทะเบียน ${plate} ออกจากระบบ?`;
    const ok = window.bppConfirm ? await window.bppConfirm(confirmMsg) : confirm(confirmMsg);
    if (!ok) return;
    try {
      const res = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('API Error');
      loadWatchlist();
    } catch (e) {
      if (window.bppToast) window.bppToast('Failed to delete: ' + e.message, true);
      else alert('Failed to delete: ' + e.message);
    }
  }

  // ==========================================
  // BEHAVIOR STATS DASHBOARD (CHART.JS)
  // ==========================================
  const DOW_LABELS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสฯ', 'ศุกร์', 'เสาร์'];

  /**
   * Open the selected plate's profile, aggregate charts, and history.
   * The plate chooses API records; all returned strings are inserted as text
   * while Chart.js receives numeric/category data through its object API.
   */
  async function openBehaviorStats(plate) {
    $('wlStatsPlateTitle').textContent = plate;
    $('wlStatsOverlay').hidden = false;

    // --- Populate Target Profile ---
    const profileDiv = $('wlStatsProfile');
    if (profileDiv) {
      const item = watchlistData.find(x => x.plate === plate);
      profileDiv.replaceChildren();
      if (item) {
        // Profile data is particularly sensitive and user-controlled. Keep
        // labels trusted but insert every stored value through textContent.
        [
          ['ชื่อผู้ครอบครอง:', item.owner_name, false, false],
          ['ผู้ใช้งาน:', item.user_name, false, false],
          ['จังหวัด:', item.province, false, false],
          ['เครือข่าย:', item.network, false, false],
          ['เบอร์โทร:', item.phone, false, false],
          ['ที่อยู่:', item.owner_address, true, false],
          ['ประวัติอาชญากรรม:', item.criminal_history, true, true],
          ['หมายเหตุ:', item.notes, true, false]
        ].forEach(([label, value, fullWidth, danger]) => {
          const field = document.createElement('div');
          if (fullWidth) field.style.gridColumn = '1/-1';
          const heading = document.createElement('strong');
          heading.style.color = danger ? '#fb5b78' : '#eef0f8';
          heading.textContent = label + ' ';
          field.appendChild(heading);
          field.appendChild(document.createTextNode(value || '-'));
          profileDiv.appendChild(field);
        });
      } else {
        const noProfile = document.createElement('div');
        noProfile.textContent = 'ไม่มีข้อมูลประวัติผู้ครอบครอง';
        profileDiv.appendChild(noProfile);
      }
    }

    // Set global Chart defaults for dark mode if not already set
    if (window.Chart && !window.Chart.defaults._bppSet) {
      window.Chart.defaults._bppSet = true;
      window.Chart.defaults.color = '#9aa0bd';
      window.Chart.defaults.font.family = "'Kanit', sans-serif";
      window.Chart.defaults.scale.grid.color = 'rgba(255,255,255,0.05)';
    }
    
    try {
      // 1. Fetch Stats
      const resStats = await fetch('/api/watchlist/' + encodeURIComponent(plate) + '/stats');
      if (resStats.ok) {
        const stats = await resStats.json();
        
        // --- Render Camera Donut Chart ---
        const camCtx = $('chartCamera');
        if (chartCam) chartCam.destroy();
        if (stats.by_camera.length > 0 && window.Chart) {
          chartCam = new Chart(camCtx, {
            type: 'doughnut',
            data: {
              labels: stats.by_camera.map(r => r.camera),
              datasets: [{
                data: stats.by_camera.map(r => r.count),
                backgroundColor: ['#a855f7', '#fb923c', '#34e2a8', '#fb5b78', '#3b82f6', '#facc15'],
                borderWidth: 0
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: window.innerWidth < 768 ? 'bottom' : 'right',
                  labels: { boxWidth: 10, padding: 8, font: { size: window.innerWidth < 768 ? 10 : 11 } }
                }
              },
              cutout: '65%'
            }
          });
        }
        
        // --- Render Hourly Bar Chart ---
        const hrCtx = $('chartHour');
        if (chartHr) chartHr.destroy();
        if (stats.by_hour.length > 0 && window.Chart) {
          // Fill missing hours
          let hrData = new Array(24).fill(0);
          stats.by_hour.forEach(r => {
            hrData[parseInt(r.hour)] = r.count;
          });
          chartHr = new Chart(hrCtx, {
            type: 'bar',
            data: {
              labels: Array.from({length: 24}, (_, i) => i.toString().padStart(2, '0') + ':00'),
              datasets: [{
                label: 'ความถี่ (ครั้ง)',
                data: hrData,
                backgroundColor: 'rgba(168,85,247,0.7)',
                borderRadius: 4
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: {
                  ticks: {
                    autoSkip: true,
                    maxTicksLimit: window.innerWidth < 768 ? 8 : 24,
                    maxRotation: 45,
                    minRotation: 0,
                    font: { size: window.innerWidth < 768 ? 9 : 11 }
                  }
                },
                y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } }
              }
            }
          });
        }

        // --- Render Day of Week Bar Chart ---
        const dyCtx = $('chartDay');
        if (chartDy) chartDy.destroy();
        if (stats.by_day.length > 0 && window.Chart) {
          let dyData = new Array(7).fill(0);
          stats.by_day.forEach(r => {
            dyData[parseInt(r.dow)] = r.count;
          });
          chartDy = new Chart(dyCtx, {
            type: 'bar',
            data: {
              labels: DOW_LABELS,
              datasets: [{
                label: 'ความถี่ (ครั้ง)',
                data: dyData,
                backgroundColor: 'rgba(52,226,168,0.7)',
                borderRadius: 4
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: {
                  ticks: {
                    font: { size: window.innerWidth < 768 ? 9.5 : 11 }
                  }
                },
                y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } }
              }
            }
          });
        }
      }
      
      // 2. Fetch History List
      const resHist = await fetch('/api/watchlist/' + encodeURIComponent(plate) + '/history');
      if (resHist.ok) {
        const history = await resHist.json();
        const tbodyH = $('wlStatsHistoryBody');
        if (tbodyH) {
            tbodyH.replaceChildren();
            if (history.length === 0) {
              const emptyRow = document.createElement('tr');
              const emptyCell = document.createElement('td');
              emptyCell.colSpan = 3;
              emptyCell.style.textAlign = 'center';
              emptyCell.style.color = '#6b7099';
              emptyCell.style.padding = '20px';
              emptyCell.textContent = 'ไม่มีประวัติการวิ่งผ่านในระบบ';
              emptyRow.appendChild(emptyCell);
              tbodyH.appendChild(emptyRow);
            } else {
              history.forEach(r => {
                const row = document.createElement('tr');
                
                // Col 1: Time
                const tdTime = document.createElement('td');
                tdTime.textContent = String(r.detected_at ?? '-');
                row.appendChild(tdTime);

                // Col 2: Camera
                const tdCam = document.createElement('td');
                tdCam.textContent = String(r.camera ?? '-');
                row.appendChild(tdCam);

                // Col 3: Confidence & Match Tier / Observed Plate
                const tdConf = document.createElement('td');
                const confVal = r.confidence != null ? (r.confidence <= 1 ? r.confidence * 100 : r.confidence) : null;
                const confText = document.createElement('div');
                confText.style.fontWeight = '500';
                confText.textContent = confVal != null ? confVal.toFixed(1) + '%' : '-';
                tdConf.appendChild(confText);

                if (r.match_tier === 'letters_partial') {
                  const badge = document.createElement('div');
                  badge.style.fontSize = '10px';
                  badge.style.marginTop = '2px';
                  badge.style.color = '#fb923c';
                  badge.style.whiteSpace = 'nowrap';
                  badge.textContent = `🟠 ${r.observed_plate || '-'} (ตรงบางส่วน)`;
                  tdConf.appendChild(badge);
                } else if (r.match_tier === 'exact') {
                  const badge = document.createElement('div');
                  badge.style.fontSize = '10px';
                  badge.style.marginTop = '2px';
                  badge.style.color = '#34e2a8';
                  badge.style.whiteSpace = 'nowrap';
                  badge.textContent = '🔴 ตรงทุกตัว';
                  tdConf.appendChild(badge);
                } else if (r.observed_plate && r.observed_plate !== r.plate) {
                  const badge = document.createElement('div');
                  badge.style.fontSize = '10px';
                  badge.style.marginTop = '2px';
                  badge.style.color = '#a855f7';
                  badge.style.whiteSpace = 'nowrap';
                  badge.textContent = `ป้าย: ${r.observed_plate}`;
                  tdConf.appendChild(badge);
                }

                tbodyH.appendChild(row);
              });
            }
        }
      }
      
    } catch (e) {
      console.error('Failed to load stats', e);
    }
  }

  // ==========================================
  // EVENT LISTENERS BINDING
  // ==========================================
  if (btnWatchlist) {
    btnWatchlist.addEventListener('click', loadWatchlist);
  }
  if (btnWlRefresh) {
    btnWlRefresh.addEventListener('click', loadWatchlist);
  }
  if (wlSearch) {
    wlSearch.addEventListener('input', () => {
      if (btnWlSearchClear) {
        btnWlSearchClear.hidden = !wlSearch.value;
      }
      renderWatchlistTable(wlSearch.value);
    });
  }
  if (btnWlSearchClear) {
    btnWlSearchClear.addEventListener('click', () => {
      if (wlSearch) {
        wlSearch.value = '';
        wlSearch.focus();
      }
      btnWlSearchClear.hidden = true;
      renderWatchlistTable('');
    });
  }
  if (btnWlAdd) {
    btnWlAdd.addEventListener('click', () => openWlForm(null));
  }
  if (btnCloseWlForm) {
    btnCloseWlForm.addEventListener('click', () => wlFormOverlay.hidden = true);
  }
  if (btnWlFormClose2) {
    btnWlFormClose2.addEventListener('click', () => wlFormOverlay.hidden = true);
  }
  if (wlFormOverlay) {
    wlFormOverlay.addEventListener('click', e => { if (e.target === wlFormOverlay) wlFormOverlay.hidden = true; });
  }
  if (btnWlFormSave) {
    btnWlFormSave.addEventListener('click', saveWatchlist);
  }

  // Live input preview listeners
  if (fPlatePrefix) {
    fPlatePrefix.addEventListener('input', updatePlatePreview);
  }
  if (fPlateNumber) {
    fPlateNumber.addEventListener('input', updatePlatePreview);
  }
  if (fProvince) {
    fProvince.addEventListener('change', updatePlatePreview);
  }

  // Initial province dropdown population
  initProvinceSelect();
  
  const btnCloseWlStats = $('btnCloseWlStats');
  const wlStatsOverlay = $('wlStatsOverlay');
  if (btnCloseWlStats) btnCloseWlStats.addEventListener('click', () => { wlStatsOverlay.hidden = true; });
  if (wlStatsOverlay) wlStatsOverlay.addEventListener('click', e => { if (e.target === wlStatsOverlay) wlStatsOverlay.hidden = true; });

})();
