using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace BppVmsSetup
{
    public class SetupWizardForm : Form
    {
        private WebView2 _webView;
        private CoreWebView2 _coreWebView;
        private readonly string _baseDir;
        private readonly string _workspaceRoot;
        private bool _isInstalling = false;

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);

        private const int WM_NCLBUTTONDOWN = 0xA1;
        private const int HT_CAPTION = 0x2;

        public SetupWizardForm()
        {
            _baseDir = AppDomain.CurrentDomain.BaseDirectory;
            if (Directory.Exists(Path.Combine(_baseDir, "repo", "frigate-nvr")))
            {
                _workspaceRoot = _baseDir.TrimEnd('\\', '/');
            }
            else if (Directory.Exists(Path.Combine(_baseDir, "..", "repo", "frigate-nvr")))
            {
                _workspaceRoot = Path.GetFullPath(Path.Combine(_baseDir, "..")).TrimEnd('\\', '/');
            }
            else
            {
                _workspaceRoot = _baseDir.TrimEnd('\\', '/');
            }

            Text = "SLOTH × BPP-VMS 215 — Setup & Migration Wizard";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(920, 650);
            MinimumSize = new Size(880, 620);
            BackColor = Color.FromArgb(8, 10, 18);
            Icon = SystemIcons.Shield;

            _webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.FromArgb(8, 10, 18)
            };
            Controls.Add(_webView);

            Load += OnFormLoad;
        }

        private async void OnFormLoad(object sender, EventArgs e)
        {
            string userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BPP-VMS-Setup-WebView2"
            );
            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
            await _webView.EnsureCoreWebView2Async(env);
            _coreWebView = _webView.CoreWebView2;

            _coreWebView.Settings.AreDefaultContextMenusEnabled = false;
            _coreWebView.Settings.AreDevToolsEnabled = false;
            _coreWebView.Settings.IsStatusBarEnabled = false;
            _coreWebView.WebMessageReceived += OnWebMessageReceived;

            _coreWebView.NavigateToString(BuildWizardHtml());
        }

        private void DragWindow()
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action(DragWindow));
                return;
            }
            ReleaseCapture();
            SendMessage(Handle, WM_NCLBUTTONDOWN, HT_CAPTION, 0);
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string msg = "";
            try { msg = e.TryGetWebMessageAsString(); } catch { return; }
            if (string.IsNullOrEmpty(msg)) return;

            if (msg == "drag-window")
            {
                DragWindow();
            }
            else if (msg == "minimize")
            {
                BeginInvoke(new Action(() => { WindowState = FormWindowState.Minimized; }));
            }
            else if (msg == "close")
            {
                if (_isInstalling) return;
                BeginInvoke(new Action(() => { Application.Exit(); }));
            }
            else if (msg.StartsWith("INSTALL:"))
            {
                if (_isInstalling) return;
                string payload = msg.Substring("INSTALL:".Length);
                BeginInvoke(new Action(() => { RunInstallationAsync(payload); }));
            }
            else if (msg == "LAUNCH_AND_CLOSE")
            {
                BeginInvoke(new Action(() =>
                {
                    string exePath = Path.Combine(_workspaceRoot, "native", "BPP-VMS.exe");
                    if (File.Exists(exePath))
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = exePath,
                            WorkingDirectory = Path.Combine(_workspaceRoot, "native"),
                            UseShellExecute = true
                        });
                    }
                    Application.Exit();
                }));
            }
        }

        private string GetFlagValue(string payload, string key, string defaultVal)
        {
            var m = Regex.Match(payload, key + @"=([^|]*)");
            return m.Success ? m.Groups[1].Value : defaultVal;
        }

        private async void RunInstallationAsync(string payload)
        {
            _isInstalling = true;
            string mode = GetFlagValue(payload, "mode", "clean");
            bool cam = GetFlagValue(payload, "cam", "0") == "1";
            bool usr = GetFlagValue(payload, "usr", "0") == "1";
            bool gps = GetFlagValue(payload, "gps", "0") == "1";
            bool lpr = GetFlagValue(payload, "lpr", "0") == "1";
            bool brd = GetFlagValue(payload, "brd", "0") == "1";
            bool dsk = GetFlagValue(payload, "dsk", "1") == "1";
            bool stm = GetFlagValue(payload, "stm", "1") == "1";
            bool aut = GetFlagValue(payload, "aut", "0") == "1";
            string title = GetFlagValue(payload, "title", "SLOTH BPP-VMS").Replace("\"", "");

            string scriptPath = Path.Combine(_workspaceRoot, "repo", "frigate-nvr", "tools", "native-exe", "Setup-PortableBppVms.ps1");

            var args = new StringBuilder();
            args.Append("-NoProfile -ExecutionPolicy Bypass -File \"").Append(scriptPath).Append("\" ");
            args.Append("-WorkspaceRoot \"").Append(_workspaceRoot).Append("\" ");
            args.Append("-MigrationMode ").Append(mode).Append(" ");
            args.Append("-CustomSystemTitle \"").Append(title).Append("\" ");
            if (cam) args.Append("-MigrateCameras ");
            if (usr) args.Append("-MigrateUsers ");
            if (gps) args.Append("-MigrateGps ");
            if (lpr) args.Append("-MigrateWatchlist ");
            if (brd) args.Append("-MigrateBranding ");
            if (dsk) args.Append("-CreateDesktopShortcut ");
            if (stm) args.Append("-CreateStartMenuShortcut ");
            if (aut) args.Append("-AutoStartWithWindows ");

            await Task.Run(() =>
            {
                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = "powershell.exe",
                        Arguments = args.ToString(),
                        WorkingDirectory = _workspaceRoot,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        StandardOutputEncoding = Encoding.UTF8,
                        StandardErrorEncoding = Encoding.UTF8
                    };

                    using (var proc = new Process { StartInfo = psi })
                    {
                        proc.OutputDataReceived += (s, ev) =>
                        {
                            if (!string.IsNullOrWhiteSpace(ev.Data))
                            {
                                SendProgressToUi(ev.Data);
                            }
                        };
                        proc.ErrorDataReceived += (s, ev) =>
                        {
                            if (!string.IsNullOrWhiteSpace(ev.Data))
                            {
                                SendProgressToUi(ev.Data);
                            }
                        };

                        proc.Start();
                        proc.BeginOutputReadLine();
                        proc.BeginErrorReadLine();
                        proc.WaitForExit();
                    }
                }
                catch (Exception ex)
                {
                    SendProgressToUi("[PROGRESS:100] หมายเหตุ: " + ex.Message);
                }
            });

            _isInstalling = false;
            SendProgressToUi("[PROGRESS:100] ติดตั้งเสร็จสมบูรณ์ พร้อมเปิดใช้งานระบบ!");
        }

        private void SendProgressToUi(string rawLine)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action(() => SendProgressToUi(rawLine)));
                return;
            }
            if (_coreWebView == null) return;

            int pct = -1;
            string cleanMsg = rawLine.Trim();
            var m = Regex.Match(cleanMsg, @"^\[PROGRESS:(\d+)\]\s*(.*)$");
            if (m.Success)
            {
                int.TryParse(m.Groups[1].Value, out pct);
                cleanMsg = m.Groups[2].Value;
            }

            string escaped = cleanMsg
                .Replace("\\", "\\\\")
                .Replace("'", "\\'")
                .Replace("\r", "")
                .Replace("\n", " ");

            string js = string.Format("window.onSetupProgress({0}, '{1}');", pct, escaped);
            try { _coreWebView.ExecuteScriptAsync(js); } catch { }
        }

        private string EscapeHtml(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("'", "&#39;");
        }

        private string BuildWizardHtml()
        {
            string pcName = EscapeHtml(Environment.MachineName);
            string osVer = EscapeHtml(Environment.OSVersion.VersionString);
            string cpuCores = Environment.ProcessorCount.ToString() + " Cores / Threads";
            string wsPath = EscapeHtml(_workspaceRoot);

            return @"<!DOCTYPE html>
<html lang='th'>
<head>
<meta charset='utf-8'>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  body {
    width: 100vw; height: 100vh; overflow: hidden;
    background: radial-gradient(circle at 15% 15%, #1e1338 0%, #0b0e17 55%, #06080f 100%);
    color: #f8fafc;
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
    display: flex; flex-direction: column;
    border: 1px solid rgba(168, 85, 247, 0.45);
  }
  .topbar {
    height: 54px; padding: 0 18px;
    background: linear-gradient(90deg, rgba(19, 14, 39, 0.96), rgba(31, 18, 59, 0.92));
    border-bottom: 1px solid rgba(168, 85, 247, 0.32);
    display: flex; align-items: center; justify-content: space-between;
  }
  .brand-row { display: flex; align-items: center; gap: 12px; }
  .logo-badge {
    width: 34px; height: 34px; border-radius: 9px;
    background: linear-gradient(135deg, #0f172a, #1e1b4b);
    border: 1.5px solid #38bdf8;
    display: flex; align-items: center; justify-content: center;
    font-weight: 900; font-size: 11px; color: #38bdf8;
    box-shadow: 0 0 14px rgba(56, 189, 248, 0.35);
  }
  .title-main {
    font-size: 15px; font-weight: 800; letter-spacing: 0.6px;
    background: linear-gradient(90deg, #fff, #38bdf8, #c084fc);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .title-sub { font-size: 11px; color: #94a3b8; }
  .win-btns { display: flex; gap: 6px; }
  .win-btn {
    width: 32px; height: 28px; border-radius: 7px; border: 1px solid rgba(148,163,184,0.16);
    background: rgba(15, 23, 42, 0.7); color: #cbd5e1; cursor: pointer;
    display: flex; align-items: center; justify-content: center; font-size: 13px;
  }
  .win-btn:hover { background: rgba(168, 85, 247, 0.25); color: #fff; border-color: #a855f7; }
  .win-btn.close:hover { background: #ef4444; border-color: #f87171; color: #fff; }

  .wizard-body {
    flex: 1; display: grid; grid-template-columns: 245px 1fr; overflow: hidden;
  }
  .sidebar {
    background: rgba(10, 13, 24, 0.82);
    border-right: 1px solid rgba(148, 163, 184, 0.14);
    padding: 22px 18px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .steps { display: flex; flex-direction: column; gap: 14px; }
  .step-item {
    display: flex; align-items: center; gap: 11px; padding: 10px 12px;
    border-radius: 10px; border: 1px solid transparent; color: #64748b;
    font-size: 13px; font-weight: 600; transition: all 0.2s;
  }
  .step-item.active {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(56, 189, 248, 0.12));
    border-color: rgba(168, 85, 247, 0.45); color: #f8fafc;
  }
  .step-item.done { color: #34d399; }
  .step-num {
    width: 24px; height: 24px; border-radius: 50%;
    background: rgba(30, 41, 59, 0.9); border: 1px solid rgba(148, 163, 184, 0.25);
    display: flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 800;
  }
  .step-item.active .step-num { background: #a855f7; border-color: #c084fc; color: #fff; }
  .step-item.done .step-num { background: #10b981; border-color: #34d399; color: #052e16; }

  .hw-box {
    background: rgba(15, 23, 42, 0.78);
    border: 1px solid rgba(56, 189, 248, 0.24);
    border-radius: 11px; padding: 12px; font-size: 11.5px;
  }
  .hw-title { color: #38bdf8; font-weight: 700; margin-bottom: 6px; font-size: 11px; letter-spacing: 0.5px; }
  .hw-row { display: flex; justify-content: space-between; color: #cbd5e1; margin-top: 4px; }
  .hw-val { color: #f8fafc; font-weight: 600; }

  .content-pane {
    padding: 22px 26px; overflow-y: auto; display: flex; flex-direction: column; justify-content: space-between;
  }
  .page { display: none; flex-direction: column; gap: 14px; }
  .page.active { display: flex; }

  h2 { font-size: 19px; font-weight: 800; color: #f8fafc; }
  .desc { font-size: 13px; color: #94a3b8; line-height: 1.45; }

  .mode-cards { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
  .mode-card {
    background: rgba(15, 23, 42, 0.75);
    border: 1.5px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px; padding: 13px 16px; cursor: pointer;
    transition: all 0.16s ease; position: relative;
  }
  .mode-card:hover { border-color: rgba(56, 189, 248, 0.5); background: rgba(23, 33, 58, 0.85); }
  .mode-card.selected {
    border-color: #a855f7;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.16), rgba(56, 189, 248, 0.08));
    box-shadow: 0 0 20px rgba(168, 85, 247, 0.18);
  }
  .mode-head { display: flex; align-items: center; justify-content: space-between; }
  .mode-title { font-size: 14.5px; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 8px; }
  .mode-tag {
    font-size: 10.5px; font-weight: 700; padding: 2px 9px; border-radius: 99px;
    background: rgba(56, 189, 248, 0.16); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35);
  }
  .mode-sub { font-size: 12px; color: #cbd5e1; margin-top: 5px; line-height: 1.4; }

  .sub-panel {
    margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(148, 163, 184, 0.25);
    display: none; flex-direction: column; gap: 7px;
  }
  .mode-card.selected .sub-panel { display: flex; }

  .chk-row {
    display: flex; align-items: center; gap: 9px; font-size: 12.5px; color: #e2e8f0; cursor: pointer;
    padding: 4px 6px; border-radius: 6px;
  }
  .chk-row:hover { background: rgba(255,255,255,0.04); }
  .chk-row input[type='checkbox'] { width: 15px; height: 15px; accent-color: #a855f7; cursor: pointer; }
  .inp-box {
    background: rgba(9, 13, 24, 0.9); border: 1px solid rgba(168, 85, 247, 0.45);
    color: #fff; padding: 7px 11px; border-radius: 8px; font-size: 13px; width: 100%;
    outline: none; user-select: text;
  }

  .opt-box {
    background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 10px; padding: 10px 14px; display: flex; gap: 18px; flex-wrap: wrap;
  }

  .progress-wrap {
    margin-top: 14px; background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(168, 85, 247, 0.32); border-radius: 12px; padding: 18px;
  }
  .pbar-bg {
    width: 100%; height: 10px; background: rgba(255,255,255,0.08);
    border-radius: 99px; overflow: hidden; margin: 10px 0;
  }
  .pbar-fill {
    width: 0%; height: 100%; border-radius: 99px;
    background: linear-gradient(90deg, #38bdf8, #a855f7, #34d399);
    transition: width 0.3s ease;
  }
  .log-box {
    margin-top: 12px; height: 210px; overflow-y: auto;
    background: #05070d; border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px; padding: 10px 12px; font-family: Consolas, monospace;
    font-size: 11.5px; color: #93c5fd; line-height: 1.55;
  }

  .footer-nav {
    margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(148, 163, 184, 0.15);
    display: flex; align-items: center; justify-content: space-between;
  }
  .btn {
    padding: 9px 20px; border-radius: 9px; font-size: 13.5px; font-weight: 700;
    cursor: pointer; border: 1px solid rgba(148, 163, 184, 0.28);
    background: rgba(30, 41, 59, 0.85); color: #e2e8f0; transition: all 0.16s;
  }
  .btn:hover { background: rgba(51, 65, 85, 0.95); color: #fff; }
  .btn-primary {
    background: linear-gradient(135deg, #7c3aed, #2563eb);
    border-color: #a855f7; color: #fff;
    box-shadow: 0 4px 16px rgba(124, 58, 237, 0.38);
  }
  .btn-primary:hover { filter: brightness(1.12); }
  .btn-success {
    background: linear-gradient(135deg, #059669, #0284c7);
    border-color: #34d399; color: #fff;
    box-shadow: 0 4px 18px rgba(16, 185, 129, 0.4);
  }
</style>
</head>
<body onmousedown=""if(event.target.closest('.topbar') && !event.target.closest('.win-btn')) window.chrome.webview.postMessage('drag-window')"">
  <div class='topbar'>
    <div class='brand-row'>
      <div class='logo-badge'>215</div>
      <div>
        <div class='title-main'>SLOTH × BPP-VMS 215 — ENTERPRISE INSTALLER (v215)</div>
        <div class='title-sub'>Sucahkree Arm 215 + Things Analytic Co., Ltd. · All-GPU Native Edition · Warrant Face AI</div>
      </div>
    </div>
    <div class='win-btns'>
      <button class='win-btn' onclick=""window.chrome.webview.postMessage('minimize')"" title='ย่อหน้าต่าง'>─</button>
      <button class='win-btn close' onclick=""window.chrome.webview.postMessage('close')"" title='ปิดตัวติดตั้ง'>✕</button>
    </div>
  </div>

  <div class='wizard-body'>
    <div class='sidebar'>
      <div class='steps'>
        <div class='step-item active' id='navStep1'>
          <div class='step-num'>1</div>
          <div>เลือกรูปแบบการติดตั้ง</div>
        </div>
        <div class='step-item' id='navStep2'>
          <div class='step-num'>2</div>
          <div>กำลังติดตั้งระบบ</div>
        </div>
        <div class='step-item' id='navStep3'>
          <div class='step-num'>3</div>
          <div>เสร็จสมบูรณ์</div>
        </div>
      </div>

      <div class='hw-box'>
        <div class='hw-title'>⚡ ข้อมูลเครื่องปลายทาง</div>
        <div class='hw-row'><span>ชื่อเครื่อง:</span><span class='hw-val'>" + pcName + @"</span></div>
        <div class='hw-row'><span>ซีพียู:</span><span class='hw-val'>" + cpuCores + @"</span></div>
        <div class='hw-row'><span>โหมด AI:</span><span class='hw-val' style='color:#34d399'>All-GPU DirectML/CUDA</span></div>
        <div style='margin-top:6px;font-size:10.5px;color:#94a3b8;word-break:break-all;'>📁 " + wsPath + @"</div>
      </div>
    </div>

    <div class='content-pane'>
      <!-- PAGE 1: Select Migration Mode -->
      <div class='page active' id='page1'>
        <div>
          <h2>เลือกรูปแบบการติดตั้งและโอนย้ายข้อมูล (Setup & Migration Mode)</h2>
          <p class='desc'>คุณสามารถเลือกเริ่มต้นเป็นเครื่องใหม่ทั้งหมด หรือเลือกนำรายการกล้อง บัญชีผู้ใช้ และการตั้งค่าจากเครื่องต้นทางมาใช้งานต่อได้ทันที</p>
        </div>

        <div class='mode-cards'>
          <!-- Option 1: Clean -->
          <div class='mode-card selected' id='cardClean' onclick=""selectMode('clean')"">
            <div class='mode-head'>
              <div class='mode-title'>🆕 1. ติดตั้งแบบเครื่องใหม่ทั้งหมด (Clean New Machine)</div>
              <span class='mode-tag'>สำหรับจุดติดตั้งใหม่</span>
            </div>
            <div class='mode-sub'>เริ่มต้นระบบใหม่จากศูนย์ (0 กล้อง, ไม่มีข้อมูลของเครื่องเดิมติดมา) พร้อมกำหนดชื่อหน่วยงานของเครื่องใหม่ได้เอง</div>
            <div class='sub-panel' onclick='event.stopPropagation()'>
              <label style='font-size:12px;color:#cbd5e1;font-weight:600;'>ตั้งชื่อระบบ / ชื่อหน่วยงานสำหรับเครื่องนี้:</label>
              <input type='text' id='inpSystemTitle' class='inp-box' value='SLOTH BPP-VMS' placeholder='เช่น SLOTH BPP 215 หรือชื่อหน่วยงานของคุณ' />
            </div>
          </div>

          <!-- Option 2: Custom Selective Migration -->
          <div class='mode-card' id='cardCustom' onclick=""selectMode('custom')"">
            <div class='mode-head'>
              <div class='mode-title'>🎛️ 2. เลือกนำข้อมูลบางส่วนจากเครื่องเดิมไปด้วย (Custom Migration)</div>
              <span class='mode-tag' style='background:rgba(168,85,247,0.2);color:#e9d5ff;border-color:#a855f7;'>เลือกติ๊กเองได้</span>
            </div>
            <div class='mode-sub'>เลือกรายการข้อมูลจากเครื่องต้นทางที่ต้องการนำติดไปใช้บนเครื่องใหม่ได้ตามต้องการ:</div>
            <div class='sub-panel' onclick='event.stopPropagation()'>
              <label class='chk-row'><input type='checkbox' id='chkCam' checked /> 📹 นำ <b>รายการกล้อง CCTV, รหัสเชื่อมต่อ, กลุ่ม NVR และช่องสัญญาณทั้งหมด</b> ไปด้วย</label>
              <label class='chk-row'><input type='checkbox' id='chkUsr' checked /> 👥 นำ <b>บัญชีผู้ใช้งาน รหัสผ่าน และระดับสิทธิ์ (User Accounts & Roles)</b> ไปด้วย</label>
              <label class='chk-row'><input type='checkbox' id='chkGps' /> 🛰️ นำ <b>อุปกรณ์ติดตามพิกัด GPS และประวัติเส้นทางย้อนหลัง (GPSOne Trackers)</b> ไปด้วย</label>
              <label class='chk-row'><input type='checkbox' id='chkLpr' checked /> 🚨 นำ <b>บัญชีดำป้ายทะเบียนเฝ้าระวัง, ฐานข้อมูลใบหน้าหมายจับ (187 แฟ้ม) และโซน AI</b> ไปด้วย</label>
              <label class='chk-row'><input type='checkbox' id='chkBrd' checked /> 🎨 นำ <b>ชื่อหน่วยงานและโลโก้เดิมของเครื่องต้นทาง (Branding & Logo)</b> ไปด้วย</label>
            </div>
          </div>

          <!-- Option 3: Full Clone -->
          <div class='mode-card' id='cardFull' onclick=""selectMode('full')"">
            <div class='mode-head'>
              <div class='mode-title'>📦 3. นำการตั้งค่าเดิมทั้งหมดไปด้วย 100% (Full System Clone)</div>
              <span class='mode-tag' style='background:rgba(16,185,129,0.18);color:#6ee7b7;border-color:#10b981;'>โคลนครบ 100%</span>
            </div>
            <div class='mode-sub'>ยกการตั้งค่าทุกอย่างจากเครื่องเดิมมาทั้งหมด (กล้อง 36 ตัว + บัญชีผู้ใช้ทั้งหมด + อุปกรณ์ GPS + ทะเบียนเฝ้าระวัง + โลโก้หน่วยงาน) เปิดโปรแกรมแล้วใช้งานต่อได้เหมือนเครื่องต้นทางทันที</div>
          </div>
        </div>

        <div class='opt-box'>
          <label class='chk-row'><input type='checkbox' id='chkDesktop' checked /> สร้างไอคอนบนหน้าจอ Desktop</label>
          <label class='chk-row'><input type='checkbox' id='chkStartMenu' checked /> สร้างทางลัดใน Start Menu</label>
          <label class='chk-row'><input type='checkbox' id='chkAutoStart' /> เปิดโปรแกรมอัตโนมัติเมื่อเปิดเครื่อง Windows</label>
        </div>

        <div class='footer-nav'>
          <div style='font-size:12px;color:#94a3b8;'>💡 การกดอัปเดตโปรแกรมในอนาคตจะไม่ทับการตั้งค่าที่เลือกไว้ในขั้นตอนนี้</div>
          <button class='btn btn-primary' onclick='startInstall()'>⚡ เริ่มติดตั้งระบบ (Install Now) ➔</button>
        </div>
      </div>

      <!-- PAGE 2: Installing Progress -->
      <div class='page' id='page2'>
        <div>
          <h2>กำลังติดตั้งและกำหนดค่าระบบ SLOTH × BPP-VMS...</h2>
          <p class='desc'>กรุณารอสักครู่ ระบบกำลังเตรียมสภาพแวดล้อมการ์ดจอ คอมไพล์โปรแกรมหลัก และจัดเตรียมฐานข้อมูลตามที่คุณเลือก</p>
        </div>

        <div class='progress-wrap'>
          <div style='display:flex;justify-content:space-between;font-size:13.5px;font-weight:700;'>
            <span id='lblProgressStatus'>กำลังเริ่มต้นกระบวนการติดตั้ง...</span>
            <span id='lblProgressPct' style='color:#38bdf8;'>0%</span>
          </div>
          <div class='pbar-bg'><div class='pbar-fill' id='pbarFill'></div></div>
          <div class='log-box' id='logBox'></div>
        </div>
      </div>

      <!-- PAGE 3: Complete -->
      <div class='page' id='page3'>
        <div style='text-align:center;padding:28px 16px;'>
          <div style='width:68px;height:68px;border-radius:50%;background:rgba(16,185,129,0.2);border:2px solid #34d399;display:inline-flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:16px;'>✓</div>
          <h2 style='font-size:23px;color:#34d399;'>ติดตั้ง SLOTH × BPP-VMS 215 เสร็จสมบูรณ์!</h2>
          <p class='desc' style='margin-top:8px;max-width:520px;margin-left:auto;margin-right:auto;'>
            ระบบพร้อมใช้งานบนเครื่อง <b>" + pcName + @"</b> เรียบร้อยแล้ว พร้อมระบบซิงค์อัปเดตหน้าเว็บอัตโนมัติโดยไม่กระทบการตั้งค่าของเครื่อง
          </p>
          <div style='margin-top:26px;'>
            <button class='btn btn-success' style='font-size:15px;padding:12px 28px;' onclick=""window.chrome.webview.postMessage('LAUNCH_AND_CLOSE')"">
              🚀 เสร็จสิ้นและเปิดโปรแกรม SLOTH × BPP-VMS ทันที
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

<script>
  var currentMode = 'clean';
  function selectMode(m) {
    currentMode = m;
    document.getElementById('cardClean').classList.toggle('selected', m === 'clean');
    document.getElementById('cardCustom').classList.toggle('selected', m === 'custom');
    document.getElementById('cardFull').classList.toggle('selected', m === 'full');
  }

  function startInstall() {
    document.getElementById('page1').classList.remove('active');
    document.getElementById('page2').classList.add('active');
    document.getElementById('navStep1').classList.remove('active');
    document.getElementById('navStep1').classList.add('done');
    document.getElementById('navStep2').classList.add('active');

    var cam = document.getElementById('chkCam').checked ? '1' : '0';
    var usr = document.getElementById('chkUsr').checked ? '1' : '0';
    var gps = document.getElementById('chkGps').checked ? '1' : '0';
    var lpr = document.getElementById('chkLpr').checked ? '1' : '0';
    var brd = document.getElementById('chkBrd').checked ? '1' : '0';
    var dsk = document.getElementById('chkDesktop').checked ? '1' : '0';
    var stm = document.getElementById('chkStartMenu').checked ? '1' : '0';
    var aut = document.getElementById('chkAutoStart').checked ? '1' : '0';
    var title = (document.getElementById('inpSystemTitle').value || 'SLOTH BPP-VMS').replace(/\|/g, ' ');

    var payload = 'INSTALL:mode=' + currentMode +
                  '|cam=' + cam + '|usr=' + usr + '|gps=' + gps + '|lpr=' + lpr + '|brd=' + brd +
                  '|dsk=' + dsk + '|stm=' + stm + '|aut=' + aut + '|title=' + title;
    window.chrome.webview.postMessage(payload);
  }

  window.onSetupProgress = function(pct, msg) {
    var logBox = document.getElementById('logBox');
    if (msg) {
      var line = document.createElement('div');
      line.textContent = '› ' + msg;
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;
    }
    if (pct >= 0) {
      document.getElementById('pbarFill').style.width = pct + '%';
      document.getElementById('lblProgressPct').textContent = pct + '%';
      if (msg) document.getElementById('lblProgressStatus').textContent = msg;
    }
    if (pct >= 100) {
      setTimeout(function() {
        document.getElementById('page2').classList.remove('active');
        document.getElementById('page3').classList.add('active');
        document.getElementById('navStep2').classList.remove('active');
        document.getElementById('navStep2').classList.add('done');
        document.getElementById('navStep3').classList.add('active');
      }, 650);
    }
  };
</script>
</body>
</html>";
        }

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupWizardForm());
        }
    }
}
