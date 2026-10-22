using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace BppVmsNative
{
    public class MainForm : Form
    {
        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        private const int WM_NCLBUTTONDOWN = 0x00A1;
        private const int HTCAPTION = 0x0002;
        private const int WM_NCHITTEST = 0x0084;
        private const int HTLEFT = 10;
        private const int HTRIGHT = 11;
        private const int HTTOP = 12;
        private const int HTTOPLEFT = 13;
        private const int HTTOPRIGHT = 14;
        private const int HTBOTTOM = 15;
        private const int HTBOTTOMLEFT = 16;
        private const int HTBOTTOMRIGHT = 17;

        private Panel _webHostPanel;
        private CoreWebView2Controller _webController;
        private CoreWebView2 _coreWebView;
        private NotifyIcon _trayIcon;
        private ContextMenuStrip _trayMenu;
        private Process _gatewayProcess;
        private readonly string _baseDir;
        private readonly string _gatewayUrl = "http://127.0.0.1:8443";
        private bool _allowExit = false;

        public MainForm()
        {
            _baseDir = AppDomain.CurrentDomain.BaseDirectory;
            Text = "SLOTH × BPP-VMS 215 — Intelligent Surveillance Platform";
            Width = 1540;
            Height = 920;
            MinimumSize = new Size(1080, 700);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.None;
            BackColor = Color.FromArgb(7, 9, 15);
            ForeColor = Color.White;
            DoubleBuffered = true;

            string icoPath = Path.Combine(_baseDir, "..", "repo", "frigate-nvr", "web", "favicon.ico");
            if (File.Exists(icoPath))
            {
                try { Icon = new Icon(icoPath); } catch { Icon = SystemIcons.Shield; }
            }
            else
            {
                Icon = SystemIcons.Shield;
            }

            ApplyModernWindowEffects();
            InitializeTrayIcon();
            InitializeWebHostPanel();

            FormClosing += OnFormClosing;
            Load += async (s, e) => await BootSystemAsync();
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.Style |= 0x00020000; // WS_MINIMIZEBOX
                cp.Style |= 0x00010000; // WS_MAXIMIZEBOX
                return cp;
            }
        }

        private void ApplyModernWindowEffects()
        {
            try
            {
                // Windows 11 DWM Rounded Corners (DWMWCP_ROUND = 2)
                int cornerPref = 2;
                DwmSetWindowAttribute(Handle, 33, ref cornerPref, sizeof(int));
                // Dark Immersive Mode (DWMWA_USE_IMMERSIVE_DARK_MODE = 20)
                int darkMode = 1;
                DwmSetWindowAttribute(Handle, 20, ref darkMode, sizeof(int));
            }
            catch
            {
            }
        }

        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            if (m.Msg == WM_NCHITTEST && WindowState == FormWindowState.Normal)
            {
                Point pos = PointToClient(new Point(m.LParam.ToInt32()));
                int grip = 6;
                if (pos.X <= grip && pos.Y <= grip) m.Result = (IntPtr)HTTOPLEFT;
                else if (pos.X >= Width - grip && pos.Y <= grip) m.Result = (IntPtr)HTTOPRIGHT;
                else if (pos.X <= grip && pos.Y >= Height - grip) m.Result = (IntPtr)HTBOTTOMLEFT;
                else if (pos.X >= Width - grip && pos.Y >= Height - grip) m.Result = (IntPtr)HTBOTTOMRIGHT;
                else if (pos.X <= grip) m.Result = (IntPtr)HTLEFT;
                else if (pos.X >= Width - grip) m.Result = (IntPtr)HTRIGHT;
                else if (pos.Y <= grip) m.Result = (IntPtr)HTTOP;
                else if (pos.Y >= Height - grip) m.Result = (IntPtr)HTBOTTOM;
            }
        }

        private void InitializeTrayIcon()
        {
            _trayMenu = new ContextMenuStrip();
            _trayMenu.Items.Add("เปิดหน้าต่างโปรแกรม (Show BPP-VMS)", null, (s, e) => ShowMainWindow());
            _trayMenu.Items.Add("🔄 อัปเดตโปรแกรมเป็นเวอร์ชันล่าสุด (1-Click Program Update)", null, async (s, e) => await TriggerFullProgramUpdateAsync());
            _trayMenu.Items.Add("⚡ ซิงค์หน้าเว็บทันที (Zero-Downtime Web Sync)", null, async (s, e) => await TriggerWebSyncAsync());
            _trayMenu.Items.Add(new ToolStripSeparator());
            _trayMenu.Items.Add("🏠 โหมด Local Engine (http://127.0.0.1:8443)", null, (s, e) =>
            {
                if (_coreWebView != null) _coreWebView.Navigate(_gatewayUrl + "/");
            });
            _trayMenu.Items.Add("🌐 โหมด Remote PC Client (https://sloth.bpp215.com)", null, (s, e) =>
            {
                if (_coreWebView != null) _coreWebView.Navigate("https://sloth.bpp215.com/");
            });
            _trayMenu.Items.Add("เปิดในเบราว์เซอร์ (http://127.0.0.1:8443)", null, (s, e) =>
            {
                Process.Start(new ProcessStartInfo(_gatewayUrl) { UseShellExecute = true });
            });
            _trayMenu.Items.Add(new ToolStripSeparator());
            _trayMenu.Items.Add("ออกจากโปรแกรม (Exit BPP-VMS)", null, (s, e) => ExitApplication());

            _trayIcon = new NotifyIcon
            {
                Icon = Icon,
                Text = "SLOTH × BPP-VMS 215 Native Engine (:8443)",
                ContextMenuStrip = _trayMenu,
                Visible = true
            };
            _trayIcon.DoubleClick += (s, e) => ShowMainWindow();
        }

        private void InitializeWebHostPanel()
        {
            _webHostPanel = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(7, 9, 15),
                Margin = new Padding(0),
                Padding = new Padding(0)
            };
            _webHostPanel.Resize += (s, e) =>
            {
                if (_webController != null)
                {
                    _webController.Bounds = new Rectangle(0, 0, _webHostPanel.Width, _webHostPanel.Height);
                }
            };
            Controls.Add(_webHostPanel);
        }

        private async Task BootSystemAsync()
        {
            try
            {
                string userDataFolder = Path.Combine(_baseDir, "runtime", "webview2_profile");
                Directory.CreateDirectory(userDataFolder);
                var envOptions = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required --ignore-certificate-errors");
                var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder, envOptions);
                _webController = await env.CreateCoreWebView2ControllerAsync(_webHostPanel.Handle);
                try
                {
                    _webController.DefaultBackgroundColor = Color.FromArgb(7, 9, 15);
                }
                catch
                {
                }
                _webController.Bounds = new Rectangle(0, 0, _webHostPanel.Width, _webHostPanel.Height);
                _webController.IsVisible = true;
                _coreWebView = _webController.CoreWebView2;
                _coreWebView.Settings.IsStatusBarEnabled = false;
                _coreWebView.Settings.AreDefaultContextMenusEnabled = true;

                _coreWebView.WebMessageReceived += OnWebMessageReceived;
                await _coreWebView.AddScriptToExecuteOnDocumentCreatedAsync(GetNativeShellChromeInjectionScript());

                // Show Futuristic SLOTH x BPP-215 Cyber Splash Screen immediately while gateway boots
                _coreWebView.NavigateToString(GetCyberSplashHtml());

                await StartGatewayIfNeededAsync();

                bool ready = await WaitForGatewayReadyAsync(30);
                if (ready)
                {
                    _coreWebView.Navigate(_gatewayUrl + "/");
                }
                else
                {
                    _coreWebView.NavigateToString(GetErrorSplashHtml());
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("WebView2 Init Error: " + ex.Message, "BPP-VMS Native", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string msg = "";
            try
            {
                msg = e.TryGetWebMessageAsString();
            }
            catch
            {
                return;
            }

            if (string.IsNullOrEmpty(msg)) return;

            if (msg == "drag-window")
            {
                BeginInvoke(new Action(() =>
                {
                    if (WindowState == FormWindowState.Maximized)
                    {
                        WindowState = FormWindowState.Normal;
                    }
                    ReleaseCapture();
                    SendMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);
                }));
            }
            else if (msg == "minimize")
            {
                BeginInvoke(new Action(() => { WindowState = FormWindowState.Minimized; }));
            }
            else if (msg == "maximize-toggle")
            {
                BeginInvoke(new Action(() =>
                {
                    WindowState = (WindowState == FormWindowState.Maximized)
                        ? FormWindowState.Normal
                        : FormWindowState.Maximized;
                }));
            }
            else if (msg == "close")
            {
                BeginInvoke(new Action(() => { Close(); }));
            }
            else if (msg == "exit-app")
            {
                BeginInvoke(new Action(() => { ExitApplication(); }));
            }
            else if (msg == "sync-web")
            {
                BeginInvoke(new Action(async () => { await TriggerWebSyncAsync(); }));
            }
            else if (msg == "update-program")
            {
                BeginInvoke(new Action(async () => { await TriggerFullProgramUpdateAsync(); }));
            }
            else if (msg == "open-browser")
            {
                BeginInvoke(new Action(() =>
                {
                    Process.Start(new ProcessStartInfo(_gatewayUrl) { UseShellExecute = true });
                }));
            }
            else if (msg == "reload")
            {
                BeginInvoke(new Action(async () =>
                {
                    if (_coreWebView != null)
                    {
                        try { await _coreWebView.CallDevToolsProtocolMethodAsync("Network.clearBrowserCache", "{}"); } catch { }
                        _coreWebView.Reload();
                    }
                }));
            }
        }

        private string GetCyberSplashHtml()
        {
            return @"<!DOCTYPE html>
<html lang='th'>
<head>
<meta charset='utf-8'>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  body {
    height: 100vh; width: 100vw; overflow: hidden;
    background: radial-gradient(circle at 50% 35%, #131b2e 0%, #07090f 70%);
    color: #f8fafc; font-family: 'Segoe UI', system-ui, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    border: 1px solid rgba(56, 189, 248, 0.22);
  }
  .win-bar {
    position: fixed; top: 0; left: 0; right: 0; height: 42px;
    display: flex; align-items: center; justify-content: flex-end; padding: 0 12px;
  }
  .win-btn {
    width: 34px; height: 28px; border: none; background: transparent; color: #94a3b8;
    border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
    transition: all 0.15s ease;
  }
  .win-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
  .win-btn.close:hover { background: #ef4444; color: #fff; }
  .radar-wrap {
    position: relative; width: 118px; height: 118px; margin-bottom: 24px;
    display: flex; align-items: center; justify-content: center;
  }
  .ring1, .ring2 {
    position: absolute; inset: 0; border-radius: 50%;
    border: 2px solid transparent;
    border-top-color: #38bdf8; border-right-color: rgba(168, 85, 247, 0.7);
    animation: spin 1.8s cubic-bezier(0.55, 0.15, 0.45, 0.85) infinite;
    filter: drop-shadow(0 0 14px rgba(56, 189, 248, 0.45));
  }
  .ring2 {
    inset: 12px; border-top-color: #a855f7; border-left-color: rgba(52, 211, 153, 0.7);
    animation-direction: reverse; animation-duration: 2.4s;
  }
  .core-shield {
    width: 56px; height: 56px; border-radius: 16px;
    background: linear-gradient(135deg, rgba(56,189,248,0.2), rgba(168,85,247,0.25));
    border: 1px solid rgba(56,189,248,0.45);
    display: flex; align-items: center; justify-content: center;
    font-size: 26px; box-shadow: 0 0 28px rgba(56,189,248,0.25);
  }
  .brand-title {
    font-size: 28px; font-weight: 800; letter-spacing: 2.5px;
    background: linear-gradient(90deg, #f8fafc 0%, #38bdf8 50%, #c084fc 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .brand-sub {
    margin-top: 6px; font-size: 11.5px; letter-spacing: 3.5px; color: #38bdf8; font-weight: 600;
  }
  .brand- motto {
    margin-top: 8px; font-size: 13px; color: #94a3b8;
  }
  .progress-box {
    margin-top: 32px; width: 380px; background: rgba(15, 23, 42, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.16); border-radius: 12px; padding: 14px 18px;
    backdrop-filter: blur(12px);
  }
  .progress-bar-bg {
    width: 100%; height: 5px; background: rgba(255,255,255,0.07); border-radius: 99px; overflow: hidden;
    margin-bottom: 10px;
  }
  .progress-bar-fill {
    width: 45%; height: 100%; border-radius: 99px;
    background: linear-gradient(90deg, #38bdf8, #a855f7, #34d399);
    animation: slide 1.4s ease-in-out infinite;
  }
  .status-line { font-size: 12.5px; color: #e2e8f0; display: flex; justify-content: space-between; }
  .pills {
    margin-top: 18px; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;
  }
  .pill {
    font-size: 11px; padding: 4px 10px; border-radius: 99px;
    background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.28); color: #7dd3fc;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(220%); } }
</style>
</head>
<body onmousedown=""if(event.target===document.body||event.target.classList.contains('win-bar'))window.chrome.webview.postMessage('drag-window')"">
  <div class='win-bar'>
    <button class='win-btn' onclick=""window.chrome.webview.postMessage('minimize')"" title='ย่อหน้าต่าง'>─</button>
    <button class='win-btn' onclick=""window.chrome.webview.postMessage('maximize-toggle')"" title='ขยายหน้าต่าง'>□</button>
    <button class='win-btn close' onclick=""window.chrome.webview.postMessage('close')"" title='ซ่อนไปที่ถาดระบบ'>✕</button>
  </div>
  <div class='radar-wrap'>
    <div class='ring1'></div>
    <div class='ring2'></div>
    <div class='core-shield'>🛡️</div>
  </div>
  <div class='brand-title'>SLOTH × BPP-VMS 215</div>
  <div class='brand-sub'>INTELLIGENT SURVEILLANCE PLATFORM · NATIVE EDITION</div>
  <div class='progress-box'>
    <div class='progress-bar-bg'><div class='progress-bar-fill'></div></div>
    <div class='status-line'>
      <span>⚡ กำลังเชื่อมต่อ Zero-Drop Stream & All-GPU AI...</span>
      <span style='color:#34d399'>PORT :8443</span>
    </div>
  </div>
  <div class='pills'>
    <span class='pill'>🟢 Zero-Docker Native .EXE</span>
    <span class='pill'>⚡ All-GPU (CUDA / DirectML / NVENC)</span>
    <span class='pill'>🔄 Auto-Sync Web 15m</span>
    <span class='pill'>📡 531 Cameras Ready</span>
  </div>
</body>
</html>";
        }

        private string GetErrorSplashHtml()
        {
            return @"<!DOCTYPE html>
<html lang='th'><head><meta charset='utf-8'>
<style>
  body { height:100vh; margin:0; background:#07090f; color:#f8fafc; font-family:'Segoe UI',sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .card { background:#111827; border:1px solid #ef4444; border-radius:14px; padding:28px; max-width:480px; text-align:center; }
  button { margin-top:16px; padding:8px 18px; border-radius:8px; border:1px solid #38bdf8; background:#1e293b; color:#fff; cursor:pointer; }
</style></head><body>
  <div class='card'>
    <h2 style='color:#f87171'>⚠️ ไม่สามารถเชื่อมต่อพอร์ต :8443</h2>
    <p style='color:#94a3b8;font-size:13px;margin-top:8px'>กรุณารันไฟล์ Install-On-New-PC.bat (หากเป็นเครื่องใหม่) หรือตรวจสอบไฟล์ native\runtime\gateway.log</p>
    <button onclick=""window.chrome.webview.postMessage('reload')"">🔄 ลองเชื่อมต่อใหม่อีกครั้ง</button>
    <button onclick=""window.chrome.webview.postMessage('exit-app')"">✕ ปิดโปรแกรม</button>
  </div>
</body></html>";
        }

        private string GetNativeShellChromeInjectionScript()
        {
            return @"
(function() {
  if (window.__bppNativeShellInjected) return;
  window.__bppNativeShellInjected = true;

  function postNative(cmd) {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(cmd);
    }
  }

  window.electronAPI = {
    minimize: function() { postNative('minimize'); },
    toggleMaximize: function() { postNative('maximize-toggle'); },
    close: function() { postNative('close'); }
  };
  window.bppNativeShell = {
    isNativeExe: true,
    minimize: function() { postNative('minimize'); },
    toggleMaximize: function() { postNative('maximize-toggle'); },
    close: function() { postNative('close'); },
    exitApp: function() { postNative('exit-app'); },
    syncWeb: function() { postNative('sync-web'); },
    openBrowser: function() { postNative('open-browser'); },
    reload: function() { postNative('reload'); }
  };

  function injectSlothCyberChrome() {
    if (location.protocol === 'about:') return;
    if (document.getElementById('bppSlothNativeWindowControls')) return;

    var style = document.createElement('style');
    style.id = 'bppSlothNativeChromeStyle';
    style.textContent = `
      /* Futuristic SLOTH-BPP215 Custom Window Frame & Flush Inside-Topbar Window Controls */
      header.topbar, header {
        position: relative !important;
        padding-right: 205px !important;
        user-select: none;
      }
      .bpp-native-win-cluster {
        position: absolute !important;
        top: 12px !important;
        right: 12px !important;
        z-index: 40 !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 4px !important;
        padding: 3px 6px !important;
        border-radius: 10px !important;
        background: rgba(10, 8, 22, 0.72) !important;
        border: 1px solid rgba(168, 85, 247, 0.36) !important;
        height: 36px !important;
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35) !important;
      }
      .bpp-win-update-btn {
        height: 28px;
        padding: 0 9px;
        border: 1px solid rgba(52, 226, 168, 0.42);
        border-radius: 7px;
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(168, 85, 247, 0.22));
        color: #ecfdf5;
        font-size: 11.5px;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        cursor: pointer;
        transition: all 0.16s ease;
        white-space: nowrap;
      }
      .bpp-win-update-btn:hover {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.38), rgba(168, 85, 247, 0.38));
        border-color: #34e2a8;
        box-shadow: 0 0 10px rgba(52, 226, 168, 0.32);
      }
      .bpp-win-update-btn.is-updating svg {
        animation: bppSpin 0.9s linear infinite;
      }
      @keyframes bppSpin { to { transform: rotate(360deg); } }
      .bpp-win-ctrl-btn {
        width: 30px;
        height: 28px;
        border: none;
        border-radius: 7px;
        background: transparent;
        color: #9aa0bd;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.14s ease, color 0.14s ease;
      }
      .bpp-win-ctrl-btn:hover {
        background: rgba(168, 85, 247, 0.22);
        color: #eef0f8;
      }
      .bpp-win-ctrl-btn.bpp-win-close:hover {
        background: #ef4444 !important;
        color: #ffffff !important;
        box-shadow: 0 0 12px rgba(239, 68, 68, 0.5);
      }
    `;
    document.head.appendChild(style);

    var hdr = document.querySelector('header.topbar') || document.querySelector('header');
    if (!hdr) return;

    hdr.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'a' || e.target.closest('button, a, input, select, .header-pill, .tab, .bpp-native-win-cluster')) {
        return;
      }
      postNative('drag-window');
    });

    hdr.addEventListener('dblclick', function(e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'a' || e.target.closest('button, a, input, select, .header-pill, .tab, .bpp-native-win-cluster')) {
        return;
      }
      postNative('maximize-toggle');
    });

    var winCluster = document.createElement('div');
    winCluster.id = 'bppSlothNativeWindowControls';
    winCluster.className = 'bpp-native-win-cluster';
    winCluster.innerHTML = `
      <button type='button' class='bpp-win-update-btn' id='bppWinUpdateBtn' title='อัปเดตโปรแกรมและหน้าเว็บเป็นเวอร์ชันล่าสุดทันที (1-Click Program Update & Cache Clear)'>
        <svg viewBox='0 0 24 24' width='13' height='13' fill='none' stroke='#34e2a8' stroke-width='2.3' stroke-linecap='round' stroke-linejoin='round'><path d='M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'/><path d='M3 3v5h5'/><path d='M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16'/><path d='M16 16h5v5'/></svg>
        <span id='bppWinUpdateLabel'>อัปเดต</span>
      </button>
      <button type='button' class='bpp-win-ctrl-btn' id='bppWinMinBtn' title='ย่อหน้าต่าง (Minimize)'>
        <svg viewBox='0 0 12 12' width='11' height='11'><rect x='2' y='5.5' width='8' height='1.4' fill='currentColor'/></svg>
      </button>
      <button type='button' class='bpp-win-ctrl-btn' id='bppWinMaxBtn' title='ขยาย / คืนขนาดหน้าต่าง (Maximize)'>
        <svg viewBox='0 0 12 12' width='11' height='11' fill='none' stroke='currentColor' stroke-width='1.4'><rect x='2' y='2' width='8' height='8' rx='1'/></svg>
      </button>
      <button type='button' class='bpp-win-ctrl-btn bpp-win-close' id='bppWinCloseBtn' title='ซ่อนโปรแกรมไว้ที่ถาดมุมขวาล่าง (คลิกขวาที่โล่เพื่อปิดระบบ)'>
        <svg viewBox='0 0 12 12' width='11' height='11' fill='none' stroke='currentColor' stroke-width='1.6'><path d='M2.2 2.2l7.6 7.6M9.8 2.2l-7.6 7.6'/></svg>
      </button>
    `;
    hdr.appendChild(winCluster);

    document.getElementById('bppWinUpdateBtn').addEventListener('click', async function() {
      var btn = document.getElementById('bppWinUpdateBtn');
      var lbl = document.getElementById('bppWinUpdateLabel');
      if (btn.classList.contains('is-updating')) return;
      btn.classList.add('is-updating');
      if (lbl) lbl.textContent = 'กำลังอัปเดต...';
      try {
        await fetch('/api/config/system/update/apply', { method: 'POST', credentials: 'same-origin' });
        await fetch('/api/config/system/update/web-sync', { method: 'POST', credentials: 'same-origin' });
      } catch (err) {}
      postNative('update-program');
    });
    document.getElementById('bppWinMinBtn').addEventListener('click', function() { postNative('minimize'); });
    document.getElementById('bppWinMaxBtn').addEventListener('click', function() { postNative('maximize-toggle'); });
    document.getElementById('bppWinCloseBtn').addEventListener('click', function() { postNative('close'); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSlothCyberChrome);
  } else {
    injectSlothCyberChrome();
  }
  window.addEventListener('load', injectSlothCyberChrome);
})();
";
        }

        private bool CanExecutePython(string exePath)
        {
            try
            {
                var p = Process.Start(new ProcessStartInfo
                {
                    FileName = exePath,
                    Arguments = "--version",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                });
                if (p == null) return false;
                if (!p.WaitForExit(3000)) { try { p.Kill(); } catch { } return false; }
                return p.ExitCode == 0;
            }
            catch
            {
                return false;
            }
        }

        private async Task StartGatewayIfNeededAsync()
        {
            bool alreadyUp = await Task.Run(() => IsGatewayListening());
            if (alreadyUp) return;

            string pythonExe = Path.Combine(_baseDir, "venv", "Scripts", "python.exe");
            bool venvValid = await Task.Run(() => File.Exists(pythonExe) && CanExecutePython(pythonExe));
            if (!venvValid)
            {
                pythonExe = "python.exe";
            }

            string gatewayScript = Path.Combine(_baseDir, "..", "repo", "frigate-nvr", "tools", "native-exe", "native_gateway.py");
            if (!File.Exists(gatewayScript))
            {
                gatewayScript = Path.Combine(_baseDir, "native_gateway.py");
            }

            if (!File.Exists(gatewayScript))
            {
                return;
            }

            var psi = new ProcessStartInfo
            {
                FileName = pythonExe,
                Arguments = "\"" + Path.GetFullPath(gatewayScript) + "\"",
                WorkingDirectory = Path.GetDirectoryName(Path.GetFullPath(gatewayScript)),
                UseShellExecute = false,
                CreateNoWindow = true
            };
            psi.EnvironmentVariables["BPP_NATIVE_ROOT"] = _baseDir.TrimEnd('\\', '/');
            _gatewayProcess = Process.Start(psi);
        }

        private bool IsGatewayListening()
        {
            try
            {
                using (var tcp = new TcpClient())
                {
                    var connectTask = tcp.ConnectAsync("127.0.0.1", 8443);
                    if (!connectTask.Wait(250) || !tcp.Connected)
                    {
                        return false;
                    }
                }

                var req = (HttpWebRequest)WebRequest.Create(_gatewayUrl + "/api/native/ping");
                req.Timeout = 2000;
                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    if (resp.StatusCode == HttpStatusCode.OK) return true;
                }
            }
            catch
            {
                return false;
            }
            return false;
        }

        private async Task<bool> WaitForGatewayReadyAsync(int maxSeconds)
        {
            for (int i = 0; i < maxSeconds * 2; i++)
            {
                bool ok = await Task.Run(() => IsGatewayListening());
                if (ok) return true;
                await Task.Delay(400);
            }
            return false;
        }

        private async Task TriggerWebSyncAsync()
        {
            await Task.Run(() =>
            {
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(_gatewayUrl + "/api/config/system/update/web-sync");
                    req.Method = "POST";
                    req.Timeout = 25000;
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    {
                    }
                }
                catch
                {
                }
            });
            if (_coreWebView != null)
            {
                try { await _coreWebView.CallDevToolsProtocolMethodAsync("Network.clearBrowserCache", "{}"); } catch { }
                _coreWebView.Reload();
            }
        }

        private async Task TriggerFullProgramUpdateAsync()
        {
            await Task.Run(() =>
            {
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(_gatewayUrl + "/api/config/system/update/apply");
                    req.Method = "POST";
                    req.Timeout = 45000;
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    {
                    }
                }
                catch
                {
                }
                try
                {
                    var req2 = (HttpWebRequest)WebRequest.Create(_gatewayUrl + "/api/config/system/update/web-sync");
                    req2.Method = "POST";
                    req2.Timeout = 25000;
                    using (var resp2 = (HttpWebResponse)req2.GetResponse())
                    {
                    }
                }
                catch
                {
                }
            });
            if (_coreWebView != null)
            {
                try { await _coreWebView.CallDevToolsProtocolMethodAsync("Network.clearBrowserCache", "{}"); } catch { }
                _coreWebView.Reload();
            }
            try
            {
                _trayIcon.ShowBalloonTip(
                    2500,
                    "อัปเดตโปรแกรม SLOTH × BPP-VMS สำเร็จ",
                    "ดึงเวอร์ชันล่าสุดและล้างแคชของโปรแกรมเรียบร้อยแล้ว",
                    ToolTipIcon.Info
                );
            }
            catch
            {
            }
        }

        private void ShowMainWindow()
        {
            Show();
            WindowState = FormWindowState.Normal;
            if (_webController != null)
            {
                try { _webController.IsVisible = true; } catch { }
            }
            Activate();
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (!_allowExit && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                if (_webController != null)
                {
                    try { _webController.IsVisible = false; } catch { }
                }
                Hide();
                _trayIcon.ShowBalloonTip(
                    2000,
                    "SLOTH × BPP-VMS ทำงานอยู่เบื้องหลัง",
                    "ระบบกล้องและเว็บพอร์ต :8443 ยังทำงานอยู่ คลิกขวาที่ไอคอนมุมขวาล่างหากต้องการปิดระบบ",
                    ToolTipIcon.Info
                );
                return;
            }
            CleanupProcesses();
        }

        private void ExitApplication()
        {
            _allowExit = true;
            CleanupProcesses();
            _trayIcon.Visible = false;
            Application.Exit();
        }

        private void CleanupProcesses()
        {
            try
            {
                if (_gatewayProcess != null && !_gatewayProcess.HasExited)
                {
                    _gatewayProcess.Kill();
                }
            }
            catch
            {
            }
        }

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                int currentPid = Process.GetCurrentProcess().Id;
                foreach (Process p in Process.GetProcessesByName("BPP-VMS"))
                {
                    if (p.Id != currentPid)
                    {
                        try { p.Kill(); } catch { }
                    }
                }
            }
            catch
            {
            }

            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string machineIdPath = Path.Combine(baseDir, "config", ".machine_id");
                string storedPc = File.Exists(machineIdPath) ? File.ReadAllText(machineIdPath, System.Text.Encoding.UTF8).Trim() : "";
                string currentPc = Environment.MachineName.Trim();

                if (string.IsNullOrEmpty(storedPc) || !string.Equals(storedPc, currentPc, StringComparison.OrdinalIgnoreCase))
                {
                    string setupExe = Path.Combine(baseDir, "BPP-VMS-Setup.exe");
                    if (!File.Exists(setupExe))
                    {
                        setupExe = Path.Combine(baseDir, "..", "BPP-VMS-Setup.exe");
                    }
                    if (File.Exists(setupExe))
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = Path.GetFullPath(setupExe),
                            WorkingDirectory = Path.GetDirectoryName(Path.GetFullPath(setupExe)),
                            UseShellExecute = true
                        });
                        return;
                    }
                }
            }
            catch
            {
            }

            Application.Run(new MainForm());
        }
    }
}
