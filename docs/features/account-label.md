# Account Label (Display Name + Avatar)

Lets each account set an optional **Display Name** and **Avatar** so people can tell whose
account is whose on the map and in lists. Terms are defined in `CONTEXT.md`.

## Rules

- Everyone edits their own name/photo; Admin/Superadmin may set a name or remove a photo for
  others. ADR-0025 applies (only root edits root, only a superadmin edits a superadmin).
- Name: optional, max 40 chars, duplicates allowed, always shown with `@username`.
- Photo: optional, 256x256 JPEG made in the browser (gallery or camera, centre-cropped), max 150 KB
  server-side, effective immediately (no approval).
- Presentation: photo if present, otherwise the first initial; label is the name (with `@username`)
  or the username alone.
- Visible to every signed-in account; never to anonymous users.

## Backend (`auth-service/auth.py`)

| Endpoint | Who | Purpose |
|---|---|---|
| `PUT /auth/profile` | any signed-in | set/clear own `display_name` / `avatar` (`""` clears) |
| `PUT /auth/users/{u}/profile` | admin+ | moderate another account |
| `GET /auth/profiles` | any signed-in | `{username: {display_name, avatar_url}}` for all active accounts |
| `GET /auth/avatar/{u}` | any signed-in | JPEG bytes, `Cache-Control: private, max-age=86400` |

`/auth/session`, `/auth/users`, `/auth/presence`, `/auth/locations` also return `display_name`
and `avatar_url` (`/auth/avatar/{u}?v=<timestamp>`; version stamp busts the browser cache).
Storage: nullable columns `users.display_name`, `users.avatar` (base64), `users.avatar_updated`,
added by an additive `ALTER TABLE` in `ensure_schema`. No new volume or infrastructure.

## Frontend

- `web/assets/account-label.js` - shared helper `window.bppAccountLabel` (cache refreshed every
  60 s, image resize, avatar/name HTML, top-bar avatar). All label text is HTML-escaped there.
- `admin.js` - "ตั้งชื่อ/รูปของฉัน" editor in the profile modal; users table shows labels and gives
  admins "ตั้งชื่อ" / "ลบรูป".
- `analytics.js` - officer map marker (round photo or initial, name label) and popup; recorder
  label on events and stash points. `chat-widget.js` - recorder label in event list/modal.
- `app.js` - Superadmin account list/dropdowns and kill-switch label.

## Tests

`auth-service/tests/test_auth.py`: set/clear own label, validation (length, non-JPEG, oversize),
admin moderation vs. ordinary user, ordinary admin cannot edit a superadmin.
