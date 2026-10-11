# Smart Media Integrity Filtering & LPR Crop Archival Pipeline

To eliminate "ghost records" (black thumbnail preview rectangles and unplayable playback items in Event Video Archive and system menus) while guaranteeing permanent media retention:

1. **Smart Media Integrity Filter**: The system enforces an authoritative media availability check at the API boundary (`watchlist-api`, `nas-bot-service`, and frontend `app.js`). Event records and LPR candidates whose physical media files (snapshots, crops, or MP4 clips) no longer exist across Tier 1 (SSD D:), Tier 2 (Drive E: Archive), or Tier 3 (Synology NAS) are automatically filtered out from all operator-facing views.
2. **One-Time Database Orphan Cleanup**: Historical candidate rows in `watchlist.db` with missing media files from prior cleanup cycles are pruned, preventing disk I/O thrashing and ensuring queries return only verified, playable intelligence.
3. **Automated LPR Crop Archival (Tier 2)**: The background `tiered_storage_archiver` is extended to include `lpr-data/crops`. Aging detection crops (>7 days) are moved to `E:\BPP-VMS-Archive\lpr-crops`, preventing SSD space saturation while retaining full-resolution images locally.
4. **Synology NAS SMB Synchronization (Tier 3)**: The `nas_sync_service` daemon continuously backs up detection crops from both SSD and Drive E: to Synology NAS (`//100.88.125.117/BPP215/crops`), ensuring future security detections are permanently backed up off-site without data loss.
5. **Multi-Tier Media Resolver & Nginx Fallback**: Nginx and `nas-bot-service` fallback endpoints resolve crop and snapshot requests across `/lpr-data/crops`, `E:\BPP-VMS-Archive\lpr-crops`, and NAS SMB, guaranteeing seamless HTTP 200 delivery for historical event media.
