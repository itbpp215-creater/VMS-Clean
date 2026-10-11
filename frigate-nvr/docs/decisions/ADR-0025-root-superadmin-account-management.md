# ADR-0025: Root Superadmin account management

**Status:** Accepted (2026-10-03)

## Context
The Profile & Permissions modal hid every action for `superadmin` accounts. The operator wants superadmins to manage each other, while `suchakree` and `arm215` stay out of reach of other superadmins.

## Decision
- **Root accounts** = `suchakree`, `arm215` (server constant `ROOT_SUPERADMINS` in `auth-service/auth.py`, env override `BPP_ROOT_SUPERADMINS`; never stored in DB or editable from the UI).
- Superadmin → peer superadmin: reset password, suspend/activate, delete.
- Only root may touch a root account; roots manage each other and every account.
- Only root may create, grant or revoke the `superadmin` role (role selector gains `superadmin` for roots only). Non-root superadmins cannot change a superadmin's role.
- Nobody can delete, suspend or change the role of their own account via the API.
- Existing invariants stay: at least one active admin and one active superadmin.
- Enforcement is server-side (`_enforce_account_management`); the UI only hides/labels buttons. `get_current_user` re-reads active/role per request, so suspend/delete take effect immediately (password change does not revoke existing JWTs - unchanged behaviour).
- Ordinary `admin` still cannot touch any superadmin.

## Consequences
`manage.py promote-superadmin` remains for CLI recovery. Changing the root list requires a config/code change plus restart of `auth-service`.
