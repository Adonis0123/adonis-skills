#!/usr/bin/env python3
"""Deterministic engine for the file-tidy skill.

Subcommands:
  init      Create the Root, its Categories, and _system/ from a config.
  scan      List top-level items of one or more directories as JSON (--hash adds content hashes).
  dupes     Report byte-identical files under one or more directories (size, then SHA-256). Moves nothing.
  apply     Execute a reviewed plan (dry-run unless --apply) and write a Manifest.
  rollback  Reverse a Manifest (dry-run unless --apply).

Guarantees: never overwrites (checked per plan and again right before each move,
case- and Unicode-insensitively), never deletes ("trash" moves into the OS trash:
on Linux straight into Trash/files with a freedesktop .trashinfo so the desktop
trash can restore it, on macOS into a dated bundle in ~/.Trash; "quarantine" moves into <drive>/_quarantine/<stamp>/ on the same
Windows drive, which has no size cap unlike the Recycle Bin), verifies every move
with a tree hash (content SHA-256 across volumes; size and mtime within one volume,
where a rename does not change content), copies across volumes before removing the source, and records every item that actually moved
in the Manifest before reporting any problem with it.
"""

from __future__ import annotations

import argparse
import datetime as dt
import errno
import functools
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import unicodedata
import urllib.parse
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = SKILL_DIR / "assets" / "default-config.json"
SKIP_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
DEFAULT_FOLDERS = {name.casefold() for name in (
    "Desktop", "Downloads", "Documents", "Pictures", "Movies", "Videos",
    "Music", "Public", "Library", "Applications", "OneDrive", "AppData",
    "Saved Games", "Contacts", "Favorites", "Links", "3D Objects", "Searches")}
APP_DATA_UNDER_HOME = ("Library", "AppData")
# Top-level names on a Windows drive that belong to the OS or to installed programs.
WINDOWS_SYSTEM_NAMES = {name.casefold() for name in (
    "Windows", "Program Files", "Program Files (x86)", "ProgramData", "Users", "Recovery",
    "$Recycle.Bin", "System Volume Information", "$WinREAgent", "PerfLogs")}
QUARANTINE_DIR = "_quarantine"
# How a move is verified: "sha256" reads every byte; "stat" hashes names, types, sizes and mtimes.
VERIFY_KEYS = {"sha256": "sha256_tree", "stat": "stat_tree"}


WINDOWS_DRIVE_PATH = re.compile(r"^([A-Za-z]):(?:[\\/](.*))?$", re.S)
WINDOWS_VAR = re.compile(r"%([A-Za-z_][A-Za-z0-9_()]*)%")


class UnresolvedVariable(ValueError):
    """A config path still holds a %VAR% that could not be expanded here."""


TEMPLATE_PROFILES = {"default", "default user", "public", "all users", "defaultuser0"}


@functools.lru_cache(maxsize=1)
def _cmd_userprofile() -> str | None:
    """%USERPROFILE% as Windows reports it, asked once through WSL interop; None if unavailable."""
    try:
        out = subprocess.run(["cmd.exe", "/d", "/c", "echo %USERPROFILE%"], capture_output=True,
                             timeout=10, cwd="/mnt/c" if os.path.isdir("/mnt/c") else None)
    except (OSError, subprocess.SubprocessError):
        return None
    value = out.stdout.decode("utf-8", "replace").strip()
    return value if out.returncode == 0 and WINDOWS_DRIVE_PATH.match(value) else None


def windows_profile() -> Path | None:
    """Under WSL, the Windows user profile: the only real one, else what cmd.exe reports; else None."""
    if os.name == "nt":
        return None
    home = path_key(Path(os.path.expanduser("~")))
    others = [h for h in user_homes() if path_key(h) != home and h.name.casefold() not in TEMPLATE_PROFILES]
    if len(others) == 1:
        return others[0]
    if not others:
        return None
    reported = _cmd_userprofile()
    if not reported:
        return None
    match = WINDOWS_DRIVE_PATH.match(reported)
    return Path(f"/mnt/{match.group(1).lower()}/{(match.group(2) or '').replace(chr(92), '/')}")


@functools.lru_cache(maxsize=1)
def _detect_wsl() -> bool:
    return os.name != "nt" and ("microsoft" in platform.release().lower()
                                or bool(os.environ.get("WSL_DISTRO_NAME")))


def is_wsl() -> bool:
    """Running inside WSL; the probe is cached, tests patch this function."""
    return _detect_wsl()


def _windows_var(match: re.Match) -> str:
    name = match.group(1)
    value = os.environ.get(name)
    if value is None and name.upper() == "USERPROFILE":
        profile = windows_profile()
        value = str(profile) if profile else None
    return match.group(0) if value is None else value


def native(path: str | Path, windows_vars: bool = False) -> str:
    """Expand ~ and variables; under WSL map `E:\\x` to `/mnt/e/x` so one config serves both.

    `%VAR%` is expanded on Windows, under WSL, and for config paths (`windows_vars=True`);
    elsewhere a `%` in a file name is literal. Outside Windows the value comes from the
    environment; under WSL `%USERPROFILE%` falls back to the Windows user profile.
    A `%VAR%` that cannot be expanded is left as is.
    """
    text = str(path)
    wsl = is_wsl()
    if os.name != "nt" and (windows_vars or wsl):
        lead = WINDOWS_VAR.match(text)
        text = WINDOWS_VAR.sub(_windows_var, text)
        if lead and text.startswith("/"):  # %VAR%\x became /posix/path\x: the rest is a Windows path
            text = text.replace("\\", "/")
    text = os.path.expandvars(os.path.expanduser(text))
    match = WINDOWS_DRIVE_PATH.match(text) if os.name != "nt" and wsl else None
    if match:
        rest = (match.group(2) or "").replace("\\", "/")
        text = f"/mnt/{match.group(1).lower()}/{rest}"
    return text


def _get_long_path_name(path: str) -> str | None:
    """GetLongPathNameW for an existing path; None when it fails."""
    import ctypes
    from ctypes import wintypes
    func = ctypes.windll.kernel32.GetLongPathNameW
    func.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
    func.restype = wintypes.DWORD
    size = func(path, None, 0)
    if not size:
        return None
    buf = ctypes.create_unicode_buffer(size)
    return buf.value if func(path, buf, size) else None


def long_path(text: str, convert=None) -> str:
    """Native Windows: turn 8.3 short names (C:\\Users\\ADMINI~1) into long ones.

    The longest existing prefix is expanded with GetLongPathNameW and the missing tail
    is appended unchanged. Other systems, and paths without '~', are returned as is.
    """
    if os.name != "nt" or "~" not in text:
        return text
    convert = convert or _get_long_path_name
    head, tail = text, []
    while head:
        if os.path.exists(head):
            try:
                longer = convert(head)
            except (OSError, AttributeError):
                longer = None
            if not longer:
                return text
            return os.path.join(longer, *reversed(tail)) if tail else longer
        parent, name = os.path.split(head)
        if parent == head or not name:
            break
        tail.append(name)
        head = parent
    return text


def expand(path: str | Path, windows_vars: bool = False) -> Path:
    """Expand ~ and variables, collapse '..' and (on Windows) 8.3 short names so path checks see the real target."""
    return Path(long_path(os.path.normpath(native(path, windows_vars))))


def config_path(raw: str) -> Path:
    """expand() for a path read from the config; raises UnresolvedVariable instead of guessing."""
    path = expand(raw, windows_vars=True)
    if WINDOWS_VAR.search(str(path)):
        raise UnresolvedVariable(f"cannot expand {raw!r} here; write the full path instead")
    return path


def is_unc(raw: str) -> bool:
    """A `\\\\server\\share` path; WSL cannot reach those as files, so plans may not use them."""
    return os.name != "nt" and str(raw).startswith("\\\\")


def real_parent(path: Path) -> Path:
    """`path` with its parent's symlinks resolved but not the item itself."""
    try:
        return path.parent.resolve() / path.name
    except OSError:
        return path


def default_root() -> str:
    return os.environ.get("FILE_TIDY_ROOT", "~/Files")


def now_stamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")


def path_key(path: Path) -> str:
    """Comparison key matching case-insensitive, normalization-insensitive file systems."""
    return unicodedata.normalize("NFC", os.path.normcase(os.path.normpath(str(path)))).casefold()


def volume_root(path: Path) -> Path | None:
    """The Windows drive holding `path`: `X:\\` natively, `/mnt/x` under WSL; None elsewhere."""
    if os.name == "nt":
        return Path(path.anchor) if path.drive else None
    if not is_wsl():
        return None
    parts = path.parts
    if len(parts) >= 3 and parts[:2] == ("/", "mnt") and len(parts[2]) == 1 and parts[2].isalpha():
        return Path("/mnt", parts[2])
    return None


@functools.lru_cache(maxsize=1)
def _wsl_windows_profiles() -> tuple[Path, ...]:
    """Windows user profiles seen from WSL; scanned once per run because /mnt/c is slow."""
    users = Path("/mnt/c/Users")
    if not is_wsl() or not users.is_dir():
        return ()
    try:
        candidates = list(users.iterdir())
    except OSError:
        return ()
    profiles = []
    for candidate in candidates:  # one unreadable profile (permissions) must not hide the others
        try:
            if (candidate / "NTUSER.DAT").exists():
                profiles.append(candidate)
        except OSError:
            continue
    return tuple(profiles)


def user_homes() -> list[Path]:
    """The home folder, plus Windows user profiles when running inside WSL."""
    return [expand("~"), *_wsl_windows_profiles()]


def guard_homes() -> list[Path]:
    """user_homes() without template profiles (Default, Public...), which must stay protected."""
    home = path_key(expand("~"))
    return [h for h in user_homes() if path_key(h) == home or h.name.casefold() not in TEMPLATE_PROFILES]


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


def _walk_entries(path: Path):
    """Yield (rel, path, lstat) for path and everything below it, symlinks not followed.

    Unreadable directories raise instead of being skipped, so a partial view never verifies.
    """
    top = path.lstat()
    yield ".", path, top
    stack = [path] if stat.S_ISDIR(top.st_mode) else []
    while stack:
        current = stack.pop()
        with os.scandir(current) as entries:
            for entry in entries:
                full = Path(entry.path)
                info = entry.stat(follow_symlinks=False)
                yield full.relative_to(path).as_posix(), full, info
                if stat.S_ISDIR(info.st_mode):
                    stack.append(full)


def snapshot(path: Path, verify: str = "sha256") -> dict:
    """Tree hash of names and structure; symlinks are recorded, not followed.

    verify="sha256" hashes file contents. verify="stat" hashes each file's size and
    mtime_ns instead and reads no content: enough for a same-volume rename, which keeps
    both (checked on ext4 and on NTFS through WSL drvfs). Directory mtimes are left
    out because moving other items into a folder changes them.
    """
    entries = sorted(_walk_entries(path), key=lambda e: e[0])
    digest = hashlib.sha256()
    size = files = 0
    for rel, item, info in entries:
        if item.name in SKIP_NAMES:
            continue
        name = rel.encode()
        if stat.S_ISLNK(info.st_mode):
            digest.update(b"L\0" + name + b"\0" + os.readlink(item).encode() + b"\0")
            size += info.st_size
            files += 1
        elif stat.S_ISREG(info.st_mode):
            if verify == "stat":
                digest.update(b"F\0" + name + b"\0%d\0%d\0" % (info.st_size, info.st_mtime_ns))
            else:
                digest.update(b"F\0" + name + b"\0" + _file_sha256(item))
            size += info.st_size
            files += 1
        elif stat.S_ISDIR(info.st_mode):
            digest.update(b"D\0" + name + b"\0")
    return {"bytes": size, "files": files, VERIFY_KEYS[verify]: digest.hexdigest()}


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
    # One scandir pass; d_type answers "is it a link" without a stat call per entry.
    stack = [path]
    while stack:
        try:
            listing = list(os.scandir(stack.pop()))
        except OSError:
            continue  # same as the os.walk it replaces: an unreadable folder is skipped here
        for entry in listing:
            try:
                if entry.is_symlink():
                    target = os.readlink(entry.path)
                    if not os.path.isabs(target):
                        link = Path(entry.path)
                        if not is_within(Path(os.path.normpath(link.parent / target)), path):
                            found.append(str(link.relative_to(path)))
                elif entry.is_dir(follow_symlinks=False):
                    stack.append(Path(entry.path))
            except OSError:
                continue
    return sorted(found)


def trash_dir() -> Path:
    system = platform.system()
    if system == "Darwin":
        return Path.home() / ".Trash"
    if system == "Linux":
        data = os.environ.get("XDG_DATA_HOME", "")
        if not os.path.isabs(data):  # the spec says to ignore a relative value
            data = str(Path.home() / ".local" / "share")
        return Path(data) / "Trash" / "files"
    raise SystemExit(
        f"the trash action is not supported on {system} yet; "
        "move the item to a review folder inside the Root instead."
    )


def freedesktop_trash() -> bool:
    """Linux trash follows the freedesktop spec: files/ plus an info/<name>.trashinfo per item."""
    return platform.system() == "Linux"


def trash_name(files: Path, name: str, taken: set[str]) -> str:
    """A name free in Trash/files, Trash/info and this plan: `name`, then `stem.2.ext`, `stem.3.ext`..."""
    info = files.parent / "info"
    stem, suffix = os.path.splitext(name)
    if not stem:  # dot-file such as ".env"
        stem, suffix = name, ""
    candidate, n = name, 1
    while (path_key(files / candidate) in taken or exists(files / candidate)
           or exists(info / f"{candidate}.trashinfo")):
        n += 1
        candidate = f"{stem}.{n}{suffix}"
    return candidate


def trashinfo_path(dest: Path) -> Path:
    return dest.parent.parent / "info" / f"{dest.name}.trashinfo"


def write_trashinfo(dest: Path, original: Path) -> Path:
    """Create Trash/info/<name>.trashinfo exclusively; it also reserves the name before the move."""
    info = trashinfo_path(dest)
    info.parent.mkdir(parents=True, exist_ok=True)
    text = ("[Trash Info]\n"
            f"Path={urllib.parse.quote(os.fsencode(original), safe='/')}\n"
            f"DeletionDate={dt.datetime.now().strftime('%Y-%m-%dT%H:%M:%S')}\n")
    with info.open("x", encoding="utf-8") as handle:
        handle.write(text)
    return info


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


def on_trash_volume(src: Path) -> bool:
    """True when src shares a device with the home trash (or the nearest existing ancestor of it)."""
    target = trash_dir()
    while not target.exists() and target != target.parent:
        target = target.parent
    try:
        return src.lstat().st_dev == target.stat().st_dev
    except OSError:
        return True  # let the existence and move checks report it


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
        try:
            src.unlink()
        except OSError:
            os.unlink(dest)  # drop the extra link so nothing has moved
            raise
        return
    os.rename(src, dest)


def safe_move(src: Path, dest: Path) -> dict:
    """Move src to dest without overwriting.

    Same-volume moves are verified by metadata (verify="stat"): content is unchanged
    by a rename. Cross-volume copies are verified by content (verify="sha256").
    Raises only when nothing moved. Once the item sits at dest, returns
    {"before", "after", "verified", "source_removed", "error", "verify"} so the caller can
    record it before reacting to a problem.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    local = same_volume(src, dest.parent)
    verify = "stat" if local else "sha256"
    before = snapshot(src, verify)
    if exists(dest):
        raise FileExistsError(f"destination appeared before the move: {dest}")
    result = {"before": before, "after": before, "verified": True, "source_removed": True, "error": "",
              "verify": verify}
    if local:
        _rename_no_replace(src, dest)
    else:
        staging = dest.with_name(f".file-tidy-partial-{dest.name}")
        if exists(staging):
            raise FileExistsError(f"leftover staging path, inspect it first: {staging}")
        if src.is_dir() and not src.is_symlink():
            shutil.copytree(src, staging, symlinks=True)
        else:
            shutil.copy2(src, staging, follow_symlinks=False)
        if snapshot(staging, verify) != before:
            raise OSError(f"copy differs from the source, source kept; partial copy at {staging}")
        _rename_no_replace(staging, dest)
        try:
            _remove(src)
        except OSError as error:
            result.update(source_removed=False, error=f"copied and verified, but the source could not be removed: {error}")
    try:
        result["after"] = snapshot(dest, verify)
    except OSError as error:
        result.update(verified=False, error=f"moved, but could not re-read the destination: {error}")
        return result
    if result["after"] != before:
        result.update(verified=False, error=f"moved, but the content changed during the move: {dest}")
    return result


# ---------------------------------------------------------------- init


def capture_inbox(capture: str | None, template_root: str | None, root_arg: str,
                  categories: list[dict]) -> str | None:
    """Keep the template's capture inbox, re-based onto the chosen Root when it lived in the template's Root."""
    sep = "\\" if WINDOWS_DRIVE_PATH.match(root_arg) else "/"
    joined = lambda rel: root_arg.rstrip("/\\") + sep + rel.replace("/", sep)
    if capture:
        if template_root:
            try:
                rel = os.path.relpath(expand(capture, windows_vars=True), expand(template_root, windows_vars=True))
            except ValueError:  # different drives on Windows, or an unexpanded variable
                return capture
            if not rel.startswith(".."):
                return joined(rel)
        return capture
    inbox = next((c["id"] for c in categories if c["id"].startswith("00_")), None)
    return joined(inbox) if inbox else None


def cmd_init(args: argparse.Namespace) -> int:
    root_arg = args.root or default_root()
    root = expand(root_arg)
    config_path = root / "_system" / "config.json"
    if config_path.exists():
        config = load_json(config_path)
        source = "existing"
    else:
        config = load_json(expand(args.config) if args.config else DEFAULT_CONFIG)
        template_root = config.get("root")
        config["root"] = root_arg
        inboxes = config.setdefault("inboxes", {})
        inboxes["capture"] = capture_inbox(inboxes.get("capture"), template_root, root_arg,
                                           config.get("categories", []))
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


# ---------------------------------------------------------------- dupes


HEAD_BYTES = 1024 * 1024
# Folders dupes never looks into: Windows system bins and file-tidy's own quarantine.
DUPES_SKIP_DIRS = {name.casefold() for name in ("$Recycle.Bin", "System Volume Information", QUARANTINE_DIR)}


def _head_sha256(path: Path, limit: int = HEAD_BYTES) -> bytes:
    with path.open("rb") as handle:
        return hashlib.sha256(handle.read(limit)).digest()


def cmd_dupes(args: argparse.Namespace) -> int:
    """Group files by size, then by their first MiB, then by full SHA-256; only full matches count."""
    by_size: dict[int, list[Path]] = {}
    unreadable: list[str] = []
    seen: set[tuple[int, int]] = set()
    for raw in args.dirs:
        base = expand(raw)
        if not base.is_dir():
            raise SystemExit(f"not a directory: {base}")
        for dirpath, dirnames, filenames in os.walk(base, onerror=lambda e: unreadable.append(str(e))):
            dirnames[:] = [d for d in dirnames if d.casefold() not in DUPES_SKIP_DIRS]
            for name in filenames:
                path = Path(dirpath) / name
                if name in SKIP_NAMES or path.is_symlink():
                    continue
                try:
                    info = path.stat()
                except OSError as error:
                    unreadable.append(str(error))
                    continue
                if info.st_size < args.min_size:
                    continue
                if info.st_ino:  # hard links to one file are not duplicates
                    if (info.st_dev, info.st_ino) in seen:
                        continue
                    seen.add((info.st_dev, info.st_ino))
                by_size.setdefault(info.st_size, []).append(path)
    groups = []
    for size, paths in by_size.items():
        matches: dict[bytes, list[Path]] = {b"": paths} if len(paths) > 1 else {}
        # Files up to HEAD_BYTES are hashed whole at once; a head pass would read them twice.
        stages = (_file_sha256,) if size <= HEAD_BYTES else (_head_sha256, _file_sha256)
        for stage in stages:
            buckets: dict[bytes, list[Path]] = {}
            for group in matches.values():
                for path in group:
                    try:
                        buckets.setdefault(stage(path), []).append(path)
                    except OSError as error:
                        unreadable.append(str(error))
            matches = {key: group for key, group in buckets.items() if len(group) > 1}
        for digest, group in matches.items():
            groups.append({"bytes": size, "sha256": digest.hex(), "paths": sorted(str(p) for p in group)})
    groups.sort(key=lambda g: g["bytes"] * (len(g["paths"]) - 1), reverse=True)
    print(json.dumps({"groups": groups, "group_count": len(groups),
                      "reclaimable_bytes": sum(g["bytes"] * (len(g["paths"]) - 1) for g in groups),
                      "unreadable": unreadable}, ensure_ascii=False, indent=2))
    return 0


# ---------------------------------------------------------------- apply


def _config_paths(root: Path) -> tuple[list[Path], list[Path], list[str]]:
    """outside_root and known_folders from the config, plus a warning per path that cannot be expanded."""
    config_file = root / "_system" / "config.json"
    if not config_file.exists():
        return [], [], []
    config = load_json(config_file)
    warnings: list[str] = []

    def collect(raws) -> list[Path]:
        paths = []
        for raw in raws:
            raw = raw.split(" (", 1)[0].strip()  # allow "~/Documents (app folders ...)" notes
            if not raw:
                continue
            try:
                path = config_path(raw)
            except UnresolvedVariable as error:
                warnings.append(f"config: {error}; that folder is NOT protected in this run")
                continue
            paths += [path, real_parent(path)]
        return paths

    guarded = collect(raw for group in config.get("outside_root", {}).values() for raw in group)
    known = collect(config.get("known_folders", []))
    return guarded, known, warnings


def outside_root_paths(root: Path) -> list[Path]:
    return _config_paths(root)[0]


def _protected(src: Path, root: Path, guarded: list[Path], known: list[Path]) -> str | None:
    homes = guard_homes()
    for home in homes:
        if path_key(src) == path_key(home):
            return "it is the home directory"
        if src.name.casefold() in DEFAULT_FOLDERS and (
                path_key(src.parent) == path_key(home) or path_key(src.parent) == path_key(home / "OneDrive")):
            return "it is a Default Folder; move its contents instead"
        if any(is_within(src, home / name) for name in APP_DATA_UNDER_HOME):
            return "it is inside the system's App Data folder"
    for folder in known:
        if path_key(src) == path_key(folder):
            return "it is a Default Folder (known_folders); move its contents instead"
        if is_within(folder, src):
            return f"it contains the Default Folder {folder} (known_folders)"
    drive = volume_root(src)
    if drive is not None and is_within(src, drive / QUARANTINE_DIR):
        return "it is inside the quarantine folder; use rollback to restore it"
    if drive is not None and not any(is_within(src, home) for home in homes):
        if path_key(src) == path_key(drive):
            return "it is a whole drive"
        top = src.relative_to(drive).parts[0]
        if top.casefold() in WINDOWS_SYSTEM_NAMES:
            return f"it is inside the Windows system folder {top}"
    if is_within(root, src):
        return "it contains the Root"
    if is_within(src, root / "_system"):
        return "it is inside the Root's _system folder"
    for path in guarded:
        if is_within(src, path) or is_within(path, src):
            return f"it overlaps {path}, which the config lists under outside_root"
    return None


def protected_reason(src: Path, root: Path, guarded: list[Path], known: list[Path] | None = None) -> str | None:
    """Why src may not move, checked on the path as written and with its parent's symlinks resolved."""
    known = known or []
    reason = _protected(src, root, guarded, known)
    real = real_parent(src)
    if reason is None and real != src:
        reason = _protected(real, real_parent(root), guarded, known)
        if reason:
            reason += f" (through a symlink: {real})"
    return reason


def real_dest(path: Path) -> Path:
    """`path` with every symlink in its existing ancestors resolved; the missing tail is kept as written."""
    try:
        return path.resolve()
    except (OSError, RuntimeError):
        return path


def _dest_protected(dest: Path, root: Path, guarded: list[Path], known: list[Path],
                    quarantine_ok: bool, homes: list[Path]) -> str | None:
    for home in homes:
        if any(is_within(dest, home / name) for name in APP_DATA_UNDER_HOME):
            return "it is inside the system's App Data folder"
    drive = volume_root(dest)
    if drive is not None and not quarantine_ok and is_within(dest, drive / QUARANTINE_DIR):
        return "it is inside the quarantine folder"
    if drive is not None and not any(is_within(dest, home) for home in homes):
        if path_key(dest) == path_key(drive):
            return "it is a whole drive"
        top = dest.relative_to(drive).parts[0]
        if top.casefold() in WINDOWS_SYSTEM_NAMES:
            return f"it is inside the Windows system folder {top}"
    if is_within(dest, root / "_system"):
        return "it is inside the Root's _system folder"
    for path in guarded:
        if is_within(dest, path):
            return f"it is inside {path}, which the config lists under outside_root"
    for folder in known:
        if is_within(dest, folder) and not is_within(dest, root):
            return f"it is inside the Default Folder {folder} (known_folders)"
    return None


def dest_protected_reason(dest: Path, root: Path, guarded: list[Path], known: list[Path],
                          quarantine_ok: bool = False, homes: list[Path] | None = None) -> str | None:
    """Why nothing may be written at dest, checked as written and with its ancestors' symlinks resolved."""
    homes = guard_homes() if homes is None else homes
    reason = _dest_protected(dest, root, guarded, known, quarantine_ok, homes)
    real = real_dest(dest)
    if reason is None and path_key(real) != path_key(dest):
        reason = _dest_protected(real, real_dest(root), guarded, known, quarantine_ok, homes)
        if reason:
            reason += f" (through a symlink: {real})"
    return reason


def resolve_plan(plan: dict, stamp: str) -> tuple[Path, list[dict], list[str]]:
    root = expand(plan["root"])
    guarded, known, warnings = _config_paths(root)
    homes = guard_homes()
    resolved: list[dict] = []
    seen_dest: dict[str, int] = {}
    for index, item in enumerate(plan["items"]):
        action = item.get("action", "move")
        for field in ("src", "dest"):
            if field in item and is_unc(item[field]):
                raise SystemExit(f"item {index}: network (UNC) paths are not supported under WSL: {item[field]}")
        src = expand(item["src"])
        if action == "move":
            given = Path(native(item["dest"]))
            dest = expand(given if given.is_absolute() else root / given)
            if not given.is_absolute() and not is_within(dest, root):
                raise SystemExit(f"item {index}: relative destination escapes the Root: {item['dest']}")
        elif action == "trash":
            if volume_root(src) is not None and os.name != "nt":
                raise SystemExit(f"item {index}: trash on a Windows drive under WSL would copy it into the "
                                 f"Linux trash inside WSL; use quarantine instead: {src}")
            if freedesktop_trash():
                files = trash_dir()
                dest = files / trash_name(files, src.name, set(seen_dest))
            else:
                bundle = trash_dir() / f"file-tidy-{stamp}"
                dest = bundle / src.name
                if path_key(dest) in seen_dest:
                    dest = bundle / f"{index:03d}-{src.name}"
        elif action == "quarantine":
            drive = volume_root(src)
            if drive is None:
                raise SystemExit(f"item {index}: quarantine works only on Windows drives; use trash: {src}")
            if is_within(src, drive / QUARANTINE_DIR):
                raise SystemExit(f"item {index}: source is already in quarantine: {src}")
            dest = drive / QUARANTINE_DIR / stamp / src.relative_to(drive)
        else:
            raise SystemExit(f"item {index}: unknown action {action!r}")
        reason = dest_protected_reason(dest, root, guarded, known, quarantine_ok=action == "quarantine",
                                       homes=homes)
        if reason:
            raise SystemExit(f"item {index}: refusing to write to {dest}: {reason}")
        reason = protected_reason(src, root, guarded, known)
        if reason:
            raise SystemExit(f"item {index}: refusing to move {src}: {reason}")
        if not exists(src):
            raise SystemExit(f"item {index}: source does not exist: {src}")
        if action == "trash" and freedesktop_trash() and not on_trash_volume(src):
            raise SystemExit(f"item {index}: source is on another mount, so trash would copy it into the "
                             f"home trash; use move instead: {src}")
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
    # Look up each path's ancestors instead of comparing every pair, so large plans stay fast.
    src_at: dict[str, dict] = {}
    for item in resolved:
        src_at.setdefault(path_key(item["src"]), item)
    dest_at = {path_key(item["dest"]): item for item in resolved}

    def lineage(path: Path) -> list[str]:
        return [path_key(p) for p in (path, *path.parents)]

    for b in resolved:
        for key in lineage(b["src"]):
            a = src_at.get(key)
            if a is not None and a is not b:
                raise SystemExit(f"item {b['index']}: source is inside item {a['index']}'s source; "
                                 "move the parent once or split it, not both")
        for key in lineage(b["dest"]):
            a = src_at.get(key)
            if a is not None and a is not b:
                raise SystemExit(f"item {b['index']}: destination is inside item {a['index']}'s source")
            a = dest_at.get(key)
            if a is not None and a is not b and b["index"] < a["index"]:
                raise SystemExit(f"item {b['index']}: destination is inside item {a['index']}'s "
                                 "destination; list the enclosing item first")
    return root, resolved, warnings


def manifest_entry(item: dict, moved: dict) -> dict:
    entry = {"action": item["action"], "original": str(item["src"]), "destination": str(item["dest"]),
             "reason": item.get("reason", ""), **moved["before"], "verify": moved["verify"],
             "verified": moved["verified"],
             "moved_at": dt.datetime.now().isoformat(timespec="seconds")}
    if moved["after"] != moved["before"]:
        entry["after"] = moved["after"]
    if not moved["source_removed"]:
        entry["source_removed"] = False
    if moved["error"]:
        entry["error"] = moved["error"]
    return entry


STAMP_PLACEHOLDER = "<stamp>"


def cmd_apply(args: argparse.Namespace) -> int:
    plan_path = expand(args.plan)
    # The real stamp is taken when --apply runs; a dry-run shows a placeholder instead of a time that will differ.
    stamp = now_stamp() if args.apply else STAMP_PLACEHOLDER
    root, items, warnings = resolve_plan(load_json(plan_path), stamp)
    for warning in warnings:
        print(f"WARN {warning}")
    if not args.apply:
        for item in items:
            print(f"[{item['action']}] {item['src']} -> {item['dest']}")
        if any(STAMP_PLACEHOLDER in str(item["dest"]) for item in items):
            print(f"{STAMP_PLACEHOLDER} is replaced by the run's timestamp when --apply runs.")
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
        info = None
        try:
            if item["action"] == "trash" and freedesktop_trash():
                info = write_trashinfo(item["dest"], item["src"])
            moved = safe_move(item["src"], item["dest"])
        except Exception as error:  # nothing moved for this item
            if info is not None:
                info.unlink(missing_ok=True)
            return stop(str(error))
        entry = manifest_entry(item, moved)
        if info is not None:
            entry["trashinfo"] = str(info)
        manifest["items"].append(entry)
        write_json(manifest_path, manifest)
        if moved["error"]:
            return stop(moved["error"])
    print(json.dumps({"manifest": str(manifest_path), "moved": len(manifest["items"]),
                      "trashed": sum(1 for i in items if i["action"] == "trash"),
                      "quarantined": sum(1 for i in items if i["action"] == "quarantine")},
                     ensure_ascii=False))
    return 0


# ---------------------------------------------------------------- rollback


def entry_verify(entry: dict) -> str:
    """Manifests written before the "verify" field existed always hashed content."""
    return entry.get("verify", "sha256")


def expected_hash(entry: dict) -> dict:
    """What the moved item should look like now: the verified state, or what was found after the move."""
    keys = ("bytes", "files", VERIFY_KEYS[entry_verify(entry)])
    return entry.get("after") or {k: entry[k] for k in keys}


def matches_entry(entry: dict) -> bool:
    return snapshot(Path(entry["destination"]), entry_verify(entry)) == expected_hash(entry)


def prune_empty_quarantine(moved_from: Path) -> None:
    """Remove the empty folders a restored quarantine item leaves, up to and including _quarantine."""
    drive = volume_root(moved_from)
    if drive is None:
        return
    top = drive / QUARANTINE_DIR
    folder = moved_from.parent
    while is_within(folder, top):
        try:
            folder.rmdir()  # only succeeds when empty
        except OSError:
            return
        folder = folder.parent


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
        if id(entry) not in nested and not matches_entry(entry):
            raise SystemExit(f"content changed since the move, nothing restored: {entry['destination']}")
    if not args.apply:
        print(f"Rollback dry-run passed: {len(todo)} items restorable, {len(skipped)} missing skipped. "
              "Items holding other moved items are re-verified during --apply. Re-run with --apply.")
        return 0
    restored = 0
    for entry in reversed(todo):
        current, original = Path(entry["destination"]), Path(entry["original"])
        if not matches_entry(entry):
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
        if entry.get("action") == "quarantine":
            prune_empty_quarantine(current)
        if entry.get("trashinfo"):
            Path(entry["trashinfo"]).unlink(missing_ok=True)
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

    p = sub.add_parser("dupes", help="report byte-identical files as JSON")
    p.add_argument("dirs", nargs="+")
    p.add_argument("--min-size", type=int, default=1, help="ignore files smaller than this many bytes")
    p.set_defaults(func=cmd_dupes)

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
