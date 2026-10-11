# BPP-VMS Context

This document defines the ubiquitous language for the BPP-VMS project.

## Dossier Management

**Dossier Vault (คลังบันทึกจับกุมและแฟ้มบุคคล)**:
The centralized storage and UI for managing individual suspect profiles and their associated evidence.
_Avoid_: Case files, suspect database

**Dossier Profile (Tab 1)**:
The primary view showing suspect demographics, address, and the original narrative of the arrest.

**Dossier Network (Tab 2)**:
The view showing relationships, shared evidence, and connections to other dossiers.

**Dossier Attachments (Tab 3)**:
A dedicated view for uploading and managing additional files (images, documents) related to the suspect.

**Dossier Remarks (บันทึกเพิ่มเติม)**:
Timestamped notes added by officers to append ongoing case developments without altering the original OCR narrative.

## Dashboard Grids & Camera Control

**System Master Grid (ผังแม่แบบระบบส่วนกลาง)**:
The 16-channel baseline grid that new accounts receive before they have their own layout.
_Avoid_: Default grid, global layout

**Personal Screen Grid (ผังหน้าจอส่วนตัว)**:
The 16-channel grid belonging to one account; each account's grid is independent of all others.
_Avoid_: User layout, my channels

**Global Layout Broadcast (กระจายผังสู่ทุกบัญชี)**:
A Superadmin action that overwrites every existing account's Personal Screen Grid with the Superadmin's current grid, after explicit confirmation.
_Avoid_: Sync all, push layout

**Channel Stream Off (สตรีมปิด)**:
A channel that keeps its assigned camera but is not streamed or shown live; reversible without reassigning the camera.
_Avoid_: Clear slot, remove camera

**Account Kill-Switch (สวิตช์ตัดรายบัญชี)**:
A Superadmin action that sets every channel of one account to Channel Stream Off, or turns AI detection off on every channel of that account, in a single step.
_Avoid_: Batch disable, mass toggle

**Global Kill-Switch (สวิตช์ตัดทุกบัญชี)**:
The Account Kill-Switch applied to every account in the system at once, excluding the Superadmin who issues it.
_Avoid_: Emergency stop, shutdown all

**AI Demand (ความต้องการ AI ของบัญชี)**:
One account's wish to run AI detection on a camera in its Personal Screen Grid; a camera's AI runs while at least one account demands it.
_Avoid_: AI state, detect flag

**Grid Revision (เวอร์ชันผังหน้าจอ)**:
A counter on each Personal Screen Grid that advances whenever a Superadmin changes that grid, telling live sessions to reload it.
_Avoid_: Profile version, sync token

- **Root Superadmin**: A superadmin account (suchakree, arm215) that no other superadmin may manage and that alone may grant or revoke the superadmin role. Roots manage each other and every account.
- **Peer Superadmin Management**: A non-root superadmin may reset the password of, suspend, or delete another non-root superadmin, but never a Root Superadmin and never their own account.

## Account Identity

**Display Name (ชื่อเรียก)**:
An optional name an account sets for itself (up to 40 characters, duplicates allowed) so other people can tell whose account it is. It is always shown together with the account's username, never instead of it.
_Avoid_: Nickname, full name, alias

**Avatar (รูปประจำบัญชี)**:
An optional square photo an account sets for itself, shown in place of the plain marker wherever the account appears. It takes effect immediately with no approval, and an Admin or Superadmin may remove it.
_Avoid_: Profile picture, photo ID

**Account Label (ป้ายบัญชี)**:
How an account is presented to others: Avatar if it has one, Display Name if it has one, always with the username alongside. An account with neither falls back to the username alone.
_Avoid_: Badge, nameplate


## Map Analytics

**Weighted Risk Score**:
A single numerical value calculated for a geographic zone by multiplying various incident metrics (case count, drug quantity, weapons, etc.) by predefined weights. This score represents the absolute severity of the zone.
_Avoid_: Total count, incident sum

**Dynamic Relative Ceiling**:
A method for coloring the heatmap where the maximum Weighted Risk Score in the currently selected time window defines the 100% mark. Other zones are colored based on their percentage relative to this local maximum, ensuring the map always has color contrast regardless of the absolute numbers.
_Avoid_: Fixed threshold, hardcoded color scale

## License Plate Recognition

**LPR Camera (กล้องที่เปิด LPR)**:
A camera the operator has switched to "LPR เปิด" on the dashboard; only these cameras have vehicles read for plates.
_Avoid_: AI camera, plate camera

**LPR Zone (โซนป้าย)**:
The operator-drawn rectangle on an LPR Camera where plates are legible; plate search never looks outside it. With no zone drawn, the whole frame is searched.
_Avoid_: Detection zone, ROI

**Live Sampling**:
Reading plates from current frames while a vehicle is still in view and is the only vehicle on that camera.
_Avoid_: Mainstream sampling, real-time OCR

**Recording Replay**:
Re-reading a finished vehicle pass from the full-resolution recording when Live Sampling produced no readable plate.
_Avoid_: Clip scan, historical retrieval

**Plate Candidate (รอตรวจสอบ)**:
A Readable Plate produced by AI that waits for human review before it counts as a confirmed read.
_Avoid_: Detection, result

**Readable Plate**:
A plate read with both registration and province; the only kind of read that becomes a Plate Candidate.
_Avoid_: Full plate, valid plate

**Partial Plate**:
A plate read with registration characters but no province (minimum 3 characters required); kept in the archive with its image and searchable, never a review task unless its letters and digits exactly equal a watchlist plate, in which case it raises an unconfirmed alert.
_Avoid_: Incomplete candidate, [ไม่ครบ] review item


## AI Training & Dataset

**Hard Negative Mining (???????????????)**:
The practice of including images of objects that the AI falsely detects (e.g. car bumpers, truck cargo boxes, fences) as *background images* (images with no bounding box labels) in the training dataset. This explicitly teaches the Plate Detector model what *not* to draw boxes around, preventing hallucinated detections.

**Deep Scan Auto-Labeler**:
A script that scans historical raw videos or snapshots using aggressive image enhancements (CLAHE) and very low confidence thresholds to find hard-to-detect plates (e.g. motorcycles, dark plates) that the real-time system missed.

**Random Sampling (Dataset)**:
Extracting a fixed, small number of frames (e.g. 5 frames) from every video clip rather than processing every single frame. This ensures maximum diversity in lighting, angles, and vehicle types while keeping processing time feasible.

**Strict Plate Format (รูปแบบป้ายเข้มงวด)**:
The exact regex enforcement of Thai plate boundaries (max 7 characters for cars/motorcycles, max 6 numbers for trucks) that instantly rejects impossible hallucinated reads with too many trailing numbers.
_Avoid_: Pattern match, character limit

**Hallucinated Plate (ป้ายมั่ว)**:
A plate text generated by the OCR engine with high confidence but physically impossible length or structure (e.g. 5 trailing digits).

**Heuristic Plate Denoise (การตัดอักษรขยะจากหัวน็อต)**:
The automatic removal of false-positive characters caused by mounting screws, plate rivets, or shadows when 3 consecutive Thai consonants are detected, restoring standard Thai 2-letter or 1-number-2-letter syntax based on minimum confidence.
_Avoid_: Plate cleaning, noise removal

**Multi-line Plate Slicing (การตัดอ่านป้ายหลายบรรทัด)**:
The aspect-ratio-driven partitioning of square or tall license plates (aspect ratio < 2.0) into discrete upper and lower rows before character OCR, preventing line-cross mixing on 2-row and 3-row plates.
_Avoid_: Square OCR, multi-row detection

**Province Fuzzy Matching (การจับคู่ชื่อจังหวัดแบบยืดหยุ่น)**:
Matching detected low-confidence province text (confidence >= 0.45) against the authoritative 77 Thai provinces list using prefix and edit-distance matching, converting partial plates into fully readable plates.
_Avoid_: Province guessing, fuzzy province

## Grid Video Player

**Tile Action Pill (แถบเครื่องมือด่วนประจำช่อง)**:
A compact horizontal floating pill menu anchored to the tile ellipsis (···) button, housing snapshot, record, audio, map GPS, camera swap, and stream-mode controls without overflowing small grid tiles.
_Avoid_: Vertical menu, tile button stack, overflowing actions


## Watchlist Alert Tiers (ADR 0030)
- **Alert Tier**: exact / letters_partial / digits_only (red/orange/yellow).
- **Weak Watchlist Match**: letters_partial or digits_only; 5-minute cooldown per watchlist plate + camera.
- **Digits-Only Plate**: a read with digits only; accepted as Partial only if equal to a watchlist digit group (>=3 digits).
- **Behavioral Stats Ingestion Scope**: only `exact` and `letters_partial` tiers are ingested into `watchlist_history` stats; `digits_only` observations are excluded to prevent profile pollution.
- **Behavioral Stats Cooldown**: 3-minute deduplication window per (watchlist plate + camera) to ensure each vehicle passage contributes exactly one count to aggregate charts.
- **Behavioral Stats Observed Plate Tracking**: storing the actual AI-read characters and match tier alongside the canonical watchlist plate for auditability in the history table.
- **Behavioral Stats Ingestion Mode**: applies strictly to new incoming detections forward; no backfill of historical candidates.

## Distribution & Release Management

**Clean Distribution Repository (คลังโค้ดเผยแพร่ฉบับสะอาด)**:
A separate, public/downstream Git repository containing only generic framework code and blank configuration templates, completely free of BPP215 cameras, NAS credentials, bot tokens, and internal history.
_Avoid_: Public repo clone, master mirror

**Pre-Push Sanitization Gate (ระบบตรวจสอบและบล็อกความลับก่อนส่งออก)**:
An automated local validation check that scans files for sensitive patterns (camera IPs, RTSP URLs, API keys, private domains) and blocks synchronization to the Clean Distribution Repository if any secret is detected.
_Avoid_: Clean filter, regex sanitizer

**Clean Standalone Template (แม่แบบติดตั้งระบบใหม่)**:
A fully functional out-of-the-box installation package where all sensitive values are replaced with safe defaults and placeholders, allowing a new site administrator to configure their own cameras, storage, and bot without crashing.
_Avoid_: Empty config, blank install

