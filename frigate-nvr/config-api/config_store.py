"""Crash-safe, serialized persistence for config-api managed files."""

from __future__ import annotations

import errno
import json
import os
import re
import stat
import tempfile
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Iterator, MutableMapping

import ruamel.yaml


# A short bounded wait prevents an HTTP worker from hanging forever when another
# process dies or stalls while it owns the shared config transaction.
DEFAULT_LOCK_TIMEOUT_SECONDS = 5.0
# Keeping a small rolling history supports operator recovery without allowing
# routine dashboard edits to consume unbounded space on the config volume.
DEFAULT_BACKUP_RETENTION = 10
# One fixed journal is safe because every reader and writer holds the same
# interprocess lock. Keeping it beside backups also keeps recovery state on the
# same durable filesystem as the bytes needed to roll an interrupted commit back.
TRANSACTION_JOURNAL_FILENAME = ".config-transaction.json"
TRANSACTION_JOURNAL_VERSION = 1
_TRANSACTION_ID_PATTERN = re.compile(
    r"\A\d{8}T\d{6}\.\d{6}Z-[0-9a-f]{32}\Z"
)


class ConfigLockTimeout(RuntimeError):
    """Report that the interprocess config lock could not be acquired in time."""


class ConfigValidationError(ValueError):
    """Report a config payload that is syntactically valid but unsafe to persist."""


class ConfigTransactionError(RuntimeError):
    """Report a failed commit or rollback without exposing partial file contents."""


@dataclass
class ConfigTransaction:
    """Hold files loaded under one lock until the caller marks a mutation.

    ``config`` is always the current YAML mapping and ``groups`` is loaded only
    when the caller requests it. Calling :meth:`mark_changed` causes both payloads
    to be validated, backed up, and committed when the context exits normally.
    """

    config: MutableMapping
    groups: MutableMapping[str, str] | None
    changed: bool = False

    def mark_changed(self) -> None:
        """Request a commit after the caller finishes mutating in-memory data."""

        # The explicit flag lets synchronization endpoints avoid needless backup
        # churn when their calculated configuration is already current.
        self.changed = True


def new_yaml() -> ruamel.yaml.YAML:
    """Create the round-trip YAML codec used for all config reads and writes."""

    # Round-trip mode preserves operator comments and quoting while deterministic
    # indentation keeps dashboard-generated changes reviewable in Git.
    yaml = ruamel.yaml.YAML()
    yaml.preserve_quotes = True
    yaml.indent(mapping=2, sequence=4, offset=2)
    return yaml


def load_yaml_config(path: str | os.PathLike[str]) -> MutableMapping:
    """Load one YAML config mapping from ``path`` without changing the file."""

    # Reject empty or sequence-root documents here so every caller receives the
    # mapping shape expected by the camera and go2rtc mutation routines.
    yaml = new_yaml()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            config = yaml.load(handle)
    except (UnicodeError, ruamel.yaml.YAMLError) as exc:
        raise ConfigValidationError("config YAML could not be parsed") from exc
    if not isinstance(config, MutableMapping):
        raise ConfigValidationError("config root must be a mapping")
    return config


def load_groups(path: str | os.PathLike[str]) -> MutableMapping[str, str]:
    """Load camera groups, returning an empty mapping when the file is absent."""

    # Groups are optional metadata, but malformed persisted JSON must fail closed
    # during a write transaction instead of being silently overwritten.
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            groups = json.load(handle)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ConfigValidationError("groups JSON could not be parsed") from exc
    _validate_groups(groups)
    return groups


def _try_lock(handle) -> bool:
    """Attempt one non-blocking, platform-native exclusive file lock."""

    # Windows and Linux use different standard-library lock APIs; both lock the
    # first byte of the same persistent file so separate API workers serialize.
    handle.seek(0)
    if os.name == "nt":
        import msvcrt

        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            return True
        except OSError:
            return False

    import fcntl

    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except BlockingIOError:
        return False


def _unlock(handle) -> None:
    """Release a lock previously acquired by :func:`_try_lock`."""

    # Unlocking in ``finally`` guarantees another worker can continue even when a
    # handler raises validation or HTTP errors while it owns the transaction.
    handle.seek(0)
    if os.name == "nt":
        import msvcrt

        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        return

    import fcntl

    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


@contextmanager
def interprocess_lock(
    path: str | os.PathLike[str],
    timeout_seconds: float = DEFAULT_LOCK_TIMEOUT_SECONDS,
) -> Iterator[None]:
    """Hold an exclusive cross-process lock or raise after ``timeout_seconds``."""

    # The lock file remains on disk intentionally; operating-system locks, rather
    # than file existence, determine ownership and cannot be orphaned by a crash.
    lock_path = Path(path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "a+b") as handle:
        if handle.seek(0, os.SEEK_END) == 0:
            handle.write(b"\0")
            handle.flush()
        deadline = time.monotonic() + max(timeout_seconds, 0.0)
        while not _try_lock(handle):
            if time.monotonic() >= deadline:
                raise ConfigLockTimeout("timed out waiting for config lock")
            time.sleep(0.05)
        try:
            yield
        finally:
            _unlock(handle)


def _validate_groups(groups: object) -> None:
    """Require a JSON object whose camera names and group labels are strings."""

    # A narrow schema prevents unexpected nested values from being introduced into
    # the dashboard metadata file during a coordinated YAML/JSON transaction.
    if not isinstance(groups, MutableMapping):
        raise ConfigValidationError("groups root must be a mapping")
    for camera_name, group_name in groups.items():
        if not isinstance(camera_name, str) or not camera_name:
            raise ConfigValidationError("group camera names must be non-empty strings")
        if not isinstance(group_name, str):
            raise ConfigValidationError("group labels must be strings")


def validate_config(config: object) -> None:
    """Validate the config structures that config-api reads and mutates.

    This semantic check intentionally covers camera, ffmpeg, detect, go2rtc stream,
    and WebRTC shapes without claiming to replace Frigate's full runtime validator.
    """

    # These invariants catch truncated documents and malformed dashboard payloads
    # before an atomic replace can make Frigate's primary config unusable.
    if not isinstance(config, MutableMapping):
        raise ConfigValidationError("config root must be a mapping")
    cameras = config.get("cameras", {})
    if not isinstance(cameras, MutableMapping):
        raise ConfigValidationError("cameras must be a mapping")
    for camera_name, camera in cameras.items():
        if not isinstance(camera_name, str) or not camera_name:
            raise ConfigValidationError("camera names must be non-empty strings")
        if not isinstance(camera, MutableMapping):
            raise ConfigValidationError(f"camera {camera_name!r} must be a mapping")
        detect = camera.get("detect", {})
        if not isinstance(detect, MutableMapping):
            raise ConfigValidationError(f"camera {camera_name!r} detect must be a mapping")
        if "enabled" in detect and not isinstance(detect["enabled"], bool):
            raise ConfigValidationError(f"camera {camera_name!r} detect.enabled must be boolean")
        ffmpeg = camera.get("ffmpeg", {})
        if not isinstance(ffmpeg, MutableMapping):
            raise ConfigValidationError(f"camera {camera_name!r} ffmpeg must be a mapping")
        inputs = ffmpeg.get("inputs", [])
        if not isinstance(inputs, list):
            raise ConfigValidationError(f"camera {camera_name!r} ffmpeg.inputs must be a list")
        for item in inputs:
            if not isinstance(item, MutableMapping):
                raise ConfigValidationError(f"camera {camera_name!r} input must be a mapping")
            if not isinstance(item.get("path"), str) or not item["path"]:
                raise ConfigValidationError(f"camera {camera_name!r} input path is required")
            roles = item.get("roles")
            if not isinstance(roles, list) or not roles:
                raise ConfigValidationError(f"camera {camera_name!r} input roles are required")
            if any(role not in {"record", "detect", "audio"} for role in roles):
                raise ConfigValidationError(f"camera {camera_name!r} has an unsupported input role")
            if len(roles) != len(set(roles)):
                raise ConfigValidationError(f"camera {camera_name!r} input roles must be unique")

    go2rtc = config.get("go2rtc", {})
    if not isinstance(go2rtc, MutableMapping):
        raise ConfigValidationError("go2rtc must be a mapping")
    streams = go2rtc.get("streams", {})
    if not isinstance(streams, MutableMapping):
        raise ConfigValidationError("go2rtc.streams must be a mapping")
    for stream_name, sources in streams.items():
        if not isinstance(stream_name, str) or not stream_name:
            raise ConfigValidationError("stream names must be non-empty strings")
        if sources is None or (isinstance(sources, list) and len(sources) == 0):
            # Valid go2rtc push stream (null/empty source list waiting for external RTMP/RTSP push)
            continue
        source_list = sources if isinstance(sources, list) else [sources]
        if not source_list or any(not isinstance(source, str) or not source for source in source_list):
            raise ConfigValidationError(f"stream {stream_name!r} sources must be non-empty strings")
    webrtc = go2rtc.get("webrtc", {})
    if not isinstance(webrtc, MutableMapping):
        raise ConfigValidationError("go2rtc.webrtc must be a mapping")
    candidates = webrtc.get("candidates", [])
    if not isinstance(candidates, list) or any(not isinstance(item, str) for item in candidates):
        raise ConfigValidationError("go2rtc.webrtc.candidates must be a list of strings")


def _serialize_yaml(config: MutableMapping) -> bytes:
    """Serialize and reparse YAML so only a valid round-trip payload is committed."""

    # Re-reading the exact generated bytes detects serializer or representer errors
    # before the original file is backed up or replaced.
    validate_config(config)
    yaml = new_yaml()
    buffer = StringIO()
    yaml.dump(config, buffer)
    payload = buffer.getvalue().encode("utf-8")
    reparsed = new_yaml().load(payload.decode("utf-8"))
    validate_config(reparsed)
    return payload


def _serialize_groups(groups: MutableMapping[str, str]) -> bytes:
    """Serialize validated group metadata as deterministic UTF-8 JSON."""

    # A trailing newline makes manual inspection friendly while sorted keys keep
    # backups and review diffs stable across equivalent transactions.
    _validate_groups(groups)
    return (
        json.dumps(groups, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def _fsync_directory(path: Path) -> None:
    """Flush directory metadata where the platform supports directory handles."""

    # Linux needs a directory fsync to make ``os.replace`` durable across power
    # loss; Windows does not expose an equivalent portable directory descriptor.
    if os.name == "nt":
        return
    unsupported = {errno.EINVAL, errno.EROFS}
    if hasattr(errno, "ENOTSUP"):
        unsupported.add(errno.ENOTSUP)
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError as exc:
        # Some virtual bind filesystems reject directory descriptors altogether;
        # the already-fsynced staged file still provides the strongest available
        # durability guarantee on those platforms.
        if exc.errno in unsupported:
            return
        raise
    try:
        try:
            os.fsync(descriptor)
        except OSError as exc:
            # Docker Desktop bind mounts may reject directory fsync even though the
            # staged file itself was fsynced; tolerate only explicit unsupported
            # filesystem responses and keep all other durability errors fatal.
            if exc.errno not in unsupported:
                raise
    finally:
        os.close(descriptor)


def _write_temp(path: Path, payload: bytes, mode: int) -> Path:
    """Write and fsync a same-directory temporary file for atomic replacement."""

    # A same-filesystem temporary is required because ``os.replace`` is atomic only
    # when source and destination live on the same mounted config volume.
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        # ``fchmod`` is unavailable on some Windows Python builds; Linux containers
        # apply the original restrictive mode before any bytes become visible.
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        # ``fdopen`` owns and may already have closed the descriptor on write error,
        # so ignore a redundant close while preserving the original exception.
        try:
            os.close(descriptor)
        except OSError:
            pass
        temp_path.unlink(missing_ok=True)
        raise
    return temp_path


def _backup_path(backup_dir: Path, target: Path, transaction_id: str) -> Path:
    """Build a unique timestamped backup name for one transaction target."""

    # Including the original basename lets retention prune config and groups
    # independently even when both are committed by the same transaction.
    return backup_dir / f"{target.name}.{transaction_id}.bak"


def _absolute_path(path: str | os.PathLike[str]) -> Path:
    """Return a lexical absolute path suitable for journal boundary checks."""

    # ``resolve`` follows symlinks and could make a hostile journal appear to name
    # an allowed file through an unrelated link. A normalized lexical path plus
    # explicit symlink rejection for recovery files keeps the trust boundary clear.
    return Path(os.path.abspath(os.fspath(path)))


def _path_key(path: str | os.PathLike[str]) -> str:
    """Return a platform-normalized key for exact path allowlist comparisons."""

    # Windows paths are case-insensitive while Linux paths are not; ``normcase``
    # gives the comparison the same semantics as the host filesystem.
    return os.path.normcase(os.fspath(_absolute_path(path)))


def _journal_path(backup_dir: Path) -> Path:
    """Locate the single serialized transaction journal inside ``backup_dir``."""

    # A fixed filename makes startup recovery deterministic and avoids trusting a
    # glob result that could be redirected outside the protected backup directory.
    return _absolute_path(backup_dir) / TRANSACTION_JOURNAL_FILENAME


def _journal_document(
    transaction_id: str,
    state: str,
    originals: dict[Path, tuple[bytes | None, int]],
    backups: dict[Path, Path],
) -> dict[str, object]:
    """Build a recovery journal from staged originals and durable backups."""

    # Only metadata is recorded: original bytes remain in mode-0600 backup files,
    # so the journal cannot duplicate sensitive topology or credential placeholders.
    entries: list[dict[str, object]] = []
    for target, (original, mode) in originals.items():
        backup = backups.get(target)
        entries.append(
            {
                "target": os.fspath(_absolute_path(target)),
                "backup": (
                    os.fspath(_absolute_path(backup)) if backup is not None else None
                ),
                "original_existed": original is not None,
                "mode": mode,
            }
        )
    return {
        "version": TRANSACTION_JOURNAL_VERSION,
        "transaction_id": transaction_id,
        "state": state,
        "entries": entries,
    }


def _validate_journal(
    document: object,
    config_path: Path,
    groups_path: Path,
    backup_dir: Path,
) -> tuple[str, list[tuple[Path, Path | None, bool, int]]]:
    """Validate untrusted journal metadata against the two managed file paths."""

    # Recovery runs before parsing the live config, so reject every unexpected
    # shape or path rather than allowing a damaged/tampered journal to overwrite an
    # arbitrary host file.
    if not isinstance(document, dict) or set(document) != {
        "version",
        "transaction_id",
        "state",
        "entries",
    }:
        raise ConfigTransactionError("config transaction journal is invalid")
    version = document["version"]
    if (
        not isinstance(version, int)
        or isinstance(version, bool)
        or version != TRANSACTION_JOURNAL_VERSION
    ):
        raise ConfigTransactionError("config transaction journal version is unsupported")
    transaction_id = document["transaction_id"]
    if not isinstance(transaction_id, str) or not _TRANSACTION_ID_PATTERN.fullmatch(
        transaction_id
    ):
        raise ConfigTransactionError("config transaction journal id is invalid")
    state = document["state"]
    if not isinstance(state, str) or state not in {"prepared", "committed"}:
        raise ConfigTransactionError("config transaction journal state is invalid")
    raw_entries = document["entries"]
    if not isinstance(raw_entries, list) or not 1 <= len(raw_entries) <= 2:
        raise ConfigTransactionError("config transaction journal entries are invalid")

    allowed_targets = {
        _path_key(config_path): _absolute_path(config_path),
        _path_key(groups_path): _absolute_path(groups_path),
    }
    normalized_backup_dir = _absolute_path(backup_dir)
    validated: list[tuple[Path, Path | None, bool, int]] = []
    seen_targets: set[str] = set()
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, dict) or set(raw_entry) != {
            "target",
            "backup",
            "original_existed",
            "mode",
        }:
            raise ConfigTransactionError("config transaction journal entry is invalid")
        raw_target = raw_entry["target"]
        if not isinstance(raw_target, str) or not Path(raw_target).is_absolute():
            raise ConfigTransactionError("config transaction journal target is invalid")
        target_key = _path_key(raw_target)
        target = allowed_targets.get(target_key)
        if target is None or target_key in seen_targets:
            raise ConfigTransactionError("config transaction journal target is not allowed")
        seen_targets.add(target_key)

        original_existed = raw_entry["original_existed"]
        mode = raw_entry["mode"]
        if not isinstance(original_existed, bool):
            raise ConfigTransactionError("config transaction journal existence flag is invalid")
        if (
            not isinstance(mode, int)
            or isinstance(mode, bool)
            or mode < 0
            or mode & ~0o7777
        ):
            raise ConfigTransactionError("config transaction journal mode is invalid")

        raw_backup = raw_entry["backup"]
        backup: Path | None = None
        if original_existed:
            if not isinstance(raw_backup, str) or not Path(raw_backup).is_absolute():
                raise ConfigTransactionError("config transaction journal backup is invalid")
            backup = _absolute_path(raw_backup)
            expected_backup = _absolute_path(
                _backup_path(normalized_backup_dir, target, transaction_id)
            )
            if (
                _path_key(backup) != _path_key(expected_backup)
                or _path_key(backup.parent) != _path_key(normalized_backup_dir)
            ):
                raise ConfigTransactionError(
                    "config transaction journal backup is not allowed"
                )
        elif raw_backup is not None:
            raise ConfigTransactionError("config transaction journal backup is invalid")
        validated.append((target, backup, original_existed, mode))
    # Every Config API write includes YAML; a groups-only journal can only be
    # malformed or tampered and could otherwise hide a partial coordinated pair.
    if _path_key(config_path) not in seen_targets:
        raise ConfigTransactionError("config transaction journal omits config target")
    return state, validated


def _persist_journal(backup_dir: Path, document: dict[str, object]) -> None:
    """Atomically write and durably flush a private transaction journal."""

    # Replacing a same-directory mode-0600 temporary means recovery sees either the
    # prior complete marker or the new complete marker, never partial JSON.
    journal_path = _journal_path(backup_dir)
    if journal_path.is_symlink():
        raise ConfigTransactionError("config transaction journal path is unsafe")
    payload = (
        json.dumps(document, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")
    journal_temp = _write_temp(journal_path, payload, 0o600)
    try:
        os.replace(journal_temp, journal_path)
        _fsync_directory(journal_path.parent)
    finally:
        journal_temp.unlink(missing_ok=True)


def _remove_journal(backup_dir: Path) -> None:
    """Remove a completed/recovered journal and durably flush its directory."""

    # The directory fsync ensures a reboot cannot resurrect a prepared marker after
    # all original files have already been restored or the commit marked complete.
    journal_path = _journal_path(backup_dir)
    journal_path.unlink(missing_ok=True)
    _fsync_directory(journal_path.parent)


def _recover_interrupted_transaction(
    config_path: Path,
    groups_path: Path,
    backup_dir: Path,
) -> None:
    """Recover one durable prepared journal before a transaction loads any file."""

    journal_path = _journal_path(backup_dir)
    if not journal_path.exists():
        return
    try:
        # A symlink could redirect parsing/removal outside the protected backup
        # directory even when the JSON paths themselves pass validation.
        if journal_path.is_symlink() or not journal_path.is_file():
            raise ConfigTransactionError("config transaction journal path is unsafe")
        document = json.loads(journal_path.read_text(encoding="utf-8"))
        state, entries = _validate_journal(
            document, config_path, groups_path, backup_dir
        )
        if state == "committed":
            # Every replacement was durably flushed before this marker; only the
            # cleanup unlink was interrupted, so retaining the new pair is correct.
            _remove_journal(backup_dir)
            return

        # Read and validate every backup before changing either live file. This
        # prevents a missing second backup from causing a new partial rollback.
        restore_payloads: dict[Path, tuple[bytes | None, int]] = {}
        for target, backup, original_existed, mode in entries:
            if original_existed:
                if backup is None or backup.is_symlink() or not backup.is_file():
                    raise ConfigTransactionError(
                        "config transaction recovery backup is unavailable"
                    )
                restore_payloads[target] = (backup.read_bytes(), mode)
            else:
                restore_payloads[target] = (None, mode)

        # The prepared marker stays present until every original is durable, making
        # recovery itself idempotent if this process is terminated mid-rollback.
        for target, (original, mode) in restore_payloads.items():
            if original is None:
                target.unlink(missing_ok=True)
                _fsync_directory(target.parent)
                continue
            restore_temp = _write_temp(target, original, mode)
            try:
                os.replace(restore_temp, target)
                _fsync_directory(target.parent)
            finally:
                restore_temp.unlink(missing_ok=True)
        _remove_journal(backup_dir)

        # Failed-transaction backups are no longer needed. Cleanup happens after
        # journal removal so a crash can never strand a marker without its source.
        for _, backup, original_existed, _ in entries:
            if original_existed and backup is not None:
                try:
                    backup.unlink(missing_ok=True)
                except OSError:
                    pass
    except ConfigTransactionError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ConfigTransactionError(
            "interrupted config transaction could not be recovered"
        ) from exc


def _journal_marks_completed_commit(
    config_path: Path,
    groups_path: Path,
    backup_dir: Path,
) -> bool:
    """Return whether the visible, validated journal marks a complete commit."""

    # This check is used only after every target was replaced but persisting the
    # commit marker raised. If atomic replacement made the marker visible before a
    # directory-fsync error, rolling files back under a ``committed`` marker would
    # make a second process preserve a crash-partial rollback.
    journal_path = _journal_path(backup_dir)
    try:
        if journal_path.is_symlink() or not journal_path.is_file():
            return False
        document = json.loads(journal_path.read_text(encoding="utf-8"))
        state, _ = _validate_journal(
            document, config_path, groups_path, backup_dir
        )
        return state == "committed"
    except (ConfigTransactionError, OSError, UnicodeError, json.JSONDecodeError):
        return False


def _prune_backups(backup_dir: Path, target: Path, retention: int) -> None:
    """Keep only the newest ``retention`` successful backups for ``target``."""

    # Lexicographically sortable UTC timestamps make pruning deterministic without
    # relying on filesystem timestamp precision or host timezone configuration.
    backups = sorted(backup_dir.glob(f"{target.name}.*.bak"), reverse=True)
    for obsolete in backups[max(retention, 0) :]:
        obsolete.unlink(missing_ok=True)


def _commit_files(
    payloads: dict[Path, bytes],
    backup_dir: Path,
    retention: int,
    config_path: Path,
    groups_path: Path,
) -> None:
    """Commit coordinated files with durable crash recovery and rollback."""

    # Normalize and constrain targets before creating any artifact. Although this
    # helper is internal, keeping the same allowlist as recovery prevents a future
    # caller from turning the journal into a generic arbitrary-file writer.
    allowed_target_keys = {_path_key(config_path), _path_key(groups_path)}
    normalized_payloads: dict[Path, bytes] = {}
    for target, payload in payloads.items():
        normalized_target = _absolute_path(target)
        target_key = _path_key(normalized_target)
        if target_key not in allowed_target_keys or normalized_target in normalized_payloads:
            raise ConfigTransactionError("config transaction target is not allowed")
        normalized_payloads[normalized_target] = payload
    if not normalized_payloads:
        raise ConfigTransactionError("config transaction has no managed targets")

    # Capture originals before staging so a later groups replacement failure can
    # restore the already-replaced YAML rather than leave a cross-file half commit.
    originals: dict[Path, tuple[bytes | None, int]] = {}
    staged: dict[Path, Path] = {}
    backups: dict[Path, Path] = {}
    replaced: list[Path] = []
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    transaction_id = f"{timestamp}-{uuid.uuid4().hex}"
    backup_dir = _absolute_path(backup_dir)
    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Recovery copies can contain complete stream topology and must never inherit
    # a world-readable umask on Linux. Windows deployments use the audited ACL
    # hardening script because POSIX mode bits are not authoritative on NTFS.
    if os.name != "nt":
        backup_dir.chmod(0o700)
    try:
        for target, payload in normalized_payloads.items():
            if target.exists():
                original = target.read_bytes()
                mode = stat.S_IMODE(target.stat().st_mode)
            else:
                original = None
                mode = 0o600
            originals[target] = (original, mode)
            staged[target] = _write_temp(target, payload, mode)
            if original is not None:
                backup = _backup_path(backup_dir, target, transaction_id)
                backup_temp = _write_temp(backup, original, 0o600)
                try:
                    os.replace(backup_temp, backup)
                    # Track the backup before directory fsync so failure cleanup can
                    # still remove this transaction's newly visible recovery file.
                    backups[target] = backup
                    _fsync_directory(backup_dir)
                finally:
                    backup_temp.unlink(missing_ok=True)

        # The prepared marker and all backups are durable before the first live
        # replacement. A process death at any following instruction can therefore
        # be repaired by the next lock owner without guessing which file changed.
        if _journal_path(backup_dir).exists():
            raise ConfigTransactionError("an unresolved config transaction journal exists")
        prepared_journal = _journal_document(
            transaction_id, "prepared", originals, backups
        )
        _validate_journal(prepared_journal, config_path, groups_path, backup_dir)
        _persist_journal(backup_dir, prepared_journal)

        for target, temp_path in staged.items():
            os.replace(temp_path, target)
            replaced.append(target)
            _fsync_directory(target.parent)

        # Mark the pair committed only after every destination directory is flushed.
        # If termination happens before this marker, recovery intentionally restores
        # the old pair even when both replacements happened to complete.
        committed_journal = dict(prepared_journal)
        committed_journal["state"] = "committed"
        _persist_journal(backup_dir, committed_journal)
    except Exception as exc:
        commit_marker_visible = (
            len(replaced) == len(normalized_payloads)
            and _journal_marks_completed_commit(
                config_path, groups_path, backup_dir
            )
        )
        if not commit_marker_visible:
            rollback_errors: list[str] = []
            for target in reversed(replaced):
                original, mode = originals[target]
                restore_temp: Path | None = None
                try:
                    if original is None:
                        target.unlink(missing_ok=True)
                        _fsync_directory(target.parent)
                    else:
                        restore_temp = _write_temp(target, original, mode)
                        os.replace(restore_temp, target)
                        _fsync_directory(target.parent)
                except Exception as rollback_exc:
                    rollback_errors.append(f"{target.name}: {rollback_exc}")
                finally:
                    if restore_temp is not None:
                        restore_temp.unlink(missing_ok=True)

            # Keep a prepared journal until every rollback is durable. If journal
            # cleanup itself fails, the next lock owner safely repeats restoration.
            if not rollback_errors:
                try:
                    _remove_journal(backup_dir)
                except OSError as rollback_exc:
                    rollback_errors.append(f"journal: {rollback_exc}")
            # A successful rollback makes transaction-local backups redundant;
            # removing them prevents injected failures from bypassing retention.
            if not rollback_errors:
                try:
                    for backup in backups.values():
                        backup.unlink(missing_ok=True)
                except OSError as rollback_exc:
                    rollback_errors.append(f"backup cleanup: {rollback_exc}")
            detail = "config transaction failed and was rolled back"
            if rollback_errors:
                detail += "; rollback incomplete for " + ", ".join(rollback_errors)
            raise ConfigTransactionError(detail) from exc
        # All targets and a valid committed marker are visible. Treat an error from
        # the marker directory fsync as committed so no process can observe a
        # ``committed`` journal while this process rolls only part of the pair back.
    finally:
        for temp_path in staged.values():
            temp_path.unlink(missing_ok=True)

    # Once the committed marker is durable, cleanup failure must not report a false
    # rollback to the caller. A later transaction will validate and remove it.
    try:
        _remove_journal(backup_dir)
    except OSError:
        pass

    # Retention runs only after a durable commit, ensuring a failed transaction
    # never deletes the recovery points that existed before it began.
    for target in normalized_payloads:
        try:
            _prune_backups(backup_dir, target, retention)
        except OSError:
            # Retention cleanup is maintenance after a completed durable commit;
            # surfacing it as transaction failure would falsely imply a rollback.
            pass


@contextmanager
def config_transaction(
    config_path: str | os.PathLike[str],
    groups_path: str | os.PathLike[str],
    lock_path: str | os.PathLike[str],
    backup_dir: str | os.PathLike[str],
    *,
    include_groups: bool = False,
    lock_timeout_seconds: float = DEFAULT_LOCK_TIMEOUT_SECONDS,
    backup_retention: int = DEFAULT_BACKUP_RETENTION,
) -> Iterator[ConfigTransaction]:
    """Load, mutate, validate, and durably commit config files under one lock."""

    # Holding the lock across both read and replace prevents lost updates between
    # multiple Uvicorn workers or other processes using this transaction helper.
    with interprocess_lock(lock_path, lock_timeout_seconds):
        # Recovery must finish under the same lock and before either file is loaded;
        # otherwise a handler could calculate its mutation from a crash-partial pair.
        _recover_interrupted_transaction(
            Path(config_path), Path(groups_path), Path(backup_dir)
        )
        config = load_yaml_config(config_path)
        groups = load_groups(groups_path) if include_groups else None
        transaction = ConfigTransaction(config=config, groups=groups)
        yield transaction
        if not transaction.changed:
            return
        payloads = {Path(config_path): _serialize_yaml(transaction.config)}
        if include_groups and transaction.groups is not None:
            payloads[Path(groups_path)] = _serialize_groups(transaction.groups)
        _commit_files(
            payloads,
            Path(backup_dir),
            backup_retention,
            Path(config_path),
            Path(groups_path),
        )
