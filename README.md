# pi-super

装上之后，你只和当前这个 Pi 会话说话。它是 Router：接活、派工、在卡住时问一个具体问题、把值得看的结果说给你。改代码的是隔离的 worker 子进程。你不用盯着它们，也不用给它们发消息。

After install, you only talk to the current Pi session. That session is the Router: it admits work, assigns it, and asks one concrete question when blocked. The result you read is the worker receipt, not a paraphrase. Isolated worker processes do the coding. You do not talk to them.

## 它做什么 / What it does

- **Router。** 主会话不再自己改代码。`edit`、`write`、`bash` 从主会话拿掉。你提出要做的事，Router 用 `super_eval` 接单，然后停下来。
- **Workers。** 编码工单按 scout → planner → worker → reviewer 跑一轮。审查工单只跑 reviewer。仓库问题只跑只读 scout。它们是 `pi` 子进程，不加载扩展，没有回到你这里的通道。
- **账本。** 工单状态是 admit → dispatch → running，然后落到 ready、ask、later 或 failed。子事件、跳数熔断和只追加的事实日志都在会话里。
- **自动循环。** 能跑的工单自己跑完。交付的那段话就是回执原文，主模型不会再改写，所以它加不进回执里没有的检查。
- **复查打回。** reviewer 对照授权里的每一条验收条件。对不上就 `progress`，worker 再改，reviewer 再查。
- **一个问题。** 需要人的时候只问一个，标题、正文和选项都来自那张回执。你直接回答，或用 `/super answer`。

不包含常驻云进程、飞书或 GitHub 触发器。那些是参考系统的部署方式，Pi 扩展接口做不到。对照见 [DESIGN.md](DESIGN.md)。

## 安装 / Install

需要 Node.js 22.19 或更新，以及已经能登录模型的 [Pi](https://github.com/earendil-works/pi)。

```bash
pi install npm:pi-super
# 或从 git：
pi install git:github.com/Arcobalneo/pi-super
# 本地目录：
pi install /absolute/path/to/pi-super
```

不写入配置、试一次：

```bash
pi -e /absolute/path/to/pi-super
```

`pi -e ./extensions/index.ts` 只加载扩展。技能和提示词要随目录安装，或自行传入 `--skill` 与 `--prompt-template`。

会话里：

```text
/skill:pi-super
把 greet 改成返回 Hello, <name>!
/super
```

`--super-off` 退出 Router，这个会话恢复成普通编码代理。`--super-plan` 只读，只记账，不派工。

## 用法 / Usage

1. 直接说要做的事。Router 接单并确认一句。
2. 循环跑完 workers。你不需要调用 `super_dispatch`。
3. 做完了，Router 用几句话交付。失败就说失败。
4. 若必须拍板，它只问一个问题。回答那一句，或 `/super answer <id> <n>`。循环接着跑。

Workers 使用 `--no-extensions`，所以全局安装的 pi-super 不会在子进程里再派工。它们也不加载技能和提示词模板。项目受信任时仍会读 `AGENTS.md`。

## 命令 / Commands

| Command | 作用 |
| --- | --- |
| `/super` | 状态：开着的工单、熔断、谁在等你 |
| `/super plan` | 只读计划模式 |
| `/super loop` | 开关 Router 循环。打开时熔断清零，并恢复或去掉编码工具 |
| `/super run [id]` | 手动跑一轮。写了 id 时，这一次可以越过跳数上限 |
| `/super answer <id> <n\|text>` | 回答工单上的问题 |
| `/super stop <id>` | 撤回这张工单的授权 |
| `/super why [id]` | 从事实日志里看这张工单为什么是现在这样 |

Router 工具：`super_eval`、`super_answer`、`super_report`、`super_status`。`super_dispatch` 仍在，但循环开着时主模型看不到它。

## 规则 / Rules

缺文件就用默认值。用户文件是 `~/.pi/agent/super/rules.json`。项目文件是仓库里最近的 `.pi/super/rules.json`。文件写坏时，上一份有效规则继续生效，并在状态里报错。

```json
{
  "hopLimit": 8,
  "stepTimeoutMinutes": 30,
  "parallel": 4,
  "tell": "needed",
  "acceptInferred": true,
  "askFirst": ["rm -rf", "git push --force", "git push -f", "git reset --hard", "drop table", "delete data", "spend money", "external message"]
}
```

`stepTimeoutMinutes` 是每个角色每轮的截止时间（0.25–240）。超时或崩溃会在同一 session 里重派一次。

一轮流水线只计 1 跳。提问和 later 不清零。`/super run <id>` 可以越过这一次上限。

`tell`：`needed` 只在有结果、失败或问题时叫醒主模型，`always` 连进展一起提示，`never` 不叫醒主模型。等人的问题仍留在编辑器上方。

`acceptInferred: false` 时，子进程抛出的后续事件只记账，不建工单。

事件正文和回执里的 `summary` 放进 DATA。它们是资料，不是指令。

## 设计参考 / Design references

pi-super 的架构直接参考以下原帖和三个仓库。这里写明每一部分出自哪里；每一行写明了对应的文件。

- 原帖：[DeepSeek Harness — superagent 设计](https://x.com/DeepSeekHarness/status/2116857257245987236)
- [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)
- [KKKKhazix/agent-autoloop](https://github.com/KKKKhazix/agent-autoloop)
- [MYCF711/dsh-session-superagent](https://github.com/MYCF711/dsh-session-superagent)

| pi-super 的部分 | 来源 |
|---|---|
| 两层结构：Router 只分发、不执行；worker 隔离、不与人对话 | 原帖；prototype `src/core/evals.ts`（main Session 只做决策） |
| 不改写请求：ticket 原样保存原话 `inputs`，worker 从原话推导需求，Router 只写 note | 原帖"不改写"；prototype `Ticket.inputs` / `src/executor/dsh.ts` |
| 路由决策 accept / attach / stop / ignore | prototype `src/core/evals.ts` `decide` / `decideEval` |
| 报告状态 ready / progress / blocked / failed / dropped；blocked、failed 时停下等人（含 lane 中途的 scout/planner） | prototype `src/core/stage.ts`、`src/core/model.ts` `waitsForPerson` |
| 每个 ticket、每个角色一个持久 session | prototype 每张工单一个 Executor Session；autoloop "续做接原会话" |
| 回执写错只重写回执、不重做业务 | autoloop `docs/protocol.md`（"回执写错不重做业务"） |
| ask 带 `key` / `recommend` / `about`，同 key 不重复问，已决定的回填 | autoloop `docs/protocol.md`（`ask` 的 `key` 范围） |
| hop 上限默认 8 | autoloop 的 hop TTL |
| grounded ready：必须给 `checks` 和 `changed`，kernel 重跑；拒绝不可能失败的检查 | session-superagent `docs/kb/acceptance-criteria.md`（完成标准可观测）、`gate-mutation-check.md`、`found-problem-but-exit-zero.md`，以及"交付 ≠ 行动" |
| 入口问题只出现一次，Router 不自写追问 | 原帖"不复述"；prototype 由 worker 提出 human_action、Router 原样转达 |
| `after` 依赖、`super_recall` 回看历史 ticket | 原帖 Chain of Recall；prototype ticket 关联 |
| 崩溃、非零退出或超时的一轮，在同一 session 里自动重派一次；第二次仍失败则报 failed，并提示 `/super run <id>` | autoloop `kernel/decide.ts` `retryLater`；prototype `src/core/tickets.ts` `retry` / `src/core/stage.ts` `canRetry` |
| 每个角色每轮有截止时间 `stepTimeoutMinutes`（默认 30） | autoloop `worker/worker.ts` `TIMEOUT_MINUTES` |
| 没跑成的一轮只能留通知，丢弃 ask 和 events | autoloop `kernel/decide.ts` `retryLater`（"没跑成的一轮只能发通知"） |
| 回执最多重写两次 | autoloop `docs/protocol.md`（"最多两次"） |
| 只追加的事实账本，重启后重放；进程死掉时还标着 running 的 assignment 会被收回、重跑 | autoloop `docs/protocol.md`"结构与预算"、`kernel/decide.ts` `RUN_LEASE` |
| `/super status` 显示每个 ticket 的运行次数、tokens、花费；等人的 ticket 显示原因 | autoloop `docs/protocol.md` `usage`；session-superagent `docs/kb/status-text-shows-exceptions.md` |

没有采用的部分：
- 多通道接入、云端隔离、全双工语音：属于部署层，不在 pi 扩展的范围内。
- 独立 Watchdog 进程、心跳租约：pi 是单进程会话，用每步截止时间加重启后收回代替。
- 指数退避重试：交互式会话里人在等，只立即重派一次。
- 上下文压缩：由 pi 宿主的 session 机制负责。
- 按 thread 把追问分给 worker（prototype `workerDecides`）：pi 只有一条主线程。
- Router 是否 stop、是否保持 blocked：参考仓库同样只要求明确的人工指令，这属于模型判断。

## 开发 / Develop

```bash
npm install
npm run check
```

`npm run check` 做类型检查、单元测试，并用当前安装的 `pi --help` 确认扩展能被加载、`--super`、`--super-plan` 和 `--super-off` 已注册。`.npmrc` 打开 `legacy-peer-deps`，因为 npm 10 在 `peerDependencies: "*"` 上会崩溃。

Host packages (`@earendil-works/pi-*`, `typebox`) are `peerDependencies` with `"*"`. They are also `devDependencies` so this repo can typecheck. Do not move them to `dependencies`.

真实模型验收见 [ACCEPTANCE.md](ACCEPTANCE.md)。`scripts/accept.mjs` 跑 v0.3 的五个场景（ask-first、多文件重构、写作任务、拆分多 ticket、应 blocked 的任务），`ACCEPT_ONLY=ask,blocked` 只跑其中几个。脚本不包含密钥：

```bash
KIMI_KEY_FILE=/path/to/key.txt node scripts/accept.mjs
```

## 发布 / Release

v0.2.0 的目标是 GitHub Release，不是 npm。可粘贴的说明在 [CHANGELOG.md](CHANGELOG.md) 的 `GitHub Release v0.2.0` 一节。打 tag 和发 Release 在合并之后由人来做。

`.github/workflows/ci.yml` 在 pull request 和 `main` 上跑 `npm run check`。`.github/workflows/release.yml` 在 `vX.Y.Z` tag 或已发布的 Release 上跑同样的检查。没有 `NPM_TOKEN` 时它跳过 `npm publish`，这一步不会让工作流失败。

Install from git until npm publish is turned on:

```bash
pi install git:github.com/Arcobalneo/pi-super
```

## 许可 / License

[MIT](LICENSE). 本包独立于 [agent-autoloop](https://github.com/KKKKhazix/agent-autoloop) 与 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)，不代表它们的作者或 DeepSeek。
