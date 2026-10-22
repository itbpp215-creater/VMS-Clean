/**
 * Chat Widget for BPP-VMS Dashboard (Sloth AI Bot & NAS Integration)
 * Aligned to BPP-VMS Purple Glassmorphism Design System.
 */

(function () {
  'use strict';

  // Inject Chat Widget Modal CSS matching BPP-VMS Design Tokens
  const style = document.createElement('style');
  style.textContent = `
    .chat-widget-window {
      position: fixed;
      top: 76px;
      right: 18px;
      width: 390px;
      height: 540px;
      min-width: 300px;
      min-height: 400px;
      resize: both;
      background: linear-gradient(180deg, rgba(22, 17, 44, 0.96), rgba(12, 10, 26, 0.98));
      backdrop-filter: blur(26px);
      -webkit-backdrop-filter: blur(26px);
      border: 1px solid rgba(168, 85, 247, 0.45);
      border-radius: 16px;
      z-index: 9991;
      display: none;
      flex-direction: column;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(124, 58, 237, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08);
      overflow: hidden;
      font-family: var(--font-body, "Noto Sans Thai", sans-serif);
      animation: chatSlideDown 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes chatSlideDown {
      from { opacity: 0; transform: translateY(-12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .chat-widget-window.open {
      display: flex;
    }
    @media (max-width: 768px) {
      .chat-widget-window {
        top: 60px !important;
        right: 10px !important;
        left: 10px !important;
        width: auto !important;
        max-width: none !important;
        height: calc(100dvh - 80px) !important;
        max-height: 560px !important;
        border-radius: 12px !important;
      }
      .chat-widget-header {
        padding: 10px 14px !important;
      }
      .chat-widget-header h4 {
        font-size: 13.5px !important;
      }
      .chat-menu-bar {
        padding: 6px 10px !important;
        gap: 5px !important;
      }
      .chat-cmd-btn {
        padding: 4px 8px !important;
        font-size: 11px !important;
      }
      .chat-widget-body {
        padding: 10px 12px !important;
      }
      .chat-widget-footer {
        padding: 8px 10px !important;
      }
    }

    .chat-widget-header {
      background: linear-gradient(180deg, rgba(35, 27, 66, 0.8), rgba(20, 15, 40, 0.6));
      padding: 14px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(168, 85, 247, 0.3);
      color: #eef0f8;
    }
    .chat-widget-header h4 {
      margin: 0;
      font-size: 14.5px;
      font-family: var(--font-ui, sans-serif);
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #c084fc;
      letter-spacing: 0.3px;
    }
    .chat-widget-body {
      flex: 1;
      padding: 14px 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: rgba(10, 8, 22, 0.3);
    }
    .chat-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.45;
      word-break: break-word;
    }
    .chat-msg.bot {
      background: rgba(26, 20, 50, 0.7);
      color: #e2e8f0;
      align-self: flex-start;
      border-bottom-left-radius: 3px;
      border: 1px solid rgba(168, 85, 247, 0.25);
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .chat-msg.user {
      background: linear-gradient(150deg, #7c3aed, #a855f7);
      color: #ffffff;
      align-self: flex-end;
      font-weight: 500;
      border-bottom-right-radius: 3px;
      box-shadow: 0 3px 12px rgba(124, 58, 237, 0.35);
    }
    .chat-widget-footer {
      padding: 12px;
      border-top: 1px solid rgba(168, 85, 247, 0.25);
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(10, 8, 22, 0.75);
    }
    .chat-input {
      flex: 1;
      min-width: 0;
      padding: 10px 14px;
      border: 1px solid rgba(168, 85, 247, 0.4);
      border-radius: 8px;
      outline: none;
      font-size: 13.5px;
      font-family: var(--font-ui, sans-serif);
      background: rgba(0, 0, 0, 0.2);
      color: #e2e8f0;
      transition: all .2s;
    }
    .chat-input:focus {
      border-color: #c084fc;
      background: rgba(0, 0, 0, 0.4);
      box-shadow: 0 0 0 2px rgba(192, 132, 252, 0.2);
    }
    .chat-input::placeholder { color: #64748b; }
    
    .chat-send-btn, .chat-file-btn {
      background: linear-gradient(135deg, #a855f7, #7c3aed);
      border: none;
      border-radius: 10px;
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #ffffff;
      transition: filter .12s, transform .1s;
    }
    .chat-send-btn:hover, .chat-file-btn:hover {
      filter: brightness(1.15);
      transform: translateY(-1px);
    }
    .chat-close-btn {
      background: none;
      border: none;
      color: #9aa0bd;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      padding: 4px;
      transition: color .12s;
    }
    .chat-menu-bar {
      padding: 8px 12px;
      background: rgba(14, 11, 30, 0.95);
      border-bottom: 1px solid rgba(168, 85, 247, 0.2);
      display: flex;
      gap: 6px;
      overflow-x: auto;
      white-space: nowrap;
    }
    .chat-cmd-btn {
      background: rgba(26, 20, 50, 0.8);
      border: 1px solid rgba(168, 85, 247, 0.28);
      border-radius: 6px;
      color: #e2e8f0;
      padding: 5px 10px;
      font-size: 11.5px;
      font-family: var(--font-ui, sans-serif);
      font-weight: 500;
      cursor: pointer;
      transition: all .15s ease;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
      flex-shrink: 0;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
    .chat-cmd-btn:hover {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.35), rgba(168, 85, 247, 0.25));
      border-color: rgba(192, 132, 252, 0.7);
      color: #ffffff;
      transform: translateY(-1px);
    }
  `;
  document.head.appendChild(style);

  const THAI_TITLE_PREFIX_REGEX = /^(?:พลตำรวจ(?:เอก|โท|ตรี)|พล\.ต\.[อทต]\.?|พันตำรวจ(?:เอก|โท|ตรี)|พ\.ต\.[อทต]\.?|ร้อยตำรวจ(?:เอก|โท|ตรี)|ร\.ต\.[อทต]\.?|ดาบตำรวจ|ด\.ต\.?|จ่าสิบ(?:ตำรวจ|เอก|โท|ตรี)|จ\.ส\.[ตอท]\.?|สิบตำรวจ(?:เอก|โท|ตรี)|ส\.ต\.[อทต]\.?|นายตำรวจ|นายร้อยตำรวจ|นายดาบ|พล(?:เอก|โท|ตรี)|พล\.[อทต]\.?|พัน(?:เอก|โท|ตรี)|พ\.[อทต]\.?|ร้อย(?:เอก|โท|ตรี)|ร\.[อทต]\.?|สิบ(?:เอก|โท|ตรี)|ส\.[อทต]\.?|พลทหาร|นางสาว|น\.ส\.?|นาง(?!รอง)|นาย|เด็กชาย|เด็กหญิง|ด\.[ชญ]\.?|นายแพทย์|นพ\.?|แพทย์หญิง|พญ\.?|ดร\.?|อาจารย์|อ\.?|คุณ|ท่าน|mr\.?|mrs\.?|miss|ms\.?)\s*/i;

  // Account Label (Display Name + @username). Falls back to the username alone.
  function accLabelText(username) {
    return (window.bppAccountLabel && window.bppAccountLabel.text(username)) || String(username || '');
  }
  function accLabelHtml(username) {
    const t = accLabelText(username);
    return (window.bppAccountLabel ? window.bppAccountLabel.esc(t) : String(t).replace(/[&<>"']/g, ''));
  }

  function stripThaiPrefix(txt) {
    if (!txt) return '';
    return String(txt).replace(THAI_TITLE_PREFIX_REGEX, '').trim();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div id="chatWidgetWindow" class="chat-widget-window">
        <div class="chat-widget-header">
          <h4>
            <img src="assets/BPP215.png" alt="Sloth Logo" style="width:22px;height:22px;object-fit:contain;border-radius:50%;filter:drop-shadow(0 0 6px rgba(192,132,252,0.6));">
            <span>Sloth AI & NAS Assistant</span>
          </h4>
          <button id="chatWidgetClose" class="chat-close-btn">&times;</button>
        </div>
        <!-- Permanent Visible Quick Action Menu Bar -->
        <div class="chat-menu-bar">
          <button class="chat-cmd-btn" data-cmd="/list">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            รายการเหตุการณ์
          </button>
          <button class="chat-cmd-btn" data-cmd="/search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            ค้นหาคดี
          </button>
          <button class="chat-cmd-btn" data-cmd="/persons">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            ประวัติบุคคล
          </button>
          <button class="chat-cmd-btn" data-cmd="/graph">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            ผังความสัมพันธ์
          </button>
          <button class="chat-cmd-btn" data-cmd="/pair">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffa502" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            ผูกบัญชี
          </button>
          <button class="chat-cmd-btn" data-cmd="/clear">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fb5b78" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            ล้างข้อมูล
          </button>
        </div>
        <div id="chatWidgetBody" class="chat-widget-body">
          <div class="chat-msg bot">
            <b style="color:#c084fc;">สวัสดีครับ ระบบพร้อมรับคำสั่งข่าวกรอง Sloth AI</b><br>
            <span style="font-size:12px;color:#9aa0bd;">เลือกกดปุ่มเมนูด่วนด้านบน หรือพิมพ์รายงานเพื่อบันทึกคดีเข้าสู่ระบบ:</span>
            <div style="margin-top:6px;font-size:12px;line-height:1.6;">
              • <b>รายการเหตุการณ์</b> — ตรวจสอบและจัดการคำขอแก้ไข/ลบ<br>
              • <b>ค้นหาคดี</b> — สืบค้นสำนวนและบันทึกคดีในระบบ NAS<br>
              • <b>ประวัติบุคคล</b> — ดูประวัติบุคคลและการเชื่อมโยงข้อมูล<br>
              • <b>ผูกบัญชี</b> — ขอรหัสเชื่อมต่อ Telegram Bot (เชื่อมต่อถาวร ครั้งเดียวจบ)<br>
              • <b>ล้างข้อมูล</b> — รีเซ็ตสถิติและดัชนีแผนที่ (Admin)
            </div>
          </div>
        </div>
        <div class="chat-widget-footer">
          <input type="file" id="chatFileInput" style="display:none">
          <select id="chatCaseSelect" class="chat-case-select" title="เลือกเคสที่ต้องการเพิ่มไฟล์" style="background:rgba(255,255,255,0.08);border:1px solid rgba(168,85,247,0.35);color:#c084fc;padding:4px 6px;border-radius:6px;font-size:11.5px;width:max-content;max-width:115px;flex-shrink:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;outline:none;cursor:pointer;">
            <option value="new">🆕 สร้างเคสใหม่</option>
          </select>
          <button id="chatFileBtn" class="chat-file-btn" title="แนบไฟล์/รูปภาพ">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <input type="text" id="chatInput" class="chat-input" placeholder="พิมพ์ข้อความรายงาน หรือกดเมนูด่วนด้านบน...">
          <button id="chatSendBtn" class="chat-send-btn" title="ส่ง">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>

      <!-- Custom Action Popup Modal (Replaces browser alert/prompt) -->
      <div id="chatActionModal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(10,8,22,0.75);backdrop-filter:blur(6px);z-index:99999;align-items:center;justify-content:center;">
        <div style="background:rgba(22,17,46,0.95);border:1px solid rgba(168,85,247,0.4);border-radius:12px;width:90%;max-width:440px;padding:20px;box-shadow:0 12px 36px rgba(0,0,0,0.6);color:#f1f5f9;font-family:var(--font-ui,sans-serif);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;border-bottom:1px solid rgba(168,85,247,0.2);padding-bottom:10px;">
            <h4 id="chatActionTitle" style="margin:0;font-size:15px;color:#c084fc;display:flex;align-items:center;gap:6px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path></svg>ดำเนินการ</h4>
            <button id="chatActionClose" style="background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer;">&times;</button>
          </div>
          <div id="chatActionBody" style="font-size:13px;line-height:1.5;margin-bottom:16px;color:#cbd5e1;"></div>
          <div style="display:flex;justify-content:flex-end;gap:10px;">
            <button id="chatActionCancel" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#cbd5e1;padding:7px 14px;border-radius:6px;font-size:12.5px;cursor:pointer;">ยกเลิก</button>
            <button id="chatActionSubmit" style="background:linear-gradient(135deg,#7c3aed,#9333ea);border:none;color:#ffffff;padding:7px 16px;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 3px 10px rgba(124,58,237,0.35);">ตกลง</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    const windowEl = document.getElementById('chatWidgetWindow');
    const closeBtn = document.getElementById('chatWidgetClose');
    const sendBtn = document.getElementById('chatSendBtn');
    const inputEl = document.getElementById('chatInput');
    const bodyEl = document.getElementById('chatWidgetBody');
    const fileBtn = document.getElementById('chatFileBtn');
    const fileInput = document.getElementById('chatFileInput');
    const headerEl = container.querySelector('.chat-widget-header');

    // Drag Logic
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    headerEl.addEventListener('mousedown', (e) => {
      // Don't drag if clicking the close button
      if (e.target.closest('.chat-close-btn')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = windowEl.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      
      // Remove bottom/right constraints so left/top take over
      windowEl.style.bottom = 'auto';
      windowEl.style.right = 'auto';
      windowEl.style.left = initialLeft + 'px';
      windowEl.style.top = initialTop + 'px';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      windowEl.style.left = (initialLeft + dx) + 'px';
      windowEl.style.top = (initialTop + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
      }
    });

    function resetWidgetBounds() {
      windowEl.style.width = '';
      windowEl.style.height = '';
      windowEl.style.top = '';
      windowEl.style.left = '';
      windowEl.style.bottom = '';
      windowEl.style.right = '';
    }

    // Attach listener to topbar button (#btnBotChat)
    const btnBotChat = document.getElementById('btnBotChat');
    if (btnBotChat) {
      btnBotChat.addEventListener('click', () => {
        const isOpen = windowEl.classList.toggle('open');
        btnBotChat.setAttribute('aria-pressed', isOpen ? 'true' : 'false');
        if (isOpen) {
          btnBotChat.classList.add('on');
        } else {
          btnBotChat.classList.remove('on');
          resetWidgetBounds();
        }
      });
    }

    closeBtn.addEventListener('click', () => {
      windowEl.classList.remove('open');
      resetWidgetBounds();
      if (btnBotChat) {
        btnBotChat.setAttribute('aria-pressed', 'false');
        btnBotChat.classList.remove('on');
      }
    });

    // Quick Menu Bar click delegation
    const menuBar = document.querySelector('.chat-menu-bar');
    if (menuBar) {
      menuBar.addEventListener('click', (e) => {
        const cmdBtn = e.target.closest('.chat-cmd-btn');
        if (!cmdBtn) return;
        const cmd = cmdBtn.dataset.cmd;
        if (cmd === '/search') {
          inputEl.value = '/search ';
          inputEl.focus();
        } else {
          inputEl.value = cmd;
          handleSend();
        }
      });
    }

    function showChatCustomPopup({ title, bodyHtml, confirmText = 'ตกลง', confirmStyle = '', hideCancel = false, onConfirm }) {
      const modal = document.getElementById('chatActionModal');
      const titleEl = document.getElementById('chatActionTitle');
      const bodyElModal = document.getElementById('chatActionBody');
      const submitBtn = document.getElementById('chatActionSubmit');
      const cancelBtn = document.getElementById('chatActionCancel');
      const closeBtnModal = document.getElementById('chatActionClose');

      if (!modal) return;

      titleEl.innerHTML = title;
      bodyElModal.innerHTML = bodyHtml;
      submitBtn.textContent = confirmText;
      if (confirmStyle) submitBtn.style.cssText = confirmStyle;
      else submitBtn.style.cssText = "background:linear-gradient(135deg,#7c3aed,#9333ea);border:none;color:#ffffff;padding:7px 16px;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 3px 10px rgba(124,58,237,0.35);";

      cancelBtn.style.display = hideCancel ? 'none' : 'inline-block';

      modal.style.display = 'flex';

      const hide = () => { modal.style.display = 'none'; };

      closeBtnModal.onclick = hide;
      cancelBtn.onclick = hide;

      submitBtn.onclick = async () => {
        if (onConfirm) {
          const res = await onConfirm();
          if (res !== false) hide();
        } else {
          hide();
        }
      };
    }

    // Central Event Delegation on chatWidgetBody for all action buttons
    bodyEl.addEventListener('click', async (e) => {
      // 0. View Event Details
      const viewBtn = e.target.closest('.btn-view-event');
      if (viewBtn) {
        e.preventDefault(); e.stopPropagation();
        const eventId = viewBtn.dataset.eventId;
        if (!eventId || !window.__currentEvents) return;
        const ev = window.__currentEvents.find(x => x.event_id === eventId);
        if (!ev) return;
        
        let bodyHtml = `<div style="font-size:13px;color:#e2e8f0;line-height:1.6;display:flex;flex-direction:column;gap:12px;">`;
        
        if (ev.raw_text) {
          bodyHtml += `<div><b style="color:#c084fc;font-size:13.5px;">ข้อความรายงาน:</b><br><div style="background:rgba(0,0,0,0.3);padding:10px;border-radius:6px;border:1px solid rgba(168,85,247,0.3);margin-top:4px;">${ev.raw_text}</div></div>`;
        }
        
        bodyHtml += `<div><b style="color:#34e2a8;font-size:13.5px;">สถานที่ / พิกัด:</b><br>• ${ev.location_name || ev.arrest_location || 'ไม่ระบุพื้นที่'}</div>`;
        
        const suspectName = [ev.first_name, ev.last_name].filter(Boolean).join(' ');
        if (suspectName || ev.phone || ev.license_plate) {
          bodyHtml += `<div><b style="color:#38bdf8;font-size:13.5px;">ข้อมูลผู้ต้องสงสัย:</b><br>`;
          if (suspectName) bodyHtml += `• <b>ชื่อ-สกุล:</b> ${suspectName}<br>`;
          if (ev.phone) bodyHtml += `• <b>เบอร์โทร:</b> ${ev.phone}<br>`;
          if (ev.license_plate) bodyHtml += `• <b>ทะเบียนรถ:</b> ${ev.license_plate}<br>`;
          bodyHtml += `</div>`;
        }
        
        if (ev.drugs_info) {
          bodyHtml += `<div><b style="color:#fb5b78;font-size:13.5px;">ข้อมูลยาเสพติด:</b><br>• ${ev.drugs_info}</div>`;
        }
        
        bodyHtml += `</div>`;
        
        showChatCustomPopup({
          title: `รายละเอียดเหตุการณ์`,
          bodyHtml: bodyHtml,
          confirmText: 'ปิดหน้าต่าง',
          confirmStyle: 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#e2e8f0;padding:7px 16px;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;',
          hideCancel: true
        });
        return;
      }

      // 1. Direct Edit Event (Admin)
      const editBtn = e.target.closest('.btn-edit-event');
      if (editBtn) {
        e.preventDefault(); e.stopPropagation();
        const eventId = editBtn.dataset.eventId;
        if (eventId) await window.__editChatEvent(eventId);
        return;
      }

      // 2. Delete Event (Admin only with Custom Popup)
      const deleteBtn = e.target.closest('.btn-delete-event');
      if (deleteBtn) {
        e.preventDefault(); e.stopPropagation();
        const eventId = deleteBtn.dataset.eventId;
        if (!eventId) return;

        showChatCustomPopup({
          title: 'ยืนยันการลบรายการเหตุการณ์',
          bodyHtml: 'คุณต้องการลบรายการเหตุการณ์นี้ใช่หรือไม่?<br><span style="color:#9aa0bd;font-size:12px;">(การลบรายการจะทำการอัปเดตสถิติและสีความเสี่ยงบนแผนที่โดยอัตโนมัติ)</span>',
          confirmText: 'ยืนยันลบรายการ',
          confirmStyle: 'background:linear-gradient(135deg,#e11d48,#fb5b78);border:none;color:#ffffff;padding:7px 16px;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 3px 10px rgba(225,29,72,0.35);',
          onConfirm: async () => {
            await window.__deleteChatEvent(eventId);
          }
        });
        return;
      }

      // 2. Request Edit/Delete (Officer)
      const reqEditBtn = e.target.closest('.btn-request-edit');
      if (reqEditBtn) {
        e.preventDefault(); e.stopPropagation();
        const eventId = reqEditBtn.dataset.eventId;
        if (eventId) await window.__requestEditChatEvent(eventId);
        return;
      }

      // 3. View Pending Requests (Admin)
      const viewReqBtn = e.target.closest('.btn-view-requests');
      if (viewReqBtn) {
        e.preventDefault(); e.stopPropagation();
        await window.__adminReviewRequests();
        return;
      }

      // 4. Approve Request (Admin)
      const approveBtn = e.target.closest('.btn-approve-req');
      if (approveBtn) {
        e.preventDefault(); e.stopPropagation();
        const reqId = approveBtn.dataset.reqId;
        const container = approveBtn.parentElement;
        if (reqId) await window.__approveReq(reqId, container);
        return;
      }

      // 5. Reject Request (Admin)
      const rejectBtn = e.target.closest('.btn-reject-req');
      if (rejectBtn) {
        e.preventDefault(); e.stopPropagation();
        const reqId = rejectBtn.dataset.reqId;
        const container = rejectBtn.parentElement;
        if (reqId) await window.__rejectReq(reqId, container);
        return;
      }

      // 6. View Zone Intelligence Details Modal from Search
      const zoneBtn = e.target.closest('.btn-view-zone-details');
      if (zoneBtn) {
        e.preventDefault(); e.stopPropagation();
        let rawZone = zoneBtn.dataset.zone || '';
        let zoneName = rawZone;
        const match = rawZone.match(/(?:อ\.|อำเภอ)\s*([ก-ฮa-zA-Z]+)/);
        if (match && match[1]) zoneName = match[1];

        if (zoneName && window.__showZoneReportDetails) {
          window.__showZoneReportDetails(zoneName);
        }
        return;
      }
    });

    function appendMsg(text, type = 'bot') {
      const msg = document.createElement('div');
      msg.className = `chat-msg ${type}`;
      msg.innerHTML = text;
      bodyEl.appendChild(msg);
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }

    async function handleSend() {
      const text = inputEl.value.trim();
      if (!text) return;

      appendMsg(text, 'user');
      inputEl.value = '';

      const delMatch = text.match(/^(?:\/delete|\/del|ลบ)\s+(Case[_\-\s]\w+|คดี[_\-\s]?\w+)/i);
      if (delMatch) {
        const caseId = delMatch[1].replace(/\s+/g, '_').replace(/-/g, '_');
        try {
          const res = await fetch(`/api/nas-bot/cases/${caseId}`, { method: 'DELETE' });
          const d = await res.json();
          if (res.ok) {
            appendMsg(`<b>ลบสำนวนคดี ${caseId} ออกจากระบบ NAS เรียบร้อยแล้วครับ!</b> `);
          } else {
            appendMsg(`${d.detail || 'ไม่พบสำนวนคดีนี้ในระบบ'}`);
          }
        } catch (e) {
          appendMsg('ไม่สามารถลบสำนวนคดีได้ในขณะนี้');
        }
        return;
      }

      if (text === '/pair') {
        try {
          const res = await fetch('/api/nas-bot/pair/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: (window.bppSession && window.bppSession.username) || (window.bppSession && window.bppSession.user) || 'admin' })
          });
          const data = await res.json();
          if (data.is_already_paired) {
            appendMsg(`<b>ผูกบัญชีสำเร็จเรียบร้อยแล้วครับคุณ '${data.username}' </b><br><span style="font-size:12px;color:#34e2a8;">สถานะ: เชื่อมต่อถาวรเรียบร้อยครับ (สามารถส่งรูปภาพ ทร.14 หรือข้อความจาก Telegram ได้ตลอดเวลาเลยนะครับ)</span><br><br><span style="font-size:11px;color:#9aa0bd;">(กรณีต้องการย้ายไปผูกกับเครื่องใหม่ รหัสผูกบัญชีสำรองของคุณคือ: <code style="color:#c084fc;">${data.pairing_code}</code>)</span>`);
          } else {
            appendMsg(`<b>รหัสผูกบัญชี (Pairing Code):</b> <code style="color:#c084fc;">${data.pairing_code}</code><br>นำรหัส 6 หลักนี้ไปส่งให้ Sloth Bot ใน Telegram ภายใน 10 นาทีได้เลยนะครับผม <br><span style="font-size:12px;color:#34e2a8;">เมื่อนำรหัสไปใส่ใน Telegram แล้ว บัญชีจะเชื่อมต่อถาวรทันที ไม่ต้องขอรหัสซ้ำเมื่อรีเฟรชหน้าเว็บครับ</span>`);
          }
        } catch (e) {
          appendMsg('ไม่สามารถขอรหัสผูกบัญชีได้ในขณะนี้');
        }
      } else if (text === '/clear' || text === 'ล้างข้อมูล') {
        const userRole = window.bppSession?.role || 'admin';
        if (userRole !== 'admin') {
          appendMsg('<b>สิทธิ์ไม่เพียงพอ!</b> การล้างข้อมูลทั้งหมดจำกัดเฉพาะสิทธิ์ <b>Admin</b> เท่านั้น<br>หากต้องการลบหรือแก้ไขบางรายการ กรุณากดเมนู <code>/list</code> เพื่อส่งคำขอแจ้ง Admin');
          return;
        }
        try {
          await fetch('/api/chat/clear', {
            method: 'DELETE',
            headers: {
              'X-User': (window.bppSession && window.bppSession.username) || (window.bppSession && window.bppSession.user) || 'admin',
              'X-Role': 'admin'
            }
          });
          appendMsg('<b>ล้างข้อมูลเหตุการณ์เรียบร้อยแล้ว!</b> แผนที่และดัชนีความเสี่ยงได้รับการรีเซ็ตแล้ว');
          if (window.__refreshAnalyticsData) window.__refreshAnalyticsData();
        } catch (e) {
          appendMsg('ไม่สามารถล้างข้อมูลได้');
        }
      } else if (text === '/persons' || text === 'รายการบุคคล' || text === 'ประวัติบุคคล') {
        try {
          const res = await fetch('/api/nas-bot/persons');
          const data = await res.json();
          const rawPersons = data.persons || [];
          const persons = rawPersons.filter(p => p.suspect_name && p.suspect_name !== 'ไม่ระบุชื่อ' && !String(p.suspect_name).startsWith('สายเบอร์') && !String(p.suspect_name).startsWith('สายส่ง'));
          if (!persons.length) {
            appendMsg('<b>ยังไม่มีประวัติบุคคลในระบบ NAS</b>');
          } else {
            let html = `<div style="font-weight:600;color:#34e2a8;margin-bottom:8px;font-size:13px;"><b>รายชื่อบุคคลในฐานข้อมูล (${persons.length} คน):</b></div>`;
            persons.forEach((p, idx) => {
              const idStr = p.id_card ? ` | <code style="color:#c084fc;">${p.id_card}</code>` : '';
              const phoneStr = (p.phones && p.phones.length) ? ` | <span style="color:#38bdf8;">${p.phones.join(', ')}</span>` : (p.phone_number ? ` | <span style="color:#38bdf8;">${p.phone_number}</span>` : '');
              const dossierId = p.dossier_id || (p.sources && p.sources[0]?.case_id) || '';
              
              html += `<div style="margin-top:6px;padding:8px 10px;background:rgba(18,14,38,0.9);border-radius:8px;border:1px solid rgba(52,226,168,0.3);font-size:12px;">`;
              html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">`;
              html += `<div><b>${idx+1}. ${p.suspect_name}</b>${idStr}${phoneStr}</div>`;
              html += `<div style="display:flex;gap:4px;flex-shrink:0;">`;
              if (dossierId) {
                html += `<button type="button" onclick="if(window.openDossierDetail) window.openDossierDetail('${dossierId}')" style="background:rgba(56,189,248,0.2);border:1px solid rgba(56,189,248,0.5);color:#38bdf8;padding:2px 7px;border-radius:4px;font-size:11px;cursor:pointer;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:2px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>แฟ้ม</button>`;
              }
              html += `<button type="button" onclick="const inEl=document.getElementById('chatInput');if(inEl){inEl.value='/search ${p.suspect_name}';inEl.form?.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}" style="background:rgba(192,132,252,0.2);border:1px solid rgba(192,132,252,0.5);color:#c084fc;padding:2px 7px;border-radius:4px;font-size:11px;cursor:pointer;">ค้นหา</button>`;
              html += `</div></div>`;
              html += `<div style="color:#94a3b8;font-size:11.5px;margin-top:3px;">${p.address || 'ไม่ระบุที่อยู่'}</div>`;
              html += `</div>`;
            });
            html += `<div style="font-size:11px;color:#9aa0bd;margin-top:8px;">พิมพ์ <code>/search &lt;ชื่อหรือเลขบัตร&gt;</code> เพื่อดูประวัติเต็ม พร้อมรูป ทร.14 พัสดุ Flash และแผนที่</div>`;
            appendMsg(html);
          }
        } catch (e) {
          appendMsg('ไม่สามารถดึงรายชื่อบุคคลได้');
        }
      } else if (text === '/graph' || text === '/i2' || text === '/case-graph' || text === 'ผังความสัมพันธ์' || text === 'ผังความสัมพันธ์แฟ้มคดี' || text === 'ผังเครือข่าย i2' || text === 'ผัง i2') {
        if (window.openI2Graph) {
          window.openI2Graph();
          appendMsg('<b>เปิดผังความสัมพันธ์แฟ้มคดี (Dossier Link Analysis) เรียบร้อยแล้ว</b>');
        } else {
          appendMsg('กำลังโหลดมอดูลผังความสัมพันธ์ กรุณาลองใหม่อีกครั้ง');
        }
      } else if (text === '/list' || text === 'รายการเหตุการณ์') {
        try {
          const username = window.bppSession?.user || 'admin';
          const userRole = window.bppSession?.role || 'admin';

          const res = await fetch('/api/chat/events', {
            headers: {
              'X-User': username,
              'X-Role': userRole
            }
          });
          const data = await res.json();
          const events = data.events || [];
          window.__currentEvents = events;
          const isAdmin = userRole === 'admin';

          if (!events.length) {
            appendMsg(`
              <div style="display:flex;align-items:center;gap:6px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fb5b78" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <b>ยังไม่มีข้อมูลเหตุการณ์ในระบบ</b>
              </div>
            `);
          } else {
            let html = `
              <div class="chat-events-list-container">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
                  <div style="display:flex;align-items:center;gap:6px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <b>รายการเหตุการณ์ทั้งหมด (<span class="chat-events-count-badge">${events.length}</span> รายการ):</b>
                  </div>
                  ${isAdmin ? `
                    <button type="button" class="btn-clean-empty-chat-events" style="background:rgba(234,179,8,0.15);border:1px solid rgba(234,179,8,0.4);color:#fde047;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:4px;" title="ล้างรายการว่างเปล่าหรือข้อความทดสอบที่ไม่มีข้อมูล">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 5-5"/><path d="M9 15l4-4"/><path d="M11 6l2-2a2 2 0 0 1 2.83 0l3.34 3.34a2 2 0 0 1 0 2.83l-2 2"/><path d="m14 10 4 4"/><path d="m17 7 3 3"/></svg> ล้างรายการว่าง
                    </button>
                  ` : ''}
                </div>

                <!-- Category Filters -->
                <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:8px;" class="chat-events-filters">
                  <button type="button" class="chat-event-filter-pill active" data-cat="all" style="background:rgba(168,85,247,0.3);border:1px solid #a855f7;color:#fff;padding:2px 8px;border-radius:12px;font-size:10.5px;cursor:pointer;font-weight:600;">ทั้งหมด (${events.length})</button>
                  <button type="button" class="chat-event-filter-pill" data-cat="drug" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:#cbd5e1;padding:2px 8px;border-radius:12px;font-size:10.5px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12a5 5 0 0 1 10 0v4H7v-4z"/><path d="M5 20h14a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1z"/><line x1="12" y1="2" x2="12" y2="4"/></svg> ยาเสพติด</button>
                  <button type="button" class="chat-event-filter-pill" data-cat="weapon" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:#cbd5e1;padding:2px 8px;border-radius:12px;font-size:10.5px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/></svg> อาวุธ</button>
                  <button type="button" class="chat-event-filter-pill" data-cat="flash_parcel" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:#cbd5e1;padding:2px 8px;border-radius:12px;font-size:10.5px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg> พัสดุ Flash</button>
                  <button type="button" class="chat-event-filter-pill" data-cat="alien" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:#cbd5e1;padding:2px 8px;border-radius:12px;font-size:10.5px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ต่างด้าว</button>
                  <button type="button" class="chat-event-filter-pill" data-cat="drop_point" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:#cbd5e1;padding:2px 8px;border-radius:12px;font-size:10.5px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg> จุดวางงาน</button>
                </div>

                <div class="chat-events-items-wrapper" style="display:flex;flex-direction:column;gap:6px;">
            `;

            const typeLabels = {
              drug: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M7 12a5 5 0 0 1 10 0v4H7v-4z"/><path d="M5 20h14a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1z"/><line x1="12" y1="2" x2="12" y2="4"/></svg>ยาเสพติด',
              weapon: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/></svg>อาวุธ',
              alien: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>ต่างด้าว',
              flash_parcel: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>พัสดุ Flash',
              lpr_hit: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>LPR',
              suspect: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>บุคคลเป้าหมาย',
              general: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>ทั่วไป'
            };

            events.forEach((ev, i) => {
              const evId = ev.id || ev.event_id || '';
              const loc = ev.location_name || ev.arrest_location || (ev.subdistrict ? `ต.${ev.subdistrict} อ.${ev.district||''} จ.${ev.province||''}` : 'ไม่ระบุพื้นที่');
              const suspectName = ev.first_name ? `${ev.first_name} ${ev.last_name||''}`.trim() : '';
              const suspectDossier = suspectName ? suspectName.replace(/\s+/g, '_') : '';
              const tKey = ev.is_drop_point ? 'drop_point' : (ev.incident_type || 'general');
              const tBadge = ev.is_drop_point ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>จุดวางงาน' : (typeLabels[ev.incident_type] || typeLabels.general);

              let evidenceBrief = [];
              if (ev.drug_quantity) evidenceBrief.push(`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg> ยาบ้า ${Number(ev.drug_quantity).toLocaleString()} เม็ด`);
              if (ev.ice_kg) evidenceBrief.push(`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/></svg> ไอซ์ ${ev.ice_kg} กก.`);
              if (ev.weapon_quantity) evidenceBrief.push(`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg> อาวุธ ${ev.weapon_quantity} ชิ้น`);
              if (ev.alien_count) evidenceBrief.push(`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> ต่างด้าว ${ev.alien_count} คน`);
              if (ev.parcels && ev.parcels.length > 0) evidenceBrief.push(`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg> พัสดุ ${ev.parcels.length} ชิ้น`);

              html += `
                <div class="chat-event-card-item" data-event-cat="${tKey}" style="padding:8px 10px;background:rgba(26,20,50,0.9);border-radius:8px;border:1px solid rgba(168,85,247,0.3);font-size:12px;display:flex;flex-direction:column;gap:4px;">
                  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
                    <div>
                      <span style="background:rgba(168,85,247,0.25);border:1px solid rgba(168,85,247,0.4);color:#d8b4fe;padding:1px 6px;border-radius:4px;font-size:10.5px;font-weight:700;display:inline-flex;align-items:center;">#${i+1} ${tBadge}</span>
                      <b style="color:#f8fafc;margin-left:4px;">${loc}</b>
                    </div>
                    <span style="color:#9aa0bd;font-size:10.5px;white-space:nowrap;">${(ev.created_at||'').slice(0,16).replace('T', ' ')}</span>
                  </div>

                  ${suspectName ? `<div style="color:#38bdf8;font-size:12px;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><b>ผู้ต้องหา:</b> ${suspectName} ${ev.phone ? `<code style="color:#fbbf24;margin-left:4px;">${ev.phone}</code>` : ''} ${ev.id_card ? `<code style="color:#34e2a8;margin-left:4px;">${ev.id_card}</code>` : ''}</div>` : ''}
                  ${evidenceBrief.length > 0 ? `<div style="color:#fde047;font-size:11.5px;font-weight:600;display:flex;align-items:center;flex-wrap:wrap;gap:6px;">${evidenceBrief.join(' <span style="color:#64748b;">|</span> ')}</div>` : ''}
                  ${ev.raw_text ? `<div style="color:#cbd5e1;font-size:11px;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:480px;">"${ev.raw_text}"</div>` : ''}

                  <!-- Action Buttons -->
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;border-top:1px dashed rgba(168,85,247,0.2);padding-top:4px;flex-wrap:wrap;gap:4px;">
                    <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
                      <button type="button" class="btn-view-chat-incident-modal" data-event-id="${evId}" style="background:#0284c7;color:#ffffff;border:none;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:3px;" title="เปิดดูรายละเอียดสำนวนและของกลางฉบับเต็ม">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> ดูรายละเอียด
                      </button>
                      ${ev.lat && ev.lon ? `
                        <a href="https://www.google.com/maps/search/?api=1&query=${ev.lat},${ev.lon}" target="_blank" style="background:rgba(52,226,168,0.2);border:1px solid rgba(52,226,168,0.4);color:#34e2a8;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:2px;">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg> แผนที่
                        </a>
                      ` : ''}
                      ${suspectDossier ? `
                        <button type="button" class="btn-open-dossier-from-chat" data-dossier="${encodeURIComponent(suspectDossier)}" style="background:rgba(192,132,252,0.2);border:1px solid rgba(192,132,252,0.4);color:#c084fc;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:2px;">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg> แฟ้มคดี
                        </button>
                      ` : ''}
                    </div>

                    ${isAdmin ? `
                      <button type="button" class="btn-delete-chat-event" data-event-id="${evId}" style="background:rgba(251,91,120,0.15);border:1px solid rgba(251,91,120,0.4);color:#fb5b78;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:3px;" title="ลบรายการนี้ออกจากระบบ">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        ลบ
                      </button>
                    ` : ''}
                  </div>
                </div>
              `;
            });

            html += `
                </div>
              </div>
            `;
            appendMsg(html);
          }
        } catch (e) {
          appendMsg('ไม่สามารถดึงรายการได้');
        }
      } else if (text === '/requests' || text === 'คำขอแก้ไข') {
        window.__adminReviewRequests();
      } else if (text.startsWith('/search') || text.startsWith('ค้นหา ')) {
        const query = text.replace(/^\/(?:search|ค้นหา)\s*/i, '').replace(/^ค้นหา\s+/i, '').trim();
        if (!query) {
          appendMsg('<b>กรุณาระบุคำค้นหา</b> เช่น <code>/search พัฒนา</code>, <code>/search 1319800240239</code>, หรือ <code>/search 0887158552</code>');
          return;
        }
        try {
          // 1. Search NAS Storage (Cases + Dossiers + Person Profiles)
          const nasRes = await fetch(`/api/nas-bot/search?q=${encodeURIComponent(query)}`).catch(() => null);
          const nasData = nasRes ? await nasRes.json() : { results: [], dossiers: [], persons: [] };
          const matchedDossiers = nasData.dossiers || [];
          const matchedPersons = (nasData.persons || []).filter(p => p.suspect_name && p.suspect_name !== 'ไม่ระบุชื่อ' && !String(p.suspect_name).startsWith('สายเบอร์'));
          const nasResults = nasData.results || [];

          // 2. Search Chat Event Records
          const userRole = window.bppSession?.role || 'admin';
          const username = window.bppSession?.user || 'admin';
          const chatRes = await fetch('/api/chat/events', {
            headers: { 'X-User': username, 'X-Role': userRole }
          }).catch(() => null);
          const chatData = chatRes ? await chatRes.json() : { events: [] };
          const allEvents = chatData.events || [];

          const qLower = query.toLowerCase().trim();
          const qClean = stripThaiPrefix(query).toLowerCase().trim();

          const matchedEvents = allEvents.filter(e => {
            const suspectsStr = (e.suspects || []).map(s => `${s.full_name||''} ${s.first_name||''} ${s.last_name||''} ${s.nickname||''} ${s.id_card||''}`).join(' ');
            const platesStr = Array.isArray(e.plates) ? e.plates.join(' ') : (e.plates || '');
            const str = (
              JSON.stringify(e) + ' ' +
              (e.raw_text || '') + ' ' +
              (e.first_name || '') + ' ' +
              (e.last_name || '') + ' ' +
              (e.nickname || '') + ' ' +
              (e.phone || '') + ' ' +
              platesStr + ' ' +
              suspectsStr
            ).toLowerCase();
            return str.includes(qLower) || (qClean && str.includes(qClean));
          });

          // 3. Deduplicate NAS cases
          const uniqueNasMap = new Map();
          nasResults.forEach(r => {
            const key = (r.notes || '').trim();
            if (key && !uniqueNasMap.has(key)) {
              uniqueNasMap.set(key, r);
            }
          });
          const deduplicatedNasResults = Array.from(uniqueNasMap.values());

          const filteredNasResults = deduplicatedNasResults.filter(nas => {
            const nasNote = (nas.notes || '').toLowerCase();
            return !matchedEvents.some(ev => (ev.raw_text || '').toLowerCase().includes(nasNote) || nasNote.includes((ev.raw_text || '').toLowerCase()));
          });

          const totalCount = matchedDossiers.length + matchedPersons.length + matchedEvents.length + filteredNasResults.length;

          if (totalCount === 0) {
            appendMsg(`
              <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:rgba(251,91,120,0.1);border:1px solid rgba(251,91,120,0.3);border-radius:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fb5b78" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <span style="font-size:12.5px;"><b>ไม่พบข้อมูลคดีหรือประวัติบุคคลที่ตรงกับคำค้นหา:</b> "${query}"</span>
              </div>
            `);
          } else {
            let html = `
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <b style="font-size:13px;color:#34e2a8;">ผลการค้นหาข้อมูลอัจฉริยะสำหรับ "${query}" (พบ ${totalCount} รายการ):</b>
              </div>
            `;

            // 1. Render Matched Dossier Vault Cards (Authoritative Person Dossiers)
            if (matchedDossiers.length) {
              matchedDossiers.forEach(d => {
                const sName = d.suspect_name || 'ไม่ระบุชื่อ';
                const sId = d.id_card || 'ไม่ระบุ';
                const sRole = d.role_tag || 'ผู้ต้องหา';
                const sPhone = (d.phones && d.phones.length) ? d.phones.join(', ') : (d.phone_number || 'ไม่ระบุ');
                const sAddr = d.address || 'ไม่ระบุที่อยู่';
                const parcels = d.parcels || [];
                const pFiles = d.personal_files || [];
                const imgFile = pFiles.find(f => /\.(jpg|jpeg|png|webp)$/i.test(f.filename || ''));

                html += `<div style="margin-bottom:10px;padding:12px;background:rgba(20,15,42,0.95);border-radius:10px;border:1px solid rgba(192,132,252,0.5);font-size:12.5px;">`;
                html += `<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(192,132,252,0.2);padding-bottom:6px;margin-bottom:8px;">`;
                html += `<div><span style="font-weight:700;color:#c084fc;font-size:14px;">แฟ้มประวัติบุคคล: ${sName}</span> <span style="background:rgba(192,132,252,0.2);color:#c084fc;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:4px;">${sRole}</span></div>`;
                html += `<span style="font-size:11px;color:#9aa0bd;">${d.dossier_id}</span>`;
                html += `</div>`;

                // Photo Preview if available
                if (imgFile) {
                  const imgUrl = `/api/nas-bot/dossiers/${encodeURIComponent(d.dossier_id)}/download/${encodeURIComponent(imgFile.filename)}`;
                  html += `<div style="margin-bottom:8px;text-align:center;">`;
                  html += `<img src="${imgUrl}" style="max-width:100%;max-height:220px;border-radius:8px;border:1px solid rgba(192,132,252,0.4);object-fit:contain;cursor:pointer;" onclick="if(window.openFilePreview) window.openFilePreview('${imgUrl}', '${String(imgFile.filename).replace(/'/g, "\\'")}', 'image', { dossier_id: '${String(d.dossier_id).replace(/'/g, "\\'")}' });" alt="ทร.14 / รูปบุคคล" title="คลิกเพื่อดูภาพขนาดเต็ม">`;
                  html += `</div>`;
                }

                html += `<div style="line-height:1.6;">`;
                html += `<b>เลขบัตรประชาชน:</b> <code style="color:#c084fc;font-size:13px;">${sId}</code> | <b>เบอร์โทร:</b> <span style="color:#38bdf8;">${sPhone}</span><br>`;
                html += `<b>ที่อยู่:</b> <span style="color:#34e2a8;">${sAddr}</span>`;
                html += `</div>`;

                // Warrant info (if available)
                if (d.warrant_info) {
                  const w = d.warrant_info;
                  html += `<div style="margin-top:8px;padding:6px 8px;background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.35);border-radius:6px;font-size:11.5px;line-height:1.5;">`;
                  html += `<div style="display:flex;justify-content:space-between;align-items:center;">`;
                  html += `<b style="color:#facc15;">หมายจับเลขที่: ${w.warrant_no || '-'}</b>`;
                  html += `<span style="background:rgba(234,179,8,0.25);color:#facc15;padding:1px 5px;border-radius:4px;font-size:10.5px;font-weight:700;">${w.urgency_level || 'ปกติ'}</span>`;
                  html += `</div>`;
                  html += `<b>ศาล:</b> ${w.court || '-'} | <b>สภ.:</b> ${w.station_name || '-'}<br>`;
                  html += `<b>ข้อหา:</b> <span style="color:#fb7185;">${w.charge || '-'}</span><br>`;
                  html += `⏳ <b>นับถอยหลังอายุความ:</b> <b style="color:#fbbf24;">${w.countdown_text || (w.remaining_days ? w.remaining_days + ' วัน' : '-')}</b> (สิ้นสุด: ${w.expiration_date || '-'})`;
                  html += `</div>`;
                }

                // Flash Express Parcels
                if (parcels.length) {
                  html += `<div style="margin-top:8px;padding:6px 8px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.3);border-radius:6px;font-size:11.5px;">`;
                  html += `<b style="color:#38bdf8;">ประวัติการรับพัสดุ Flash Express (${parcels.length} รายการ):</b>`;
                  parcels.slice(0, 5).forEach(p => {
                    html += `<div style="margin-top:3px;border-top:1px dashed rgba(56,189,248,0.2);padding-top:2px;">`;
                    html += `• <b>PNO:</b> <code style="color:#38bdf8;">${p.pno || '-'}</code> (${p.time || '-'})<br>`;
                    if (p.receiver_address) html += `  ส่งถึง: ${p.receiver_address}<br>`;
                    if (p.gps_url) html += `  <a href="${p.gps_url}" target="_blank" style="color:#34e2a8;text-decoration:underline;">เปิดพิกัด Google Maps (${p.lat||''}, ${p.lon||''})</a>`;
                    html += `</div>`;
                  });
                  html += `</div>`;
                }

                // Action Buttons
                html += `<div style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;border-top:1px dashed rgba(192,132,252,0.2);padding-top:6px;">`;
                html += `<span style="font-size:11px;color:#9aa0bd;">เอกสารในแฟ้ม: ${pFiles.length} รายการ</span>`;
                html += `<div style="display:flex;gap:4px;">`;
                html += `<button type="button" onclick="if(window.openDossierDetail) window.openDossierDetail('${String(d.dossier_id).replace(/'/g, "\\'")}')" style="background:rgba(56,189,248,0.2);border:1px solid rgba(56,189,248,0.5);color:#38bdf8;padding:3px 8px;border-radius:4px;font-size:11.5px;font-weight:600;cursor:pointer;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:2px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>เปิดแฟ้ม Dossier</button>`;
                html += `<button type="button" onclick="if(window.openI2Graph) { window.openI2Graph(); setTimeout(()=>{ const sIn=document.getElementById('i2SearchInput'); if(sIn){sIn.value='${String(sName).replace(/'/g, "\\'")}'; sIn.dispatchEvent(new Event('input',{bubbles:true})); sIn.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));} }, 300); }" style="background:rgba(192,132,252,0.2);border:1px solid rgba(192,132,252,0.5);color:#c084fc;padding:3px 8px;border-radius:4px;font-size:11.5px;font-weight:600;cursor:pointer;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:2px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>ดูในผัง i2</button>`;
                html += `</div></div>`;

                html += `</div>`;
              });
            }

            // 2. Render Additional Person Profiles (if not already rendered in dossiers)
            if (matchedPersons.length) {
              const unrenderedPersons = matchedPersons.filter(p => !matchedDossiers.some(d => d.suspect_name === p.suspect_name || (d.id_card && d.id_card === p.id_card)));
              if (unrenderedPersons.length) {
                unrenderedPersons.forEach(p => {
                  const targetDossier = p.dossier_id || p.suspect_name || '';
                  html += `<div style="margin-bottom:10px;padding:12px;background:rgba(20,15,42,0.95);border-radius:10px;border:1px solid rgba(52,226,168,0.5);font-size:12.5px;">`;
                  html += `<div style="font-weight:700;color:#34e2a8;font-size:14px;margin-bottom:6px;">ข้อมูลบุคคล: ${p.suspect_name}</div>`;
                  html += `<div style="line-height:1.6;">`;
                  html += `<b>เลขบัตรประชาชน:</b> <code>${p.id_card || 'ไม่ระบุ'}</code> | <b>เบอร์:</b> ${p.phone_number || '-'}<br>`;
                  html += `<b>ที่อยู่:</b> <span style="color:#cbd5e1;">${p.address || 'ไม่ระบุ'}</span>`;
                  html += `</div>`;
                  html += `<div style="margin-top:8px;display:flex;align-items:center;justify-content:flex-end;gap:4px;border-top:1px dashed rgba(52,226,168,0.2);padding-top:6px;">`;
                  html += `<button type="button" onclick="if(window.openDossierDetail) window.openDossierDetail('${String(targetDossier).replace(/'/g, "\\'")}')" style="background:rgba(52,226,168,0.2);border:1px solid rgba(52,226,168,0.5);color:#34e2a8;padding:3px 8px;border-radius:4px;font-size:11.5px;font-weight:600;cursor:pointer;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:2px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>เปิดแฟ้ม Dossier</button>`;
                  html += `<button type="button" onclick="if(window.openI2Graph) { window.openI2Graph(); setTimeout(()=>{ const sIn=document.getElementById('i2SearchInput'); if(sIn){sIn.value='${String(p.suspect_name).replace(/'/g, "\\'")}'; sIn.dispatchEvent(new Event('input',{bubbles:true})); sIn.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));} }, 300); }" style="background:rgba(192,132,252,0.2);border:1px solid rgba(192,132,252,0.5);color:#c084fc;padding:3px 8px;border-radius:4px;font-size:11.5px;font-weight:600;cursor:pointer;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:2px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>ดูในผัง i2</button>`;
                  html += `</div></div>`;
                });
              }
            }

            // 3. Render Matched Intelligence Events
            if (matchedEvents.length) {
              matchedEvents.forEach(ev => {
                const loc = ev.location_name || ev.arrest_location || 'ไม่ระบุพื้นที่';
                const targetZone = ev.district || ev.location_name || '';

                const matchedNas = deduplicatedNasResults.find(nas => {
                  const nNotes = (nas.notes || '').toLowerCase();
                  const rText = (ev.raw_text || '').toLowerCase();
                  return (nNotes && rText && (nNotes.includes(rText) || rText.includes(nNotes))) ||
                         (nas.case_id && ev.case_id && nas.case_id === ev.case_id);
                });
                const caseId = matchedNas ? matchedNas.case_id : (ev.case_id || '');
                const nasTag = caseId ? ` · <span style="color:#34e2a8;font-weight:600;">[NAS: ${caseId}]</span>` : '';

                // Extract or assemble structured fields
                let suspectName = '';
                if (ev.first_name) {
                  suspectName = `${ev.first_name} ${ev.last_name || ''}`.trim();
                }
                let rawText = ev.raw_text || '';

                // Thai Police Report field extractors (1-10 numbering grammar)
                if (!suspectName) {
                  const mSus = rawText.match(/(?:๕|5)\.\s*(?:จับกุมผู้ต้องหา|ผู้ต้องหา|กล่าวโทษ)\s*:?\s*([^0-9\n]{2,60}?)(?=\s+(?:อายุ|อยู่บ้าน|๖\.|6\.|\n|$))/);
                  if (mSus) suspectName = mSus[1].replace(/^(นาย|นางสาว|น\.ส\.|นาง)\s*/, '').trim();
                }

                let nickname = ev.nickname || '';
                if (!nickname) {
                  const mNick = rawText.match(/(?:หรือ|ชื่อเล่น)\s*([^\s\(\)\d]{2,20})/);
                  if (mNick) nickname = mNick[1].trim();
                }

                let age = ev.suspects?.[0]?.age || '';
                if (!age) {
                  const mAge = rawText.match(/อายุ\s*([0-9๑-๙]+)\s*ปี/);
                  if (mAge) age = mAge[1];
                }

                let idCard = ev.id_card || ev.suspects?.[0]?.id_card || '';
                if (!idCard) {
                  const mId = rawText.match(/(?:เลขประจำตัวประชาชน|เลขบัตร|บัตรประชาชน)\s*:?\s*([0-9๑-๙\-\s]{13,20})/);
                  if (mId) idCard = mId[1].replace(/[^0-9]/g, '');
                }

                let homeAddr = ev.home_address || '';
                if (!homeAddr) {
                  const mAddr = rawText.match(/(?:อยู่บ้านเลขที่|ที่อยู่|บ้านเลขที่)\s*([^\n]+?)(?=\s+(?:๖\.|6\.|พร้อม|สถานที่|โดย|ข้อหา|$))/);
                  if (mAddr) homeAddr = mAddr[1].trim();
                }

                let arrestLoc = ev.arrest_location || ev.location_name || '';
                if (!arrestLoc || arrestLoc === 'ไม่ระบุพื้นที่') {
                  const mLoc = rawText.match(/(?:๘|8|๖|6)\.\s*(?:สถานที่เกิดเหตุ(?:\/จับกุม)?|สถานที่จับกุม)\s*:?\s*([^\n]+?)(?=\s+(?:๙\.|9\.|๗\.|7\.|นำของกลาง|โดย|ต่อเนื่อง|$))/);
                  if (mLoc) arrestLoc = mLoc[1].trim();
                }

                let evidenceStr = '';
                if (ev.evidence_items && ev.evidence_items.length) {
                  evidenceStr = ev.evidence_items.join(', ');
                } else if (ev.drug_quantity) {
                  evidenceStr = `ยาบ้า: ${Number(ev.drug_quantity).toLocaleString()} เม็ด`;
                }
                if (!evidenceStr) {
                  const mEvi = rawText.match(/(?:๖|6|๗|7)\.\s*(?:พร้อม(?:ด้วย)?ของกลาง(?:ดังนี้)?|ของกลาง)\s*:?\s*([^\n]+?)(?=\s+(?:๗\.|7\.|๘\.|8\.|โดยกล่าวหา|ข้อกล่าวหา|$))/);
                  if (mEvi) evidenceStr = mEvi[1].trim();
                }

                let chargesStr = ev.charges || '';
                if (!chargesStr) {
                  const mChg = rawText.match(/(?:๗|7|๘|8)\.\s*(?:ข้อกล่าวหาว่า|โดยกล่าวหาว่า)\s*:?\s*[“"']?([^"”\n]+?)[”"']?(?=\s+(?:๘\.|8\.|๙\.|9\.|นำตัว|สถานที่|$))/);
                  if (mChg) chargesStr = mChg[1].trim();
                }

                const displaySuspect = suspectName 
                  ? `${suspectName}${nickname ? ` (${nickname})` : ''}${age ? ` อายุ ${age} ปี` : ''}` 
                  : '';

                html += `<div style="margin-top:8px;padding:12px;background:rgba(26,20,50,0.95);border-radius:10px;border:1px solid rgba(168,85,247,0.4);font-size:12.5px;line-height:1.6;">`;

                // Header
                html += `<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(168,85,247,0.25);padding-bottom:6px;margin-bottom:8px;">`;
                html += `<div><span style="font-weight:700;color:#c084fc;font-size:13.5px;">บันทึกเหตุการณ์คดี: ${loc}</span> <span style="background:rgba(168,85,247,0.2);color:#c084fc;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:4px;">${ev.incident_type || 'คดียาเสพติด'}</span>${nasTag}</div>`;
                html += `<span style="font-size:11px;color:#9aa0bd;">${(ev.created_at||'').slice(0,16).replace('T', ' ')}</span>`;
                html += `</div>`;

                // Photo Preview if available from matched NAS
                if (matchedNas && matchedNas.has_photo) {
                  const photoUrl = `/api/nas-bot/cases/${matchedNas.case_id}/photo`;
                  html += `<div style="margin-bottom:8px;text-align:center;">`;
                  html += `<img src="${photoUrl}" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid rgba(52,226,168,0.4);object-fit:contain;cursor:pointer;" onclick="if(window.openFilePreview) window.openFilePreview('${photoUrl}', '${matchedNas.case_id}.jpg', 'image', { case_id: '${matchedNas.case_id}' });" alt="ภาพของกลาง / ที่เกิดเหตุ" title="คลิกเพื่อดูภาพขนาดเต็ม">`;
                  html += `</div>`;
                }

                // Structured Key Points
                html += `<div style="background:rgba(0,0,0,0.25);border-radius:8px;padding:8px 10px;margin-bottom:8px;">`;
                if (displaySuspect) {
                  html += `<div><b>ผู้ต้องหา/บุคคล:</b> <span style="color:#facc15;font-weight:700;">${displaySuspect}</span></div>`;
                }
                if (idCard || ev.phone || ev.license_plate || (ev.plates && ev.plates.length)) {
                  const idStr = idCard ? `<b>เลขบัตร:</b> <code style="color:#c084fc;">${idCard}</code> ` : '';
                  const phStr = ev.phone ? `| <b>เบอร์:</b> <span style="color:#38bdf8;">${ev.phone}</span> ` : '';
                  const plList = ev.plates && ev.plates.length ? ev.plates : (ev.license_plate ? [ev.license_plate] : []);
                  const plStr = plList.length ? `| <b>ทะเบียน:</b> <code style="color:#34e2a8;">${plList.join(', ')}</code>` : '';
                  html += `<div style="margin-top:2px;">${idStr}${phStr}${plStr}</div>`;
                }
                if (homeAddr) {
                  html += `<div style="margin-top:2px;"><b>ที่อยู่:</b> <span style="color:#cbd5e1;">${homeAddr}</span></div>`;
                }
                if (arrestLoc) {
                  html += `<div style="margin-top:2px;"><b>สถานที่เกิดเหตุ/จับกุม:</b> <span style="color:#cbd5e1;">${arrestLoc}</span></div>`;
                }
                if (evidenceStr) {
                  html += `<div style="margin-top:2px;"><b>ของกลาง:</b> <span style="color:#34e2a8;">${evidenceStr}</span></div>`;
                }
                if (chargesStr) {
                  html += `<div style="margin-top:2px;"><b>ข้อกล่าวหา:</b> <span style="color:#fb7185;">${chargesStr}</span></div>`;
                }
                html += `</div>`;

                // Collapsible Full Raw Report Text
                if (rawText) {
                  html += `<details style="margin-top:6px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:4px 8px;">`;
                  html += `<summary style="cursor:pointer;color:#38bdf8;font-size:11.5px;font-weight:600;display:flex;align-items:center;gap:4px;">`;
                  html += `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
                  html += `ดูข้อความรายงานฉบับเต็ม`;
                  html += `</summary>`;
                  html += `<div style="margin-top:6px;padding:8px;background:rgba(0,0,0,0.4);border-radius:5px;font-size:11.5px;color:#cbd5e1;line-height:1.5;max-height:180px;overflow-y:auto;white-space:pre-wrap;">${rawText}</div>`;
                  html += `</details>`;
                }

                // Action Buttons Bar
                const cleanPersonName = suspectName ? suspectName.replace(/^(นาย|นางสาว|น\.ส\.|นาง)\s*/, '').trim() : '';
                html += `<div style="margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px;border-top:1px dashed rgba(168,85,247,0.25);padding-top:8px;">`;
                html += `<span style="color:#9aa0bd;font-size:11px;">เจ้าหน้าที่: ${accLabelHtml(ev.created_by || 'admin')}</span>`;
                html += `<div style="display:flex;flex-wrap:wrap;gap:4px;">`;
                if (cleanPersonName) {
                  html += `<button type="button" onclick="if(window.openDossierDetail) window.openDossierDetail('${String(cleanPersonName).replace(/'/g, "\\'")}')" style="background:rgba(56,189,248,0.2);border:1px solid rgba(56,189,248,0.5);color:#38bdf8;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:2px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>เปิดแฟ้ม Dossier</button>`;
                  html += `<button type="button" onclick="if(window.openI2Graph) { window.openI2Graph(); setTimeout(()=>{ const sIn=document.getElementById('i2SearchInput'); if(sIn){sIn.value='${String(cleanPersonName).replace(/'/g, "\\'")}'; sIn.dispatchEvent(new Event('input',{bubbles:true})); sIn.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));} }, 300); }" style="background:rgba(192,132,252,0.2);border:1px solid rgba(192,132,252,0.5);color:#c084fc;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:2px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>ดูในผัง i2</button>`;
                }
                if (caseId) {
                  html += `<button type="button" class="btn-view-nas-files" data-case-id="${caseId}" style="background:rgba(52,226,168,0.2);border:1px solid rgba(52,226,168,0.5);color:#34e2a8;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:3px;">ดูไฟล์แนบคดี</button>`;
                }
                html += `<button type="button" class="btn-view-zone-details" data-zone="${targetZone}" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#cbd5e1;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:3px;">ดูสถิติพื้นที่</button>`;
                html += `</div></div>`;

                html += `</div>`;
              });
            }

            // 4. Render remaining standalone NAS Cases (if any)
            if (filteredNasResults.length) {
              html += `<div style="margin-top:8px;font-size:11.5px;color:#34e2a8;font-weight:600;">สำนวนคดีในระบบ NAS (${filteredNasResults.length} รายการ):</div>`;
              filteredNasResults.forEach(r => {
                const sName = r.suspect_name ? ` | <b>${r.suspect_name}</b>` : '';
                const sId = r.id_card ? ` | <code>${r.id_card}</code>` : '';
                const cleanSus = (r.suspect_name || '').replace(/^(นาย|นางสาว|น\.ส\.|นาง)\s*/, '').trim();

                html += `<div class="nas-case-card-item" style="margin-top:6px;padding:12px;background:rgba(18,14,38,0.95);border-radius:8px;border:1px solid rgba(52,226,168,0.35);font-size:12px;">`;
                if (r.has_photo) {
                  html += `<div style="text-align:center;margin-bottom:8px;">`;
                  html += `<img src="/api/nas-bot/cases/${r.case_id}/photo" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid rgba(52,226,168,0.4);object-fit:contain;cursor:pointer;" onclick="if(window.openFilePreview) window.openFilePreview('/api/nas-bot/cases/${r.case_id}/photo', '${r.case_id}.jpg', 'image', { case_id: '${r.case_id}' });" title="คลิกเพื่อดูภาพขนาดเต็ม">`;
                  html += `</div>`;
                }
                html += `<div style="line-height:1.6;">• <b>${r.case_id}</b> (เจ้าหน้าที่: <b>${r.officer_username}</b>)${sName}${sId}</div>`;

                const noteText = r.notes || '';
                if (noteText.length > 150) {
                  html += `<details style="margin-top:6px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:4px 8px;">`;
                  html += `<summary style="cursor:pointer;color:#38bdf8;font-size:11.5px;font-weight:600;">ดูข้อความรายงานฉบับเต็ม</summary>`;
                  html += `<div style="margin-top:6px;padding:8px;background:rgba(0,0,0,0.4);border-radius:5px;font-size:11.5px;color:#cbd5e1;line-height:1.5;max-height:180px;overflow-y:auto;white-space:pre-wrap;">${noteText}</div>`;
                  html += `</details>`;
                } else if (noteText) {
                  html += `<i style="color:#cbd5e1;display:block;margin-top:4px;">"${noteText}"</i>`;
                }

                html += `<div style="margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:4px;border-top:1px dashed rgba(52,226,168,0.25);padding-top:8px;">`;
                if (cleanSus) {
                  html += `<button type="button" onclick="if(window.openDossierDetail) window.openDossierDetail('${String(cleanSus).replace(/'/g, "\\'")}')" style="background:rgba(56,189,248,0.2);border:1px solid rgba(56,189,248,0.5);color:#38bdf8;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:2px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>เปิดแฟ้ม Dossier</button>`;
                  html += `<button type="button" onclick="if(window.openI2Graph) { window.openI2Graph(); setTimeout(()=>{ const sIn=document.getElementById('i2SearchInput'); if(sIn){sIn.value='${String(cleanSus).replace(/'/g, "\\'")}'; sIn.dispatchEvent(new Event('input',{bubbles:true})); sIn.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));} }, 300); }" style="background:rgba(192,132,252,0.2);border:1px solid rgba(192,132,252,0.5);color:#c084fc;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:2px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>ดูในผัง i2</button>`;
                }
                html += `<button type="button" class="btn-view-nas-files" data-case-id="${r.case_id}" style="background:rgba(192,132,252,0.15);border:1px solid rgba(192,132,252,0.4);color:#c084fc;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>ดูไฟล์</button>`;
                html += `<button type="button" class="btn-delete-nas-case" data-case-id="${r.case_id}" style="background:rgba(251,91,120,0.15);border:1px solid rgba(251,91,120,0.4);color:#fb5b78;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>ลบคดี</button>`;
                html += `</div></div>`;
              });
            }

            appendMsg(html);
          }
        } catch (e) {
          appendMsg('การค้นหาขัดข้อง');
        }
      } else {
        // Direct report submission & AI Parsing
        try {
          const username = window.bppSession?.user || 'admin';
          const userRole = window.bppSession?.role || 'admin';

          const formData = new FormData();
          formData.append('notes', text);
          fetch('/api/nas-bot/upload', { method: 'POST', body: formData }).catch(() => {});

          const chatRes = await fetch('/api/chat/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User': username,
              'X-Role': userRole
            },
            body: JSON.stringify({ message: text })
          });
          const chatData = await chatRes.json();
          appendMsg(chatData.reply || 'บันทึกรายงานสำเร็จ!');

          if (chatData.event_id && window.__refreshAnalyticsData) {
            window.__refreshAnalyticsData();
          }
        } catch (e) {
          appendMsg('เกิดข้อผิดพลาดในการบันทึกรายงาน');
        }
      }
    }

    sendBtn.addEventListener('click', handleSend);
    inputEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleSend();
    });

    async function loadCasesDropdown() {
      const caseSelect = document.getElementById('chatCaseSelect');
      if (!caseSelect) return;
      try {
        const res = await fetch('/api/nas-bot/cases');
        if (!res.ok) return;
        const data = await res.json();
        const currentVal = caseSelect.value;
        let optionsHtml = '<option value="new">🆕 สร้างเคสใหม่</option>';
        if (data.cases && data.cases.length > 0) {
          data.cases.forEach(c => {
            const shortNotes = c.notes ? (c.notes.length > 18 ? c.notes.substring(0, 18) + '...' : c.notes) : 'ไม่มีคำอธิบาย';
            optionsHtml += `<option value="${c.case_id}">${c.case_id} (${shortNotes})</option>`;
          });
        }
        caseSelect.innerHTML = optionsHtml;
        if (currentVal && Array.from(caseSelect.options).some(o => o.value === currentVal)) {
          caseSelect.value = currentVal;
        }
      } catch (e) {
        console.error('[chat-widget] failed to load cases dropdown:', e);
      }
    }

    if (btnBotChat) {
      btnBotChat.addEventListener('click', () => {
        if (windowEl.classList.contains('open')) loadCasesDropdown();
      });
    }
    setTimeout(loadCasesDropdown, 12000);

    fileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      if (!fileInput.files.length) return;
      const file = fileInput.files[0];
      
      const caseSelect = document.getElementById('chatCaseSelect');
      const selectedCase = caseSelect ? caseSelect.value : 'new';
      const targetLabel = (selectedCase && selectedCase !== 'new') ? ` เพิ่มเข้าเคส: ${selectedCase}` : ' สร้างเคสใหม่';
      
      appendMsg(`กำลังอัปโหลดไฟล์: <b>${file.name}</b> (${targetLabel})...`, 'user');

      const formData = new FormData();
      formData.append('notes', `อัปโหลดไฟล์: ${file.name}`);
      formData.append('target_case_id', selectedCase);
      formData.append('files', file);

      try {
        const res = await fetch('/api/nas-bot/upload', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'X-User': window.bppSession?.user || 'admin'
          },
          body: formData
        });
        if (!res.ok) {
          const errText = await res.text();
          console.error(`[chat-widget] upload failed: HTTP ${res.status}`, errText);
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();

        let msgHtml = `<b>บันทึกไฟล์เข้า NAS เรียบร้อย!</b><br>เลขที่คดี: <code style="color:#c084fc;">${data.case_id}</code>`;

        const metaDetails = [];
        if (data.exif && (data.exif.make || data.exif.model)) {
          const deviceName = [data.exif.make, data.exif.model].filter(Boolean).join(' ');
          metaDetails.push(`<b>อุปกรณ์ถ่ายภาพ:</b> ${deviceName}`);
        }
        if (data.exif && data.exif.timestamp) {
          metaDetails.push(`<b>เวลาบันทึกภาพ (EXIF):</b> ${data.exif.timestamp}`);
        }
        if (data.location && data.location.lat && data.location.lon) {
          metaDetails.push(`<b>พิกัดถ่ายภาพ (GPS):</b> <code>${data.location.lat.toFixed(6)}, ${data.location.lon.toFixed(6)}</code>`);
        }

        if (metaDetails.length > 0) {
          msgHtml += `<div style="margin-top:6px;padding:6px 10px;background:rgba(56,189,248,0.12);border-left:3px solid #38bdf8;border-radius:4px;font-size:12px;color:#e2e8f0;line-height:1.6;">` + metaDetails.join('<br>') + `</div>`;
        }

        const validSuspects = (data.suspects || []).filter(o => o.suspect_name || o.id_card || o.address || o.age || o.phone_number || o.drug_quantity);
        if (validSuspects.length > 0) {
          let ocrHtml = `<div style="margin-top:6px;padding:6px 10px;background:rgba(124,58,237,0.15);border-left:3px solid #c084fc;border-radius:4px;"><b>ผลการอ่านเอกสาร (AI OCR): พบ ${validSuspects.length} คน</b><br>`;
          
          validSuspects.forEach((o, index) => {
            const ocrDetails = [];
            const userIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:2px;color:#c084fc;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
            const idIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:2px;color:#c084fc;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
            const ageIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:2px;color:#c084fc;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
            const homeIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:2px;color:#c084fc;"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
            const phoneIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:2px;color:#c084fc;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
            const drugIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:2px;color:#fb5b78;"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;
            
            if (o.suspect_name) ocrDetails.push(`${userIcon} ชื่อ-สกุล: <b>${o.suspect_name}</b>`);
            if (o.id_card) ocrDetails.push(`${idIcon} เลขบัตร: <code>${o.id_card}</code>`);
            if (o.age) ocrDetails.push(`${ageIcon} อายุ: ${o.age} ปี`);
            if (o.address) ocrDetails.push(`${homeIcon} ที่อยู่: ${o.address}`);
            if (o.phone_number) ocrDetails.push(`${phoneIcon} เบอร์โทร: ${o.phone_number}`);
            if (o.drug_quantity) ocrDetails.push(`${drugIcon} ของกลาง: ${o.drug_quantity} เม็ด`);
            
            if (ocrDetails.length > 0) {
              ocrHtml += `<div style="margin-top:8px; padding-bottom:8px; border-bottom: ${index < data.suspects.length - 1 ? '1px dashed rgba(192,132,252,0.5)' : 'none'};">${ocrDetails.join('<br>')}</div>`;
            }
          });
          
          if (data.metadata && data.metadata.behavior) {
            const infoIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:2px;color:#34e2a8;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
            ocrHtml += `<div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(192,132,252,0.3); font-size:11px;">`;
            ocrHtml += `<b>${infoIcon} พฤติการณ์การจับกุม:</b><br><i style="color:#cbd5e1;">${data.metadata.behavior}</i>`;
            ocrHtml += `</div>`;
          }
          
          ocrHtml += `</div>`;
          msgHtml += `<br>` + ocrHtml;
        }

        appendMsg(msgHtml);
        loadCasesDropdown();

        if (window.__refreshAnalyticsData) window.__refreshAnalyticsData();
      } catch (e) {
        console.error('[chat-widget] upload error:', e);
        const errDetail = e?.message ? ` (${e.message})` : '';
        appendMsg(`อัปโหลดไฟล์ไม่สำเร็จ${errDetail}`);
      }
    });

    bodyEl.addEventListener('click', async (e) => {
      const viewFilesBtn = e.target.closest('.btn-view-nas-files');
      if (viewFilesBtn) {
        const caseId = viewFilesBtn.dataset.caseId;
        if (!caseId) return;
        try {
          const res = await fetch(`/api/nas-bot/cases/${caseId}/files`);
          const data = await res.json();
          const filesMap = data.files || { Photos: [], Documents: [], Videos: [] };
          let html = `<div style="padding:8px 10px;background:rgba(20,15,42,0.95);border-radius:8px;border:1px solid rgba(192,132,252,0.4);font-size:12px;margin-top:6px;">`;
          html += `<b style="color:#c084fc;">ไฟล์แนบในสำนวนคดี ${caseId}:</b><br>`;

          let fileCount = 0;
          for (const [cat, list] of Object.entries(filesMap)) {
            if (list && list.length) {
              fileCount += list.length;
              const iconSvg = cat === 'Photos' 
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2" style="vertical-align:-2px;margin-right:3px;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
                : cat === 'Videos' 
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" style="vertical-align:-2px;margin-right:3px;"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`
                : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" style="vertical-align:-2px;margin-right:3px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
              
              html += `<div style="margin-top:5px;"><span style="color:#34e2a8;font-weight:600;">${iconSvg}${cat} (${list.length}):</span></div>`;
              list.forEach(f => {
                const sz = (f.size_bytes / 1024).toFixed(1) + ' KB';
                const fileUrl = `/api/nas-bot/cases/${caseId}/files/${cat}/${encodeURIComponent(f.filename)}`;
                const ext = f.filename.split('.').pop().toLowerCase();
                html += `<div style="margin-top:3px;display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.04);border-radius:5px;border:1px solid rgba(255,255,255,0.06);">`;
                html += `<span>• <b>${f.filename}</b> <span style="font-size:10.5px;color:#9aa0bd;">(${sz})</span></span>`;
                html += `<div style="display:flex;gap:4px;">`;
                html += `<button type="button" class="btn-preview-file-inline" onclick="if(window.openFilePreview) { window.openFilePreview('${fileUrl}', '${String(f.filename).replace(/'/g, "\\'")}', '${ext}', { case_id: '${caseId}' }); }" style="background:rgba(52,226,168,0.2);color:#34e2a8;border:1px solid rgba(52,226,168,0.4);padding:2px 8px;border-radius:4px;font-size:10.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>ดู</button>`;
                html += `<a href="${fileUrl}" download style="background:rgba(192,132,252,0.2);color:#c084fc;border:1px solid rgba(192,132,252,0.4);padding:2px 8px;border-radius:4px;font-size:10.5px;text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>โหลด</a>`;
                html += `</div></div>`;
              });
            }
          }

          if (fileCount === 0) {
            html += `<span style="color:#9aa0bd;font-size:11.5px;">ไม่มีไฟล์แนบในคดีนี้</span>`;
          }

          html += `</div>`;
          appendMsg(html);
        } catch (err) {
          appendMsg('ไม่สามารถเรียกดูไฟล์แนบได้');
        }
      }

      const togglePhotoBtn = e.target.closest('.btn-toggle-photo-inline');
      if (togglePhotoBtn) {
        const url = togglePhotoBtn.dataset.url;
        if (!url) return;
        const parentItem = togglePhotoBtn.closest('div[style*="justify-content:space-between"]');
        if (parentItem) {
          let existingImg = parentItem.nextElementSibling;
          if (existingImg && existingImg.classList.contains('inline-preview-img-box')) {
            existingImg.remove();
          } else {
            const imgBox = document.createElement('div');
            imgBox.className = 'inline-preview-img-box';
            imgBox.style.cssText = 'margin-top:6px;text-align:center;width:100%;';
            imgBox.innerHTML = `<img src="${url}" style="max-width:100%;max-height:280px;border-radius:8px;border:1px solid rgba(52,226,168,0.5);object-fit:contain;">`;
            parentItem.after(imgBox);
          }
        }
      }

      const delBtn = e.target.closest('.btn-delete-nas-case');
      if (delBtn) {
        const caseId = delBtn.dataset.caseId;
        if (!caseId) return;
        const confirmMsg = `คุณต้องการลบสำนวนคดี '${caseId}' ออกจาก NAS ใช่หรือไม่?`;
        const ok = window.bppConfirm ? await window.bppConfirm(confirmMsg) : confirm(confirmMsg);
        if (!ok) return;
        try {
          const res = await fetch(`/api/nas-bot/cases/${caseId}`, { method: 'DELETE' });
          if (res.ok) {
            appendMsg(`<b>ลบสำนวนคดี ${caseId} ออกจากระบบ NAS เรียบร้อยแล้วครับ!</b> `);
            const cardItem = delBtn.closest('.nas-case-card-item');
            if (cardItem) cardItem.remove();
          } else {
            appendMsg('ไม่สามารถลบคดีนี้ได้');
          }
        } catch (err) {
          appendMsg('เกิดข้อผิดพลาดในการลบคดี');
        }
      }

      // Incident Detail Modal trigger
      const incModalBtn = e.target.closest('.btn-view-chat-incident-modal');
      if (incModalBtn) {
        const evId = incModalBtn.dataset.eventId;
        if (evId && window.openChatIncidentDetailModal) {
          window.openChatIncidentDetailModal(evId);
        }
      }

      // Open Dossier trigger
      const openDossierBtn = e.target.closest('.btn-open-dossier-from-chat');
      if (openDossierBtn) {
        const dossier = openDossierBtn.dataset.dossier;
        if (dossier) {
          if (window.openDossierDetail) {
            window.openDossierDetail(decodeURIComponent(dossier));
          } else {
            const dTab = document.querySelector('.tab-btn[data-tab="dossier"]');
            if (dTab) dTab.click();
          }
        }
      }

      // Delete chat event button trigger
      const delChatEvBtn = e.target.closest('.btn-delete-chat-event');
      if (delChatEvBtn) {
        const evId = delChatEvBtn.dataset.eventId;
        if (evId && window.__deleteChatEvent) {
          window.__deleteChatEvent(evId, delChatEvBtn.closest('.chat-event-card-item'));
        }
      }

      // Clean empty events button trigger
      const cleanEmptyBtn = e.target.closest('.btn-clean-empty-chat-events');
      if (cleanEmptyBtn) {
        if (window.__cleanEmptyChatEvents) {
          window.__cleanEmptyChatEvents();
        }
      }

      // Category filter pills
      const filterPill = e.target.closest('.chat-event-filter-pill');
      if (filterPill) {
        const container = filterPill.closest('.chat-events-list-container');
        if (container) {
          const pills = container.querySelectorAll('.chat-event-filter-pill');
          pills.forEach(p => {
            p.classList.remove('active');
            p.style.background = 'rgba(255,255,255,0.05)';
            p.style.borderColor = 'rgba(255,255,255,0.15)';
            p.style.color = '#cbd5e1';
            p.style.fontWeight = 'normal';
          });
          filterPill.classList.add('active');
          filterPill.style.background = 'rgba(168,85,247,0.3)';
          filterPill.style.borderColor = '#a855f7';
          filterPill.style.color = '#ffffff';
          filterPill.style.fontWeight = '600';

          const cat = filterPill.dataset.cat;
          const cards = container.querySelectorAll('.chat-event-card-item');
          let visibleCount = 0;
          cards.forEach(card => {
            const cardCat = card.dataset.eventCat;
            if (cat === 'all' || cardCat === cat) {
              card.style.display = 'flex';
              visibleCount++;
            } else {
              card.style.display = 'none';
            }
          });
          const countBadge = container.querySelector('.chat-events-count-badge');
          if (countBadge) countBadge.textContent = visibleCount;
        }
      }
    });

    // Global helper for opening full incident detail modal
    window.openChatIncidentDetailModal = async function(evOrId) {
      let ev = null;
      if (typeof evOrId === 'object' && evOrId !== null) {
        ev = evOrId;
      } else if (typeof evOrId === 'string') {
        const cur = window.__currentEvents || [];
        ev = cur.find(e => (e.id === evOrId || e.event_id === evOrId));
        
        if (!ev) {
          // If not in currentEvents, try fetching it
          try {
            const res = await fetch('/api/chat/events', {
              headers: { 'X-Role': window.bppSession?.role || 'admin' }
            }).then(r => r.json());
            const allEvs = res.events || [];
            window.__currentEvents = allEvs; // update cache
            ev = allEvs.find(e => (e.id === evOrId || e.event_id === evOrId));
          } catch(e) {
            console.error('Failed to fetch events', e);
          }
        }
      }
      if (!ev) {
        alert('ไม่พบข้อมูลเหตุการณ์ที่เลือก');
        return;
      }

      let modal = document.getElementById('bppIncidentDetailModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'bppIncidentDetailModal';
        modal.style.cssText = `
          position: fixed; inset: 0; z-index: 100000;
          background: rgba(10, 8, 22, 0.85);
          backdrop-filter: blur(8px);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 16px; box-sizing: border-box;
          opacity: 0; transition: opacity 0.2s ease;
          pointer-events: none; font-family: var(--font-ui, sans-serif);
        `;
        modal.innerHTML = `
          <div style="
            background: rgba(22, 17, 44, 0.98);
            border: 1px solid rgba(168, 85, 247, 0.4);
            box-shadow: 0 20px 50px rgba(0,0,0,0.6), 0 0 30px rgba(168,85,247,0.2);
            border-radius: 12px; width: 92vw; max-width: 800px; max-height: 90vh;
            display: flex; flex-direction: column; overflow: hidden;
          ">
            <!-- Header -->
            <div style="
              padding: 14px 18px; background: rgba(30, 24, 60, 0.95);
              border-bottom: 1px solid rgba(168, 85, 247, 0.3);
              display: flex; align-items: center; justify-content: space-between; gap: 12px;
            ">
              <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                <span id="incModalIcon" style="display:inline-flex; align-items:center; justify-content:center;"></span>
                <div style="overflow: hidden;">
                  <h4 id="incModalTitle" style="margin: 0; font-size: 15px; color: #f8fafc; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></h4>
                  <span id="incModalMeta" style="font-size: 11.5px; color: #9aa0bd;"></span>
                </div>
              </div>
              <button id="incModalCloseBtn" style="
                background: rgba(251, 91, 120, 0.2); border: 1px solid rgba(251, 91, 120, 0.5);
                color: #fb5b78; padding: 5px 10px; border-radius: 6px; font-size: 14px;
                font-weight: 700; cursor: pointer;
              ">&times; ปิด</button>
            </div>

            <!-- Body -->
            <div id="incModalBody" style="flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 14px; color: #e2e8f0; font-size: 13px;">
            </div>

            <!-- Footer -->
            <div id="incModalFooter" style="
              padding: 10px 18px; background: rgba(18, 14, 38, 0.95);
              border-top: 1px solid rgba(168, 85, 247, 0.2);
              display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap;
            ">
            </div>
          </div>
        `;
        document.body.appendChild(modal);

        const closeFn = () => {
          modal.style.opacity = '0';
          modal.style.pointerEvents = 'none';
        };
        const headerCloseBtn = modal.querySelector('#incModalCloseBtn');
        headerCloseBtn.addEventListener('click', closeFn);
        headerCloseBtn.addEventListener('touchend', (e) => { e.preventDefault(); closeFn(); });

        modal.addEventListener('click', (e) => { if (e.target === modal) closeFn(); });
        modal.addEventListener('touchend', (e) => { if (e.target === modal) { e.preventDefault(); closeFn(); } });
      }

      const incIcon = modal.querySelector('#incModalIcon');
      const incTitle = modal.querySelector('#incModalTitle');
      const incMeta = modal.querySelector('#incModalMeta');
      const incBody = modal.querySelector('#incModalBody');
      const incFooter = modal.querySelector('#incModalFooter');

      const typeIcons = {
        drug: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>',
        weapon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
        alien: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
        suspect: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        lpr_hit: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#34e2a8" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
        flash_parcel: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
        drop_point: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
        general: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>'
      };
      const tIcon = ev.is_drop_point
        ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'
        : (typeIcons[ev.incident_type] || '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>');
      const locStr = ev.location_name || ev.arrest_location || (ev.subdistrict ? `ต.${ev.subdistrict} อ.${ev.district||''} จ.${ev.province||''}` : 'ไม่ระบุพื้นที่');
      
      incIcon.innerHTML = tIcon;
      incTitle.textContent = `${ev.incident_type ? `[${ev.incident_type.toUpperCase()}] ` : ''}${locStr}`;
      incMeta.textContent = `ผู้บันทึก: ${accLabelText(ev.created_by || 'admin')} (${ev.created_role || 'เจ้าหน้าที่'}) · วันที่บันทึก: ${(ev.created_at || '').slice(0, 19).replace('T', ' ')}`;

      let bodyHtml = '';

      // Suspect Profile Card
      if (ev.first_name || ev.last_name || ev.id_card || ev.phone || ev.home_address) {
        bodyHtml += `
          <div style="background: rgba(30, 24, 60, 0.6); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 8px; padding: 12px;">
            <h5 style="margin: 0 0 8px 0; color: #c084fc; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ข้อมูลผู้ต้องหา / บุคคลเป้าหมาย
            </h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; font-size: 12.5px;">
              <div><b>ชื่อ-สกุล:</b> <span style="color: #38bdf8; font-weight: 700;">${ev.first_name || '-'} ${ev.last_name || ''}</span> ${ev.nickname ? `(${ev.nickname})` : ''}</div>
              <div><b>เลขบัตรประชาชน:</b> <code style="color: #34e2a8;">${ev.id_card || '-'}</code></div>
              <div><b>เบอร์โทรศัพท์:</b> <code style="color: #fbbf24;">${ev.phone || '-'}</code></div>
              <div><b>สัญชาติ:</b> ${ev.nationality || 'ไทย'}</div>
            </div>
            ${ev.home_address ? `<div style="margin-top: 6px; font-size: 12px; color: #cbd5e1;"><b>ที่อยู่:</b> ${ev.home_address}</div>` : ''}
            ${ev.charges ? `<div style="margin-top: 6px; font-size: 12px; color: #f87171;"><b>ข้อหา/พฤติการณ์:</b> ${ev.charges}</div>` : ''}
          </div>
        `;
      }

      // Seized Items & Parcels Card
      const hasEvidence = (ev.drug_quantity > 0) || (ev.weapon_quantity > 0) || (ev.alien_count > 0) || (ev.ice_kg > 0) || (ev.ketamine_kg > 0) || (ev.evidence_items && ev.evidence_items.length > 0) || (ev.parcels && ev.parcels.length > 0);
      if (hasEvidence || ev.is_drop_point) {
        bodyHtml += `
          <div style="background: rgba(30, 24, 60, 0.6); border: 1px solid rgba(52, 226, 168, 0.3); border-radius: 8px; padding: 12px;">
            <h5 style="margin: 0 0 8px 0; color: #34e2a8; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg> ของกลางที่ตรวจยึด / รายการพัสดุ
            </h5>
            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
              ${ev.drug_quantity ? `<span style="background:rgba(239,68,68,0.2); border:1px solid rgba(239,68,68,0.4); color:#fca5a5; padding:3px 8px; border-radius:6px; font-weight:700;">ยาบ้า: ${Number(ev.drug_quantity).toLocaleString()} เม็ด</span>` : ''}
              ${ev.ice_kg ? `<span style="background:rgba(56,189,248,0.2); border:1px solid rgba(56,189,248,0.4); color:#7dd3fc; padding:3px 8px; border-radius:6px; font-weight:700;">ไอซ์: ${ev.ice_kg} กก.</span>` : ''}
              ${ev.ketamine_kg ? `<span style="background:rgba(168,85,247,0.2); border:1px solid rgba(168,85,247,0.4); color:#d8b4fe; padding:3px 8px; border-radius:6px; font-weight:700;">เคตามีน: ${ev.ketamine_kg} กก.</span>` : ''}
              ${ev.weapon_quantity ? `<span style="background:rgba(234,179,8,0.2); border:1px solid rgba(234,179,8,0.4); color:#fde047; padding:3px 8px; border-radius:6px; font-weight:700;">อาวุธปืน: ${ev.weapon_quantity} กระบอก/ชิ้น</span>` : ''}
              ${ev.alien_count ? `<span style="background:rgba(59,130,246,0.2); border:1px solid rgba(59,130,246,0.4); color:#93c5fd; padding:3px 8px; border-radius:6px; font-weight:700;">บุคคลต่างด้าว: ${ev.alien_count} คน</span>` : ''}
            </div>
            ${ev.evidence_items && ev.evidence_items.length > 0 ? `
              <div style="font-size:12px; color:#cbd5e1; margin-top:4px;">
                <b>รายการของกลางอื่นๆ:</b>
                <ul style="margin:4px 0 0 16px; padding:0;">
                  ${ev.evidence_items.map(it => `<li>${it}</li>`).join('')}
                </ul>
              </div>
            ` : ''}
            ${ev.parcels && ev.parcels.length > 0 ? `
              <div style="font-size:12px; color:#cbd5e1; margin-top:6px;">
                <b>พัสดุ Flash Express:</b>
                <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
                  ${ev.parcels.map(p => `
                    <div style="background:rgba(0,0,0,0.3); padding:4px 8px; border-radius:4px; font-family:monospace; color:#fde047;">
                      • <b>PNO:</b> ${p.pno || '-'} | <b>ผู้รับ:</b> ${p.receiver_name || '-'} (${p.receiver_phone || '-'})
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        `;
      }

      // Location & Coordinates Card
      bodyHtml += `
        <div style="background: rgba(30, 24, 60, 0.6); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; padding: 12px;">
          <h5 style="margin: 0 0 8px 0; color: #38bdf8; font-size: 13.5px; display: flex; align-items: center; justify-content: space-between;">
            <span style="display: flex; align-items: center; gap: 6px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> สถานที่และพิกัดภูมิศาสตร์</span>
            ${ev.lat && ev.lon ? `
              <a href="https://www.google.com/maps/search/?api=1&query=${ev.lat},${ev.lon}" target="_blank" style="background:#0284c7; color:#ffffff; padding:2px 8px; border-radius:4px; font-size:11px; text-decoration:none; font-weight:600; display:inline-flex; align-items:center; gap:3px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>Google Maps ↗
              </a>
            ` : ''}
          </h5>
          <div style="font-size: 12.5px; line-height: 1.6;">
            <b>สถานที่:</b> ${locStr}<br>
            ${ev.subdistrict || ev.district || ev.province ? `<b>พื้นที่การปกครอง:</b> ต.${ev.subdistrict || '-'} อ.${ev.district || '-'} จ.${ev.province || '-'}<br>` : ''}
            ${ev.lat && ev.lon ? `<b>พิกัด GPS:</b> <code style="color:#34e2a8; font-weight:700;">${Number(ev.lat).toFixed(6)}, ${Number(ev.lon).toFixed(6)}</code>` : '<span style="color:#94a3b8;">(ไม่มีพิกัดละติจูด/ลองจิจูด)</span>'}
          </div>
        </div>
      `;

      // Raw Report Text Card
      if (ev.raw_text) {
        bodyHtml += `
          <div style="background: rgba(30, 24, 60, 0.6); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 8px; padding: 12px;">
            <h5 style="margin: 0 0 6px 0; color: #cbd5e1; font-size: 13px; display:flex; align-items:center; gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg> ข้อความรายงาน / สำนวนดิบ (Raw Report)</h5>
            <pre style="margin: 0; background: rgba(0,0,0,0.5); padding: 10px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; font-family: monospace; font-size: 12px; color: #e2e8f0; max-height: 180px; overflow-y: auto;">${ev.raw_text}</pre>
          </div>
        `;
      }

      incBody.innerHTML = bodyHtml;

      const suspectFullName = `${ev.first_name || ''}_${ev.last_name || ''}`.trim().replace(/\s+/g, '_');
      
      const curRole = window.bppSession?.role || (typeof userRole !== 'undefined' ? userRole : 'officer');
      const isAdmin = curRole === 'admin' || curRole === 'superadmin' || ['arm215', 'suchakree', 'bpp215'].includes(window.bppSession?.username);

      incFooter.innerHTML = `
        ${suspectFullName ? `
          <button class="vault-btn btn-dl" data-inc-action="dossier" data-suspect="${encodeURIComponent(suspectFullName)}" style="background:#0284c7; color:#fff; border-color:#0284c7; font-size:12px; padding:6px 12px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>เปิดแฟ้มประวัติบุคคล
          </button>
        ` : ''}
        <button class="vault-btn btn-dl" data-inc-action="i2graph" style="background:rgba(168,85,247,0.2); color:#c084fc; border-color:#a855f7; font-size:12px; padding:6px 12px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>เปิดผัง i2 Graph
        </button>
        ${isAdmin ? `
        <button class="vault-btn btn-dl" data-inc-action="edit" data-event-id="${ev.id || ev.event_id}" style="background:rgba(234,179,8,0.2); color:#eab308; border-color:#ca8a04; font-size:12px; padding:6px 14px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>แก้ไข (Admin)
        </button>
        ` : ''}
        <button class="vault-btn btn-dl" data-inc-action="close" style="background:#334155; color:#fff; border-color:#475569; font-size:12px; padding:6px 14px;">
          ปิด
        </button>
      `;

      // Wire up footer buttons programmatically (inline onclick is unreliable on mobile)
      const closeModal = () => {
        modal.style.opacity = '0';
        modal.style.pointerEvents = 'none';
      };

      incFooter.querySelectorAll('[data-inc-action]').forEach(btn => {
        const handler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const action = btn.getAttribute('data-inc-action');
          if (action === 'close') {
            closeModal();
          } else if (action === 'dossier') {
            const suspect = btn.getAttribute('data-suspect');
            if (suspect && window.openDossierDetail) {
              window.openDossierDetail(suspect);
            }
            closeModal();
          } else if (action === 'i2graph') {
            const i2Tab = document.querySelector('.tab-btn[data-tab="i2"]');
            if (i2Tab) i2Tab.click();
            closeModal();
          } else if (action === 'edit') {
            const eventId = btn.getAttribute('data-event-id');
            if (eventId && window.__editChatEvent) {
              window.__editChatEvent(eventId);
            }
            closeModal();
          }
        };
        btn.addEventListener('click', handler);
        btn.addEventListener('touchend', (e) => {
          e.preventDefault();
          handler(e);
        });
      });

      modal.style.pointerEvents = 'auto';
      modal.style.opacity = '1';
    };

    // Global helper for Admin to directly edit a specific chat event
    window.__editChatEvent = async function(eventId) {
      if (!eventId) return;

      const eventsData = await fetch('/api/chat/events', {
        headers: { 'X-Role': window.bppSession?.role || 'admin' }
      }).then(r => r.json()).catch(() => ({}));

      const currentEv = (eventsData.events || []).find(e => e.event_id === eventId || e.id === eventId);
      const defaultText = currentEv ? (currentEv.raw_text || currentEv.location_name || '') : '';

      showChatCustomPopup({
        title: 'แก้ไขข้อความเหตุการณ์ (Admin Direct Edit)',
        bodyHtml: `
          <label style="font-size:12px;color:#9aa0bd;display:block;margin-bottom:6px;">พิมพ์ข้อความรายงานฉบับแก้ไขที่ถูกต้อง:</label>
          <textarea id="customEditInput" rows="4" style="width:100%;background:rgba(10,8,22,0.85);border:1px solid rgba(168,85,247,0.4);border-radius:6px;color:#ffffff;padding:8px 10px;font-family:inherit;font-size:13px;outline:none;box-sizing:border-box;resize:vertical;">${defaultText}</textarea>
        `,
        confirmText: 'บันทึกการแก้ไข',
        confirmStyle: 'background:linear-gradient(135deg,#059669,#10b981);border:none;color:#ffffff;padding:7px 16px;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 3px 10px rgba(16,185,129,0.35);',
        onConfirm: async () => {
          const inputEl = document.getElementById('customEditInput');
          const newText = inputEl ? inputEl.value.trim() : '';
          if (!newText) return false;

          try {
            const res = await fetch(`/api/chat/events/${eventId}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'X-Role': window.bppSession?.role || 'admin'
              },
              body: JSON.stringify({ message: newText })
            });
            const data = await res.json();
            if (res.ok && data.ok) {
              appendMsg(`<b>แก้ไขข้อมูลเหตุการณ์เรียบร้อยแล้ว!</b><br>${data.reply || ''}`);
              if (window.__refreshAnalyticsData) window.__refreshAnalyticsData();
            } else {
              appendMsg('ไม่สามารถแก้ไขรายการได้');
            }
          } catch (e) {
            appendMsg('เกิดข้อผิดพลาดในการแก้ไขรายการ');
          }
        }
      });
    };

    // Global helper for deleting specific chat events (Admin only)
    window.__deleteChatEvent = async function(eventId, targetCard) {
      if (!eventId) return;
      const ok = await window.bppConfirm('คุณแน่ใจหรือไม่ว่าต้องการลบรายการเหตุการณ์นี้ออกจากระบบ?');
      if (!ok) return;
      try {
        const res = await fetch(`/api/chat/events/${eventId}`, {
          method: 'DELETE',
          headers: { 'X-Role': window.bppSession?.role || 'admin' }
        });
        if (res.status === 403) {
          appendMsg(`<b>สิทธิ์ไม่เพียงพอ!</b> เฉพาะ Admin เท่านั้นที่สามารถลบรายการได้`);
          return;
        }
        appendMsg(`<b>ลบรายการเหตุการณ์สำเร็จ!</b>`);
        if (targetCard) targetCard.remove();
        if (window.__refreshAnalyticsData) window.__refreshAnalyticsData();
      } catch (e) {
        appendMsg('ไม่สามารถลบรายการได้');
      }
    };

    // Global helper for cleaning empty test events (Admin only)
    window.__cleanEmptyChatEvents = async function() {
      const ok = await window.bppConfirm('คุณต้องการลบรายการว่างเปล่าหรือข้อความทดสอบที่ไม่มีข้อมูลออกจากระบบใช่หรือไม่?');
      if (!ok) return;
      try {
        const res = await fetch('/api/chat/events/cleanup-empty', {
          method: 'POST',
          headers: { 'X-Role': window.bppSession?.role || 'admin' }
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          appendMsg(`<b>ทำความสะอาดเสร็จสิ้น!</b> ล้างรายการว่าง/ข้อความทดสอบไปทั้งหมด <b>${data.removed}</b> รายการ (คงเหลือ <b>${data.remaining}</b> รายการ)`);
          // Re-render /list
          const input = document.getElementById('chatInput');
          if (input) {
            input.value = '/list';
            const form = input.closest('form') || document.getElementById('chatForm');
            if (form) form.dispatchEvent(new Event('submit'));
          }
        } else {
          appendMsg('ไม่สามารถล้างรายการได้');
        }
      } catch (e) {
        appendMsg('เกิดข้อผิดพลาดในการล้างรายการว่าง');
      }
    };

    // Global helper for submitting change request (Officers)
    window.__requestEditChatEvent = async function(eventId) {
      if (!eventId) return;

      showChatCustomPopup({
        title: 'ส่งคำขอแก้ไข/ลบรายการต่อ Admin',
        bodyHtml: `
          <label style="font-size:12px;color:#9aa0bd;display:block;margin-bottom:4px;">ประเภทคำขอ:</label>
          <select id="customReqAction" style="width:100%;background:rgba(10,8,22,0.85);border:1px solid rgba(168,85,247,0.4);border-radius:6px;color:#ffffff;padding:7px 10px;font-family:inherit;font-size:12.5px;margin-bottom:10px;outline:none;">
            <option value="edit">ขอแก้ไขข้อความเหตุการณ์</option>
            <option value="delete">ขอให้ลบรายการนี้</option>
          </select>
          <label style="font-size:12px;color:#9aa0bd;display:block;margin-bottom:4px;">ข้อความเหตุการณ์ที่ถูกต้อง (กรณีขอแก้ไข):</label>
          <textarea id="customReqText" rows="3" placeholder="พิมพ์ข้อความแก้ไข..." style="width:100%;background:rgba(10,8,22,0.85);border:1px solid rgba(168,85,247,0.4);border-radius:6px;color:#ffffff;padding:8px 10px;font-family:inherit;font-size:12.5px;margin-bottom:10px;outline:none;box-sizing:border-box;resize:vertical;"></textarea>
          <label style="font-size:12px;color:#9aa0bd;display:block;margin-bottom:4px;">เหตุผลในการขอเปลี่ยน ( Optional ):</label>
          <input type="text" id="customReqReason" value="ข้อมูลไม่ถูกต้อง" style="width:100%;background:rgba(10,8,22,0.85);border:1px solid rgba(168,85,247,0.4);border-radius:6px;color:#ffffff;padding:7px 10px;font-family:inherit;font-size:12.5px;outline:none;box-sizing:border-box;">
        `,
        confirmText: 'ส่งคำขอแจ้ง Admin',
        confirmStyle: 'background:linear-gradient(135deg,#7c3aed,#9333ea);border:none;color:#ffffff;padding:7px 16px;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 3px 10px rgba(124,58,237,0.35);',
        onConfirm: async () => {
          const action = document.getElementById('customReqAction')?.value || 'edit';
          const proposedText = document.getElementById('customReqText')?.value.trim() || '';
          const reason = document.getElementById('customReqReason')?.value.trim() || 'ข้อมูลไม่ถูกต้อง';

          try {
            const username = window.bppSession?.user || 'officer';
            const res = await fetch('/api/chat/requests', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-User': username
              },
              body: JSON.stringify({
                action: action,
                event_id: eventId,
                proposed_text: proposedText,
                reason: reason
              })
            });
            const data = await res.json();
            appendMsg(`<b>ส่งคำขอ ${action === 'delete' ? 'ลบ' : 'แก้ไข'} ไปยัง Admin เรียบร้อยแล้ว!</b><br>รายการรอดำเนินการอนุมัติจาก Admin`);
          } catch (e) {
            appendMsg('ส่งคำขอไม่สำเร็จ');
          }
        }
      });
    };

    // Global helper for Admin to review and approve/reject change requests
    window.__adminReviewRequests = async function() {
      try {
        const userRole = window.bppSession?.role || 'admin';
        const res = await fetch('/api/chat/requests?status=pending', {
          headers: { 'X-Role': userRole }
        });
        const data = await res.json();
        const reqs = data.requests || [];

        if (!reqs.length) {
          appendMsg('<b>ไม่มีคำขอแก้ไข/ลบ ที่รออนุมัติในขณะนี้</b>');
        } else {
          let html = `<b>รายการคำขอแก้ไข/ลบ ที่รอ Admin อนุมัติ (${reqs.length} รายการ):</b><br>`;
          reqs.forEach((r, i) => {
            const actStr = r.action === 'delete' ? '<b style="color:#fb5b78;">[ขอให้ลบ]</b>' : '<b style="color:#34e2a8;">[ขอแก้ไข]</b>';
            html += `<div style="margin-top:6px;padding:8px;background:rgba(26,20,50,0.85);border-radius:6px;border:1px solid rgba(168,85,247,0.3);font-size:12px;">`;
            html += `<b>#${i+1}</b> ${actStr} โดย: <b>${r.requested_by}</b><br>`;
            if (r.proposed_text) html += `ข้อความใหม่: <i>"${r.proposed_text}"</i><br>`;
            if (r.reason) html += `เหตุผล: <span style="color:#9aa0bd;">${r.reason}</span><br>`;
            html += `<div style="margin-top:6px;display:flex;gap:8px;">`;
            html += `<button type="button" class="btn-approve-req" data-req-id="${r.req_id}" style="background:#34e2a8;color:#0a0816;border:none;padding:4px 10px;border-radius:5px;font-weight:600;font-size:11.5px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>อนุมัติ</button>`;
            html += `<button type="button" class="btn-reject-req" data-req-id="${r.req_id}" style="background:#fb5b78;color:#fff;border:none;padding:4px 10px;border-radius:5px;font-weight:600;font-size:11.5px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>ปฏิเสธ</button>`;
            html += `</div></div>`;
          });
          appendMsg(html);
        }
      } catch (e) {
        appendMsg('ไม่สามารถดึงรายการคำขอได้');
      }
    };

    window.__approveReq = async function(reqId, targetContainer) {
      if (!reqId) return;
      try {
        const res = await fetch(`/api/chat/requests/${reqId}/approve`, {
          method: 'POST',
          headers: { 'X-Role': window.bppSession?.role || 'admin' }
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          appendMsg(`${err.detail || 'คำขอนี้ได้รับการอนุมัติหรือปฏิเสธไปแล้ว'}`);
          if (targetContainer) {
            targetContainer.innerHTML = `<span style="color:#9aa0bd;font-size:11px;">คำขอนี้ได้รับการดำเนินการไปแล้ว</span>`;
          }
          return;
        }
        const data = await res.json();
        if (targetContainer) {
          targetContainer.innerHTML = `<span style="color:#34e2a8;font-size:12px;font-weight:600;">อนุมัติคำขอเรียบร้อยแล้ว</span>`;
        }
        appendMsg(`<b>อนุมัติคำขอเรียบร้อยแล้ว!</b> ระบบทำการ${data.action === 'delete' ? 'ลบ' : 'อัปเดต'}ข้อมูลและแผนที่เรียบร้อย`);
        if (window.__refreshAnalyticsData) window.__refreshAnalyticsData();
      } catch (e) {
        appendMsg('ไม่สามารถอนุมัติได้');
      }
    };

    window.__rejectReq = async function(reqId, targetContainer) {
      if (!reqId) return;
      try {
        const res = await fetch(`/api/chat/requests/${reqId}/reject`, {
          method: 'POST',
          headers: { 'X-Role': window.bppSession?.role || 'admin' }
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          appendMsg(`${err.detail || 'คำขอนี้ได้รับการอนุมัติหรือปฏิเสธไปแล้ว'}`);
          if (targetContainer) {
            targetContainer.innerHTML = `<span style="color:#9aa0bd;font-size:11px;">คำขอนี้ได้รับการดำเนินการไปแล้ว</span>`;
          }
          return;
        }
        if (targetContainer) {
          targetContainer.innerHTML = `<span style="color:#fb5b78;font-size:12px;font-weight:600;">ปฏิเสธคำขอเรียบร้อยแล้ว</span>`;
        }
        appendMsg(`<b>ปฏิเสธคำขอเรียบร้อยแล้ว</b>`);
      } catch (e) {
        appendMsg('ไม่สามารถปฏิเสธได้');
      }
    };

    // Global In-App Smart Media & Document Preview Modal
    window.openFilePreview = async function(url, filename, type, meta = {}) {
      if (!url) return;
      let modal = document.getElementById('bppFilePreviewModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'bppFilePreviewModal';
        modal.style.cssText = `
          position: fixed; inset: 0; z-index: 100000;
          background: rgba(10, 8, 22, 0.85);
          backdrop-filter: blur(8px);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 16px; box-sizing: border-box;
          opacity: 0; transition: opacity 0.2s ease;
          pointer-events: none; font-family: var(--font-ui, sans-serif);
        `;
        modal.innerHTML = `
          <div id="bppPreviewBox" style="
            background: rgba(22, 17, 44, 0.95);
            border: 1px solid rgba(168, 85, 247, 0.4);
            box-shadow: 0 20px 50px rgba(0,0,0,0.6), 0 0 30px rgba(168,85,247,0.2);
            border-radius: 12px; width: 92vw; max-width: 1100px; height: 88vh;
            display: flex; flex-direction: column; overflow: hidden;
          ">
            <!-- Header -->
            <div style="
              padding: 12px 18px; background: rgba(30, 24, 60, 0.9);
              border-bottom: 1px solid rgba(168, 85, 247, 0.3);
              display: flex; align-items: center; justify-content: space-between; gap: 12px;
            ">
              <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                <span id="bppPreviewIcon" style="display:inline-flex; align-items:center; justify-content:center; color:#c084fc;"></span>
                <div style="overflow: hidden;">
                  <h4 id="bppPreviewTitle" style="margin: 0; font-size: 14px; color: #f8fafc; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></h4>
                  <span id="bppPreviewMeta" style="font-size: 11px; color: #9aa0bd;"></span>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                <!-- Zoom controls for images -->
                <div id="bppPreviewImgControls" style="display: none; align-items: center; gap: 4px; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 6px;">
                  <button id="bppZoomOutBtn" style="background:none;border:none;color:#c084fc;font-size:14px;cursor:pointer;padding:2px 6px;display:inline-flex;align-items:center;" title="ย่อภาพ"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
                  <span id="bppZoomVal" style="color:#e2e8f0;font-size:11.5px;min-width:36px;text-align:center;">100%</span>
                  <button id="bppZoomInBtn" style="background:none;border:none;color:#c084fc;font-size:14px;cursor:pointer;padding:2px 6px;display:inline-flex;align-items:center;" title="ขยายภาพ"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
                  <button id="bppZoomResetBtn" style="background:rgba(168,85,247,0.2);border:1px solid rgba(168,85,247,0.4);color:#c084fc;font-size:11px;border-radius:4px;cursor:pointer;padding:2px 6px;">รีเซ็ต</button>
                </div>
                <a id="bppPreviewDownloadBtn" href="#" download style="
                  background: rgba(52, 226, 168, 0.2); border: 1px solid rgba(52, 226, 168, 0.5);
                  color: #34e2a8; padding: 5px 12px; border-radius: 6px; font-size: 12px;
                  font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;
                "><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>ดาวน์โหลด</a>
                <button id="bppPreviewCloseBtn" style="
                  background: rgba(251, 91, 120, 0.2); border: 1px solid rgba(251, 91, 120, 0.5);
                  color: #fb5b78; padding: 5px 10px; border-radius: 6px; font-size: 14px;
                  font-weight: 700; cursor: pointer;
                ">&times; ปิด</button>
              </div>
            </div>

            <!-- Body Content -->
            <div id="bppPreviewBody" style="flex: 1; overflow: auto; position: relative; background: #0c0919; display: flex; align-items: center; justify-content: center; padding: 12px;">
            </div>
          </div>
        `;
        document.body.appendChild(modal);

        const closeBtn = document.getElementById('bppPreviewCloseBtn');
        closeBtn.onclick = () => {
          modal.style.opacity = '0';
          modal.style.pointerEvents = 'none';
          document.getElementById('bppPreviewBody').innerHTML = '';
        };

        modal.onclick = (e) => {
          if (e.target === modal) {
            modal.style.opacity = '0';
            modal.style.pointerEvents = 'none';
            document.getElementById('bppPreviewBody').innerHTML = '';
          }
        };

        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && modal.style.pointerEvents === 'auto') {
            modal.style.opacity = '0';
            modal.style.pointerEvents = 'none';
            document.getElementById('bppPreviewBody').innerHTML = '';
          }
        });
      }

      const titleElem = document.getElementById('bppPreviewTitle');
      const iconElem = document.getElementById('bppPreviewIcon');
      const metaElem = document.getElementById('bppPreviewMeta');
      const bodyElem = document.getElementById('bppPreviewBody');
      const dlBtn = document.getElementById('bppPreviewDownloadBtn');
      const imgControls = document.getElementById('bppPreviewImgControls');

      titleElem.textContent = filename || 'ไฟล์เอกสาร';
      dlBtn.href = url;
      dlBtn.setAttribute('download', filename || '');
      imgControls.style.display = 'none';
      bodyElem.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:#c084fc;font-size:14px;"><svg class="spin-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> กำลังโหลดตัวอย่างไฟล์...</div>';

      modal.style.pointerEvents = 'auto';
      modal.style.opacity = '1';

      const ext = (filename || url).split('.').pop().toLowerCase().split('?')[0];

      // 1. Image
      if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(ext)) {
        iconElem.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
        metaElem.textContent = 'ภาพถ่าย / หลักฐานรูปภาพ';
        imgControls.style.display = 'flex';
        
        let currentZoom = 1;
        bodyElem.innerHTML = `
          <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:auto;cursor:grab;">
            <img id="bppPreviewTargetImg" src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;transition:transform 0.15s ease;transform:scale(1);border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,0.5);" alt="${filename}">
          </div>
        `;

        const img = document.getElementById('bppPreviewTargetImg');
        const zoomVal = document.getElementById('bppZoomVal');
        document.getElementById('bppZoomInBtn').onclick = () => {
          currentZoom = Math.min(currentZoom + 0.25, 4);
          img.style.transform = `scale(${currentZoom})`;
          zoomVal.textContent = Math.round(currentZoom * 100) + '%';
        };
        document.getElementById('bppZoomOutBtn').onclick = () => {
          currentZoom = Math.max(currentZoom - 0.25, 0.5);
          img.style.transform = `scale(${currentZoom})`;
          zoomVal.textContent = Math.round(currentZoom * 100) + '%';
        };
        document.getElementById('bppZoomResetBtn').onclick = () => {
          currentZoom = 1;
          img.style.transform = `scale(1)`;
          zoomVal.textContent = '100%';
        };
      }
      // 2. PDF
      else if (ext === 'pdf') {
        iconElem.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>';
        metaElem.textContent = 'เอกสาร PDF (Interactive Reader)';
        bodyElem.innerHTML = `
          <iframe src="${url}#toolbar=1" style="width:100%;height:100%;border:none;border-radius:6px;background:#fff;" title="${filename}"></iframe>
        `;
      }
      // 3. Word (.docx / .doc)
      else if (['docx', 'doc'].includes(ext)) {
        iconElem.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>';
        metaElem.textContent = 'เอกสาร Microsoft Word (Extracted Reader)';
        try {
          let fetchUrl = `/api/nas-bot/preview-doc?filename=${encodeURIComponent(filename)}`;
          if (meta.dossier_id) fetchUrl += `&dossier_id=${encodeURIComponent(meta.dossier_id)}`;
          if (meta.case_id) fetchUrl += `&case_id=${encodeURIComponent(meta.case_id)}`;

          const res = await fetch(fetchUrl);
          const data = await res.json();
          if (data.status === 'success' && data.paragraphs) {
            let pText = data.paragraphs.map(p => `<p style="margin:0 0 10px 0;line-height:1.7;color:#e2e8f0;font-size:13.5px;">${p}</p>`).join('');
            bodyElem.innerHTML = `
              <div style="width:100%;height:100%;overflow-y:auto;padding:24px 32px;background:rgba(18,14,34,0.95);border-radius:8px;box-sizing:border-box;">
                <div style="border-bottom:1px solid rgba(168,85,247,0.3);padding-bottom:10px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
                  <span style="color:#c084fc;font-weight:600;font-size:13px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>เนื้อหาในเอกสาร (${data.total_paragraphs} ย่อหน้า):</span>
                </div>
                ${pText}
              </div>
            `;
          } else {
            bodyElem.innerHTML = `<div style="color:#fb5b78;font-size:13px;">${data.message || 'ไม่สามารถสกัดข้อความจากเอกสารนี้ได้'}</div>`;
          }
        } catch (e) {
          bodyElem.innerHTML = `<div style="color:#fb5b78;font-size:13px;">เกิดข้อผิดพลาดในการโหลดตัวอย่างเอกสาร</div>`;
        }
      }
      // 4. Excel (.xlsx / .xls)
      else if (['xlsx', 'xls'].includes(ext)) {
        iconElem.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>';
        metaElem.textContent = 'ตารางข้อมูล Excel (Spreadsheet Intelligence)';
        try {
          let fetchUrl = `/api/nas-bot/preview-doc?filename=${encodeURIComponent(filename)}`;
          if (meta.case_id) fetchUrl += `&case_id=${encodeURIComponent(meta.case_id)}`;
          if (meta.dossier_id) fetchUrl += `&dossier_id=${encodeURIComponent(meta.dossier_id)}`;

          const res = await fetch(fetchUrl);
          const data = await res.json();
          if (data.status === 'success' && data.summary_text) {
            bodyElem.innerHTML = `
              <div style="width:100%;height:100%;overflow-y:auto;padding:20px;background:rgba(18,14,34,0.95);border-radius:8px;box-sizing:border-box;font-size:13px;line-height:1.7;color:#e2e8f0;white-space:pre-wrap;">${data.summary_text}</div>
            `;
          } else {
            bodyElem.innerHTML = `<div style="color:#cbd5e1;font-size:13px;">สามารถดาวน์โหลดไฟล์ Excel เพื่อเปิดในโปรแกรม Spreadsheet ได้ครับ</div>`;
          }
        } catch (e) {
          bodyElem.innerHTML = `<div style="color:#fb5b78;font-size:13px;">ไม่สามารถโหลดตัวอย่างตาราง Excel ได้</div>`;
        }
      }
      // 5. Video
      else if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) {
        iconElem.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>';
        metaElem.textContent = 'ไฟล์วิดีโอ (Video Player)';
        bodyElem.innerHTML = `
          <video src="${url}" controls autoplay style="max-width:100%;max-height:100%;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.6);"></video>
        `;
      }
      // 6. Audio
      else if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
        iconElem.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
        metaElem.textContent = 'ไฟล์เสียง (Audio Player)';
        bodyElem.innerHTML = `
          <div style="text-align:center;padding:30px;background:rgba(26,20,50,0.9);border-radius:12px;border:1px solid rgba(168,85,247,0.3);">
            <h4 style="color:#f8fafc;margin-bottom:16px;">${filename}</h4>
            <audio src="${url}" controls autoplay style="width:360px;"></audio>
          </div>
        `;
      }
      // 7. Text / Code / Fallback
      else {
        iconElem.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>';
        metaElem.textContent = 'ไฟล์ข้อความ / ข้อมูลดิบ';
        try {
          const res = await fetch(url);
          const txt = await res.text();
          bodyElem.innerHTML = `
            <pre style="width:100%;height:100%;overflow:auto;margin:0;padding:16px;background:rgba(12,9,25,0.95);color:#34e2a8;font-family:monospace;font-size:12px;border-radius:6px;box-sizing:border-box;white-space:pre-wrap;">${txt.slice(0, 30000)}</pre>
          `;
        } catch (e) {
          bodyElem.innerHTML = `<div style="color:#cbd5e1;font-size:13px;">ไม่สามารถแสดงตัวอย่างไฟล์นี้ได้ กรุณากดปุ่มดาวน์โหลดด้านบนครับ</div>`;
        }
      }
    };
  });
})();
