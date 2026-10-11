/**
 * BPP-VMS Web User Guide Interactive Controller
 * Compliant with Content Security Policy (CSP: script-src 'self')
 * กองกำกับการตำรวจตระเวนชายแดนที่ 21 (กก.ตชด.21) — กองร้อย ตชด.215
 */

(function () {
  'use strict';

  // Section maps for dynamic TOC across all 7 modules
  const moduleTocs = {
    mod1: [
      { id: 'sec-1-1', title: '1.1 การเข้าสู่ระบบ (Login & Security)' },
      { id: 'sec-1-2', title: '1.2 แถบควบคุมหลักด้านบน (Top Bar)' },
      { id: 'sec-1-3', title: '1.3 ตารางภาพสดและการจัดเรียง (Layout)' },
      { id: 'sec-1-4', title: '1.4 ปุ่มควบคุมบนหน้าต่างกล้อง (Tile)' },
      { id: 'sec-1-5', title: '1.5 หน้าต่างดูภาพขยายใหญ่ (Viewer)' },
      { id: 'sec-1-6', title: '1.6 แถบสถานะระบบด้านล่าง (Bottom Bar)' }
    ],
    mod2: [
      { id: 'sec-2-1', title: '2.1 แถบเหตุการณ์ด้านข้าง (Events Rail)' },
      { id: 'sec-2-2', title: '2.2 คลังวิดีโอเหตุการณ์ (Event Manager)' },
      { id: 'sec-2-3', title: '2.3 รายละเอียดเหตุการณ์ 3 แท็บ (Event Detail)' },
      { id: 'sec-2-4', title: '2.4 เครื่องเล่นคลิปเหตุการณ์ (Clip Player)' },
      { id: 'sec-2-5', title: '2.5 ดูภาพย้อนหลัง 24 ชั่วโมง (Playback)' }
    ],
    mod3: [
      { id: 'sec-3-1', title: '3.1 เลือกวัตถุตรวจจับ AI (YOLO11 Selector)' },
      { id: 'sec-3-2', title: '3.2 กำหนดโซนจับป้าย (LPR Zone Editor)' },
      { id: 'sec-3-3', title: '3.3 สอนและตรวจป้ายให้ AI (Active Learning)' },
      { id: 'sec-3-4', title: '3.4 จัดการและฝึกโมเดล (Training & Versioning)' }
    ],
    mod4: [
      { id: 'sec-4-1', title: '4.1 ทะเบียนเฝ้าระวังและวิเคราะห์ (Watchlist)' },
      { id: 'sec-4-2', title: '4.2 วิเคราะห์สถิติและแผนที่เสี่ยง (Analytics)' },
      { id: 'sec-4-3', title: '4.3 คลังบันทึกจับกุมและถังข้อมูล (Arrest Vault & Buckets)' },
      { id: 'sec-4-4', title: '4.4 การจัดการผังข้อมูลเครือข่าย i2 Graph (2-Tier Toolbar)' },
      { id: 'sec-4-5', title: '4.5 การสร้างเส้นเชื่อมและจุดหมุน (Bend Points)' },
      { id: 'sec-4-6', title: '4.6 เครื่องมือกลุ่มและการนำทางพื้นที่ (Multi-Select)' }
    ],
    mod5: [
      { id: 'sec-5-1', title: '5.1 ผูกบัญชี Telegram (@Sloth_bpp215bot)' },
      { id: 'sec-5-2', title: '5.2 ปรับแต่งการแจ้งเตือน (Personal & Broadcast)' },
      { id: 'sec-5-3', title: '5.3 ผู้ช่วยอัจฉริยะ Sloth AI Assistant' },
      { id: 'sec-5-4', title: '5.4 รับข้อมูลสืบสวนผ่าน Telegram & แชท (Smart Ingestion)' }
    ],
    mod6: [
      { id: 'sec-6-1', title: '6.1 ข้อมูลบัญชีและระดับสิทธิ์ (RBAC Roles)' },
      { id: 'sec-6-2', title: '6.2 บันทึกประวัติการใช้งาน (Audit Logs)' },
      { id: 'sec-6-3', title: '6.3 การจัดการและเพิ่มกล้อง NVR' },
      { id: 'sec-6-4', title: '6.4 โครงข่ายเชื่อมโยงหน่วยงาน (Federation Mesh)' },
      { id: 'sec-6-5', title: '6.5 ติดตั้งเครื่องใหม่ & อัปเดตระบบ 1-Click' },
      { id: 'sec-6-6', title: '6.6 ตารางสรุปคีย์ลัดคำสั่งด่วน (Shortcuts)' }
    ],
    mod7: [
      { id: 'sec-7-1', title: '7.1 สถาปัตยกรรม Hybrid & Edge AI' },
      { id: 'sec-7-2', title: '7.2 เชื่อมต่อกล้อง TP-Link VIGI' },
      { id: 'sec-7-3', title: '7.3 กล้องตรวจป้าย Dahua ITC (Edge LPR)' },
      { id: 'sec-7-4', title: '7.4 หน่วยงานไม่มี Public IP & BPP Bridge' },
      { id: 'sec-7-5', title: '7.5 การทดสอบระบบ (Verification)' }
    ],
    mod8: [
      { id: 'sec-8-1', title: '8.1 วิธีสร้าง Telegram Bot (@BotFather)' },
      { id: 'sec-8-2', title: '8.2 ติดตั้ง n8n (Local & Docker)' },
      { id: 'sec-8-3', title: '8.3 สถาปัตยกรรม 7 โหนด AI Intelligence' },
      { id: 'sec-8-4', title: '8.4 MikroTik WireGuard VPN ข้ามสาขา' },
      { id: 'sec-8-5', title: '8.5 Master Guide ฉบับเต็ม (Interactive Viewer)' }
    ]
  };

  let currentTabId = 'mod1';

  // Update Table of Contents in the Sidebar
  function updateToc(tabId) {
    const tocList = document.getElementById('tocList');
    const tocIndicator = document.getElementById('tocModuleIndicator');
    const items = moduleTocs[tabId] || [];
    const tabNum = tabId.replace('mod', '');

    if (tocIndicator) {
      tocIndicator.textContent = 'หมวดที่ ' + tabNum;
    }

    if (tocList) {
      if (items.length === 0) {
        tocList.innerHTML = '<li style="color:var(--text-dim); padding:8px 10px; font-size:13px;">ไม่มีหัวข้อย่อย</li>';
        return;
      }

      tocList.innerHTML = items.map((item, idx) => `
        <li class="toc-item ${idx === 0 ? 'active' : ''}">
          <a href="#${item.id}" data-scroll="${item.id}">${item.title}</a>
        </li>
      `).join('');
    }
  }

  // Smooth scroll to a target section
  function smoothScroll(targetId) {
    const el = document.getElementById(targetId);
    if (!el) return;

    const navWrapper = document.querySelector('.sticky-nav-wrapper');
    const navHeight = navWrapper ? navWrapper.offsetHeight : 120;
    const offset = navHeight + 20;

    const bodyRect = document.body.getBoundingClientRect().top;
    const elementRect = el.getBoundingClientRect().top;
    const elementPosition = elementRect - bodyRect;
    const offsetPosition = elementPosition - offset;

    window.scrollTo({
      top: Math.max(0, offsetPosition),
      behavior: 'smooth'
    });

    // Update active highlight in TOC list
    document.querySelectorAll('.toc-item').forEach(ti => {
      const a = ti.querySelector('a');
      if (a && a.getAttribute('data-scroll') === targetId) {
        ti.classList.add('active');
      } else {
        ti.classList.remove('active');
      }
    });

    // Update URL hash without jump
    if (history.replaceState) {
      history.replaceState(null, '', '#' + targetId);
    }
  }

  // Switch active tab/module
  function switchTab(targetId, skipScroll) {
    if (!targetId || !moduleTocs[targetId]) return;

    currentTabId = targetId;

    // Update tab buttons
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
      if (btn.dataset.tab === targetId) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      }
    });

    // Update module panes
    const modulePanes = document.querySelectorAll('.module-pane');
    modulePanes.forEach(pane => {
      if (pane.id === targetId) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    // Refresh dynamic TOC
    updateToc(targetId);

    // Scroll to top of content
    if (!skipScroll) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Update URL hash cleanly
    if (history.replaceState && !skipScroll) {
      history.replaceState(null, '', '#' + targetId);
    }
  }

  // Handle URL hash routing on load or hashchange
  function handleInitialHash() {
    const rawHash = window.location.hash ? window.location.hash.replace('#', '') : '';
    if (!rawHash) {
      switchTab('mod1', true);
      return;
    }

    if (rawHash.startsWith('mod') && moduleTocs[rawHash]) {
      switchTab(rawHash, true);
    } else if (rawHash.startsWith('sec-')) {
      const targetEl = document.getElementById(rawHash);
      if (targetEl) {
        const parentPane = targetEl.closest('.module-pane');
        if (parentPane && moduleTocs[parentPane.id]) {
          switchTab(parentPane.id, true);
          setTimeout(() => smoothScroll(rawHash), 120);
          return;
        }
      }
      switchTab('mod1', true);
    } else {
      switchTab('mod1', true);
    }
  }

  // Initialize event listeners when DOM is ready
  document.addEventListener('DOMContentLoaded', function () {
    // 1. Top ribbon tab buttons click
    const ribbon = document.querySelector('.tab-ribbon');
    if (ribbon) {
      ribbon.addEventListener('click', function (e) {
        const btn = e.target.closest('.tab-btn');
        if (btn && btn.dataset.tab) {
          switchTab(btn.dataset.tab);
        }
      });
    }

    // 2. Chapter navigation buttons click (bottom of each module)
    document.body.addEventListener('click', function (e) {
      // Switch tab button
      const navBtn = e.target.closest('.btn-chapter-nav[data-target]');
      if (navBtn) {
        e.preventDefault();
        switchTab(navBtn.dataset.target);
        return;
      }

      // Scroll to top button
      const topBtn = e.target.closest('.btn-chapter-nav[data-action="top"]');
      if (topBtn) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      // In-text tab links (e.g. data-tab-switch="mod7")
      const tabLink = e.target.closest('[data-tab-switch]');
      if (tabLink) {
        e.preventDefault();
        switchTab(tabLink.dataset.tabSwitch);
        return;
      }

      // Sidebar TOC link click
      const tocLink = e.target.closest('#tocList a[data-scroll]');
      if (tocLink) {
        e.preventDefault();
        const targetId = tocLink.dataset.scroll;
        smoothScroll(targetId);
      }
    });

    // 3. Print PDF button
    const btnPrint = document.getElementById('btnPrintPdf');
    if (btnPrint) {
      btnPrint.addEventListener('click', function () {
        window.print();
      });
    }

    // 4. Live search filter
    const searchInput = document.getElementById('guideSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        const query = e.target.value.toLowerCase().trim();
        const modulePanes = document.querySelectorAll('.module-pane');

        if (!query) {
          document.querySelectorAll('.guide-card').forEach(c => c.style.display = '');
          return;
        }

        let matchedInActive = false;
        const activePane = document.querySelector('.module-pane.active');
        if (activePane) {
          activePane.querySelectorAll('.guide-card').forEach(card => {
            if (card.textContent.toLowerCase().includes(query)) {
              card.style.display = '';
              matchedInActive = true;
            } else {
              card.style.display = 'none';
            }
          });
        }

        if (!matchedInActive) {
          for (const pane of modulePanes) {
            const cards = pane.querySelectorAll('.guide-card');
            for (const card of cards) {
              if (card.textContent.toLowerCase().includes(query)) {
                switchTab(pane.id, true);
                card.style.display = '';
                return;
              }
            }
          }
        }
      });
    }

    // Initial load based on hash
    handleInitialHash();
  });

  window.addEventListener('hashchange', handleInitialHash);

  // Expose switchTab and smoothScroll globally for programmatic access
  window.switchTab = switchTab;
  window.smoothScroll = smoothScroll;

})();
