"""The Board: a static one-column report page, plus one page per full Worker report."""
import functools
import html
import shutil
import os
import re
from pathlib import Path
import time
from urllib.parse import quote
import dispatch_board as b


def local_clock(now=None):
    """Local wall-clock time the owner reads, e.g. `2026-10-20 16:54:32`."""
    return time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now))


def step_title(index, title):
    """写成 `第 N 步：<title>`（标题自带步数则不加）"""
    return title if re.match(r'^\s*第\s*\d+\s*步', title or '') else f'第 {index} 步：{title}'


def e(value):
    return html.escape(str(value), quote=True)


MARKDOWN_IT = 'vendor/markdown-it-15.0.3.min.js'


@functools.lru_cache(maxsize=None)
def asset(name):
    text = (Path(__file__).parent / name).read_text(encoding='utf-8')
    return re.sub(r'\n//# sourceMappingURL=\S+\s*$', '\n', text)


def tokens(count):
    return f'{count / 1e6:.2f}M' if count >= 1e6 else f'{count / 1e3:.0f}k' if count >= 1e3 else str(count)


def report_href(lane, reports):
    return (reports or {}).get(lane['id'])


def clock(epoch):
    return time.strftime('%m-%d %H:%M', time.localtime(epoch)) if epoch else '-'


def section(title, content):
    return f'<section><h2>{e(title)}</h2><div class="card">{content}</div></section>' if content else ''


PANEL_HINT = '看谁在做什么、给某个 AI 发消息：打开 sideby 面板的「会话」页'


def render_sections(view, board_file=None, reports=None):
    run = view['run']
    board_file = board_file or b.board_path(run.get('_dir') or os.getcwd())
    active = [l for l in view['lanes'] if l['state'] in b.ACTIVE_LANE_STATES]
    finished = [l for l in view['lanes'] if l['state'] not in b.ACTIVE_LANE_STATES]
    needs = len(view['open_asks']) + sum(l['state'] == 'needs-you' for l in active)
    known = [l for l in view['lanes'] if isinstance(l.get('cost'), (float, int))]
    unknown = [l for l in view['lanes'] if l not in known]
    excluded = '，不含 Codex 花费' if any(str(l.get('account', '')).startswith('codex') for l in unknown) else ''
    created = b.parse_iso(run.get('created_at'))
    closed = run.get('state') == 'closed'
    header = f'<div class="eyebrow">AI 分工进度汇报</div><h1>{e(run["objective"])}</h1>'
    if shutil.which('sideby'):
        header += f'<p class="panel-hint">{e(PANEL_HINT)}</p>'
    working = sum(l['state'] == 'working' for l in active)
    queued = sum(l['state'] == 'queued' for l in active)
    waiting = len(view['running_waits'])
    asking = sum(l['state'] == 'needs-you' for l in active)
    busy_sub = ' · '.join(p for p in (f'{asking} 个等你回答' if asking else '', f'{queued} 个排队' if queued else '', f'{waiting} 项外部等待' if waiting else '') if p) or '没有排队或外部等待'
    cost_title = f'已统计 {len(known)}/{len(view["lanes"])} 个任务的花费{excluded}' if known else '还没有任务报告花费'
    total = f'${sum(l["cost"] for l in known):.2f}'
    cost_sub = (f'已知花费 {total}' + (f'（另有 {len(unknown)} 个任务没有报价）' if unknown else '')) if known else '花费未知'
    if closed:
        ended = b.parse_iso(run.get('updated_at')) or created
        when = ('用时 ' + b.plain_age(max(0, ended - created))) if created and ended else '已结束'
    else:
        when = '开始于 ' + clock(created)
    tiles = [('需要你吗', e(f'{needs} 件事等你' if needs else '不用管'), '往下看问题，回主对话答复' if needs else 'AI 自己推进，有事会喊你', '', 'you' if not needs else 'ask'),
             ('在做', e(f'{working} 个任务'), busy_sub, '', ''),
             ('时间 · 花费', e(when), cost_sub, cost_title, '')]
    hero = '<div class="hero">'
    for label, value, sub, title, tone in tiles:
        hero += f'<div class="tile {tone}"><div class="k">{e(label)}</div><div class="v num">{value}</div><div class="s" title="{e(title or sub)}">{e(sub)}</div></div>'
    hero += '</div>'
    if run.get('state') == 'closed':
        hero += '<p>本次任务已结束</p>'
    if view.get('paused'):
        hero += '<p class="flag">已叫停：不再派新活，主控 AI 正在挨个停下手里在做的任务。</p>'
    asks = ''
    for ask in view['open_asks']:
        asks += f'<div class="row ask" id="ask-{e(ask["id"])}"><strong>{e(ask["id"])} {e(ask["question"])}</strong><div>AI 建议：{e(ask["recommend"])}</div><details class="ask-evidence" id="ask-evidence-{e(ask["id"])}"><summary><span class="evidence-preview">理由：{e(ask["evidence"])}</span><span class="evidence-expand">展开</span><span class="evidence-collapse">收起</span></summary></details><div class="meta">影响：{e(ask["blocks"])}</div>'
        if ask.get('outward'):
            asks += f'<div>发给：{e(ask.get("recipient", ""))}（{e(ask.get("channel", ""))}）</div><pre>{e(ask.get("draft", ""))}</pre>'
        asks += f'<div class="ask-action">{b.copy_button("复制推荐答复", ask["id"] + "：按推荐办")}<span class="meta">复制后粘贴回主控 AI 的对话；想改主意直接在对话里说</span></div></div>'
    steps = ''
    for index, step in enumerate(run.get('steps', []), 1):
        state = {'queued':'待开始', 'working':'进行中', 'done':'完成', 'blocked':'受阻'}.get(step.get('state'), '未知')
        steps += f'<div class="step"><span class="badge {"b-ok" if step.get("state") == "done" else "b-run"}">{"✓" if step.get("state") == "done" else index}</span><div><div class="t">{e(step_title(index, step.get("title", "")))}</div><div class="d">{e(step.get("note", ""))}</div></div><span class="when">{state}</span></div>'

    def lane_row(lane):
        state = lane['state']
        name = b.lane_name(dict(lane, account='', role=''))
        ended = state not in b.ACTIVE_LANE_STATES
        summary = b.lane_summary(run, lane)
        if ended:
            label, doing = '做出了什么', b.first_sentence(summary) if summary else (lane.get('note') or b.STATE_LABELS.get(state, state))
        else:
            label = '正在做'
            doing = lane.get('note') or ('等：' + '、'.join(lane['waiting_on']) if lane['waiting_on'] else ('排队中' if state == 'queued' else 'AI 正在干活，详情里有每一步进展'))
        doing = b.short(str(doing).splitlines()[0] if str(doing).strip() else '', 180) if not ended else doing
        raw = f'<dt>正在做</dt><dd>{e(lane["activity"])}</dd>' if lane.get('activity') and lane['activity'] != '-' else ''
        for key_label, key in [('编号', 'id'), ('账号', 'account'), ('账号额度', 'pool'), ('分支', 'branch'), ('工作目录', 'worktree'), ('对话编号', 'session'), ('会话', 'session_label')]:
            if not lane.get(key) or (key == 'pool' and lane[key] == lane.get('account')) or (key == 'session' and lane.get('session_label')):
                continue  # the same value twice, or a raw id beside its readable label, adds nothing
            raw += f'<dt>{key_label}</dt><dd><code>{e(lane[key])}</code></dd>'
        raw += f'<dt>尝试</dt><dd>第 {lane["round"]} 次（最多 3 次）</dd>'
        if lane.get('tokens'):
            raw += f'<dt>用量</dt><dd>输入 {tokens(lane["tokens"]["input"])} · 输出 {tokens(lane["tokens"]["output"])} tokens</dd>'
        if lane['subagents']:
            raw += f'<dt>拆出的小任务</dt><dd>{len(lane["subagents"])} 个</dd>'
        href = report_href(lane, reports) if b.has_full_report(run, lane) else None
        if ended:
            meta = ['用时 ' + e(b.plain_age(lane['elapsed']))]
        else:
            meta = [('排队自 ' if state == 'queued' else '开始于 ') + e(clock(b.parse_iso(lane.get('started_at'))))]
        if lane.get('cost') is not None:
            meta.append(e(f'${lane["cost"]:.2f}'))
        link = f'<a class="report-link" href="{e(href)}">查看完整报告<span aria-hidden="true"> ↗</span></a>' if href else ''
        row = (f'<div class="lane" id="lane-{e(lane["id"])}"><div class="lane-head"><div class="what">{e(name)}</div>'
               f'<span class="pill {e(state)}">{e(b.STATE_LABELS.get(state, state))}</span></div>'
               f'<div class="now"><span class="now-label">{label}</span>{e(doing)}</div>'
               f'<div class="meta num"><span>{" · ".join(meta)}</span>{link}</div>')
        for flag in lane['flags']:
            if flag != lane.get('stale_flag'):  # silence is live state: the Panel shows it, a report would freeze it
                row += f'<div class="flag">{e(flag)}</div>'
        produced_detail = b.lane_produced(run, lane, board_file)
        row += (f'<details class="lane-details" id="details-{e(lane["id"])}"><summary><span class="chev" aria-hidden="true"></span>'
                f'<span class="summary-open">详情</span><span class="summary-close">收起详情</span></summary>'
                f'<div class="details-body">{produced_detail}<div class="more technical"><h3>技术细节</h3><dl class="facts">{raw}</dl></div>'
                f'</div></details></div>')
        return row

    produced = ''
    for lane in finished:  # a Lane still being reworked has not produced its result yet
        summary = b.lane_summary(run, lane)
        if summary.strip():
            href = report_href(lane, reports) if b.has_full_report(run, lane) else None
            link = f'<a class="report-link" href="{e(href)}">查看完整报告<span aria-hidden="true"> ↗</span></a>' if href else ''
            evidence = str(lane.get('evidence') or '').strip()
            evidence_line = f'<div class="evidence-line" title="{e(evidence)}">{e(evidence.splitlines()[0])}</div>' if evidence else ''
            produced += (f'<div class="out"><span class="ic" aria-hidden="true">✓</span><div><div class="out-title">{e(lane.get("title") or lane["id"])}</div>'
                         f'<div class="t">{e(b.first_sentence(summary))}</div>{evidence_line}{link}</div></div>')
    for artifact in run.get('artifacts', []):
        if not str(artifact.get('path') or '').strip():
            continue
        path = b.resolve(run, artifact['path'])
        label = e(str(artifact.get('label') or '').strip() or os.path.basename(path))
        if os.path.isfile(path):
            relative = os.path.relpath(os.path.abspath(path), os.path.dirname(os.path.abspath(board_file)))
            url = quote(relative.replace(os.sep, '/'), safe='/')
            title = f'<a href="{e(url)}">{label}</a>'
            evidence_line = ''
        else:
            title = label
            evidence_line = '<div class="evidence-line">文件已被移走或删除</div>'
        produced += f'<div class="out"><span class="ic file" aria-hidden="true">↗</span><div><div class="t">{title}</div>{evidence_line}</div></div>'
    commits = ''
    for commit in run.get('commits', []):
        subject = str(commit.get('subject') or '').strip()
        repo = str(commit.get('repo') or '').strip()
        # the repository's name reads better than a local absolute path; the full path stays in the tooltip
        metadata = ' · '.join(x for x in (os.path.basename(repo.rstrip('/\\')), str(commit.get('hash') or '').strip()) if x)
        if subject or metadata:
            commits += f'<li>{e(subject)}<div><code title="{e(repo)}">{e(metadata)}</code></div></li>'
    if commits:
        produced += f'<div class="commit-list"><h3>已提交</h3><ul>{commits}</ul></div>'
    decisions = ''
    for i, row in enumerate(run.get('decisions', [])):  # decisions only append, so the index stays a stable id
        decisions += f'<div class="dec"><span>◆</span><div>{e(row.get("what", ""))}：{e(row.get("choice", ""))}<div class="d">因为：{e(row.get("why", ""))}</div>{f'<details id="decision-{i}"><summary>没选的方案</summary><pre>{e(row.get("options", ""))}</pre></details>' if str(row.get("options") or "").strip() else ""}</div></div>'
    if decisions:
        decisions = '<div class="row meta">AI 按常规替你拿了主意。有不同想法，可在页尾复制进度回主对话说明。</div>' + decisions
    waits = ''.join(f'<div class="row">{e(w.get("title") or w["id"])} · 正在做<div class="meta">{e(w.get("stage") or "等待外部结果")}</div><details id="wait-{e(w["id"])}"><summary>查看运行日志（主人不用看）</summary><pre>{e(w.get("last_line") or "")}\n{e(w.get("log") or "")}</pre></details></div>' for w in view['running_waits'])
    grants = ''.join(f'<div class="row">{e(g.get("scope", ""))}<div class="meta">你的原话：{e(g.get("words", ""))} · {"本次任务" if g.get("outward") else "直到撤回"}</div></div>' for g in run.get('grants', []))
    # No credentials, private server URL, or raw commands in the progress copy.
    progress = [run['objective'], '进度：']
    progress += [f'{s.get("title", "")}：{s.get("state", "")} {s.get("note", "")}' for s in run.get('steps', [])]
    progress += [f'{l.get("title") or l["id"]}：{b.STATE_LABELS.get(l["state"], l["state"])}；{b.first_sentence(b.lane_summary(run, l)) or l.get("note") or "尚无成果"}' for l in view['lanes']]
    progress += [f'{a["id"]} {a["question"]}；AI 建议：{a["recommend"]}' for a in view['open_asks']]
    progress += [f'替你定了：{d.get("choice", "")}；因为：{d.get("why", "")}' for d in run.get('decisions', [])]
    progress += ['数据时间：' + str(run.get('updated_at') or run.get('created_at') or '')]  # the ledger's change, not the render
    footer = b.copy_button('复制本次进度给 AI', '\n'.join(progress))
    footer += '<p>这页是阶段汇报，有新内容时会自己换上，不用手动刷新。想追问或改主意，直接回主对话说（如「A1 按推荐」）；说「停」，主控 AI 会叫停所有任务。</p>'
    footer += f'<details id="run-technical"><summary>查看任务编号（主人不用看）</summary>Run id：{e(run["id"])}'
    if view.get('archive'):
        footer += f'<div>历史记录已存到 {e(view["archive"])}</div>'
    footer += '</details>'
    return dict(header=header, hero=hero, asks=section('等你回答', asks), steps=section('进度', steps),
                active=section('现在在做', ''.join(map(lane_row, active))), waits=section('外部等待', waits),
                produced=section('已经做出来的', produced), decisions=section('AI 替你拿的主意', decisions),
                finished=(f'<section><details id="finished-all" class="card"><summary><span class="chev" aria-hidden="true"></span>已做完收起的任务（{len(finished)} 个）</summary>{"".join(map(lane_row, finished))}</details></section>' if finished else ''),
                grants=section('长期授权', grants), footer=f'<div class="foot">{footer}</div>')


def page_head(title):
    page = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    # Hides unrendered Markdown for the first frame only when JavaScript will render it: no reflow flash.
    page += '<script>document.documentElement.classList.add("js")</script>'
    return page + f'<title>{e(title)}</title><style>{asset("board.css")}</style></head>'


def page_scripts(*names):
    return ''.join(f'<script>{asset(name)}</script>' for name in (MARKDOWN_IT, 'board_markdown.js', *names))


def render_page(view, board_file=None, reports=None):
    """The change time is a placeholder that write_if_changed fills after fingerprinting."""
    sections = render_sections(view, board_file, reports)
    page = page_head('AI 分工进度汇报') + '<body><main>'
    page += f'<header class="top"><div id="section-header">{sections.pop("header")}</div>'
    page += f'<div class="fresh" title="内容最后变化的时间"><span class="dot" aria-hidden="true"></span>{b.CHANGED_CLOCK} 更新</div></header>'
    page += ''.join(f'<div id="section-{key}">{value}</div>' for key, value in sections.items())
    page += '</main>' + page_scripts('board_interaction.js') + '</body></html>'
    return page


def render_report_page(run, lane, back):
    """A Worker's full report on its own page, rendered as sanitized Markdown."""
    title = str(lane.get('title') or lane['id'])
    state = b.STATE_LABELS.get(lane.get('state'), lane.get('state') or '')
    page = page_head(f'{title} · 完整报告')
    page += '<body class="report-page"><main>'
    page += f'<a class="back" href="{e(back)}">← 回到看板</a>'
    round_no = lane.get('round') or 1
    page += f'<header class="report-head"><div class="eyebrow">完整报告 · 第 {e(round_no)} 轮 · {e(state)}</div><h1>{e(title)}</h1>'
    first = b.first_sentence(b.lane_summary(run, lane))
    if first:
        page += f'<p class="lead">{e(first)}</p>'
    page += f'</header><article class="card report md" data-md>{e(b.report_text(run, lane).strip())}</article></main>'
    return page + page_scripts() + '</body></html>'
