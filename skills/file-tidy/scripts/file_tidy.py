#!/usr/bin/env python3
"""Deterministic engine for the file-tidy skill.

Subcommands:
  init      Create the Root, its Categories, and _system/ from a config.
  scan      List top-level items of one or more directories as JSON (--hash adds content hashes).
  apply     Execute a reviewed plan (dry-run unless --apply) and write a Manifest.
  rollback  Reverse a Manifest (dry-run unless --apply).

Guarantees: never overwrites (checked per plan and again right before each move,
case- and Unicode-insensitively), never deletes ("trash" moves into a dated bundle
in the OS trash), verifies every move with a content tree hash, copies across
volumes before removing the source, and records every item that actually moved
in the Manifest before reporting any problem with it.
"""

from __future__ import annotations

import argparse
import datetime as dt
import errno
import hashlib
import json
import os
import platform
import shutil
import sys
import unicodedata
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = SKILL_DIR / "assets" / "default-config.json"
SKIP_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
DEFAULT_FOLDERS = {name.casefold() for name in (
    "Desktop", "Downloads", "Documents", "Pictures", "Movies", "Videos",
    "Music", "Public", "Library", "Applications", "OneDrive", "AppData")}
APP_DATA_UNDER_HOME = ("Library", "AppData")
HASH_KEYS = ("bytes", "files", "sha256_tree")


def expand(path: str | Path) -> Path:
    """Expand ~ and variables and collapse '..' so path checks see the real target."""
    return Path(os.path.normpath(os.path.expandvars(os.path.expanduser(str(path)))))


def default_root() -> str:
    return os.environ.get("FILE_TIDY_ROOT", "~/Files")


def now_stamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")


def path_key(path: Path) -> str:
    """Comparison key matching case-insensitive, normalization-insensitive file systems."""
    return unicodedata.normalize("NFC", os.path.normcase(os.path.normpath(str(path)))).casefold()


def is_within(child: Path, parent: Path) -> bool:
    child_key, parent_key = path_key(child), path_key(parent).rstrip(os.sep)
    return child_key == parent_key or child_key.startswith(parent_key + os.sep)


def exists(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def _file_sha256(path: Path) -> bytes:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.digest()


def _raise(error: OSError) -> None:
    raise error


def snapshot(path: Path) -> dict:
    """Hash names, structure and contents; symlinks are recorded, not followed.

    Unreadable directories raise instead of being skipped, so a partial view never verifies.
    """
    children: list[tuple[str, Path]] = []
    if path.is_dir() and not path.is_symlink():
        for dirpath, dirnames, filenames in os.walk(path, onerror=_raise):
            base = Path(dirpath)
            for name in dirnames + filenames:
                full = base / name
                children.append((full.relative_to(path).as_posix(), full))
    digest = hashlib.sha256()
    size = files = 0
    for rel, item in [(".", path), *sorted(children, key=lambda e: e[0])]:
        if item.name in SKIP_NAMES:
            continue
        if item.is_symlink():
            digest.update(b"L\0" + rel.encode() + b"\0" + os.readlink(item).encode() + b"\0")
            size += item.lstat().st_size
            files += 1
        elif item.is_file():
            digest.update(b"F\0" + rel.encode() + b"\0" + _file_sha256(item))
            size += item.stat().st_size
            files += 1
        elif item.is_dir():
            digest.update(b"D\0" + rel.encode() + b"\0")
    return {"bytes": size, "files": files, "sha256_tree": digest.hexdigest()}


def escaping_links(path: Path, dest: Path | None = None) -> list[str]:
    """Relative symlinks that will point somewhere else once `path` moves to `dest`."""
    if path.is_symlink():
        target = os.readlink(path)
        if os.path.isabs(target) or dest is None:
            return [] if os.path.isabs(target) else [path.name]
        before = os.path.normpath(path.parent / target)
        after = os.path.normpath(dest.parent / target)
        return [] if path_key(Path(before)) == path_key(Path(after)) else [path.name]
    if not path.is_dir():
        return []
    found = []
    for dirpath, dirnames, filenames in os.walk(path):
        for name in dirnames + filenames:
            link = Path(dirpath) / name
            if link.is_symlink() and not os.path.isabs(os.readlink(link)):
                target = Path(os.path.normpath(link.parent / os.readlink(link)))
                if not is_within(target, path):
                    found.append(str(link.relative_to(path)))
    return found


def trash_dir() -> Path:
    system = platform.system()
    if system == "Darwin":
        return Path.home() / ".Trash"
    if system == "Linux":
        data = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
        return Path(data) / "Trash" / "files"
    raise SystemExit(
        f"the trash action is not supported on {system} yet; "
        "move the item to a review folder inside the Root instead."
    )


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict, create: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if create:
        with path.open("x", encoding="utf-8") as handle:
            handle.write(text)
        return
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def same_volume(src: Path, dest_dir: Path) -> bool:
    return src.lstat().st_dev == dest_dir.stat().st_dev


def _remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink()


def _rename_no_replace(src: Path, dest: Path) -> None:
    """Rename within one volume; plain files use link+unlink so an existing dest is never replaced."""
    if exists(dest):
        raise FileExistsError(f"destination appeared before the move: {dest}")
    if src.is_file() and not src.is_symlink():
        try:
            os.link(src, dest)
        except OSError as error:
            if error.errno == errno.EEXIST:
                raise FileExistsError(f"destination appeared before the move: {dest}") from error
            os.rename(src, dest)  # file system without hard links
            return
        src.unlink()
        return
    os.rename(src, dest)


def safe_move(src: Path, dest: Path) -> dict:
    """Move src to dest without overwriting.

    Raises only when nothing moved. Once the item sits at dest, returns
    {"before", "after", "verified", "source_removed", "error"} so the caller can
    record it before reacting to a problem.
    """
    before = snapshot(src)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if exists(dest):
        raise FileExistsError(f"destination appeared before the move: {dest}")
    result = {"before": before, "after": before, "verified": True, "source_removed": True, "error": ""}
    if same_volume(src, dest.parent):
        _rename_no_replace(src, dest)
    else:
        staging = dest.with_name(f".file-tidy-partial-{dest.name}")
        if exists(staging):
            raise FileExistsError(f"leftover staging path, inspect it first: {staging}")
        if src.is_dir() and not src.is_symlink():
            shutil.copytree(src, staging, symlinks=True)
        else:
            shutil.copy2(src, staging, follow_symlinks=False)
        if snapshot(staging) != before:
            raise OSError(f"copy differs from the source, source kept; partial copy at {staging}")
        _rename_no_replace(staging, dest)
        try:
            _remove(src)
        except OSError as error:
            result.update(source_removed=False, error=f"copied and verified, but the source could not be removed: {error}")
    try:
        result["after"] = snapshot(dest)
    except OSError as error:
        result.update(verified=False, error=f"moved, but could not re-read the destination: {error}")
        return result
    if result["after"] != before:
        result.update(verified=False, error=f"moved, but the content changed during the move: {dest}")
    return result


# ---------------------------------------------------------------- init


def cmd_init(args: argparse.Namespace) -> int:
    root_arg = args.root or default_root()
    root = expand(root_arg)
    config_path = root / "_system" / "config.json"
    if config_path.exists():
        config = load_json(config_path)
        source = "existing"
    else:
        config = load_json(expand(args.config) if args.config else DEFAULT_CONFIG)
        config["root"] = root_arg
        config.setdefault("inboxes", {})["capture"] = f"{root_arg.rstrip('/')}/00_inbox"
        source = "template"
    created: list[str] = []
    wanted = [rel for c in config.get("categories", [])
              for rel in [c["id"], *[f"{c['id']}/{child}" for child in c.get("children", [])]]]
    for rel in [*wanted, "_system/manifests", "_system/plans"]:
        if not (root / rel).exists():
            created.append(rel)
            if args.apply:
                (root / rel).mkdir(parents=True)
    if args.apply and source == "template":
        write_json(config_path, config)
    print(json.dumps({"root": str(root), "config": source, "apply": args.apply, "create": created},
                     ensure_ascii=False, indent=2))
    return 0


# ---------------------------------------------------------------- scan


def cmd_scan(args: argparse.Namespace) -> int:
    report = []
    for raw in args.dirs:
        base = expand(raw)
        if not base.is_dir():
            raise SystemExit(f"not a directory: {base}")
        entries = []
        for item in sorted(base.iterdir(), key=lambda p: p.name):
            if item.name in SKIP_NAMES or (item.name.startswith(".") and not args.all):
                continue
            is_dir = item.is_dir() and not item.is_symlink()
            entry = {
                "name": item.name,
                "kind": "symlink" if item.is_symlink() else ("dir" if is_dir else "file"),
                "ext": "" if is_dir else item.suffix.lower(),
                "modified": dt.datetime.fromtimestamp(item.lstat().st_mtime).strftime("%Y-%m-%d"),
            }
            try:
                if args.hash:
                    entry.update(snapshot(item))
                elif is_dir:
                    members = [p for p in item.rglob("*") if p.is_symlink() or p.is_file()]
                    entry.update(bytes=sum(p.lstat().st_size for p in members), files=len(members))
                else:
                    entry.update(bytes=item.lstat().st_size, files=1)
                links = escaping_links(item)
            except OSError as error:
                entry["error"] = f"could not read fully: {error}"
                links = []
            if links:
                entry["escaping_links"] = links
            entries.append(entry)
        report.append({"dir": str(base), "items": entries})
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


# ---------------------------------------------------------------- apply


def outside_root_paths(root: Path) -> list[Path]:
    config_path = root / "_system" / "config.json"
    if not config_path.exists():
        return []
    paths = []
    for group in load_json(config_path).get("outside_root", {}).values():
        for raw in group:
            raw = raw.split(" (", 1)[0].strip()  # allow "~/Documents (app folders ...)" notes
            if raw:
                paths.append(expand(raw))
    return paths


def protected_reason(src: Path, root: Path, guarded: list[Path]) -> str | None:
    home = expand("~")
    if path_key(src) == path_key(home):
        return "it is the home directory"
    if path_key(src.parent) == path_key(home) and src.name.casefold() in DEFAULT_FOLDERS:
        return "it is a Default Folder; move its contents instead"
    if any(is_within(src, home / name) for name in APP_DATA_UNDER_HOME):
        return "it is inside the system's App Data folder"
    if is_within(root, src):
        return "it contains the Root"
    if is_within(src, root / "_system"):
        return "it is inside the Root's _system folder"
    for path in guarded:
        if is_within(src, path) or is_within(path, src):
            return f"it overlaps {path}, which the config lists under outside_root"
    return None


def resolve_plan(plan: dict, stamp: str) -> tuple[Path, list[dict], list[str]]:
    root = expand(plan["root"])
    guarded = outside_root_paths(root)
    resolved: list[dict] = []
    warnings: list[str] = []
    seen_dest: dict[str, int] = {}
    for index, item in enumerate(plan["items"]):
        action = item.get("action", "move")
        src = expand(item["src"])
        if action == "move":
            given = Path(os.path.expandvars(os.path.expanduser(str(item["dest"]))))
            dest = expand(given if given.is_absolute() else root / given)
            if not given.is_absolute() and not is_within(dest, root):
                raise SystemExit(f"item {index}: relative destination escapes the Root: {item['dest']}")
            if is_within(dest, root / "_system"):
                raise SystemExit(f"item {index}: destination is inside the Root's _system folder")
        elif action == "trash":
            bundle = trash_dir() / f"file-tidy-{stamp}"
            dest = bundle / src.name
            if path_key(dest) in seen_dest:
                dest = bundle / f"{index:03d}-{src.name}"
        else:
            raise SystemExit(f"item {index}: unknown action {action!r}")
        if not exists(src):
            raise SystemExit(f"item {index}: source does not exist: {src}")
        reason = protected_reason(src, root, guarded)
        if reason:
            raise SystemExit(f"item {index}: refusing to move {src}: {reason}")
        if exists(dest):
            raise SystemExit(f"item {index}: destination already exists, refusing to overwrite: {dest}")
        key = path_key(dest)
        if key in seen_dest:
            raise SystemExit(f"item {index}: shares its destination with item {seen_dest[key]} "
                             f"(names compared ignoring case): {dest}")
        if src.is_dir() and not src.is_symlink() and is_within(dest, src):
            raise SystemExit(f"item {index}: destination is inside the source: {dest}")
        seen_dest[key] = index
        for link in escaping_links(src, dest):
            warnings.append(f"item {index}: relative link {link} will point elsewhere after the move")
        resolved.append({**item, "action": action, "src": src, "dest": dest, "index": index})
    for a in resolved:
        for b in resolved:
            if a is b:
                continue
            if is_within(b["src"], a["src"]):
                raise SystemExit(f"item {b['index']}: source is inside item {a['index']}'s source; "
                                 "move the parent once or split it, not both")
            if is_within(b["dest"], a["src"]):
                raise SystemExit(f"item {b['index']}: destination is inside item {a['index']}'s source")
            if is_within(b["dest"], a["dest"]) and b["index"] < a["index"]:
                raise SystemExit(f"item {b['index']}: destination is inside item {a['index']}'s "
                                 "destination; list the enclosing item first")
    return root, resolved, warnings


def manifest_entry(item: dict, moved: dict) -> dict:
    entry = {"action": item["action"], "original": str(item["src"]), "destination": str(item["dest"]),
             "reason": item.get("reason", ""), **moved["before"], "verified": moved["verified"],
             "moved_at": dt.datetime.now().isoformat(timespec="seconds")}
    if moved["after"] != moved["before"]:
        entry["after"] = moved["after"]
    if not moved["source_removed"]:
        entry["source_removed"] = False
    if moved["error"]:
        entry["error"] = moved["error"]
    return entry


def cmd_apply(args: argparse.Namespace) -> int:
    plan_path = expand(args.plan)
    stamp = now_stamp()
    root, items, warnings = resolve_plan(load_json(plan_path), stamp)
    for warning in warnings:
        print(f"WARN {warning}")
    if not args.apply:
        for item in items:
            print(f"[{item['action']}] {item['src']} -> {item['dest']}")
        print(f"Dry-run passed: {len(items)} items, no conflicts. Nothing moved. Re-run with --apply.")
        return 0
    manifest_path = root / "_system" / "manifests" / f"{stamp}.json"
    manifest = {"created": dt.datetime.now().isoformat(timespec="seconds"), "plan": str(plan_path),
                "root": str(root), "items": []}
    write_json(manifest_path, manifest, create=True)

    def stop(message: str) -> int:
        print(json.dumps({"error": message, "manifest": str(manifest_path), "moved": len(manifest["items"]),
                          "remaining": len(items) - len(manifest["items"])}, ensure_ascii=False))
        return 1

    for item in items:
        try:
            moved = safe_move(item["src"], item["dest"])
        except Exception as error:  # nothing moved for this item
            return stop(str(error))
        manifest["items"].append(manifest_entry(item, moved))
        write_json(manifest_path, manifest)
        if moved["error"]:
            return stop(moved["error"])
    print(json.dumps({"manifest": str(manifest_path), "moved": len(manifest["items"]),
                      "trashed": sum(1 for i in items if i["action"] == "trash")}, ensure_ascii=False))
    return 0


# ---------------------------------------------------------------- rollback


def expected_hash(entry: dict) -> dict:
    """What the moved item should look like now: the verified state, or what was found after the move."""
    return entry.get("after") or {k: entry[k] for k in HASH_KEYS}


def cmd_rollback(args: argparse.Namespace) -> int:
    manifest_path = expand(args.manifest)
    manifest = load_json(manifest_path)
    pending = [e for e in manifest["items"] if not e.get("restored_at")]
    skipped: list[str] = []
    todo: list[dict] = []
    for entry in pending:
        current, original = Path(entry["destination"]), Path(entry["original"])
        if not exists(current):
            if args.skip_missing:
                skipped.append(str(current))
                continue
            raise SystemExit(f"missing, nothing restored (use --skip-missing to restore the rest): {current}")
        if exists(original) and entry.get("source_removed", True):
            raise SystemExit(f"original path is occupied, nothing restored: {original}")
        todo.append(entry)
    nested = {id(e) for e in todo for other in todo
              if other is not e and is_within(Path(other["destination"]), Path(e["destination"]))}
    for entry in todo:
        if id(entry) not in nested and snapshot(Path(entry["destination"])) != expected_hash(entry):
            raise SystemExit(f"content changed since the move, nothing restored: {entry['destination']}")
    if not args.apply:
        print(f"Rollback dry-run passed: {len(todo)} items restorable, {len(skipped)} missing skipped. "
              "Items holding other moved items are re-verified during --apply. Re-run with --apply.")
        return 0
    restored = 0
    for entry in reversed(todo):
        current, original = Path(entry["destination"]), Path(entry["original"])
        if snapshot(current) != expected_hash(entry):
            print(f"Stopped: content changed since the move: {current}. Restored {restored} items.")
            return 1
        if not entry.get("source_removed", True):
            print(f"Stopped: {original} still holds the source of an unfinished cross-volume move; "
                  f"compare it with {current} and remove one copy by hand. Restored {restored} items.")
            return 1
        try:
            moved = safe_move(current, original)
        except Exception as error:  # nothing moved for this item
            print(f"Stopped: {error}. Restored {restored} items.")
            return 1
        entry["restored_at"] = dt.datetime.now().isoformat(timespec="seconds")
        if moved["error"]:
            entry["restore_error"] = moved["error"]
        write_json(manifest_path, manifest)
        restored += 1
        if moved["error"]:
            print(f"Stopped after restoring {current}: {moved['error']}. Restored {restored} items.")
            return 1
    print(f"Restored {restored} items." + (f" Skipped missing: {skipped}" if skipped else ""))
    return 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init", help="create Root, Categories and _system/")
    p.add_argument("--root", help="Root path (default: $FILE_TIDY_ROOT or ~/Files)")
    p.add_argument("--config", help="config template (default: assets/default-config.json)")
    p.add_argument("--apply", action="store_true")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("scan", help="list top-level items as JSON")
    p.add_argument("dirs", nargs="+")
    p.add_argument("--all", action="store_true", help="include dot-files")
    p.add_argument("--hash", action="store_true", help="add bytes/files/sha256_tree per item")
    p.set_defaults(func=cmd_scan)

    p = sub.add_parser("apply", help="execute a plan JSON")
    p.add_argument("plan")
    p.add_argument("--apply", action="store_true")
    p.set_defaults(func=cmd_apply)

    p = sub.add_parser("rollback", help="reverse a manifest")
    p.add_argument("manifest")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--skip-missing", action="store_true", help="skip items no longer present (e.g. emptied trash)")
    p.set_defaults(func=cmd_rollback)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
