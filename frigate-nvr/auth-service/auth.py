"""Authentication, session, authorization, and user-management API.

The service deliberately has no built-in account or password. A new database
must be initialized with the one-time ``manage.py bootstrap-admin`` command so
that deployment configuration never contains a reusable default credential.
"""

import base64
import datetime
import ipaddress
import os
import hmac
import re
import secrets
import socket
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Literal, Optional

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from passlib.context import CryptContext
from pydantic import BaseModel, Field

# Runtime state stays on the mounted data volume; neither path contains a
# credential value and both can be overridden for tests or non-Docker installs.
DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")
SECRET_PATH = os.environ.get("JWT_SECRET_PATH", "/data/secret.key")

# These limits constrain brute-force attempts and session lifetime without
# relying on browser-controlled values.
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15
SESSION_HOURS = int(os.environ.get("AUTH_SESSION_HOURS", 24 * 30))  # Default 30 days (720 hours)

# The cookie is intentionally fixed so nginx auth_request and every frontend
# share one server-managed session. HTTPS is required unless an operator opts
# out explicitly for a local test environment.
SESSION_COOKIE_NAME = "bpp_token"
SESSION_COOKIE_SECURE = os.environ.get("AUTH_COOKIE_SECURE", "true").strip().lower() not in {
    "0",
    "false",
    "no",
}
JWT_ISSUER = "bpp-vms-auth"
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{3,64}$")
# Only the Compose gateway hostname may supply the browser source address. Direct
# callers on a shared network cannot spoof X-Real-IP to evade login lockout.
TRUSTED_PROXY_HOST = os.environ.get("AUTH_TRUSTED_PROXY_HOST", "dashboard").strip()

# Privileged authorization treats ``superadmin`` as a strict superset of
# ``admin``.  The role is provisioned only through the local management CLI so
# a compromised browser administrator cannot mint another model approver.
ADMIN_ROLES = frozenset({"admin", "superadmin"})
SUPERADMIN_ROLE = "superadmin"

# ADR-0025: root superadministrators. They manage every account (including each
# other); any other superadmin can manage ordinary accounts and peer
# superadmins but never a root. Role changes involving ``superadmin`` are also
# root-only. Deliberately a server-side constant (env override only), never
# stored in the database or editable through the web UI.
ROOT_SUPERADMINS = frozenset(
    name.strip().lower()
    for name in os.environ.get("BPP_ROOT_SUPERADMINS", "suchakree,arm215").split(",")
    if name.strip()
)


def _is_root(username: object) -> bool:
    """Return whether the authenticated subject is a root superadministrator."""

    return isinstance(username, str) and username.strip().lower() in ROOT_SUPERADMINS


def _enforce_account_management(
    actor: dict,
    target_username: str,
    target_role: str,
    resulting_role: str,
    *,
    suspends_or_deletes: bool,
) -> None:
    """Apply ADR-0025 account-management rules or raise HTTP 403.

    Rules: only root may touch a root account; only a superadmin may touch a
    superadmin; only root may grant or revoke ``superadmin``; nobody may delete,
    suspend or change the role of their own account through this API.
    """

    actor_name = actor.get("sub")
    actor_is_root = _is_root(actor_name)
    if _is_root(target_username) and not actor_is_root:
        raise HTTPException(
            status_code=403,
            detail="บัญชี root (suchakree/arm215) จัดการได้เฉพาะบัญชี root ด้วยกันเท่านั้น",
        )
    if target_role == SUPERADMIN_ROLE and actor.get("role") != SUPERADMIN_ROLE:
        raise HTTPException(
            status_code=403,
            detail="เฉพาะผู้ดูแลระบบระดับสูงเท่านั้นที่จัดการบัญชีนี้ได้",
        )
    if (target_role == SUPERADMIN_ROLE or resulting_role == SUPERADMIN_ROLE) and (
        target_role != resulting_role
    ) and not actor_is_root:
        raise HTTPException(
            status_code=403,
            detail="เฉพาะบัญชี root เท่านั้นที่ตั้งหรือถอดสิทธิ์ผู้ดูแลระบบระดับสูงได้",
        )
    if isinstance(actor_name, str) and actor_name == target_username and (
        suspends_or_deletes or target_role != resulting_role
    ):
        raise HTTPException(
            status_code=403,
            detail="ไม่สามารถลบ ระงับ หรือเปลี่ยนสิทธิ์ของบัญชีตัวเองได้",
        )

# Bcrypt remains compatible with the existing database while all new password
# entry points apply the stronger policy below before hashing.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
BCRYPT_MAX_PASSWORD_BYTES = 72
# A process-local dummy hash makes absent and inactive accounts perform the
# same bcrypt verification work as active accounts without embedding a reusable
# dummy plaintext value in source.
_DUMMY_PASSWORD_HASH = pwd_context.hash(secrets.token_urlsafe(48))

app = FastAPI(title="BPP 215 - Auth Service")


# ---------------------------------------------------------------------------
# Database and secret helpers
# ---------------------------------------------------------------------------
@contextmanager
def get_conn():
    """Yield a SQLite connection for ``DB_PATH`` and always close it.

    The row factory keeps authorization lookups explicit by column name.
    Callers own transaction boundaries and must commit state changes.
    """

    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Create the auth tables in ``conn`` without creating any account.

    Separating schema creation from bootstrap lets the management CLI initialize
    an empty volume securely while normal startup remains fail-closed.
    """

    # The schema preserves existing columns so upgrades do not require a
    # destructive migration of production authentication or audit data.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            active INTEGER DEFAULT 1
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS login_attempts (
            ip_address TEXT,
            username TEXT,
            failed_count INTEGER DEFAULT 0,
            locked_until TEXT,
            PRIMARY KEY (ip_address, username)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            username TEXT,
            action TEXT,
            details TEXT,
            ip_address TEXT
        )
        """
    )
    # Online presence tracking table (ADR-0013)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_presence (
            username TEXT PRIMARY KEY,
            is_online INTEGER DEFAULT 0,
            last_heartbeat TEXT,
            location_sharing INTEGER DEFAULT 0,
            FOREIGN KEY (username) REFERENCES users(username)
        )
        """
    )
    # Officer real-time location snapshot table (ADR-0013)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_location (
            username TEXT PRIMARY KEY,
            latitude REAL,
            longitude REAL,
            accuracy REAL,
            heading REAL,
            speed REAL,
            updated_at TEXT,
            sharing_enabled INTEGER DEFAULT 0,
            FOREIGN KEY (username) REFERENCES users(username)
        )
        """
    )
    # Ensure sharing_enabled exists for existing databases
    try:
        conn.execute("ALTER TABLE user_location ADD COLUMN sharing_enabled INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    # Account Label columns (Display Name + Avatar). Additive, nullable migration.
    for _col_ddl in (
        "ALTER TABLE users ADD COLUMN display_name TEXT",
        "ALTER TABLE users ADD COLUMN avatar TEXT",
        "ALTER TABLE users ADD COLUMN avatar_updated INTEGER",
    ):
        try:
            conn.execute(_col_ddl)
        except sqlite3.OperationalError:
            pass
    # Operational missions table (ADR-0013)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS missions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_by TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            FOREIGN KEY (created_by) REFERENCES users(username)
        )
        """
    )
    # Historical movement trajectory log table per mission (ADR-0013)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS mission_tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mission_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            accuracy REAL,
            heading REAL,
            speed REAL,
            recorded_at TEXT NOT NULL,
            FOREIGN KEY (mission_id) REFERENCES missions(id),
            FOREIGN KEY (username) REFERENCES users(username)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_tracks_mission_user
            ON mission_tracks(mission_id, username, recorded_at)
        """
    )


def init_db() -> None:
    """Create the schema and refuse to serve without an active administrator.

    The failure is intentional: an operator must run the one-time bootstrap CLI,
    which creates a random credential outside source and deployment config.
    """

    # Creating only the data directory is safe and allows both a fresh volume
    # and a test-specific database path to use the same startup routine.
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        ensure_schema(conn)
        conn.commit()

        # Startup must not silently recreate a predictable privileged account
        # after a database is deleted or mounted at the wrong location.
        # A superadministrator remains an administrator for every existing
        # route, so either privileged role satisfies the startup invariant.
        active_admin = conn.execute(
            "SELECT 1 FROM users WHERE role IN ('admin', 'superadmin') AND active = 1 LIMIT 1"
        ).fetchone()
        if not active_admin:
            raise RuntimeError(
                "No active administrator exists. Run "
                "'python manage.py bootstrap-admin <username> --output-file <path>' "
                "once, then restart auth-service."
            )


def validate_username(username: str) -> str:
    """Normalize and validate a local username, returning the safe value.

    Usernames are intentionally limited to a portable, unambiguous character
    set because they appear in URLs, JWT subjects, and audit records.
    """

    normalized = username.strip()
    if not USERNAME_PATTERN.fullmatch(normalized):
        raise ValueError(
            "Username ต้องเป็นภาษาอังกฤษ ตัวเลข หรือ . _ - ความยาว 3-64 ตัวอักษร (ห้ามมีภาษาไทยหรือช่องว่าง)"
        )
    return normalized


def validate_bcrypt_password_length(password: str) -> None:
    """Reject input that bcrypt cannot represent without truncation.

    ``password`` is measured after UTF-8 encoding because bcrypt accepts bytes,
    not Unicode code points. The function returns nothing on success and raises
    a value-only policy error without logging or echoing the submitted secret.
    """

    # Bcrypt ignores bytes after its 72-byte boundary in some implementations;
    # rejecting them keeps enrollment, rotation, and login semantics identical.
    if len(password.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
        raise ValueError(
            "Password must be at most 72 UTF-8 bytes for bcrypt compatibility."
        )


def validate_password(password: str) -> None:
    """Reject weak passwords before bcrypt hashing.

    A valid password is 8-256 characters and no more than bcrypt's 72 UTF-8-byte
    limit. Password complexity checks have been relaxed per user preference.
    The function returns nothing on success and never logs the submitted secret.
    """

    # Password length floor updated to 8 characters minimum (max 256 characters).
    # Byte check prevents Unicode inputs from exceeding bcrypt's 72 UTF-8 byte boundary.
    if not 8 <= len(password) <= 256:
        # Raise error if password length is outside 8 to 256 characters
        raise ValueError("รหัสผ่านต้องมีความยาวระหว่าง 8 ถึง 256 ตัวอักษร")
    # Validate bcrypt byte length (max 72 UTF-8 bytes)
    validate_bcrypt_password_length(password)



def _validate_jwt_secret(secret: str) -> str:
    """Validate JWT key material and return its stripped value.

    The 32-byte minimum prevents accidentally replacing the generated key with
    a short human password. The key value is never included in an exception.
    """

    normalized = secret.strip()
    if len(normalized.encode("utf-8")) < 32:
        raise RuntimeError("JWT secret must contain at least 32 bytes.")
    return normalized


def get_jwt_secret() -> str:
    """Load a strong JWT secret from env or the persisted secret file.

    ``JWT_SECRET`` is supported for an external secret manager. Otherwise the
    function creates ``JWT_SECRET_PATH`` once with mode 0600. Exclusive creation
    prevents concurrent service starts from overwriting one another's key.
    """

    # An injected secret manager value takes precedence, but it must still meet
    # the same entropy-size guard as the persisted file.
    injected_secret = os.environ.get("JWT_SECRET")
    if injected_secret:
        return _validate_jwt_secret(injected_secret)

    secret_path = Path(SECRET_PATH)
    secret_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        # O_EXCL guarantees that only one racing process becomes key creator;
        # the loser re-opens the completed file below.
        descriptor = os.open(
            secret_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o600,
        )
    except FileExistsError:
        descriptor = None

    if descriptor is not None:
        generated_secret = secrets.token_urlsafe(48)
        with os.fdopen(descriptor, "w", encoding="utf-8") as secret_file:
            secret_file.write(generated_secret)
            secret_file.flush()
            os.fsync(secret_file.fileno())

    # Reading after the exclusive-create branch also handles a concurrent
    # creator consistently and validates legacy key files before token use.
    with secret_path.open("r", encoding="utf-8") as secret_file:
        return _validate_jwt_secret(secret_file.read())


# Loading the signing key once keeps all tokens issued by this process
# consistent; rotating the key intentionally takes effect after service restart.
JWT_SECRET = get_jwt_secret()


def log_audit(username: str, action: str, details: str, ip_address: str) -> None:
    """Persist a security audit event to the authentication database.

    Inputs are already normalized by their calling endpoint. The only side
    effect is one committed row in ``audit_logs``.
    """

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO audit_logs (timestamp, username, action, details, ip_address)
            VALUES (?, ?, ?, ?, ?)
            """,
            (timestamp, username, action, details, ip_address),
        )
        conn.commit()


def get_client_ip(request: Request) -> str:
    """Return a validated gateway client IP or fall back to the direct peer.

    The immediate TCP peer must resolve to ``AUTH_TRUSTED_PROXY_HOST`` before its
    ``X-Real-IP`` assertion is accepted. Length is capped before audit persistence.
    """

    peer = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("X-Real-IP", "").strip()
    if forwarded and TRUSTED_PROXY_HOST:
        try:
            # Resolve on each request so a recreated dashboard container does not
            # leave a stale trusted address cached for auth-service's lifetime.
            trusted_addresses = {
                address[4][0]
                for address in socket.getaddrinfo(
                    TRUSTED_PROXY_HOST,
                    None,
                    type=socket.SOCK_STREAM,
                )
            }
            if peer in trusted_addresses:
                # Nginx emits an IP literal. Parsing rejects control characters,
                # comma-separated proxy chains, hostnames, and log injection.
                return str(ipaddress.ip_address(forwarded))[:128]
        except (OSError, ValueError):
            # DNS or header parsing failure reduces trust rather than granting it.
            pass
    return peer[:128]


def require_audit_secret(
    x_bpp_audit_secret: Optional[str] = Header(
        default=None,
        alias="X-BPP-Audit-Secret",
    ),
) -> None:
    """Authenticate an internal audit producer with a shared secret.

    ``AUTH_AUDIT_SHARED_SECRET`` must contain at least 32 bytes. A missing or
    weak server setting fails closed with 503, while absent or incorrect caller
    credentials receive the same 403 response after constant-time comparison.
    """

    configured_secret = os.environ.get("AUTH_AUDIT_SHARED_SECRET", "")
    if len(configured_secret.encode("utf-8")) < 32:
        raise HTTPException(
            status_code=503,
            detail="Internal audit authentication is not configured",
        )

    # Comparing byte strings avoids Unicode normalization surprises and keeps
    # mismatch timing independent of the matching prefix length.
    provided_secret = (x_bpp_audit_secret or "").encode("utf-8")
    expected_secret = configured_secret.encode("utf-8")
    if not secrets.compare_digest(provided_secret, expected_secret):
        raise HTTPException(status_code=403, detail="Forbidden")


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    """Credentials accepted only for immediate verification during login."""

    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=512)


class UserCreate(BaseModel):
    """Validated fields an administrator may use to create a local account."""

    username: str = Field(min_length=3, max_length=64)
    # Pydantic rejects short create requests before they reach bcrypt hashing.
    password: str = Field(min_length=8, max_length=256)
    # Browser account creation intentionally excludes ``superadmin``; that
    # singular approval role is assigned with ``manage.py promote-superadmin``.
    # ``superadmin`` may be requested here but create_user() restricts it to
    # root accounts (ADR-0025).
    role: Literal["admin", "user", "superadmin"] = "user"


class UserUpdate(BaseModel):
    """Optional account changes; omitted fields retain their current value."""

    # Password updates enforce the same policy as new account creation.
    password: Optional[str] = Field(default=None, min_length=8, max_length=256)
    role: Optional[Literal["admin", "user", "superadmin"]] = None
    active: Optional[bool] = None


# Account Label limits (see CONTEXT.md: Display Name, Avatar).
DISPLAY_NAME_MAX = 40
AVATAR_MAX_BYTES = 150 * 1024  # browser sends ~256px JPEG (~30 KB); this is a safety cap


class ProfileUpdate(BaseModel):
    """Optional Display Name / Avatar change; omitted fields stay unchanged.

    An empty string clears the field. ``avatar`` is a base64 JPEG (optionally
    with a ``data:image/jpeg;base64,`` prefix).
    """

    display_name: Optional[str] = Field(default=None, max_length=200)
    avatar: Optional[str] = Field(default=None, max_length=400_000)


def _avatar_url(username: str, avatar_updated: Optional[int]) -> Optional[str]:
    """Return the versioned Avatar URL, or None when the account has none."""

    if not avatar_updated:
        return None
    return f"/auth/avatar/{username}?v={avatar_updated}"


class ChangePasswordRequest(BaseModel):
    """Payload for an authenticated user to change their own password."""

    new_password: str = Field(min_length=8, max_length=256)


class AuditLogEntry(BaseModel):
    """Bounded audit data accepted from an internal application integration."""

    action: str = Field(min_length=1, max_length=128)
    details: str = Field(min_length=1, max_length=2048)


class LocationUpdate(BaseModel):
    """Real-time geographic location coordinates transmitted by an authenticated officer."""

    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    heading: Optional[float] = None
    speed: Optional[float] = None


class LocationToggle(BaseModel):
    """Opt-in toggle payload to enable or disable personal GPS sharing."""

    enabled: bool


class LocationForceAll(BaseModel):
    """Payload to force-enable or disable GPS sharing for all online users."""

    enable: bool


class MissionCreate(BaseModel):
    """Payload to initiate a new operational mission."""

    name: str = Field(min_length=1, max_length=128)


# ---------------------------------------------------------------------------
# Lifecycle and authentication dependencies
# ---------------------------------------------------------------------------
@app.on_event("startup")
def startup() -> None:
    """Validate database readiness before accepting any request."""

    init_db()


def _extract_token(request: Request, authorization: Optional[str]) -> str:
    """Extract a Bearer token or the HttpOnly session cookie.

    Bearer authentication remains available for trusted non-browser clients;
    browsers use the cookie so JavaScript cannot read or exfiltrate the JWT.
    """

    if authorization:
        scheme, separator, value = authorization.partition(" ")
        if separator and scheme.lower() == "bearer" and value.strip():
            return value.strip()
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    cookie_token = request.cookies.get(SESSION_COOKIE_NAME)
    if cookie_token:
        return cookie_token
    raise HTTPException(status_code=401, detail="Unauthorized")


def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Authenticate a request and return current database-backed identity.

    JWT claims establish the subject and expiry only. Active state and role are
    re-read from SQLite on every request so deactivation or demotion revokes
    access immediately instead of trusting stale client-side role data.
    """

    token = _extract_token(request, authorization)
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"],
            issuer=JWT_ISSUER,
            options={"require": ["sub", "iat", "exp", "iss"]},
        )
    except jwt.ExpiredSignatureError as error:
        raise HTTPException(status_code=401, detail="Token expired") from error
    except jwt.InvalidTokenError as error:
        raise HTTPException(status_code=401, detail="Invalid token") from error

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(status_code=401, detail="Invalid token")

    # The database is authoritative for authorization, which also makes account
    # deletion and role changes effective without waiting for token expiry.
    with get_conn() as conn:
        user = conn.execute(
            "SELECT username, role FROM users WHERE username = ? AND active = 1",
            (subject,),
        ).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="Account is inactive or unavailable")
    return {"sub": user["username"], "role": user["role"]}


def require_admin(user_payload: dict = Depends(get_current_user)) -> dict:
    """Require an administrator-capable role and return current identity.

    ``superadmin`` inherits every ordinary administration capability while
    retaining separate gates for model adjudication and rollback operations.
    """

    # Membership in the fixed server-side set avoids client-defined role
    # aliases and preserves the existing fail-closed behavior.
    if user_payload.get("role") not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="ต้องเป็นแอดมินเท่านั้น")
    return user_payload


def require_superadmin(user_payload: dict = Depends(get_current_user)) -> dict:
    """Require the singular model-approval role and return current identity."""

    # Model promotion, conflict adjudication, and rollback must never be
    # available to an ordinary administrator or a browser-asserted role.
    if user_payload.get("role") != SUPERADMIN_ROLE:
        raise HTTPException(status_code=403, detail="ต้องเป็นผู้ดูแลระบบระดับสูงเท่านั้น")
    return user_payload


def _verification_response(user_payload: dict) -> Response:
    """Build the identity headers consumed by nginx ``auth_request``."""

    response = Response(status_code=200)
    response.headers["X-User"] = user_payload["sub"]
    response.headers["X-Role"] = user_payload["role"]
    response.headers["Cache-Control"] = "no-store"
    return response


# ---------------------------------------------------------------------------
# Authentication and session endpoints
# ---------------------------------------------------------------------------
@app.post("/auth/login")
def login(req: LoginRequest, request: Request, response: Response) -> dict:
    """Verify credentials and establish an HttpOnly browser session.

    Success returns only display identity; the signed JWT is sent exclusively
    as a Secure, SameSite=Strict, HttpOnly cookie. Failed attempts are tracked
    per proxied client IP and username and may trigger a temporary lockout.
    Inputs beyond bcrypt's byte limit are rejected before hash verification.
    """

    # Login does not re-apply enrollment complexity to legacy credentials, but
    # it must enforce bcrypt's byte boundary consistently and return a clear
    # validation error instead of depending on backend truncation behavior.
    try:
        validate_bcrypt_password_length(req.password)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    ip_addr = get_client_ip(request)
    now = datetime.datetime.now()
    submitted_username = req.username.strip()

    with get_conn() as conn:
        # Expired lockouts reset before password verification so a successful
        # login starts with a clean attempt counter.
        attempt = conn.execute(
            """
            SELECT failed_count, locked_until
            FROM login_attempts
            WHERE ip_address = ? AND username = ?
            """,
            (ip_addr, submitted_username),
        ).fetchone()
        if attempt and attempt["locked_until"]:
            locked_until = datetime.datetime.strptime(
                attempt["locked_until"], "%Y-%m-%d %H:%M:%S"
            )
            if now < locked_until:
                raise HTTPException(
                    status_code=429,
                    detail=(
                        "บัญชีนี้ถูกล็อค กรุณาลองใหม่เวลา "
                        f"{locked_until.strftime('%H:%M:%S')}"
                    ),
                )
            conn.execute(
                """
                UPDATE login_attempts
                SET failed_count = 0, locked_until = NULL
                WHERE ip_address = ? AND username = ?
                """,
                (ip_addr, submitted_username),
            )
            conn.commit()
            attempt = None

        user = conn.execute(
            "SELECT * FROM users WHERE username = ? AND active = 1",
            (submitted_username,),
        ).fetchone()
        # Always execute one bcrypt verification. Unknown and inactive usernames
        # use a process-local dummy hash so their timing does not reveal account
        # existence, while the explicit user check prevents dummy authentication.
        verification_hash = (
            user["password_hash"] if user else _DUMMY_PASSWORD_HASH
        )
        password_matches = pwd_context.verify(req.password, verification_hash)
        password_valid = bool(user and password_matches)
        if not password_valid:
            # The same response covers absent, inactive, and incorrect accounts
            # so external callers cannot enumerate valid usernames.
            failed_count = (attempt["failed_count"] if attempt else 0) + 1
            locked_until_value = None
            if failed_count >= MAX_FAILED_ATTEMPTS:
                locked_until_value = (
                    now + datetime.timedelta(minutes=LOCKOUT_MINUTES)
                ).strftime("%Y-%m-%d %H:%M:%S")
            conn.execute(
                """
                INSERT INTO login_attempts
                    (ip_address, username, failed_count, locked_until)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(ip_address, username) DO UPDATE SET
                    failed_count = excluded.failed_count,
                    locked_until = excluded.locked_until
                """,
                (ip_addr, submitted_username, failed_count, locked_until_value),
            )
            conn.commit()
            log_audit(
                submitted_username,
                "LOGIN_FAILED",
                "Credential verification failed",
                ip_addr,
            )
            raise HTTPException(
                status_code=401, detail="ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
            )

        # A successful login clears stale failure state before issuing a fresh
        # token whose role will still be re-checked on every authenticated call.
        conn.execute(
            "DELETE FROM login_attempts WHERE ip_address = ? AND username = ?",
            (ip_addr, submitted_username),
        )
        conn.commit()

    log_audit(
        submitted_username,
        "LOGIN_SUCCESS",
        "Logged in successfully",
        ip_addr,
    )
    issued_at = datetime.datetime.now(datetime.timezone.utc)
    expires_at = issued_at + datetime.timedelta(hours=SESSION_HOURS)
    token = jwt.encode(
        {
            "sub": user["username"],
            "iat": int(issued_at.timestamp()),
            "exp": int(expires_at.timestamp()),
            "iss": JWT_ISSUER,
            "jti": secrets.token_hex(16),
        },
        JWT_SECRET,
        algorithm="HS256",
    )

    # HttpOnly prevents stored XSS from reading the token; Secure and
    # SameSite=Strict constrain transport and cross-site request attachment.
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_HOURS * 3600,
        expires=expires_at,
        path="/",
        secure=SESSION_COOKIE_SECURE,
        httponly=True,
        samesite="strict",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"username": user["username"], "role": user["role"]}


@app.post("/auth/logout")
def logout(response: Response) -> dict:
    """Expire the server-managed session cookie without exposing its value."""

    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        secure=SESSION_COOKIE_SECURE,
        httponly=True,
        samesite="strict",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"status": "ok"}


@app.get("/auth/session")
def get_session(
    response: Response,
    user_payload: dict = Depends(get_current_user),
) -> dict:
    """Return display identity for an authenticated browser session."""

    response.headers["Cache-Control"] = "no-store"
    with get_conn() as conn:
        row = conn.execute(
            "SELECT display_name, avatar_updated FROM users WHERE username = ?",
            (user_payload["sub"],),
        ).fetchone()
    return {
        "username": user_payload["sub"],
        "role": user_payload["role"],
        "display_name": row["display_name"] if row else None,
        "avatar_url": _avatar_url(user_payload["sub"], row["avatar_updated"]) if row else None,
    }


@app.put("/auth/change-password")
def change_own_password(
    data: ChangePasswordRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Allow any active authenticated user to change their own password."""
    try:
        validate_password(data.new_password)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    username = current_user["sub"]
    password_hash = pwd_context.hash(data.new_password)

    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        user = conn.execute(
            "SELECT username FROM users WHERE username = ? AND active = 1",
            (username,),
        ).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="ไม่พบบัญชีผู้ใช้")

        conn.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            (password_hash, username),
        )
        conn.commit()

    log_audit(
        username,
        "PASSWORD_CHANGED",
        "User updated their own password",
        get_client_ip(request),
    )
    return {"message": "เปลี่ยนรหัสผ่านสำเร็จ"}


@app.get("/auth/verify")
def verify_token(user_payload: dict = Depends(get_current_user)) -> Response:
    """Authorize any active account for nginx ``auth_request``."""

    return _verification_response(user_payload)


@app.get("/auth/verify/admin")
def verify_admin(admin: dict = Depends(require_admin)) -> Response:
    """Authorize only a current administrator for privileged nginx routes."""

    return _verification_response(admin)


@app.get("/auth/verify/superadmin")
def verify_superadmin(superadmin: dict = Depends(require_superadmin)) -> Response:
    """Authorize only the current superadministrator for nginx gates."""

    return _verification_response(superadmin)


# ---------------------------------------------------------------------------
# User management endpoints
# ---------------------------------------------------------------------------
@app.get("/auth/internal/users")
def list_internal_users(request: Request) -> list[dict]:
    secret = os.environ.get("MEDIA_COMPAT_PROXY_SHARED_SECRET", "bpp_dev_secret_2026_!@#")
    client_secret = request.headers.get("X-BPP-Proxy-Secret", "")
    if not client_secret or not hmac.compare_digest(client_secret, secret):
        raise HTTPException(status_code=403, detail="Internal endpoint requires proxy secret")
    """List active user accounts for internal trusted container services (nas-bot, etc.)."""
    with get_conn() as conn:
        users = conn.execute(
            "SELECT username, role, active FROM users WHERE active = 1 ORDER BY username"
        ).fetchall()
    return [dict(user) for user in users]


@app.get("/auth/users")
def list_users(admin: dict = Depends(require_admin)) -> list[dict]:
    """List non-secret account state for an authenticated administrator."""

    # The dependency enforces authorization; this query intentionally omits all
    # password hashes and stable session material from the response.
    del admin
    with get_conn() as conn:
        users = conn.execute(
            "SELECT username, role, active, display_name, avatar_updated FROM users ORDER BY username"
        ).fetchall()
    result = []
    for user in users:
        row = dict(user)
        row["avatar_url"] = _avatar_url(row["username"], row.pop("avatar_updated"))
        result.append(row)
    return result


# ---------------------------------------------------------------------------
# Account Label endpoints: Display Name + Avatar
# ---------------------------------------------------------------------------
@app.get("/auth/profiles")
def list_profiles(user_payload: dict = Depends(get_current_user)) -> dict:
    """Return the Account Label of every active account for any signed-in user.

    Inputs: Authenticated session.
    Outputs: ``{"profiles": {username: {display_name, avatar_url}}}``.
    Side effects: None. Avatars are referenced by versioned URL, never inlined.
    """

    del user_payload
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT username, display_name, avatar_updated FROM users WHERE active = 1"
        ).fetchall()
    return {
        "profiles": {
            r["username"]: {
                "display_name": r["display_name"],
                "avatar_url": _avatar_url(r["username"], r["avatar_updated"]),
            }
            for r in rows
        }
    }


@app.get("/auth/avatar/{username}")
def get_avatar(
    username: str,
    user_payload: dict = Depends(get_current_user),
) -> Response:
    """Serve one account's Avatar as a JPEG; 404 if it has none."""

    del user_payload
    with get_conn() as conn:
        row = conn.execute(
            "SELECT avatar FROM users WHERE username = ? AND active = 1",
            (username,),
        ).fetchone()
    if not row or not row["avatar"]:
        raise HTTPException(status_code=404, detail="No avatar")
    try:
        body = base64.b64decode(row["avatar"])
    except Exception as error:
        raise HTTPException(status_code=404, detail="No avatar") from error
    # The URL carries a version stamp, so a long private cache is safe.
    return Response(
        content=body,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _apply_profile_update(username: str, data: ProfileUpdate) -> dict:
    """Validate and persist Display Name / Avatar changes for one account."""

    sets: list[str] = []
    params: list = []
    if data.display_name is not None:
        name = re.sub(r"[\x00-\x1f\x7f]", "", data.display_name).strip()
        if len(name) > DISPLAY_NAME_MAX:
            raise HTTPException(status_code=422, detail="ชื่อเรียกต้องไม่เกิน 40 ตัวอักษร")
        sets.append("display_name = ?")
        params.append(name or None)
    if data.avatar is not None:
        if data.avatar == "":
            sets.append("avatar = NULL")
            sets.append("avatar_updated = NULL")
        else:
            b64 = data.avatar
            if b64.startswith("data:image/jpeg;base64,"):
                b64 = b64.split(",", 1)[1]
            try:
                raw = base64.b64decode(b64, validate=True)
            except Exception as error:
                raise HTTPException(status_code=422, detail="รูปไม่ถูกต้อง") from error
            if len(raw) > AVATAR_MAX_BYTES or not raw.startswith(b"\xff\xd8\xff"):
                raise HTTPException(
                    status_code=422,
                    detail="รูปต้องเป็น JPEG ขนาดไม่เกิน 150 KB",
                )
            sets.append("avatar = ?")
            params.append(b64)
            sets.append("avatar_updated = ?")
            params.append(int(datetime.datetime.now(datetime.timezone.utc).timestamp()))
    if not sets:
        raise HTTPException(status_code=422, detail="ไม่มีข้อมูลให้แก้ไข")
    params.append(username)
    with get_conn() as conn:
        cur = conn.execute(f"UPDATE users SET {', '.join(sets)} WHERE username = ?", params)
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="ไม่พบบัญชีผู้ใช้")
        conn.commit()
        row = conn.execute(
            "SELECT display_name, avatar_updated FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    return {
        "username": username,
        "display_name": row["display_name"],
        "avatar_url": _avatar_url(username, row["avatar_updated"]),
    }


@app.put("/auth/profile")
def update_own_profile(
    data: ProfileUpdate,
    request: Request,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Let any signed-in account set or clear its own Display Name and Avatar."""

    username = current_user["sub"]
    result = _apply_profile_update(username, data)
    log_audit(username, "PROFILE_UPDATED", "Updated own display name/avatar", get_client_ip(request))
    return result


@app.put("/auth/users/{username}/profile")
def admin_update_profile(
    username: str,
    data: ProfileUpdate,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    """Let an Admin/Superadmin edit or clear another account's Account Label.

    Follows the ADR-0025 account-management rules, so only a root may touch a
    root account and only a superadmin may touch a superadmin.
    """

    with get_conn() as conn:
        target = conn.execute(
            "SELECT role FROM users WHERE username = ?", (username,)
        ).fetchone()
    if not target:
        raise HTTPException(status_code=404, detail="ไม่พบบัญชีผู้ใช้")
    if username != admin["sub"]:
        _enforce_account_management(
            admin, username, target["role"], target["role"], suspends_or_deletes=False
        )
    result = _apply_profile_update(username, data)
    log_audit(
        admin["sub"],
        "PROFILE_UPDATED_BY_ADMIN",
        f"Updated display name/avatar of {username}",
        get_client_ip(request),
    )
    return result


@app.post("/auth/users")
def create_user(
    user: UserCreate,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    """Create a validated account and audit the administrator action."""

    try:
        username = validate_username(user.username)
        validate_password(user.password)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    if user.role == SUPERADMIN_ROLE and not _is_root(admin.get("sub")):
        raise HTTPException(
            status_code=403,
            detail="เฉพาะบัญชี root เท่านั้นที่สร้างผู้ดูแลระบบระดับสูงได้",
        )

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT username FROM users WHERE username = ?", (username,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="มีชื่อผู้ใช้นี้ในระบบแล้ว")

        # Only the bcrypt hash is persisted; plaintext exists for the duration
        # of this request and is excluded from every response and audit record.
        password_hash = pwd_context.hash(user.password)
        conn.execute(
            """
            INSERT INTO users (username, password_hash, role, active)
            VALUES (?, ?, ?, 1)
            """,
            (username, password_hash, user.role),
        )
        conn.commit()

    log_audit(
        admin["sub"],
        "USER_CREATED",
        f"Created user {username} with role {user.role}",
        get_client_ip(request),
    )
    return {"message": "เพิ่มผู้ใช้สำเร็จ"}


def _active_admin_count(conn: sqlite3.Connection) -> int:
    """Return enabled admin-capable accounts in the current transaction."""

    # Both privileged roles can recover ordinary administration, so either one
    # protects the installation from becoming unmanageable.
    row = conn.execute(
        "SELECT COUNT(*) AS count FROM users WHERE role IN ('admin', 'superadmin') AND active = 1"
    ).fetchone()
    return int(row["count"])


def _active_superadmin_count(conn: sqlite3.Connection) -> int:
    """Return enabled model approvers so the final one cannot be removed."""

    # The dedicated count supports a stronger invariant than ordinary admin
    # continuity once the installation has provisioned its first approver.
    row = conn.execute(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'superadmin' AND active = 1"
    ).fetchone()
    return int(row["count"])


@app.put("/auth/users/{username}")
def update_user(
    username: str,
    data: UserUpdate,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    """Update an account while preserving at least one active administrator."""

    try:
        normalized_username = validate_username(username)
        if data.password is not None:
            validate_password(data.password)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    with get_conn() as conn:
        # An immediate transaction serializes concurrent admin demotions and
        # deletions so two requests cannot both believe another admin remains.
        conn.execute("BEGIN IMMEDIATE")
        current_user = conn.execute(
            "SELECT username, role, active FROM users WHERE username = ?",
            (normalized_username,),
        ).fetchone()
        if not current_user:
            raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้")

        resulting_role = data.role if data.role is not None else current_user["role"]
        resulting_active = (
            int(data.active) if data.active is not None else int(current_user["active"])
        )
        # ADR-0025: ordinary admins cannot touch superadmins; non-root cannot
        # touch root accounts or grant/revoke superadmin; no self lock-out.
        _enforce_account_management(
            admin,
            normalized_username,
            current_user["role"],
            resulting_role,
            suspends_or_deletes=(resulting_active != int(current_user["active"]) and resulting_active == 0),
        )
        removes_active_admin = (
            current_user["role"] in ADMIN_ROLES
            and int(current_user["active"]) == 1
            and (resulting_role not in ADMIN_ROLES or resulting_active != 1)
        )
        if removes_active_admin and _active_admin_count(conn) <= 1:
            raise HTTPException(
                status_code=409,
                detail="ต้องมีบัญชีแอดมินที่เปิดใช้งานอย่างน้อยหนึ่งบัญชี",
            )

        # Once provisioned, the final active superadministrator cannot be
        # demoted or suspended through the web API; rotation uses the local CLI.
        removes_active_superadmin = (
            current_user["role"] == SUPERADMIN_ROLE
            and int(current_user["active"]) == 1
            and (resulting_role != SUPERADMIN_ROLE or resulting_active != 1)
        )
        if removes_active_superadmin and _active_superadmin_count(conn) <= 1:
            raise HTTPException(
                status_code=409,
                detail="ต้องมีผู้ดูแลระบบระดับสูงที่เปิดใช้งานอย่างน้อยหนึ่งบัญชี",
            )

        updates: list[str] = []
        parameters: list[object] = []
        if data.password is not None:
            updates.append("password_hash = ?")
            parameters.append(pwd_context.hash(data.password))
        if data.role is not None:
            updates.append("role = ?")
            parameters.append(data.role)
        if data.active is not None:
            updates.append("active = ?")
            parameters.append(int(data.active))

        # No-op updates remain successful for idempotent admin UI saves; actual
        # changes are committed and audited without recording secret values.
        if updates:
            parameters.append(normalized_username)
            conn.execute(
                f"UPDATE users SET {', '.join(updates)} WHERE username = ?",
                parameters,
            )
            conn.commit()
        else:
            conn.rollback()

    if updates:
        log_audit(
            admin["sub"],
            "USER_UPDATED",
            f"Updated user {normalized_username}",
            get_client_ip(request),
        )
    return {"message": "อัปเดตผู้ใช้สำเร็จ"}


@app.delete("/auth/users/{username}")
def delete_user(
    username: str,
    request: Request,
    admin: dict = Depends(require_admin),
) -> dict:
    """Delete an account unless it is the final active administrator."""

    try:
        normalized_username = validate_username(username)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    with get_conn() as conn:
        # The same serialized invariant used by update prevents concurrent
        # requests from deleting every active administrator.
        conn.execute("BEGIN IMMEDIATE")
        target = conn.execute(
            "SELECT role, active FROM users WHERE username = ?",
            (normalized_username,),
        ).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้")
        # ADR-0025: same management rules as update (root protection, no
        # self-deletion, superadmin-only for superadmin targets).
        _enforce_account_management(
            admin,
            normalized_username,
            target["role"],
            target["role"],
            suspends_or_deletes=True,
        )
        if (
            target["role"] in ADMIN_ROLES
            and int(target["active"]) == 1
            and _active_admin_count(conn) <= 1
        ):
            raise HTTPException(
                status_code=409,
                detail="ต้องมีบัญชีแอดมินที่เปิดใช้งานอย่างน้อยหนึ่งบัญชี",
            )
        # The final model approver is independently protected even if ordinary
        # administrators remain active.
        if (
            target["role"] == SUPERADMIN_ROLE
            and int(target["active"]) == 1
            and _active_superadmin_count(conn) <= 1
        ):
            raise HTTPException(
                status_code=409,
                detail="ต้องมีผู้ดูแลระบบระดับสูงที่เปิดใช้งานอย่างน้อยหนึ่งบัญชี",
            )

        conn.execute("DELETE FROM users WHERE username = ?", (normalized_username,))
        conn.commit()

    log_audit(
        admin["sub"],
        "USER_DELETED",
        f"Deleted user {normalized_username}",
        get_client_ip(request),
    )
    return {"message": "ลบผู้ใช้สำเร็จ"}


# ---------------------------------------------------------------------------
# Audit endpoints
# ---------------------------------------------------------------------------
@app.get("/auth/audit")
def get_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    admin: dict = Depends(require_admin),
) -> list[dict]:
    """Return a bounded newest-first audit view to administrators only."""

    del admin
    with get_conn() as conn:
        logs = conn.execute(
            "SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(entry) for entry in logs]


@app.post("/auth/audit")
def create_audit_log(
    entry: AuditLogEntry,
    request: Request,
    x_user: Optional[str] = Header(default=None),
    audit_access: None = Depends(require_audit_secret),
) -> dict:
    """Accept an authenticated internal-service audit event.

    The producer must supply ``AUTH_AUDIT_SHARED_SECRET`` in the
    ``X-BPP-Audit-Secret`` header. The endpoint records its asserted user only
    after the dependency performs a constant-time secret comparison.
    """

    # Referencing the dependency result documents that authorization has
    # completed even though successful verification intentionally returns None.
    del audit_access
    username = (x_user or "system").strip()[:128] or "system"
    log_audit(username, entry.action, entry.details, get_client_ip(request))
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Online Presence & Real-time Location Tracking Endpoints (ADR-0013)
# ---------------------------------------------------------------------------
@app.post("/auth/heartbeat")
def heartbeat(
    user_payload: dict = Depends(get_current_user),
) -> dict:
    """Record an active client ping and return presence/mission status.

    Inputs: user_payload (from authenticated session cookie/token).
    Outputs: Dictionary with status, username, location_sharing flag, and active_mission info.
    Side effects: Upserts user_presence with is_online=1 and current ISO timestamp.
    """
    username = user_payload["sub"]
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """
            INSERT INTO user_presence (username, is_online, last_heartbeat)
            VALUES (?, 1, ?)
            ON CONFLICT(username) DO UPDATE SET
                is_online = 1,
                last_heartbeat = excluded.last_heartbeat
            """,
            (username, now_iso),
        )
        row = conn.execute(
            "SELECT location_sharing FROM user_presence WHERE username = ?",
            (username,),
        ).fetchone()
        loc_sharing = bool(row["location_sharing"]) if row else False

        mission = conn.execute(
            """
            SELECT id, name, created_by, started_at
            FROM missions
            WHERE ended_at IS NULL
            ORDER BY id DESC LIMIT 1
            """
        ).fetchone()
        active_mission = dict(mission) if mission else None
        
        # Check if sharing_enabled=1 in user_location
        ul_row = conn.execute(
            "SELECT sharing_enabled FROM user_location WHERE username = ?",
            (username,)
        ).fetchone()
        sharing_enabled = bool(ul_row["sharing_enabled"]) if ul_row else False
        
        # force_location is true if sharing_enabled=1 but client hasn't activated it (loc_sharing is False)
        force_location = sharing_enabled and not loc_sharing
        
        # force_location_off is true ONLY if superadmin explicitly forced sharing_enabled=0 while user was sharing
        force_location_off = (ul_row is not None and not sharing_enabled) and loc_sharing

        if force_location_off:
            conn.execute(
                "UPDATE user_presence SET location_sharing = 0 WHERE username = ?",
                (username,),
            )
            loc_sharing = False

        conn.commit()

    return {
        "status": "ok",
        "username": username,
        "location_sharing": loc_sharing,
        "active_mission": active_mission,
        "force_location": force_location,
        "force_location_off": force_location_off,
    }


@app.post("/auth/location/toggle")
def toggle_location_sharing(
    payload: LocationToggle,
    user_payload: dict = Depends(get_current_user),
) -> dict:
    """Enable or disable real-time location sharing for the current user.

    Inputs: LocationToggle(enabled: bool).
    Outputs: Dictionary with status and updated location_sharing boolean.
    Side effects: Updates user_presence.location_sharing. If disabled, purges current
                  published coordinates from user_location so user disappears from map.
    """
    username = user_payload["sub"]
    sharing_val = 1 if payload.enabled else 0
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """
            INSERT INTO user_presence (username, is_online, last_heartbeat, location_sharing)
            VALUES (?, 1, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
                location_sharing = excluded.location_sharing
            """,
            (username, now_iso, sharing_val),
        )
        if payload.enabled:
            conn.execute(
                """
                INSERT INTO user_location (username, sharing_enabled)
                VALUES (?, 1)
                ON CONFLICT(username) DO UPDATE SET
                    sharing_enabled = 1
                """,
                (username,)
            )
        else:
            conn.execute("DELETE FROM user_location WHERE username = ?", (username,))
        conn.commit()

    return {"status": "ok", "location_sharing": payload.enabled}


@app.post("/auth/location/force-all")
def force_all_location_sharing(
    payload: LocationForceAll,
    request: Request,
    superadmin: dict = Depends(require_superadmin),
) -> dict:
    """Force-enable or force-disable location sharing for ALL online users (Superadmin only)."""
    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        
        if payload.enable:
            # Insert or Update for all currently online users
            cur = conn.execute(
                """
                INSERT INTO user_location (username, sharing_enabled)
                SELECT username, 1
                FROM user_presence
                WHERE is_online = 1
                ON CONFLICT(username) DO UPDATE SET
                    sharing_enabled = 1
                """
            )
            conn.execute(
                "UPDATE user_presence SET location_sharing = 1 WHERE username = ?",
                (superadmin["sub"],),
            )
            affected = cur.rowcount
            log_action = "FORCE_LOCATION_ENABLE_ALL"
            log_details = f"Force enabled location sharing for {affected} online users"
        else:
            cur = conn.execute(
                """
                UPDATE user_location
                SET sharing_enabled = 0,
                    latitude = NULL,
                    longitude = NULL,
                    accuracy = NULL,
                    heading = NULL,
                    speed = NULL
                """
            )
            # Clear location sharing immediately for the executing superadmin
            conn.execute(
                "UPDATE user_presence SET location_sharing = 0 WHERE username = ?",
                (superadmin["sub"],),
            )
            # NOTE: keep other user_presence.location_sharing untouched so the next heartbeat
            # can signal force_location_off to clients that are still sharing.
            # (Heartbeat clears the flag after signalling.)
            affected = cur.rowcount
            log_action = "FORCE_LOCATION_DISABLE_ALL"
            log_details = f"Force disabled location sharing for {affected} users"

        conn.commit()

    log_audit(
        superadmin["sub"],
        log_action,
        log_details,
        get_client_ip(request),
    )
    return {"status": "ok", "affected": affected}


@app.post("/auth/location")
def update_location(
    loc: LocationUpdate,
    user_payload: dict = Depends(get_current_user),
) -> dict:
    """Accept incoming GPS coordinates from an authenticated officer.

    Inputs: LocationUpdate with latitude, longitude, accuracy, heading, speed.
    Outputs: Dictionary with status and recorded_in_mission flag.
    Side effects: Upserts user_location snapshot; appends to mission_tracks if a mission is active.
    """
    username = user_payload["sub"]
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            "SELECT sharing_enabled FROM user_location WHERE username = ?",
            (username,),
        ).fetchone()
        if existing is not None and not existing["sharing_enabled"]:
            # Sharing disabled (e.g. superadmin force-all off); client must call
            # /auth/location/toggle to re-enable. Do not resurrect the pin.
            conn.commit()
            return {"status": "ok", "recorded_in_mission": False, "sharing_disabled": True}
        # Ensure user presence is active with location sharing enabled
        conn.execute(
            """
            INSERT INTO user_presence (username, is_online, last_heartbeat, location_sharing)
            VALUES (?, 1, ?, 1)
            ON CONFLICT(username) DO UPDATE SET
                is_online = 1,
                last_heartbeat = excluded.last_heartbeat,
                location_sharing = 1
            """,
            (username, now_iso),
        )
        # Update latest coordinate snapshot
        conn.execute(
            """
            INSERT INTO user_location (username, latitude, longitude, accuracy, heading, speed, sharing_enabled, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(username) DO UPDATE SET
                latitude = excluded.latitude,
                longitude = excluded.longitude,
                accuracy = excluded.accuracy,
                heading = excluded.heading,
                speed = excluded.speed,
                sharing_enabled = 1,
                updated_at = excluded.updated_at
            """,
            (username, loc.latitude, loc.longitude, loc.accuracy, loc.heading, loc.speed, now_iso),
        )

        recorded_in_mission = False
        active_mission = conn.execute(
            "SELECT id FROM missions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if active_mission:
            mission_id = active_mission["id"]
            conn.execute(
                """
                INSERT INTO mission_tracks (mission_id, username, latitude, longitude, accuracy, heading, speed, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (mission_id, username, loc.latitude, loc.longitude, loc.accuracy, loc.heading, loc.speed, now_iso),
            )
            recorded_in_mission = True

        conn.commit()

    return {"status": "ok", "recorded_in_mission": recorded_in_mission}


@app.get("/auth/presence")
def get_user_presence(
    user_payload: dict = Depends(get_current_user),
) -> list[dict]:
    """Return all active users with their online presence and location sharing status.

    Inputs: Authenticated session.
    Outputs: List of user dicts with username, role, is_online, last_heartbeat, location_sharing, and optional location.
    Side effects: Evaluates heartbeat freshness within the last 65 seconds to declare online status.
    """
    del user_payload
    now = datetime.datetime.now(datetime.timezone.utc)

    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT u.username, u.role, u.active, u.display_name, u.avatar_updated,
                   p.last_heartbeat,
                   COALESCE(p.location_sharing, 0) as location_sharing,
                   l.latitude, l.longitude, l.accuracy, l.heading, l.speed, l.updated_at as location_updated_at
            FROM users u
            LEFT JOIN user_presence p ON u.username = p.username
            LEFT JOIN user_location l ON u.username = l.username
            WHERE u.active = 1
            ORDER BY u.username
            """
        ).fetchall()

    results = []
    for r in rows:
        last_hb = r["last_heartbeat"]
        is_online = False
        if last_hb:
            try:
                hb_dt = datetime.datetime.fromisoformat(last_hb)
                if hb_dt.tzinfo is None:
                    hb_dt = hb_dt.replace(tzinfo=datetime.timezone.utc)
                diff_sec = (now - hb_dt).total_seconds()
                is_online = (diff_sec <= 65)  # 65 seconds allowance for 30s heartbeat interval
            except Exception:
                is_online = False

        loc_data = None
        if bool(r["location_sharing"]) and is_online and r["latitude"] is not None:
            loc_data = {
                "latitude": r["latitude"],
                "longitude": r["longitude"],
                "accuracy": r["accuracy"],
                "heading": r["heading"],
                "speed": r["speed"],
                "updated_at": r["location_updated_at"],
            }

        results.append({
            "username": r["username"],
            "role": r["role"],
            "display_name": r["display_name"],
            "avatar_url": _avatar_url(r["username"], r["avatar_updated"]),
            "is_online": is_online,
            "last_heartbeat": last_hb,
            "location_sharing": bool(r["location_sharing"]),
            "location": loc_data,
        })

    return results


@app.get("/auth/locations")
def get_active_locations(
    user_payload: dict = Depends(get_current_user),
) -> dict:
    """Return current coordinates of all online officers actively sharing location.

    Inputs: Authenticated session.
    Outputs: Dict containing 'officers' list and current 'active_mission'.
    Side effects: Only includes officers whose heartbeat is active (<65s) and location_sharing=1.
    """
    del user_payload
    now = datetime.datetime.now(datetime.timezone.utc)

    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT u.username, u.role, u.display_name, u.avatar_updated,
                   p.last_heartbeat,
                   l.latitude, l.longitude, l.accuracy, l.heading, l.speed, l.updated_at
            FROM users u
            JOIN user_presence p ON u.username = p.username
            JOIN user_location l ON u.username = l.username
            WHERE u.active = 1 AND p.location_sharing = 1
            ORDER BY u.username
            """
        ).fetchall()

        mission = conn.execute(
            "SELECT id, name, created_by, started_at FROM missions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1"
        ).fetchone()
        active_mission = dict(mission) if mission else None

    officers = []
    for r in rows:
        last_hb = r["last_heartbeat"]
        is_online = False
        if last_hb:
            try:
                hb_dt = datetime.datetime.fromisoformat(last_hb)
                if hb_dt.tzinfo is None:
                    hb_dt = hb_dt.replace(tzinfo=datetime.timezone.utc)
                is_online = ((now - hb_dt).total_seconds() <= 65)
            except Exception:
                is_online = False

        if is_online and r["latitude"] is not None:
            officers.append({
                "username": r["username"],
                "role": r["role"],
                "display_name": r["display_name"],
                "avatar_url": _avatar_url(r["username"], r["avatar_updated"]),
                "latitude": r["latitude"],
                "longitude": r["longitude"],
                "accuracy": r["accuracy"],
                "heading": r["heading"],
                "speed": r["speed"],
                "updated_at": r["updated_at"],
            })

    return {
        "officers": officers,
        "active_mission": active_mission,
    }


# ---------------------------------------------------------------------------
# Mission Lifecycle & Trajectory History Endpoints (ADR-0013)
# ---------------------------------------------------------------------------
@app.post("/auth/mission/start")
def start_mission(
    payload: MissionCreate,
    admin: dict = Depends(require_admin),
) -> dict:
    """Initiate an operational mission (Admin only).

    Inputs: MissionCreate(name: str).
    Outputs: Dictionary with created mission_id, name, and started_at timestamp.
    Side effects: Closes any prior unclosed mission and records audit entry.
    """
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    creator = admin["sub"]

    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("UPDATE missions SET ended_at = ? WHERE ended_at IS NULL", (now_iso,))
        cursor = conn.execute(
            """
            INSERT INTO missions (name, created_by, started_at)
            VALUES (?, ?, ?)
            """,
            (payload.name.strip(), creator, now_iso),
        )
        mission_id = cursor.lastrowid
        conn.commit()

    log_audit(creator, "MISSION_STARTED", f"Mission #{mission_id} '{payload.name}' started", "internal")
    return {
        "status": "ok",
        "mission_id": mission_id,
        "name": payload.name.strip(),
        "started_at": now_iso,
    }


@app.post("/auth/mission/end")
def end_mission(
    admin: dict = Depends(require_admin),
) -> dict:
    """Conclude the currently active operational mission (Admin only).

    Inputs: Admin authorization.
    Outputs: Status confirmation and count of concluded missions.
    Side effects: Sets ended_at on all active missions and records audit entry.
    """
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    creator = admin["sub"]

    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        cur = conn.execute(
            "UPDATE missions SET ended_at = ? WHERE ended_at IS NULL",
            (now_iso,),
        )
        affected = cur.rowcount
        conn.commit()

    log_audit(creator, "MISSION_ENDED", f"Active mission concluded ({affected} closed)", "internal")
    return {"status": "ok", "message": "ภารกิจสิ้นสุดแล้ว", "closed": affected}


@app.get("/auth/mission/active")
def get_active_mission(
    user_payload: dict = Depends(get_current_user),
) -> dict:
    """Return the currently running operational mission if any.

    Inputs: Authenticated session.
    Outputs: Dict with 'active': bool and 'mission': dict | None.
    Side effects: None (read-only query).
    """
    del user_payload
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, created_by, started_at FROM missions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1"
        ).fetchone()
    if row:
        return {"active": True, "mission": dict(row)}
    return {"active": False, "mission": None}


@app.get("/auth/mission/list")
def list_missions(
    admin: dict = Depends(require_admin),
) -> list[dict]:
    """List historical operational missions with participation metrics (Admin only).

    Inputs: Admin authorization.
    Outputs: List of mission records with participant and track point counts.
    Side effects: None (read-only query).
    """
    del admin
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT m.id, m.name, m.created_by, m.started_at, m.ended_at,
                   COUNT(DISTINCT t.username) as officer_count,
                   COUNT(t.id) as track_count
            FROM missions m
            LEFT JOIN mission_tracks t ON m.id = t.mission_id
            GROUP BY m.id
            ORDER BY m.id DESC
            LIMIT 50
            """
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/auth/mission/{mission_id}/tracks")
def get_mission_tracks(
    mission_id: int,
    admin: dict = Depends(require_admin),
) -> dict:
    """Retrieve GPS trajectory history for all officers in a specific mission (Admin only).

    Inputs: mission_id, Admin authorization.
    Outputs: Mission metadata and officer_tracks dictionary mapped by username.
    Side effects: None (read-only query).
    """
    del admin
    with get_conn() as conn:
        mission = conn.execute(
            "SELECT id, name, created_by, started_at, ended_at FROM missions WHERE id = ?",
            (mission_id,),
        ).fetchone()
        if not mission:
            raise HTTPException(status_code=404, detail="ไม่พบภารกิจที่ระบุ")

        track_rows = conn.execute(
            """
            SELECT id, username, latitude, longitude, accuracy, heading, speed, recorded_at
            FROM mission_tracks
            WHERE mission_id = ?
            ORDER BY username, recorded_at ASC
            """,
            (mission_id,),
        ).fetchall()

    officer_tracks: dict[str, list[dict]] = {}
    for tr in track_rows:
        u = tr["username"]
        if u not in officer_tracks:
            officer_tracks[u] = []
        officer_tracks[u].append({
            "lat": tr["latitude"],
            "lng": tr["longitude"],
            "accuracy": tr["accuracy"],
            "heading": tr["heading"],
            "speed": tr["speed"],
            "recorded_at": tr["recorded_at"],
        })

    return {
        "mission": dict(mission),
        "tracks": officer_tracks,
    }

