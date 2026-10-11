"""Security-sensitive management commands for auth-service.

Commands never print generated credentials or JWT signing material. Password
commands write a one-time credential file using exclusive creation and mode
0600 so operators can transfer the result without exposing it in shell history.
"""

import argparse
import os
import secrets
import sqlite3
import string
import sys
import tempfile
from pathlib import Path

import auth
import auth_migration


def generate_password(length: int = 32) -> str:
    """Return a cryptographically random password satisfying auth policy.

    The generated value includes upper-case, lower-case, numeric, and
    shell-safe symbol characters. It is returned only to the command workflow
    that hashes it and writes the requested one-time output file. Requested
    lengths must remain within bcrypt's 72-byte limit.
    """

    # This generator uses an ASCII-only alphabet, so character count equals the
    # UTF-8 byte count enforced at every bcrypt enrollment and login boundary.
    if length < 20:
        raise ValueError("Generated password length must be at least 20 characters.")
    if length > auth.BCRYPT_MAX_PASSWORD_BYTES:
        raise ValueError(
            "Generated password length must not exceed bcrypt's 72-byte limit."
        )

    # Seed one character from every class, fill from the combined alphabet, and
    # shuffle with SystemRandom so the final position of each class is unknown.
    groups = (string.ascii_lowercase, string.ascii_uppercase, string.digits, "-_")
    random_source = secrets.SystemRandom()
    characters = [secrets.choice(group) for group in groups]
    alphabet = "".join(groups)
    characters.extend(secrets.choice(alphabet) for _ in range(length - len(characters)))
    random_source.shuffle(characters)
    password = "".join(characters)
    auth.validate_password(password)
    return password


def write_one_time_credential(
    output_file: Path,
    username: str,
    password: str,
) -> None:
    """Create a mode-0600 credential file without overwriting any path.

    ``output_file`` must have an existing parent directory. The only side
    effect is an exclusively-created plaintext handoff file that the operator
    is explicitly instructed to remove after recording the credential.
    """

    output_path = output_file.expanduser().resolve()
    if not output_path.parent.is_dir():
        raise FileNotFoundError(f"Output directory does not exist: {output_path.parent}")

    # O_EXCL prevents an incorrect path from destroying an existing credential
    # or arbitrary operator file. The password is never copied to stdout.
    descriptor = os.open(
        output_path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL,
        0o600,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as credential_file:
            credential_file.write(f"username={username}\npassword={password}\n")
            credential_file.flush()
            os.fsync(credential_file.fileno())
    except Exception:
        # Remove a partial handoff file because it cannot be trusted as the
        # credential corresponding to a committed database update.
        output_path.unlink(missing_ok=True)
        raise


def _remove_output_after_failure(output_file: Path) -> None:
    """Best-effort remove a credential file when its DB transaction fails."""

    try:
        output_file.expanduser().resolve().unlink(missing_ok=True)
    except OSError:
        # Preserve the original database error; the caller still reports that
        # rotation failed and can manually remove the incomplete handoff file.
        pass


def _read_secret_lines(count: int) -> list[str]:
    """Read exactly ``count`` non-newline secrets from standard input.

    GUI installation pipes secrets to this management command instead of placing
    them in command-line arguments, Docker environment variables, or files. A
    newline is rejected because it would make the input framing ambiguous.
    """

    # Reading from the binary stream prevents terminal encoding rules from
    # silently altering the password before the shared auth validator sees it.
    values: list[str] = []
    for _ in range(count):
        line = sys.stdin.buffer.readline()
        if not line:
            raise ValueError("Required installer secret was not supplied on standard input.")
        value = line.decode("utf-8").rstrip("\r\n")
        if "\r" in value or "\n" in value:
            raise ValueError("Installer secrets cannot contain a newline.")
        values.append(value)
    return values


def _write_encrypted_export(output_file: Path, encrypted_payload: str) -> None:
    """Write a new encrypted migration bundle without replacing any file.

    The destination is created with exclusive ownership so a mistaken export path
    cannot overwrite a prior transfer bundle or unrelated operator file.
    """

    output_path = output_file.expanduser().resolve()
    if not output_path.parent.is_dir():
        raise FileNotFoundError(f"Output directory does not exist: {output_path.parent}")
    descriptor = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as export_file:
            export_file.write(encrypted_payload)
            export_file.flush()
            os.fsync(export_file.fileno())
    except Exception:
        output_path.unlink(missing_ok=True)
        raise


def export_users(output_file: Path, migration_password: str) -> None:
    """Export transferable account hashes without sessions, audit, or JWT keys.

    The encrypted file lets users keep their existing passwords on a new machine
    while ensuring no plaintext password or active session crosses the boundary.
    """

    if not Path(auth.DB_PATH).is_file():
        raise FileNotFoundError(f"Authentication database not found: {auth.DB_PATH}")
    with auth.get_conn() as conn:
        users = conn.execute(
            "SELECT username, password_hash, role, active FROM users ORDER BY username"
        ).fetchall()
    if not users:
        raise RuntimeError("Authentication database has no users to export.")
    # Convert rows before encryption so no SQLite connection or row object crosses
    # the format boundary and the exported fields remain deliberate and reviewable.
    records = [dict(user) for user in users]
    validated = auth_migration.validate_user_records(
        records,
        auth.validate_username,
        auth.pwd_context.identify,
    )
    _write_encrypted_export(
        output_file,
        auth_migration.encrypt_user_records(validated, migration_password),
    )
    print(f"Exported {len(validated)} user account(s) to {output_file.expanduser().resolve()}.")


def provision_installation(
    username: str,
    administrator_password: str,
    migration_file: Path | None = None,
    migration_password: str | None = None,
) -> None:
    """Create a GUI-selected administrator and optionally import user hashes.

    This runs only against an empty target database. The imported records and new
    administrator are committed in one immediate SQLite transaction, so failures
    cannot leave a partially migrated user list or a login without an admin.
    """

    administrator = auth.validate_username(username)
    auth.validate_password(administrator_password)
    imported_users: list[dict[str, object]] = []
    if migration_file is not None:
        if migration_password is None:
            raise ValueError("Migration password is required with a migration file.")
        source_path = migration_file.expanduser().resolve()
        if not source_path.is_file():
            raise FileNotFoundError(f"Migration file not found: {source_path}")
        # Decryption precedes DB writes so an invalid external file cannot alter
        # a fresh auth volume before its authenticity and schema are confirmed.
        imported_users = auth_migration.validate_user_records(
            auth_migration.decrypt_user_records(
                source_path.read_text(encoding="utf-8"), migration_password
            ),
            auth.validate_username,
            auth.pwd_context.identify,
        )
    if any(record["username"] == administrator for record in imported_users):
        raise ValueError(
            "The selected administrator username already exists in the migration file. "
            "Choose a distinct new administrator username."
        )

    password_hash = auth.pwd_context.hash(administrator_password)
    Path(auth.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with auth.get_conn() as conn:
        auth.ensure_schema(conn)
        conn.commit()
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone()
        if existing:
            conn.rollback()
            raise RuntimeError(
                "Installation provisioning refused because the target database already has users."
            )
        try:
            # Imported hashes retain each user's existing password, role, and
            # active state; they never pass through application logs or stdout.
            conn.executemany(
                """
                INSERT INTO users (username, password_hash, role, active)
                VALUES (:username, :password_hash, :role, :active)
                """,
                imported_users,
            )
            # The GUI-selected administrator is always active and is separate
            # from migrated identities, guaranteeing an explicit recovery owner.
            conn.execute(
                """
                INSERT INTO users (username, password_hash, role, active)
                VALUES (?, ?, 'admin', 1)
                """,
                (administrator, password_hash),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    print(
        f"Provisioned administrator '{administrator}' and imported "
        f"{len(imported_users)} existing user account(s)."
    )


def bootstrap_admin(username: str, output_file: Path) -> None:
    """Create the first active administrator with a generated password.

    The command refuses any database that already has a user. It writes the
    one-time output before committing SQLite and removes that file if commit
    fails, keeping credential handoff and account creation consistent.
    """

    normalized_username = auth.validate_username(username)
    password = generate_password()
    password_hash = auth.pwd_context.hash(password)
    Path(auth.DB_PATH).parent.mkdir(parents=True, exist_ok=True)

    with auth.get_conn() as conn:
        auth.ensure_schema(conn)
        # Commit idempotent DDL before taking the explicit write lock used to
        # serialize the first-account invariant.
        conn.commit()
        conn.execute("BEGIN IMMEDIATE")
        existing_user = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone()
        if existing_user:
            conn.rollback()
            raise RuntimeError("Bootstrap refused because the database already has users.")

        # Track ownership separately so a pre-existing output path rejected by
        # O_EXCL is never mistaken for a partial file that this command may remove.
        credential_written = False
        try:
            write_one_time_credential(output_file, normalized_username, password)
            credential_written = True
            conn.execute(
                """
                INSERT INTO users (username, password_hash, role, active)
                VALUES (?, ?, 'admin', 1)
                """,
                (normalized_username, password_hash),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            if credential_written:
                _remove_output_after_failure(output_file)
            raise

    print(
        f"Administrator '{normalized_username}' created. "
        f"One-time credential written to {output_file.resolve()}. "
        "Record it securely, then delete the file."
    )


def rotate_password(username: str, output_file: Path) -> None:
    """Replace an existing user's password with a generated strong value.

    The plaintext is written only to the exclusively-created output file. The
    database update and file creation are coordinated so a failed transaction
    does not leave a misleading credential handoff behind.
    """

    normalized_username = auth.validate_username(username)
    password = generate_password()
    password_hash = auth.pwd_context.hash(password)

    if not Path(auth.DB_PATH).is_file():
        raise FileNotFoundError(f"Authentication database not found: {auth.DB_PATH}")

    with auth.get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        user = conn.execute(
            "SELECT 1 FROM users WHERE username = ?", (normalized_username,)
        ).fetchone()
        if not user:
            conn.rollback()
            raise RuntimeError(f"User '{normalized_username}' does not exist.")

        # Only files created successfully by this command are eligible for
        # cleanup; an O_EXCL collision must leave the operator's file untouched.
        credential_written = False
        try:
            write_one_time_credential(output_file, normalized_username, password)
            credential_written = True
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE username = ?",
                (password_hash, normalized_username),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            if credential_written:
                _remove_output_after_failure(output_file)
            raise

    print(
        f"Password for '{normalized_username}' rotated. "
        f"One-time credential written to {output_file.resolve()}. "
        "Record it securely, then delete the file."
    )


def replace_default_admin(
    replacement_username: str,
    output_file: Path,
    default_username: str = "admin",
) -> None:
    """Create a replacement administrator and disable the legacy default account.

    The replacement receives a generated password through the exclusive one-time
    file. Insertion and default-account deactivation share one immediate SQLite
    transaction, so the command can neither remove the last admin nor leave two
    active accounts when credential handoff fails.
    """

    replacement = auth.validate_username(replacement_username)
    legacy = auth.validate_username(default_username)
    if replacement == legacy:
        raise ValueError("Replacement username must differ from the default account.")

    password = generate_password()
    password_hash = auth.pwd_context.hash(password)
    if not Path(auth.DB_PATH).is_file():
        raise FileNotFoundError(f"Authentication database not found: {auth.DB_PATH}")

    with auth.get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        default_account = conn.execute(
            "SELECT role, active FROM users WHERE username = ?",
            (legacy,),
        ).fetchone()
        if (
            not default_account
            or default_account["role"] != "admin"
            or int(default_account["active"]) != 1
        ):
            conn.rollback()
            raise RuntimeError(
                f"Active default administrator '{legacy}' was not found."
            )
        if conn.execute(
            "SELECT 1 FROM users WHERE username = ?",
            (replacement,),
        ).fetchone():
            conn.rollback()
            raise RuntimeError(f"User '{replacement}' already exists.")

        # Only remove a handoff file created by this invocation; O_EXCL protects
        # any pre-existing operator file from cleanup on a later DB failure.
        credential_written = False
        try:
            write_one_time_credential(output_file, replacement, password)
            credential_written = True
            conn.execute(
                """
                INSERT INTO users (username, password_hash, role, active)
                VALUES (?, ?, 'admin', 1)
                """,
                (replacement, password_hash),
            )
            conn.execute(
                "UPDATE users SET active = 0 WHERE username = ?",
                (legacy,),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            if credential_written:
                _remove_output_after_failure(output_file)
            raise

    print(
        f"Default administrator '{legacy}' disabled and replacement "
        f"'{replacement}' created. One-time credential written to "
        f"{output_file.resolve()}. Record it securely, then delete the file."
    )


def rotate_jwt_secret() -> None:
    """Atomically replace the persisted JWT key and invalidate all sessions.

    Rotation is refused when ``JWT_SECRET`` is externally injected because the
    secret manager, not this file, is then authoritative. The service must be
    restarted after a successful file replacement.
    """

    if os.environ.get("JWT_SECRET"):
        raise RuntimeError(
            "JWT_SECRET is externally managed; rotate it in the secret manager instead."
        )

    secret_path = Path(auth.SECRET_PATH).expanduser().resolve()
    secret_path.parent.mkdir(parents=True, exist_ok=True)
    generated_secret = secrets.token_urlsafe(48)
    auth._validate_jwt_secret(generated_secret)

    # A temporary file in the destination directory makes os.replace atomic on
    # the same filesystem. Fsync ensures key bytes are durable before replace.
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".jwt-secret-",
        dir=secret_path.parent,
        text=True,
    )
    temporary_path = Path(temporary_name)
    try:
        os.chmod(temporary_path, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as secret_file:
            secret_file.write(generated_secret)
            secret_file.flush()
            os.fsync(secret_file.fileno())
        os.replace(temporary_path, secret_path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise

    print(
        f"JWT signing secret rotated at {secret_path}. "
        "Restart auth-service now; all existing sessions will be invalid."
    )


def promote_superadmin(username: str) -> None:
    """Promote one existing active administrator to the approval role.

    ``username`` must already be an active administrator.  The transaction
    refuses a second distinct superadministrator so the deployment keeps the
    user-approved single-approver contract.  No credential is changed or
    printed; the role update is the only persistent side effect.
    """

    normalized_username = auth.validate_username(username)
    with auth.get_conn() as conn:
        # Serialize the uniqueness check and role update so concurrent local
        # invocations cannot provision two approvers.
        conn.execute("BEGIN IMMEDIATE")
        target = conn.execute(
            "SELECT username, role, active FROM users WHERE username = ?",
            (normalized_username,),
        ).fetchone()
        if not target or int(target["active"]) != 1:
            raise RuntimeError("The requested account does not exist or is inactive.")
        if target["role"] == auth.SUPERADMIN_ROLE:
            conn.rollback()
            return
        if target["role"] != "admin":
            raise RuntimeError("Only an active administrator can be promoted.")
        existing = conn.execute(
            "SELECT username FROM users WHERE role = 'superadmin' AND active = 1 LIMIT 1"
        ).fetchone()
        if existing:
            raise RuntimeError(
                f"Active superadministrator already exists: {existing['username']}"
            )
        conn.execute(
            "UPDATE users SET role = 'superadmin' WHERE username = ?",
            (normalized_username,),
        )
        conn.commit()

    # The confirmation includes no password or token and is suitable for an
    # operator log during the one-time role provisioning step.
    print(f"Promoted '{normalized_username}' to superadmin.")


def build_parser() -> argparse.ArgumentParser:
    """Build the explicit management CLI without accepting secret arguments."""

    parser = argparse.ArgumentParser(description="Manage BPP-VMS authentication security.")
    commands = parser.add_subparsers(dest="command", required=True)

    # Both account commands use a generated credential and an explicit output
    # path, avoiding plaintext arguments, terminal output, and accidental files.
    bootstrap_parser = commands.add_parser(
        "bootstrap-admin",
        help="Create the first administrator in an empty database.",
    )
    bootstrap_parser.add_argument("username")
    bootstrap_parser.add_argument("--output-file", type=Path, required=True)

    password_parser = commands.add_parser(
        "rotate-password",
        help="Rotate an existing user's password.",
    )
    password_parser.add_argument("username")
    password_parser.add_argument("--output-file", type=Path, required=True)

    replacement_parser = commands.add_parser(
        "replace-default-admin",
        help="Create a generated replacement and disable the active default admin.",
    )
    replacement_parser.add_argument("replacement_username")
    replacement_parser.add_argument("--output-file", type=Path, required=True)
    replacement_parser.add_argument(
        "--default-username",
        default="admin",
        help="Legacy administrator to disable (default: admin).",
    )

    export_parser = commands.add_parser(
        "export-users",
        help="Write an encrypted transferable account bundle without sessions.",
    )
    export_parser.add_argument("--output-file", type=Path, required=True)
    export_parser.add_argument(
        "--password-stdin",
        action="store_true",
        required=True,
        help="Read the migration password from one standard-input line.",
    )

    provision_parser = commands.add_parser(
        "provision-installation",
        help="Create a chosen administrator and optionally import encrypted users.",
    )
    provision_parser.add_argument("username")
    provision_parser.add_argument(
        "--migration-file",
        type=Path,
        help="Encrypted user bundle mounted read-only inside the container.",
    )
    provision_parser.add_argument(
        "--passwords-stdin",
        action="store_true",
        required=True,
        help="Read admin password, then migration password when applicable, from stdin.",
    )

    commands.add_parser(
        "rotate-jwt-secret",
        help="Atomically rotate the persisted JWT signing secret.",
    )
    # Superadmin promotion is deliberately a local management action rather
    # than a browser API capability.
    superadmin_parser = commands.add_parser(
        "promote-superadmin",
        help="Promote one existing active administrator to the model-approval role.",
    )
    superadmin_parser.add_argument("username")
    return parser


def main(argv: list[str] | None = None) -> int:
    """Dispatch a management command and return a shell-compatible status."""

    args = build_parser().parse_args(argv)
    try:
        if args.command == "bootstrap-admin":
            bootstrap_admin(args.username, args.output_file)
        elif args.command == "rotate-password":
            rotate_password(args.username, args.output_file)
        elif args.command == "replace-default-admin":
            replace_default_admin(
                args.replacement_username,
                args.output_file,
                args.default_username,
            )
        elif args.command == "export-users":
            export_users(args.output_file, _read_secret_lines(1)[0])
        elif args.command == "provision-installation":
            secrets_from_stdin = _read_secret_lines(
                2 if args.migration_file is not None else 1
            )
            provision_installation(
                args.username,
                secrets_from_stdin[0],
                args.migration_file,
                secrets_from_stdin[1] if args.migration_file is not None else None,
            )
        elif args.command == "rotate-jwt-secret":
            rotate_jwt_secret()
        elif args.command == "promote-superadmin":
            promote_superadmin(args.username)
        else:
            raise RuntimeError(f"Unsupported command: {args.command}")
    except (FileExistsError, FileNotFoundError, RuntimeError, ValueError, sqlite3.Error) as error:
        # Errors never contain generated secrets; stderr is safe for operational
        # diagnosis and a nonzero status prevents automation from proceeding.
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    # Keeping process exit behavior at the module boundary makes ``main``
    # directly testable without spawning a subprocess.
    raise SystemExit(main())
