"""Repair one dossier display name with a dry-run-first, privacy-safe NAS command."""

import argparse
import errno
import hashlib
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Sequence, Union
from uuid import uuid4

from services.identity_sync import (
    IdentityConflictError,
    IdentityNotFoundError,
    IdentityRollbackError,
    IdentitySyncCoordinator,
    IdentitySyncPlan,
    IdentityTransactionError,
    IdentityValidationError,
)


def _path_beneath_root(root: Path, *parts: str) -> Path:
    """Resolve ``parts`` beneath ``root`` or reject traversal/symlink escapes before file access or writes."""
    # Both source metadata and backup locations share this check so the resolved NAS root remains the sole trust boundary.
    candidate = root.joinpath(*parts).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("identity path is outside the configured root") from exc
    return candidate


def _build_parser() -> argparse.ArgumentParser:
    """Build the CLI parser whose mutually exclusive mode flags make dry-run the safe default."""
    # ArgumentParser owns consistent usage errors while no parsed namespace is ever serialized to stdout.
    parser = argparse.ArgumentParser(description="Safely repair a dossier display name")
    parser.add_argument("--dossier-id", required=True, help="stable dossier identifier")
    parser.add_argument("--correct-name", required=True, help="officer-approved display name")
    parser.add_argument("--root", default=".", help="NAS root containing Dossiers and Persons")
    parser.add_argument("--actor", default="system", help="stable operator identifier for provenance")
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument("--dry-run", action="store_true", help="plan only; this is the default")
    mode_group.add_argument("--apply", action="store_true", help="create a metadata backup and apply the correction")
    return parser


def _resolve_nas_root(root_argument: str) -> Path:
    """Return a resolved NAS root only when its required metadata directories stay inside that root."""
    # Resolving the requested root before checking children prevents an operator-supplied symlink from widening scope.
    root = Path(root_argument).resolve()
    if not root.is_dir():
        raise ValueError("identity storage root is unavailable")
    # The CLI requires both stores even if an individual plan would not modify one, preventing accidental wrong-root use.
    for required_directory in ("Dossiers", "Persons"):
        required_path = _path_beneath_root(root, required_directory)
        if not required_path.is_dir():
            raise ValueError("identity storage root is missing required metadata directories")
    return root


def _sha256(payload: bytes) -> str:
    """Return a digest for backup integrity records without decoding or disclosing metadata values."""
    # Digesting raw bytes permits future integrity checks while preserving the privacy boundary of the manifest.
    return hashlib.sha256(payload).hexdigest()


def _fsync_directory(path: Path) -> None:
    """Flush directory metadata where the host exposes a supported directory descriptor.

    ``path`` identifies a backup directory whose entries were created, replaced, renamed, or removed. The
    function returns no value and requests a durability barrier on POSIX; Windows and explicitly unsupported
    filesystems retain file-level fsync guarantees because Python exposes no portable directory flush there.
    """
    # Windows does not offer a portable directory descriptor, matching the repository config-store convention.
    if os.name == "nt":
        return
    unsupported_errors = {errno.EINVAL, errno.EROFS}
    if hasattr(errno, "ENOTSUP"):
        unsupported_errors.add(errno.ENOTSUP)
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError as exc:
        # Only an explicit platform/filesystem unsupported response may weaken the directory-level guarantee.
        if exc.errno in unsupported_errors:
            return
        raise
    try:
        try:
            os.fsync(descriptor)
        except OSError as exc:
            # Other flush failures are fatal so the CLI never advertises an incompletely durable backup.
            if exc.errno not in unsupported_errors:
                raise
    finally:
        os.close(descriptor)


def _write_bytes_durably(path: Path, payload: bytes) -> None:
    """Fsync bytes to a unique sibling and atomically publish one staged backup artifact.

    ``path`` is a previously root-constrained backup destination and ``payload`` is opaque metadata bytes. The
    function returns no value; it creates and removes a sibling temporary, replaces the destination atomically,
    verifies exact bytes, and flushes the containing directory before the caller can publish the complete backup.
    """
    # A unique same-directory temporary keeps os.replace atomic on the backup filesystem and avoids name collisions.
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
        if path.read_bytes() != payload:
            raise OSError("identity backup artifact verification failed")
    finally:
        # The unique sibling is never a recovery artifact and may be removed after success or any failed publication.
        temporary.unlink(missing_ok=True)


def _remove_backup_tree(path: Path) -> None:
    """Remove one unique staging/completed backup path without following a substituted directory symlink.

    ``path`` must already be constrained below the configured backup root. The helper returns no value and removes
    only that transaction's tree or symlink during failure cleanup; callers separately flush the parent directory.
    """
    # Unlinking symlinks directly prevents recursive cleanup from crossing the intended backup trust boundary.
    if path.is_symlink():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def _write_apply_backup(root: Path, plan: IdentitySyncPlan, actor: str) -> None:
    """Durably stage ``plan`` under ``root`` for ``actor``, then atomically publish or clean all output.

    The root-constrained plan supplies original JSON bytes and stable identifiers. The function returns no value;
    it fsyncs every payload, manifest, and supported directory before/after same-parent directory publication, and
    removes both incomplete and completed transaction names if any durability boundary fails before source apply.
    """
    # One timestamp drives both the manifest and value-free directory label; a random suffix prevents collisions.
    backup_time = datetime.now(timezone.utc)
    timestamp = backup_time.isoformat()
    backup_name = f"{backup_time.strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex}"
    backup_root = _path_beneath_root(root, "Backups", "identity-sync")
    final_directory = _path_beneath_root(backup_root, backup_name)
    staging_directory = _path_beneath_root(backup_root, f".{backup_name}.incomplete")
    backup_root.mkdir(parents=True, exist_ok=True)
    # Flush the created backup hierarchy where supported before adding a visible staging transaction entry.
    _fsync_directory(root)
    _fsync_directory(backup_root.parent)
    _fsync_directory(backup_root)
    try:
        # Creation enters the cleanup boundary before its parent flush so even the earliest barrier failure is removed.
        staging_directory.mkdir(exist_ok=False)
        _fsync_directory(backup_root)
        manifest_files = []
        for change in plan.changes:
            # Coordinator plans carry root-relative JSON paths; resolving again rejects malformed or escaped plans.
            source_path = _path_beneath_root(root, *change.path.parts)
            relative_path = source_path.relative_to(root)
            if source_path.suffix.lower() != ".json":
                raise ValueError("identity backup accepts JSON metadata only")

            # An absent original has no payload to copy; its explicit flag tells recovery to remove the created file.
            backup_path = _path_beneath_root(staging_directory, *relative_path.parts)
            digest = None
            if change.original_existed:
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                # Each opaque original is file-fsynced and atomically linked into the still-hidden staging tree.
                _write_bytes_durably(backup_path, change.original_bytes)
                digest = _sha256(change.original_bytes)
            # Stable paths, existence state, and digests are sufficient for recovery without replacement/profile values.
            manifest_files.append(
                {
                    "path": relative_path.as_posix(),
                    "original_existed": change.original_existed,
                    "sha256": digest,
                }
            )
        manifest: Dict[str, Any] = {
            "dossier_id": plan.dossier_id,
            "person_ids": list(plan.person_ids),
            "timestamp": timestamp,
            "actor": actor,
            "files": manifest_files,
        }
        # The manifest receives the same file/directory durability guarantees as every original metadata payload.
        manifest_payload = json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode("utf-8")
        manifest_path = _path_beneath_root(staging_directory, "manifest.json")
        _write_bytes_durably(manifest_path, manifest_payload)

        # Flush all nested directory entries before one same-parent rename publishes the complete recovery point.
        staged_directories = [
            candidate for candidate in staging_directory.rglob("*") if candidate.is_dir()
        ]
        for directory in sorted(staged_directories, key=lambda candidate: len(candidate.parts), reverse=True):
            _fsync_directory(directory)
        _fsync_directory(staging_directory)
        os.replace(staging_directory, final_directory)
        _fsync_directory(backup_root)
    except Exception:
        # A post-rename flush failure must withdraw the visible name as well as any earlier incomplete staging tree.
        _remove_backup_tree(staging_directory)
        _remove_backup_tree(final_directory)
        try:
            # Best-effort parent flush makes cleanup durable without replacing the original publication exception.
            _fsync_directory(backup_root)
        except OSError:
            pass
        raise


def _summary(mode: str, result: Union[IdentitySyncPlan, Dict[str, Any]]) -> Dict[str, Any]:
    """Build the exact stdout whitelist from either a read-only plan or the coordinator's sanitized apply result."""
    # Both result shapes expose only stable fields, preserving the same privacy boundary across dry-run and atomic apply.
    return {
        "mode": mode,
        "dossier_id": result.dossier_id if isinstance(result, IdentitySyncPlan) else result["dossier_id"],
        "affected_counts": result.affected_counts if isinstance(result, IdentitySyncPlan) else result["affected_counts"],
        "warnings": list(result.warnings) if isinstance(result, IdentitySyncPlan) else result["warnings"],
        "noop": result.noop if isinstance(result, IdentitySyncPlan) else result["noop"],
    }


def _error_summary() -> Dict[str, str]:
    """Return the single fixed failure envelope so exception messages cannot disclose identity or path data."""
    # Operational, validation, and transaction failures intentionally share one value-free result for CLI callers.
    return {"error": "identity_repair_failed"}


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Plan by default or back up then apply one correction, printing only the documented sanitized JSON summary."""
    # Parse first so missing or conflicting flags fail before any root, profile, or backup path is touched.
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        # The resolved root is passed to the same coordinator for planning and eventual application.
        root = _resolve_nas_root(args.root)
        coordinator = IdentitySyncCoordinator(str(root))
        updates = {"suspect_name": args.correct_name}
        if args.apply:
            def write_backup(plan: IdentitySyncPlan) -> None:
                """Persist this exact in-lock plan's original metadata bytes before its coordinator promotion."""
                # The callback performs no planning; the coordinator retains its lock through backup and promotion.
                _write_apply_backup(root, plan, args.actor)

            # Apply combines fresh plan, backup callback, and promotion in one coordinator critical section.
            result = coordinator.apply_update_with_pre_apply(
                args.dossier_id,
                updates,
                args.actor,
                pre_apply=write_backup,
            )
        else:
            # Dry-run exposes the coordinator's read-only plan and deliberately bypasses all backup writes.
            result = coordinator.plan_update(args.dossier_id, updates, args.actor)
        # Dry-run and apply both publish the exact plan summary, which contains no profile replacement payloads.
        print(json.dumps(_summary("apply" if args.apply else "dry-run", result), ensure_ascii=False, sort_keys=True))
        return 0
    except (
        IdentityValidationError,
        IdentityNotFoundError,
        IdentityConflictError,
        IdentityTransactionError,
        IdentityRollbackError,
        OSError,
        ValueError,
    ):
        # The fixed JSON error prevents typed exception text, filesystem paths, and personal arguments from reaching stdout.
        print(json.dumps(_error_summary(), ensure_ascii=False, sort_keys=True))
        return 1


# Direct execution delegates to the tested ``main`` boundary so operators receive the same dry-run-first safeguards.
if __name__ == "__main__":
    raise SystemExit(main())
