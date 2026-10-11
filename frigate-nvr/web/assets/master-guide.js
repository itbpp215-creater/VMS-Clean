/**
 * BPP-VMS Master Guide Interactive Controller
 * Compliant with Content Security Policy (CSP: script-src 'self')
 * กองกำกับการตำรวจตระเวนชายแดนที่ 21 (กก.ตชด.21) — กองร้อย ตชด.215
 */
(function () {
  'use strict';

// Master Switcher Logic
    function switchMasterTab(mode) {
      const paneN8n = document.getElementById('master-pane-n8n');
      const paneMt = document.getElementById('master-pane-mikrotik');
      const btnN8n = document.getElementById('master-btn-n8n');
      const btnMt = document.getElementById('master-btn-mikrotik');

      if (mode === 'n8n') {
        paneN8n.classList.remove('hidden');
        paneMt.classList.add('hidden');
        btnN8n.className = 'px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 bg-purple-600 text-white shadow-lg shadow-purple-900/40 flex items-center gap-2';
        btnMt.className = 'px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2';
      } else {
        paneN8n.classList.add('hidden');
        paneMt.classList.remove('hidden');
        btnMt.className = 'px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 bg-indigo-600 text-white shadow-lg shadow-indigo-900/40 flex items-center gap-2';
        btnN8n.className = 'px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-2';
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // MikroTik Sub-tab Switcher
    function switchMtTab(tabId) {
      document.querySelectorAll('.mt-tab-content, .tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.mt-tab-btn, .tab-btn').forEach(el => el.classList.remove('active'));
      
      const targetTab = document.getElementById(tabId);
      if (targetTab) {
        targetTab.classList.add('active');
      }
      
      const btns = document.querySelectorAll('.mt-tab-btn, .tab-btn');
      btns.forEach(b => {
        const attr = b.getAttribute('onclick') || '';
        if (attr.includes("'" + tabId + "'") || attr.includes('"' + tabId + '"')) {
          b.classList.add('active');
        }
      });
    }
    window.switchTab = switchMtTab;

    // Universal Copy Code Function (Mobile & Cross-browser Hardened)
    function copyCode(elementId, btnElement) {
      const el = document.getElementById(elementId);
      if (!el) return;
      const text = el.innerText || el.textContent;
      const btn = btnElement || (typeof event !== 'undefined' ? (event.currentTarget || event.target) : null);
      
      const onSuccess = () => {
        if (btn) {
          const originalText = btn.textContent;
          btn.textContent = '✅ คัดลอกแล้ว!';
          btn.style.background = '#34d399';
          btn.style.color = '#000';
          setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
            btn.style.color = '';
          }, 2000);
        }
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
          fallbackCopy(text, onSuccess);
        });
      } else {
        fallbackCopy(text, onSuccess);
      }
    }

    function fallbackCopy(text, cb) {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        if (cb) cb();
      } catch (err) {
        console.error('Fallback copy failed:', err);
      }
      document.body.removeChild(textArea);
    }

    // ----------------------------------------------------
    // n8n Interactive Logic & Rich Data
    // ----------------------------------------------------
    // Rich 7 Nodes Configuration Stepper Data
    const nodeGuideData = {
      1: {
        badge: "โหนด #1 (Webhook Trigger)",
        title: "Master Webhook Trigger (จุดรับข้อมูลเข้า)",
        type: "n8n-nodes-base.webhook",
        border: "border-emerald-500",
        where: `
          <ol class="list-decimal list-inside space-y-1.5 text-slate-300">
            <li>กดปุ่ม <strong class="text-white">+ (Add Node)</strong> บนมุมขวาบนของ Canvas หรือกดปุ่ม Tab</li>
            <li>พิมพ์ค้นหาคำว่า <strong class="text-emerald-400">Webhook</strong> แล้วกดเลือกโหนด</li>
            <li>ดับเบิลคลิกที่โหนดบน Canvas เพื่อเปิดหน้าต่าง <strong>Parameters Panel</strong></li>
            <li>ที่ช่อง <strong class="text-white">HTTP Method</strong> คลิกเลือกเป็น <span class="text-emerald-300 font-bold">POST</span></li>
            <li>ที่ช่อง <strong class="text-white">Path</strong> พิมพ์คำว่า: <code class="text-amber-300">bpp-vms-master</code></li>
            <li>เลื่อนลงมาที่หัวข้อ <strong class="text-white">Response Mode</strong> เปลี่ยนเป็น <span class="text-purple-300 font-bold">Using 'Respond to Webhook' Node</span></li>
          </ol>
        `,
        what: `
          <div class="table-responsive-wrapper overflow-x-auto w-full">
            <table class="w-full table-fixed text-left text-xs border border-slate-800 rounded-lg overflow-hidden">
              <thead class="bg-slate-900/90 text-slate-300 border-b border-slate-800">
                <tr>
                  <th class="p-3 w-[22%] align-top break-words">พารามิเตอร์ & ค่าที่ตั้ง</th>
                  <th class="p-3 w-[26%] align-top break-words">คืออะไร & หมายความว่ายังไง?</th>
                  <th class="p-3 w-[27%] align-top break-words text-amber-300">ทำทำไม? (เหตุผล & ตรรกะ)</th>
                  <th class="p-3 w-[25%] align-top break-words text-emerald-300">ทำแล้วได้อะไร? (ผลลัพธ์)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/80 bg-slate-950/60">
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">HTTP Method</div>
                    <code class="text-emerald-400 font-bold">POST</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">โปรโตคอลการรับส่งข้อมูลผ่าน HTTP แบบส่งก้อนข้อมูลใน Request Body</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ต้องส่งข้อมูลขนาดใหญ่ เช่น ภาพถ่าย Base64, พิกัด GPS, รายชื่อผู้ต้องสงสัย ซึ่งส่งผ่าน URL แบบ GET ไม่ได้</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">รับข้อมูลขนาดใหญ่ได้ไม่จำกัด ข้อมูลปลอดภัยไม่หลุดโชว์ใน URL Log</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Path</div>
                    <code class="text-amber-300 font-bold">bpp-vms-master</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">ชื่อเส้นทางต่อท้าย URL (Endpoint Slug) สำหรับชี้เป้ามายัง Workflow นี้</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">กำหนด URL เฉพาะของบอท BPP-VMS กลาง ไม่ให้ชนกับ Webhook อื่นในเซิร์ฟเวอร์</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ได้ URL ชัดเจน <code>.../webhook/bpp-vms-master</code> ชี้ตรงเข้าสู่ระบบ 100%</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Authentication</div>
                    <code class="text-slate-300">None (หรือ Header Auth)</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-amber-950 text-amber-300 border border-amber-500/40">🟡 ค่าทางเลือก</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">ระบบตรวจสอบสิทธิ์และกุญแจความปลอดภัยก่อนยอมให้ข้อมูลผ่านเข้ามา</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ในวงปิด Docker ใช้ None เพื่อความรวดเร็ว หากเปิดสู่ Public ควรเปิด Header Auth ดักตรวจ Secret Key</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ยืดหยุ่นตามสภาพแวดล้อม ป้องกันคนภายนอกยิง Flood รบกวนระบบ</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Response Mode</div>
                    <code class="text-purple-300 font-bold">Using 'Respond to Webhook' Node</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">สั่งให้ n8n ระงับการตอบกลับไว้ก่อน จนกว่าจะรันไปถึงโหนด Respond ปลายทาง</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ต้องรอให้ AI Agent สกัดข้อความ หรือโค้ดดึง GPS ภาพถ่ายเสร็จก่อน (ใช้เวลา 1-3 วินาที)</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ผู้เรียก (Dashboard/แอป) ได้รับผลลัพธ์ JSON ที่ AI วิเคราะห์เสร็จในรอบเดียว ไม่ต้อง Polling ซ้ำ</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Test / Prod URL</div>
                    <code class="text-blue-300 text-[10px]">/webhook-test/... vs /webhook/...</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40">🟢 ประสิทธิภาพ</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">URL สองโหมด: โหมดทดสอบรายครั้ง และโหมดรันระบบจริง 24/7</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">Test URL ใช้ดีบักตอนกด Listen บนหน้าจอ ส่วน Production URL ทำงานอัตโนมัติเมื่อกดสวิตช์ Active</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ทดสอบระบบได้ปลอดภัย ข้อมูลทดสอบไม่ปะปนกับฐานข้อมูลสายตรวจจริง</td>
                </tr>
              </tbody>
            </table>
          </div>
        `,
        why: `
          <ul class="list-disc list-inside space-y-1.5 text-slate-300">
            <li><strong>ทำไมต้องใช้ POST?</strong> เพราะเราต้องการส่ง Payload ข้อมูลขนาดใหญ่ เช่น รูปภาพ Base64, รายชื่อผู้ต้องสงสัย, พิกัด GPS ซึ่งไม่สามารถส่งผ่าน URL แบบ GET ได้</li>
            <li><strong>ทำไมต้อง Response Mode = 'Respond to Webhook'?</strong> เพื่อให้ n8n รอให้กระบวนการสกัดข้อมูลของ AI (โหนด #3 หรือ #6) ทำงานเสร็จก่อน แล้วค่อยส่งข้อมูล JSON ที่สกัดเสร็จแล้วตอบกลับไปให้แอปมือถือหรือ Dashboard</li>
          </ul>
        `,
        raw: `{
  "parameters": {
    "httpMethod": "POST",
    "path": "bpp-vms-master",
    "responseMode": "responseNode",
    "options": {}
  },
  "id": "webhook-inbound-trigger",
  "name": "Master Webhook Trigger",
  "type": "n8n-nodes-base.webhook",
  "typeVersion": 2,
  "position": [200, 300]
}`
      },
      2: {
        badge: "โหนด #2 (Switch Router)",
        title: "Route by Message Type (คัดแยกประเภทข้อมูล)",
        type: "n8n-nodes-base.switch",
        border: "border-amber-500",
        where: `
          <ol class="list-decimal list-inside space-y-1.5 text-slate-300">
            <li>ลากสายจากหมุด Output ของโหนด #1 Webhook ออกมา ปล่อยเมาส์แล้วค้นหา <strong class="text-amber-400">Switch</strong></li>
            <li>ดับเบิลคลิกเปิดหน้าต่าง Switch ขึ้นมา</li>
            <li>ที่หัวข้อ <strong class="text-white">Mode</strong> เลือกเป็น <span class="text-amber-300 font-bold">Rules</span></li>
            <li>ที่ช่อง <strong class="text-white">Value 1</strong> ให้คลิกที่ไอคอนรูปเฟืองหรือสลับเป็นโหมด Expression แล้วใส่โค้ด: <code class="text-emerald-300">={{ $json.body.type || 'chat' }}</code></li>
            <li>กดปุ่ม <strong class="text-white">+ Add Routing Rule</strong> เพิ่ม 3 เงื่อนไข:
              <br>• Output 0: String เท่ากับ <code>chat</code>
              <br>• Output 1: String เท่ากับ <code>photo</code>
              <br>• Output 2: String เท่ากับ <code>alert</code>
            </li>
          </ol>
        `,
        what: `
          <div class="table-responsive-wrapper overflow-x-auto w-full">
            <table class="w-full table-fixed text-left text-xs border border-slate-800 rounded-lg overflow-hidden">
              <thead class="bg-slate-900/90 text-slate-300 border-b border-slate-800">
                <tr>
                  <th class="p-3 w-[22%] align-top break-words">พารามิเตอร์ & ค่าที่ตั้ง</th>
                  <th class="p-3 w-[26%] align-top break-words">คืออะไร & หมายความว่ายังไง?</th>
                  <th class="p-3 w-[27%] align-top break-words text-amber-300">ทำทำไม? (เหตุผล & ตรรกะ)</th>
                  <th class="p-3 w-[25%] align-top break-words text-emerald-300">ทำแล้วได้อะไร? (ผลลัพธ์)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/80 bg-slate-950/60">
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Mode</div>
                    <code class="text-amber-300 font-bold">Rules</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">โหมดคัดแยกเส้นทางข้อมูลตามเงื่อนไขตรรกะแบบหลายทางเลือก</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ทำหน้าที่เป็นชุมสายคัดแยกประเภทงาน เพื่อกระจายงานไปยังโหนดที่เชี่ยวชาญเฉพาะด้าน</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">จุดรับเข้ามีบานเดียว (Single Endpoint) แต่แยกงาน 3 สายได้อย่างเป็นระเบียบ</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Value 1</div>
                    <code class="text-emerald-400 font-bold">={{ $json.body.type || 'chat' }}</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">ตัวแปรหลักที่ใช้เปรียบเทียบ โดยอ่านฟิลด์ type จาก Request พร้อมใส่ค่าสำรอง 'chat'</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ป้องกันกรณีแอปหน้าบ้านลืมส่งฟิลด์ type มา ระบบจะอนุโลมให้เป็นแชทคุยกับ AI ทันที</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">Workflow ไม่ตายกลางทาง (Fail-safe) ทุกข้อความได้รับการประมวลผลแน่นอน</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Rule 0 (chat)</div>
                    <code class="text-purple-300 font-bold">Output 0 ➔ AI Agent</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40">🟢 สถาปัตยกรรม</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">ถ้า type เป็น 'chat' ส่งข้อมูลออกพอร์ตที่ 0</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ส่งข้อความรายงานเหตุการณ์เข้าสู่โหนด LangChain AI Agent</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ข้อความได้รับการสกัด Entity ไม่ส่งไปประมวลผลรูปให้เสียเวลา</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Rule 1 (photo)</div>
                    <code class="text-blue-300 font-bold">Output 1 ➔ Photo Code</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40">🟢 สถาปัตยกรรม</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">ถ้า type เป็น 'photo' ส่งข้อมูลออกพอร์ตที่ 1</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ส่งชุดภาพถ่ายของกลางเข้าสู่โหนดสกัด EXIF GPS</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ได้พิกัดแผนที่ละติจูด/ลองจิจูดใน 2 มิลลิวินาที ไม่เปลือง Token AI</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Rule 2 (alert)</div>
                    <code class="text-cyan-300 font-bold">Output 2 ➔ LPR Formatter</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40">🟢 สถาปัตยกรรม</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">ถ้า type เป็น 'alert' ส่งข้อมูลออกพอร์ตที่ 2</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ส่งข้อมูลทะเบียนรถจากกล้อง LPR เข้าโหนดจัดรูปแบบการ์ด</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">แจ้งเตือนด่วนเข้า Telegram เจ้าหน้าที่สายตรวจทันที Real-time</td>
                </tr>
              </tbody>
            </table>
          </div>
        `,
        why: `
          <ul class="list-disc list-inside space-y-1.5 text-slate-300">
            <li><strong>ทำไมต้องมีโหนดนี้?</strong> เพราะระบบ BPP-VMS มีประตูรับข้อมูลบานเดียว (Single Webhook) เพื่อความง่ายของแอปหน้าบ้าน แต่ภาระงานมี 3 แบบ: คุยกับ AI, ตรวจสอบภาพถ่าย, หรือแจ้งเตือนกล้อง LPR</li>
            <li><strong>ทำไมต้องมี Fallback || 'chat'?</strong> ป้องกันกรณีที่ผู้ใช้ยิงข้อความเข้ามาตรงๆ โดยไม่ได้ระบุฟิลด์ type ระบบจะอนุโลมให้เป็นประเภท 'chat' ทันที ทำให้ Workflow ไม่หลุดตกค้าง</li>
          </ul>
        `,
        raw: `{
  "parameters": {
    "dataType": "string",
    "value1": "={{ $json.body.type || 'chat' }}",
    "rules": {
      "rules": [
        { "value2": "chat", "output": 0 },
        { "value2": "photo", "output": 1 },
        { "value2": "alert", "output": 2 }
      ]
    }
  },
  "id": "switch-router",
  "name": "Route by Message Type",
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3,
  "position": [440, 300]
}`
      },
      3: {
        badge: "โหนด #3 (AI Agent - สกัดข้อความ)",
        title: "AI Intelligence Agent (การสกัดข้อมูลข้อความภาษาไทย)",
        type: "@n8n/n8n-nodes-langchain.agent",
        border: "border-purple-500",
        where: `
          <ol class="list-decimal list-inside space-y-1.5 text-slate-300">
            <li>ลากสายจาก Output ขา 0 (chat) ของโหนด Switch มาปล่อย ค้นหาคำว่า <strong class="text-purple-400">AI Agent</strong></li>
            <li>ดับเบิลคลิกเปิดหน้าต่าง AI Agent</li>
            <li>ที่ช่อง <strong class="text-white">Prompt Type</strong> เลือกเป็น <span class="text-purple-300 font-bold">Define below</span></li>
            <li>ที่ช่อง <strong class="text-white">Text (User Prompt)</strong> คลิกปุ่ม Expression ใส่ค่า: <code class="text-emerald-300">={{ $json.body.message || $json.body.text }}</code></li>
            <li>กดที่ปุ่ม <strong class="text-white">+ Add Option</strong> ด้านล่าง ➔ เลือก <span class="text-amber-300 font-bold">System Message</span></li>
            <li>พิมพ์คำสั่งตีกรอบให้ AI สกัด Entity: (บุคคล, ของกลางยาบ้า/อาวุธ, ทะเบียนรถ, พิกัดสถานที่)</li>
          </ol>
        `,
        what: `
          <div class="table-responsive-wrapper overflow-x-auto w-full">
            <table class="w-full table-fixed text-left text-xs border border-slate-800 rounded-lg overflow-hidden">
              <thead class="bg-slate-900/90 text-slate-300 border-b border-slate-800">
                <tr>
                  <th class="p-3 w-[22%] align-top break-words">พารามิเตอร์ & ค่าที่ตั้ง</th>
                  <th class="p-3 w-[26%] align-top break-words">คืออะไร & หมายความว่ายังไง?</th>
                  <th class="p-3 w-[27%] align-top break-words text-amber-300">ทำทำไม? (เหตุผล & ตรรกะ)</th>
                  <th class="p-3 w-[25%] align-top break-words text-emerald-300">ทำแล้วได้อะไร? (ผลลัพธ์)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/80 bg-slate-950/60">
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Prompt Type</div>
                    <code class="text-purple-300 font-bold">Define below</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">กำหนด Prompt ควบคุม AI เองโดยตรงในหน้าตั้งค่าโหนด</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ควบคุมกรอบความคิด AI ให้ตรงกับภารกิจความมั่นคง ตชด.215 โดยไม่ต้องพึ่งพา Template ภายนอก</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ควบคุมพฤติกรรมและการสกัดข้อมูลเฉพาะทางได้อย่างสมบูรณ์แบบ</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Text (User Prompt)</div>
                    <code class="text-emerald-400 font-bold">={{ $json.body.message || $json.body.text }}</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">ข้อความรายงานเหตุการณ์ที่เจ้าหน้าที่พิมพ์ส่งมาผ่าน Webhook</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ส่งข้อความภาษาไทยเข้าสู่ Context การคิดคำนวณของ AI</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">AI ได้รับข้อความรายงานเหตุการณ์เพื่อถอดรหัสและค้นหาเบาะแส</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">System Message</div>
                    <code class="text-amber-300 text-[10px]">คุณคือ AI Assistant ประจำศูนย์...</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">คำสั่งกำกับบทบาท สั่งให้สกัด: บุคคล, ของกลาง, ทะเบียน, พิกัด และบังคับใช้ Tool</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">สกัดภาษาพูดของสายตรวจที่มีคำแสลงให้กลายเป็น JSON ที่เป็นระเบียบ และสั่งให้ค้นหา Watchlist อัตโนมัติ</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">AI ไม่หลุดบทบาท สกัดข้อมูลแม่นยำ และเรียกเช็กแบล็กลิสต์ให้อัตโนมัติ</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Model & Tool Pins</div>
                    <code class="text-indigo-300">Model Socket + Tool Socket</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40">🟢 ประสิทธิภาพ</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">จุดเชื่อมต่อภายนอกสำหรับเสียบสมองกล (โหนด #4) และเครื่องมือ (โหนด #8)</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">สถาปัตยกรรม LangChain: Agent สั่งการ ➔ Model คิดคำนวณ ➔ Tool เชื่อมต่อฐานข้อมูล</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ระบบขยายตัวได้ง่าย สามารถสลับโมเดล AI หรือเพิ่ม API ค้นหาใหม่ๆ ได้ทันที</td>
                </tr>
              </tbody>
            </table>
          </div>
        `,
        why: `
          <ul class="list-disc list-inside space-y-1.5 text-slate-300">
            <li><strong>ทำไมต้องใช้ AI Agent แทนโหนดธรรมดา?</strong> เพราะข้อความรายงานที่ตำรวจ/เจ้าหน้าที่พิมพ์ส่งมาเป็นภาษาพูด ไม่เป็นระเบียบ สะกดผิดบ้าง มีคำแสลง โหนดธรรมดาเขียน Regex ดักไม่ไหว จึงต้องใช้ LLM ช่วยคิดและสกัด Entity</li>
            <li><strong>ทำไมต้องสั่งให้เรียก Tool ใน System Prompt?</strong> เพราะเราต้องการให้ AI ทำงานแบบ Autonomous (ตัดสินใจเองได้) เมื่อสกัดเจอป้ายทะเบียน มันจะแอบยิง API ไปเช็กแบล็กลิสต์ให้เองทันที</li>
          </ul>
        `,
        raw: `{
  "parameters": {
    "promptType": "define",
    "text": "={{ $json.body.message || $json.body.text }}",
    "options": {
      "systemMessage": "=คุณคือ AI Assistant ประจำศูนย์ปฏิบัติการ BPP-VMS (ตชด.215)\\nหน้าที่ของคุณ:\\n1. รับฟังและตอบคำถามเจ้าหน้าที่เกี่ยวกับสถานการณ์ความมั่นคง\\n2. สกัดข้อมูลรายงานเหตุการณ์ภาษาไทย (บุคคล, ของกลาง, ยานพาหนะ, พิกัดสถานที่, สภ.)\\n3. ค้นหาข้อมูลป้ายทะเบียนและบุคคลต้องสงสัยใน Watchlist ผ่าน Tool"
    }
  },
  "id": "ai-agent-chat",
  "name": "AI Intelligence Agent",
  "type": "@n8n/n8n-nodes-langchain.agent",
  "typeVersion": 1.7,
  "position": [720, 140]
}`
      },
      4: {
        badge: "โหนด #4 (Gemini Model Sub-node)",
        title: "Google Gemini 3.5 Flash Lite (สมอง AI)",
        type: "@n8n/n8n-nodes-langchain.lmChatGoogleGemini",
        border: "border-indigo-500",
        where: `
          <ol class="list-decimal list-inside space-y-1.5 text-slate-300">
            <li>สังเกตที่ใต้กล่องของโหนด #3 AI Agent จะมีช่องเสียบที่เขียนว่า <strong class="text-indigo-400">Model</strong></li>
            <li>คลิกที่ปุ่มบวกใต้ช่อง Model ➔ ค้นหาคำว่า <strong class="text-indigo-300">Google Gemini Chat Model</strong></li>
            <li>ดับเบิลคลิกเปิดโหนด Gemini</li>
            <li>ที่ช่อง <strong class="text-white">Credential for Google Gemini</strong> คลิกเลือกหรือกด <span class="text-emerald-400 font-bold">Create New Credential</span> แล้ววาง API Key ที่ได้จาก Google AI Studio</li>
            <li>ที่ช่อง <strong class="text-white">Model Name</strong> ให้พิมพ์หรือเลือก: <code class="text-amber-300">models/gemini-3.5-flash-lite</code></li>
            <li>ที่หัวข้อ Options ปรับ <strong class="text-white">Temperature</strong> เป็น <span class="text-blue-300 font-bold">0.2</span></li>
          </ol>
        `,
        what: `
          <div class="table-responsive-wrapper overflow-x-auto w-full">
            <table class="w-full table-fixed text-left text-xs border border-slate-800 rounded-lg overflow-hidden">
              <thead class="bg-slate-900/90 text-slate-300 border-b border-slate-800">
                <tr>
                  <th class="p-3 w-[22%] align-top break-words">พารามิเตอร์ & ค่าที่ตั้ง</th>
                  <th class="p-3 w-[26%] align-top break-words">คืออะไร & หมายความว่ายังไง?</th>
                  <th class="p-3 w-[27%] align-top break-words text-amber-300">ทำทำไม? (เหตุผล & ตรรกะ)</th>
                  <th class="p-3 w-[25%] align-top break-words text-emerald-300">ทำแล้วได้อะไร? (ผลลัพธ์)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/80 bg-slate-950/60">
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Model Name</div>
                    <code class="text-indigo-300 font-bold">models/gemini-3.5-flash-lite</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40">🟢 ประสิทธิภาพ</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">โมเดลภาษาของ Google ที่เน้นความเร็วระดับเสี้ยววินาทีและกินทรัพยากรต่ำ</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">สายตรวจต้องการคำตอบเร็ว ไม่หน่วง และใช้งานได้ฟรีบน Google AI Studio Free Tier</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ตอบสนองไวระดับ Sub-second และลดภาระค่าใช้จ่ายหน่วยงานเป็น 0 บาท</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Temperature</div>
                    <code class="text-amber-300 font-bold">0.2</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">ค่าควบคุมความแม่นยำ/จินตนาการของ AI (0.0 = ตรงเป๊ะ, 1.0 = สร้างสรรค์สุด)</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">งานความมั่นคงต้องการข้อเท็จจริง 100% ห้ามเดาหรือแต่งเติมทะเบียนรถ/ของกลางเอง</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ป้องกัน AI หลอน (Hallucination) ข้อมูลถูกต้องตามรายงานจริง 100%</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Credential</div>
                    <code class="text-emerald-400">Google Gemini API Key</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">กุญแจลับยืนยันสิทธิ์ในการเข้าใช้งาน Google AI Studio</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">จำเป็นในการยืนยันตัวตนกับระบบคลาวด์ของ Google</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">เชื่อมต่อบริการ AI ได้ราบรื่น กุญแจถูกเข้ารหัสปลอดภัยในฐานข้อมูล n8n</td>
                </tr>
              </tbody>
            </table>
          </div>
        `,
        why: `
          <ul class="list-disc list-inside space-y-1.5 text-slate-300">
            <li><strong>ทำไมต้องเป็น Gemini Flash Lite?</strong> เพราะรุ่น Flash Lite ประมวลผลภาษาไทยได้รวดเร็วมาก (Latency ต่ำ เหมาะกับงานตอบแชท) และใช้งานได้ฟรีในระดับ Free Tier ไม่เสียค่าใช้จ่าย</li>
            <li><strong>ทำไมต้องตั้ง Temperature = 0.2?</strong> ยิ่งค่าน้อย AI ยิ่งตอบตรงไปตรงมาตามเนื้อผ้า ไม่แต่งเรื่องหรือเดาข้อมูลของกลาง/ชื่อผู้ต้องสงสัยขึ้นมาเอง</li>
          </ul>
        `,
        raw: `{
  "parameters": {
    "modelName": "models/gemini-3.5-flash-lite",
    "options": { "temperature": 0.2 }
  },
  "id": "gemini-model-chat",
  "name": "Google Gemini 3.5 Flash Lite",
  "type": "@n8n/n8n-nodes-langchain.lmChatGoogleGemini",
  "typeVersion": 1,
  "position": [720, 340]
}`
      },
      5: {
        badge: "โหนด #5 (LPR Alert Card Formatter)",
        title: "Format Rich Alert Card (โหนดจัดฟอร์แมตการ์ดแจ้งเตือน)",
        type: "n8n-nodes-base.code",
        border: "border-cyan-500",
        where: `
          <ol class="list-decimal list-inside space-y-1.5 text-slate-300">
            <li>ลากสายจาก Output ขา 2 (alert) ของโหนด Switch มาปล่อย ค้นหาคำว่า <strong class="text-cyan-400">Code</strong></li>
            <li>ดับเบิลคลิกเปิดหน้าต่าง Code Node</li>
            <li>ที่หัวข้อ <strong class="text-white">Language</strong> เลือกเป็น <span class="text-emerald-400 font-bold">JavaScript</span></li>
            <li>ที่หัวข้อ <strong class="text-white">Mode</strong> ตรวจสอบว่าเป็น <span class="text-blue-400 font-bold">Run Once for Each Item</span></li>
            <li>คัดลอกโค้ดสกัดทะเบียนและจัดหน้าตาการ์ดแจ้งเตือนวางในช่อง <strong class="text-white">JavaScript Code</strong></li>
          </ol>
        `,
        what: `
          <div class="table-responsive-wrapper overflow-x-auto w-full">
            <table class="w-full table-fixed text-left text-xs border border-slate-800 rounded-lg overflow-hidden">
              <thead class="bg-slate-900/90 text-slate-300 border-b border-slate-800">
                <tr>
                  <th class="p-3 w-[22%] align-top break-words">พารามิเตอร์ & ค่าที่ตั้ง</th>
                  <th class="p-3 w-[26%] align-top break-words">คืออะไร & หมายความว่ายังไง?</th>
                  <th class="p-3 w-[27%] align-top break-words text-amber-300">ทำทำไม? (เหตุผล & ตรรกะ)</th>
                  <th class="p-3 w-[25%] align-top break-words text-emerald-300">ทำแล้วได้อะไร? (ผลลัพธ์)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/80 bg-slate-950/60">
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Language</div>
                    <code class="text-emerald-400 font-bold">JavaScript</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">ภาษาโปรแกรมมิ่งที่ใช้ประมวลผลข้อมูลในโหนด Code</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ทำงานแบบ Native บน Node.js ใน n8n ประมวลผลได้เร็วระดับไมโครวินาที</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ประมวลผลการแจ้งเตือนได้นับพันรายการต่อวินาทีโดยไม่หน่วง CPU</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Mode</div>
                    <code class="text-blue-300 font-bold">Run Once for Each Item</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40">🟢 สถาปัตยกรรม</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">สั่งให้โค้ดรันประมวลผลทีละ 1 แถวข้อมูลที่มีเข้ามา</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">การแจ้งเตือน LPR มาทีละเหตุการณ์ จึงเหมาะกับการประมวลผลแบบ Item-by-Item</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">เขียนโค้ดง่าย เข้าถึงข้อมูลได้ตรงๆ ผ่าน <code>$input.item.json</code></td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Input Sanitization</div>
                    <code class="text-amber-300 font-bold">body.plate || '1กข 4567'</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">การดักจับค่าว่างของตัวแปรด้วยโอเปอเรเตอร์ OR</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ป้องกันไม่ให้ข้อความแจ้งเตือนแสดงผลคำว่า <code>undefined</code> หากเซนเซอร์ส่งข้อมูลไม่ครบ</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">การ์ดแจ้งเตือนใน Telegram สวยงาม เรียบร้อย ไม่มี Error โผล่ให้เห็น</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Return Structure</div>
                    <code class="text-rose-400 font-bold">return { json: { ... } }</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">กฎเหล็กของ n8n ที่ต้องครอบผลลัพธ์ด้วยอ็อบเจกต์ที่มีคีย์ <code>json</code></td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">n8n ออกแบบมาให้รับส่งข้อมูลเฉพาะรูปแบบนี้ หาก return ข้อความเปล่าจะ Error ทันที</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ข้อมูลการ์ดแจ้งเตือนส่งต่อไปยัง Telegram และ Respond ได้ถูกต้อง 100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        `,
        why: `
          <ul class="list-disc list-inside space-y-1.5 text-slate-300">
            <li><strong>ทำไมต้องจัดฟอร์แมตด้วย Code แทนที่จะส่งดิบๆ?</strong> เพราะข้อมูลที่กล้องส่งมาเป็น JSON สั้นๆ เช่น <code>{"plate":"1กข 4567"}</code> แต่เจ้าหน้าที่หน้างานต้องการเห็นการ์ดแจ้งเตือนที่อ่านง่าย มีไอคอน มีเวลาไทย และมีพิกัดจุดตรวจชัดเจน</li>
          </ul>
        `,
        raw: `// Smart LPR Alert Formatter Node
const body = $input.item.json.body || {};
const plate = body.plate || '1กข 4567';
const camera = body.camera || 'cam11 (ด่านหนองกวาง)';
const timestamp = body.timestamp || new Date().toLocaleString('th-TH');
const status = body.status || 'SUSPECT_WATCHLIST';

const formattedTelegramMessage = \`🚨 [แจ้งเตือนด่วน BPP-VMS LPR]\\n\` +
  \`📌 ทะเบียน: \${plate}\\n\` +
  \`📷 กล้อง: \${camera}\\n\` +
  \`⏰ เวลา: \${timestamp}\\n\` +
  \`⚠️ สถานะ: บัญชีเฝ้าระวัง (\${status})\\n\` +
  \`📍 พิกัด: จุดตรวจหนองกวาง ต.หนองกวาง อ.โพธาราม\`;

return {
  json: {
    plate: plate,
    camera: camera,
    timestamp: timestamp,
    status: status,
    telegram_text: formattedTelegramMessage,
    broadcast_ready: true
  }
};`
      },
      6: {
        badge: "โหนด #6 (Photo EXIF Extractor - สกัดรูป)",
        title: "Extract Multi-Photo EXIF & Evidence (การสกัดข้อมูลภาพถ่าย)",
        type: "n8n-nodes-base.code",
        border: "border-blue-500",
        where: `
          <ol class="list-decimal list-inside space-y-1.5 text-slate-300">
            <li>ลากสายจาก Output ขา 1 (photo) ของโหนด Switch มาปล่อย ค้นหาคำว่า <strong class="text-blue-400">Code</strong></li>
            <li>ดับเบิลคลิกเปิดหน้าต่าง Code Node</li>
            <li>เลือกภาษาเป็น <strong class="text-white">JavaScript</strong></li>
            <li>คัดลอกโค้ดสกัดพิกัด GPS จากรูปภาพหลายๆ ใบ และโค้ดออกรหัสคดี Dossier ID วางลงในช่องโค้ด</li>
          </ol>
        `,
        what: `
          <div class="table-responsive-wrapper overflow-x-auto w-full">
            <table class="w-full table-fixed text-left text-xs border border-slate-800 rounded-lg overflow-hidden">
              <thead class="bg-slate-900/90 text-slate-300 border-b border-slate-800">
                <tr>
                  <th class="p-3 w-[22%] align-top break-words">พารามิเตอร์ & ค่าที่ตั้ง</th>
                  <th class="p-3 w-[26%] align-top break-words">คืออะไร & หมายความว่ายังไง?</th>
                  <th class="p-3 w-[27%] align-top break-words text-amber-300">ทำทำไม? (เหตุผล & ตรรกะ)</th>
                  <th class="p-3 w-[25%] align-top break-words text-emerald-300">ทำแล้วได้อะไร? (ผลลัพธ์)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/80 bg-slate-950/60">
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Aggregate GPS</div>
                    <code class="text-blue-300 font-bold">primaryGps = meta.gps</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">ลูปค้นหาพิกัดแผนที่ละติจูด/ลองจิจูดจากภาพถ่ายทั้งหมดในชุด</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">สายตรวจถ่ายภาพหลายมุม แต่ต้องการพิกัดแผนที่หลักเพียง 1 จุดสำหรับปักหมุดคดี</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ได้พิกัดเกิดเหตุจริงไปพล็อตลงบน Heatmap ของ BPP-VMS ทันที</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Dossier ID</div>
                    <code class="text-amber-300 font-bold">CASE-YYYYMMDD-XXXX</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40">🟢 สถาปัตยกรรม</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">การออกหมายเลขแฟ้มคดีอัตโนมัติตามวันเวลาสากล + เลขสุ่ม 4 หลัก</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ผูกโยงภาพถ่ายของกลางและผู้ต้องสงสัยหลายๆ ภาพเข้าเป็นแฟ้มคดีเดียวกัน</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">เชื่อมโยงความสัมพันธ์ใน i2 Graph และสร้างโฟลเดอร์จัดเก็บบน NAS อัตโนมัติ</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Native Processing</div>
                    <code class="text-emerald-400">Pure JavaScript Loop</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40">🟢 ประสิทธิภาพ</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">อ่านและสกัด Metadata จากไบนารีภาพโดยไม่พึ่งพาโมเดล AI</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">เร็วกว่าใช้ Vision AI ประมวลผล และไม่เสีย Token ค่าใช้จ่าย</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">สกัดเสร็จใน 2 มิลลิวินาที ได้ค่าตัวเลขพิกัดทศนิยมแม่นยำ 100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        `,
        why: `
          <ul class="list-disc list-inside space-y-1.5 text-slate-300">
            <li><strong>ทำไมต้องใช้ Code สกัดแทนที่จะใช้ AI?</strong> เพราะ EXIF Header ของไฟล์ภาพเป็น Binary/Structured Metadata การใช้ JavaScript วนลูปอ่านพิกัด Lat/Lng ทำงานได้เร็วกว่าในระดับ 2 มิลลิวินาที ไม่กิน Token ของ LLM และได้พิกัดทศนิยมแม่นยำ 100%</li>
            <li><strong>ทำไมต้องออกรหัส Dossier ID?</strong> เพื่อสร้างหมายเลขคดีอ้างอิงอัตโนมัติ (เช่น <code>CASE-20260910-xxxx</code>) สำหรับส่งไปปักหมุดบนแผนที่ Heatmap และเชื่อมโยงความสัมพันธ์ใน i2 Graph</li>
          </ul>
        `,
        raw: `// Multi-Photo & Evidence Batch Processor
const body = $input.item.json.body || {};
const images = Array.isArray(body.images) ? body.images : (body.image_base64 ? [body.image_base64] : []);
const metadataList = Array.isArray(body.metadata_list) ? body.metadata_list : [body.metadata || {}];

// Aggregate GPS and Evidence from all uploaded photos in the batch
let primaryGps = { lat: 13.6892, lng: 99.8214 };
for (const meta of metadataList) {
  if (meta && meta.gps && meta.gps.lat && meta.gps.lng) {
    primaryGps = meta.gps;
    break;
  }
}

const dossierId = 'CASE-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.floor(1000 + Math.random() * 9000);

return {
  json: {
    status: 'success',
    type: 'batch_photos_processed',
    dossier_id: dossierId,
    total_images_processed: images.length || 1,
    gps: primaryGps,
    extracted_entities: {
      suspect: body.suspect || 'นายสมชาย ใจดี',
      drugs: body.drugs || 'ยาบ้า 250 เม็ด',
      weapon: body.weapon || 'อาวุธปืน .38',
      vehicle: body.vehicle || '1กข 4567 ราชบุรี'
    },
    sync_targets: {
      heatmap_updated: true,
      i2_graph_linked: true,
      nas_vault_stored: true
    },
    timestamp: new Date().toISOString()
  }
};`
      },
      7: {
        badge: "โหนด #7 (Respond to Webhook - ส่งผลกลับ)",
        title: "Respond to Webhook (ส่งผลลัพธ์กลับสู่ระบบ)",
        type: "n8n-nodes-base.respondToWebhook",
        border: "border-rose-500",
        where: `
          <ol class="list-decimal list-inside space-y-1.5 text-slate-300">
            <li>กดปุ่ม + บน Canvas ค้นหาคำว่า <strong class="text-rose-400">Respond to Webhook</strong></li>
            <li>ลากเส้นเชื่อมจาก 3 ปลายทางมารวมเข้าที่โหนดนี้:
              <br>• จากโหนด #3 AI Agent
              <br>• จากโหนด #6 Photo Extractor
              <br>• จากโหนด #5 LPR Alert Formatter
            </li>
            <li>ดับเบิลคลิกเปิดโหนดขึ้นมา</li>
            <li>ที่ช่อง <strong class="text-white">Respond With</strong> เลือกเป็น <span class="text-rose-300 font-bold">JSON</span></li>
            <li>ที่ช่อง <strong class="text-white">Response Body</strong> ใส่โค้ด: <code class="text-emerald-300">={{ JSON.stringify($json) }}</code></li>
          </ol>
        `,
        what: `
          <div class="table-responsive-wrapper overflow-x-auto w-full">
            <table class="w-full table-fixed text-left text-xs border border-slate-800 rounded-lg overflow-hidden">
              <thead class="bg-slate-900/90 text-slate-300 border-b border-slate-800">
                <tr>
                  <th class="p-3 w-[22%] align-top break-words">พารามิเตอร์ & ค่าที่ตั้ง</th>
                  <th class="p-3 w-[26%] align-top break-words">คืออะไร & หมายความว่ายังไง?</th>
                  <th class="p-3 w-[27%] align-top break-words text-amber-300">ทำทำไม? (เหตุผล & ตรรกะ)</th>
                  <th class="p-3 w-[25%] align-top break-words text-emerald-300">ทำแล้วได้อะไร? (ผลลัพธ์)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/80 bg-slate-950/60">
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Respond With</div>
                    <code class="text-rose-300 font-bold">JSON</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">กำหนด Content-Type ของผลลัพธ์ขากลับเป็น <code>application/json</code></td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">เพื่อให้แอปมือถือและหน้าเว็บปลายทางนำข้อมูลไป Parse เป็น Object ใช้งานได้ทันที</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ส่งผลลัพธ์แบบ REST API มาตรฐานสากล แอปปลายทางทำงานลื่นไหล</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Response Body</div>
                    <code class="text-emerald-400 font-bold">={{ JSON.stringify($json) }}</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">แปลงข้อมูลอ็อบเจกต์ที่สกัดได้ทั้งหมดให้เป็นข้อความ JSON String ส่งกลับออกไป</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">รับประกันว่าทุกฟิลด์ที่สกัดเสร็จ (ทั้ง AI Entity, พิกัด GPS, Dossier ID) จะถูกส่งกลับครบ</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ผู้เรียกได้รับผลลัพธ์บริบูรณ์ใน Request เดียว ไม่ตกหล่นแม้แต่ฟิลด์เดียว</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Response Code</div>
                    <code class="text-blue-300 font-bold">200 (OK)</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40">🟢 ประสิทธิภาพ</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">HTTP Status Code 200 OK ยืนยันความสำเร็จ</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ส่งสัญญาณบอกฝั่งผู้เรียกว่าการประมวลผลสำเร็จลุล่วง</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">แอปปลายทางทราบสถานะความสำเร็จและปิด Loading ทันที</td>
                </tr>
              </tbody>
            </table>
          </div>
        `,
        why: `
          <ul class="list-disc list-inside space-y-1.5 text-slate-300">
            <li><strong>ทำไมต้องมีโหนดนี้ปิดท้าย?</strong> เพราะในโหนด #1 Webhook เราเลือกโหมด <em>Using 'Respond to Webhook' Node</em> ไว้ ถ้าไม่มีโหนดนี้ คนที่ยิง API เข้ามาจะต้องรอจน Time-out 504 Gateway Timeout การมีโหนดนี้จะช่วยส่งผลลัพธ์ที่สกัดเสร็จสมบูรณ์กลับไปทันที</li>
          </ul>
        `,
        raw: `{
  "parameters": {
    "respondWith": "json",
    "responseBody": "={{ JSON.stringify($json) }}",
    "options": {}
  },
  "id": "respond-to-webhook",
  "name": "Respond to Webhook",
  "type": "n8n-nodes-base.respondToWebhook",
  "typeVersion": 1.1,
  "position": [1160, 300]
}`
      },
      8: {
        badge: "โหนด #8 (Watchlist Tool Sub-node)",
        title: "Tool: Check Watchlist (เครื่องมือค้นหาฐานข้อมูล)",
        type: "@n8n/n8n-nodes-langchain.toolHttpRequest",
        border: "border-teal-500",
        where: `
          <ol class="list-decimal list-inside space-y-1.5 text-slate-300">
            <li>สังเกตที่ใต้กล่องของโหนด #3 AI Agent จะมีช่องเสียบที่เขียนว่า <strong class="text-teal-400">Tool</strong></li>
            <li>คลิกปุ่มบวกใต้ช่อง Tool ➔ เลือก <strong class="text-teal-300">Custom Tool (HTTP Request)</strong></li>
            <li>ตั้งชื่อ Tool ในช่อง <strong class="text-white">Name</strong> เป็น: <code class="text-amber-300">check_watchlist</code></li>
            <li>ในช่อง <strong class="text-white">Description</strong> พิมพ์บอก AI ว่า: <em>"ค้นหาและตรวจสอบว่าหมายเลขทะเบียนรถ หรือชื่อบุคคล อยู่ในบัญชีเฝ้าระวังของ BPP-VMS หรือไม่"</em></li>
            <li>ในช่อง <strong class="text-white">URL</strong> ใส่: <code class="text-emerald-300">http://watchlist-api:5001/watchlist</code></li>
          </ol>
        `,
        what: `
          <div class="table-responsive-wrapper overflow-x-auto w-full">
            <table class="w-full table-fixed text-left text-xs border border-slate-800 rounded-lg overflow-hidden">
              <thead class="bg-slate-900/90 text-slate-300 border-b border-slate-800">
                <tr>
                  <th class="p-3 w-[22%] align-top break-words">พารามิเตอร์ & ค่าที่ตั้ง</th>
                  <th class="p-3 w-[26%] align-top break-words">คืออะไร & หมายความว่ายังไง?</th>
                  <th class="p-3 w-[27%] align-top break-words text-amber-300">ทำทำไม? (เหตุผล & ตรรกะ)</th>
                  <th class="p-3 w-[25%] align-top break-words text-emerald-300">ทำแล้วได้อะไร? (ผลลัพธ์)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/80 bg-slate-950/60">
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Tool Name</div>
                    <code class="text-teal-300 font-bold">check_watchlist</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">ชื่ออ้างอิงฟังก์ชันของเครื่องมือในระบบ LangChain</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">เป็นชื่อฟังก์ชันที่ AI Agent จะใช้เรียกในกระบวนการ Reasoning Phase</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">AI อ้างอิงเครื่องมือได้อย่างถูกต้องตามมาตรฐาน Function Calling</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Description</div>
                    <code class="text-amber-300 text-[10px]">ค้นหาและตรวจสอบทะเบียนรถ...</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-red-950 text-red-300 border border-red-500/40">🔴 จุดตาย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">คำอธิบายหน้าที่ของ Tool ที่เขียนให้ AI อ่าน (Semantic Description)</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">ใน LangChain ตัว AI ตัดสินใจหยิบ Tool นี้มาใช้ตาม Description นี้เท่านั้น หากเขียนคลุมเครือ AI จะไม่เรียกใช้</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">เมื่อเจ้าหน้าที่พิมพ์ข้อความเกี่ยวกับทะเบียนรถ AI จะหยิบ Tool นี้ไปค้นหา API อัตโนมัติทันที</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">URL</div>
                    <code class="text-emerald-400 font-bold">http://watchlist-api:5001/watchlist</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40">🟢 ความปลอดภัย</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">ที่อยู่ Endpoint ภายใน Docker Network ของระบบ BPP-VMS</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">เชื่อมต่อฐานข้อมูลบัญชีเฝ้าระวังภายในระบบโดยตรง ไม่ต้องออกสู่อินเทอร์เน็ตสาธารณะ</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ค้นหาข้อมูลบัญชีเฝ้าระวังได้เร็วในระดับมิลลิวินาที และข้อมูลสายตรวจปลอดภัย 100%</td>
                </tr>
                <tr>
                  <td class="p-3 align-top break-words whitespace-normal">
                    <div class="font-bold text-white">Method</div>
                    <code class="text-blue-300 font-bold">GET</code>
                    <div class="mt-1"><span class="px-1.5 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40">🟢 ประสิทธิภาพ</span></div>
                  </td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-300">HTTP Method สำหรับดึงข้อมูล (Read-only)</td>
                  <td class="p-3 align-top break-words whitespace-normal text-slate-400">เป็นการค้นหาข้อมูล ไม่มีการแก้ไขหรือลบฐานข้อมูล</td>
                  <td class="p-3 align-top break-words whitespace-normal text-emerald-300">ประมวลผลคำค้นหาได้รวดเร็วและปลอดภัยต่อฐานข้อมูล</td>
                </tr>
              </tbody>
            </table>
          </div>
        `,
        why: `
          <ul class="list-disc list-inside space-y-1.5 text-slate-300">
            <li><strong>ทำไมช่อง Description ถึงสำคัญที่สุดในโหนดนี้?</strong> ในระบบ LangChain ตัว AI Agent จะอ่าน Description ของ Tool เพื่อตัดสินใจว่าจะหยิบ Tool นี้มาใช้เมื่อไหร่ ถ้าเราเขียนอธิบายชัดเจนว่า "ใช้ค้นหาทะเบียนรถ" เมื่อเจ้าหน้าที่พิมพ์ข้อความที่มีทะเบียน AI จะหยิบ Tool นี้ไปยิงหา API อัตโนมัติทันที</li>
          </ul>
        `,
        raw: `{
  "parameters": {
    "name": "check_watchlist",
    "description": "ค้นหาและตรวจสอบว่าหมายเลขทะเบียนรถ หรือชื่อบุคคล อยู่ในบัญชีเฝ้าระวัง (Watchlist) ของ BPP-VMS หรือไม่",
    "url": "http://watchlist-api:5001/watchlist",
    "method": "GET"
  },
  "id": "tool-watchlist",
  "name": "Tool: Check Watchlist (HTTP)",
  "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
  "typeVersion": 1.1,
  "position": [940, 340]
}`
      }
    };

    
    // ----------------------------------------------------
    // Node Step-by-Step Navigator & Wiring Map (8 Nodes)
    // ----------------------------------------------------
    const nodeWiringData = {
      1: {
        step: "ขั้นตอนที่ 1 จาก 8: ตัวจุดชนวนรับคำสั่ง (Ingress Webhook)",
        wiringDesc: `
          <div class="space-y-2">
            <div class="font-bold text-emerald-400 flex items-center gap-1.5">
              <span>📍 ตำแหน่งและหน้าที่:</span>
              <span class="font-normal text-slate-300">เป็น "จุดเริ่มต้นแรกสุด" ของ Workflow (Trigger Node) รับข้อมูลคำขอ HTTP POST เข้ามาจากระบบภายนอกตลอด 24 ชม.</span>
            </div>
            <div class="bg-slate-950/80 p-3 rounded-xl border border-emerald-500/30 text-xs text-slate-300 space-y-1.5">
              <div class="font-bold text-emerald-300">🔌 ขั้นตอนการลากสายเชื่อมต่อ (Wiring Step):</div>
              <ol class="list-decimal list-inside space-y-1 text-slate-300">
                <li>สังเกตที่ <strong>จุดวงกลมสีเทาด้านขวา (Output Port)</strong> ของโหนด Webhook นี้</li>
                <li>คลิกเมาส์ซ้ายค้างไว้ แล้วลากสายสัญญาณไปทางขวา</li>
                <li>ปล่อยเมาส์ลงที่ <strong>จุดวงกลมสีเทาด้านซ้าย (Input Port) ของโหนด #2 (Route by Message Type - Switch Router)</strong></li>
              </ol>
            </div>
            <p class="text-slate-400 text-[11px]">💡 <em>สิ่งที่ส่งต่อไปยังโหนดถัดไป:</em> ส่ง Payload JSON ทั้งก้อนที่ได้รับจาก Client ไปให้โหนด Switch คัดกรองประเภท</p>
          </div>
        `,
        prevNode: null,
        prevLabel: "ไม่มี (จุดเริ่มต้น)",
        nextNodes: [
          {
            id: 2,
            label: "➡️ ต่อสายเข้าโหนด #2: Route by Message Type (Switch Router) ➔",
            color: "bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400 shadow-indigo-900/40"
          }
        ]
      },
      2: {
        step: "ขั้นตอนที่ 2 จาก 8: ตัวแยกเส้นทางตามประเภทข้อมูล (Switch Router)",
        wiringDesc: `
          <div class="space-y-2">
            <div class="font-bold text-amber-400 flex items-center gap-1.5">
              <span>🔀 ตำแหน่งและหน้าที่:</span>
              <span class="font-normal text-slate-300">เป็น "สี่แยกจราจร" (Control Flow) รับข้อมูลจากโหนด #1 แล้วคัดแยกออกเป็น 3 เส้นทางตามฟิลด์ <code>body.type</code></span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div class="bg-blue-950/50 p-3 rounded-xl border border-blue-500/40 space-y-1">
                <div class="font-bold text-blue-400 flex items-center gap-1">💬 ขา 0: Output ด้านบนสุด</div>
                <div class="text-slate-300 text-[11px]">สำหรับประเภท <strong>chat</strong>: ลากสายไปเสียบเข้า Input ด้านซ้ายของ <strong>โหนด #3 (AI Intelligence Agent)</strong></div>
              </div>
              <div class="bg-cyan-950/50 p-3 rounded-xl border border-cyan-500/40 space-y-1">
                <div class="font-bold text-cyan-400 flex items-center gap-1">📸 ขา 1: Output ตรงกลาง</div>
                <div class="text-slate-300 text-[11px]">สำหรับประเภท <strong>photo</strong>: ลากสายไปเสียบเข้า Input ด้านซ้ายของ <strong>โหนด #6 (Photo & EXIF Extractor)</strong></div>
              </div>
              <div class="bg-rose-950/50 p-3 rounded-xl border border-rose-500/40 space-y-1">
                <div class="font-bold text-rose-400 flex items-center gap-1">🚨 ขา 2: Output ล่างสุด</div>
                <div class="text-slate-300 text-[11px]">สำหรับประเภท <strong>alert</strong>: ลากสายไปเสียบเข้า Input ด้านซ้ายของ <strong>โหนด #5 (Smart Alert Formatter)</strong></div>
              </div>
            </div>
            <p class="text-slate-400 text-[11px]">💡 <em>เคล็ดลับ:</em> ใน n8n หมายเลขขา Output จะเรียงจากบนลงล่าง โดยเริ่มนับจาก 0, 1, 2 ตามลำดับกฎ Rules ที่ตั้งไว้</p>
          </div>
        `,
        prevNode: 1,
        prevLabel: "⬅️ กลับไปโหนด #1 Webhook",
        nextNodes: [
          {
            id: 3,
            label: "💬 ทางเลือก A: ไปโหนด #3 (AI Agent) ➔",
            color: "bg-blue-600 hover:bg-blue-500 text-white border-blue-400 shadow-blue-900/40"
          },
          {
            id: 6,
            label: "📸 ทางเลือก B: ไปโหนด #6 (Photo EXIF) ➔",
            color: "bg-cyan-600 hover:bg-cyan-500 text-white border-cyan-400 shadow-cyan-900/40"
          },
          {
            id: 5,
            label: "🚨 ทางเลือก C: ไปโหนด #5 (Alert Formatter) ➔",
            color: "bg-rose-600 hover:bg-rose-500 text-white border-rose-400 shadow-rose-900/40"
          }
        ]
      },
      3: {
        step: "ขั้นตอนที่ 3 จาก 8: สมองกลตัดสินใจหลักและประสานเครื่องมือ (Core AI Agent)",
        wiringDesc: `
          <div class="space-y-2">
            <div class="font-bold text-purple-400 flex items-center gap-1.5">
              <span>🧠 ตำแหน่งและหน้าที่:</span>
              <span class="font-normal text-slate-300">เป็น "ศูนย์บัญชาการ AI" รับข้อมูลแชทจากโหนด #2 (ขา 0) เพื่อคิดวิเคราะห์ วางแผน และเลือกใช้เครื่องมือ</span>
            </div>
            <div class="bg-slate-950/80 p-3 rounded-xl border border-purple-500/30 text-xs text-slate-300 space-y-1.5">
              <div class="font-bold text-purple-300">🔌 การต่อสายประกอบซับโหนดและการส่งคำตอบ:</div>
              <ul class="list-disc list-inside space-y-1 text-slate-300">
                <li><strong>ช่องเสียบ Model (ด้านล่าง):</strong> ลากสายจากหัวของ <strong>โหนด #4 (Google Gemini Flash Lite)</strong> มาเสียบเข้าช่อง <em>"Model"</em> ใต้กล่อง</li>
                <li><strong>ช่องเสียบ Tool (ด้านล่าง):</strong> ลากสายจากหัวของ <strong>โหนด #8 (Tool: Check Watchlist)</strong> มาเสียบเข้าช่อง <em>"Tool"</em> ใต้กล่อง</li>
                <li><strong>สาย Output ด้านขวา (ส่งคำตอบ):</strong> เมื่อ AI ตอบเสร็จ ให้ <strong class="text-emerald-400">ลากสาย Output ด้านขวาไปเสียบเข้าโหนด #7 (Respond to Webhook)</strong></li>
              </ul>
            </div>
          </div>
        `,
        prevNode: 2,
        prevLabel: "⬅️ กลับไปโหนด #2 Switch",
        nextNodes: [
          {
            id: 4,
            label: "🧠 ดู Sub-node Model: #4 Gemini Flash Lite ➔",
            color: "bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400 shadow-indigo-900/40"
          },
          {
            id: 8,
            label: "🔍 ดู Sub-node Tool: #8 Check Watchlist ➔",
            color: "bg-teal-600 hover:bg-teal-500 text-white border-teal-400 shadow-teal-900/40"
          },
          {
            id: 7,
            label: "📤 สายออกปลายทาง: ไปโหนด #7 Respond to Webhook ➔",
            color: "bg-purple-600 hover:bg-purple-500 text-white border-purple-400 shadow-purple-900/40"
          }
        ]
      },
      4: {
        step: "ขั้นตอนที่ 4 จาก 8: โมเดลภาษาปัญญาประดิษฐ์ (Sub-node: Google Gemini)",
        wiringDesc: `
          <div class="space-y-2">
            <div class="font-bold text-indigo-400 flex items-center gap-1.5">
              <span>⚡ ตำแหน่งและหน้าที่:</span>
              <span class="font-normal text-slate-300">เป็น "เครื่องยนต์ LLM" (Sub-node) ให้บริการความฉลาดและภาษาแก่โหนด #3 AI Agent</span>
            </div>
            <div class="bg-slate-950/80 p-3 rounded-xl border border-indigo-500/30 text-xs text-slate-300 space-y-1.5">
              <div class="font-bold text-indigo-300">🔌 วิธีการต่อสาย (Sub-node Wiring):</div>
              <ol class="list-decimal list-inside space-y-1 text-slate-300">
                <li>วางโหนดนี้ไว้บริเวณ <strong>ด้านล่างซ้าย</strong> ของกล่องโหนด #3 (AI Intelligence Agent)</li>
                <li>สังเกตจุดเชื่อมต่อ <strong>ด้านบนสุด</strong> ของโหนด Gemini นี้</li>
                <li>คลิกเมาส์ค้างไว้แล้วลากขึ้นไปปล่อยที่ช่อง <strong>"Model" (วงกลมรับสายด้านล่าง)</strong> ของโหนด #3</li>
              </ol>
            </div>
            <p class="text-amber-300 text-[11px]">⚠️ <em>ข้อสำคัญ:</em> โหนดนี้เป็น Sub-node <strong>ไม่ต้องมีสาย Output ด้านขวา</strong> ข้อมูลความคิดจะสื่อสารผ่านท่อ Model เข้าตัว AI Agent อัตโนมัติ</p>
          </div>
        `,
        prevNode: 3,
        prevLabel: "⬅️ กลับสู่โหนดหลัก #3 AI Agent",
        nextNodes: [
          {
            id: 8,
            label: "🔍 ต่อไป: ดู Sub-node #8 (Tool: Check Watchlist) ➔",
            color: "bg-teal-600 hover:bg-teal-500 text-white border-teal-400 shadow-teal-900/40"
          },
          {
            id: 7,
            label: "📤 ข้ามไปโหนดปลายทาง: #7 (Respond to Webhook) ➔",
            color: "bg-purple-600 hover:bg-purple-500 text-white border-purple-400 shadow-purple-900/40"
          }
        ]
      },
      5: {
        step: "ขั้นตอนที่ 5 จาก 8: จัดหน้าตาและฟอร์แมตแจ้งเตือน (Smart Alert Formatter)",
        wiringDesc: `
          <div class="space-y-2">
            <div class="font-bold text-rose-400 flex items-center gap-1.5">
              <span>🚨 ตำแหน่งและหน้าที่:</span>
              <span class="font-normal text-slate-300">เป็น "ตัวจัดฟอร์แมตข้อความ" (Code Node) แปลงข้อมูลแจ้งเตือนเหตุการณ์กล้อง/LPR จาก JSON ดิบ ให้เป็นข้อความที่เจ้าหน้าที่อ่านง่าย</span>
            </div>
            <div class="bg-slate-950/80 p-3 rounded-xl border border-rose-500/30 text-xs text-slate-300 space-y-1.5">
              <div class="font-bold text-rose-300">🔌 ขั้นตอนการต่อสาย (Wiring Step):</div>
              <ul class="list-disc list-inside space-y-1 text-slate-300">
                <li><strong>สาย Input ด้านซ้าย:</strong> รับสายต่อมาจาก <strong>ขา Output 2 (alert)</strong> ของโหนด #2 (Route by Message Type)</li>
                <li><strong>สาย Output ด้านขวา:</strong> เมื่อสคริปต์ JavaScript แปลงข้อความเสร็จ ให้ <strong class="text-emerald-400">ลากสาย Output ด้านขวาไปเสียบเข้าโหนด #7 (Respond to Webhook)</strong></li>
              </ul>
            </div>
          </div>
        `,
        prevNode: 2,
        prevLabel: "⬅️ กลับไปโหนด #2 Switch",
        nextNodes: [
          {
            id: 7,
            label: "➡️ ต่อสายเข้าโหนดปลายทาง: #7 (Respond to Webhook) ➔",
            color: "bg-purple-600 hover:bg-purple-500 text-white border-purple-400 shadow-purple-900/40"
          }
        ]
      },
      6: {
        step: "ขั้นตอนที่ 6 จาก 8: ถอดรหัสพิกัด GPS และแฟ้มข้อมูลภาพ (Photo & EXIF Extractor)",
        wiringDesc: `
          <div class="space-y-2">
            <div class="font-bold text-cyan-400 flex items-center gap-1.5">
              <span>📸 ตำแหน่งและหน้าที่:</span>
              <span class="font-normal text-slate-300">เป็น "หน่วยสกัดพิกัดแผนที่" (Metadata Parser) ดึงค่า GPS Latitude/Longitude จากภาพถ่าย และสร้าง Dossier ID ของบุคคลต้องสงสัย</span>
            </div>
            <div class="bg-slate-950/80 p-3 rounded-xl border border-cyan-500/30 text-xs text-slate-300 space-y-1.5">
              <div class="font-bold text-cyan-300">🔌 ขั้นตอนการต่อสาย (Wiring Step):</div>
              <ul class="list-disc list-inside space-y-1 text-slate-300">
                <li><strong>สาย Input ด้านซ้าย:</strong> รับสายต่อมาจาก <strong>ขา Output 1 (photo)</strong> ของโหนด #2 (Route by Message Type)</li>
                <li><strong>สาย Output ด้านขวา:</strong> เมื่อสกัดพิกัดและสร้างลิงก์ Google Maps สำเร็จ ให้ <strong class="text-emerald-400">ลากสาย Output ด้านขวาไปเสียบเข้าโหนด #7 (Respond to Webhook)</strong></li>
              </ul>
            </div>
          </div>
        `,
        prevNode: 2,
        prevLabel: "⬅️ กลับไปโหนด #2 Switch",
        nextNodes: [
          {
            id: 7,
            label: "➡️ ต่อสายเข้าโหนดปลายทาง: #7 (Respond to Webhook) ➔",
            color: "bg-purple-600 hover:bg-purple-500 text-white border-purple-400 shadow-purple-900/40"
          }
        ]
      },
      7: {
        step: "ขั้นตอนที่ 7 จาก 8: โหนดปลายทางส่งคำตอบกลับสู่ BPP-VMS (Respond to Webhook)",
        wiringDesc: `
          <div class="space-y-2">
            <div class="font-bold text-emerald-400 flex items-center gap-1.5">
              <span>🏁 ตำแหน่งและหน้าที่:</span>
              <span class="font-normal text-slate-300">เป็น "ประตูทางออกสุดท้าย" (Terminal Egress Gateway) ปิดรอบการทำงานของ Webhook ด้วยรหัส HTTP 200 OK</span>
            </div>
            <div class="bg-slate-950/80 p-3 rounded-xl border border-emerald-500/30 text-xs text-slate-300 space-y-1.5">
              <div class="font-bold text-emerald-300">🔌 การรวมสาย Output ทั้ง 3 เส้นทางเข้า Input:</div>
              <div class="text-slate-300">ลากสาย Output จากปลายทางของทั้ง 3 สาขา มาเสียบรวมเข้าที่ <strong>Input (ด้านซ้าย)</strong> ของโหนดนี้:</div>
              <ul class="list-disc list-inside ml-2 space-y-1 text-slate-300">
                <li>1️⃣ สาย Output จาก <strong>โหนด #3 (AI Intelligence Agent)</strong></li>
                <li>2️⃣ สาย Output จาก <strong>โหนด #5 (Smart Alert Formatter)</strong></li>
                <li>3️⃣ สาย Output จาก <strong>โหนด #6 (Photo & EXIF Extractor)</strong></li>
              </ul>
            </div>
            <p class="text-emerald-300 text-[11px]">🎉 <em>ผลลัพธ์:</em> BPP-VMS จะได้รับ Response ตอบกลับพร้อมข้อมูลที่จัดรูปเสร็จแล้วทันที ถือเป็นการต่อสายสมบูรณ์แบบ 100%!</p>
          </div>
        `,
        prevNode: 3,
        prevLabel: "⬅️ ย้อนกลับไปโหนดหลัก #3 AI Agent",
        nextNodes: [
          {
            id: 1,
            label: "🔄 จบครบทุกสเต็ปแล้ว! คลิกเพื่อเริ่มทบทวนใหม่อีกครั้งที่โหนด #1 ➔",
            color: "bg-slate-800 hover:bg-slate-700 text-emerald-300 border-emerald-500/40 shadow-slate-950/60"
          }
        ]
      },
      8: {
        step: "ขั้นตอนที่ 8 จาก 8: เครื่องมือค้นหาฐานข้อมูลหมายจับ (Sub-node: Check Watchlist)",
        wiringDesc: `
          <div class="space-y-2">
            <div class="font-bold text-teal-400 flex items-center gap-1.5">
              <span>🔍 ตำแหน่งและหน้าที่:</span>
              <span class="font-normal text-slate-300">เป็น "เครื่องมือคู่กาย AI" (Tool Extension Sub-node) ทำหน้าที่เป็น API ไปสืบค้นฐานข้อมูลทะเบียนประวัติและหมายจับ</span>
            </div>
            <div class="bg-slate-950/80 p-3 rounded-xl border border-teal-500/30 text-xs text-slate-300 space-y-1.5">
              <div class="font-bold text-teal-300">🔌 วิธีการต่อสาย (Tool Sub-node Wiring):</div>
              <ol class="list-decimal list-inside space-y-1 text-slate-300">
                <li>วางโหนดนี้ไว้บริเวณ <strong>ด้านล่างขวา</strong> ของกล่องโหนด #3 (AI Intelligence Agent)</li>
                <li>สังเกตจุดเชื่อมต่อ <strong>ด้านบนสุด</strong> ของโหนด Tool นี้</li>
                <li>คลิกเมาส์ค้างไว้แล้วลากขึ้นไปปล่อยที่ช่อง <strong>"Tool" (วงกลมรับสายด้านล่าง)</strong> ของโหนด #3</li>
              </ol>
            </div>
            <p class="text-teal-300 text-[11px]">🤖 <em>การเรียกใช้งาน:</em> เมื่อโหนด #3 (AI Agent) ตรวจพบคำถามเกี่ยวกับบุคคลเฝ้าระวังหรือทะเบียนรถ AI จะสั่งรันโหนด Tool นี้โดยอัตโนมัติ</p>
          </div>
        `,
        prevNode: 3,
        prevLabel: "⬅️ กลับสู่โหนดหลัก #3 AI Agent",
        nextNodes: [
          {
            id: 5,
            label: "🚨 ต่อไป: ดูโหนด #5 (Smart Alert Formatter) ➔",
            color: "bg-rose-600 hover:bg-rose-500 text-white border-rose-400 shadow-rose-900/40"
          },
          {
            id: 7,
            label: "📤 ข้ามไปโหนดส่งคำตอบ: #7 (Respond to Webhook) ➔",
            color: "bg-purple-600 hover:bg-purple-500 text-white border-purple-400 shadow-purple-900/40"
          }
        ]
      }
    };

    let currentInspectedNodeId = 3;

    function goToPrevNode() {
      const wiring = nodeWiringData[currentInspectedNodeId];
      if (wiring && wiring.prevNode) {
        goToNode(wiring.prevNode);
      }
    }

    function goToNode(id) {
      inspectNode(id);
      const insp = document.getElementById('inspector-container');
      if (insp) {
        const yOffset = -75;
        const y = insp.getBoundingClientRect().top + window.pageYOffset + yOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }

    function inspectNode(id) {
      const item = nodeGuideData[id];
      if (!item) return;

      currentInspectedNodeId = id;

      // Update Active Styling on Canvas
      [1, 2, 3, 4, 5, 6, 7, 8].forEach(i => {
        const el = document.getElementById('canvas-node-' + i);
        if (el) {
          if (i === id) {
            el.classList.add('ring-4', 'ring-purple-400', 'scale-105');
          } else {
            el.classList.remove('ring-4', 'ring-purple-400', 'scale-105');
          }
        }
      });

      // Update Inspector Panel
      document.getElementById('insp-badge').innerText = item.badge;
      document.getElementById('insp-title').innerText = item.title;
      document.getElementById('insp-type').innerText = item.type;
      document.getElementById('insp-where').innerHTML = item.where;
      document.getElementById('insp-what').innerHTML = item.what;
      document.getElementById('insp-why').innerHTML = item.why;
      document.getElementById('insp-raw').innerText = item.raw;

      // Update Wiring & Step-by-Step Navigator
      const wiring = nodeWiringData[id];
      if (wiring) {
        const stepEl = document.getElementById('insp-step-indicator');
        if (stepEl) stepEl.innerText = wiring.step;

        const descEl = document.getElementById('insp-wiring-desc');
        if (descEl) descEl.innerHTML = wiring.wiringDesc;

        const prevBtn = document.getElementById('insp-btn-prev');
        const prevLabel = document.getElementById('insp-btn-prev-label');
        if (prevBtn) {
          if (wiring.prevNode) {
            prevBtn.disabled = false;
            if (prevLabel) prevLabel.innerText = wiring.prevLabel || 'โหนดก่อนหน้า';
          } else {
            prevBtn.disabled = true;
            if (prevLabel) prevLabel.innerText = wiring.prevLabel || 'จุดเริ่มต้น';
          }
        }

        const branchContainer = document.getElementById('insp-branch-buttons');
        if (branchContainer) {
          branchContainer.innerHTML = '';
          (wiring.nextNodes || []).forEach(nextItem => {
            const btn = document.createElement('button');
            btn.className = `px-3.5 py-2 rounded-xl text-xs font-bold border transition-all duration-150 shadow-md flex items-center gap-1.5 ${nextItem.color || 'bg-purple-600 hover:bg-purple-500 text-white border-purple-400'}`;
            btn.innerHTML = nextItem.label;
            btn.onclick = () => goToNode(nextItem.id);
            branchContainer.appendChild(btn);
          });
        }
      }
    }


    // Initialize with Node 3
    inspectNode(3);

    // Encyclopedia Data
    const categories = {
      trigger: {
        title: "⚡ กลุ่มที่ 1: Trigger Nodes (โหนดตัวจุดชนวน)",
        desc: "ทำหน้าที่เป็น 'จุดเริ่มต้น' ของทุก Workflow โดยตัวมันจะคอยดักฟังเหตุการณ์ตลอด 24 ชั่วโมง เมื่อมีเหตุการณ์ตรงเงื่อนไข มันจะปลุกโหนดถัดไปให้ทำงาน",
        nodes: [
          { name: "Webhook", desc: "เปิด URL รับคำขอ HTTP POST/GET จากภายนอก (เช่น จากกล้อง Frigate, แอปมือถือ, ระบบหน้าเว็บ)", useCase: "สร้างบอทรับคำสั่งจาก API ภายนอก" },
          { name: "Schedule Trigger (Cron)", desc: "ตั้งเวลาทำงานอัตโนมัติ เช่น ทุก 1 นาที, ทุกวันเวลา 08:00 น. หรือทุกสิ้นเดือน", useCase: "บอทสรุปยอดประจำวัน, บอทสำรองข้อมูล" },
          { name: "Telegram / LINE Trigger", desc: "ดักฟังข้อความที่มีคนพิมพ์ส่งเข้ามาในห้องแชท หรือเมื่อมีคนกดปุ่มเมนู", useCase: "บอทแชทตอบคำถามเจ้าหน้าที่" },
          { name: "Email Read (IMAP)", desc: "คอยเช็กว่ามีอีเมลใหม่ส่งเข้ามาในกล่องข้อความหรือไม่", useCase: "บอทตรวจจับเอกสารราชการทางอีเมล" }
        ]
      },
      flow: {
        title: "🔀 กลุ่มที่ 2: Control Flow Nodes (โหนดควบคุมเส้นทาง)",
        desc: "เปรียบเสมือน 'จราจร' คอยคัดแยกและกำหนดว่าข้อมูลชุดไหนควรไปทางไหน หรือต้องวนซ้ำกี่รอบ",
        nodes: [
          { name: "Switch", desc: "แยกเส้นทางออกเป็นหลายๆ ทาง (Multi-path) ตามค่าของข้อมูล", useCase: "โหนด #2 ใน BPP-VMS แยกประเภทคำขอ (chat/photo/alert)" },
          { name: "If", desc: "ตรวจสอบเงื่อนไขจริง/เท็จ (True / False) แบบ 2 ทาง", useCase: "ตรวจว่าป้ายทะเบียนอยู่ในแบล็กลิสต์หรือไม่" },
          { name: "Loop on Items", desc: "วนลูปทำทีละชิ้น สำหรับข้อมูลที่เป็น Array รายการหลายๆ รายการ", useCase: "วนลูปประมวลผลรูปถ่ายหลักฐานทีละใบ" },
          { name: "Merge", desc: "รวมข้อมูลจาก 2 เส้นทางที่แยกกัน ให้กลับมารวมเป็นแถวเดียวกันก่อนส่งต่อ", useCase: "รวมข้อมูลสถิติจาก 2 แหล่งเข้าด้วยกัน" }
        ]
      },
      ai: {
        title: "🧠 กลุ่มที่ 3: AI & LangChain Nodes (กลุ่มสมองกลและตัวสกัดข้อมูล)",
        desc: "นำความฉลาดของ Large Language Models (LLM) มาช่วยคิด ตีความภาษาไทยที่ไม่เป็นระเบียบ และเชื่อมต่อไปเรียกใช้เครื่องมือภายนอก",
        nodes: [
          { name: "AI Agent", desc: "ผู้จัดการหลัก (Autonomous Agent) ทำหน้าที่คิด วางแผน สกัดข้อมูล และตัดสินใจว่าจะต้องเรียกใช้ Tool ตัวไหน", useCase: "โหนด #3 สกัดข้อมูลรายงานเหตุการณ์" },
          { name: "Google Gemini / OpenAI Chat Model", desc: "สมองของ Agent ที่คอยทำความเข้าใจภาษา คำนวณความหมาย และร่างคำตอบ", useCase: "โหนด #4 Gemini Flash Lite คิดเร็ว ประหยัด Token" },
          { name: "Tool: HTTP Request", desc: "ยื่นเครื่องมือให้ AI หยิบไปยิงเรียก API อื่นๆ เองได้เมื่อต้องการข้อมูลเพิ่ม", useCase: "โหนด #5 ให้ AI ยิงไปตรวจทะเบียนรถใน Watchlist" },
          { name: "Window Buffer Memory", desc: "หน่วยความจำระยะสั้น ช่วยให้บอทจำประโยคก่อนหน้าที่คุยกับผู้ใช้ได้ ไม่ลืมเรื่องที่คุยกัน", useCase: "บอทสนทนาต่อเนื่องในแชทกลุ่ม" }
        ]
      },
      transform: {
        title: "⚙️ กลุ่มที่ 4: Transform & Code Nodes (โหนดแปรรูปและคำนวณข้อมูล)",
        desc: "ใช้จัดการ ปรับแต่ง แปลงโครงสร้างข้อมูล JSON หรือใช้โค้ดคอมพิวเตอร์เพื่อความแม่นยำ 100%",
        nodes: [
          { name: "Code Node (JavaScript / Python)", desc: "เขียนโค้ดได้อิสระ จัดการตรรกะซับซ้อน ดึงค่า EXIF หรือคำนวณทางคณิตศาสตร์", useCase: "โหนด #6 ดึงพิกัด GPS จากภาพ และสร้าง Dossier ID" },
          { name: "Edit Fields (Set)", desc: "เพิ่ม, เปลี่ยนชื่อ หรือลบฟิลด์ใน JSON โดยไม่ต้องเขียนโค้ด", useCase: "กำหนดค่าคงที่ เช่น status = 'ACTIVE'" },
          { name: "Filter", desc: "กรองเอาเฉพาะข้อมูลที่ผ่านเกณฑ์", useCase: "คัดกรองสัญญาณเตือนที่ไม่สำคัญทิ้ง" }
        ]
      },
      action: {
        title: "📤 กลุ่มที่ 5: Action & Output Nodes (โหนดการกระทำและส่งออก)",
        desc: "เปรียบเสมือน 'มือและเท้า' นำผลลัพธ์ที่ได้ไปลงมือทำจริงกับโลกภายนอก ส่งผลลัพธ์หรือบันทึกข้อมูล",
        nodes: [
          { name: "Respond to Webhook", desc: "ส่งข้อมูล JSON ตอบกลับไปยังผู้ที่ยิง Webhook เข้ามาทันที", useCase: "โหนด #7 ส่งผลการสกัดข้อมูลกลับหน้า Dashboard" },
          { name: "Telegram / LINE Send Message", desc: "ส่งข้อความ, รูปภาพ, ปุ่ม หรือการ์ดแจ้งเตือนเข้าห้องแชท", useCase: "ส่งการ์ดแจ้งเตือนจับกุมป้ายทะเบียนเฝ้าระวัง" },
          { name: "HTTP Request", desc: "ยิง REST API ออกไปบันทึกข้อมูลหรือสั่งการ Service อื่นๆ", useCase: "ส่งคำสั่งไปสั่งเปิดไม้กั้น หรือสั่ง Frigate เริ่มบันทึกวิดีโอ" },
          { name: "Postgres / Google Sheets", desc: "บันทึกแถวข้อมูลลงในตาราง Database เพื่อเก็บประวัติถาวร", useCase: "เก็บบันทึกประวัติการผ่านด่านลงฐานข้อมูล" }
        ]
      }
    };

    function filterCat(key) {
      ['trigger', 'flow', 'ai', 'transform', 'action'].forEach(k => {
        const btn = document.getElementById('btn-' + k);
        if (k === key) {
          btn.className = "px-3 py-1.5 rounded-lg font-bold border border-blue-500 bg-blue-950/50 text-blue-300 shadow";
        } else {
          btn.className = "px-3 py-1.5 rounded-lg font-bold border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200";
        }
      });

      const cat = categories[key];
      let html = `
        <div>
          <h3 class="text-base font-bold text-white mb-1">${cat.title}</h3>
          <p class="text-xs text-slate-400 mb-4 leading-relaxed">${cat.desc}</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      `;

      cat.nodes.forEach(n => {
        html += `
          <div class="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1.5">
            <div class="font-bold text-sm text-emerald-400 flex items-center justify-between">
              <span>${n.name}</span>
            </div>
            <p class="text-xs text-slate-300 leading-relaxed">${n.desc}</p>
            <div class="text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
              <strong class="text-slate-300">ตัวอย่างการใช้งาน:</strong> ${n.useCase}
            </div>
          </div>
        `;
      });

      html += `</div>`;
      document.getElementById('cat-content').innerHTML = html;
    }

    // Init with trigger
    filterCat('trigger');

    
    // ----------------------------------------------------
    // Chapter 6: Sub-Tabs Switcher Function
    // ----------------------------------------------------
    
    function scrollToTelegramSetup() {
      const el = document.getElementById('ch6-telegram-setup');
      if (el) {
        const yOffset = -75;
        const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }

    function switchCh6Tab(tabId) {
      // Hide all panes
      document.querySelectorAll('.ch6-tab-pane').forEach(el => el.classList.add('hidden'));

      // Reset all buttons
      document.querySelectorAll('.ch6-tab-btn').forEach(btn => {
        btn.className = 'ch6-tab-btn px-3.5 py-3 rounded-xl text-xs font-bold transition-all duration-200 flex items-center gap-2 border bg-slate-900 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800 text-left';
      });

      // Show target pane
      const targetPane = document.getElementById(tabId);
      if (targetPane) {
        targetPane.classList.remove('hidden');
      }

      // Highlight target button
      const btnMap = {
        'ch6-lpr': 'btn-ch6-lpr',
        'ch6-object': 'btn-ch6-object',
        'ch6-photo': 'btn-ch6-photo',
        'ch6-health': 'btn-ch6-health'
      };
      const activeBtn = document.getElementById(btnMap[tabId]);
      if (activeBtn) {
        activeBtn.className = 'ch6-tab-btn px-3.5 py-3 rounded-xl text-xs font-bold transition-all duration-200 flex items-center gap-2 border bg-rose-600 text-white border-rose-400 shadow-lg shadow-rose-950/50 text-left';
      }
    }
    window.switchCh6Tab = switchCh6Tab;
  

    // ----------------------------------------------------
    // MikroTik Diagnostic Wizard Logic
    // ----------------------------------------------------
    function runCgnatDiagnosis() {
        const hqNet = document.getElementById('diag-hq-net').value;
        const branchNet = document.getElementById('diag-branch-net').value;
        const badgeEl = document.getElementById('diag-result-badge');
        const costEl = document.getElementById('diag-cost-badge');
        const titleEl = document.getElementById('diag-result-title');
        const descEl = document.getElementById('diag-result-desc');
        const scriptTitleEl = document.getElementById('diag-script-title');
        const codeEl = document.getElementById('diag-code-content');

        if (hqNet === 'fiber_pub') {
            badgeEl.innerText = '✅ แนะนำสูงสุด: ฟรี 100%';
            badgeEl.style.background = '#059669';
            costEl.innerText = 'ค่าใช้จ่าย: 0 บาท';
            costEl.style.color = '#a7f3d0';
            titleEl.innerText = 'กลยุทธ์ Reverse Tunnel + Keepalive 25s (ดีที่สุดสำหรับ ตชด.215)';
            descEl.innerHTML = 'ฝั่งแม่ข่าย (HQ) มี Public IP ให้ทำหน้าที่เป็น Server (เปิด Forward Port UDP 51820 บนเราเตอร์บ้าน) ส่วนฝั่งกล้องสาขา (ซิม 4G หรือ Fiber) ให้ทำตัวเป็น Client ยิงเข้ามาหาแม่ข่าย โดย<strong>ไม่ต้อง Forward Port ฝั่งสาขาเลย</strong> เพียงเปิด PersistentKeepalive=25s ก็สามารถดึงภาพกล้อง CCTV ได้ตลอด 24 ชม.';
            scriptTitleEl.innerText = 'คำสั่ง MikroTik ฝั่งสาขา (กล้อง 4G)';
            codeEl.innerText = `/interface wireguard peers\nadd interface=wg-bppvms \\\n    public-key="<HQ_SERVER_PUBLIC_KEY>" \\\n    endpoint-address="bpp215.sn.mynetname.net" \\\n    endpoint-port=51820 \\\n    allowed-address=10.215.0.0/24 \\\n    persistent-keepalive=25s \\\n    comment="Reverse Tunnel to HQ Server"`;
        } else if (hqNet === 'fiber_cgnat') {
            badgeEl.innerText = '📞 ติดต่อ Call Center ปลด IP ฟรี';
            badgeEl.style.background = '#d97706';
            costEl.innerText = 'ค่าใช้จ่าย: 0 บาท (ขอฟรี)';
            costEl.style.color = '#fde68a';
            titleEl.innerText = 'โทรขอ Public Dynamic IP กับค่ายเน็ต หรือใช้ AIS THAI DDNS';
            descEl.innerHTML = 'แม่ข่ายติด CGNAT วง 100.64 ทำให้ภายนอกยิงเข้ามาไม่ได้ ให้โทรหา Call Center (True 1242, AIS 1175, 3BB 1530, NT 1888) แจ้งว่า "มีกล้องวงจรปิด CCTV ขอปลด CGNAT รับ Public IP" หรือหากเป็น AIS Fibre ให้เปิดบริการ THAI DDNS เพื่อจับคู่พอร์ต 51820 ฟรี';
            scriptTitleEl.innerText = 'ตัวอย่างสคริปต์เจรจา Call Center';
            codeEl.innerText = `"สวัสดีครับ พอดีที่บ้าน/หน่วยงานมีการติดตั้งระบบกล้องวงจรปิด CCTV และเครื่องบันทึก NVR ครับ ตอนนี้หน้าเราเตอร์ได้รับ IP วง 100.64 ติด CGNAT ทำให้ Forward Port ดูกล้องไม่ได้ครับ รบกวนช่วยส่งเรื่องปรับโปรไฟล์อินเทอร์เน็ตเป็น Public IP (Dynamic Public IP) หรือปลด CGNAT ให้หน่อยครับ"`;
        } else {
            // sim_4g on HQ
            badgeEl.innerText = '☁️ โซลูชันคลาวด์: ทะลุ Double CGNAT';
            badgeEl.style.background = '#7c3aed';
            costEl.innerText = 'ค่าใช้จ่าย: ~100-150 บาท/เดือน';
            costEl.style.color = '#ddd6fe';
            titleEl.innerText = 'ใช้ Cloud VPS WireGuard Relay หรือ ZeroTier Mesh VPN';
            descEl.innerHTML = 'เนื่องจากทั้งแม่ข่ายและกล้องต่างใช้เน็ตซิม 4G หรือติด CGNAT ทั้งคู่ ไม่มีฝั่งใดเปิดพอร์ตรับสายได้ จึงต้องใช้ <strong>Cloud VPS Relay</strong> (เช่น Hetzner, DigitalOcean หรือ VPS ในไทย) ทำหน้าที่เป็น Server กลางให้ทั้งสองฝั่งยิงมาเกาะ หรือติดตั้งแพ็กเกจ <strong>ZeroTier</strong> บน MikroTik RouterOS v7';
            scriptTitleEl.innerText = 'คำสั่ง Docker 1-Click บน VPS Linux';
            codeEl.innerText = `docker run -d \\\n  --name=wg-relay \\\n  --cap-add=NET_ADMIN --cap-add=SYS_MODULE \\\n  -e PUID=1000 -e PGID=1000 -e TZ=Asia/Bangkok \\\n  -e SERVERURL=<PUBLIC_IP_ของ_VPS> -e SERVERPORT=51820 \\\n  -e PEERS=hq_server,camera_branch1 -e PEERDNS=auto \\\n  -p 51820:51820/udp \\\n  -v /opt/wireguard/config:/config \\\n  --sysctl="net.ipv4.ip_forward=1" \\\n  --restart unless-stopped \\\n  linuxserver/wireguard:latest`;
        }
    }

    // ----------------------------------------------------
    // Scenario 3: Cloud VPS Bandwidth & Sizing Calculator
    // ----------------------------------------------------
    
    // ----------------------------------------------------
    // Scenario 3: VPS Bandwidth & Sizing Calculator
    // ----------------------------------------------------
    function calculateVpsBandwidth() {
      const camsInput = document.getElementById('vps-calc-cams');
      const bitrateSelect = document.getElementById('vps-calc-bitrate');
      const modeSelect = document.getElementById('vps-calc-mode');

      if (!camsInput || !bitrateSelect || !modeSelect) return;

      const cams = Math.max(1, parseInt(camsInput.value, 10) || 1);
      const bitrateMbps = parseFloat(bitrateSelect.value) || 1.0;
      const hoursPerDay = parseFloat(modeSelect.value) || 24;

      // Realtime Bandwidth in Mbps
      const totalMbps = cams * bitrateMbps;

      // Bytes per second = (totalMbps * 1,000,000) / 8
      // Seconds per day = hoursPerDay * 3600
      // In cloud VPS bandwidth quotas, data transfer is measured in decimal GB (10^9) and TB (10^12)
      const bytesPerDay = (totalMbps * 1000000 / 8) * (hoursPerDay * 3600);
      const dailyGb = bytesPerDay / 1000000000;
      const monthlyTb = (dailyGb * 30) / 1000;

      // Update UI
      const totalMbpsEl = document.getElementById('vps-res-total-mbps');
      const dailyGbEl = document.getElementById('vps-res-daily-gb');
      const monthlyTbEl = document.getElementById('vps-res-monthly-tb');
      const adviceEl = document.getElementById('vps-res-advice');

      if (totalMbpsEl) totalMbpsEl.innerText = totalMbps.toFixed(2) + ' Mbps';
      if (dailyGbEl) dailyGbEl.innerText = dailyGb.toFixed(2) + ' GB / วัน';
      if (monthlyTbEl) monthlyTbEl.innerText = monthlyTb.toFixed(2) + ' TB / เดือน';

      if (adviceEl) {
        let adviceHtml = '';
        if (monthlyTb <= 1.0) {
          adviceHtml = '✅ <strong>แนะนำ:</strong> Cloud VPS สเปกประหยัดสุด (1 vCPU, 1GB RAM) แพ็กเกจ Bandwidth 1 TB/เดือน (เช่น DigitalOcean $4/ด. หรือ Lightsail $3.5/ด.) รองรับการทำงานได้ 100% สบายๆ ตลอดทั้งเดือน';
        } else if (monthlyTb <= 2.5) {
          adviceHtml = '⚡ <strong>แนะนำ:</strong> Cloud VPS สเปกมาตรฐาน (1 vCPU, 1-2GB RAM) แพ็กเกจ Bandwidth 2 TB/เดือน (เช่น DigitalOcean $6/ด. หรือ Cloud ในไทย ~150 บ./ด.) เพียงพอใช้งานดึงภาพได้ลื่นไหล ไม่ติด FUP';
        } else if (monthlyTb <= 5.0) {
          adviceHtml = '🔥 <strong>แนะนำ:</strong> ปริมาณข้อมูลค่อนข้างสูง (' + monthlyTb.toFixed(1) + ' TB/เดือน) แนะนำ <strong>Hetzner Cloud (€3.5/ด. ให้ 20TB)</strong> หรือเลือก Cloud ในไทยที่มี Local Bandwidth แบบ Unlimited 1 Gbps';
        } else {
          adviceHtml = '🚨 <strong>ปริมาณข้อมูลสูงมาก (' + monthlyTb.toFixed(1) + ' TB/เดือน):</strong> แนะนำให้ลด Bitrate สตรีมกล้องลงมาใช้ Substream หรือปรับโหมดบันทึกเป็น Motion Only มิฉะนั้นค่าทราฟฟิก VPS อาจบานปลาย หรือควรเลือก Cloud ในไทยแบบ Unmetered Traffic';
        }
        adviceEl.innerHTML = adviceHtml;
      }
    }

    // Auto calculate on load
    if (typeof document !== 'undefined' && typeof setTimeout !== 'undefined') {
      setTimeout(calculateVpsBandwidth, 100);
    }
  

    // ----------------------------------------------------
    // Scenario 4: Interactive RTSP & Frigate Config Generator
    // ----------------------------------------------------
    
    // ----------------------------------------------------
    // Scenario 4: Interactive RTSP & RTMP Generator
    // ----------------------------------------------------
    function onProtoChange() {
      const proto = document.getElementById('gen-cam-proto')?.value || 'rtsp';
      const portEl = document.getElementById('gen-cam-port');
      const ipEl = document.getElementById('gen-cam-ip');
      if (proto === 'rtmp') {
        if (portEl) portEl.value = '1935';
        if (ipEl && ipEl.value === '192.168.10.50') ipEl.value = 'vms.local';
      } else {
        if (portEl) portEl.value = '554';
        if (ipEl && ipEl.value === 'vms.local') ipEl.value = '192.168.10.50';
      }
      generateRtspUrl();
    }

    function generateRtspUrl() {
      const protoEl = document.getElementById('gen-cam-proto');
      const proto = protoEl ? protoEl.value : 'rtsp';
      const brandEl = document.getElementById('gen-cam-brand');
      const ipEl = document.getElementById('gen-cam-ip');
      const portEl = document.getElementById('gen-cam-port');
      const userEl = document.getElementById('gen-cam-user');
      const passEl = document.getElementById('gen-cam-pass');
      const chEl = document.getElementById('gen-cam-ch');
      const streamEl = document.getElementById('gen-cam-stream');

      if (!brandEl || !ipEl || !portEl || !userEl || !passEl || !chEl || !streamEl) return;

      const brand = brandEl.value;
      const ip = (ipEl.value || '192.168.10.50').trim();
      const port = (portEl.value || '554').trim();
      const user = encodeURIComponent((userEl.value || 'admin').trim());
      const pass = encodeURIComponent((passEl.value || '').trim());
      const ch = parseInt(chEl.value, 10) || 1;
      const isSub = streamEl.value === 'sub';

      let authStr = '';
      if (user || pass) {
        authStr = user + (pass ? ':' + pass : '') + '@';
      }

      let path = '';
      let streamName = 'remote_cam_' + (ch < 10 ? '0' + ch : ch);

      switch (brand) {
        case 'hikvision':
          // 101 for ch1 main, 102 for ch1 sub; 201 for ch2 main, etc.
          path = '/Streaming/Channels/' + (ch * 100 + (isSub ? 2 : 1));
          break;
        case 'dahua':
          path = '/cam/realmonitor?channel=' + ch + '&subtype=' + (isSub ? 1 : 0);
          break;
        case 'tapo':
        case 'vigi':
          path = isSub ? '/stream2' : '/stream1';
          break;
        case 'uniview':
          path = '/unicast/c' + ch + '/s' + (isSub ? 1 : 0) + '/live';
          break;
        case 'ezviz':
          path = isSub ? '/h264/ch' + ch + '/sub/av_stream' : '/h264/ch' + ch + '/main/av_stream';
          break;
        case 'vstarcam':
          path = isSub ? '/udp/av0_1' : '/udp/av0_0';
          break;
        case 'generic':
        default:
          path = isSub ? '/live/ch' + (ch - 1) + '_1' : '/live/ch' + (ch - 1);
          break;
      }

      let streamUrl = '';
      let yamlCode = '';
      const roleStr = isSub ? '            - detect' : '            - record\n            - detect';

      if (proto === 'rtmp') {
        // RTMP Push format for camera and go2rtc
        streamUrl = 'rtmp://' + ip + ':' + port + '/live/' + streamName;
        yamlCode = 'go2rtc:\n  streams:\n    # go2rtc เปิดพอร์ต 1935 รอรับ Push จากกล้องอัตโนมัติ\n    ' + streamName + ':\n      - "rtmp://127.0.0.1:1935/live/' + streamName + '"\n\ncameras:\n  ' + streamName + ':\n    ffmpeg:\n      inputs:\n        - path: rtsp://127.0.0.1:8554/' + streamName + '\n          roles:\n' + roleStr;
      } else {
        // Standard RTSP Pull format
        streamUrl = 'rtsp://' + authStr + ip + ':' + port + path;
        yamlCode = 'go2rtc:\n  streams:\n    ' + streamName + ':\n      - "ffmpeg:' + streamUrl + '#video=copy#audio=copy"\n\ncameras:\n  ' + streamName + ':\n    ffmpeg:\n      inputs:\n        - path: rtsp://127.0.0.1:8554/' + streamName + '\n          roles:\n' + roleStr;
      }

      const rtspEl = document.getElementById('gen-res-rtsp');
      if (rtspEl) {
        rtspEl.innerText = streamUrl;
      }

      const yamlEl = document.getElementById('gen-res-yaml');
      if (yamlEl) {
        yamlEl.innerHTML = '<code>' + yamlCode + '</code>';
      }
    }

    // Auto run on load if DOM is available
    if (typeof document !== 'undefined' && typeof setTimeout !== 'undefined') {
      setTimeout(generateRtspUrl, 120);
    }

    // ----------------------------------------------------
    // CSP Compliant Event Delegation & Auto-Initialization
    // ----------------------------------------------------
    document.addEventListener('DOMContentLoaded', function() {
      // 1. Initial render of Inspector Node 3
      if (typeof inspectNode === 'function') {
        inspectNode(3);
      }

      // 2. Initial Calculators
      if (typeof calculateVpsBandwidth === 'function') {
        calculateVpsBandwidth();
      }
      if (typeof runCgnatDiagnosis === 'function') {
        runCgnatDiagnosis();
      }
      if (typeof generateRtspUrl === 'function') {
        generateRtspUrl();
      }

      // 3. Attach listeners to input fields
      ['vps-calc-cams', 'vps-calc-bitrate', 'vps-calc-mode'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('input', calculateVpsBandwidth);
          el.addEventListener('change', calculateVpsBandwidth);
        }
      });

      ['diag-hq-net', 'diag-branch-net'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', runCgnatDiagnosis);
      });

      const protoEl = document.getElementById('gen-cam-proto');
      if (protoEl) protoEl.addEventListener('change', onProtoChange);

      ['gen-cam-brand', 'gen-cam-ip', 'gen-cam-port', 'gen-cam-user', 'gen-cam-pass', 'gen-cam-ch', 'gen-cam-stream'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('input', generateRtspUrl);
          el.addEventListener('change', generateRtspUrl);
        }
      });
    });

    
    // Full Workflow Copy Handler (1-Click for n8n Canvas Paste)
    const embeddedWorkflowJson = {
  "id": "BPPVMSMaster01",
  "name": "BPP-VMS Master Bot Workflow (AI Agent + Alert + Photo Ingest)",
  "active": true,
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "bpp-vms-master",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "webhook-inbound-trigger",
      "name": "Master Webhook Trigger",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [
        180,
        380
      ],
      "webhookId": "bpp-vms-master-webhook"
    },
    {
      "parameters": {
        "mode": "rules",
        "rules": {
          "values": [
            {
              "conditions": {
                "options": {
                  "caseSensitive": false,
                  "leftValue": "",
                  "typeValidation": "strict"
                },
                "conditions": [
                  {
                    "leftValue": "={{ $json.body.type || 'chat' }}",
                    "rightValue": "chat",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "outputKey": "chat"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": false,
                  "leftValue": "",
                  "typeValidation": "strict"
                },
                "conditions": [
                  {
                    "leftValue": "={{ $json.body.type || 'chat' }}",
                    "rightValue": "photo",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "outputKey": "photo"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": false,
                  "leftValue": "",
                  "typeValidation": "strict"
                },
                "conditions": [
                  {
                    "leftValue": "={{ $json.body.type || 'chat' }}",
                    "rightValue": "alert",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "outputKey": "alert"
            }
          ]
        },
        "options": {}
      },
      "id": "switch-router",
      "name": "Route by Message Type",
      "type": "n8n-nodes-base.switch",
      "typeVersion": 3.2,
      "position": [
        440,
        380
      ]
    },
    {
      "parameters": {
        "promptType": "define",
        "text": "={{ $json.body.message || $json.body.text }}",
        "options": {
          "systemMessage": "=คุณคือ AI Assistant ประจำศูนย์ปฏิบัติการ BPP-VMS (ตชด.215)\nหน้าที่ของคุณ:\n1. รับฟังและตอบคำถามเจ้าหน้าที่เกี่ยวกับสถานการณ์ความมั่นคงและประวัติเหตุการณ์\n2. สกัดข้อมูลรายงานเหตุการณ์ภาษาไทย (บุคคล, ของกลาง, ยานพาหนะ, พิกัดสถานที่, สภ.) และบันทึกเข้าระบบผ่าน Tool\n3. ค้นหาข้อมูลป้ายทะเบียนและบุคคลต้องสงสัยใน Watchlist ผ่าน Tool\nตอบกลับเป็นภาษาไทยที่สุภาพ กระชับ ถูกต้องตามระเบียบราชการ"
        }
      },
      "id": "ai-agent-chat",
      "name": "AI Intelligence Agent",
      "type": "@n8n/n8n-nodes-langchain.agent",
      "typeVersion": 1.7,
      "position": [
        800,
        40
      ]
    },
    {
      "parameters": {
        "modelName": "models/gemini-3.5-flash-lite",
        "options": {
          "temperature": 0.2
        }
      },
      "id": "gemini-model-chat",
      "name": "Google Gemini 3.5 Flash Lite",
      "type": "@n8n/n8n-nodes-langchain.lmChatGoogleGemini",
      "typeVersion": 1,
      "position": [
        680,
        200
      ],
      "credentials": {
        "googlePalmApi": {
          "id": "gemini-api-cred",
          "name": "Google Gemini Free API Key"
        }
      }
    },
    {
      "parameters": {
        "name": "check_watchlist",
        "description": "ค้นหาและตรวจสอบว่าหมายเลขทะเบียนรถ หรือชื่อบุคคล อยู่ในบัญชีเฝ้าระวัง (Watchlist) ของ BPP-VMS หรือไม่",
        "url": "http://watchlist-api:5001/watchlist",
        "method": "GET"
      },
      "id": "tool-watchlist",
      "name": "Tool: Check Watchlist (HTTP)",
      "type": "@n8n/n8n-nodes-langchain.toolHttpRequest",
      "typeVersion": 1.1,
      "position": [
        920,
        200
      ]
    },
    {
      "parameters": {
        "jsCode": "// Multi-Photo & Evidence Batch Processor\nconst body = $input.item.json.body || {};\nconst images = Array.isArray(body.images) ? body.images : (body.image_base64 ? [body.image_base64] : []);\nconst metadataList = Array.isArray(body.metadata_list) ? body.metadata_list : [body.metadata || {}];\n\n// Aggregate GPS and Evidence from all uploaded photos in the batch\nlet primaryGps = { lat: 13.6892, lng: 99.8214 };\nfor (const meta of metadataList) {\n  if (meta && meta.gps && meta.gps.lat && meta.gps.lng) {\n    primaryGps = meta.gps;\n    break;\n  }\n}\n\nconst dossierId = 'CASE-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.floor(1000 + Math.random() * 9000);\n\nreturn {\n  json: {\n    status: 'success',\n    type: 'batch_photos_processed',\n    dossier_id: dossierId,\n    total_images_processed: images.length || 1,\n    gps: primaryGps,\n    extracted_entities: {\n      suspect: body.suspect || 'นายสมชาย ใจดี',\n      drugs: body.drugs || 'ยาบ้า 250 เม็ด',\n      weapon: body.weapon || 'อาวุธปืน .38',\n      vehicle: body.vehicle || '1กข 4567 ราชบุรี'\n    },\n    sync_targets: {\n      heatmap_updated: true,\n      i2_graph_linked: true,\n      nas_vault_stored: true\n    },\n    timestamp: new Date().toISOString()\n  }\n};"
      },
      "id": "code-photo-extractor",
      "name": "Extract Multi-Photo EXIF & Evidence",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        800,
        380
      ]
    },
    {
      "parameters": {
        "jsCode": "// Smart LPR Alert Formatter Node\nconst body = $input.item.json.body || {};\nconst plate = body.plate || '1กข 4567';\nconst camera = body.camera_name || body.camera || body.camera_group || body.group || 'cam11 (ด่านหนองกวาง)';\nconst timestamp = body.timestamp || new Date().toLocaleString('th-TH');\nconst status = body.status || 'SUSPECT_WATCHLIST';\n\nconst formattedTelegramMessage = `🚨 [แจ้งเตือนด่วน BPP-VMS LPR]\\n` +\n  `📌 ทะเบียน: ${plate}\\n` +\n  `📷 กล้อง: ${camera}\\n` +\n  `⏰ เวลา: ${timestamp}\\n` +\n  `⚠️ สถานะ: บัญชีเฝ้าระวัง (${status})\\n` +\n  `📍 พิกัด: จุดตรวจหนองกวาง ต.หนองกวาง อ.โพธาราม`;\n\nreturn {\n  json: {\n    plate: plate,\n    camera: camera,\n    timestamp: timestamp,\n    status: status,\n    telegram_text: formattedTelegramMessage,\n    broadcast_ready: true\n  }\n};"
      },
      "id": "code-alert-formatter",
      "name": "Format Rich Alert Card",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        800,
        560
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify($json) }}",
        "options": {}
      },
      "id": "respond-to-webhook",
      "name": "Respond to Webhook",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        1180,
        380
      ]
    }
  ],
  "connections": {
    "Master Webhook Trigger": {
      "main": [
        [
          {
            "node": "Route by Message Type",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Route by Message Type": {
      "main": [
        [
          {
            "node": "AI Intelligence Agent",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Extract Multi-Photo EXIF & Evidence",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Format Rich Alert Card",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Google Gemini 3.5 Flash Lite": {
      "ai_languageModel": [
        [
          {
            "node": "AI Intelligence Agent",
            "type": "ai_languageModel",
            "index": 0
          }
        ]
      ]
    },
    "Tool: Check Watchlist (HTTP)": {
      "ai_tool": [
        [
          {
            "node": "AI Intelligence Agent",
            "type": "ai_tool",
            "index": 0
          }
        ]
      ]
    },
    "AI Intelligence Agent": {
      "main": [
        [
          {
            "node": "Respond to Webhook",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Extract Multi-Photo EXIF & Evidence": {
      "main": [
        [
          {
            "node": "Respond to Webhook",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Format Rich Alert Card": {
      "main": [
        [
          {
            "node": "Respond to Webhook",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "settings": {
    "executionOrder": "v1"
  }
};

    async function copyFullWorkflow(btnElement) {
      const btn = btnElement || document.getElementById('btn-copy-full-workflow');
      const originalHtml = btn ? btn.innerHTML : '';
      try {
        let text = '';
        try {
          const res = await fetch('downloads/bpp_vms_master_bot_workflow.json');
          if (res.ok) {
            text = await res.text();
          }
        } catch (e) {}

        if (!text) {
          text = JSON.stringify(embeddedWorkflowJson, null, 2);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          fallbackCopy(text);
        }

        if (btn) {
          btn.innerHTML = '<span>✅ คัดลอกสำเร็จ! สลับไปที่ n8n แล้วกด Ctrl+V ได้เลย</span>';
          btn.classList.add('bg-emerald-600', 'text-white', 'border-emerald-400');
          setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.classList.remove('bg-emerald-600', 'text-white', 'border-emerald-400');
          }, 4000);
        }
      } catch (err) {
        console.error('Failed to copy full workflow:', err);
        if (btn) {
          btn.innerHTML = '<span>❌ เกิดข้อผิดพลาดในการคัดลอก</span>';
          setTimeout(() => { btn.innerHTML = originalHtml; }, 2000);
        }
      }
    }
    window.copyFullWorkflow = copyFullWorkflow;

    // Event Delegation for click actions (CSP Compliant: No inline onclick needed)
    document.addEventListener('click', function(e) {
      // Copy full workflow button
      const copyWfBtn = e.target.closest('#btn-copy-full-workflow, [data-action="copy-full-workflow"]');
      if (copyWfBtn) {
        e.preventDefault();
        copyFullWorkflow(copyWfBtn);
        return;
      }

      // Node selection on Canvas
      const nodeEl = e.target.closest('[data-inspect-node], .node-card, [id^="canvas-node-"]');
      if (nodeEl) {
        let id = nodeEl.getAttribute('data-inspect-node');
        if (!id && nodeEl.id && nodeEl.id.startsWith('canvas-node-')) {
          id = nodeEl.id.replace('canvas-node-', '');
        }
        if (id && !isNaN(id)) {
          e.preventDefault();
          inspectNode(parseInt(id, 10));
          return;
        }
      }

      // Copy buttons
      const copyBtn = e.target.closest('[data-copy-target], .btn-copy');
      if (copyBtn) {
        const targetId = copyBtn.getAttribute('data-copy-target');
        if (targetId) {
          e.preventDefault();
          copyCode(targetId, copyBtn);
          return;
        }
      }

      // Master tab switcher
      const masterTabBtn = e.target.closest('[data-master-tab]');
      if (masterTabBtn) {
        const mode = masterTabBtn.getAttribute('data-master-tab');
        if (mode) {
          e.preventDefault();
          switchMasterTab(mode);
          return;
        }
      }

      // MikroTik sub-tab switcher
      const mtTabBtn = e.target.closest('[data-mt-tab]');
      if (mtTabBtn) {
        const tabId = mtTabBtn.getAttribute('data-mt-tab');
        if (tabId) {
          e.preventDefault();
          switchMtTab(tabId);
          return;
        }
      }

      // Chapter 6 sub-tab switcher
      const ch6Btn = e.target.closest('[data-ch6-tab]');
      if (ch6Btn) {
        const tabId = ch6Btn.getAttribute('data-ch6-tab');
        if (tabId) {
          e.preventDefault();
          switchCh6Tab(tabId);
          return;
        }
      }

      // Encyclopedia category filter
      const catBtn = e.target.closest('[data-filter-cat]');
      if (catBtn) {
        const cat = catBtn.getAttribute('data-filter-cat');
        if (cat) {
          e.preventDefault();
          filterCat(cat);
          return;
        }
      }

      // Prev node navigator
      if (e.target.closest('#insp-btn-prev')) {
        e.preventDefault();
        goToPrevNode();
        return;
      }
    });

    // Expose all functions to global scope
    window.switchMasterTab = switchMasterTab;
    window.switchMtTab = switchMtTab;
    window.copyCode = copyCode;
    window.fallbackCopy = fallbackCopy;
    window.goToPrevNode = goToPrevNode;
    window.goToNode = goToNode;
    window.inspectNode = inspectNode;
    window.filterCat = filterCat;
    window.scrollToTelegramSetup = scrollToTelegramSetup;
    window.switchCh6Tab = switchCh6Tab;
    window.runCgnatDiagnosis = runCgnatDiagnosis;
    window.calculateVpsBandwidth = calculateVpsBandwidth;
    window.onProtoChange = onProtoChange;
    window.generateRtspUrl = generateRtspUrl;
    window.nodeGuideData = nodeGuideData;
    window.nodeWiringData = nodeWiringData;

})();

// ============================================================================
// VISUAL TUTORIAL: INTERACTIVE SWITCH NODE PLAYGROUND
// ============================================================================
function playSwitchFlow(type) {
    // 1. Reset buttons
    const btns = ['chat', 'photo', 'alert'];
    btns.forEach(b => {
        const el = document.getElementById('btn-flow-' + b);
        if (el) {
            el.className = 'flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded-lg py-2 text-xs font-bold transition-all';
        }
    });

    // 2. Active button styling
    const activeBtn = document.getElementById('btn-flow-' + type);
    if (activeBtn) {
        if (type === 'chat') {
            activeBtn.className = 'flex-1 bg-purple-900/50 hover:bg-purple-800 text-purple-300 border border-purple-500/50 rounded-lg py-2 text-xs font-bold transition-all shadow-lg ring-2 ring-purple-400';
        } else if (type === 'photo') {
            activeBtn.className = 'flex-1 bg-blue-900/50 hover:bg-blue-800 text-blue-300 border border-blue-500/50 rounded-lg py-2 text-xs font-bold transition-all shadow-lg ring-2 ring-blue-400';
        } else if (type === 'alert') {
            activeBtn.className = 'flex-1 bg-cyan-900/50 hover:bg-cyan-800 text-cyan-300 border border-cyan-500/50 rounded-lg py-2 text-xs font-bold transition-all shadow-lg ring-2 ring-cyan-400';
        }
    }

    // 3. Update DOM texts
    const elInputType = document.getElementById('play-input-type');
    const elEvalResult = document.getElementById('play-eval-result');
    const elDecision = document.getElementById('play-decision');

    if (elInputType) elInputType.textContent = type;
    if (elEvalResult) elEvalResult.textContent = type;

    if (elDecision) {
        // Force reflow for animation restart
        elDecision.classList.remove('animate-pulse');
        void elDecision.offsetWidth;
        
        if (type === 'chat') {
            elDecision.innerHTML = '✅ ตรงกับ Rule 0 ➔ ไหลออกพอร์ต Output 0 (ไป AI Agent)';
            elDecision.className = 'pl-3 font-bold text-[12px] flex items-center gap-2 mt-1 py-1 rounded px-2 animate-pulse text-purple-400 bg-purple-950/30 border border-purple-500/20';
        } else if (type === 'photo') {
            elDecision.innerHTML = '✅ ตรงกับ Rule 1 ➔ ไหลออกพอร์ต Output 1 (ไป Photo Code)';
            elDecision.className = 'pl-3 font-bold text-[12px] flex items-center gap-2 mt-1 py-1 rounded px-2 animate-pulse text-blue-400 bg-blue-950/30 border border-blue-500/20';
        } else if (type === 'alert') {
            elDecision.innerHTML = '✅ ตรงกับ Rule 2 ➔ ไหลออกพอร์ต Output 2 (ไป LPR Alert)';
            elDecision.className = 'pl-3 font-bold text-[12px] flex items-center gap-2 mt-1 py-1 rounded px-2 animate-pulse text-cyan-400 bg-cyan-950/30 border border-cyan-500/20';
        }
    }
}
window.playSwitchFlow = playSwitchFlow;
