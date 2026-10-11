$content = Get-Content 'web\assets\app.css' -Raw
$restore = @'
.emgr-card:hover { border-color: rgba(168,85,247,.6); box-shadow: 0 0 18px rgba(168,85,247,.28); transform: translateY(-2px); }
.emgr-card-thumb { position: relative; aspect-ratio: 16/9; background: #0a0c18 center/cover no-repeat; }
.emgr-card-conf { position: absolute; top: 6px; right: 6px; font-size: 10px; font-weight: 600; color: #eef0f8; background: rgba(6,7,15,.75); border: 1px solid rgba(168,85,247,.3); padding: 1px 6px; border-radius: 5px; }
.emgr-card-clip { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: rgba(10,8,22,.55); border: 1px solid rgba(192,132,252,.55); }
.emgr-card-note { position: absolute; bottom: 6px; left: 6px; font-size: 11px; color: #34e2a8; background: rgba(6,7,15,.72); padding: 1px 6px; border-radius: 5px; }
/* badge ผลอ่านป้ายทะเบียน (จาก lpr-service) — มุมบนซ้าย (มุมอื่นถูกใช้แล้วโดย conf/clip/note) */
.emgr-card-plate { position: absolute; top: 6px; left: 6px; max-width: calc(100% - 12px); font-size: 10px; font-weight: 600; color: #0a2e22; background: #34e2a8; padding: 2px 7px; border-radius: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.emgr-card-meta { display: flex; align-items: center; gap: 6px; padding: 7px 9px; }
.emgr-card-meta .ch-chip { font-size: 9.5px; padding: 1px 5px; }
.emgr-card-time { margin-left: auto; font-size: 10.5px; color: #9aa0bd; }

/* event detail (snapshot / video tabs) */
.emgr-detail-overlay { z-index: 63; }
.emgr-detail-modal { width: min(880px, 100%); }
.emgr-detail-head { flex: none; display: flex; align-items: center; gap: 10px; padding: 13px 18px; border-bottom: 1px solid rgba(168,85,247,.25); }
.emgr-detail-head .type-chip { position: static; }
.emgr-detail-head .ch-chip { font-size: 11px; padding: 2px 7px; }
.emgr-detail-head .player-cam-name { font-size: 15px; }
.emgr-tabs { flex: none; display: flex; gap: 4px; padding: 8px 18px 0; border-bottom: 1px solid rgba(168,85,247,.18); }
.emgr-tab { padding: 9px 16px; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; background: transparent; color: #9aa0bd; cursor: pointer; font-family: 'Kanit', sans-serif; font-size: 13px; transition: all .15s; }
'@

$content = $content -replace '\.emgr-card:hover \{ border-color: rgba\(168,85,247,\.6\); box-shadow: 0 0 18px rgba\(168,85,247,\.28\); transform: translateY\(-2px\); \}', $restore
Set-Content 'web\assets\app.css' $content -Encoding UTF8
