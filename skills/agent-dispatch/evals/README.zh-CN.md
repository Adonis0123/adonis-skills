# agent-dispatch 测评

[English](README.md)

三种检查，按成本从低到高排列。最后一种回答“派活值不值”。以下情况要跑一遍：改选档规则之前；升级模型或被派活的 CLI 之后。每次只改一条规则并配上测量结果（见 `../references/measure.md`）。每次运行的结果记进 [`results.md`](results.md)。

| 检查                        | 回答什么问题                                                                               | 不能说明什么                                                 | 成本                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| A. 加载 skill 对比不加载    | 加载 skill 后，agent 比没有 skill 时更会选档、更守 Run 规则吗？                            | 选出的档位能不能写出更好的代码。路由准确率不能用来比较架构。 | 22 条用例 × 3 次 × 2 组，约 $25–55，30–40 分钟               |
| B. 自己做对比派活的结果对比 | 在本仓库历史里的真实任务上，用 skill 的 agent 完成的任务数不少于单干的 agent，而且更快吗？ | `bench/tasks.json` 之外类型的任务，或者别的模型。            | 3 个任务 × 3 次 × 2 组，耗时数小时，会用到真实的 worker 账号 |
| 触发测评                    | description 能让 Claude 在该用时加载这个 skill 吗？                                        | 加载之后的任何表现。                                         | 12 条提示 × 3 次                                             |

## A. 加载 skill 对比不加载

用例在 [`evals.json`](evals.json)（提示词、fixture、断言），只在这里改。`claude plugin eval` 用的套件由脚本生成：

```bash
python3 skills/agent-dispatch/evals/build_plugin_eval.py
claude plugin eval . --eval-dir evals/agent-dispatch --runs 3 --ablation with-without --scaffold \
  --allow-tools Bash Write Edit --trust-plugin --no-publish -j 4 --judge-model sonnet \
  --output-dir <out> --json <out>/result.json
```

在仓库根目录运行。套件生成在 `evals/agent-dispatch/`，这个目录已加入 gitignore。`claude plugin eval` 不接受放在 `skills/` 里的测评目录。

加载组只装这一个 skill。对照组完全拿不到它，包括装在 home 目录里的副本。每条断言是一个单独的 LLM 评分器，所以用例得分是满足的断言占比，报告会点名没过的那条。`result.json` 里每条用例有 `score`、`scoreWithout`、`delta` 三个值。评审模型看到的 transcript 中间段会被省略，长任务里埋在中间的步骤可能被判成“没做”。`partial: true` 表示这次没跑完。以 API 错误结束的 run（例如 "You've hit your session limit"）直接记 0 分不评，run log 末尾会统计条数；这些用例换个账号重跑。`--case` 只支持单个普通 `*` 通配（不支持 `[..]`、`{..}`），要重跑多条用例，就把它们生成的目录复制到另一个 gitignore 的目录，再用 `--eval-dir` 指过去。用到 Run 台账 fixture 的用例会告诉 agent：台账是静态快照，后台 `watch` 只需说明怎么挂。原因是副本里没有任何东西在跑，文件放满 5 分钟后 `watch` 就会唤醒，最后一条回复变成报告这个假沉默，而不是回答用户。有些断言写了台账命令，对照组不可能知道，所以 delta 里有一部分是“认不认识命令”，不全是“选档更准”。沙箱里没有 `sideby`，所以列了 `fixtures/sideby-stub/sideby` 的用例会拿到一个替身：它用 fixture 数据回答 `sessions`、`send` 等几条命令，输出格式和真 CLI 的 `--json` 一致，消息不会真的发出；提示里会让 agent 把它放到 `PATH` 上。台账和 sideby 用例的评分器看完整过程，因为正确的最终回答不一定会重复它用了哪条命令。套件生成脚本和替身的单元测试：`python3 -m unittest discover -s skills/agent-dispatch/evals -p 'test_*.py'`。

## B. 自己做对比派活的结果对比

任务都来自本仓库的真实提交，见 [`bench/tasks.json`](bench/tasks.json)。每次试验的流程：

1. 把仓库克隆到原提交的父提交。
2. 把问题描述式的提示词交给一个 headless Claude Code 会话。
3. 会话做完后，把原提交自带的测试覆盖到结果上，运行验收命令。

只按结果评分。

```bash
B=skills/agent-dispatch/evals/bench
python3 $B/run_bench.py --out <仓库外的目录> --fake reference --runs 1 --arms solo   # 应该每个任务都 PASS
python3 $B/run_bench.py --out <仓库外的目录> --fake noop --runs 1 --arms solo        # 应该每个任务都 FAIL
python3 $B/run_bench.py --out <dir> --runs 3 --jobs 3 \
  --agent-cmd "sideby run {account} --" --accounts claude:001,claude:002,claude:008
python3 $B/run_bench.py --out <dir> ... --skip-done   # 续跑：只跑 results.jsonl 里还没有的试验
python3 $B/compare.py <dir>/results.jsonl --md <dir>/report.md
```

- 两组：`solo` 是 agent 自己做；`dispatch` 是 agent 用 `/agent-dispatch`，可以在其他 CLI 和账号上启动 worker。同一轮的两组用同一个主控账号。
- 安全措施：每次试验在自己的克隆里进行，删掉了 `origin` 远端，并禁止 `git push`；派活台账也留在克隆里。worker 在这个克隆里以绕过权限确认的模式运行，所以只在能接受这一点的机器上跑。
- 判定（`compare.py`）：三条都满足，派活才算成立：
  - 完成的任务数不少于自己做；
  - 没有任务变差；
  - 耗时中位数更低。

  两组只差一次的任务会标成“看记录”。运行记录在 `<dir>/logs/<task>-<arm>-<rep>.jsonl`，克隆在 `<dir>/work/`。

- 天花板效应：两组每次都通过时，这个对比只测得出用时和花费；派活档位多出的审查只表现为成本，看不出收益。先补几个单干会失败至少一次的任务，再把结论读成“派活不划算”。
- 新增任务的步骤：
  1. 挑一个用测试判定改动对错的提交。
  2. 写一段问题描述式的提示词，写出测试用到的所有接口，但不给解法。
  3. 把测试文件列进 `hidden_tests`，命令列进 `accept`。
  4. 对它跑两次 `--fake` 检查（`--only <id>`）。

  目标是 10 个任务，3 个就可以起步。

- runner 自己的单元测试：`python3 -m unittest discover -s skills/agent-dispatch/evals/bench -p 'test_*.py'`。

## 触发测评

[`trigger-eval-set.json`](trigger-eval-set.json) 列出应该加载和不该加载这个 skill 的提示词。每条生成一个用例，用 `--ablation none` 运行（默认会多跑一组加载不了 skill 的对照组）：

```bash
python3 skills/agent-dispatch/evals/build_plugin_eval.py --trigger
claude plugin eval . --eval-dir evals/agent-dispatch-trigger --runs 3 --ablation none --allow-tools Bash Write Edit \
  --trust-plugin --no-publish -j 4 --output-dir <out> --json <out>/result.json
```

每条用例只有一个免费评分器：Skill 工具加载了 agent-dispatch（`NN-fires`），或者从没加载（`NN-stays-off`，`min: 0` 且 `max: 0`）。运行时只看得到这一份 skill，装在 home 目录里的副本抢不到先手。skill-creator 的 `scripts/run_eval.py` 在装了这个 skill 的机器上会把每条都读成“未触发”，原因就在这里。每次最多 15 轮，开始动手干活的 run 可能会撞到这个上限。
