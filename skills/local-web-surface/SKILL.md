---
name: local-web-surface
description: "Build or extend a persistent macOS local web surface when the request includes a stable *.localhost URL, an existing loopback daemon/gateway, login startup, or a .app launcher. Once triggered, it can add file-backed CRUD or local/public content projections without changing public publishing. Covers domain ownership, exact Host routing, explicit access/threat boundaries, safe mutations, launchd lifecycle, TDD, curl checks, and desktop/mobile browser QA. Do not use for public hosting, production deployment, ordinary frontend/CRUD work on an existing dev server, merely opening or interacting with an existing URL, website audits, or native apps with no local HTTP surface."
metadata:
  author: adonis
  version: "1.3.0"
---

# Local Web Surface

把一个“本地页面”交付成可长期使用的产品入口：固定 `*.localhost` URL、登录后自动可用、可选 `.app` 启动器、真实运行验收。

此 Skill 编排已有代码与系统能力，不规定前端框架。默认优先复用现有 loopback daemon；只有证据证明生命周期、权限或故障域必须隔离时，才新增监听进程。

## 适用性门槛

请求至少要包含一个持久 surface 信号：稳定 `*.localhost` 身份、loopback daemon/gateway、登录自启、共享 listener，或 macOS `.app` launcher。普通 dev server 上的页面/CRUD 实现不使用本 Skill；只需打开、操作或截图现有 URL 时交给 Browser/`agent-browser`，站点扫描与修复交给 `audit-website`。

## 先定义可验证结果

开始前写出以下合同：

```text
Local Web Surface Contract
- Surface: <name>
- Canonical URL: http://<name>.localhost:<port>/
- Data owner: <repo/module>
- Transport owner: <existing daemon or new service>
- Read boundary: <what may be displayed>
- Publish boundary: <none or what may leave the machine>
- Write boundary: <none or exact mutations>
- Access/threat boundary: <trusted local user/processes, or exact authentication/authorization>
- Launcher: <none or App name>
- Done signals: <tests + curl + launchctl + browser>
```

若用户已授权自主完成，可从代码和本机状态解析这些值，不重复询问。若选择会改变数据真相源、公开范围、访问/认证边界或占用未知服务端口，先停在一个决策问题上。

## 第一性原理

先从约束推导方案：

1. 页面必须有稳定地址，用户不应记随机端口或手动启动命令。
2. 数据必须只有一个真相源；UI、CLI 与 Agent 不得各写一份副本。
3. 当 `Write boundary` 非 `none` 时，写入必须有一个受控端口；浏览器和 Agent 不直接拼 YAML/JSON。
4. 本地服务只监听 loopback，不能因为“只在自己电脑上”就省略 Host、Origin、输入和路径检查；loopback、Host 与 Origin 都不是调用者身份认证。
5. 多个页面共享同一生命周期时，一个 listener + 精确 Host 分发比多个常驻 daemon 更实用。
6. `.app` 只负责唤醒/打开，不承载业务和第二份服务生命周期。

`.localhost` 及其子域由客户端作为 loopback 特殊域处理；不要为常规 `*.localhost` 别名修改 `/etc/hosts`。实现前仍应以当前系统上的 DNS/curl 结果验证，而不是只凭规范推断。

## DDD 与依赖方向

把职责放回拥有它的 bounded context：

| 边界              | 拥有什么                                                 | 不拥有什么                               |
| ----------------- | -------------------------------------------------------- | ---------------------------------------- |
| Domain/Data owner | 数据模型、校验、所需 repository、内容过滤、HTML/DTO 产物 | 端口、LaunchAgent、全局 Host 表          |
| Local application | 页面 handler、应用路由、用例编排                         | daemon 生命周期、其他 surface 的内部实现 |
| Loopback gateway  | TCP listener、精确 Host 分发、body 上限、响应桥接        | surface 业务规则、数据文件格式           |
| Launcher          | 登录自启、`.app`、打开 canonical URL                     | 第二个 server、数据写入、业务状态        |

依赖方向固定为：gateway 依赖一个窄的 value contract；data owner 不反向依赖 gateway。跨仓库集成时，传递普通 request/response 值或加载一个稳定 handler 入口，不把 domain 类和 storage 细节复制进 gateway。

高内聚体现在：一个数据变更的校验、并发和持久化都留在 repository；低耦合体现在：新增 surface 只增加 Host 映射、handler 入口和 launcher spec，不修改其他 surface 的业务分支。

## 前置检查

编辑前完成：

1. 读取每个涉及仓库的 `AGENTS.md` 和架构/测试文档。
2. 分别记录 `git status --short`；保留现有 dirty changes，禁止重置或顺手整理。
3. 用 `lsof -nP -iTCP:<port> -sTCP:LISTEN`、`launchctl print`、进程命令和现有 launcher 代码确认真实生命周期。
4. 从 `package.json`、lockfile 与本机二进制确认 Node、runner、依赖版本。
5. 查已有 server、CLI、`.app`、LaunchAgent、数据文件、写入 skill 和发布过滤；优先扩展现有模块。
6. 对版本敏感 API 查官方文档或项目锁定版本的文档，并用运行结果验证。

## 设计门禁

在写代码前形成最小 surface 表：

| Surface  | Exact Host                  | Owner         | Reads              | Writes                    |
| -------- | --------------------------- | ------------- | ------------------ | ------------------------- |
| existing | `existing.localhost:<port>` | existing repo | existing data      | existing API              |
| new      | `new.localhost:<port>`      | data repo     | explicit allowlist | explicit commands or none |

必须明确：

- gateway 使用 exact Host allowlist；未知、畸形或错误端口返回 `421`，不能回落到默认管理页。
- 每个 Host 只看见合同列出的路由；不能访问其他 surface 的页面或 API。
- 当 `Read boundary` 涉及公开/私有内容时，必须把“本地可见”和“允许发布”写成两个独立投影；意图不明确或页面可能被他人访问时，本地 reader 默认 fail closed，只展示显式公开内容。
- `private` / `local-only` 只描述“不进入 public projection”，不承诺保密。loopback 服务会替调用方读取文件；同机其他账户或进程可能直接发 HTTP。`Access/threat boundary` 若不信任它们，必须加入真实认证/授权，或停止暴露该内容。
- 仅当 `Write boundary` 非 `none` 时，写请求才至少检查 canonical `Origin`、`Content-Type: application/json`、应用标记 header、body 上限和 `If-Match`。Origin 与应用 header 主要约束浏览器写入，不是客户端身份。
- 页面、CLI 与 Agent 等多个入口读写同一份数据时，统一路由到一个唯一 service/repository writer；禁止绕过它直接编辑。只有无法消除多个 OS 进程直接写入时，才增加跨进程锁。

## 内容型 Reader 的双投影合同（条件）

只在 surface 读取带发布状态的文章或文档时启用本节。不要把 `public` 同时当作本地读取权限和发布资格，除非用户明确要求两者完全相同。

当用户确认这是个人 loopback workspace、`Access/threat boundary` 允许当前本机调用者，并要求本地查看公开与私密成文时：

- Local catalog 只扫描合同指定的文章根，例如 `posts/**/*.md`；接纳显式布尔 `public: true` 与 `public: false`。
- Public projection 或 sync 仍只接纳 `public === true`。不要为满足本地预览去放宽发布脚本。
- 缺失或非布尔 `public` 的记录既不展示也不发布，并只报告相对路径和元数据错误，不返回正文。
- 研究素材、事实底座和助理数据（例如 `raw/`、`notes/`、`digests/`）不属于文章 catalog；只有独立 surface 合同明确纳入时才读取。
- DTO 投影稳定 `visibility: public | private`、目录分类和规范化 tags。页面提供 `all/public/private`、category、tag 与搜索的组合筛选。
- 私密卡片与详情必须明确标记 local-only，并说明 public sync 会排除它，防止“看得见”被误解为“会发布”。

当页面不是个人 loopback workspace、用户没有确认可显示私密内容，或访问边界不能保护敏感内容时，继续 fail closed，仅展示显式 `public: true`。若 `public: false` 代表真正机密而非发布状态，必须先加认证/授权，不能把 `local-only` 标签当作保护。

## TDD 实施顺序

行为变更按 RED → GREEN → REFACTOR：

1. **Domain tests**：覆盖合同中的数据规则；只读 surface 不虚构 mutation 或状态机。
2. **Mutation/concurrency tests（条件）**：仅当 `Write boundary` 非 `none` 时覆盖强 ETag、缺 `If-Match`、stale revision、同进程串行、revision 重检和临时文件清理。只有不可消除的多个 OS 进程会直接写同一文件时，才增加跨进程 lock、崩溃恢复、活 owner 检查和 replacement-lock 测试。
3. **Catalog tests（条件）**：仅当读取发布型内容时分别覆盖 local catalog 与 public projection、稳定 ID、排序、分类/tags/visibility、frontmatter 错误不泄露正文、Markdown XSS、图片 traversal/symlink escape。
4. **Handler tests**：页面 shell、合同列出的用例、跨 surface 404、安全 guard、稳定错误码。
5. **Gateway tests**：Host allowlist、bridge failure closed、合同需要的 body limit、launcher specs、重装生命周期。
6. **Runtime checks**：只有适用于该合同的上述测试通过后才安装/重启真实服务。

不要先写整套实现再补快照测试。每个发现的运行时 bug 先补能失败的回归测试，再改实现。

## 文件型 CRUD 的最低安全线（条件）

只在 `Write boundary` 非 `none` 且存储为 YAML/JSON 单文件时启用本节。repository 至少做到：

- 在系统边界严格校验根结构、允许字段、值域和真实日期。
- 用内容 hash 生成 strong ETag；所有 mutation 要求 `If-Match`。
- 唯一 writer 内的写操作串行，并在替换前重新检查 revision。优先让 CLI、页面与 Agent 调用这个 writer，避免制造多进程写拓扑。
- 只有证据证明多个 OS 进程必须直接写同一文件时，才使用 crash-recoverable 独占 lock。优先复用成熟的 atomic directory + heartbeat/stale lease 或项目已验证的 advisory-lock，并让所有 writer 使用完全一致的 lock path、stale/update/retry 参数和 compromised 处理。
- 若不得不自建 owner lock，记录随机 token、PID、进程启动身份和时间；活 lease 或身份匹配的 live owner 绝不接管。stale recovery 必须串行，并让所有 writer 在接管窗口前后检查带 owner identity 或 lease/heartbeat 的 recovery guard，防止两个 reaper 删除刚创建的新 lock。
- 在目标文件同目录写唯一 temp file，flush/sync，重新检查 revision，再 atomic rename。
- `finally` 只清理自己 token 对应的 temp/lock；删除前重新核对 owner，绝不删除已被新 owner 替换的 lock。
- 多进程 writer 场景的回归测试必须覆盖：持锁子进程异常退出后 writer 可恢复；live owner 不被接管；旧 owner 清理时不能删除新 owner 的 lock。唯一 writer 场景不虚构跨进程 lock 测试。
- mutation 返回新 revision；冲突返回 `412`，缺前置条件返回 `428`。
- 自动化 CRUD 验收使用临时 fixture。不要为了测试 UI 改写用户真实数据，除非用户明确授权且恢复策略可靠。

## 页面实现

优先交付无构建依赖的响应式页面，除非现有应用已有框架：

- 用户内容进入 DOM 时使用 `textContent`；只有经过受控 sanitizer/安全 Markdown renderer 的 HTML 才可 `innerHTML`。
- 表单和按钮有可访问名称、键盘路径和 `aria-live` 状态。
- mutation 失败保留用户输入；`412` 明确提示 reload/retry。
- 若合同是 Todo CRUD，最少具备 create、list/read、rename/update、complete/reopen、delete 与确认。
- 若合同是内容 Reader，最少具备合同要求的文章列表、搜索、目录分类、标签、可见性筛选、deep link、正文与安全图片；只有合同允许私密内容时才显示 private 状态。
- 同时验收桌面和约 `390x844` 的移动 viewport。

## Gateway 与 launchd

gateway 只监听 `127.0.0.1`（或明确验证过的 loopback），并把传入 header 缩到 handler 实际需要的集合。loopback/Host 隔离不等于认证；按 `Access/threat boundary` 对敏感读取和写入增加真实授权。body 超限时排空请求，不要销毁底层 socket；否则客户端可能收不到稳定 `413`。

macOS 登录服务遵守：

- 一个 `~/Library/LaunchAgents/<label>.plist`，使用 `RunAtLoad` + `KeepAlive`。
- LaunchAgent 必须拥有最终长期 Node listener。优先让 `ProgramArguments` 直接执行 `node --import tsx <absolute-cli.ts> web`；只做环境准备且最后 `exec node ...` 的 shell 也可保持同一 PID。不要让 LaunchAgent 只跟踪会再 spawn 子进程的 `tsx` CLI wrapper，否则 `bootout` 可能留下孤儿 listener。
- `WorkingDirectory`、logs 与 `PATH` 使用绝对值；`plutil -lint` 必须通过。
- 多个 `.app` 是薄 opener：`exec <cli> open-web <surface>`。每个 app 有独立 bundle ID/name，但不启动第二份 daemon。
- installer 必须可重复执行。至少连续安装两次并确认仍只有一个 listener、LaunchAgent `state = running`、error log 无 `EADDRINUSE`。

## 真实验收

按风险从小到大执行：

1. 所有涉及仓库各自的 focused tests、full tests、typecheck/build；单仓库任务不得虚构第二个仓库。
2. `git diff --check`，确认没有范围外文件、secret、临时 lock 或 fixture。
3. `plutil -lint` 所有 plist；检查每个 `.app/Contents/MacOS/launcher` 的 surface 参数。
4. `launchctl print gui/<uid>/<label>`：`state = running` 且有唯一 tracked PID。
5. `lsof`：目标端口只有一个 loopback listener；tracked PID 就是 listener PID，而非短命 wrapper。
6. `curl --noproxy '*'`：每个 canonical Host 返回正确页面/API；未知 Host `421`；跨 surface 路由不泄露；超大 body 稳定 `413`。
7. 用真实浏览器打开每个 URL，按合同检查 console/快照与功能；只有合同包含搜索/deep link 或 CRUD 时才验收它们；同时检查桌面与移动 viewport。
8. 仅对发布型仓库跑临时 target sync，证明 `public:false` 与合同列出的其他本地内容没有进入公共产物；若本地 reader 允许私密内容，再用 API 和浏览器分别证明它们确实进入本地列表、详情、搜索/筛选与 deep link。

若 UI CRUD 已由临时 repository/handler 集成测试覆盖，真实浏览器验收可以只读；不要用“为了验收”作为改动用户数据的理由。

## 失败恢复

- `EADDRINUSE`：先解析 tracked PID、listener PID、父子/进程组和完整命令，并搜索应用是否主动 `spawn`/`fork`/daemonize；只终止已验证属于该服务的进程。修 installer 后重复安装验证，不只手工 kill 一次。
- dynamic handler 缺失或响应越界：gateway 返回稳定 `503`，不暴露本地绝对路径和 stack。
- lock timeout：返回可重试错误；按选定协议用 heartbeat/stale lease，或 token、PID 与进程启动身份判断 live/stale。只有 crash-recovery 协议能证明 owner 已失效时才回收；无法证明就保留 lock 并报告，不按未经 heartbeat 约束的文件年龄猜删。
- 浏览器能开但 mutation 失败：检查真实 `Origin`、Host、ETag、header 与 socket 行为，不用关闭安全 guard 取巧。
- local/public catalog 有错误：报告相对路径和元数据问题，不返回文章正文；先核对当前 surface 的 Read boundary 与 Publish boundary，不用删掉私密投影来掩盖发布边界缺失。

## 完成报告

只在真实信号齐全时声明完成：

```text
Local Web Surface Result
- URLs: <canonical URLs>
- Launchers: <apps + LaunchAgent>
- Data ownership: <source of truth + only writer>
- Security boundaries: <Host/Origin/access-auth/local visibility/publication/path controls>
- Verification: <exact tests, curl, launchctl, browser results>
- User data touched during QA: no | <explicit details>
- UNVERIFIED: none | <blocked check and reason>
```

未经用户授权，不 stage、commit、push、deploy 或改写真实业务数据。
