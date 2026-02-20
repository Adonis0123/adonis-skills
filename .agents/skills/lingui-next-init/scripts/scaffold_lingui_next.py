#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

PLACEHOLDER_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")
VALID_MODES = ("app-only", "shared-auto", "shared-force")
DEFAULT_SERVER_LAYOUTS_PACKAGE = "@adonis-kit/react-layouts"
DEFAULT_SERVER_LAYOUTS_VERSION = "latest"

LANGUAGE_PRESETS: dict[str, dict[str, str]] = {
    "en": {
        "lang": "en-US",
        "language": "English",
        "locale": "en",
        "languageInEn": "English",
    },
    "zh": {
        "lang": "zh-CN",
        "language": "Chinese Simplified",
        "locale": "zh",
        "languageInEn": "Chinese Simplified",
    },
    "ja": {
        "lang": "ja-JP",
        "language": "Japanese",
        "locale": "ja",
        "languageInEn": "Japanese",
    },
    "ko": {
        "lang": "ko-KR",
        "language": "Korean",
        "locale": "ko",
        "languageInEn": "Korean",
    },
    "fr": {
        "lang": "fr-FR",
        "language": "French",
        "locale": "fr",
        "languageInEn": "French",
    },
    "de": {
        "lang": "de-DE",
        "language": "German",
        "locale": "de",
        "languageInEn": "German",
    },
    "es": {
        "lang": "es-ES",
        "language": "Spanish",
        "locale": "es",
        "languageInEn": "Spanish",
    },
    "it": {
        "lang": "it-IT",
        "language": "Italian",
        "locale": "it",
        "languageInEn": "Italian",
    },
    "pt": {
        "lang": "pt-PT",
        "language": "Portuguese",
        "locale": "pt",
        "languageInEn": "Portuguese",
    },
}


@dataclass
class Report:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def add_created(self, path: Path, dry_run: bool) -> None:
        prefix = "[dry-run] " if dry_run else ""
        self.created.append(f"{prefix}{path.as_posix()}")

    def add_updated(self, path: Path, dry_run: bool) -> None:
        prefix = "[dry-run] " if dry_run else ""
        self.updated.append(f"{prefix}{path.as_posix()}")

    def add_skipped(self, message: str) -> None:
        self.skipped.append(message)

    def add_note(self, message: str) -> None:
        self.notes.append(message)

    def add_error(self, message: str) -> None:
        self.errors.append(message)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scaffold Lingui i18n into Next.js App Router projects.",
    )
    parser.add_argument(
        "--project-root",
        required=True,
        help="Path to target project root (absolute or starting with ~).",
    )
    parser.add_argument(
        "--mode",
        choices=VALID_MODES,
        required=True,
        help="Scaffold mode: app-only | shared-auto | shared-force.",
    )
    parser.add_argument(
        "--locales",
        default="en,zh",
        help="Comma-separated locales. Example: en,zh,ja",
    )
    parser.add_argument(
        "--default-locale",
        default="en",
        help="Default locale. Must be included in --locales.",
    )
    parser.add_argument(
        "--source-locale",
        default="en",
        help="Source locale for Lingui extraction. Must be included in --locales.",
    )
    parser.add_argument(
        "--package-manager",
        choices=("pnpm", "npm", "yarn", "bun"),
        default="pnpm",
        help="Package manager used in generated scripts. Allowed: pnpm | npm | yarn | bun",
    )
    parser.add_argument(
        "--i18n-package-name",
        default="@your-org/i18n",
        help="Package name to use for shared packages/i18n mode.",
    )
    parser.add_argument(
        "--with-server-layouts",
        action="store_true",
        help="Enable optional withServerLayouts templates and dependency merge.",
    )
    parser.add_argument(
        "--server-layouts-package",
        default=DEFAULT_SERVER_LAYOUTS_PACKAGE,
        help="Package name that exports withServerLayouts under /server.",
    )
    parser.add_argument(
        "--server-layouts-version",
        default=DEFAULT_SERVER_LAYOUTS_VERSION,
        help="Version string used when adding server-layouts dependency.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing files.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing rendered files.",
    )
    return parser.parse_args()


def parse_locales(raw: str) -> list[str]:
    values = [item.strip() for item in raw.split(",")]
    values = [item for item in values if item]
    if not values:
        raise ValueError("--locales must contain at least one locale")

    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


def detect_workspace(project_root: Path) -> bool:
    if (project_root / "pnpm-workspace.yaml").exists():
        return True

    root_package = project_root / "package.json"
    if not root_package.exists():
        return False

    try:
        payload = json.loads(root_package.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False

    if not isinstance(payload, dict):
        return False

    workspaces = payload.get("workspaces")
    if isinstance(workspaces, list) and len(workspaces) > 0:
        return True
    if isinstance(workspaces, dict):
        packages = workspaces.get("packages")
        if isinstance(packages, list) and len(packages) > 0:
            return True

    return False


def infer_language_preset(locale: str) -> dict[str, str]:
    preset = LANGUAGE_PRESETS.get(locale)
    if preset is not None:
        return preset

    normalized = locale.replace("_", "-")
    pieces = normalized.split("-")
    language = pieces[0] if pieces else locale
    territory = pieces[1].upper() if len(pieces) > 1 else language.upper()
    lang_code = f"{language.lower()}-{territory}"
    title = language.upper()
    return {
        "lang": lang_code,
        "language": title,
        "locale": language.lower(),
        "languageInEn": title,
    }


def build_languages_entries(locales: list[str]) -> str:
    blocks: list[str] = []
    for locale in locales:
        preset = infer_language_preset(locale)
        block = [
            "\t{",
            f'\t\tabbr: "{locale}",',
            f'\t\tlang: "{preset["lang"]}",',
            f'\t\tlanguage: "{preset["language"]}",',
            f'\t\tlocale: "{preset["locale"]}",',
            f'\t\tlanguageInEn: "{preset["languageInEn"]}",',
            "\t}",
        ]
        blocks.append("\n".join(block))
    return ",\n".join(blocks)


def build_inline_lingui_config(locales: list[str], source_locale: str) -> str:
    locales_json = json.dumps(locales, ensure_ascii=False)
    return (
        'import type { LinguiConfig } from "@lingui/conf";\n'
        "\n"
        "const linguiConfig: LinguiConfig = {\n"
        f"\tlocales: {locales_json},\n"
        f'\tsourceLocale: "{source_locale}",\n'
        '\tcompileNamespace: "es",\n'
        '\tformat: "po",\n'
        "\texperimental: {\n"
        "\t\textractor: {\n"
        "\t\t\tentries: [\n"
        '\t\t\t\t"<rootDir>/src/app/[[]lang[]]/**/{page,layout,loading,error,not-found,template,default}.tsx",\n'
        "\t\t\t],\n"
        '\t\t\toutput: "<rootDir>/src/locales/{entryDir}/{entryName}/{locale}",\n'
        "\t\t},\n"
        "\t},\n"
        "};\n"
        "\n"
        "export default linguiConfig;\n"
    )


def build_inline_i18n_config(locales: list[str], default_locale: str) -> str:
    locales_json = json.dumps(locales, ensure_ascii=False)
    return (
        f"export const SUPPORTED_LOCALES = {locales_json} as const;\n"
        "export type AppLocale = (typeof SUPPORTED_LOCALES)[number];\n"
        "\n"
        f'export const DEFAULT_LOCALE: AppLocale = "{default_locale}";\n'
        "\n"
        "export function isSupportedLocale(value: string): value is AppLocale {\n"
        "\treturn SUPPORTED_LOCALES.includes(value as AppLocale);\n"
        "}\n"
    )


def build_shared_i18n_config(package_name: str) -> str:
    return (
        f'import {{ defaultLocale, supportedLocales }} from "{package_name}/next-config";\n'
        "\n"
        "export const SUPPORTED_LOCALES = supportedLocales;\n"
        "export type AppLocale = (typeof SUPPORTED_LOCALES)[number];\n"
        "\n"
        "export const DEFAULT_LOCALE = defaultLocale as AppLocale;\n"
        "\n"
        "export function isSupportedLocale(value: string): value is AppLocale {\n"
        "\treturn SUPPORTED_LOCALES.includes(value as AppLocale);\n"
        "}\n"
    )


def build_replacements(
    locales: list[str],
    default_locale: str,
    source_locale: str,
    package_manager: str,
    i18n_package_name: str,
    server_layouts_package: str,
    use_shared_package: bool,
) -> dict[str, str]:
    locales_json = json.dumps(locales, ensure_ascii=False)
    replacements: dict[str, str] = {
        "SUPPORTED_LOCALES_ARRAY": locales_json,
        "DEFAULT_LOCALE": default_locale,
        "SOURCE_LOCALE": source_locale,
        "PACKAGE_MANAGER": package_manager,
        "I18N_PACKAGE_NAME": i18n_package_name,
        "SERVER_LAYOUTS_IMPORT_PATH": f"{server_layouts_package}/server",
        "ALL_LANGUAGES_ENTRIES": build_languages_entries(locales),
    }

    if use_shared_package:
        replacements["WEB_LINGUI_CONFIG_CONTENT"] = (
            f'import linguiConfig from "{i18n_package_name}/lingui-config";\n\n'
            "export default linguiConfig;\n"
        )
        replacements["WEB_I18N_CONFIG_CONTENT"] = build_shared_i18n_config(
            i18n_package_name
        )
    else:
        replacements["WEB_LINGUI_CONFIG_CONTENT"] = build_inline_lingui_config(
            locales, source_locale
        )
        replacements["WEB_I18N_CONFIG_CONTENT"] = build_inline_i18n_config(
            locales, default_locale
        )

    return replacements


def render_template(template: str, replacements: dict[str, str]) -> str:
    def replace_match(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in replacements:
            raise KeyError(f"Missing replacement for placeholder '{key}'")
        return replacements[key]

    return PLACEHOLDER_RE.sub(replace_match, template)


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise RuntimeError(f"Missing file: {path}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Invalid JSON: {path}: {error}") from error

    if not isinstance(payload, dict):
        raise RuntimeError(f"Expected JSON object in {path}")
    return payload


def write_json(path: Path, payload: dict[str, Any], dry_run: bool) -> None:
    if dry_run:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def merge_package_json(
    project_root: Path,
    snippet_template_path: Path,
    replacements: dict[str, str],
    extra_dependencies: dict[str, str],
    report: Report,
    dry_run: bool,
) -> None:
    target_path = project_root / "web/package.json"
    if not target_path.exists():
        report.add_note(
            f"skip merge: missing target {target_path.as_posix()}"
        )
        return

    snippet_content = render_template(
        snippet_template_path.read_text(encoding="utf-8"), replacements
    )
    try:
        snippet = json.loads(snippet_content)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"Invalid JSON in template {snippet_template_path}: {error}"
        ) from error

    target = load_json(target_path)
    changed = False
    added: list[str] = []

    for section in ("scripts", "dependencies", "devDependencies"):
        section_payload = snippet.get(section, {})
        if not isinstance(section_payload, dict):
            continue
        if section == "dependencies" and extra_dependencies:
            section_payload = {**section_payload, **extra_dependencies}

        current = target.get(section)
        if current is None:
            current = {}
            target[section] = current
        if not isinstance(current, dict):
            raise RuntimeError(
                f"{target_path}: expected '{section}' to be an object."
            )

        for key, value in section_payload.items():
            if key in current:
                continue
            current[key] = value
            changed = True
            added.append(f"{section}.{key}")

    if not changed:
        report.add_note(f"package.json unchanged: {target_path.as_posix()}")
        return

    write_json(target_path, target, dry_run)
    report.add_updated(target_path, dry_run)
    report.add_note(f"package.json additions: {', '.join(added)}")


def write_rendered_file(
    output_path: Path,
    content: str,
    report: Report,
    dry_run: bool,
    force: bool,
) -> None:
    if output_path.exists():
        if not force:
            report.add_skipped(
                f"skip existing (use --force to overwrite): {output_path.as_posix()}"
            )
            return
        if not dry_run:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(content, encoding="utf-8")
        report.add_updated(output_path, dry_run)
        return

    if not dry_run:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(content, encoding="utf-8")
    report.add_created(output_path, dry_run)


def print_summary(report: Report) -> None:
    print("")
    print("=== lingui-next-init summary ===")
    print(f"created: {len(report.created)}")
    for item in report.created:
        print(f"  + {item}")
    print(f"updated: {len(report.updated)}")
    for item in report.updated:
        print(f"  ~ {item}")
    print(f"skipped: {len(report.skipped)}")
    for item in report.skipped:
        print(f"  - {item}")
    if report.notes:
        print("notes:")
        for note in report.notes:
            print(f"  * {note}")
    if report.errors:
        print("errors:")
        for error in report.errors:
            print(f"  ! {error}")


def main() -> int:
    args = parse_args()
    report = Report()

    skill_root = Path(__file__).resolve().parents[1]
    app_router_templates = skill_root / "assets/templates/app-router"

    project_root = Path(args.project_root).expanduser()
    if not project_root.is_absolute():
        print("Error: --project-root must be an absolute path.", file=sys.stderr)
        return 2
    if not project_root.exists():
        print(f"Error: project root does not exist: {project_root}", file=sys.stderr)
        return 2
    if not project_root.is_dir():
        print(f"Error: project root is not a directory: {project_root}", file=sys.stderr)
        return 2
    if not app_router_templates.exists():
        print(
            f"Error: missing template directory: {app_router_templates}",
            file=sys.stderr,
        )
        return 2

    try:
        locales = parse_locales(args.locales)
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    if args.default_locale not in locales:
        print(
            "Error: --default-locale must be present in --locales.",
            file=sys.stderr,
        )
        return 2
    if args.source_locale not in locales:
        print(
            "Error: --source-locale must be present in --locales.",
            file=sys.stderr,
        )
        return 2

    workspace_detected = detect_workspace(project_root)
    shared_path = project_root / "packages/i18n"
    shared_exists = shared_path.exists()

    if args.mode == "app-only":
        use_shared_package = False
        should_render_shared_templates = False
    elif args.mode == "shared-force":
        use_shared_package = True
        should_render_shared_templates = True
    else:
        # shared-auto
        use_shared_package = workspace_detected or shared_exists
        should_render_shared_templates = workspace_detected and not shared_exists

    if args.mode == "shared-auto":
        if shared_exists:
            report.add_note("shared-auto: found existing packages/i18n, skip rendering package templates.")
        elif workspace_detected:
            report.add_note("shared-auto: workspace detected, render package templates.")
        else:
            report.add_note("shared-auto: workspace not detected, fallback to app-only.")

    replacements = build_replacements(
        locales=locales,
        default_locale=args.default_locale,
        source_locale=args.source_locale,
        package_manager=args.package_manager,
        i18n_package_name=args.i18n_package_name,
        server_layouts_package=args.server_layouts_package,
        use_shared_package=use_shared_package,
    )
    optional_server_layout_templates = {
        "web/src/i18n/layout-factory.tsx.tpl",
        "web/src/app/[lang]/(home)/layout.tsx.tpl",
    }
    if args.with_server_layouts:
        extra_dependencies = {
            args.server_layouts_package: args.server_layouts_version
        }
        report.add_note(
            "server-layouts enabled: "
            f"merge dependency {args.server_layouts_package}@{args.server_layouts_version}"
        )
    else:
        extra_dependencies = {}
        report.add_note(
            "server-layouts disabled: skip optional templates and dependency merge."
        )
        if (
            args.server_layouts_package != DEFAULT_SERVER_LAYOUTS_PACKAGE
            or args.server_layouts_version != DEFAULT_SERVER_LAYOUTS_VERSION
        ):
            report.add_note(
                "--server-layouts-package/--server-layouts-version ignored "
                "because --with-server-layouts is not enabled."
            )

    stop_on_error = not args.dry_run
    template_files = sorted(app_router_templates.rglob("*.tpl"))
    for template_path in template_files:
        rel = template_path.relative_to(app_router_templates).as_posix()

        if rel == "web/package.scripts.json.tpl":
            try:
                merge_package_json(
                    project_root=project_root,
                    snippet_template_path=template_path,
                    replacements=replacements,
                    extra_dependencies=extra_dependencies,
                    report=report,
                    dry_run=args.dry_run,
                )
            except RuntimeError as error:
                report.add_error(str(error))
                if stop_on_error:
                    print(
                        "Error: write mode stops at first template error. Re-run with --dry-run to collect all errors.",
                        file=sys.stderr,
                    )
                    break
            continue

        if rel.startswith("packages/i18n/") and not should_render_shared_templates:
            report.add_skipped(
                f"skip by mode ({args.mode}): {rel}"
            )
            continue
        if rel in optional_server_layout_templates and not args.with_server_layouts:
            report.add_skipped(
                "skip optional server-layout template "
                f"(--with-server-layouts disabled): {rel}"
            )
            continue

        output_rel = rel.removesuffix(".tpl")
        output_path = project_root / output_rel

        try:
            rendered = render_template(
                template_path.read_text(encoding="utf-8"), replacements
            )
        except KeyError as error:
            report.add_error(f"{template_path}: {error}")
            if stop_on_error:
                print(
                    "Error: write mode stops at first template error. Re-run with --dry-run to collect all errors.",
                    file=sys.stderr,
                )
                break
            continue

        write_rendered_file(
            output_path=output_path,
            content=rendered,
            report=report,
            dry_run=args.dry_run,
            force=args.force,
        )

    print_summary(report)
    return 1 if report.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
