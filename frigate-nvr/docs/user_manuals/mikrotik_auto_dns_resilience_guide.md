# 🛡️ คู่มือการตั้งค่า MikroTik WireGuard Dynamic DDNS Auto-Resolver & Zero-Drop Auto-Healing

> **เอกสารคู่มือปฏิบัติการระบบ BPP-VMS (ตชด.215 / หน่วยภาคสนาม)**  
> **วัตถุประสงค์:** แก้ไขปัญหาการเชื่อมต่อระหว่างเราเตอร์ MikroTik เครื่องแม่และเครื่องลูกหลุดบ่อย หรือเมื่อ Public IP ของฝั่งแม่เปลี่ยนแล้วต้องเข้าไปบังคับแก้ DNS/Endpoint ด้วยตนเอง เพื่อให้ระบบสตรีมภาพกล้องวงจรปิดกู้คืนตัวเองอัตโนมัติ 100% ภายใน 15-30 วินาที โดยไม่ต้องมีเจ้าหน้าที่ไปกดรีสตาร์ทเราเตอร์

---

## 1. 🔍 สาเหตุที่แท้จริงของปัญหา (Root Cause Analysis)

1. **พฤติกรรมดั้งเดิมของ RouterOS v7 WireGuard:**
   - เมื่อเราใส่ชื่อ DDNS (เช่น `*.sn.mynetname.net` หรือ `*.duckdns.org`) ในช่อง `endpoint-address` ของตัวลูก MikroTik จะแปลงชื่อโดเมนเป็นตัวเลข IP **เฉพาะตอนเริ่มทำงานครั้งแรกเท่านั้น**
   - เมื่ออินเทอร์เน็ตฝั่งแม่ตัดรอบ 24 ชม. หรือเราเตอร์แม่ได้ Public IP ใหม่ ตัวลูกจะไม่ Re-resolve ชื่อ DDNS นั้นซ้ำ และยังคงยิงแพ็กเก็ตไปยัง IP เก่าที่ตายแล้ว
   - ส่งผลให้สถานะ Handshake ค้าง และสตรีมกล้องดับถาวรจนกว่าจะมีคนเข้าไปกดแก้หรือปิด/เปิด Peer ใหม่
2. **การขาดระบบ Watchdog เฝ้าระวัง:**
   - หากไม่มีตัวตรวจจับ (Netwatch) เมื่อสัญญาณเน็ตสะดุดหรือ NAT Table ขาดช่วง จะไม่มีคำสั่งใดไปกระตุ้นให้ Peer ทำการ Handshake ใหม่

---

## 2. 🏢 ส่วนที่ 1: การตั้งค่าที่ MikroTik เครื่องแม่ (Server / HQ Hub)

นำคำสั่งด้านล่างไปวางใน **Winbox -> New Terminal** ของเราเตอร์เครื่องแม่:

```routeros
# =========================================================================
# MIKROTIK SERVER / HQ HUB (เครื่องแม่)
# =========================================================================

# 1. เปิดใช้งาน MikroTik Cloud DDNS (ได้ชื่อโดเมนฟรี *.sn.mynetname.net)
/ip cloud set ddns-enabled=yes

# 2. ปรับแต่ง WireGuard Peer ให้ส่ง Keepalive ทุก 15 วินาที
/interface wireguard peers set [find name="peer1"] persistent-keepalive=15s comment="Peer to Client NVR Site"

# 3. สร้าง Netwatch Watchdog ตรวจสอบสถานะเครื่องลูก (IP 10.10.10.2)
# หากขาดการเชื่อมต่อ จะทำการ Flush Peer เพื่อล้าง Session UDP ที่ค้างอัตโนมัติ
/tool netwatch
add host=10.10.10.2 interval=15s timeout=3s type=icmp comment="Watchdog to Child (Prasat)" \
    down-script={
        :log error "[VPN-WATCHDOG] Child (10.10.10.2) is DOWN! Refreshing WireGuard Peer..."
        /interface wireguard peers disable [find name="peer1"]
        :delay 2s
        /interface wireguard peers enable [find name="peer1"]
    } \
    up-script={
        :log info "[VPN-WATCHDOG] Child (10.10.10.2) is RESTORED and Healthy!"
    }
```

---

## 3. 📹 ส่วนที่ 2: การตั้งค่าที่ MikroTik เครื่องลูก (Branch / NVR Site)

นำคำสั่งด้านล่างไปวางใน **Winbox -> New Terminal** ของเราเตอร์เครื่องลูก:

```routeros
# =========================================================================
# MIKROTIK CLIENT / BRANCH (เครื่องลูก)
# =========================================================================

# 1. เปิดใช้งาน MikroTik Cloud DDNS
/ip cloud set ddns-enabled=yes

# 2. ปรับ Keepalive ของ Peer เป็น 15 วินาที (ป้องกัน ISP/4G NAT ตัดการเชื่อมต่อ)
/interface wireguard peers set [find name="peer1"] persistent-keepalive=15s

# 3. สร้าง Script Dynamic DNS Resolver อัจฉริยะ (ตรวจจับ IP ใหม่และ Failover อัตโนมัติ)
/system script
add name="wg-endpoint-resolver" comment="Auto-Resolve Mother DDNS (Cloud & DuckDNS)" source={
    :local peerName "peer1"
    # ระบุชื่อ DDNS ของเครื่องแม่ (ใส่ชื่อ Cloud DDNS และ DuckDNS สำรอง)
    :local primaryHost "hmc0b5htbmk.sn.mynetname.net"
    :local fallbackHost "bpp217.duckdns.org"
    :local targetHost $primaryHost
    :local resolvedIP ""

    :do {
        :set resolvedIP [:resolve $targetHost]
    } on-error={
        :log warning ("[WireGuard-Resolver] Primary DNS " . $targetHost . " failed, trying: " . $fallbackHost)
        :set targetHost $fallbackHost
        :do {
            :set resolvedIP [:resolve $targetHost]
        } on-error={
            :log error ("[WireGuard-Resolver] All DNS failed: " . $primaryHost . ", " . $fallbackHost)
        }
    }

    :if ([:len $resolvedIP] > 0) do={
        :local currentEndpoint [/interface wireguard peers get [find name=$peerName] current-endpoint-address]
        :if ($resolvedIP != $currentEndpoint) do={
            :log warning ("[WireGuard-Resolver] Server IP changed from " . $currentEndpoint . " to " . $resolvedIP . ". Updating peer...")
            /interface wireguard peers set [find name=$peerName] endpoint-address=$resolvedIP
            /interface wireguard peers disable [find name=$peerName]
            :delay 1s
            /interface wireguard peers enable [find name=$peerName]
            :log info ("[WireGuard-Resolver] Peer reconnected to new IP " . $resolvedIP)
        }
    }
}

# 4. สร้าง Netwatch Watchdog เฝ้าระวังท่อ VPN ไปหาเครื่องแม่ (10.10.10.1)
# ตรวจสอบทุก 12 วินาที หากหลุด สั่งรัน Script Resolver และรีสตาร์ทท่อทันที
/tool netwatch
add host=10.10.10.1 interval=12s timeout=3s type=icmp comment="Watchdog to Mother" \
    down-script={
        :log error "[VPN-WATCHDOG] Link to Mother (10.10.10.1) is DOWN! Starting Auto-Healing..."
        /system script run wg-endpoint-resolver
        :delay 2s
        /interface wireguard peers disable [find name="peer1"]
        :delay 2s
        /interface wireguard peers enable [find name="peer1"]
    } \
    up-script={
        :log info "[VPN-WATCHDOG] Link to Mother is RESTORED and Healthy!"
    }
```

---

## 4. 🚀 วิธีนำไปติดตั้งกับสถานี/เครื่องอื่น (Portable Template Checklist)

เมื่อต้องการนำรูปแบบนี้ไปติดตั้งในสถานีหรือหน่วยงานอื่น ให้ปรับแก้ตัวแปรเพียง 3 จุด:

1. **IP ปลายทางใน Netwatch:**
   - ฝั่งแม่: ให้ Ping หา IP วง VPN ของลูก เช่น `10.x.x.2`
   - ฝั่งลูก: ให้ Ping หา IP วง VPN ของแม่ เช่น `10.x.x.1`
2. **ชื่อโดเมน DDNS ใน Script `wg-endpoint-resolver`:**
   - แทนที่ `primaryHost` ด้วยชื่อ MikroTik Cloud DDNS ของเครื่องแม่สถานีนั้นๆ (ดูได้จาก `/ip cloud print` -> `dns-name`)
   - แทนที่ `fallbackHost` ด้วย DuckDNS หรือชื่อโดเมนสำรอง
3. **ชื่อ Peer ใน WireGuard:**
   - ตรวจสอบว่าช่อง `name` ของ Peer ใน `/interface wireguard peers` ตรงกับตัวแปร `:local peerName "peer1"`

---

## 5. 📊 การตรวจสอบสถานะระบบ (Verification & Diagnostics)

1. **ตรวจสอบสถานะ Watchdog:**
   ```routeros
   /tool netwatch print
   ```
   *ผลลัพธ์ปกติ: `status=up`, `loss-percent=0%`*

2. **ตรวจสอบการอัปเดต Handshake:**
   ```routeros
   /interface wireguard peers print
   ```
   *ผลลัพธ์ปกติ: `last-handshake` ต้องมีค่าน้อยกว่า `30s` สม่ำเสมอ*

3. **ตรวจสอบบันทึกการทำงาน (Log):**
   ```routeros
   /log print where topics~"wireguard" or message~"WATCHDOG" or message~"Resolver"
   ```
