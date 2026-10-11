"""Encrypted, portable export format for local BPP-VMS user accounts.

Only account names, bcrypt hashes, roles, and enabled state are transferable.
The format intentionally excludes JWT signing keys, browser sessions, audit logs,
and login-attempt state so moving accounts to another camp cannot transfer access
tokens or operational history.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from typing import Any, Callable

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


# The file schema and authenticated additional data are versioned together so a
# future format cannot accidentally be parsed with weaker legacy assumptions.
MIGRATION_SCHEMA = 1
AAD = b"bpp-vms-auth-user-migration-v1"
SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 1
KEY_BYTES = 32
SALT_BYTES = 16
NONCE_BYTES = 12
SCRYPT_MAX_MEMORY = 128 * 1024 * 1024


def validate_migration_passphrase(passphrase: str) -> None:
    """Reject migration passwords that are too short for a portable backup.

    The value is used only to derive an AES key in process memory. It is never
    persisted in the export file, Docker environment, command line, or audit log.
    """

    # A dedicated minimum avoids treating a normal short login password as a
    # sufficient protector for a file containing reusable bcrypt password hashes.
    if len(passphrase) < 16:
        raise ValueError("Migration password must contain at least 16 characters.")
    if len(passphrase.encode("utf-8")) > 256:
        raise ValueError("Migration password must be at most 256 UTF-8 bytes.")


def _derive_key(passphrase: str, salt: bytes) -> bytes:
    """Derive one AES-256 key from a migration passphrase and random salt."""

    # scrypt resists inexpensive offline guessing if an encrypted transfer file
    # is copied; the salt guarantees two exports never reuse a derived key.
    return hashlib.scrypt(
        passphrase.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=KEY_BYTES,
        # OpenSSL's default limit is smaller than this deliberate 32 MiB KDF;
        # cap at 128 MiB so the reviewed cost remains portable across hosts.
        maxmem=SCRYPT_MAX_MEMORY,
    )


def _encode(value: bytes) -> str:
    """Encode binary envelope fields as ASCII-safe URL-base64 text."""

    return base64.urlsafe_b64encode(value).decode("ascii")


def _decode(value: Any, field: str) -> bytes:
    """Decode one required envelope field without accepting arbitrary JSON types."""

    if not isinstance(value, str):
        raise ValueError(f"Migration file field '{field}' is invalid.")
    try:
        return base64.urlsafe_b64decode(value.encode("ascii"))
    except (UnicodeEncodeError, ValueError) as error:
        raise ValueError(f"Migration file field '{field}' is invalid.") from error


def encrypt_user_records(records: list[dict[str, Any]], passphrase: str) -> str:
    """Return an authenticated encrypted JSON envelope for user records.

    ``records`` must already contain no plaintext password. The caller writes the
    returned text with exclusive creation so a pre-existing export is never lost.
    """

    validate_migration_passphrase(passphrase)
    # Canonical compact JSON ensures the encrypted payload is deterministic for
    # its inputs apart from the intentionally fresh key salt and AES nonce.
    plaintext = json.dumps(
        {"schema": MIGRATION_SCHEMA, "users": records},
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    salt = secrets.token_bytes(SALT_BYTES)
    nonce = secrets.token_bytes(NONCE_BYTES)
    ciphertext = AESGCM(_derive_key(passphrase, salt)).encrypt(nonce, plaintext, AAD)
    return json.dumps(
        {
            "schema": MIGRATION_SCHEMA,
            "kdf": "scrypt",
            "n": SCRYPT_N,
            "r": SCRYPT_R,
            "p": SCRYPT_P,
            "salt": _encode(salt),
            "nonce": _encode(nonce),
            "ciphertext": _encode(ciphertext),
        },
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )


def decrypt_user_records(envelope_text: str, passphrase: str) -> list[dict[str, Any]]:
    """Decrypt a migration file and return its untrusted user-record payload.

    Validation of usernames, roles, flags, and password-hash schemes remains the
    management command's responsibility because it owns the live auth policy.
    """

    validate_migration_passphrase(passphrase)
    try:
        envelope = json.loads(envelope_text)
    except json.JSONDecodeError as error:
        raise ValueError("Migration file is not valid JSON.") from error
    if not isinstance(envelope, dict) or envelope.get("schema") != MIGRATION_SCHEMA:
        raise ValueError("Migration file schema is not supported.")
    if (
        envelope.get("kdf") != "scrypt"
        or envelope.get("n") != SCRYPT_N
        or envelope.get("r") != SCRYPT_R
        or envelope.get("p") != SCRYPT_P
    ):
        raise ValueError("Migration file uses unsupported encryption settings.")
    salt = _decode(envelope.get("salt"), "salt")
    nonce = _decode(envelope.get("nonce"), "nonce")
    ciphertext = _decode(envelope.get("ciphertext"), "ciphertext")
    if len(salt) != SALT_BYTES or len(nonce) != NONCE_BYTES or not ciphertext:
        raise ValueError("Migration file has invalid encrypted data.")
    try:
        plaintext = AESGCM(_derive_key(passphrase, salt)).decrypt(nonce, ciphertext, AAD)
        payload = json.loads(plaintext.decode("utf-8"))
    except (InvalidTag, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        # Do not distinguish a wrong password from tampering; both are an
        # unauthenticated bundle and must fail without revealing its contents.
        raise ValueError("Migration password is incorrect or the file was modified.") from error
    if not isinstance(payload, dict) or payload.get("schema") != MIGRATION_SCHEMA:
        raise ValueError("Migration payload schema is not supported.")
    users = payload.get("users")
    if not isinstance(users, list):
        raise ValueError("Migration payload does not contain a user list.")
    return users


def validate_user_records(
    records: list[dict[str, Any]],
    validate_username: Callable[[str], str],
    identify_password_hash: Callable[[str], str | None],
) -> list[dict[str, Any]]:
    """Return normalized safe records or reject a malformed account export.

    The callback design keeps this file independent from the FastAPI module while
    applying the exact same username and bcrypt policy as the live service.
    """

    normalized_records: list[dict[str, Any]] = []
    seen_usernames: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("Migration user record is invalid.")
        username = validate_username(record.get("username", ""))
        password_hash = record.get("password_hash")
        role = record.get("role")
        active = record.get("active")
        if not isinstance(password_hash, str) or identify_password_hash(password_hash) != "bcrypt":
            raise ValueError(f"Migration password hash is invalid for user '{username}'.")
        if role not in {"admin", "user"}:
            raise ValueError(f"Migration role is invalid for user '{username}'.")
        if active not in {0, 1, False, True}:
            raise ValueError(f"Migration active flag is invalid for user '{username}'.")
        if username in seen_usernames:
            raise ValueError(f"Migration contains duplicate user '{username}'.")
        seen_usernames.add(username)
        normalized_records.append(
            {
                "username": username,
                "password_hash": password_hash,
                "role": role,
                "active": int(active),
            }
        )
    return normalized_records
