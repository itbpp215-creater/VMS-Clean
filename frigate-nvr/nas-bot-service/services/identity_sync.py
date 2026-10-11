"""Plan and atomically apply privacy-safe display-name synchronization across NAS JSON stores."""

import copy
import datetime
import json
import os
import re
import threading
import unicodedata
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Union


JsonDocument = Union[Dict[str, Any], List[Dict[str, Any]]]

# These are the dossier manager's existing editable profile fields; identity transactions may update only this set.
_DOSSIER_UPDATE_FIELDS = (
    "suspect_name",
    "id_card",
    "phone_number",
    "role_tag",
    "area_tag",
    "address",
    "age",
    "category",
    "behavior",
    "notes",
)

# Every in-process dossier/profile/index writer imports this one re-entrant transaction boundary.
IDENTITY_TRANSACTION_LOCK = threading.RLock()
# Retain the original private name for compatible internal/tests imports while both names reference the same lock.
_IDENTITY_SYNC_LOCK = IDENTITY_TRANSACTION_LOCK


class IdentityNotFoundError(Exception):
    """Report a missing stable dossier target without disclosing profile values or changing files."""


class IdentityConflictError(Exception):
    """Report multiple strong Person Registry matches using stable identifiers only and without writes."""


class IdentityValidationError(Exception):
    """Report invalid input or unsafe storage state without echoing personal values in the message."""


class IdentityTransactionError(Exception):
    """Report a failed apply whose promoted files were restored and verified from original bytes."""


class IdentityRollbackError(Exception):
    """Report a failed apply whose original bytes could not be fully restored and require intervention."""


@dataclass(frozen=True)
class PlannedJsonChange:
    """Describe one validated relative replacement and retain hidden bytes/existence for exact rollback."""

    # Only the root-relative path is safe in diagnostics; personal payloads remain excluded from repr output.
    path: Path
    original_bytes: bytes = field(repr=False)
    replacement: JsonDocument = field(repr=False)
    original_existed: bool = field(default=True, repr=False)


@dataclass(frozen=True)
class IdentitySyncPlan:
    """Expose stable IDs, aggregate counts, warnings, and no-op state while hiding profile replacements."""

    # The plan summary is safe for dry-run output because it never embeds corrected names or strong identifiers.
    dossier_id: str
    person_ids: Tuple[str, ...]
    affected_counts: Dict[str, int]
    warnings: Tuple[str, ...]
    noop: bool
    changes: Tuple[PlannedJsonChange, ...] = field(repr=False)


class IdentitySyncCoordinator:
    """Coordinate recoverable name propagation inside one resolved NAS root without renaming stable artifacts."""

    def __init__(self, root_path: str):
        """Resolve and retain the NAS root; construction reads no profiles and causes no filesystem writes."""
        # Resolve once so every later candidate can be proven beneath the same canonical trust boundary.
        candidate_root = Path(root_path).resolve()
        if not candidate_root.is_dir():
            raise IdentityValidationError("identity storage root is unavailable")
        self.root_path = candidate_root

    def plan_update(self, dossier_id: str, updates: Dict[str, Any], actor: str) -> IdentitySyncPlan:
        """Validate one name correction and return a read-only plan; inputs are stable ID, update map, and actor."""
        # Planning shares the process lock so its multi-file snapshot cannot interleave with an apply operation.
        with _IDENTITY_SYNC_LOCK:
            return self._plan_update_locked(dossier_id, updates, actor)

    def apply_update(self, dossier_id: str, updates: Dict[str, Any], actor: str) -> Dict[str, Any]:
        """Plan and atomically promote one correction without a pre-apply callback, returning sanitized summary data."""
        # The compatibility wrapper delegates to the single-plan operation so all apply paths retain one lock boundary.
        return self.apply_update_with_pre_apply(dossier_id, updates, actor, pre_apply=None)

    def apply_update_with_pre_apply(
        self,
        dossier_id: str,
        updates: Dict[str, Any],
        actor: str,
        pre_apply: Optional[Callable[[IdentitySyncPlan], None]],
    ) -> Dict[str, Any]:
        """Plan once, invoke an optional backup callback, then atomically promote that exact plan under one lock."""
        # The re-entrant lock prevents a concurrent correction from invalidating callback backup bytes before promotion.
        with _IDENTITY_SYNC_LOCK:
            plan = self._plan_update_locked(dossier_id, updates, actor)
            if not plan.noop:
                if pre_apply is not None:
                    try:
                        # The callback receives this in-lock plan before any temporary file is staged or destination is replaced.
                        pre_apply(plan)
                    except Exception as exc:
                        # A failed pre-apply backup leaves all source metadata untouched and reports a value-free typed error.
                        raise IdentityTransactionError(
                            f"identity pre-apply backup failed for {plan.dossier_id}; no files promoted"
                        ) from exc
                self._apply_plan_locked(plan)

            # The planned ID is validated and trimmed; its exact whitelist keeps profile PII out of the public result.
            return {
                "dossier": {"dossier_id": plan.dossier_id},
                "dossier_id": plan.dossier_id,
                "person_ids": list(plan.person_ids),
                "affected_counts": dict(plan.affected_counts),
                "warnings": list(plan.warnings),
                "noop": plan.noop,
            }

    def _plan_update_locked(
        self,
        dossier_id: str,
        updates: Dict[str, Any],
        actor: str,
    ) -> IdentitySyncPlan:
        """Build a complete in-lock snapshot plan without writing; raises sanitized typed errors on invalid state."""
        # Stable-ID and display-value validation happens before any profile path or personal document is loaded.
        stable_dossier_id = self._validate_stable_text(dossier_id, "dossier identifier")
        corrected_name = self._validate_corrected_name(updates)
        profile_updates = self._normalize_dossier_updates(updates, corrected_name)
        correction_actor = self._validate_stable_text(actor, "correction actor")
        selected_path = self._resolve_in_root("Dossiers", stable_dossier_id, "profile.json")
        if not selected_path.is_file():
            raise IdentityNotFoundError(f"dossier not found: {stable_dossier_id}")

        # Read every candidate through constrained paths and retain bytes before constructing any replacement.
        selected_profile, selected_bytes = self._read_json_object_with_bytes(selected_path, "selected dossier")
        if selected_profile.get("dossier_id", stable_dossier_id) != stable_dossier_id:
            raise IdentityValidationError(f"dossier identifier mismatch: {stable_dossier_id}")
        dossier_profiles = self._load_dossier_profiles(selected_path, selected_profile, selected_bytes)
        person_path = self._resolve_in_root("Persons", "persons_index.json")
        people, person_bytes = self._read_optional_json_list_with_bytes(person_path, "person registry")
        cases = self._load_case_metadata()

        # Strong identity sets intentionally exclude names, preventing fuzzy-label selection during correction.
        dossier_national_ids = self._national_ids_from(selected_profile)
        dossier_phones = self._phones_from(selected_profile)
        linked_person_ids = self._stable_strings(selected_profile.get("linked_person_ids"))
        source_case_ids = self._source_case_ids_from(selected_profile)
        for _, case_document, _ in cases:
            if self._case_has_strong_suspect(case_document, dossier_national_ids, dossier_phones):
                linked_person_ids.update(self._stable_strings(case_document.get("linked_person_ids")))
                source_case_ids.update(self._case_ids_from(case_document))

        # Any registry record selected by any strong route is a candidate; multiple stable IDs are a conflict.
        matching_people = [
            person
            for person in people
            if self._person_matches(
                person,
                dossier_national_ids,
                dossier_phones,
                linked_person_ids,
                source_case_ids,
            )
        ]
        if len(matching_people) > 1:
            conflict_ids = sorted(
                str(person.get("person_id"))
                for person in matching_people
                if person.get("person_id")
            )
            raise IdentityConflictError(
                f"identity conflict for {stable_dossier_id}: {len(matching_people)} person records "
                f"({', '.join(conflict_ids)})"
            )

        # A missing registry identity is safe but explicit: the dossier and its strongly proven case data may proceed.
        matched_person = matching_people[0] if matching_people else None
        matched_person_ids = (
            (str(matched_person.get("person_id")),)
            if matched_person and matched_person.get("person_id")
            else ()
        )
        warnings: List[str] = []
        if matched_person is None:
            warnings.append("person_registry_match_not_found")

        # Plan profile, registry, and case replacements in deterministic path order for reproducible transactions.
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        planned_documents: Dict[Path, Tuple[bytes, JsonDocument, str]] = {}
        self._plan_dossier_changes(
            dossier_profiles,
            stable_dossier_id,
            corrected_name,
            profile_updates,
            correction_actor,
            now_iso,
            planned_documents,
        )
        if matched_person is not None:
            replacement_people = copy.deepcopy(people)
            person_index = people.index(matched_person)
            replacement_people[person_index]["suspect_name"] = corrected_name
            self._record_change_if_needed(
                person_path,
                person_bytes,
                replacement_people,
                "persons",
                planned_documents,
            )

        # Registry identifiers expand case proof but never broaden selection through a display-name comparison.
        identity_national_ids = set(dossier_national_ids)
        identity_phones = set(dossier_phones)
        proven_case_ids: Set[str] = set(source_case_ids)
        if matched_person is not None:
            identity_national_ids.update(self._national_ids_from(matched_person))
            identity_phones.update(self._phones_from(matched_person))
            proven_case_ids.update(self._source_case_ids_from(matched_person))
        self._plan_case_changes(
            cases,
            matched_person_ids,
            proven_case_ids,
            identity_national_ids,
            identity_phones,
            corrected_name,
            warnings,
            planned_documents,
        )

        # Rebuild the dossier index from the planned profile view so search changes in the same transaction.
        profile_view = {
            path: planned_documents.get(path, (original, profile, "dossiers"))[1]
            for path, (profile, original) in dossier_profiles.items()
        }
        index_path = self._resolve_in_root("Dossiers", "dossiers_index.json")
        index_original = index_path.read_bytes() if index_path.is_file() else b"[]"
        rebuilt_index = self._build_dossier_index(profile_view)
        self._record_change_if_needed(
            index_path,
            index_original,
            rebuilt_index,
            "indexes",
            planned_documents,
        )

        # Frozen plan entries retain only root-relative paths publicly and preserve original bytes for rollback.
        changes = tuple(
            PlannedJsonChange(
                path=self._relative_path(path),
                original_bytes=original,
                replacement=replacement,
                # Absence differs from an existing empty list and must survive a failed create transaction.
                original_existed=path.is_file(),
            )
            for path, (original, replacement, _) in sorted(
                planned_documents.items(), key=lambda item: item[0].as_posix()
            )
        )
        affected_counts = {
            "dossiers": sum(1 for _, _, category in planned_documents.values() if category == "dossiers"),
            "persons": sum(1 for _, _, category in planned_documents.values() if category == "persons"),
            "cases": sum(1 for _, _, category in planned_documents.values() if category == "cases"),
            "indexes": sum(1 for _, _, category in planned_documents.values() if category == "indexes"),
            "files": len(planned_documents),
        }
        return IdentitySyncPlan(
            dossier_id=stable_dossier_id,
            person_ids=matched_person_ids,
            affected_counts=affected_counts,
            warnings=tuple(warnings),
            noop=not changes,
            changes=changes,
        )

    def _apply_plan_locked(self, plan: IdentitySyncPlan) -> None:
        """Stage all plan payloads, promote them, verify JSON values, and byte-verify rollback after any failure."""
        # Staging every sibling before the first promotion ensures a stage failure cannot alter an original file.
        staged: List[Tuple[PlannedJsonChange, Path, Path]] = []
        try:
            for change in plan.changes:
                destination = self._resolve_relative_path(change.path)
                payload = self._encode_json(change.replacement)
                temporary = self._stage_bytes(destination, payload)
                staged.append((change, destination, temporary))
        except Exception as exc:
            # Cleanup is best effort so an unlink problem cannot replace the required typed staging error.
            self._cleanup_staged_files(staged)
            raise IdentityTransactionError(
                f"identity transaction staging failed for {plan.dossier_id}; no files promoted"
            ) from exc

        # Promotion order is deterministic from the plan; each completed path is tracked for full rollback.
        promoted: List[Tuple[PlannedJsonChange, Path]] = []
        try:
            for change, destination, temporary in staged:
                os.replace(temporary, destination)
                promoted.append((change, destination))

            # Structural readback detects truncated, malformed, or unexpectedly changed JSON after promotion.
            for change, destination in promoted:
                if self._read_json(destination, "transaction verification") != change.replacement:
                    raise OSError("promoted JSON verification mismatch")
        except Exception as exc:
            # Restore promoted originals before best-effort stage cleanup so unlink failures cannot skip rollback.
            if self._rollback_and_verify(promoted):
                raise IdentityTransactionError(
                    f"identity transaction failed for {plan.dossier_id}; rollback verified"
                ) from exc
            raise IdentityRollbackError(
                f"identity rollback failed for {plan.dossier_id}; operator intervention required"
            ) from exc
        finally:
            # Successful promotions remove their stage names; failed paths and unpromoted stages need explicit cleanup.
            self._cleanup_staged_files(staged)

    def _rollback_and_verify(self, promoted: List[Tuple[PlannedJsonChange, Path]]) -> bool:
        """Restore every promoted destination's original bytes or absence, then verify the exact prior state."""
        # Continue restoring earlier files even if one restoration fails, maximizing recovery before verification.
        restoration_failed = False
        for change, destination in reversed(promoted):
            try:
                if change.original_existed:
                    # Existing artifacts recover their captured bytes through the same atomic replacement path.
                    self._replace_bytes_atomically(destination, change.original_bytes)
                elif destination.exists():
                    # A transaction-created artifact is removed because nonexistence was its exact original state.
                    destination.unlink()
            except Exception:
                restoration_failed = True

        # Exact bytes or exact absence, not primitive return values, establish successful restoration.
        for change, destination in promoted:
            try:
                if change.original_existed and destination.read_bytes() != change.original_bytes:
                    restoration_failed = True
                elif not change.original_existed and destination.exists():
                    restoration_failed = True
            except OSError:
                # A missing destination is correct only when the captured original did not exist.
                if change.original_existed:
                    restoration_failed = True
        return not restoration_failed

    def _plan_dossier_changes(
        self,
        profiles: Dict[Path, Tuple[Dict[str, Any], bytes]],
        dossier_id: str,
        corrected_name: str,
        profile_updates: Dict[str, Any],
        actor: str,
        corrected_at: str,
        planned: Dict[Path, Tuple[bytes, JsonDocument, str]],
    ) -> None:
        """Plan selected profile fields/provenance and cached name labels without changing stable edges."""
        # Each deep copy isolates the read snapshot from replacement mutations used by dry-run and apply.
        for path, (profile, original) in profiles.items():
            replacement = copy.deepcopy(profile)
            if path == self._resolve_in_root("Dossiers", dossier_id, "profile.json"):
                # Every allowed mixed-request field belongs in this selected-profile replacement for atomic commit.
                for field_name, field_value in profile_updates.items():
                    replacement[field_name] = field_value

                # Preserve the manager's historical-phone behavior inside the same transaction as the correction.
                phone_number = profile_updates.get("phone_number")
                if phone_number and phone_number not in replacement.get("phones", []):
                    replacement.setdefault("phones", []).append(phone_number)

                # Officer correction provenance is attached only to the selected dossier, never cached link records.
                if replacement.get("suspect_name") != corrected_name:
                    replacement["suspect_name"] = corrected_name
                    replacement["name_source"] = "officer_correction"
                    replacement["name_corrected_at"] = corrected_at
                    replacement["name_corrected_by"] = actor
                elif (
                    replacement.get("name_source") != "officer_correction"
                    or not replacement.get("name_corrected_at")
                    or not replacement.get("name_corrected_by")
                ):
                    # Repair incomplete authoritative provenance, but an actor-only difference is a true repeat no-op.
                    replacement["name_source"] = "officer_correction"
                    replacement["name_corrected_at"] = corrected_at
                    replacement["name_corrected_by"] = actor

                # Match the legacy manager timestamp only when this selected profile actually changes.
                if replacement != profile:
                    replacement["updated_at"] = corrected_at

            # Cached labels are authorized only by an exact stable dossier ID, never their current name.
            links = replacement.get("linked_dossiers")
            if isinstance(links, list):
                for link in links:
                    if isinstance(link, dict) and link.get("dossier_id") == dossier_id:
                        link["suspect_name"] = corrected_name
            self._record_change_if_needed(path, original, replacement, "dossiers", planned)

    def _plan_case_changes(
        self,
        cases: List[Tuple[Path, Dict[str, Any], bytes]],
        person_ids: Tuple[str, ...],
        source_case_ids: Set[str],
        national_ids: Set[str],
        phones: Set[str],
        corrected_name: str,
        warnings: List[str],
        planned: Dict[Path, Tuple[bytes, JsonDocument, str]],
    ) -> None:
        """Plan name changes only for strongly proven cases and strongly attributable suspect objects."""
        # Case-level proof comes from stable person links, registry sources, or a suspect's exact strong identifier.
        ambiguous_without_case_id = 0
        for path, case_document, original in cases:
            case_ids = self._case_ids_from(case_document)
            linked_ids = self._stable_strings(case_document.get("linked_person_ids"))
            suspects = case_document.get("suspects")
            if not isinstance(suspects, list):
                continue
            strong_suspect_indexes = [
                index
                for index, suspect in enumerate(suspects)
                if isinstance(suspect, dict)
                and self._record_has_strong_identifier(suspect, national_ids, phones)
            ]
            case_proven = bool(
                linked_ids.intersection(person_ids)
                or case_ids.intersection(source_case_ids)
                or strong_suspect_indexes
            )
            if not case_proven:
                continue

            # A single suspect inherits unambiguous case-level proof; multi-suspect cases require exact suspect proof.
            update_indexes = strong_suspect_indexes
            if not update_indexes and len(suspects) == 1 and isinstance(suspects[0], dict):
                update_indexes = [0]
            elif not update_indexes:
                if case_ids:
                    # A present stable case ID remains actionable without disclosing any suspect or profile value.
                    warnings.append(f"case_suspect_ambiguous:{sorted(case_ids)[0]}")
                else:
                    # Missing IDs are aggregated below so user-controlled directory labels never enter public output.
                    ambiguous_without_case_id += 1
                continue

            replacement = copy.deepcopy(case_document)
            replacement_suspects = replacement["suspects"]
            for index in update_indexes:
                replacement_suspects[index]["suspect_name"] = corrected_name
            self._record_change_if_needed(path, original, replacement, "cases", planned)

        # One fixed code/count conveys the no-ID ambiguity without repeating or exposing metadata paths.
        if ambiguous_without_case_id:
            warnings.append(
                f"case_suspect_ambiguous_without_case_id:{ambiguous_without_case_id}"
            )

    def _load_dossier_profiles(
        self,
        selected_path: Path,
        selected_profile: Dict[str, Any],
        selected_bytes: bytes,
    ) -> Dict[Path, Tuple[Dict[str, Any], bytes]]:
        """Load every constrained dossier profile, reusing the selected snapshot and rejecting malformed objects."""
        # Deterministic traversal makes plan ordering stable and validates every cached-link candidate path.
        profiles: Dict[Path, Tuple[Dict[str, Any], bytes]] = {}
        dossiers_root = self._resolve_in_root("Dossiers")
        for candidate in sorted(dossiers_root.glob("*/profile.json")):
            path = self._require_in_root(candidate)
            if path == selected_path:
                profiles[path] = (selected_profile, selected_bytes)
            else:
                profile, original = self._read_json_object_with_bytes(path, "dossier profile")
                profiles[path] = (profile, original)
        return profiles

    def _load_case_metadata(self) -> List[Tuple[Path, Dict[str, Any], bytes]]:
        """Load real case metadata beneath the NAS root so planning can use durable strong links and sources."""
        # Missing Cases storage means there are no case changes; existing candidates must remain root-constrained.
        cases_root = self._resolve_in_root("Cases")
        if not cases_root.is_dir():
            return []
        cases: List[Tuple[Path, Dict[str, Any], bytes]] = []
        for candidate in sorted(cases_root.rglob("metadata.json")):
            path = self._require_in_root(candidate)
            document, original = self._read_json_object_with_bytes(path, "case metadata")
            cases.append((path, document, original))
        return cases

    def _build_dossier_index(self, profiles: Dict[Path, JsonDocument]) -> List[Dict[str, Any]]:
        """Return manager-compatible internal search summaries, including normalized exact-match phone aliases."""
        # The default Buddhist Era year mirrors the existing dossier manager for legacy profiles without a year.
        default_year = datetime.datetime.now().year + 543
        entries: List[Dict[str, Any]] = []
        for path, document in sorted(profiles.items(), key=lambda item: item[0].parent.name):
            if not isinstance(document, dict):
                raise IdentityValidationError("dossier profile must be a JSON object")
            entries.append(
                {
                    "dossier_id": document.get("dossier_id", path.parent.name),
                    "suspect_name": document.get("suspect_name"),
                    "id_card": document.get("id_card"),
                    "phone_number": document.get("phone_number"),
                    # Normalized aliases let future exact-phone ingestion reuse a corrected dossier after phone changes.
                    "phones": sorted(self._phones_from(document)),
                    "role_tag": document.get("role_tag"),
                    "area_tag": document.get("area_tag"),
                    "year": document.get("year", default_year),
                    "category": document.get("category", "general"),
                    "address": document.get("address"),
                    # Preserve correction provenance so manager lookup keeps its authoritative-name rule.
                    "name_source": document.get("name_source", "ocr"),
                    "updated_at": document.get("updated_at"),
                }
            )
        return entries

    def _record_change_if_needed(
        self,
        path: Path,
        original: bytes,
        replacement: JsonDocument,
        category: str,
        planned: Dict[Path, Tuple[bytes, JsonDocument, str]],
    ) -> None:
        """Add one replacement only when parsed original content differs, yielding zero stages for true no-ops."""
        # Parsed comparison avoids rewriting solely because an existing file uses different harmless indentation.
        try:
            original_document = json.loads(original.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise IdentityValidationError("identity JSON input is invalid") from exc
        if original_document != replacement:
            planned[path] = (original, replacement, category)

    def _person_matches(
        self,
        person: Dict[str, Any],
        national_ids: Set[str],
        phones: Set[str],
        linked_person_ids: Set[str],
        source_case_ids: Set[str],
    ) -> bool:
        """Return whether one person is selected by an exact ID, normalized phone, persisted link, or source case."""
        # Every accepted route is stable or exact; display names are intentionally absent from this predicate.
        person_id = str(person.get("person_id")) if person.get("person_id") else ""
        return bool(
            self._national_ids_from(person).intersection(national_ids)
            or self._phones_from(person).intersection(phones)
            or person_id in linked_person_ids
            or self._source_case_ids_from(person).intersection(source_case_ids)
        )

    def _case_has_strong_suspect(
        self,
        case_document: Dict[str, Any],
        national_ids: Set[str],
        phones: Set[str],
    ) -> bool:
        """Return whether any case suspect shares an exact national ID or normalized phone with the dossier."""
        # Non-list or non-object suspect values cannot establish identity proof and are ignored safely.
        suspects = case_document.get("suspects")
        if not isinstance(suspects, list):
            return False
        return any(
            isinstance(suspect, dict)
            and self._record_has_strong_identifier(suspect, national_ids, phones)
            for suspect in suspects
        )

    def _record_has_strong_identifier(
        self,
        record: Dict[str, Any],
        national_ids: Set[str],
        phones: Set[str],
    ) -> bool:
        """Return whether a JSON object intersects supplied exact national-ID or normalized-phone sets."""
        # Empty sets never authorize a match, preventing absent identifiers from equating unrelated records.
        return bool(
            self._national_ids_from(record).intersection(national_ids)
            or self._phones_from(record).intersection(phones)
        )

    def _national_ids_from(self, record: Dict[str, Any]) -> Set[str]:
        """Return valid stripped national identifiers from known singular or historical record fields."""
        # National IDs must contain at least ten characters, matching the registry's existing exact-ID threshold.
        identifiers: Set[str] = set()
        for value in [record.get("id_card"), *(record.get("id_cards") or [])]:
            if isinstance(value, str) and len(value.strip()) >= 10:
                identifiers.add(value.strip())
        return identifiers

    def _phones_from(self, record: Dict[str, Any]) -> Set[str]:
        """Return digit-normalized phones of at least nine digits from primary and historical phone fields."""
        # Normalization removes presentation punctuation only; no partial or substring comparison is permitted.
        values: List[Any] = [record.get("phone_number")]
        for field_name in ("phones", "all_phones"):
            field_value = record.get(field_name)
            if isinstance(field_value, list):
                values.extend(field_value)
        phones = {re.sub(r"\D", "", str(value)) for value in values if value is not None}
        return {phone for phone in phones if len(phone) >= 9}

    def _source_case_ids_from(self, record: Dict[str, Any]) -> Set[str]:
        """Return stable case IDs from registry sources and compatible explicit case-reference fields."""
        # Both object sources and scalar ID lists are accepted because historical records use mixed representations.
        case_ids: Set[str] = set()
        sources = record.get("sources")
        if isinstance(sources, list):
            for source in sources:
                if isinstance(source, dict) and source.get("case_id"):
                    case_ids.add(str(source["case_id"]))
        for field_name in ("source_case_ids", "case_ids"):
            case_ids.update(self._stable_strings(record.get(field_name)))
        return case_ids

    def _case_ids_from(self, case_document: Dict[str, Any]) -> Set[str]:
        """Return the stable case identifier set represented by one metadata document."""
        # Current metadata uses one case_id, while the set shape keeps intersection checks explicit.
        case_id = case_document.get("case_id")
        return {str(case_id)} if case_id else set()

    def _stable_strings(self, values: Any) -> Set[str]:
        """Return non-empty scalar strings from a list-like stable-ID field without interpreting display data."""
        # Only list entries are accepted so malformed scalar profile values cannot accidentally authorize identity.
        if not isinstance(values, list):
            return set()
        return {str(value) for value in values if value is not None and str(value)}

    def _validate_corrected_name(self, updates: Dict[str, Any]) -> str:
        """Return a trimmed non-empty name and reject control characters without echoing the supplied value."""
        # This coordinator owns identity-bearing name updates only; missing or wrong-typed input is invalid.
        if not isinstance(updates, dict) or not isinstance(updates.get("suspect_name"), str):
            raise IdentityValidationError("a corrected suspect name is required")
        corrected_name = updates["suspect_name"].strip()
        if not corrected_name or any(
            unicodedata.category(character).startswith("C") for character in corrected_name
        ):
            raise IdentityValidationError("corrected suspect name is invalid")
        return corrected_name

    def _normalize_dossier_updates(
        self,
        updates: Dict[str, Any],
        corrected_name: str,
    ) -> Dict[str, Any]:
        """Return manager-compatible allowed fields, trimming strings and using the validated corrected name."""
        # Filtering here prevents a mixed identity transaction from persisting route-external or technical fields.
        normalized = {
            field_name: field_value.strip() if isinstance(field_value, str) else field_value
            for field_name, field_value in updates.items()
            if field_name in _DOSSIER_UPDATE_FIELDS
        }
        # Name validation owns control-character and empty-value checks, so its exact normalized value wins.
        normalized["suspect_name"] = corrected_name
        return normalized

    def _validate_stable_text(self, value: Any, label: str) -> str:
        """Return trimmed non-empty stable text and reject controls; errors include only the field label."""
        # Stable path and audit components must be plain printable strings before use in files or provenance.
        if not isinstance(value, str):
            raise IdentityValidationError(f"{label} is invalid")
        cleaned = value.strip()
        if not cleaned or any(ord(character) < 32 or ord(character) == 127 for character in cleaned):
            raise IdentityValidationError(f"{label} is invalid")
        return cleaned

    def _resolve_in_root(self, *parts: str) -> Path:
        """Resolve path components and require the canonical result to remain under the configured NAS root."""
        # resolve plus relative_to rejects traversal, absolute overrides, and existing symlinks that escape the root.
        return self._require_in_root(self.root_path.joinpath(*parts))

    def _resolve_relative_path(self, relative_path: Path) -> Path:
        """Resolve one planned relative path back under the root and reject absolute or escaping plan values."""
        # Plans never authorize arbitrary absolute destinations, even if constructed outside the coordinator.
        if relative_path.is_absolute():
            raise IdentityValidationError("planned identity path is unsafe")
        return self._require_in_root(self.root_path / relative_path)

    def _require_in_root(self, candidate: Path) -> Path:
        """Return a canonical candidate only after proving it is a descendant of the configured root."""
        # Path.resolve normalizes traversal and follows existing symlinks before the containment proof.
        resolved = candidate.resolve()
        try:
            resolved.relative_to(self.root_path)
        except ValueError as exc:
            raise IdentityValidationError("identity path escapes storage root") from exc
        return resolved

    def _relative_path(self, path: Path) -> Path:
        """Return a root-relative path for public plans after repeating the canonical containment check."""
        # Revalidation prevents accidentally serializing an absolute or out-of-root path into a dry-run plan.
        return self._require_in_root(path).relative_to(self.root_path)

    def _read_optional_json_list_with_bytes(self, path: Path, label: str) -> Tuple[List[Dict[str, Any]], bytes]:
        """Read an optional JSON-object list with original bytes; a missing registry is treated as an empty list."""
        # Missing Person Registry storage is a supported warning path and must not be created during planning.
        if not path.is_file():
            return [], b"[]"
        document, original = self._read_json_with_bytes(path, label)
        if not isinstance(document, list) or not all(isinstance(item, dict) for item in document):
            raise IdentityValidationError(f"{label} must be a JSON object list")
        return document, original

    def _read_json_object_with_bytes(self, path: Path, label: str) -> Tuple[Dict[str, Any], bytes]:
        """Read a required JSON object plus exact original bytes for planning and possible rollback."""
        # Object validation occurs before any replacement is added, so malformed files fail without writes.
        document, original = self._read_json_with_bytes(path, label)
        if not isinstance(document, dict):
            raise IdentityValidationError(f"{label} must be a JSON object")
        return document, original

    def _read_json_object(self, path: Path, label: str) -> Dict[str, Any]:
        """Read and return a required JSON object without retaining its original byte encoding."""
        # Apply results use the same structural validation as planning to avoid returning malformed durable state.
        document, _ = self._read_json_object_with_bytes(path, label)
        return document

    def _read_json_with_bytes(self, path: Path, label: str) -> Tuple[JsonDocument, bytes]:
        """Decode one constrained UTF-8 JSON file and return its exact bytes without leaking content in errors."""
        # All filesystem and parser details are replaced by a stable label so exception text contains no profile PII.
        safe_path = self._require_in_root(path)
        try:
            original = safe_path.read_bytes()
            document = json.loads(original.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise IdentityValidationError(f"unable to read {label}") from exc
        return document, original

    def _read_json(self, path: Path, label: str) -> JsonDocument:
        """Return parsed JSON from one constrained path for post-promotion structural verification."""
        # Verification ignores formatting but rejects unreadable or malformed durable JSON through a sanitized error.
        document, _ = self._read_json_with_bytes(path, label)
        return document

    def _encode_json(self, document: JsonDocument) -> bytes:
        """Return deterministic UTF-8 JSON bytes for sibling staging without mutating the input document."""
        # Unicode remains readable on disk and stable indentation supports operator inspection and byte rollback tests.
        return json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8")

    def _stage_bytes(self, path: Path, payload: bytes) -> Path:
        """Flush and fsync payload bytes to a unique constrained sibling, returning its closed temporary path."""
        # The unique sibling shares the destination filesystem, which is required for atomic os.replace promotion.
        destination = self._require_in_root(path)
        temporary = self._require_in_root(
            destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
        )
        try:
            with temporary.open("xb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
        except Exception:
            if temporary.exists():
                temporary.unlink()
            raise
        return temporary

    def _replace_bytes_atomically(self, path: Path, payload: bytes) -> None:
        """Replace one in-root file through a flushed sibling temporary file, primarily for verified rollback."""
        # Rollback uses the same durable sibling-stage mechanism as forward writes before atomic promotion.
        destination = self._require_in_root(path)
        temporary = self._stage_bytes(destination, payload)
        try:
            os.replace(temporary, destination)
        finally:
            if temporary.exists():
                temporary.unlink()

    def _cleanup_staged_files(self, staged: List[Tuple[PlannedJsonChange, Path, Path]]) -> None:
        """Best-effort remove known in-root sibling stages without replacing transaction or rollback outcomes."""
        # Every deletion repeats containment validation and targets only UUID stage paths captured by this transaction.
        for _, _, temporary in staged:
            safe_temporary = self._require_in_root(temporary)
            if safe_temporary.exists():
                try:
                    safe_temporary.unlink()
                except OSError:
                    # Cleanup is secondary; callers must preserve the primary typed transaction or rollback result.
                    continue
