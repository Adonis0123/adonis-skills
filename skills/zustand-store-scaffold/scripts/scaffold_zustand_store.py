#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import re
import sys

NAME_RE = re.compile(r"^[A-Z][A-Za-z0-9]*$")
SLICE_NAME_RE = re.compile(r"^[a-z][a-zA-Z0-9]*$")


@dataclass(frozen=True)
class ScaffoldFile:
    rel_path: str
    template_path: Path | None = None
    extra_values: dict[str, str] | None = None
    dynamic_slices: list[str] | None = None


def to_camel(name: str) -> str:
    return name[:1].lower() + name[1:]


def render_template(template: str, values: dict[str, str]) -> str:
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", value)
    return rendered


def generate_multi_slice_index(store_name: str, slices: list[str]) -> str:
    """Generate index.ts for core pattern with multiple slices.

    Callers must provide at least one valid slice name.
    """
    if not slices:
        raise ValueError("slices must not be empty")

    slice_imports = []
    slice_type_imports_list = []
    slice_creator_calls = []
    slice_type_union = []
    slice_export_list = []
    slice_type_export_list = []

    for i, slice_name in enumerate(slices):
        slice_pascal = slice_name[:1].upper() + slice_name[1:]
        slice_imports.append(f"import {{ create{slice_pascal}Slice }} from './slices/{slice_name}'")
        slice_type_imports_list.append(
            f"import type {{ {slice_pascal}Slice, {slice_pascal}SliceConfig }} from './slices/{slice_name}'"
        )
        slice_creator_calls.append(f"      const {slice_name}Slice = create{slice_pascal}Slice(config?.{slice_name})(...args)")
        # First slice doesn't need '&' prefix
        if i == 0:
            slice_type_union.append(f"{slice_pascal}Slice")
        else:
            slice_type_union.append(f" & {slice_pascal}Slice")
        slice_export_list.append(f"export {{ create{slice_pascal}Slice }}")
        slice_type_export_list.append(f"export type * from './slices/{slice_name}'")

    slice_returns = "\n".join([f"        ...{s}Slice," for s in slices])

    return f"""import {{ createStore }} from 'zustand'
import {{ immer }} from 'zustand/middleware/immer'

{chr(10).join(slice_imports)}

{chr(10).join(slice_type_imports_list)}

{chr(10).join(slice_export_list)}
{chr(10).join(slice_type_export_list)}

export type {store_name}Slice = {''.join(slice_type_union)}

export interface {store_name}SliceConfig {{
{chr(10).join([f'  {s}?: {s[:1].upper() + s[1:]}SliceConfig' for s in slices])}
}}

export function create{store_name}Store(config?: {store_name}SliceConfig) {{
  return createStore<{store_name}Slice>()(
    immer((...args) => {{
{chr(10).join(slice_creator_calls)}

      return {{
{slice_returns}
      }}
    }}),
  )
}}

export type {store_name}StoreApi = ReturnType<typeof create{store_name}Store>
"""


def write_file(path: Path, content: str, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(str(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def validate_slice_names(slices: list[str]) -> list[str]:
    return [slice_name for slice_name in slices if not SLICE_NAME_RE.match(slice_name)]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scaffold Zustand stores following repo patterns.",
        epilog="""
Examples:
  Web pattern:
    %(prog)s --pattern web --name ToolList --path web/src/pages/_components/ToolList/store

  Core pattern (single slice):
    %(prog)s --pattern core --name CoreAgent --path packages/ag-ui-view/src/core/store

  Core pattern (multiple slices):
    %(prog)s --pattern core --name CoreAgent --path packages/ag-ui-view/src/core/store --slices auth,user,ui

  Overwrite existing:
    %(prog)s --pattern web --name ToolList --path ./store --force
        """,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--pattern",
        choices=["web", "core"],
        required=True,
        help="Store pattern: 'web' (component-level) or 'core' (slice-based)",
    )
    parser.add_argument(
        "--name",
        required=True,
        help="PascalCase store name, e.g. ToolList",
    )
    parser.add_argument("--path", required=True, help="Target directory for the store")
    parser.add_argument(
        "--slices",
        help="Comma-separated slice names for core pattern (e.g., 'auth,user,ui'). Defaults to 'core'.",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    args = parser.parse_args()

    if not NAME_RE.match(args.name):
        print("Error: --name must be PascalCase (e.g. ToolList).", file=sys.stderr)
        return 2

    store_name = args.name
    values = {
        "StoreName": store_name,
        "storeName": to_camel(store_name),
        "ContextName": f"{store_name}Context",
        "ProviderName": f"{store_name}Provider",
        "StoreType": f"{store_name}Store",
        "StateType": f"{store_name}StoreState",
        "ActionsType": f"{store_name}StoreActions",
        "PropsType": f"{store_name}Props",
    }

    skill_root = Path(__file__).resolve().parents[1]
    template_root = skill_root / "assets" / "templates" / args.pattern

    # Parse slices for core pattern
    slices = []
    if args.pattern == "core":
        if args.slices is not None:
            slices = [s.strip() for s in args.slices.split(",") if s.strip()]
            if not slices:
                print(
                    "Error: --slices must include at least one slice name (e.g., auth,user).",
                    file=sys.stderr,
                )
                return 5
        else:
            # Interactive mode: ask user for slices
            print("\n📦 Core pattern detected. Do you need multiple slices for different features?")
            print("   Examples: auth, user, ui, data, settings")
            print("   Leave empty to use single 'core' slice.\n")

            while True:
                user_input = input("Enter slice names (comma-separated, or press Enter for 'core'): ").strip()
                if not user_input:
                    slices = ["core"]
                    break
                else:
                    slices = [s.strip() for s in user_input.split(",") if s.strip()]
                    if not slices:
                        print("❌ No valid slice names provided. Please try again.\n")
                        continue
                    invalid = validate_slice_names(slices)
                    if invalid:
                        print(f"❌ Invalid slice names: {', '.join(invalid)}. Must be camelCase (e.g., auth, userData).")
                        print("   Please try again.\n")
                        continue
                    break

        invalid = validate_slice_names(slices)
        if invalid:
            print(
                f"Error: Invalid slice names: {', '.join(invalid)}. Must be camelCase (e.g., auth, userData).",
                file=sys.stderr,
            )
            return 5

    if args.pattern == "web":
        files_to_create = [
            ScaffoldFile("index.ts", template_root / "index.ts.tpl"),
            ScaffoldFile("context.ts", template_root / "context.ts.tpl"),
            ScaffoldFile("provider.tsx", template_root / "provider.tsx.tpl"),
        ]
    else:
        # Core pattern with multiple slices
        files_to_create: list[ScaffoldFile] = []

        # Generate slice files
        for slice_name in slices:
            slice_pascal = slice_name[:1].upper() + slice_name[1:]
            files_to_create.append(
                ScaffoldFile(
                    rel_path=f"slices/{slice_name}.ts",
                    template_path=template_root / "slices" / "core.ts.tpl",
                    extra_values={"SliceName": slice_pascal, "sliceName": slice_name},
                )
            )

        # Add index.ts - use dynamic generation for multiple slices
        if len(slices) > 1:
            files_to_create.append(ScaffoldFile(rel_path="index.ts", dynamic_slices=slices))
        else:
            # Use template for single slice with concrete slice name mapping
            slice_name = slices[0]
            files_to_create.append(
                ScaffoldFile(
                    rel_path="index.ts",
                    template_path=template_root / "index.ts.tpl",
                    extra_values={
                        "SliceName": slice_name[:1].upper() + slice_name[1:],
                        "sliceName": slice_name,
                    },
                )
            )

    target_root = Path(args.path).expanduser()

    print(f"\n🏗️  Scaffolding {args.pattern} store: {store_name}")
    if args.pattern == "core" and slices:
        print(f"📦 Slices: {', '.join(slices)}")
    print(f"📁 Target: {target_root}\n")

    created_files = []
    for file_spec in files_to_create:
        if file_spec.dynamic_slices is not None:
            content = generate_multi_slice_index(store_name, file_spec.dynamic_slices)
        else:
            template_path = file_spec.template_path
            if template_path is None:
                print(f"❌ Missing template path for: {file_spec.rel_path}", file=sys.stderr)
                return 3
            if not template_path.exists():
                print(f"❌ Missing template: {template_path}", file=sys.stderr)
                return 3
            template = template_path.read_text(encoding="utf-8")
            render_values = values if file_spec.extra_values is None else {**values, **file_spec.extra_values}
            content = render_template(template, render_values)

        output_path = target_root / file_spec.rel_path
        try:
            write_file(output_path, content, args.force)
        except FileExistsError:
            print(f"❌ File exists (use --force to overwrite): {output_path}", file=sys.stderr)
            return 4
        created_files.append(output_path)
        print(f"  ✓ Created {file_spec.rel_path}")

    print(f"\n✅ Successfully created {len(created_files)} file(s)\n")
    print("📝 Next steps:")
    print("  1. Define state properties in interfaces")
    print("  2. Add action methods")
    print("  3. Set initial state values")
    if args.pattern == "web":
        print("  4. Import Provider in your component")
        print("  5. Use the context hook to access state\n")
    else:
        print("  4. Create store instance with createStore()")
        print("  5. Use store.getState() and store.setState()\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
