<#
.SYNOPSIS
Converts queued IBM i2 Analyst's Notebook .anb charts into BPP normalized graph JSON.

.DESCRIPTION
This Windows-only helper must run under 32-bit Windows PowerShell in the signed-in account
that owns a valid Analyst's Notebook license. It watches the bind-mounted bridge queue,
opens one chart at a time through the registered LinkNotebook.Application.7 COM API, and
writes an atomic result. Raw .anb files are never deleted. Logs and error files contain
only stable job IDs/counts/error types, never chart labels, attributes, or phone numbers.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$BridgeRoot = '',

    [Parameter(Mandatory = $false)]
    [switch]$Once,

    [Parameter(Mandatory = $false)]
    [ValidateRange(1, 60)]
    [int]$PollSeconds = 5
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($BridgeRoot)) {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
    $BridgeRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..\runtime\i2-bridge'))
}
$script:MaxAttributeLength = 4096
# Optimize bridge process priority and P-core affinity (Intel Core i5-14500: Cores 0-5 HT = Logical 0-11, Mask 4095)
try {
    $currentProc = [System.Diagnostics.Process]::GetCurrentProcess()
    $currentProc.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::High
    $currentProc.ProcessorAffinity = [IntPtr]4095
} catch { }

function Write-BridgeStatus {
    <# Write a PII-free operational status line with timestamp and stable job ID to console and rolling bridge.log. #>
    param([string]$JobId, [string]$Status, [hashtable]$Counts = @{})

    $parts = @((Get-Date).ToUniversalTime().ToString('o'), "job=$JobId", "status=$Status")
    foreach ($key in ($Counts.Keys | Sort-Object)) {
        $parts += "$key=$($Counts[$key])"
    }
    $line = $parts -join ' '
    Write-Host $line

    try {
        $root = if ($script:BridgeRoot) { $script:BridgeRoot } else { $BridgeRoot }
        if ($root) {
            $logPath = Join-Path $root 'bridge.log'
            if (Test-Path -LiteralPath $logPath) {
                $logFile = Get-Item -LiteralPath $logPath -ErrorAction SilentlyContinue
                if ($logFile -and $logFile.Length -gt 5242880) {
                    $oldLog = Join-Path $root 'bridge.log.old'
                    Move-Item -LiteralPath $logPath -Destination $oldLog -Force -ErrorAction SilentlyContinue
                }
            }
            [System.IO.File]::AppendAllText($logPath, "$line`r`n", [System.Text.UTF8Encoding]::new($false))
        }
    }
    catch { }
}

function Enter-BridgeLock {
    <# Hold an exclusive queue lock for this process; return null when another bridge owns it. #>
    param([string]$Root)

    [void](New-Item -ItemType Directory -Path $Root -Force)
    $lockPath = Join-Path $Root 'bridge.lock'
    try {
        return [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    }
    catch [IO.IOException] {
        return $null
    }
}

function Restore-InterruptedBridgeJobs {
    <# Requeue descriptors abandoned by a killed bridge while retaining raw input and completed results. #>
    param([string]$Root)

    $pendingRoot = Join-Path $Root 'jobs\pending'
    $processingRoot = Join-Path $Root 'jobs\processing'
    $doneRoot = Join-Path $Root 'jobs\done'
    $outboxRoot = Join-Path $Root 'outbox'
    foreach ($directory in @($pendingRoot, $processingRoot, $doneRoot, $outboxRoot)) {
        [void](New-Item -ItemType Directory -Path $directory -Force)
    }
    foreach ($processing in (Get-ChildItem -LiteralPath $processingRoot -Filter '*.json' -File)) {
        $jobId = [IO.Path]::GetFileNameWithoutExtension($processing.Name)
        try {
            $descriptor = Get-Content -LiteralPath $processing.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
            if ([string]$descriptor.job_id) { $jobId = [string]$descriptor.job_id }
        }
        catch {
            $invalidName = "$([IO.Path]::GetFileNameWithoutExtension($processing.Name)).invalid-$([Guid]::NewGuid().ToString('N').Substring(0, 8)).json"
            Move-Item -LiteralPath $processing.FullName -Destination (Join-Path $doneRoot $invalidName) -Force
            Write-BridgeStatus -JobId $jobId -Status 'retired_invalid_descriptor'
            continue
        }
        $resultPath = Join-Path $outboxRoot "$jobId.json"
        $errorPath = Join-Path $outboxRoot "$jobId.error.json"
        if ((Test-Path -LiteralPath $resultPath) -or (Test-Path -LiteralPath $errorPath)) {
            Move-Item -LiteralPath $processing.FullName -Destination (Join-Path $doneRoot $processing.Name) -Force
            Write-BridgeStatus -JobId $jobId -Status 'recovered_completed'
            continue
        }
        $pendingPath = Join-Path $pendingRoot $processing.Name
        if (-not (Test-Path -LiteralPath $pendingPath)) {
            Move-Item -LiteralPath $processing.FullName -Destination $pendingPath
            Write-BridgeStatus -JobId $jobId -Status 'requeued_interrupted'
            continue
        }
        $retainedName = "$([IO.Path]::GetFileNameWithoutExtension($processing.Name)).interrupted-$([Guid]::NewGuid().ToString('N').Substring(0, 8)).json"
        Move-Item -LiteralPath $processing.FullName -Destination (Join-Path $doneRoot $retainedName)
        Write-BridgeStatus -JobId $jobId -Status 'retained_duplicate_descriptor'
    }
}
$csharpCode = @"
using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Linq;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;
using System.Threading;
using Interop.i2NotebookData;

public class PhotoHelper : AxHost
{
    public PhotoHelper() : base("59EE46BA-677D-4d20-BF10-84080005563D") { }

    public static Image GetImage(object comPic)
    {
        if (comPic == null) return null;
        try {
            return GetPictureFromIPicture(comPic);
        } catch {
            return null;
        }
    }
}

public class I2ChartExtractor
{
    private static int _maxAttributeLength = 4096;

    public static string ConvertI2Colour(dynamic styleTypeColour)
    {
        try {
            long number = (long)styleTypeColour;
            long red = number & 0xFF;
            long green = (number >> 8) & 0xFF;
            long blue = (number >> 16) & 0xFF;
            return string.Format("#{0:X2}{1:X2}{2:X2}", red, green, blue);
        } catch {
            return null;
        }
    }

    public static string GetSafeComText(dynamic value)
    {
        if (value == null) return null;
        try {
            string text = (string)value.ToString();
            if (string.IsNullOrEmpty(text)) return null;
            if (text.Length > _maxAttributeLength) {
                return text.Substring(0, _maxAttributeLength);
            }
            return text;
        } catch {
            return null;
        }
    }

    public static string GetI2ItemId(dynamic item)
    {
        string guid = GetSafeComText(item.GuidId);
        if (!string.IsNullOrEmpty(guid)) return guid;
        try { return "item_" + item.Id; } catch { return null; }
    }

    public static string GetI2SemanticName(dynamic item)
    {
        try {
            string name = GetSafeComText(item.EffectiveSemanticType.Name);
            if (!string.IsNullOrEmpty(name)) return name;
        } catch { }
        try { return GetSafeComText(item.SemanticType.Name); } catch { return null; }
    }

    public static string ResolveBppGroup(string semanticType, string typeName, string label, string photoPath)
    {
        if (!string.IsNullOrEmpty(photoPath)) return "person";
        if (!string.IsNullOrEmpty(label)) {
            if (Regex.IsMatch(label, @"\b\d{1}-?\d{4}-?\d{5}-?\d{2}-?\d{1}\b|\b\d{13}\b")) return "person";
            if (Regex.IsMatch(label, @"^(นาย|นาง|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\.|พล|ร\.ต|พ\.ต|ร้อย|พัน|ดาบ|จ่า)")) return "person";
        }
        string probe = ((semanticType ?? "") + " " + (typeName ?? "")).ToLowerInvariant();
        if (Regex.IsMatch(probe, "person|people|individual|บุคคล|ผู้ต้องหา")) return "person";
        if (Regex.IsMatch(probe, "phone|telephone|mobile|โทรศัพท์|เบอร์")) return "phone";
        if (Regex.IsMatch(probe, "address|location|place|ที่อยู่|สถานที่")) return "address";
        if (Regex.IsMatch(probe, "parcel|package|shipment|พัสดุ")) return "parcel";
        if (Regex.IsMatch(probe, "organization|company|business|องค์กร|บริษัท")) return "organization";
        if (Regex.IsMatch(probe, "vehicle|car|รถ")) return "vehicle";
        return "entity";
    }

    public static string GetI2AttributesJson(dynamic item)
    {
        var attrs = new List<string>();
        try {
            int count = (int)item.AttributeCount;
            for (int i = 0; i < count; i++) {
                try {
                    dynamic attrClass = item.Attributes(i);
                    string name = GetSafeComText(attrClass.Name);
                    if (!string.IsNullOrEmpty(name)) {
                        string value = GetSafeComText(item.AttributeValue(attrClass));
                        if (value == null) value = "";
                        attrs.Add("\"" + EscapeJson(name) + "\":\"" + EscapeJson(value) + "\"");
                    }
                    Marshal.ReleaseComObject(attrClass);
                } catch { }
            }
        } catch { }
        return "{" + string.Join(",", attrs) + "}";
    }

    public static string GetI2EndEntityId(dynamic end)
    {
        try {
            if (end == null) return null;
            dynamic iterator = end.LinkedEntities;
            if (iterator == null) return null;
            try {
                int cnt = (int)iterator.Count;
                if (cnt == 0) return null;
            } catch { }
            iterator.MoveFirst();
            dynamic current = iterator.Current;
            if (current == null) return null;
            string id = GetI2ItemId(current);
            Marshal.ReleaseComObject(current);
            Marshal.ReleaseComObject(iterator);
            return id;
        } catch {
            return null;
        }
    }

    public static string ExtractI2Photo(dynamic item, string bridgeRoot, string jobId, string nodeId)
    {
        if (string.IsNullOrEmpty(bridgeRoot) || string.IsNullOrEmpty(jobId) || string.IsNullOrEmpty(nodeId)) return null;
        try {
            string cleanNodeId = nodeId.Replace("{", "").Replace("}", "");
            string mediaDir = Path.Combine(bridgeRoot, "media", jobId);
            if (!Directory.Exists(mediaDir)) Directory.CreateDirectory(mediaDir);

            // 1. Check linked picture file path
            string pictureFile = null;
            try { pictureFile = GetSafeComText(item.PictureFile); } catch { }
            if (string.IsNullOrEmpty(pictureFile)) {
                try { pictureFile = GetSafeComText(item.Style.PictureFile); } catch { }
            }

            if (!string.IsNullOrEmpty(pictureFile) && File.Exists(pictureFile)) {
                string ext = Path.GetExtension(pictureFile);
                if (string.IsNullOrEmpty(ext)) ext = ".jpg";
                string destFileName = cleanNodeId + ext;
                string destPath = Path.Combine(mediaDir, destFileName);
                File.Copy(pictureFile, destPath, true);
                return "media/" + jobId + "/" + destFileName;
            }

            // 2. Check embedded COM IPicture / IPictureDisp object
            object picObj = null;
            try { picObj = item.Picture; } catch { }
            if (picObj == null) {
                try { picObj = item.Style.Picture; } catch { }
            }
            if (picObj == null) {
                try {
                    int cardCount = (int)item.Cards.Count;
                    for (int c = 0; c < cardCount; c++) {
                        try {
                            dynamic card = item.Cards.Item(c);
                            picObj = card.Picture;
                            Marshal.ReleaseComObject(card);
                            if (picObj != null) break;
                        } catch { }
                    }
                } catch { }
            }
            if (picObj == null) {
                try {
                    if (item.OleObject != null) {
                        picObj = item.OleObject.Picture;
                    }
                } catch { }
            }

            if (picObj != null) {
                using (Image img = PhotoHelper.GetImage(picObj)) {
                    if (img != null && img.Width > 10 && img.Height > 10) {
                        string destFileName = cleanNodeId + ".jpg";
                        string destPath = Path.Combine(mediaDir, destFileName);
                        img.Save(destPath, ImageFormat.Jpeg);
                        return "media/" + jobId + "/" + destFileName;
                    }
                }
            }
        } catch { }
        return null;
    }

    public static string EscapeJson(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\b", "\\b")
                .Replace("\f", "\\f")
                .Replace("\n", "\\n")
                .Replace("\r", "\\r")
                .Replace("\t", "\\t");
    }

    public static string EscapeNullable(string s)
    {
        return s == null ? "null" : "\"" + EscapeJson(s) + "\"";
    }
    
    public static string EscapeNullableNum(double? n)
    {
        return n == null ? "null" : n.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    public static string ConvertI2NodeJson(dynamic item, string bridgeRoot, string jobId, Dictionary<string, string> nodePhotoMap)
    {
        string semantic = GetI2SemanticName(item);
        string typeName = null;
        string colour = null;
        string iconName = null;
        try {
            typeName = GetSafeComText(item.Style.Type.Name);
            colour = ConvertI2Colour(item.Style.Type.Colour);
            string iconPath = GetSafeComText(item.Style.Type.IconFile);
            if (!string.IsNullOrEmpty(iconPath)) iconName = Path.GetFileName(iconPath);
        } catch { }

        string nodeId = GetI2ItemId(item);
        if (string.IsNullOrEmpty(nodeId)) return null;
        string photoPath = null;
        if (nodePhotoMap != null) {
            if (!nodePhotoMap.TryGetValue(nodeId, out photoPath)) {
                string cleanId = nodeId.Replace("{", "").Replace("}", "");
                nodePhotoMap.TryGetValue(cleanId, out photoPath);
            }
        }
        if (string.IsNullOrEmpty(photoPath) && !string.IsNullOrEmpty(bridgeRoot) && !string.IsNullOrEmpty(jobId)) {
            photoPath = ExtractI2Photo(item, bridgeRoot, jobId, nodeId);
        }

        string label = GetSafeComText(item.Label);
        string description = GetSafeComText(item.Description);
        string identity = null;
        try { identity = GetSafeComText(item.Identity); } catch { }
        string srcRef = null;
        try { srcRef = GetSafeComText(item.SourceReference); } catch { }
        string srcType = null;
        try { srcType = GetSafeComText(item.SourceType); } catch { }
        string group = ResolveBppGroup(semantic, typeName, label, photoPath);

        int x = 0, y = 0, z = 0;
        try { x = (int)item.X; } catch { }
        try { y = (int)item.Y; } catch { }
        try { z = (int)item.Z; } catch { }

        string attrsJson = GetI2AttributesJson(item);

        return "{" +
            "\"id\":\"" + EscapeJson(nodeId) + "\"," +
            "\"label\":" + EscapeNullable(label) + "," +
            "\"description\":" + EscapeNullable(description) + "," +
            "\"identity\":" + EscapeNullable(identity) + "," +
            "\"semantic_type\":" + EscapeNullable(semantic) + "," +
            "\"source_reference\":" + EscapeNullable(srcRef) + "," +
            "\"source_type\":" + EscapeNullable(srcType) + "," +
            "\"type\":\"" + group + "\"," +
            "\"group\":\"" + group + "\"," +
            "\"photo_path\":" + EscapeNullable(photoPath) + "," +
            "\"position\":{\"x\":" + x + ",\"y\":" + y + ",\"z\":" + z + "}," +
            "\"style\":{\"type_name\":" + EscapeNullable(typeName) + ",\"colour\":" + EscapeNullable(colour) + ",\"icon_name\":" + EscapeNullable(iconName) + ",\"icon_policy\":\"map_to_bpp_equivalent\"}," +
            "\"attributes\":" + attrsJson +
            "}";
    }

    private static void ClearClipboardSta()
    {
        if (Thread.CurrentThread.GetApartmentState() == ApartmentState.STA) {
            Clipboard.Clear();
        } else {
            Thread t = new Thread(() => {
                try { Clipboard.Clear(); } catch { }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            t.Join();
        }
    }

    private static Image GetClipboardImageSta()
    {
        Image result = null;
        if (Thread.CurrentThread.GetApartmentState() == ApartmentState.STA) {
            try {
                if (Clipboard.ContainsImage()) result = Clipboard.GetImage();
            } catch { }
        } else {
            Thread t = new Thread(() => {
                try {
                    if (Clipboard.ContainsImage()) result = Clipboard.GetImage();
                } catch { }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            t.Join();
        }
        return result;
    }

    private static byte[] GetClipboardDataSta(string format)
    {
        byte[] result = null;
        if (Thread.CurrentThread.GetApartmentState() == ApartmentState.STA) {
            var stream = Clipboard.GetData(format) as MemoryStream;
            if (stream != null) result = stream.ToArray();
        } else {
            Thread t = new Thread(() => {
                try {
                    var stream = Clipboard.GetData(format) as MemoryStream;
                    if (stream != null) result = stream.ToArray();
                } catch { }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            t.Join();
        }
        return result;
    }

    public static byte[] ExtractBmpFromClipboardStream(byte[] data)
    {
        if (data == null || data.Length < 20) return null;
        for (int i = 0; i < data.Length - 10; i++)
        {
            if (data[i] == 0x78 && (data[i+1] == 0xda || data[i+1] == 0x9c || data[i+1] == 0x01))
            {
                if (i >= 8)
                {
                    int c_len = BitConverter.ToInt32(data, i - 8);
                    if (c_len > 1000 && i + c_len <= data.Length)
                    {
                        try
                        {
                            using (var ms = new MemoryStream(data, i + 2, c_len - 2))
                            using (var ds = new DeflateStream(ms, CompressionMode.Decompress))
                            using (var decomp = new MemoryStream())
                            {
                                byte[] temp = new byte[65536];
                                int r;
                                while ((r = ds.Read(temp, 0, temp.Length)) > 0)
                                {
                                    decomp.Write(temp, 0, r);
                                }
                                byte[] dib = decomp.ToArray();
                                if (dib.Length > 40 && dib[0] == 0x28 && dib[1] == 0x00 && dib[2] == 0x00 && dib[3] == 0x00)
                                {
                                    int w = BitConverter.ToInt32(dib, 4);
                                    int h = BitConverter.ToInt32(dib, 8);
                                    short planes = BitConverter.ToInt16(dib, 12);
                                    short bpp = BitConverter.ToInt16(dib, 14);

                                    if (w > 16 && w < 5000 && Math.Abs(h) > 16 && Math.Abs(h) < 5000 && planes == 1 && (bpp == 24 || bpp == 32 || bpp == 16 || bpp == 8))
                                    {
                                        int clrs = BitConverter.ToInt32(dib, 32);
                                        int palSize = (bpp <= 8) ? ((clrs == 0 ? (1 << bpp) : clrs) * 4) : 0;
                                        int offBits = 14 + 40 + palSize;
                                        int fileSize = 14 + dib.Length;

                                        byte[] bmp = new byte[fileSize];
                                        bmp[0] = 0x42; bmp[1] = 0x4D;
                                        Buffer.BlockCopy(BitConverter.GetBytes(fileSize), 0, bmp, 2, 4);
                                        Buffer.BlockCopy(BitConverter.GetBytes(offBits), 0, bmp, 10, 4);
                                        Buffer.BlockCopy(dib, 0, bmp, 14, dib.Length);
                                        return bmp;
                                    }
                                }
                            }
                        }
                        catch { }
                    }
                }
            }
        }
        return null;
    }

    public static Dictionary<string, string> ExtractChartPhotosFromCom(dynamic chart, string mediaDir, string jobId)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (chart == null) return result;
        try {
            if (!Directory.Exists(mediaDir)) Directory.CreateDirectory(mediaDir);

            dynamic iterator = chart.ChartItems(0, 0);
            iterator.MoveFirst();
            while (true) {
                dynamic item = null;
                try { item = iterator.Current; } catch { break; }
                if (item == null) break;

                int itemType = 0;
                try { itemType = (int)item.ItemType; } catch { }

                if (((itemType & 1) == 1) || ((itemType & 3) > 0)) {
                    bool hasPic = false;
                    try {
                        LNPictureOwner po = item.Style as LNPictureOwner;
                        if (po != null) hasPic = po.HasPicture;
                    } catch { }

                    if (hasPic) {
                        string guidId = null;
                        try { guidId = (string)item.GuidId; } catch { }
                        if (!string.IsNullOrEmpty(guidId)) {
                            string cleanId = guidId.Replace("{", "").Replace("}", "");
                            string destPath = Path.Combine(mediaDir, cleanId + ".jpg");
                            string relPath = "media/" + jobId + "/" + cleanId + ".jpg";

                            try {
                                chart.ClearSelection();
                                item.Selected = true;
                                ClearClipboardSta();
                                chart.Commands.CallCommand(12285);
                                Image img = GetClipboardImageSta();
                                if (img == null) {
                                    byte[] streamBytes = GetClipboardDataSta("Link Notebook Chart V7");
                                    if (streamBytes != null) {
                                        byte[] bmp = ExtractBmpFromClipboardStream(streamBytes);
                                        if (bmp != null) {
                                            using (var bmpMs = new MemoryStream(bmp)) {
                                                img = Image.FromStream(bmpMs);
                                            }
                                        }
                                    }
                                }
                                if (img != null) {
                                    if (File.Exists(destPath)) {
                                        try { File.Delete(destPath); } catch { }
                                    }
                                    img.Save(destPath, ImageFormat.Jpeg);
                                    img.Dispose();
                                    result[guidId] = relPath;
                                    result[cleanId] = relPath;
                                }
                            } catch { }
                        }
                    }
                }

                try { Marshal.ReleaseComObject(item); } catch { }
                bool atLast = false;
                try { atLast = Convert.ToBoolean(iterator.AtLast); } catch { }
                if (atLast) break;
                try { iterator.MoveNext(); } catch { break; }
            }
            try { Marshal.ReleaseComObject(iterator); } catch { }
            try { chart.ClearSelection(); } catch { }
        } catch { }
        return result;
    }

    public static string ConvertI2LinkJson(dynamic item)
    {
        string semantic = GetI2SemanticName(item);
        string lineColour = null;
        double? lineWidth = null;
        try { lineColour = ConvertI2Colour(item.Style.LineColour); } catch { }
        try { lineWidth = (double)item.Style.LineWidth; } catch { }

        string arrows = "none";
        try {
            bool end1HasArrow = false;
            bool end2HasArrow = false;
            if (item.End1 != null && (item.End1.ArrowType > 0 || item.End1.ArrowStyle > 0)) end1HasArrow = true;
            if (item.End2 != null && (item.End2.ArrowType > 0 || item.End2.ArrowStyle > 0)) end2HasArrow = true;
            
            int? styleArrow = null;
            try { styleArrow = (int)item.Style.ArrowStyle; } catch { }
            
            if (styleArrow == 3) {
                end1HasArrow = true;
                end2HasArrow = true;
            } else if (styleArrow == 1) {
                end1HasArrow = true;
            } else if (styleArrow == 2) {
                end2HasArrow = true;
            }
            
            if (end1HasArrow && end2HasArrow) arrows = "to;from";
            else if (end2HasArrow) arrows = "to";
            else if (end1HasArrow) arrows = "from";
        } catch { }

        if (arrows == "none") {
            if (Regex.IsMatch(semantic ?? "", "Call To|Phone Call To|โทรหา|➔", RegexOptions.IgnoreCase)) arrows = "to";
            else if (Regex.IsMatch(semantic ?? "", "Call From|Phone Call From|รับสาย|⬅", RegexOptions.IgnoreCase)) arrows = "from";
            else if (Regex.IsMatch(semantic ?? "", "Transfer|โอน", RegexOptions.IgnoreCase)) arrows = "to";
        }

        string edgeType = "relationship";
        string label = GetSafeComText(item.Label);
        string description = GetSafeComText(item.Description);
        string probe = ((semantic ?? "") + " " + (label ?? "") + " " + (description ?? "")).ToLowerInvariant();
        if (Regex.IsMatch(probe, "phone|call|โทร|cdr|สาย")) edgeType = "call";
        else if (Regex.IsMatch(probe, "transfer|money|bank|บาท|฿|โอน|statement|ยอด")) edgeType = "money_transfer";
        else if (Regex.IsMatch(probe, "parcel|flash|shipment|พัสดุ")) edgeType = "parcel";

        var callLines = new List<string>();
        try {
            if (item.Cards != null) {
                int cardCount = (int)item.Cards.Count;
                for (int c = 0; c < cardCount; c++) {
                    dynamic card = item.Cards(c);
                    string cardText = GetSafeComText(card.Text);
                    if (!string.IsNullOrEmpty(cardText)) callLines.Add("\"" + EscapeJson(cardText) + "\"");
                    Marshal.ReleaseComObject(card);
                }
            }
        } catch { }
        if (callLines.Count == 0 && !string.IsNullOrEmpty(label)) {
            string[] lines = label.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length > 1) {
                foreach (string l in lines) {
                    if (!string.IsNullOrWhiteSpace(l)) callLines.Add("\"" + EscapeJson(l.Trim()) + "\"");
                }
            }
        }

        var bendPoints = new List<string>();
        try {
            int cornerCount = 0;
            try { cornerCount = (int)item.CornerCount; } catch { }
            if (cornerCount > 0) {
                for (int p = 0; p < cornerCount; p++) {
                    dynamic corner = null;
                    try {
                        corner = item.Corner(p);
                    } catch {
                        try { corner = item.Corner(p + 1); } catch { }
                    }
                    if (corner != null) {
                        try {
                            int cx = (int)corner.X;
                            int cy = (int)corner.Y;
                            bendPoints.Add("{\"x\":" + cx + ",\"y\":" + cy + "}");
                        } catch { }
                        try { Marshal.ReleaseComObject(corner); } catch { }
                    }
                }
            } else if (item.Points != null) {
                int ptCount = (int)item.Points.Count;
                for (int p = 0; p < ptCount; p++) {
                    dynamic pt = item.Points(p);
                    bendPoints.Add("{\"x\":" + (int)pt.X + ",\"y\":" + (int)pt.Y + "}");
                    Marshal.ReleaseComObject(pt);
                }
            }
        } catch { }

        string id = GetI2ItemId(item);
        if (string.IsNullOrEmpty(id)) return null;

        string fromId = GetI2EndEntityId(item.End1);
        string toId = GetI2EndEntityId(item.End2);

        string srcRef = null;
        try { srcRef = GetSafeComText(item.SourceReference); } catch { }
        string srcType = null;
        try { srcType = GetSafeComText(item.SourceType); } catch { }

        string attrsJson = GetI2AttributesJson(item);

        return "{" +
            "\"id\":\"" + EscapeJson(id) + "\"," +
            "\"from\":" + EscapeNullable(fromId) + "," +
            "\"to\":" + EscapeNullable(toId) + "," +
            "\"label\":" + EscapeNullable(label) + "," +
            "\"description\":" + EscapeNullable(description) + "," +
            "\"semantic_type\":" + EscapeNullable(semantic) + "," +
            "\"type\":\"" + edgeType + "\"," +
            "\"source_reference\":" + EscapeNullable(srcRef) + "," +
            "\"source_type\":" + EscapeNullable(srcType) + "," +
            "\"color\":" + EscapeNullable(lineColour) + "," +
            "\"width\":" + EscapeNullableNum(lineWidth) + "," +
            "\"arrows\":\"" + arrows + "\"," +
            "\"call_lines\":[" + string.Join(",", callLines) + "]," +
            "\"bend_points\":[" + string.Join(",", bendPoints) + "]," +
            "\"attributes\":" + attrsJson +
            "}";
    }

    public static Dictionary<string, int> ProcessChart(string inputPath, string jobId, int maxItems, string bridgeRoot, string outputPath)
    {
        string tempOutput = outputPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        string tempNodes = tempOutput + ".nodes.tmp";
        string tempLinks = tempOutput + ".links.tmp";
        string progressFile = Path.Combine(bridgeRoot, "progress.json");

        dynamic application = null;
        dynamic chart = null;

        StreamWriter nodesStream = null;
        StreamWriter linksStream = null;
        StreamWriter finalStream = null;

        try {
            Type type = Type.GetTypeFromProgID("LinkNotebook.Application.7");
            application = Activator.CreateInstance(type);
            application.Visible = false;
            application.Charts.Open(inputPath);
            chart = application.CurrentChart;
            if (chart == null) throw new Exception("ChartNotOpened");

            // ─── Extract embedded DIB photos accurately via i2 COM clipboard command 12285 ─────
            string mediaDir = System.IO.Path.Combine(bridgeRoot, "media", jobId);
            Dictionary<string, string> nodePhotoMap = ExtractChartPhotosFromCom(chart, mediaDir, jobId);

            // Optimize CPU Affinity & Priority on Intel Core i5-14500 (P-cores 0-5 mask: 0xFFF = 4095)
            try {
                Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.High;
                Process.GetCurrentProcess().ProcessorAffinity = (IntPtr)4095;
                foreach (var p in Process.GetProcessesByName("ANB")) {
                    try {
                        p.PriorityClass = ProcessPriorityClass.High;
                        p.ProcessorAffinity = (IntPtr)4095;
                    } catch { }
                }
            } catch { }

            nodesStream = new StreamWriter(tempNodes, false, new UTF8Encoding(false), 65536);
            linksStream = new StreamWriter(tempLinks, false, new UTF8Encoding(false), 65536);

            HashSet<string> knownIds = new HashSet<string>(StringComparer.Ordinal);
            // nodePositionMap stores each node's canvas position for OLE photo proximity matching (Phase 2)
            Dictionary<string, int[]> nodePositionMap = new Dictionary<string, int[]>(StringComparer.Ordinal);
            Dictionary<string, string> nodeLabelMap = new Dictionary<string, string>(StringComparer.Ordinal);
            int nodeCount = 0;
            int linkCount = 0;
            int total = 0;
            
            Stopwatch sw = Stopwatch.StartNew();
            double lastProgSec = 0;
            int lastAdvanceTotal = 0;
            double lastAdvanceTime = 0;

            dynamic iterator = chart.ChartItems(0, 0);
            try { iterator.MoveFirst(); } catch { }
            while (true) {
                dynamic item = null;
                try {
                    item = iterator.Current;
                } catch {
                    break; // Reached end of collection (COM throws "At EOF")
                }
                if (item == null) break;

                int itemType = 0;
                try { itemType = (int)item.ItemType; } catch { }
                total++;

                if (((itemType & 1) == 1) || ((itemType & 3) > 0)) {
                    try {
                        string nodeJson = ConvertI2NodeJson(item, bridgeRoot, jobId, nodePhotoMap);
                        if (nodeJson != null) {
                            string id = GetI2ItemId(item);
                            if (id != null) {
                                knownIds.Add(id);
                                // Store canvas position for OLE picture proximity matching in Phase 2
                                int nx = 0, ny = 0;
                                try { nx = (int)item.X; } catch { }
                                try { ny = (int)item.Y; } catch { }
                                nodePositionMap[id] = new int[] { nx, ny };
                                string lbl = "";
                                try { lbl = item.Label; } catch { }
                                nodeLabelMap[id] = lbl ?? "";
                                if (nodeCount > 0) nodesStream.Write(",");
                                nodesStream.Write(nodeJson);
                                nodeCount++;
                            }
                        }
                    } catch { }
                }
                else if ((itemType & 4) == 4) {
                    try {
                        if (item.End1 != null && item.End2 != null) {
                            string linkJson = ConvertI2LinkJson(item);
                            if (linkJson != null) {
                                linksStream.WriteLine(linkJson);
                                linkCount++;
                            }
                        }
                    } catch { }
                }

                try { Marshal.ReleaseComObject(item); } catch { }

                if ((nodeCount + linkCount) > maxItems) throw new Exception("GraphItemLimitExceeded");

                if (total > lastAdvanceTotal) {
                    lastAdvanceTotal = total;
                    lastAdvanceTime = sw.Elapsed.TotalSeconds;
                } else if ((sw.Elapsed.TotalSeconds - lastAdvanceTime) > 600) {
                    throw new Exception("JobWatchdogTimeout: No new items processed for 600 seconds (stalled at item " + total + ")");
                }

                if (total % 100 == 0 || (sw.Elapsed.TotalSeconds - lastProgSec) >= 0.8) {
                    lastProgSec = sw.Elapsed.TotalSeconds;
                    try {
                        string progJson = "{\"job_id\":\"" + jobId + "\",\"status\":\"converting\",\"total_scanned\":" + total + ",\"nodes\":" + nodeCount + ",\"links\":" + linkCount + ",\"elapsed_seconds\":" + (int)sw.Elapsed.TotalSeconds + ",\"updated_at\":\"" + DateTime.UtcNow.ToString("o") + "\"}";
                        File.WriteAllText(progressFile, progJson, new UTF8Encoding(false));
                    } catch { }
                }

                try {
                    bool atLast = false;
                    try { atLast = Convert.ToBoolean(iterator.AtLast); } catch { }
                    if (atLast) break;
                    iterator.MoveNext();
                } catch {
                    break;
                }
            }

            try { Marshal.ReleaseComObject(iterator); } catch { }

            nodesStream.Flush();
            nodesStream.Close();
            nodesStream = null;

            linksStream.Flush();
            linksStream.Close();
            linksStream = null;

                        

            int olePhotosAssigned = (nodePhotoMap != null) ? (nodePhotoMap.Count / 2) : 0;

            finalStream = new StreamWriter(tempOutput, false, new UTF8Encoding(false), 65536);
            string convertedAt = DateTime.UtcNow.ToString("o");
            finalStream.Write("{\"schema_version\":2,\"job_id\":\"" + jobId + "\",\"status\":\"converted\",\"converted_at\":\"" + convertedAt + "\",\"source\":{\"format\":\"anb\",\"converter\":\"IBM i2 COM Automation (C#)\"},\"style_summary\":{\"imported_positions\":true,\"ibm_icons_copied\":false,\"ole_photos_assigned\":" + olePhotosAssigned + "},\"nodes\":[");

            if (File.Exists(tempNodes)) {
                finalStream.Flush();
                using (var fsNodes = File.OpenRead(tempNodes)) {
                    fsNodes.CopyTo(finalStream.BaseStream);
                }
            }

            finalStream.Write("],\"edges\":[");

            int validLinkCount = 0;
            if (File.Exists(tempLinks)) {
                using (var linkReader = new StreamReader(tempLinks, new UTF8Encoding(false))) {
                    string line;
                    while ((line = linkReader.ReadLine()) != null) {
                        var matchFrom = Regex.Match(line, "\"from\":\"([^\"]*)\"");
                        var matchTo = Regex.Match(line, "\"to\":\"([^\"]*)\"");
                        if (matchFrom.Success && matchTo.Success) {
                            string fromId = matchFrom.Groups[1].Value;
                            string toId = matchTo.Groups[1].Value;
                            if (knownIds.Contains(fromId) && knownIds.Contains(toId)) {
                                if (validLinkCount > 0) finalStream.Write(",");
                                finalStream.Write(line);
                                validLinkCount++;
                            }
                        }
                    }
                }
            }

            finalStream.Write("],\"warnings\":[]}");
            finalStream.Flush();
            finalStream.Close();
            finalStream = null;

            try { File.Delete(tempNodes); } catch { }
            try { File.Delete(tempLinks); } catch { }
            
            if (File.Exists(outputPath)) File.Delete(outputPath);
            File.Move(tempOutput, outputPath);

            try {
                string progJson = "{\"job_id\":\"" + jobId + "\",\"status\":\"completed\",\"total_scanned\":" + total + ",\"nodes\":" + nodeCount + ",\"links\":" + validLinkCount + ",\"elapsed_seconds\":" + (int)sw.Elapsed.TotalSeconds + ",\"updated_at\":\"" + DateTime.UtcNow.ToString("o") + "\"}";
                File.WriteAllText(progressFile, progJson, new UTF8Encoding(false));
            } catch { }

            var result = new Dictionary<string, int>();
            result["nodes"] = nodeCount;
            result["edges"] = validLinkCount;
            return result;
        } finally {
            if (nodesStream != null) { try { nodesStream.Close(); } catch { } }
            if (linksStream != null) { try { linksStream.Close(); } catch { } }
            if (finalStream != null) { try { finalStream.Close(); } catch { } }
            try { File.Delete(tempNodes); } catch { }
            try { File.Delete(tempLinks); } catch { }
            try { File.Delete(tempOutput); } catch { }

            if (application != null && chart != null) {
                try { application.Charts.CloseChart(chart, 0); } catch { }
            }
            if (chart != null) {
                try { Marshal.ReleaseComObject(chart); } catch { }
            }
            if (application != null) {
                try { application.Quit(); } catch { }
                try { Marshal.FinalReleaseComObject(application); } catch { }
            }
            GC.Collect();
            GC.WaitForPendingFinalizers();
        }
    }
}
"@

$interopPath = "C:\Program Files (x86)\Common Files\i2 Shared\i2 Analyst's Notebook 7\Components\Interop.i2NotebookData.dll"
Add-Type -TypeDefinition $csharpCode -Language CSharp -ReferencedAssemblies "Microsoft.CSharp", "System.Core", "System.Drawing", "System.Windows.Forms", "System.IO.Compression", $interopPath

function Convert-ChartStreaming {
    <# Open one chart through IBM COM Automation and stream JSON directly to disk, avoiding 32-bit OOM. Accelerated via C#. #>
    param([string]$InputPath, [string]$JobId, [int]$MaxItems, [string]$BridgeRoot, [string]$OutputPath)

    $result = [I2ChartExtractor]::ProcessChart($InputPath, $JobId, $MaxItems, $BridgeRoot, $OutputPath)
    return @{ nodes = $result["nodes"]; edges = $result["edges"] }
}

function Publish-JsonAtomically {
    <# Write UTF-8 JSON to a sibling file, flush it, then atomically rename it. #>
    param([string]$Path, $Payload, [int]$Depth = 10)

    $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    $json = $Payload | ConvertTo-Json -Depth $Depth -Compress
    [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Invoke-OneBridgeJob {
    <# Claim and convert the oldest pending job; return false when the queue is empty. #>
    param([string]$Root)

    $pendingRoot = Join-Path $Root 'jobs\pending'
    $processingRoot = Join-Path $Root 'jobs\processing'
    $doneRoot = Join-Path $Root 'jobs\done'
    $outboxRoot = Join-Path $Root 'outbox'
    foreach ($directory in @($pendingRoot, $processingRoot, $doneRoot, $outboxRoot)) {
        [void](New-Item -ItemType Directory -Path $directory -Force)
    }
    $pending = Get-ChildItem -LiteralPath $pendingRoot -Filter '*.json' -File | Sort-Object CreationTimeUtc | Select-Object -First 1
    if ($null -eq $pending) { return $false }

    $processing = Join-Path $processingRoot $pending.Name
    try { Move-Item -LiteralPath $pending.FullName -Destination $processing -ErrorAction Stop } catch { return $true }
    $job = Get-Content -LiteralPath $processing -Raw -Encoding UTF8 | ConvertFrom-Json
    $jobId = [string]$job.job_id
    try {
        $inputPath = [IO.Path]::GetFullPath((Join-Path $Root ([string]$job.input_file)))
        $rootPath = [IO.Path]::GetFullPath($Root)
        if (-not $inputPath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'UnsafeInputPath' }
        $outputPath = Join-Path $Root ([string]$job.output_file)
        $counts = Convert-ChartStreaming -InputPath $inputPath -JobId $jobId -MaxItems ([int]$job.max_items) -BridgeRoot $Root -OutputPath $outputPath
        Write-BridgeStatus -JobId $jobId -Status 'converted' -Counts $counts
    }
    catch {
        $errorType = $_.Exception.GetType().Name
        $errorMessage = $_.Exception.Message
        $errorLine = $_.InvocationInfo.ScriptLineNumber
        $errorPayload = [ordered]@{
            schema_version = 1
            job_id = $jobId
            status = 'failed'
            error_type = $errorType
            error_message = $errorMessage
            line = $errorLine
            failed_at = (Get-Date).ToUniversalTime().ToString('o')
            retryable = $true
        }
        Publish-JsonAtomically -Path (Join-Path $outboxRoot "$jobId.error.json") -Payload $errorPayload
        Write-BridgeStatus -JobId $jobId -Status 'failed' -Counts @{ error_type = $errorType; line = $errorLine }
    }
    finally {
        if (Test-Path -LiteralPath $processing) {
            Move-Item -LiteralPath $processing -Destination (Join-Path $doneRoot ([IO.Path]::GetFileName($processing))) -Force
        }
    }
    return $true
}

# Analyst's Notebook is 32-bit; fail before claiming a job when launched in a 64-bit host.
if ([Environment]::Is64BitProcess) {
    throw 'Run this bridge with C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
}

$resolvedRoot = [IO.Path]::GetFullPath($BridgeRoot)
$bridgeLock = $null
try {
    # One exclusive file handle protects startup recovery and normal claims from manual duplicate launches.
    $bridgeLock = Enter-BridgeLock -Root $resolvedRoot
    if ($null -eq $bridgeLock) {
        Write-BridgeStatus -JobId 'bridge' -Status 'already_running'
        exit 0
    }
    # A process/power interruption may leave the descriptor in processing; recover it before polling pending work.
    Restore-InterruptedBridgeJobs -Root $resolvedRoot
    do {
        $processed = Invoke-OneBridgeJob -Root $resolvedRoot
        if ($Once) { break }
        if (-not $processed) { Start-Sleep -Seconds $PollSeconds }
    } while ($true)
}
finally {
    if ($null -ne $bridgeLock) { $bridgeLock.Dispose() }
}


