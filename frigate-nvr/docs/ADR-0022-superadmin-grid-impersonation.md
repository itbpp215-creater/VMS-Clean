# ADR 0022: Superadmin User Grid Impersonation

## Status
Accepted

## Context
The user requested the ability for Superadmin to inspect and modify the Personal Screen Grid (`cfg.channels`) and AI/LPR preferences of other users. Because AI processing in Frigate is centralized (global), a user turning on AI for a camera impacts server resources. Superadmins needed a way to audit which cameras are actively placed on users' screens and have their AI toggles active, and if necessary, intervene directly.

## Decision
1. **API Expansion (`nas-bot-service`)**:
   - Exposed `GET /api/nas-bot/admin/user-profiles` returning a dump of all `user_profiles.json` (restricted to admin/superadmin).
   - Exposed `PUT /api/nas-bot/admin/user-profile/{username}` allowing an admin to overwrite another user's layout, channels, and AI/LPR disabled lists.
2. **Dashboard Settings Impersonation (`app.js`)**:
   - In Tab 2 (Dashboard จัดช่องจอ), injected a `<select>` dropdown populated with all accounts.
   - When a target user is selected, their `channels` configuration is loaded into `state.draft`.
   - Interactions (turning AI on/off, toggling LPR) directly call the NVR API to toggle the global state (as before) **but** append the specific user's `disabled_ai_cameras` setting via the new `PUT` API instead of modifying the Superadmin's own profile.
   - Saving the modal saves the updated grid explicitly back to the target user.

## Consequences
- Superadmin can cleanly audit any user's setup without disrupting their own layout (`cfg.channels` remains untouched locally during impersonation).
- The `state.impersonatingUser` safely branches all persistence logic to prevent cross-contamination of profiles.
