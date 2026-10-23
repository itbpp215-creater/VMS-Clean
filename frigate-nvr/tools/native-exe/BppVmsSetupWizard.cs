using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
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
            BackColor = Color.FromArgb(6, 7, 15);
            Icon = ResolveApplicationIcon();

            _webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.FromArgb(6, 7, 15)
            };
            Controls.Add(_webView);

            Load += OnFormLoad;
        }

        private Icon ResolveApplicationIcon()
        {
            string[] candidates = new string[]
            {
                Path.Combine(_baseDir, "bpp215.ico"),
                Path.Combine(_workspaceRoot, "native", "bpp215.ico"),
                Path.Combine(_workspaceRoot, "repo", "frigate-nvr", "tools", "native-exe", "bpp215.ico"),
                Path.Combine(_workspaceRoot, "repo", "frigate-nvr", "web", "favicon.ico")
            };
            foreach (string p in candidates)
            {
                try
                {
                    if (File.Exists(p)) return new Icon(p);
                }
                catch { }
            }
            try
            {
                Icon assoc = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (assoc != null) return assoc;
            }
            catch { }
            return SystemIcons.Shield;
        }

        private string GetBrandLogoDataUri()
        {
            string[] pngCandidates = new string[]
            {
                Path.Combine(_workspaceRoot, "native", "data", "settings", "logo.png"),
                Path.Combine(_workspaceRoot, "repo", "frigate-nvr", "web", "assets", "BPP215.png"),
                Path.Combine(_baseDir, "repo", "frigate-nvr", "web", "assets", "BPP215.png")
            };
            foreach (string p in pngCandidates)
            {
                try
                {
                    if (File.Exists(p))
                    {
                        byte[] bytes = File.ReadAllBytes(p);
                        if (bytes.Length > 64)
                        {
                            return "data:image/png;base64," + Convert.ToBase64String(bytes);
                        }
                    }
                }
                catch { }
            }
            return "";
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
            else if (msg.StartsWith("TEST_SERVER:"))
            {
                string testUrl = msg.Substring("TEST_SERVER:".Length).Trim().TrimEnd('/');
                Task.Run(() =>
                {
                    bool ok = false;
                    string detail = "";
                    try
                    {
                        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;
                        ServicePointManager.ServerCertificateValidationCallback = (snd, cert, chain, err) => true;
                        var req = (HttpWebRequest)WebRequest.Create(testUrl + "/api/native/ping");
                        req.Timeout = 4500;
                        req.UserAgent = "BPP-VMS-Setup/215";
                        using (var resp = (HttpWebResponse)req.GetResponse())
                        {
                            ok = (int)resp.StatusCode >= 200 && (int)resp.StatusCode < 400;
                            detail = "เชื่อมต่อเครื่องแม่ข่ายสำเร็จ (" + testUrl + ") พร้อมติดตั้ง!";
                        }
                    }
                    catch (Exception ex)
                    {
                        ok = false;
                        detail = "ไม่สามารถเชื่อมต่อ " + testUrl + " (" + ex.Message + ")";
                    }

                    BeginInvoke(new Action(() =>
                    {
                        if (_coreWebView == null) return;
                        string safeMsg = detail.Replace("\\", "\\\\").Replace("'", "\\'").Replace("\r", "").Replace("\n", " ");
                        string js = string.Format("window.onServerTestResult({0}, '{1}');", ok ? "true" : "false", safeMsg);
                        try { _coreWebView.ExecuteScriptAsync(js); } catch { }
                    }));
                });
            }
            else if (msg == "PICK_LOGO")
            {
                BeginInvoke(new Action(() =>
                {
                    using (var ofd = new OpenFileDialog())
                    {
                        ofd.Title = "เลือกไฟล์โลโก้หน่วยงาน (.PNG / .JPG / .WEBP)";
                        ofd.Filter = "Image Files (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp";
                        if (ofd.ShowDialog(this) == DialogResult.OK)
                        {
                            string safePath = ofd.FileName.Replace("\\", "\\\\").Replace("'", "\\'");
                            try { _coreWebView.ExecuteScriptAsync("window.onLogoPicked('" + safePath + "');"); } catch { }
                        }
                    }
                }));
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
            string title = GetFlagValue(payload, "title", "Sloth").Replace("\"", "");
            string sub = GetFlagValue(payload, "sub", "BPP 215").Replace("\"", "");
            string logoPath = GetFlagValue(payload, "logo", "").Replace("\"", "");
            string pubDom = GetFlagValue(payload, "dom", "").Replace("\"", "");
            string cfTok = GetFlagValue(payload, "cf", "").Replace("\"", "");
            string tgTok = GetFlagValue(payload, "tg", "").Replace("\"", "");
            string tgChat = GetFlagValue(payload, "chat", "").Replace("\"", "");
            string gemKey = GetFlagValue(payload, "gem", "").Replace("\"", "");
            string srvUrl = GetFlagValue(payload, "srv", "https://sloth.bpp215.com").Replace("\"", "");

            string scriptPath = Path.Combine(_workspaceRoot, "repo", "frigate-nvr", "tools", "native-exe", "Setup-PortableBppVms.ps1");

            var args = new StringBuilder();
            args.Append("-NoProfile -ExecutionPolicy Bypass -File \"").Append(scriptPath).Append("\" ");
            args.Append("-WorkspaceRoot \"").Append(_workspaceRoot).Append("\" ");
            args.Append("-MigrationMode ").Append(mode).Append(" ");
            args.Append("-CustomSystemTitle \"").Append(title).Append("\" ");
            args.Append("-CustomSystemSub \"").Append(sub).Append("\" ");
            args.Append("-ServerUrl \"").Append(srvUrl).Append("\" ");
            if (!string.IsNullOrWhiteSpace(logoPath)) args.Append("-CustomLogoPath \"").Append(logoPath).Append("\" ");
            if (!string.IsNullOrWhiteSpace(pubDom)) args.Append("-PublicDomain \"").Append(pubDom).Append("\" ");
            if (!string.IsNullOrWhiteSpace(cfTok)) args.Append("-CloudflareToken \"").Append(cfTok).Append("\" ");
            if (!string.IsNullOrWhiteSpace(tgTok)) args.Append("-TelegramBotToken \"").Append(tgTok).Append("\" ");
            if (!string.IsNullOrWhiteSpace(tgChat)) args.Append("-TelegramChatId \"").Append(tgChat).Append("\" ");
            if (!string.IsNullOrWhiteSpace(gemKey)) args.Append("-GeminiApiKey \"").Append(gemKey).Append("\" ");
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
            string logoDataUri = GetBrandLogoDataUri();
            string logoBadgeHtml = !string.IsNullOrEmpty(logoDataUri)
                ? "<img src='" + logoDataUri + "' style='width:30px;height:30px;object-fit:contain;filter:drop-shadow(0 0 6px rgba(168,85,247,0.55));' alt='BPP 215'>"
                : "<svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='#c084fc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/></svg>";

            return @"<!DOCTYPE html>
<html lang='th'>
<head>
<meta charset='utf-8'>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  body {
    width: 100vw; height: 100vh; overflow: hidden;
    background:
      radial-gradient(1100px 700px at 22% -8%, rgba(124,58,237,.30), transparent 60%),
      radial-gradient(900px 650px at 88% 8%, rgba(168,85,247,.18), transparent 55%),
      radial-gradient(1000px 800px at 50% 120%, rgba(76,29,149,.22), transparent 60%),
      linear-gradient(160deg, #0a0c1a 0%, #06070f 100%);
    color: #eef0f8;
    font-family: 'Leelawadee UI', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
    display: flex; flex-direction: column;
    border: 1px solid rgba(168, 85, 247, 0.45);
  }
  .topbar {
    height: 56px; padding: 0 18px;
    background: linear-gradient(180deg, rgba(28, 22, 54, 0.85), rgba(16, 13, 32, 0.75));
    border-bottom: 1px solid rgba(168, 85, 247, 0.38);
    box-shadow: 0 6px 24px rgba(124, 58, 237, 0.18);
    display: flex; align-items: center; justify-content: space-between;
  }
  .brand-row { display: flex; align-items: center; gap: 12px; }
  .logo-badge {
    width: 38px; height: 38px; border-radius: 10px;
    background: radial-gradient(circle at 50% 40%, rgba(168,85,247,0.28), rgba(124,58,237,0.12));
    border: 1px solid rgba(168, 85, 247, 0.48);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 14px rgba(168, 85, 247, 0.28);
  }
  .title-main {
    font-size: 15px; font-weight: 800; letter-spacing: 0.8px;
    background: linear-gradient(90deg, #eef0f8 0%, #c084fc 55%, #34e2a8 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .title-sub { font-size: 11px; color: #9aa0bd; }
  .win-btns { display: flex; gap: 6px; }
  .win-btn {
    width: 32px; height: 28px; border-radius: 7px; border: 1px solid rgba(168,85,247,0.24);
    background: rgba(16, 13, 32, 0.7); color: #9aa0bd; cursor: pointer;
    display: flex; align-items: center; justify-content: center; font-size: 13px;
    transition: all 0.15s;
  }
  .win-btn:hover { background: rgba(168, 85, 247, 0.25); color: #eef0f8; border-color: #a855f7; }
  .win-btn.close:hover { background: #ef4444; border-color: #f87171; color: #fff; }

  .wizard-body {
    flex: 1; display: grid; grid-template-columns: 245px 1fr; overflow: hidden;
  }
  .sidebar {
    background: rgba(10, 8, 22, 0.78);
    border-right: 1px solid rgba(168, 85, 247, 0.2);
    padding: 22px 18px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .steps { display: flex; flex-direction: column; gap: 12px; }
  .step-item {
    display: flex; align-items: center; gap: 11px; padding: 10px 12px;
    border-radius: 10px; border: 1px solid transparent; color: #6b7099;
    font-size: 13px; font-weight: 600; transition: all 0.2s;
  }
  .step-item.active {
    background: linear-gradient(150deg, rgba(168, 85, 247, 0.28), rgba(124, 58, 237, 0.16));
    border-color: rgba(168, 85, 247, 0.5); color: #eef0f8;
    box-shadow: inset 0 0 0 1px rgba(168, 85, 247, 0.25);
  }
  .step-item.done { color: #34e2a8; }
  .step-num {
    width: 24px; height: 24px; border-radius: 50%;
    background: rgba(20, 16, 40, 0.9); border: 1px solid rgba(168, 85, 247, 0.28);
    display: flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 800;
  }
  .step-item.active .step-num { background: #a855f7; border-color: #c084fc; color: #fff; }
  .step-item.done .step-num { background: #10b981; border-color: #34e2a8; color: #052e16; }

  .hw-box {
    background: linear-gradient(180deg, rgba(28, 22, 54, 0.65), rgba(16, 13, 32, 0.65));
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 12px; padding: 12px; font-size: 11.5px;
  }
  .hw-title { color: #c084fc; font-weight: 700; margin-bottom: 6px; font-size: 11px; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px; }
  .hw-row { display: flex; justify-content: space-between; color: #9aa0bd; margin-top: 4px; }
  .hw-val { color: #eef0f8; font-weight: 600; }

  .content-pane {
    padding: 20px 24px; overflow-y: auto; display: flex; flex-direction: column; justify-content: space-between;
  }
  .page { display: none; flex-direction: column; gap: 12px; }
  .page.active { display: flex; }

  h2 { font-size: 18.5px; font-weight: 800; color: #eef0f8; }
  .desc { font-size: 12.5px; color: #9aa0bd; line-height: 1.45; }

  .mode-cards { display: flex; flex-direction: column; gap: 9px; margin-top: 2px; }
  .mode-card {
    background: linear-gradient(180deg, rgba(20, 16, 40, 0.72), rgba(12, 10, 26, 0.72));
    border: 1.5px solid rgba(168, 85, 247, 0.22);
    border-radius: 12px; padding: 12px 15px; cursor: pointer;
    transition: all 0.16s ease; position: relative;
  }
  .mode-card:hover { border-color: rgba(192, 132, 252, 0.55); background: rgba(28, 22, 54, 0.78); }
  .mode-card.selected {
    border-color: #a855f7;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(124, 58, 237, 0.12));
    box-shadow: 0 8px 24px rgba(124, 58, 237, 0.22), inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .mode-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .mode-title { font-size: 14px; font-weight: 700; color: #eef0f8; display: flex; align-items: center; gap: 8px; }
  .mode-ico {
    width: 24px; height: 24px; border-radius: 7px;
    background: rgba(168, 85, 247, 0.18); border: 1px solid rgba(168, 85, 247, 0.38);
    display: inline-flex; align-items: center; justify-content: center; flex: none;
  }
  .mode-tag {
    font-size: 10.5px; font-weight: 700; padding: 2px 9px; border-radius: 99px;
    background: rgba(168, 85, 247, 0.18); color: #e9d5ff; border: 1px solid rgba(168, 85, 247, 0.38);
    white-space: nowrap;
  }
  .mode-sub { font-size: 12px; color: #9aa0bd; margin-top: 4px; line-height: 1.4; }

  .sub-panel {
    margin-top: 9px; padding-top: 9px; border-top: 1px dashed rgba(168, 85, 247, 0.28);
    display: none; flex-direction: column; gap: 6px;
  }
  .mode-card.selected .sub-panel { display: flex; }

  .chk-row {
    display: flex; align-items: center; gap: 9px; font-size: 12px; color: #eef0f8; cursor: pointer;
    padding: 3px 6px; border-radius: 6px;
  }
  .chk-row:hover { background: rgba(168,85,247,0.08); }
  .chk-row input[type='checkbox'] { width: 15px; height: 15px; accent-color: #a855f7; cursor: pointer; }
  .inp-box {
    background: rgba(10, 8, 22, 0.9); border: 1px solid rgba(168, 85, 247, 0.42);
    color: #eef0f8; padding: 6px 10px; border-radius: 8px; font-size: 12.5px; width: 100%;
    outline: none; user-select: text;
  }
  .inp-box:focus { border-color: #c084fc; box-shadow: 0 0 0 2px rgba(168,85,247,0.22); }

  .opt-box {
    background: rgba(16, 13, 32, 0.72); border: 1px solid rgba(168, 85, 247, 0.24);
    border-radius: 10px; padding: 9px 14px; display: flex; gap: 16px; flex-wrap: wrap;
  }

  .progress-wrap {
    margin-top: 14px; background: linear-gradient(180deg, rgba(28, 22, 54, 0.75), rgba(16, 13, 32, 0.75));
    border: 1px solid rgba(168, 85, 247, 0.38); border-radius: 12px; padding: 18px;
  }
  .pbar-bg {
    width: 100%; height: 10px; background: rgba(255,255,255,0.08);
    border-radius: 99px; overflow: hidden; margin: 10px 0;
  }
  .pbar-fill {
    width: 0%; height: 100%; border-radius: 99px;
    background: linear-gradient(90deg, #7c3aed, #a855f7, #34e2a8);
    transition: width 0.3s ease;
  }
  .log-box {
    margin-top: 12px; height: 210px; overflow-y: auto;
    background: #06070f; border: 1px solid rgba(168, 85, 247, 0.25);
    border-radius: 8px; padding: 10px 12px; font-family: Consolas, monospace;
    font-size: 11.5px; color: #c084fc; line-height: 1.55;
  }

  .footer-nav {
    margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(168, 85, 247, 0.2);
    display: flex; align-items: center; justify-content: space-between;
  }
  .btn {
    padding: 8px 18px; border-radius: 9px; font-size: 13px; font-weight: 700;
    cursor: pointer; border: 1px solid rgba(168, 85, 247, 0.32);
    background: rgba(24, 18, 46, 0.85); color: #eef0f8; transition: all 0.16s;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .btn:hover { background: rgba(168, 85, 247, 0.22); border-color: #c084fc; color: #fff; }
  .btn-primary {
    background: linear-gradient(135deg, #a855f7, #7c3aed);
    border-color: #c084fc; color: #fff;
    box-shadow: 0 4px 16px rgba(124, 58, 237, 0.38);
  }
  .btn-primary:hover { filter: brightness(1.12); }
  .btn-success {
    background: linear-gradient(135deg, #10b981, #7c3aed);
    border-color: #34e2a8; color: #fff;
    box-shadow: 0 4px 18px rgba(52, 226, 168, 0.35);
  }
</style>
</head>
<body onmousedown=""if(event.target.closest('.topbar') && !event.target.closest('.win-btn')) window.chrome.webview.postMessage('drag-window')"">
  <div class='topbar'>
    <div class='brand-row'>
      <div class='logo-badge'>" + logoBadgeHtml + @"</div>
      <div>
        <div class='title-main'>SLOTH × BPP-VMS 215 — ENTERPRISE INSTALLER</div>
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
        <div class='hw-title'>
          <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='#c084fc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='4' y='4' width='16' height='16' rx='2'/><rect x='9' y='9' width='6' height='6'/></svg>
          <span>ข้อมูลเครื่องปลายทาง</span>
        </div>
        <div class='hw-row'><span>ชื่อเครื่อง:</span><span class='hw-val'>" + pcName + @"</span></div>
        <div class='hw-row'><span>ซีพียู:</span><span class='hw-val'>" + cpuCores + @"</span></div>
        <div class='hw-row'><span>โหมด AI:</span><span class='hw-val' style='color:#34e2a8'>All-GPU DirectML/CUDA</span></div>
        <div style='margin-top:6px;font-size:10.5px;color:#9aa0bd;word-break:break-all;'>" + wsPath + @"</div>
      </div>
    </div>

    <div class='content-pane'>
      <!-- PAGE 1: Select Migration Mode -->
      <div class='page active' id='page1'>
        <div>
          <h2>เลือกบทบาทของเครื่องนี้: เครื่องลูกข่าย (Client) หรือ เครื่องแม่ข่าย (Server)</h2>
          <p class='desc'>คุณสามารถแยกติดตั้งได้ทั้งแบบ <b>โปรแกรมลูกข่ายสำหรับเปิดดูกล้อง (PC Client)</b> หรือ <b>เครื่องเซิร์ฟเวอร์ประมวลผลหลัก (Server)</b></p>
        </div>

        <div class='mode-cards'>
          <!-- Option 0: PC Client Mode -->
          <div class='mode-card selected' id='cardClient' onclick=""selectMode('client')"">
            <div class='mode-head'>
              <div class='mode-title'>
                <span class='mode-ico' style='background:rgba(52,226,168,0.16);border-color:rgba(52,226,168,0.4);'>
                  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#34e2a8' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><rect x='2' y='3' width='20' height='14' rx='2'/><line x1='8' y1='21' x2='16' y2='21'/><line x1='12' y1='17' x2='12' y2='21'/></svg>
                </span>
                <span>1. ติดตั้งเป็นเครื่องลูกข่าย (PC Client Mode — เชื่อมต่อเครื่องแม่ข่าย)</span>
              </div>
              <span class='mode-tag' style='background:rgba(52,226,168,0.16);color:#6ee7b7;border-color:rgba(52,226,168,0.4);'>สำหรับคอมลูกข่าย / ห้องทำงานอื่น</span>
            </div>
            <div class='mode-sub'>ติดตั้งเฉพาะตัวโปรแกรม SLOTH × BPP-VMS Desktop Client สำหรับเชื่อมต่อดูกล้องจากเครื่องแม่ข่าย (ไม่รัน AI ในเครื่องนี้ กินสเปกต่ำมาก และกดปุ่มอัปเดตที่มุมขวาบนได้เหมือนกัน)</div>
            <div class='sub-panel' onclick='event.stopPropagation()'>
              <label style='font-size:12px;color:#e9d5ff;font-weight:600;'>URL หรือ IP ของเครื่องแม่ข่าย (Server URL):</label>
              <div style='display:flex;gap:8px;align-items:center;'>
                <input type='text' id='inpServerUrl' class='inp-box' value='https://sloth.bpp215.com' placeholder='เช่น https://sloth.bpp215.com หรือ http://192.168.1.200:8443' />
                <button type='button' class='btn' style='padding:6px 12px;font-size:12px;white-space:nowrap;border-color:#a855f7;color:#e9d5ff;' onclick='testServerConnection()'>
                  <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='#c084fc' stroke-width='2.2'><circle cx='11' cy='11' r='8'/><line x1='21' y1='21' x2='16.65' y2='16.65'/></svg>
                  <span>ทดสอบการเชื่อมต่อ</span>
                </button>
              </div>
              <div style='display:flex;gap:8px;margin-top:4px;align-items:center;flex-wrap:wrap;'>
                <button type='button' class='btn' style='padding:4px 10px;font-size:11.5px;' onclick=""setServerPreset('https://sloth.bpp215.com')"">ดูผ่านเน็ต (https://sloth.bpp215.com)</button>
                <button type='button' class='btn' style='padding:4px 10px;font-size:11.5px;' onclick=""setServerPreset('http://192.168.1.200:8443')"">ดูผ่านวงแลนภายใน (http://192.168.1.200:8443)</button>
                <span id='lblTestServerStatus' style='font-size:11.5px;color:#9aa0bd;margin-left:4px;'></span>
              </div>
            </div>
          </div>

          <!-- Option 1: Clean Server -->
          <div class='mode-card' id='cardClean' onclick=""selectMode('clean')"">
            <div class='mode-head'>
              <div class='mode-title'>
                <span class='mode-ico'>
                  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#c084fc' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><rect x='2' y='2' width='20' height='8' rx='2'/><rect x='2' y='14' width='20' height='8' rx='2'/><line x1='6' y1='6' x2='6.01' y2='6'/><line x1='6' y1='18' x2='6.01' y2='18'/></svg>
                </span>
                <span>2. ติดตั้งเป็นเครื่องแม่ข่ายใหม่ทั้งหมด (Server: Clean New Machine)</span>
              </div>
              <span class='mode-tag'>เซิร์ฟเวอร์จุดติดตั้งใหม่</span>
            </div>
            <div class='mode-sub'>เริ่มต้นระบบเซิร์ฟเวอร์ใหม่จากศูนย์ (รันระบบกล้อง + AI + บันทึกภาพในเครื่องนี้ โดยไม่มีข้อมูลของเครื่องเดิมติดมา)</div>
          </div>

          <!-- Option 2: Custom Selective Server Migration -->
          <div class='mode-card' id='cardCustom' onclick=""selectMode('custom')"">
            <div class='mode-head'>
              <div class='mode-title'>
                <span class='mode-ico'>
                  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#c084fc' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/></svg>
                </span>
                <span>3. ติดตั้งเครื่องแม่ข่ายใหม่ + นำ User &amp; รายการกล้อง/หมุดแผนที่ไปด้วย (แนะนำสำหรับย้ายเครื่อง)</span>
              </div>
              <span class='mode-tag'>ย้ายเครื่อง + ตั้งชื่อ/โลโก้ใหม่ได้</span>
            </div>
            <div class='mode-sub'>ติดตั้งเป็นเครื่องแม่ข่ายเครื่องใหม่ พร้อมนำบัญชีผู้ใช้ รายการกล้อง และหมุดกล้องบนแผนที่ไปด้วย และตั้งโลโก้/ชื่อ/URL/บอทใหม่ด้านล่างได้ทันที:</div>
            <div class='sub-panel' onclick='event.stopPropagation()'>
              <label class='chk-row'><input type='checkbox' id='chkCam' checked /> นำ <b>รายการกล้อง CCTV, หมุดกล้องบนแผนที่ (Map Pins), กลุ่ม NVR และช่องสัญญาณทั้งหมด</b> ไปด้วย</label>
              <label class='chk-row'><input type='checkbox' id='chkUsr' checked /> นำ <b>บัญชีผู้ใช้งาน (49 บัญชี), กลุ่มผู้ใช้ และระดับสิทธิ์ (Users &amp; Groups)</b> ไปด้วย</label>
              <label class='chk-row'><input type='checkbox' id='chkLpr' checked /> นำ <b>บัญชีดำป้ายทะเบียนเฝ้าระวัง, ฐานข้อมูลใบหน้าหมายจับ และโซน AI</b> ไปด้วย</label>
              <label class='chk-row'><input type='checkbox' id='chkGps' /> นำ <b>อุปกรณ์ติดตามพิกัด GPS และประวัติเส้นทางย้อนหลัง (GPSOne Trackers)</b> ไปด้วย</label>
              <label class='chk-row'><input type='checkbox' id='chkBrd' /> ใช้ชื่อหน่วยงานและโลโก้เดิมของเครื่องต้นทาง (ไม่ติ๊ก = ใช้ชื่อและโลโก้ที่ตั้งด้านล่าง)</label>
            </div>
          </div>

          <!-- Option 3: Full Server Clone -->
          <div class='mode-card' id='cardFull' onclick=""selectMode('full')"">
            <div class='mode-head'>
              <div class='mode-title'>
                <span class='mode-ico'>
                  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#c084fc' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><ellipse cx='12' cy='5' rx='9' ry='3'/><path d='M21 12c0 1.66-4 3-9 3s-9-1.34-9-3'/><path d='M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5'/></svg>
                </span>
                <span>4. ติดตั้งเป็นเครื่องแม่ข่ายโคลน 100% (Server: Full System Clone)</span>
              </div>
              <span class='mode-tag'>โคลนเซิร์ฟเวอร์ 100%</span>
            </div>
            <div class='mode-sub'>ยกการตั้งค่าเซิร์ฟเวอร์ทุกอย่างจากเครื่องเดิมมาทั้งหมด 100% (กล้อง + หมุดแผนที่ + ผู้ใช้ + GPS + ทะเบียนเฝ้าระวัง + Telegram Bot)</div>
          </div>
        </div>

        <!-- Server Machine Identity, Logo, URL, Token & Telegram Bot Panel (shown when Clean/Custom/Full Server is selected) -->
        <div id='serverIdentityBox' style='display:none; background:linear-gradient(180deg, rgba(28,22,54,0.78), rgba(16,13,32,0.78)); border:1px solid rgba(168,85,247,0.42); border-radius:12px; padding:12px 14px; flex-direction:column; gap:8px;'>
          <div style='font-size:12.5px; font-weight:700; color:#e9d5ff; display:flex; align-items:center; gap:7px;'>
            <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#c084fc' stroke-width='2.2'><path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/></svg>
            <span>ตั้งค่าประจำเครื่องแม่ข่าย (โลโก้ · ชื่อหน่วยงาน · URL · Token · Telegram Bot &amp; AI สกัดข้อมูล) — เปลี่ยนภายหลังในหน้าเว็บได้ตลอดเวลา</span>
          </div>
          <div style='display:grid; grid-template-columns:1fr 1fr 1.4fr; gap:8px;'>
            <div>
              <label style='font-size:11px;color:#9aa0bd;'>ชื่อหลักระบบ (มุมบนซ้าย)</label>
              <input type='text' id='inpSystemTitle' class='inp-box' value='Sloth' placeholder='เช่น Sloth' />
            </div>
            <div>
              <label style='font-size:11px;color:#9aa0bd;'>ชื่อหน่วยงาน / รหัสหน่วย</label>
              <input type='text' id='inpSystemSub' class='inp-box' value='BPP 215' placeholder='เช่น BPP 215' />
            </div>
            <div>
              <label style='font-size:11px;color:#9aa0bd;'>โลโก้มุมบน (เว้นว่าง = ใช้โลโก้มาตรฐาน)</label>
              <div style='display:flex;gap:6px;'>
                <input type='text' id='inpLogoPath' class='inp-box' readonly placeholder='มาตรฐาน (BPP215.png)' />
                <button type='button' class='btn' style='padding:6px 10px;font-size:11.5px;white-space:nowrap;' onclick=""window.chrome.webview.postMessage('PICK_LOGO')"">เลือกรูป</button>
              </div>
            </div>
          </div>
          <div style='display:grid; grid-template-columns:1fr 1.2fr; gap:8px;'>
            <div>
              <label style='font-size:11px;color:#9aa0bd;'>โดเมน / URL เครื่องนี้ (เว้นว่าง = ใช้ค่าเดิม)</label>
              <input type='text' id='inpPublicDomain' class='inp-box' placeholder='เช่น sloth.bpp215.com' />
            </div>
            <div>
              <label style='font-size:11px;color:#9aa0bd;'>Cloudflare Tunnel Token (เว้นว่าง = ใช้ค่าเดิม)</label>
              <input type='password' id='inpCfToken' class='inp-box' placeholder='eyJhIjoi... (เฉพาะกรณีเปลี่ยนโดเมนใหม่)' />
            </div>
          </div>
          <div style='display:grid; grid-template-columns:1.2fr 0.8fr 1fr; gap:8px;'>
            <div>
              <label style='font-size:11px;color:#9aa0bd;'>Telegram Bot Token (เว้นว่าง = ใช้บอทเดิม)</label>
              <input type='text' id='inpTgToken' class='inp-box' placeholder='123456:AAH...' />
            </div>
            <div>
              <label style='font-size:11px;color:#9aa0bd;'>Telegram Chat ID แจ้งเตือนหลัก</label>
              <input type='text' id='inpTgChatId' class='inp-box' placeholder='เช่น 6926293936' />
            </div>
            <div>
              <label style='font-size:11px;color:#9aa0bd;'>Gemini API Key (AI สกัดภาพ/เชื่อมโยง i2)</label>
              <input type='password' id='inpGeminiKey' class='inp-box' placeholder='เว้นว่าง = ใช้คีย์เดิม' />
            </div>
          </div>
        </div>

        <div class='opt-box'>
          <label class='chk-row'><input type='checkbox' id='chkDesktop' checked /> สร้างไอคอนบนหน้าจอ Desktop</label>
          <label class='chk-row'><input type='checkbox' id='chkStartMenu' checked /> สร้างทางลัดใน Start Menu</label>
          <label class='chk-row'><input type='checkbox' id='chkAutoStart' /> เปิดโปรแกรมอัตโนมัติเมื่อเปิดเครื่อง Windows</label>
        </div>

        <div class='footer-nav'>
          <div style='font-size:12px;color:#9aa0bd;'>ทั้งเครื่องแม่ข่ายและเครื่องลูกข่ายสามารถกดปุ่มอัปเดตที่มุมขวาบนได้เหมือนกัน</div>
          <button class='btn btn-primary' onclick='startInstall()'>
            <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='2.3' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>
            <span>เริ่มติดตั้งระบบ (Install Now)</span>
          </button>
        </div>
      </div>

      <!-- PAGE 2: Installing Progress -->
      <div class='page' id='page2'>
        <div>
          <h2>กำลังติดตั้งและกำหนดค่าระบบ SLOTH × BPP-VMS...</h2>
          <p class='desc'>กรุณารอสักครู่ ระบบกำลังเตรียมสภาพแวดล้อมและตั้งค่าโหมดที่คุณเลือก</p>
        </div>

        <div class='progress-wrap'>
          <div style='display:flex;justify-content:space-between;font-size:13.5px;font-weight:700;'>
            <span id='lblProgressStatus'>กำลังเริ่มต้นกระบวนการติดตั้ง...</span>
            <span id='lblProgressPct' style='color:#c084fc;'>0%</span>
          </div>
          <div class='pbar-bg'><div class='pbar-fill' id='pbarFill'></div></div>
          <div class='log-box' id='logBox'></div>
        </div>
      </div>

      <!-- PAGE 3: Complete -->
      <div class='page' id='page3'>
        <div style='text-align:center;padding:28px 16px;'>
          <div style='width:68px;height:68px;border-radius:50%;background:rgba(16,185,129,0.2);border:2px solid #34e2a8;display:inline-flex;align-items:center;justify-content:center;font-size:32px;color:#34e2a8;margin-bottom:16px;'>✓</div>
          <h2 style='font-size:23px;color:#34e2a8;'>ติดตั้ง SLOTH × BPP-VMS 215 เสร็จสมบูรณ์!</h2>
          <p class='desc' style='margin-top:8px;max-width:520px;margin-left:auto;margin-right:auto;'>
            ระบบพร้อมใช้งานบนเครื่อง <b>" + pcName + @"</b> เรียบร้อยแล้ว พร้อมปุ่มกดอัปเดตที่มุมขวาบนของโปรแกรม
          </p>
          <div style='margin-top:26px;'>
            <button class='btn btn-success' style='font-size:15px;padding:12px 28px;' onclick=""window.chrome.webview.postMessage('LAUNCH_AND_CLOSE')"">
              <span>เสร็จสิ้นและเปิดโปรแกรม SLOTH × BPP-VMS ทันที</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

<script>
  var currentMode = 'client';
  function selectMode(m) {
    currentMode = m;
    document.getElementById('cardClient').classList.toggle('selected', m === 'client');
    document.getElementById('cardClean').classList.toggle('selected', m === 'clean');
    document.getElementById('cardCustom').classList.toggle('selected', m === 'custom');
    document.getElementById('cardFull').classList.toggle('selected', m === 'full');
    var sbox = document.getElementById('serverIdentityBox');
    if (sbox) sbox.style.display = (m === 'client') ? 'none' : 'flex';
  }

  window.onLogoPicked = function(path) {
    var inp = document.getElementById('inpLogoPath');
    if (inp) inp.value = path || '';
  };

  function setServerPreset(url) {
    document.getElementById('inpServerUrl').value = url;
    testServerConnection();
  }

  function testServerConnection() {
    var srv = (document.getElementById('inpServerUrl').value || 'https://sloth.bpp215.com').trim();
    var lbl = document.getElementById('lblTestServerStatus');
    if (lbl) {
      lbl.style.color = '#38bdf8';
      lbl.textContent = '⏳ กำลังทดสอบการเชื่อมต่อ...';
    }
    window.chrome.webview.postMessage('TEST_SERVER:' + srv);
  }

  window.onServerTestResult = function(ok, msg) {
    var lbl = document.getElementById('lblTestServerStatus');
    if (!lbl) return;
    lbl.style.color = ok ? '#34d399' : '#f87171';
    lbl.textContent = (ok ? '✅ ' : '⚠️ ') + msg;
  };

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
    var title = (document.getElementById('inpSystemTitle').value || 'Sloth').replace(/\|/g, ' ');
    var sub = (document.getElementById('inpSystemSub').value || 'BPP 215').replace(/\|/g, ' ');
    var logo = (document.getElementById('inpLogoPath').value || '').replace(/\|/g, '');
    var dom = (document.getElementById('inpPublicDomain').value || '').replace(/\|/g, '');
    var cf = (document.getElementById('inpCfToken').value || '').replace(/\|/g, '');
    var tg = (document.getElementById('inpTgToken').value || '').replace(/\|/g, '');
    var chat = (document.getElementById('inpTgChatId').value || '').replace(/\|/g, '');
    var gem = (document.getElementById('inpGeminiKey').value || '').replace(/\|/g, '');
    var srv = (document.getElementById('inpServerUrl').value || 'https://sloth.bpp215.com').replace(/\|/g, '');

    var payload = 'INSTALL:mode=' + currentMode +
                  '|cam=' + cam + '|usr=' + usr + '|gps=' + gps + '|lpr=' + lpr + '|brd=' + brd +
                  '|dsk=' + dsk + '|stm=' + stm + '|aut=' + aut +
                  '|title=' + title + '|sub=' + sub + '|logo=' + logo +
                  '|dom=' + dom + '|cf=' + cf + '|tg=' + tg + '|chat=' + chat + '|gem=' + gem + '|srv=' + srv;
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
    }

    public static class Program
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetDllDirectory(string lpPathName);

        [STAThread]
        public static void Main()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string nativeSub = Path.Combine(baseDir, "native");
            if (Directory.Exists(nativeSub))
            {
                try { SetDllDirectory(nativeSub); } catch { }
            }

            AppDomain.CurrentDomain.AssemblyResolve += (sender, args) =>
            {
                try
                {
                    string asmName = new AssemblyName(args.Name).Name + ".dll";
                    string candidate = Path.Combine(baseDir, "native", asmName);
                    if (File.Exists(candidate))
                    {
                        return Assembly.LoadFrom(candidate);
                    }
                }
                catch
                {
                }
                return null;
            };

            RunWizard();
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private static void RunWizard()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupWizardForm());
        }
    }
}
