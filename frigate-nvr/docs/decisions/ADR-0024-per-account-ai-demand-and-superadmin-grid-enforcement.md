# ADR-0024: Per-Account AI Demand & Superadmin Grid Enforcement

- Status: Accepted
- Date: 2026-10-03
- Supersedes: ADR-0022 decisions 1–2 (decisions 3–4 remain in force)

Superadmins need to switch off streams and AI for one account or for every account (Account / Global Kill-Switch) and to push their own grid to everyone (Global Layout Broadcast). Under ADR-0022 Frigate's `detect.enabled` was the single source of truth, so turning AI off for one account either silently re-appeared as "AI เปิด" (another account still used that camera) or switched AI off for unrelated accounts.

We decided that **AI is an account-level demand**: each Personal Screen Grid stores its own per-channel `detect` flag, and Frigate's camera-level detection is derived as *on if at least one account demands AI on that camera with its channel streaming*, otherwise off. The per-channel AI button follows the same rule, so one account can no longer switch AI off for others. The settings UI shows the account's own flag and, when other accounts still keep a camera's AI on, a hint such as `AI ปิด · ยังเปิดโดย 2 บัญชีอื่น`.

Because online browsers report their locally cached grid in the heartbeat (which drives demand-driven provisioning, ADR-0020), superadmin changes would otherwise be ignored by live sessions. Each profile therefore carries a **grid revision** that increments on every superadmin-initiated write; the heartbeat response returns it, and a client holding an older revision reloads its grid from the server and shows a notice. Enforcement latency is one heartbeat interval (≤60 s).

Alternatives rejected: keeping ADR-0022 and skipping shared cameras (kill-switch would look broken), and hard-off at camera level (one account's action affects others).
