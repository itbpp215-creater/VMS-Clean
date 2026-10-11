
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
// Global UI Helpers for replacing native alert() and confirm() with Cyber Purple Glassmorphism

// bppToast displays temporary toast notifications.
window.bppToast = (msg, isError = false) => {
  let t = document.getElementById('toast');
  let m = document.getElementById('toastMsg');
  if (!t || !m) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:999999;padding:12px 20px;border-radius:10px;color:#fff;font-family:var(--font-ui,sans-serif);font-size:14px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,0.6), 0 0 16px rgba(168,85,247,0.4);display:flex;align-items:center;gap:8px;cursor:pointer;backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.15);transition:all 0.2s;';
    t.onclick = () => { t.hidden = true; };
    m = document.createElement('span');
    m.id = 'toastMsg';
    t.appendChild(m);
    document.body.appendChild(t);
  }
  m.innerText = msg;
  const svg = t.querySelector('svg');
  if (isError) {
    t.style.background = 'rgba(220, 38, 38, 0.95)';
    t.style.borderColor = 'rgba(248, 113, 113, 0.4)';
    t.style.boxShadow = '0 10px 30px rgba(0,0,0,0.6), 0 0 16px rgba(239, 68, 68, 0.4)';
    if (svg) {
      svg.setAttribute('stroke', '#fff');
      svg.innerHTML = '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>';
    }
  } else {
    t.style.background = 'linear-gradient(135deg, rgba(168, 85, 247, 0.95), rgba(124, 58, 237, 0.95))';
    t.style.borderColor = 'rgba(255, 255, 255, 0.15)';
    t.style.boxShadow = '0 10px 30px rgba(0,0,0,0.6), 0 0 16px rgba(168, 85, 247, 0.4)';
    if (svg) {
      svg.setAttribute('stroke', '#34e2a8');
      svg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
    }
  }
  t.hidden = false;
  if (isError) {
    console.error('[bppToast Error]', msg);
  }
  if (window.bppToastTimer) clearTimeout(window.bppToastTimer);
  window.bppToastTimer = setTimeout(() => t.hidden = true, isError ? 8000 : 3500);
};

// bppAlert displays a rich Cyber Purple Glassmorphic Modal Popup
window.bppAlert = (msg, title = 'แจ้งเตือน') => {
  return new Promise(resolve => {
    let m = document.getElementById('bppAlertModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'bppAlertModal';
      m.className = 'overlay';
      m.style.cssText = 'position:fixed;inset:0;background:rgba(6,7,15,0.85);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);z-index:999999;display:none;align-items:center;justify-content:center;padding:16px;';
      m.innerHTML = `
        <div class="modal" style="width: 440px; max-width: 92vw; background:linear-gradient(180deg, rgba(26,20,50,0.98), rgba(12,9,26,0.99)); border:1px solid rgba(168,85,247,0.45); border-radius:16px; box-shadow:0 24px 60px rgba(0,0,0,0.85), 0 0 30px rgba(124,58,237,0.3); text-align: center; padding: 28px 22px; font-family:var(--font-body,sans-serif);">
          <div id="bppAlertIcon" style="width:52px; height:52px; border-radius:50%; background:rgba(168,85,247,0.15); border:1px solid rgba(168,85,247,0.4); display:flex; align-items:center; justify-content:center; margin:0 auto 16px auto;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path></svg>
          </div>
          <h3 id="bppAlertTitle" style="margin:0 0 10px 0; color:#eef0f8; font-size:1.15rem; font-weight:700; font-family:var(--font-ui,sans-serif);">แจ้งเตือน</h3>
          <div id="bppAlertMsg" style="color:#cbd5e1; font-size:0.9rem; margin-bottom: 22px; white-space: pre-wrap; line-height:1.6; word-break:break-word; max-height:55vh; overflow-y:auto; padding:10px 14px; text-align:left; background:rgba(18,14,38,0.6); border-radius:8px; border:1px solid rgba(168,85,247,0.2);"></div>
          <button id="bppAlertOk" class="btn-primary" style="min-width:120px; padding:10px 24px; font-size:0.92rem; font-weight:600; border-radius:10px; cursor:pointer; background:linear-gradient(135deg, #a855f7, #7c3aed); border:none; color:#fff; box-shadow:0 4px 14px rgba(147,51,234,0.4);">รับทราบ</button>
        </div>
      `;
      document.body.appendChild(m);
    }
    document.getElementById('bppAlertTitle').innerText = title;
    document.getElementById('bppAlertMsg').innerText = String(msg || '');
    
    const iconEl = document.getElementById('bppAlertIcon');
    const msgStr = String(msg || '');
    if (msgStr.includes('❌') || msgStr.toLowerCase().includes('failed') || msgStr.toLowerCase().includes('error') || msgStr.toLowerCase().includes('not found') || msgStr.includes('ไม่สำเร็จ')) {
      iconEl.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fb5b78" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
      iconEl.style.background = 'rgba(239,68,68,0.15)';
      iconEl.style.borderColor = 'rgba(239,68,68,0.4)';
    } else if (msgStr.includes('🎉') || msgStr.includes('✅') || msgStr.includes('👑') || msgStr.includes('สำเร็จ')) {
      iconEl.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path><path d="M5 3v4"></path><path d="M19 17v4"></path><path d="M3 5h4"></path><path d="M17 19h4"></path></svg>';
      iconEl.style.background = 'rgba(34,197,94,0.15)';
      iconEl.style.borderColor = 'rgba(34,197,94,0.4)';
    } else {
      iconEl.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path></svg>';
      iconEl.style.background = 'rgba(168,85,247,0.15)';
      iconEl.style.borderColor = 'rgba(168,85,247,0.4)';
    }

    m.style.display = 'flex';
    
    const btnOk = document.getElementById('bppAlertOk');
    const clean = () => {
      m.style.display = 'none';
      btnOk.onclick = null;
    };
    btnOk.onclick = () => { clean(); resolve(true); };
  });
};

// Override native window.alert globally across all scripts
window.alert = (msg) => {
  window.bppAlert(msg);
};

// bppConfirm displays a Cyber Purple Glassmorphic Confirmation Modal
window.bppConfirm = (msg, title = 'ยืนยันการทำรายการ') => {
  return new Promise(resolve => {
    let m = document.getElementById('bppConfirmModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'bppConfirmModal';
      m.className = 'overlay';
      m.style.cssText = 'position:fixed;inset:0;background:rgba(6,7,15,0.85);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);z-index:999999;display:none;align-items:center;justify-content:center;padding:16px;';
      m.innerHTML = `
        <div class="modal" style="width: 420px; max-width: 92vw; background:linear-gradient(180deg, rgba(26,20,50,0.98), rgba(12,9,26,0.99)); border:1px solid rgba(168,85,247,0.45); border-radius:16px; box-shadow:0 24px 60px rgba(0,0,0,0.85), 0 0 30px rgba(124,58,237,0.3); text-align: center; padding: 28px 22px; font-family:var(--font-body,sans-serif);">
          <div style="width:52px; height:52px; border-radius:50%; background:rgba(234,179,8,0.15); border:1px solid rgba(234,179,8,0.4); display:flex; align-items:center; justify-content:center; margin:0 auto 16px auto;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          </div>
          <h3 id="bppConfirmTitle" style="margin:0 0 10px 0; color:#eef0f8; font-size:1.15rem; font-weight:700; font-family:var(--font-ui,sans-serif);">ยืนยัน</h3>
          <div id="bppConfirmMsg" style="color:#cbd5e1; font-size:0.9rem; margin-bottom: 24px; white-space: pre-wrap; line-height:1.6; word-break:break-word; max-height:55vh; overflow-y:auto; padding:10px 14px; text-align:left; background:rgba(18,14,38,0.6); border-radius:8px; border:1px solid rgba(168,85,247,0.2);"></div>
          <div style="display:flex; justify-content:center; gap:12px;">
            <button id="bppConfirmYes" class="btn-primary" style="min-width:110px; padding:10px 20px; font-size:0.92rem; font-weight:600; border-radius:10px; cursor:pointer; background:linear-gradient(135deg, #a855f7, #7c3aed); border:none; color:#fff; box-shadow:0 4px 14px rgba(147,51,234,0.4);">ตกลง</button>
            <button id="bppConfirmNo" class="btn-ghost" style="min-width:110px; padding:10px 20px; font-size:0.92rem; font-weight:600; border-radius:10px; cursor:pointer; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:#cbd5e1;">ยกเลิก</button>
          </div>
        </div>
      `;
      document.body.appendChild(m);
    }
    document.getElementById('bppConfirmTitle').innerText = title;
    document.getElementById('bppConfirmMsg').innerText = String(msg || '');
    m.style.display = 'flex';
    
    const btnYes = document.getElementById('bppConfirmYes');
    const btnNo = document.getElementById('bppConfirmNo');
    
    const clean = () => {
      m.style.display = 'none';
      btnYes.onclick = null;
      btnNo.onclick = null;
    };
    
    btnYes.onclick = () => { clean(); resolve(true); };
    btnNo.onclick = () => { clean(); resolve(false); };
  });
};

// bppPrompt displays a Cyber Purple Glassmorphic input dialog (replaces native prompt()).
// Resolves with the entered string, or null when cancelled (same contract as prompt()).
window.bppPrompt = (msg, defaultValue = '', title = 'กรอกข้อมูล') => {
  return new Promise(resolve => {
    let m = document.getElementById('bppPromptModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'bppPromptModal';
      m.className = 'overlay';
      m.style.cssText = 'position:fixed;inset:0;background:rgba(6,7,15,0.85);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);z-index:999999;display:none;align-items:center;justify-content:center;padding:16px;';
      m.innerHTML = `
        <div class="modal" style="width: 460px; max-width: 92vw; background:linear-gradient(180deg, rgba(26,20,50,0.98), rgba(12,9,26,0.99)); border:1px solid rgba(168,85,247,0.45); border-radius:16px; box-shadow:0 24px 60px rgba(0,0,0,0.85), 0 0 30px rgba(124,58,237,0.3); text-align: center; padding: 28px 22px; font-family:var(--font-body,sans-serif);">
          <div style="width:52px; height:52px; border-radius:50%; background:rgba(168,85,247,0.15); border:1px solid rgba(168,85,247,0.4); display:flex; align-items:center; justify-content:center; margin:0 auto 16px auto;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
          </div>
          <h3 id="bppPromptTitle" style="margin:0 0 10px 0; color:#eef0f8; font-size:1.15rem; font-weight:700; font-family:var(--font-ui,sans-serif);">กรอกข้อมูล</h3>
          <div id="bppPromptMsg" style="color:#cbd5e1; font-size:0.9rem; margin-bottom: 14px; white-space: pre-wrap; line-height:1.6; word-break:break-word; max-height:40vh; overflow-y:auto; padding:10px 14px; text-align:left; background:rgba(18,14,38,0.6); border-radius:8px; border:1px solid rgba(168,85,247,0.2);"></div>
          <input id="bppPromptInput" type="text" autocomplete="off" style="width:100%; box-sizing:border-box; padding:10px 14px; margin-bottom:22px; border-radius:10px; border:1px solid rgba(168,85,247,0.4); background:rgba(12,9,26,0.9); color:#eef0f8; font-size:0.95rem; outline:none;">
          <div style="display:flex; justify-content:center; gap:12px;">
            <button id="bppPromptOk" class="btn-primary" style="min-width:110px; padding:10px 20px; font-size:0.92rem; font-weight:600; border-radius:10px; cursor:pointer; background:linear-gradient(135deg, #a855f7, #7c3aed); border:none; color:#fff; box-shadow:0 4px 14px rgba(147,51,234,0.4);">ตกลง</button>
            <button id="bppPromptCancel" class="btn-ghost" style="min-width:110px; padding:10px 20px; font-size:0.92rem; font-weight:600; border-radius:10px; cursor:pointer; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:#cbd5e1;">ยกเลิก</button>
          </div>
        </div>
      `;
      document.body.appendChild(m);
    }
    document.getElementById('bppPromptTitle').innerText = title;
    document.getElementById('bppPromptMsg').innerText = String(msg || '');
    const input = document.getElementById('bppPromptInput');
    input.value = defaultValue == null ? '' : String(defaultValue);
    m.style.display = 'flex';
    setTimeout(() => { input.focus(); input.select(); }, 30);

    const btnOk = document.getElementById('bppPromptOk');
    const btnCancel = document.getElementById('bppPromptCancel');
    const clean = () => {
      m.style.display = 'none';
      btnOk.onclick = null;
      btnCancel.onclick = null;
      input.onkeydown = null;
    };
    btnOk.onclick = () => { const v = input.value; clean(); resolve(v); };
    btnCancel.onclick = () => { clean(); resolve(null); };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); btnOk.onclick(); }
      else if (e.key === 'Escape') { e.preventDefault(); btnCancel.onclick(); }
    };
  });
};

const initAdminModule = async () => {
  let session = window.bppSession || null;
  if (!session && window.bppSessionPromise) {
    session = await window.bppSessionPromise;
  }
  if (!session) {
    try {
      const res = await fetch('/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) session = await res.json();
    } catch (e) {}
  }
  if (!session) {
    const u = localStorage.getItem('vms_user') || localStorage.getItem('auth_user') || localStorage.getItem('username');
    const r = localStorage.getItem('vms_role') || localStorage.getItem('auth_role') || localStorage.getItem('user_role') || 'user';
    if (u) session = { username: u, role: r };
  }
  if (!session) {
    session = { username: 'ผู้ใช้งาน', role: 'user' };
  }
  const isAdmin = ['admin', 'superadmin'].includes(session.role);
  // ADR-0025: root superadmins (display hint only; auth-service enforces it).
  const ROOT_SUPERADMINS = ['suchakree', 'arm215'];
  const isRootUser = (name) => ROOT_SUPERADMINS.includes(String(name || '').toLowerCase());
  const sessionIsRoot = isRootUser(session.username);
  const sessionIsSuper = session.role === 'superadmin';
  
  // Create Modals dynamically to save space in index.html
  const modalHTML = `
    <!-- Users, Profile & Audit Modal -->
    <div id="usersOverlay" class="overlay" hidden>
      <div class="modal" style="width: 850px; max-width: 95vw; background:linear-gradient(180deg, #13172e 0%, #0d1021 100%); border:1px solid rgba(168,85,247,0.35); border-radius:14px; box-shadow:0 20px 50px rgba(0,0,0,0.8);">
        <div class="modal-head" style="padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between;">
          <div class="modal-title" style="display:flex; align-items:center; gap:8px; font-size:1.1rem; font-weight:700; color:#fff; font-family:var(--font-ui);">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            <span>ข้อมูลบัญชีและจัดการสิทธิ์ (Profile & Permissions)</span>
          </div>
          <button id="btnOpenAddUser" class="btn-primary" style="padding: 6px 14px; font-size: 13px; border-radius: 8px; font-family:var(--font-ui);" hidden>+ เพิ่มผู้ใช้งาน</button>
          <button id="btnCloseUsers" class="modal-close" style="margin-left:auto; display:flex !important; align-items:center !important; justify-content:center !important; width:34px !important; height:34px !important; min-width:34px !important; min-height:34px !important; padding:0 !important; line-height:1 !important; cursor:pointer;" aria-label="ปิด">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block; margin:auto; pointer-events:none;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <div class="modal-body" style="padding: 18px 20px; flex-direction:column; gap:16px;">
          
          <!-- MY PROFILE & USER MANUAL BANNER (Available for all roles) -->
          <div style="background: linear-gradient(135deg, rgba(168,85,247,0.12) 0%, rgba(56,189,248,0.06) 100%); border: 1px solid rgba(168,85,247,0.3); border-radius: 12px; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
              <div style="display: flex; align-items: center; gap: 14px;">
                <div id="profAvatarWrap" style="width: 46px; height: 46px; flex-shrink:0; box-shadow:0 0 14px rgba(168,85,247,0.25); border-radius:50%;"></div>
                <div>
                  <div style="font-size: 16px; font-weight: 700; color: #fff; font-family: var(--font-ui);" id="profUsernameDisplay">${escapeHtml(session.username || '-')}</div>
                  <div style="font-size: 12.5px; color: #cbd5e1; display: flex; align-items: center; gap: 8px; margin-top: 3px;">
                    <span>สิทธิ์:</span>
                    <span id="profRoleBadge" style="font-weight: 600; padding: 2px 9px; border-radius: 10px; font-size: 11.5px; display:inline-flex; align-items:center; gap:4px; background:${session.role === 'superadmin' ? 'rgba(234,179,8,0.2)' : session.role === 'admin' ? 'rgba(168,85,247,0.2)' : 'rgba(34,197,94,0.2)'}; color:${session.role === 'superadmin' ? '#facc15' : session.role === 'admin' ? '#c084fc' : '#4ade80'}; border:1px solid ${session.role === 'superadmin' ? 'rgba(234,179,8,0.4)' : session.role === 'admin' ? 'rgba(168,85,247,0.4)' : 'rgba(34,197,94,0.4)'};">
                      ${session.role === 'superadmin' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"></path></svg> ผู้ดูแลระบบสูงสุด (Superadmin)' : session.role === 'admin' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg> ผู้ดูแลระบบ (Admin)' : '<svg width="8" height="8" viewBox="0 0 24 24" fill="#34e2a8" stroke="none"><circle cx="12" cy="12" r="10"/></svg> ผู้ใช้งานทั่วไป (User)'}
                    </span>
                    <span style="color:#64748b;">•</span>
                    <span style="color:#4ade80; font-size:12px; display:inline-flex; align-items:center; gap:4px;"><svg width="8" height="8" viewBox="0 0 24 24" fill="#34e2a8" stroke="none"><circle cx="12" cy="12" r="10"/></svg>ใช้งาน (Active)</span>
                  </div>
                </div>
              </div>

              <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <button id="btnToggleSelfLabel" type="button" class="btn-ghost" style="padding: 7px 14px; font-size: 12.5px; border-radius: 8px; font-family: var(--font-ui); display: inline-flex; align-items: center; gap: 6px;">
                  ✏️ ตั้งชื่อ/รูปของฉัน
                </button>
                <button id="btnToggleSelfPass" type="button" class="btn-ghost" style="padding: 7px 14px; font-size: 12.5px; border-radius: 8px; font-family: var(--font-ui); display: inline-flex; align-items: center; gap: 6px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg> เปลี่ยนรหัสผ่านของฉัน
                </button>
              </div>
            </div>

            <!-- Self Account Label editor: Display Name + Avatar (collapsible) -->
            <div id="selfLabelArea" style="background: rgba(10,13,26,0.85); border: 1px dashed rgba(168,85,247,0.4); border-radius: 10px; padding: 16px; margin-top: 6px;" hidden>
              <div style="font-size: 13px; font-weight: 600; color: #e2e8f0; margin-bottom: 12px; font-family: var(--font-ui);">ชื่อเรียกและรูปประจำบัญชี — ใช้แสดงบนแผนที่และรายการต่างๆ เพื่อให้รู้ว่าบัญชีนี้คือใคร</div>
              <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
                <div id="selfLabelPreview" style="width:72px; height:72px; flex-shrink:0;"></div>
                <div style="display:flex; flex-direction:column; gap:8px; flex:1; min-width:200px;">
                  <input type="text" id="inpSelfDisplayName" class="inp" maxlength="40" placeholder="ชื่อเรียก (ไม่เกิน 40 ตัวอักษร เว้นว่างได้)" autocomplete="off" style="width:100%;">
                  <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button id="btnSelfAvatarPick" type="button" class="btn-ghost" style="padding:5px 12px; font-size:12px;">🖼️ เลือกรูป</button>
                    <button id="btnSelfAvatarCamera" type="button" class="btn-ghost" style="padding:5px 12px; font-size:12px;">📷 ถ่ายรูป</button>
                    <button id="btnSelfAvatarClear" type="button" class="btn-ghost del" style="padding:5px 12px; font-size:12px;">ลบรูป</button>
                  </div>
                  <input type="file" id="inpSelfAvatarFile" accept="image/*" hidden>
                  <input type="file" id="inpSelfAvatarCamera" accept="image/*" capture="user" hidden>
                </div>
              </div>
              <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px;">
                <button id="btnCancelSelfLabel" type="button" class="btn-ghost" style="padding:5px 14px; font-size:12px;">ปิด</button>
                <button id="btnSaveSelfLabel" type="button" class="btn-primary" style="padding:5px 16px; font-size:12px;">บันทึกชื่อ</button>
              </div>
            </div>

            <!-- Self Password Change Form (Collapsible) -->
            <div id="selfPassArea" style="background: rgba(10,13,26,0.85); border: 1px dashed rgba(168,85,247,0.4); border-radius: 10px; padding: 16px; margin-top: 6px;" hidden>
              <div style="font-size: 13px; font-weight: 600; color: #e2e8f0; margin-bottom: 12px; font-family: var(--font-ui); display: flex; align-items: center; gap: 6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> เปลี่ยนรหัสผ่านบัญชีของคุณ (${escapeHtml(session.username || '')})
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div>
                  <label style="display: block; font-size: 12px; color: #9aa0bd; margin-bottom: 4px;">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label>
                  <input type="password" id="inpSelfNewPass" class="inp" placeholder="รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร" autocomplete="new-password" style="width:100%;">
                </div>
                <div>
                  <label style="display: block; font-size: 12px; color: #9aa0bd; margin-bottom: 4px;">ยืนยันรหัสผ่านใหม่</label>
                  <input type="password" id="inpSelfConfirmPass" class="inp" placeholder="พิมพ์รหัสผ่านใหม่อีกครั้ง" autocomplete="new-password" style="width:100%;">
                </div>
              </div>
              <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px;">
                <button id="btnCancelSelfPass" type="button" class="btn-ghost" style="padding: 5px 14px; font-size: 12px;">ยกเลิก</button>
                <button id="btnSaveSelfPass" type="button" class="btn-primary" style="padding: 5px 16px; font-size: 12px;">บันทึกรหัสผ่าน</button>
              </div>
            </div>
          </div>

          <!-- ADMIN SECTION: TAB HEADER (Only for admin / superadmin) -->
          <div id="adminTabHeader" style="display:${isAdmin ? 'flex' : 'none'}; border-bottom:1px solid #3b4261; margin-bottom:0; flex:none;">
            <button id="btnTabUsers" type="button" style="flex:1; padding:12px; background:transparent; color:#fff; border:none; border-bottom:2px solid #a855f7; cursor:pointer; font-family:var(--font-ui); font-size:14px; font-weight:500; display:inline-flex; align-items:center; justify-content:center; gap:6px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>จัดการผู้ใช้งานทั้งหมด</button>
            <button id="btnTabAudit" type="button" style="flex:1; padding:12px; background:transparent; color:#9aa0bd; border:none; border-bottom:2px solid transparent; cursor:pointer; font-family:var(--font-ui); font-size:14px; font-weight:500; display:inline-flex; align-items:center; justify-content:center; gap:6px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path></svg>ประวัติการใช้งาน (Audit Logs)</button>
          </div>

          <!-- ADMIN TAB 1: USERS LIST & CRUD -->
          <div id="tabUsers" style="display:${isAdmin ? 'block' : 'none'}; flex:1; overflow:auto; max-height:45vh;">
            
            <!-- Add / Edit User Form (Hidden by default) -->
            <div id="userFormArea" style="background: rgba(157, 78, 221, 0.05); padding: 18px; border-radius: 12px; margin-bottom: 16px; border: 1px solid rgba(157, 78, 221, 0.3); box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-family:var(--font-body);" hidden>
              <h3 id="userFormTitle" style="margin-top:0; margin-bottom: 14px; color: #eef0f8; font-size: 15px; font-family:var(--font-ui);">เพิ่มผู้ใช้งานใหม่</h3>
              <div class="wl-form-body" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                <div>
                  <label style="display:block; font-size:12px; color:#9aa0bd; margin-bottom:4px;">Username</label>
                  <input type="text" id="inpUsername" class="inp" placeholder="เช่น somchai215 (ภาษาอังกฤษ, ตัวเลข)" autocomplete="off" style="width:100%;">
                  <small style="color:#9aa0bd; font-size:11px;">*ภาษาอังกฤษ ตัวเลข หรือ . _ - (3-64 ตัวอักษร ห้ามมีภาษาไทยหรือช่องว่าง)</small>
                </div>
                <div>
                  <label style="display:block; font-size:12px; color:#9aa0bd; margin-bottom:4px;">Password</label>
                  <input type="password" id="inpPassword" class="inp" placeholder="รหัสผ่านอย่างน้อย 8 ตัวอักษร (เว้นว่างถ้าไม่ต้องการเปลี่ยน)" autocomplete="new-password" style="width:100%;">
                  <small style="color:#9aa0bd; font-size:11px;">*รหัสผ่านถูกเข้ารหัสทางเดียว ไม่สามารถดูรหัสเดิมได้ แต่พิมพ์เพื่อเปลี่ยนใหม่ได้</small>
                </div>
                <div>
                  <label style="display:block; font-size:12px; color:#9aa0bd; margin-bottom:4px;">Role (สิทธิ์)</label>
                  <select id="inpRole" class="inp" style="width:100%;">
                    <option value="user">User (ผู้ใช้งานทั่วไป)</option>
                    <option value="admin">Admin (ผู้ดูแลระบบ)</option>
                  </select>
                </div>
                <div>
                  <label style="display:block; font-size:12px; color:#9aa0bd; margin-bottom:4px;">Status (สถานะ)</label>
                  <select id="inpActive" class="inp" style="width:100%;">
                    <option value="1">ใช้งาน (Active)</option>
                    <option value="0">ระงับ (Suspended)</option>
                  </select>
                </div>
                <div style="display:flex; align-items: flex-end; gap: 8px; grid-column: 1 / -1; justify-content: flex-end;">
                  <button id="btnCancelUserForm" class="btn-ghost" style="padding: 6px 16px;">ยกเลิก</button>
                  <button id="btnSaveUser" class="btn-primary" style="padding: 6px 20px;">บันทึก</button>
                </div>
              </div>
              <input type="hidden" id="inpEditMode" value="">
            </div>

            <table class="wl-table" style="font-family:var(--font-body); width: 100%;">
              <thead>
                <tr><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody id="usersTableBody"></tbody>
            </table>
          </div>

          <!-- ADMIN TAB 2: AUDIT LOGS -->
          <div id="tabAudit" style="display:none; flex:1; overflow:auto; max-height:45vh;">
            <table class="wl-table" style="font-family:var(--font-body); width: 100%;">
              <thead>
                <tr><th>Time</th><th>User</th><th>Action</th><th>Details</th><th>IP</th></tr>
              </thead>
              <tbody id="logsTableBody"></tbody>
            </table>
          </div>

        </div>
      </div>
    </div>  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // Bindings
  document.getElementById('btnUsers').addEventListener('click', openProfileModal);
  document.getElementById('btnCloseUsers').addEventListener('click', () => document.getElementById('usersOverlay').hidden = true);
  document.getElementById('usersOverlay').addEventListener('click', e => { if(e.target === e.currentTarget) e.target.hidden = true; });

  // Self Password Toggle
  const selfPassArea = document.getElementById('selfPassArea');
  document.getElementById('btnToggleSelfPass').addEventListener('click', () => {
    selfPassArea.hidden = !selfPassArea.hidden;
    if (!selfPassArea.hidden) {
      document.getElementById('inpSelfNewPass').focus();
    }
  });
  document.getElementById('btnCancelSelfPass').addEventListener('click', () => {
    selfPassArea.hidden = true;
    document.getElementById('inpSelfNewPass').value = '';
    document.getElementById('inpSelfConfirmPass').value = '';
  });

  // Self Account Label (Display Name + Avatar)
  const selfLabelArea = document.getElementById('selfLabelArea');
  const selfLabelPreview = document.getElementById('selfLabelPreview');
  const selfNameInput = document.getElementById('inpSelfDisplayName');
  const labelApi = () => window.bppAccountLabel;

  /** Repaint every place in this modal that shows the signed-in account. */
  function refreshSelfLabel() {
    const api = labelApi();
    const me = (window.bppSession || session).username;
    if (!api) return;
    if (!Object.keys(api.get(me)).length) {
      api.remember(me, window.bppSession?.display_name, window.bppSession?.avatar_url);
    }
    selfLabelPreview.innerHTML = api.avatarHtml(me, 72);
    document.getElementById('profAvatarWrap').innerHTML = api.avatarHtml(me, 46);
    const nameEl = document.getElementById('profUsernameDisplay');
    const p = api.get(me);
    nameEl.innerHTML = p.display_name
      ? api.esc(p.display_name) + ' <span style="color:#94a3b8;font-size:12px;font-weight:500;">@' + api.esc(me) + '</span>'
      : api.esc(me);
  }
  window.__refreshSelfLabel = refreshSelfLabel;

  document.getElementById('btnToggleSelfLabel').addEventListener('click', () => {
    selfLabelArea.hidden = !selfLabelArea.hidden;
    if (!selfLabelArea.hidden) {
      selfNameInput.value = (window.bppSession && window.bppSession.display_name) || '';
      refreshSelfLabel();
    }
  });
  document.getElementById('btnCancelSelfLabel').addEventListener('click', () => { selfLabelArea.hidden = true; });

  const saveSelfLabel = async (fields, okMessage) => {
    try {
      await labelApi().save(fields);
      refreshSelfLabel();
      window.bppToast(okMessage);
    } catch (err) {
      window.bppToast(err.message || 'บันทึกไม่สำเร็จ', true);
    }
  };
  const handlePickedPhoto = async (input) => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const avatar = await labelApi().toJpegBase64(file);
      await saveSelfLabel({ avatar }, 'เปลี่ยนรูปประจำบัญชีแล้ว');
    } catch (err) {
      window.bppToast(err.message || 'อ่านรูปไม่ได้', true);
    }
  };
  const fileInput = document.getElementById('inpSelfAvatarFile');
  const cameraInput = document.getElementById('inpSelfAvatarCamera');
  document.getElementById('btnSelfAvatarPick').addEventListener('click', () => fileInput.click());
  document.getElementById('btnSelfAvatarCamera').addEventListener('click', () => cameraInput.click());
  fileInput.addEventListener('change', () => handlePickedPhoto(fileInput));
  cameraInput.addEventListener('change', () => handlePickedPhoto(cameraInput));
  document.getElementById('btnSelfAvatarClear').addEventListener('click', () => saveSelfLabel({ avatar: '' }, 'ลบรูปประจำบัญชีแล้ว'));
  document.getElementById('btnSaveSelfLabel').addEventListener('click', () => saveSelfLabel({ display_name: selfNameInput.value }, 'บันทึกชื่อเรียกแล้ว'));
  document.addEventListener('bpp-profiles-updated', () => { if (!selfLabelArea.hidden || document.getElementById('profAvatarWrap')) refreshSelfLabel(); });

  async function parseErrorResponse(res, fallbackMessage = 'เกิดข้อผิดพลาด') {
    let msg = `${fallbackMessage} (HTTP ${res.status})`;
    try {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const errData = await res.json();
        if (errData && errData.detail) {
          msg = Array.isArray(errData.detail)
            ? errData.detail.map(e => e.msg || e.detail || JSON.stringify(e)).join(', ')
            : errData.detail;
        } else if (errData && errData.message) {
          msg = errData.message;
        }
      } else {
        const text = await res.text();
        if (text && !text.trim().startsWith('<')) {
          msg = text.slice(0, 120);
        } else if (res.status === 504 || res.status === 524) {
          msg = 'การเชื่อมต่อหมดเวลา (Gateway Timeout) กรุณาลองใหม่อีกครั้ง';
        } else if (res.status === 502) {
          msg = 'ไม่สามารถติดต่อ Service ปลายทางได้ (Bad Gateway)';
        } else if (res.status === 401 || res.status === 403) {
          msg = 'ไม่มีสิทธิ์ดำเนินการ หรือเซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
        }
      }
    } catch (_) {}
    return msg;
  }

  // Self Password Save
  document.getElementById('btnSaveSelfPass').addEventListener('click', async () => {
    const newPass = document.getElementById('inpSelfNewPass').value;
    const confirmPass = document.getElementById('inpSelfConfirmPass').value;
    if (!newPass) return window.bppToast('กรุณาระบุรหัสผ่านใหม่', true);
    if (newPass.length < 8) return window.bppToast('รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร', true);
    if (newPass !== confirmPass) return window.bppToast('รหัสผ่านยืนยันไม่ตรงกัน', true);

    try {
      const res = await fetch('/auth/change-password', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: newPass })
      });
      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, 'เปลี่ยนรหัสผ่านไม่สำเร็จ'));
      }
      window.bppToast('เปลี่ยนรหัสผ่านสำเร็จ');
      document.getElementById('inpSelfNewPass').value = '';
      document.getElementById('inpSelfConfirmPass').value = '';
      selfPassArea.hidden = true;
    } catch (e) {
      window.bppToast('เกิดข้อผิดพลาด: ' + e.message, true);
    }
  });

  if (isAdmin) {
    document.getElementById('btnOpenAddUser').hidden = false;
  }

  const formArea = document.getElementById('userFormArea');
  document.getElementById('btnOpenAddUser').addEventListener('click', () => {
    document.getElementById('btnTabUsers').click();
    document.getElementById('userFormTitle').innerText = 'เพิ่มผู้ใช้งานใหม่';
    document.getElementById('inpUsername').value = '';
    document.getElementById('inpUsername').disabled = false;
    document.getElementById('inpPassword').value = '';
    syncRoleOptions();
    document.getElementById('inpRole').disabled = false;
    document.getElementById('inpRole').value = 'user';
    document.getElementById('inpActive').disabled = false;
    document.getElementById('inpActive').value = '1';
    document.getElementById('inpEditMode').value = '';
    formArea.hidden = false;
    formArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  document.getElementById('btnCancelUserForm').addEventListener('click', () => {
    formArea.hidden = true;
  });

  document.getElementById('btnSaveUser').addEventListener('click', async () => {
    const username = document.getElementById('inpUsername').value.trim();
    const password = document.getElementById('inpPassword').value;
    const role = document.getElementById('inpRole').value;
    const isEdit = document.getElementById('inpEditMode').value !== '';

    if (!username) return window.bppToast('กรุณาระบุ Username', true);
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(username)) {
      return window.bppToast('Username ต้องเป็นภาษาอังกฤษ ตัวเลข หรือ . _ - ความยาว 3-64 ตัวอักษร (ห้ามมีภาษาไทยหรือช่องว่าง)', true);
    }
    if (!isEdit && !password) return window.bppToast('กรุณาระบุ Password สำหรับผู้ใช้ใหม่', true);
    // Match the server enrollment floor (minimum 8 characters) before issuing a user-management request.
    // Password complexity check was relaxed per user requirement.
    if (password && password.length < 8) return window.bppToast('รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร', true);

    try {
      if (isEdit) {
        const body = {};
        if (password) body.password = password;
        if (role) body.role = role;
        body.active = document.getElementById('inpActive').value === '1';
        const res = await fetch(`/auth/users/${encodeURIComponent(username)}`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          throw new Error(await parseErrorResponse(res, 'แก้ไขผู้ใช้ไม่สำเร็จ'));
        }
        window.bppToast('แก้ไขสำเร็จ');
      } else {
        const res = await fetch('/auth/users', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({username, password, role})
        });
        if (!res.ok) {
          throw new Error(await parseErrorResponse(res, 'เพิ่มผู้ใช้ไม่สำเร็จ'));
        }
        window.bppToast('เพิ่มสำเร็จ');
      }
      formArea.hidden = true;
      openUsers();
    } catch (e) {
      window.bppToast('เกิดข้อผิดพลาด: ' + e.message, true);
    }
  });

  // Users Logic
  if (isAdmin) {
    document.getElementById('btnTabUsers').addEventListener('click', () => {
      document.getElementById('tabUsers').style.display = 'block'; document.getElementById('tabAudit').style.display = 'none';
      document.getElementById('btnTabUsers').style.borderBottomColor = '#a855f7'; document.getElementById('btnTabUsers').style.color = '#fff';
      document.getElementById('btnTabAudit').style.borderBottomColor = 'transparent'; document.getElementById('btnTabAudit').style.color = '#9aa0bd';
      openUsers();
    });
    document.getElementById('btnTabAudit').addEventListener('click', () => {
      document.getElementById('tabAudit').style.display = 'block'; document.getElementById('tabUsers').style.display = 'none';
      document.getElementById('btnTabAudit').style.borderBottomColor = '#a855f7'; document.getElementById('btnTabAudit').style.color = '#fff';
      document.getElementById('btnTabUsers').style.borderBottomColor = 'transparent'; document.getElementById('btnTabUsers').style.color = '#9aa0bd';
      openLogs();
    });
  }

  function openProfileModal() {
    const currentSession = window.bppSession || session;
    const currentIsAdmin = ['admin', 'superadmin'].includes(currentSession?.role);
    const userDisp = document.getElementById('profUsernameDisplay');
    if (userDisp && currentSession?.username) userDisp.textContent = currentSession.username;
    const roleBadge = document.getElementById('profRoleBadge');
    if (roleBadge && currentSession?.role) {
      roleBadge.innerHTML = currentSession.role === 'superadmin' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"></path></svg> ผู้ดูแลระบบสูงสุด (Superadmin)' : currentSession.role === 'admin' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg> ผู้ดูแลระบบ (Admin)' : '<svg width="8" height="8" viewBox="0 0 24 24" fill="#34e2a8" stroke="none"><circle cx="12" cy="12" r="10"/></svg> ผู้ใช้งานทั่วไป (User)';
      roleBadge.style.background = currentSession.role === 'superadmin' ? 'rgba(234,179,8,0.2)' : currentSession.role === 'admin' ? 'rgba(168,85,247,0.2)' : 'rgba(34,197,94,0.2)';
      roleBadge.style.color = currentSession.role === 'superadmin' ? '#facc15' : currentSession.role === 'admin' ? '#c084fc' : '#4ade80';
      roleBadge.style.border = '1px solid ' + (currentSession.role === 'superadmin' ? 'rgba(234,179,8,0.4)' : currentSession.role === 'admin' ? 'rgba(168,85,247,0.4)' : 'rgba(34,197,94,0.4)');
    }
    const adminTabHeader = document.getElementById('adminTabHeader');
    if (adminTabHeader) adminTabHeader.style.display = currentIsAdmin ? 'flex' : 'none';
    const tabUsers = document.getElementById('tabUsers');
    if (tabUsers) tabUsers.style.display = currentIsAdmin ? 'block' : 'none';
    const btnOpenAddUser = document.getElementById('btnOpenAddUser');
    if (btnOpenAddUser) btnOpenAddUser.hidden = !currentIsAdmin;

    document.getElementById('usersOverlay').hidden = false;
    if (window.__refreshSelfLabel) window.__refreshSelfLabel();
    if (currentIsAdmin) {
      openUsers();
    }
  }

  /**
   * Fetch the admin-only account list and rebuild the modal with text nodes.
   * The function changes only modal DOM and reports authorization/API errors.
   */
  function syncRoleOptions() {
    // Only root accounts may grant/revoke superadmin (ADR-0025).
    const sel = document.getElementById('inpRole');
    if (!sel) return;
    const has = [...sel.options].some(o => o.value === 'superadmin');
    if (sessionIsRoot && !has) {
      const opt = document.createElement('option');
      opt.value = 'superadmin';
      opt.textContent = 'Superadmin (ผู้ดูแลระบบสูงสุด)';
      sel.appendChild(opt);
    } else if (!sessionIsRoot && has) {
      [...sel.options].filter(o => o.value === 'superadmin').forEach(o => o.remove());
    }
  }

  async function openUsers() {
    if (!isAdmin) return;
    try {
      const res = await fetch('/auth/users');
      if (!res.ok) {
        window.bppToast(await parseErrorResponse(res, 'ไม่สามารถโหลดรายชื่อผู้ใช้ได้'), true);
        return;
      }
      const users = await res.json();
      const tbody = document.getElementById('usersTableBody');
      tbody.replaceChildren();

    // Every value in these rows comes from persisted user records. Create
    // elements explicitly and assign textContent so account data cannot inject
    // markup, inline handlers, or script into the administrator session.
    users.forEach(u => {
      const row = document.createElement('tr');
      const cellUser = document.createElement('td');
      if (window.bppAccountLabel) {
        window.bppAccountLabel.remember(u.username, u.display_name, u.avatar_url);
        cellUser.innerHTML = window.bppAccountLabel.labelHtml(u.username, 30);
      } else {
        cellUser.textContent = String(u.username ?? '');
      }
      row.appendChild(cellUser);

      const cellRole = document.createElement('td');
      cellRole.textContent = String(u.role ?? '');
      row.appendChild(cellRole);

      const cellStatus = document.createElement('td');
      cellStatus.innerHTML = u.active
        ? '<span style="display:inline-flex;align-items:center;gap:5px;color:#34e2a8;"><svg width="8" height="8" viewBox="0 0 24 24" fill="#34e2a8" stroke="none"><circle cx="12" cy="12" r="10"/></svg>ใช้งาน</span>'
        : '<span style="display:inline-flex;align-items:center;gap:5px;color:#fb5b78;"><svg width="8" height="8" viewBox="0 0 24 24" fill="#fb5b78" stroke="none"><circle cx="12" cy="12" r="10"/></svg>ระงับ</span>';
      row.appendChild(cellStatus);
      const actions = document.createElement('td');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.style.flexWrap = 'wrap';
      const isSelf = String(u.username) === String(session.username);
      const lockedRoot = isRootUser(u.username) && !sessionIsRoot;
      const lockedSuper = u.role === 'superadmin' && !sessionIsSuper;
      if (lockedRoot || lockedSuper) {
        // ADR-0025: root accounts are managed only by root; superadmins only by
        // superadmins. The server enforces this; the label is a UX hint.
        const protectedLabel = document.createElement('span');
        protectedLabel.className = 'sync-msg info';
        protectedLabel.textContent = lockedRoot
          ? 'บัญชี root (จัดการได้เฉพาะบัญชี root)'
          : 'บัญชีผู้ดูแลระบบสูงสุด (จัดการได้เฉพาะ Superadmin)';
        actions.appendChild(protectedLabel);
      } else {
        const editButton = document.createElement('button');
        editButton.className = 'btn-ghost';
        editButton.textContent = 'แก้ไข/เปลี่ยนรหัส';
        editButton.addEventListener('click', () => window.editUser(u.username, u.role, u.active));
        const deleteButton = document.createElement('button');
        deleteButton.className = 'btn-ghost del';
        deleteButton.textContent = 'ลบ';
        deleteButton.addEventListener('click', () => window.delUser(u.username));
        // Nobody may delete their own account from this screen.
        if (isSelf) {
          actions.append(editButton);
        } else {
          // Account Label moderation: an admin may set a name or remove a photo.
          const nameButton = document.createElement('button');
          nameButton.className = 'btn-ghost';
          nameButton.textContent = 'ตั้งชื่อ';
          nameButton.addEventListener('click', async () => {
            const next = await window.bppPrompt(`ชื่อเรียกของ ${u.username} (เว้นว่างเพื่อลบชื่อ, ไม่เกิน 40 ตัวอักษร)`, u.display_name || '', 'ตั้งชื่อเรียก');
            if (next === null) return;
            try {
              await window.bppAccountLabel.save({ display_name: next }, u.username);
              window.bppToast('บันทึกชื่อเรียกแล้ว');
              openUsers();
            } catch (err) {
              window.bppToast(err.message || 'บันทึกไม่สำเร็จ', true);
            }
          });
          actions.append(editButton, nameButton);
          if (u.avatar_url) {
            const clearPhotoButton = document.createElement('button');
            clearPhotoButton.className = 'btn-ghost del';
            clearPhotoButton.textContent = 'ลบรูป';
            clearPhotoButton.addEventListener('click', async () => {
              if (!(await window.bppConfirm(`ลบรูปประจำบัญชีของ ${u.username}?`))) return;
              try {
                await window.bppAccountLabel.save({ avatar: '' }, u.username);
                window.bppToast('ลบรูปแล้ว');
                openUsers();
              } catch (err) {
                window.bppToast(err.message || 'ลบรูปไม่สำเร็จ', true);
              }
            });
            actions.append(clearPhotoButton);
          }
          actions.append(deleteButton);
        }
      }
      row.appendChild(actions);
      tbody.appendChild(row);
    });
    } catch (e) {
      window.bppToast('ไม่สามารถโหลดรายชื่อผู้ใช้ได้: ' + e.message, true);
    }
  }

  window.editUser = (username, role, active) => {
    document.getElementById('userFormTitle').innerText = 'แก้ไขผู้ใช้งาน: ' + username;
    document.getElementById('inpUsername').value = username;
    document.getElementById('inpUsername').disabled = true;
    document.getElementById('inpPassword').value = '';
    syncRoleOptions();
    const isSelfEdit = String(username) === String(session.username);
    document.getElementById('inpRole').value = role;
    document.getElementById('inpActive').value = active ? '1' : '0';
    // Self-service restrictions (ADR-0025): no self role change / suspension.
    document.getElementById('inpRole').disabled = isSelfEdit;
    document.getElementById('inpActive').disabled = isSelfEdit;
    document.getElementById('inpEditMode').value = '1';
    formArea.hidden = false;
    formArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /**
   * Delete the selected account after confirmation. The path segment is
   * encoded because usernames are data, not URL structure.
   */
  window.delUser = async (username) => {
    if (!(await window.bppConfirm(`ยืนยันการลบผู้ใช้ ${username} ถาวร?`))) return;
    try {
      const res = await fetch(`/auth/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
      if (res.ok) {
        await fetch(`/api/nas-bot/admin/user-profile/${encodeURIComponent(username)}`, { method: 'DELETE' }).catch(() => {});
        openUsers();
      } else {
        const msg = await parseErrorResponse(res, 'ลบผู้ใช้ไม่สำเร็จ');
        window.bppToast('ผิดพลาด: ' + msg, true);
      }
    } catch (e) {
      window.bppToast('ผิดพลาด: ' + e.message, true);
    }
  };

  // Logs Logic
  /**
   * Fetch recent audit events and render untrusted log fields with textContent.
   * The function replaces the audit table without interpreting stored details.
   */
  async function openLogs() {
    try {
      const res = await fetch('/auth/audit?limit=200');
      if (!res.ok) {
        window.bppToast(await parseErrorResponse(res, 'ไม่สามารถโหลด Audit Logs ได้'), true);
        return;
      }
      const logs = await res.json();
      const tbody = document.getElementById('logsTableBody');
      tbody.replaceChildren();

      // Audit fields may contain user-controlled request details. Render each
      // field as text and style only trusted cell elements created by this code.
      logs.forEach(l => {
        const row = document.createElement('tr');
        const timeCell = document.createElement('td');
        timeCell.style.fontSize = '12px';
        timeCell.style.color = '#9aa0bd';
        timeCell.textContent = String(l.timestamp ?? '');
        const userCell = document.createElement('td');
        userCell.textContent = String(l.username ?? '');
        const actionCell = document.createElement('td');
        const actionChip = document.createElement('span');
        actionChip.className = 'wl-plate-chip';
        actionChip.textContent = String(l.action ?? '');
        actionCell.appendChild(actionChip);
        const detailsCell = document.createElement('td');
        detailsCell.style.fontSize = '13px';
        detailsCell.textContent = String(l.details ?? '');
        const ipCell = document.createElement('td');
        ipCell.style.fontSize = '12px';
        ipCell.style.color = '#9aa0bd';
        ipCell.textContent = String(l.ip_address ?? '');
        row.append(timeCell, userCell, actionCell, detailsCell, ipCell);
        tbody.appendChild(row);
      });
    } catch (e) {
      window.bppToast('ไม่สามารถโหลด Audit Logs ได้: ' + e.message, true);
    }
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminModule);
} else {
  initAdminModule();
}

// ==========================================
// NVR Camera Management & Batch Controls
// ==========================================
window.collapsedGroups = window.collapsedGroups || {};

function renderNvrCamList() {
  const list = document.getElementById('camerasList');
  if (!list || !window.cfg || !window.cfg.channels) return;
  list.innerHTML = '';
  
  const groups = {};
  window.cfg.channels.forEach((ch, idx) => {
    const g = ch.group || 'ทั่วไป (ไม่มีกลุ่ม)';
    if(!groups[g]) groups[g] = [];
    groups[g].push({ch, idx});
  });

  Object.keys(groups).forEach(gName => {
    const isCollapsed = window.collapsedGroups[gName] === true;
    
    const groupWrapper = document.createElement('div');
    groupWrapper.className = 'group-wrapper';
    groupWrapper.style.marginBottom = '15px';
    
    const groupHeader = document.createElement('div');
    groupHeader.className = 'cam-group';
    groupHeader.style = 'cursor: pointer; padding-bottom: 5px; border-bottom: 1px solid rgba(168,85,247,0.3); color: #c084fc; font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; user-select: none; transition: background 0.2s;';
    groupHeader.title = 'คลิกเพื่อซ่อน/แสดงกล้องในกลุ่มนี้';
    
    const iconTransform = isCollapsed ? 'transform: rotate(-90deg);' : 'transform: rotate(0deg);';
    groupHeader.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.3s; ${iconTransform}">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
      </svg> 
      กลุ่ม: ${escapeHtml(gName)} 
      <span style="font-size:11px; color:#888; margin-left:auto;">(${groups[gName].length} กล้อง)</span>
    `;
    
    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'group-items-container';
    itemsContainer.style.marginTop = '10px';
    itemsContainer.style.minHeight = '30px';
    itemsContainer.style.display = isCollapsed ? 'none' : 'block';
    
    itemsContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      itemsContainer.style.background = 'rgba(168,85,247,0.1)';
      itemsContainer.style.borderRadius = '8px';
    });
    itemsContainer.addEventListener('dragleave', (e) => {
      itemsContainer.style.background = 'transparent';
    });
    itemsContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      itemsContainer.style.background = 'transparent';
      const camIdx = parseInt(e.dataTransfer.getData('text/plain'));
      if (!isNaN(camIdx)) {
        const newGroup = gName === 'ทั่วไป (ไม่มีกลุ่ม)' ? '' : gName;
        window.cfg.channels[camIdx].group = newGroup;
        if (window.saveCfg) window.saveCfg();
        if (window.saveServerChannels) window.saveServerChannels();
        if (window.rebuildGrid) window.rebuildGrid();
        renderNvrCamList();
      }
    });

    groupHeader.addEventListener('click', () => {
      window.collapsedGroups[gName] = !window.collapsedGroups[gName];
      renderNvrCamList();
    });

    groupWrapper.appendChild(groupHeader);
    groupWrapper.appendChild(itemsContainer);
    list.appendChild(groupWrapper);

    groups[gName].forEach(item => {
      const {ch, idx} = item;
      const el = document.createElement('div');
      el.className = 'cam-item';
      el.draggable = true;
      el.style = 'display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); padding:10px 15px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); margin-bottom:10px; cursor: grab; transition: transform 0.1s, border-color 0.2s;';
      
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', idx);
        e.dataTransfer.effectAllowed = 'move';
        el.style.opacity = '0.5';
      });
      el.addEventListener('dragend', (e) => {
        el.style.opacity = '1';
      });

      let mainLabel = ch.src ? `Main: ${escapeHtml(ch.src)}` : 'Main: None';
      let subLabel = ch.sub ? ` | Sub: ${escapeHtml(ch.sub)}` : '';
      
      const isEnabled = ch.enabled !== false;
      const isAiOn = ch.detect !== false;
      
      const camBadge = isEnabled 
        ? `<span class="btn-toggle-cam" data-idx="${idx}" style="cursor:pointer; background:rgba(34,197,94,0.15); color:#4ade80; border:1px solid rgba(34,197,94,0.3); padding:2px 8px; border-radius:4px; font-size:11px; margin-left:8px; display:inline-flex; align-items:center; gap:4px;" title="คลิกเพื่อสลับเปิด/ปิดกล้อง"><svg width="8" height="8" viewBox="0 0 24 24" fill="#34e2a8" stroke="none"><circle cx="12" cy="12" r="10"/></svg>เปิดใช้งาน</span>`
        : `<span class="btn-toggle-cam" data-idx="${idx}" style="cursor:pointer; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); padding:2px 8px; border-radius:4px; font-size:11px; margin-left:8px; display:inline-flex; align-items:center; gap:4px;" title="คลิกเพื่อสลับเปิด/ปิดกล้อง"><svg width="8" height="8" viewBox="0 0 24 24" fill="#fb5b78" stroke="none"><circle cx="12" cy="12" r="10"/></svg>ปิดใช้งาน</span>`;

      const aiBadge = isAiOn 
        ? `<span class="btn-toggle-ai" data-idx="${idx}" style="cursor:pointer; background:rgba(168,85,247,0.15); color:#c084fc; border:1px solid rgba(168,85,247,0.3); padding:2px 8px; border-radius:4px; font-size:11px; margin-left:4px; display:inline-flex; align-items:center;" title="คลิกเพื่อสลับเปิด/ปิด AI"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8.01" y2="16"></line><line x1="16" y1="16" x2="16.01" y2="16"></line></svg>AI เปิด</span>`
        : `<span class="btn-toggle-ai" data-idx="${idx}" style="cursor:pointer; background:rgba(148,163,184,0.15); color:#94a3b8; border:1px solid rgba(148,163,184,0.3); padding:2px 8px; border-radius:4px; font-size:11px; margin-left:4px; display:inline-flex; align-items:center;" title="คลิกเพื่อสลับเปิด/ปิด AI"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>AI ปิด</span>`;

      el.innerHTML = `
        <div style="display:flex; align-items:center; gap: 10px; pointer-events:auto;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="cursor:grab;">
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <line x1="3" y1="6" x2="3.01" y2="6"></line>
            <line x1="3" y1="12" x2="3.01" y2="12"></line>
            <line x1="3" y1="18" x2="3.01" y2="18"></line>
          </svg>
          <div>
            <div style="font-weight:500; color:#fff; display:flex; align-items:center;">
              ${escapeHtml(ch.name || 'Unnamed Camera')} ${camBadge} ${aiBadge}
            </div>
            <div style="font-size:12px; color:#9aa0bd; margin-top:4px;">
              ${mainLabel}${subLabel}
            </div>
          </div>
        </div>
        <div>
          <button class="btn-ghost btn-edit-cam" data-idx="${idx}" style="color:#c7d0f8; padding:6px 12px; font-size:13px;">แก้ไข</button>
          <button class="btn-ghost btn-del-cam" data-idx="${idx}" style="color:#ef4444; padding:6px 12px; font-size:13px; margin-left:4px;">ลบ</button>
        </div>
      `;
      itemsContainer.appendChild(el);
    });
  });

  document.querySelectorAll('.btn-toggle-cam').forEach(b => {
    b.addEventListener('click', async (e) => {
      const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
      const newVal = !(window.cfg.channels[idx].enabled !== false);
      const ch = window.cfg.channels[idx];
      ch.enabled = newVal;
      if (window.state && window.state.draft && window.state.draft[idx]) {
        window.state.draft[idx].enabled = newVal;
      }
      if (window.saveCfg) window.saveCfg();
      if (window.saveServerChannels) window.saveServerChannels();
      if (window.rebuildGrid) window.rebuildGrid();
      
      // Update Frigate backend
      if (ch.src) {
        try {
          await fetch(`/api/config/cameras/${encodeURIComponent(ch.src)}/enabled`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enabled: ch.enabled !== false,
              detect_enabled: ch.enabled !== false ? (ch.detect !== false) : false
            })
          });
        } catch(err) { console.warn('Frigate Cam toggle error:', err); }
      }

      renderNvrCamList();
      if (typeof window.renderChList === 'function') window.renderChList();
      if (typeof window.renderChForm === 'function') window.renderChForm();
    });
  });

  document.querySelectorAll('.btn-toggle-ai').forEach(b => {
    b.addEventListener('click', async (e) => {
      const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
      const newVal = !(window.cfg.channels[idx].detect !== false);
      const ch = window.cfg.channels[idx];
      ch.detect = newVal;
      if (window.state && window.state.draft && window.state.draft[idx]) {
        window.state.draft[idx].detect = newVal;
      }
      if (window.saveCfg) window.saveCfg();
      if (window.saveServerChannels) window.saveServerChannels();
      if (window.rebuildGrid) window.rebuildGrid();
      
      // Update Frigate backend
      if (ch.src) {
        try {
          await fetch(`/api/config/cameras/${encodeURIComponent(ch.src)}/enabled`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              enabled: ch.enabled !== false,
              detect_enabled: ch.enabled !== false ? (ch.detect !== false) : false
            })
          });
        } catch(err) { console.warn('Frigate AI toggle error:', err); }
      }

      renderNvrCamList();
      if (typeof window.renderChList === 'function') window.renderChList();
      if (typeof window.renderChForm === 'function') window.renderChForm();
    });
  });

  document.querySelectorAll('.btn-edit-cam').forEach(b => {
    b.addEventListener('click', (e) => {
      openCamEdit(parseInt(e.currentTarget.getAttribute('data-idx')));
    });
  });

  document.querySelectorAll('.btn-del-cam').forEach(b => {
    b.addEventListener('click', async (e) => {
      const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
      const name = (window.cfg.channels[idx] && window.cfg.channels[idx].name) ? window.cfg.channels[idx].name : '';
      const ok = window.bppConfirm ? await window.bppConfirm('คุณแน่ใจหรือไม่ที่จะลบกล้อง ' + name + '?') : confirm('คุณแน่ใจหรือไม่ที่จะลบกล้อง ' + name + '?');
      if (ok) {
        window.cfg.channels.splice(idx, 1);
        if (window.saveCfg) window.saveCfg();
        if (window.saveServerChannels) window.saveServerChannels();
        if (window.rebuildGrid) window.rebuildGrid();
        renderNvrCamList();
      }
    });
  });
}

function openCamEdit(idx = -1) {
  editingCamIndex = idx;
  const isEdit = idx >= 0;
  document.getElementById('camEditTitle').innerText = isEdit ? 'แก้ไขกล้อง' : 'เพิ่มกล้องใหม่';
  
  const ch = isEdit ? window.cfg.channels[idx] : { src: '', name: '', sub: '', group: '', detect: true, record: true, width: 1920, height: 1080 };
  
  document.getElementById('inpCamName').value = ch.name || '';
  if (document.getElementById('inpCamDisplayName')) {
    document.getElementById('inpCamDisplayName').value = (window.state && window.state.cameraNames) ? (window.state.cameraNames[ch.name] || '') : '';
  }
  document.getElementById('inpCamGroup').value = ch.group || '';
  document.getElementById('inpCamMain').value = ch.src || '';
  document.getElementById('inpCamSub').value = ch.sub || '';
  
  if (document.getElementById('inpCamDetect')) document.getElementById('inpCamDetect').checked = ch.detect !== false;
  if (document.getElementById('inpCamRecord')) document.getElementById('inpCamRecord').checked = ch.record !== false;
  if (document.getElementById('inpCamWidth')) document.getElementById('inpCamWidth').value = ch.width || 1920;
  if (document.getElementById('inpCamHeight')) document.getElementById('inpCamHeight').value = ch.height || 1080;
  
  const selPreset = document.getElementById('selCamPreset');
  if (selPreset) {
    if (ch.detect === false) {
      const url = (ch.src || '').toLowerCase();
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

  document.getElementById('camListView').hidden = true;
  document.getElementById('camEditView').hidden = false;
}

function initEdgeLprAndVigiUI() {
  const secretToken = 'bpp_secret_2026';
  const webhookUrl = `${window.location.origin}/api/lpr/camera-webhook?token=${secretToken}`;

  // Populate Webhook URL inputs
  const inpEdgeWebhookUrl = document.getElementById('inpEdgeWebhookUrl');
  if (inpEdgeWebhookUrl) inpEdgeWebhookUrl.value = webhookUrl;
  const guideWebhookUrlCopyBox = document.getElementById('guideWebhookUrlCopyBox');
  if (guideWebhookUrlCopyBox) guideWebhookUrlCopyBox.value = webhookUrl;

  // Copy Webhook URL button
  const btnCopyWebhookUrl = document.getElementById('btnCopyWebhookUrl');
  if (btnCopyWebhookUrl) {
    btnCopyWebhookUrl.addEventListener('click', () => {
      const urlToCopy = inpEdgeWebhookUrl ? inpEdgeWebhookUrl.value : webhookUrl;
      const onCopied = () => {
        if (window.bppToast) window.bppToast('คัดลอก Webhook URL เรียบร้อยแล้ว!');
        else alert('คัดลอก Webhook URL เรียบร้อยแล้ว!');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(urlToCopy).then(onCopied).catch(() => {
          fallbackCopyText(urlToCopy);
          onCopied();
        });
      } else {
        fallbackCopyText(urlToCopy);
        onCopied();
      }
    });
  }

  function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  // Setup Guide Modal
  const modal = document.getElementById('bppCameraSetupGuideModal');
  const btnOpenGuide = document.getElementById('btnOpenSetupGuide');
  const btnCloseGuide = document.getElementById('btnCloseCameraSetupGuide');
  const btnCloseGuide2 = document.getElementById('btnCloseCameraSetupGuide2');

  function openGuideModal() {
    if (modal) {
      modal.hidden = false;
      modal.style.display = 'flex';
    }
  }

  function closeGuideModal() {
    if (modal) {
      modal.hidden = true;
      modal.style.display = 'none';
    }
  }

  if (btnOpenGuide) btnOpenGuide.addEventListener('click', openGuideModal);
  if (btnCloseGuide) btnCloseGuide.addEventListener('click', closeGuideModal);
  if (btnCloseGuide2) btnCloseGuide2.addEventListener('click', closeGuideModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeGuideModal();
    });
  }

  // Guide Tabs Switching
  const tabs = [
    { btnId: 'btnGuideTabVigi', secId: 'guideSectionVigi' },
    { btnId: 'btnGuideTabDahua', secId: 'guideSectionDahua' },
    { btnId: 'btnGuideTabCgnat', secId: 'guideSectionCgnat' }
  ];

  tabs.forEach(t => {
    const btn = document.getElementById(t.btnId);
    if (btn) {
      btn.addEventListener('click', () => {
        tabs.forEach(item => {
          const b = document.getElementById(item.btnId);
          const s = document.getElementById(item.secId);
          if (b) {
            b.style.borderBottom = item.btnId === t.btnId ? '2px solid #a855f7' : '2px solid transparent';
            b.style.color = item.btnId === t.btnId ? '#c084fc' : '#94a3b8';
          }
          if (s) {
            s.style.display = item.btnId === t.btnId ? 'block' : 'none';
          }
        });
      });
    }
  });

  // Preset Selector Logic
  const selPreset = document.getElementById('selCamPreset');
  const inpDetect = document.getElementById('inpCamDetect');
  const hintBox = document.getElementById('presetHintBox');

  if (selPreset) {
    selPreset.addEventListener('change', () => {
      const val = selPreset.value;
      const inpMain = document.getElementById('inpCamMain');
      const camName = document.getElementById('inpCamName') ? document.getElementById('inpCamName').value.trim() : '';
      if (val === 'vigi_ai') {
        if (inpDetect) inpDetect.checked = false;
        if (inpMain && (!inpMain.value.trim() || inpMain.value.startsWith('rtmp://'))) {
          inpMain.value = `rtmp://bpp215.duckdns.org:1935/${camName || 'ชื่อกล้อง'}`;
        }
        if (hintBox) {
          hintBox.style.display = 'block';
          hintBox.style.background = 'rgba(168,85,247,0.1)';
          hintBox.style.border = '1px solid rgba(168,85,247,0.3)';
          hintBox.style.color = '#c084fc';
          hintBox.innerHTML = '⚡ <b>TP-Link VIGI (Smart AI):</b> ระบบปิด Server AI ให้อัตโนมัติ (0% CPU Load) กล้องจะตรวจจับคน/ยานพาหนะในตัวกล้องแทน<br><span style="font-size:11px; color:#e2e8f0; margin-top:4px; display:inline-block;">👉 ในหน้าตั้งค่ากล้อง VIGI ให้ใส่ RTMP Push มาที่: <b>rtmp://bpp215.duckdns.org:1935/' + (camName || 'ชื่อกล้อง') + '</b></span>';
        }
      } else if (val === 'lpr_edge') {
        if (inpDetect) inpDetect.checked = false;
        if (hintBox) {
          hintBox.style.display = 'block';
          hintBox.style.background = 'rgba(56,189,248,0.1)';
          hintBox.style.border = '1px solid rgba(56,189,248,0.3)';
          hintBox.style.color = '#38bdf8';
          hintBox.innerHTML = '🎯 <b>Edge LPR Camera:</b> ระบบปิด Server AI ให้อัตโนมัติ กล้องจะอ่านป้ายทะเบียนในตัวแล้วส่งผลมาทาง Webhook โดยตรง';
        }
      } else {
        if (inpDetect) inpDetect.checked = true;
        if (hintBox) {
          hintBox.style.display = 'block';
          hintBox.style.background = 'rgba(34,197,94,0.1)';
          hintBox.style.border = '1px solid rgba(34,197,94,0.3)';
          hintBox.style.color = '#4ade80';
          hintBox.innerHTML = '🛡️ <b>กล้องทั่วไป:</b> ระบบเปิด Server AI (YOLOv8) บนเครื่องเซิร์ฟเวอร์เพื่อตรวจจับคนและยานพาหนะ';
        }
      }
    });
  }

  // Camera Name change syncs to RTMP URL when preset is vigi_ai
  const inpCamNameEl = document.getElementById('inpCamName');
  if (inpCamNameEl) {
    inpCamNameEl.addEventListener('input', () => {
      const sel = document.getElementById('selCamPreset');
      const inpMain = document.getElementById('inpCamMain');
      if (sel && sel.value === 'vigi_ai' && inpMain) {
        const nameVal = inpCamNameEl.value.trim();
        if (!inpMain.value.trim() || inpMain.value.startsWith('rtmp://bpp215.duckdns.org:1935/') || inpMain.value.startsWith('rtmp://127.0.0.1:1935/')) {
          inpMain.value = `rtmp://bpp215.duckdns.org:1935/${nameVal || 'ชื่อกล้อง'}`;
        }
      }
    });
  }

  // RTSP auto-detect to switch preset
  const inpMain = document.getElementById('inpCamMain');
  if (inpMain && selPreset) {
    inpMain.addEventListener('input', () => {
      const url = inpMain.value.trim().toLowerCase();
      if (selPreset.value === 'general') {
        if (url.includes('itc') || url.includes('lpr')) {
          selPreset.value = 'lpr_edge';
          selPreset.dispatchEvent(new Event('change'));
        } else if (url.includes('vigi') || /\/ch\d+\/stream/i.test(url)) {
          selPreset.value = 'vigi_ai';
          selPreset.dispatchEvent(new Event('change'));
        }
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initEdgeLprAndVigiUI();
  // app.js owns the NVR camera form through Config API. Keeping this legacy
  // channel-map writer detached prevents the shared buttons from issuing a
  // second, incompatible save after the authoritative camera mutation.



  // WebRTC IP Listeners
  const inpWebRtcIp = document.getElementById('inpWebRtcIp');
  const btnAutoWebRtcIp = document.getElementById('btnAutoWebRtcIp');
  const btnSaveWebRtcIp = document.getElementById('btnSaveWebRtcIp');

  setTimeout(() => {
    if (inpWebRtcIp && window.cfg && window.cfg.base) {
      inpWebRtcIp.value = window.cfg.base;
    }
  }, 500);

  if (btnAutoWebRtcIp && inpWebRtcIp) {
    btnAutoWebRtcIp.addEventListener('click', () => {
      inpWebRtcIp.value = window.location.hostname;
    });
  }

  if (btnSaveWebRtcIp && inpWebRtcIp) {
    btnSaveWebRtcIp.addEventListener('click', () => {
      const newIp = inpWebRtcIp.value.trim();
      if (!newIp) {
        window.bppToast('กรุณาระบุ IP ก่อนบันทึก', true);
        return;
      }
      
      if (window.cfg) {
        window.cfg.base = newIp;
        if (window.saveCfg) window.saveCfg();
        if (window.bppToast) window.bppToast('บันทึกเรียบร้อย กำลังรีสตาร์ทหน้าเว็บ...');
        setTimeout(() => window.location.reload(), 1000);
      }
    });
  }

  // Retired legacy batch buttons and tab switchers: delegated completely to app.js
  // to avoid conflicting event handlers and unintended Frigate restarts.
});
