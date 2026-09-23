# 剪映专业版 macOS（Hub / canvas agent）

Read this only when the app is 剪映专业版 / VideoFusion / the China desktop build (`com.lemon.lvpro`). Enumerate skills at survey time. Do not paste a frozen catalog into the report from memory.

## Identity

| What | Where |
|------|--------|
| App bundle | `/Applications/VideoFusion-macOS.app` |
| Bundle id | `com.lemon.lvpro` |
| System Events process | `VideoFusion-macOS` (menu title may be 剪映专业版) |
| User data | `~/Movies/JianyingPro/User Data` |
| Marketing version | `CFBundleShortVersionString` in the app `Info.plist` |
| Internal version | `CFBundleVersion` in the same plist |
| Agent package stamp | `Contents/Resources/canvas_agent/package-manifest.json` (`release`, `packageStamp`) |

## Where features live

- Agent root: `Contents/Resources/canvas_agent`.
- Registered skills: `packaged-skills.json` → `skills[]` (`name`, `description`, `status`, `packageRoot`). Only `status=ready` is registered-ready.
- Shipped skill dirs: `skills/*/SKILL.md`. Read frontmatter `name` and `description`. This set is larger than the registry. Report both, and do not call directory-only skills 官方已上线.
- canvas cli is `skills/canvas-cli`, not a timeline editor. Command names are the `##` headings under `skills/canvas-cli/references/` (`query`, `create`, `edit`, `organize`, `requests`). It creates and edits canvas nodes, links, and asset cards. It does not cut, subtitle, package, or remove filler words on the timeline.
- UI copy: `Contents/Resources/po/zh-Hans.po`. Hub and assistant strings use msgid prefixes `hub_` and `pc_agent_`.
- Invite-gate copy uses msgid prefix `pc_hub_entitlement_`. `User Data/Config/commonSetting.ini` may contain `hub.plaza.entrance_guide_clicked`; that only means the plaza guide was clicked.

## How to label a row

| Evidence | Label |
|----------|--------|
| `status=ready` in `packaged-skills.json` | 官方登记 |
| `SKILL.md` on disk, no registry row | 目录有，未登记 |
| `.po` string only, window not opened | 文案在包里，按钮未核 |
| Only a web article (即梦, 小云雀, 手机端小映, …) | 本机未核实 |

When writing the table, split canvas cli commands from task skills. MotionGraph and programmatic keyframes are listed as unsupported under `skills/skill-creator/references/editing/no-support.md`; do not infer HTML motion-graphics support from the presence of canvas cli.
