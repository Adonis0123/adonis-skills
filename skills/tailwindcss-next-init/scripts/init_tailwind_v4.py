#!/usr/bin/env python3
"""Initialize Tailwind CSS v4 style files for a Next.js project.

This script is intentionally conservative:
- It writes style files under src/styles or styles based on project layout.
- It does not modify package.json automatically.
- It prints dependency installation commands and import/source hints.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

BASE_DEPS = ["tailwindcss", "@tailwindcss/postcss", "postcss"]
PLUGIN_DEPS = ["tw-animate-css", "tailwind-scrollbar", "@iconify/tailwind4"]
ICON_DEPS = {
    "all": ["@iconify-json/lucide", "@iconify-json/mdi", "@iconify-json/tabler"],
    "lucide": ["@iconify-json/lucide"],
    "none": [],
}
LOCKFILE_PRIORITY = [
    ("pnpm-lock.yaml", "pnpm"),
    ("yarn.lock", "yarn"),
    ("bun.lockb", "bun"),
    ("package-lock.json", "npm"),
]
TEMPLATE_FILE_MAP: dict[str, list[tuple[str, str]]] = {
    "minimal": [
        ("tailwind-core.css", "tailwind-core.tpl"),
        ("globals.css", "globals.tpl"),
        ("custom.css", "custom.tpl"),
    ],
    "project-like": [
        ("tailwind-core.css", "tailwind-core.tpl"),
        ("globals.css", "globals.tpl"),
        ("custom.css", "custom.tpl"),
        ("shadcn-theme.css", "shadcn-theme.tpl"),
    ],
}
GLOBALS_IMPORT_RE = re.compile(
    r"""^\s*import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"][^'"]*globals\.css['"]\s*;?(?:\s*//.*)?$""",
    re.MULTILINE,
)
CUSTOM_IMPORT_RE = re.compile(
    r"""^\s*import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"][^'"]*custom\.css['"]\s*;?(?:\s*//.*)?$""",
    re.MULTILINE,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Initialize Tailwind CSS v4 scaffolding for Next.js projects."
    )
    parser.add_argument(
        "--project-root",
        required=True,
        help="Absolute or relative path to target project root.",
    )
    parser.add_argument(
        "--preset",
        choices=["minimal", "project-like"],
        default="minimal",
        help="Template preset to apply. Defaults to minimal.",
    )
    parser.add_argument(
        "--icons",
        choices=["all", "lucide", "none"],
        default="all",
        help="Iconify JSON package strategy. Defaults to all.",
    )
    parser.add_argument(
        "--package-manager",
        choices=["auto", "pnpm", "npm", "yarn", "bun"],
        default="auto",
        help="Package manager used to generate install command. Defaults to auto.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned changes without writing files.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing files.",
    )
    return parser.parse_args()


def fail(message: str) -> int:
    print(f"ERROR: {message}", file=sys.stderr)
    return 1


def detect_package_manager(project_root: Path, override: str) -> tuple[str, Path | None]:
    if override != "auto":
        return override, None

    search_roots = [project_root, *project_root.parents]
    for root in search_roots:
        for lockfile, manager in LOCKFILE_PRIORITY:
            candidate = root / lockfile
            if candidate.exists():
                return manager, candidate

    return "npm", None


def load_json(path: Path) -> object | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        print(
            f"WARNING: Failed to parse JSON file {path}: {err.msg}",
            file=sys.stderr,
        )
        return None


def extract_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    results: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            results.append(item.strip())
    return results


def load_source_hints(project_root: Path) -> list[str]:
    hints: list[str] = []

    hints_file = project_root / "tailwind-source-hints.json"
    hints_json = load_json(hints_file)
    if isinstance(hints_json, dict):
        hints.extend(extract_string_list(hints_json.get("sources")))

    package_json = load_json(project_root / "package.json")
    if isinstance(package_json, dict):
        hints.extend(extract_string_list(package_json.get("tailwindSourceHints")))
        tailwind_config = package_json.get("tailwind")
        if isinstance(tailwind_config, dict):
            hints.extend(extract_string_list(tailwind_config.get("sourceHints")))

    unique_hints: list[str] = []
    seen: set[str] = set()
    for hint in hints:
        if hint not in seen:
            unique_hints.append(hint)
            seen.add(hint)

    return unique_hints


def install_command(package_manager: str, deps: list[str]) -> str:
    joined = " ".join(deps)
    if package_manager == "pnpm":
        return f"pnpm add -D {joined}"
    if package_manager == "yarn":
        return f"yarn add -D {joined}"
    if package_manager == "bun":
        return f"bun add -d {joined}"
    return f"npm install -D {joined}"


def write_file(path: Path, content: str, force: bool, dry_run: bool) -> str:
    exists = path.exists()
    if exists and not force:
        return "skipped (exists)"
    if dry_run:
        return "would overwrite" if exists else "would create"

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return "overwritten" if exists else "created"


def resolve_layout_file(project_root: Path) -> Path | None:
    candidates = [
        project_root / "src/app/layout.tsx",
        project_root / "app/layout.tsx",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def resolve_styles_dir(project_root: Path, layout_file: Path | None) -> Path:
    candidates = [
        project_root / "src/styles",
        project_root / "styles",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate

    if layout_file is not None:
        try:
            relative_layout = layout_file.relative_to(project_root)
            if relative_layout.parts[:2] == ("src", "app"):
                return project_root / "src/styles"
            if relative_layout.parts[:1] == ("app",):
                return project_root / "styles"
        except ValueError:
            pass

    return project_root / "src/styles"


def import_status(layout_file: Path) -> tuple[bool, bool]:
    content = layout_file.read_text(encoding="utf-8")
    return (
        bool(GLOBALS_IMPORT_RE.search(content)),
        bool(CUSTOM_IMPORT_RE.search(content)),
    )


def load_template(template_dir: Path, filename: str) -> str:
    path = template_dir / filename
    if not path.exists():
        raise FileNotFoundError(
            f"Missing template file: {path}. Expected a .tpl template file."
        )
    return path.read_text(encoding="utf-8")


def build_dependency_set(icon_policy: str) -> list[str]:
    deps: list[str] = []
    for dep in BASE_DEPS + PLUGIN_DEPS + ICON_DEPS[icon_policy]:
        if dep not in deps:
            deps.append(dep)
    return deps


def main() -> int:
    args = parse_args()

    project_root = Path(args.project_root).expanduser().resolve()
    if not project_root.exists():
        return fail(f"project root does not exist: {project_root}")
    if not (project_root / "package.json").exists():
        return fail(f"package.json not found in project root: {project_root}")

    skill_root = Path(__file__).resolve().parent.parent
    template_dir = skill_root / "assets" / "templates" / args.preset
    if not template_dir.exists():
        return fail(f"template directory not found: {template_dir}")

    layout_file = resolve_layout_file(project_root)
    target_styles_dir = resolve_styles_dir(project_root, layout_file)
    output_template_pairs = TEMPLATE_FILE_MAP[args.preset]

    package_manager, lockfile_used = detect_package_manager(
        project_root, args.package_manager
    )
    deps = build_dependency_set(args.icons)
    cmd = install_command(package_manager, deps)

    print("Tailwind v4 initializer")
    print(f"- Project root: {project_root}")
    print(f"- Preset: {args.preset}")
    print(f"- Icons: {args.icons}")
    print(f"- Package manager: {package_manager}")
    if lockfile_used is not None:
        print(f"- Detected lockfile: {lockfile_used}")
    elif args.package_manager == "auto":
        print("- Detected lockfile: none (fallback to npm)")
    print(f"- Mode: {'dry-run' if args.dry_run else 'write'}")
    print(f"- Force overwrite: {args.force}")
    print(f"- Styles dir: {target_styles_dir}")

    print("\nPlanned style file actions:")
    for output_filename, template_filename in output_template_pairs:
        target_file = target_styles_dir / output_filename
        try:
            content = load_template(template_dir, template_filename)
        except FileNotFoundError as err:
            return fail(str(err))
        status = write_file(target_file, content, args.force, args.dry_run)
        print(f"- {target_file}: {status}")

    print("\nDependency command:")
    print(cmd)

    print("\nLayout import check:")
    if layout_file is None:
        print("- No layout file found at src/app/layout.tsx or app/layout.tsx.")
        print("- Add these imports manually in your root layout:")
        print('  import "@/styles/globals.css";')
        print('  import "@/styles/custom.css";')
    else:
        has_globals, has_custom = import_status(layout_file)
        print(f"- Layout file: {layout_file}")
        print(f"- Has globals.css import: {has_globals}")
        print(f"- Has custom.css import: {has_custom}")
        if not has_globals or not has_custom:
            print("- Missing import suggestions:")
            if not has_globals:
                print('  import "@/styles/globals.css";')
            if not has_custom:
                print('  import "@/styles/custom.css";')

    print("\n@source hints:")
    hints = load_source_hints(project_root)
    if hints:
        print("- Detected source hints from configuration:")
        for hint in hints:
            print(f'  @source "{hint}";')
    else:
        print("- No explicit source hints found.")
        print(
            "- If utility classes come from external packages, add entries like:"
        )
        print(
            '  @source "../node_modules/@your-scope/ui/dist/**/*.{js,ts,jsx,tsx}";'
        )
        print(
            '  @source "../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}";'
        )

    print("\nValidation checklist:")
    print("- Run typecheck (for example: pnpm typecheck).")
    print("- Run dev server and confirm styles render.")
    print("- Verify Iconify classes render (example: icon-[lucide--sparkles]).")
    print("- If icons policy is all, verify mdi/tabler classes also render.")

    if args.dry_run:
        print("\nDry run complete. No files were written.")
    else:
        print("\nInitialization complete.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
