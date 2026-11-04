# pi-super 设计说明 / Design note

主会话是 Router。人只和它说话。工单是授权过的工作，worker 是隔离的 `pi` 子进程。人的注意力只花在必须拍板或值得收下的结果上。

The main Pi session is the Router. The person talks only to it. A ticket is authorized work, and a worker is an isolated `pi` subprocess. Human attention is spent on a decision or a result worth having.

Studied at:

- Super-agent article: [Exploring DeepSeek Super-agent Design](https://offloop.org/learn/exploring-deepseek-super-agent-design) (DeepSeek Harness team).
- [dsh-superagent-prototype `8c32a9d`](https://github.com/deepseek-ai/dsh-superagent-prototype/commit/8c32a9dc5d72c033816c6a8110b37f40cf94fba4), docs `000`–`007` and `prompts/orchestrator.md`, `prompts/admission.md`, `prompts/worker.md`.
- [agent-autoloop `cecec75`](https://github.com/KKKKhazix/agent-autoloop/commit/cecec75be3ca26e6ca1d6833b50152ee9450088d), README, `docs/protocol.md`, `docs/plugins.md`.
- Pi `@earendil-works/pi-coding-agent@1.5.0`. Extension types in `dist/core/extensions/types.d.ts`. Examples: `examples/extensions/subagent`, `examples/extensions/plan-mode`. Docs: [extensions](https://pi.dev/docs/latest/extensions), [packages](https://pi.dev/docs/latest/packages).
- Packaging shape from [pi-subagents](https://github.com/tintinweb/pi-subagents): `keywords` includes `pi-package`, `pi.extensions`, changelog, `publishConfig.access: public`.

## 对照 / Mapping

| Reference | Where it lives in pi-super |
| --- | --- |
| Article §2 two layers. Router keeps continuity and does not execute. Workers are isolated and do not talk to the person. | Session start arms the loop unless `--super-off` or a saved loop-off fact. `routerTools` removes `edit`, `write`, `bash`, and `super_dispatch`. `tool_call` blocks them if they reappear. `ROUTER_CONTRACT` is appended in `before_agent_start`. |
| Article §2.1 Router only interacts, admits, assigns, and summarizes. | `super_eval` admits. The kernel, not the model, runs the lane. A delivery turn is one `[pi-super delivery]` message: summarize or ask, do not call tools. |
| Article §2.2 Workers report upward. No direct human channel. | scout / planner / worker / reviewer are subprocesses (`--mode json --print --no-session --no-extensions`). Their prose is not shown to the person. The Router speaks the receipt summary. |
| Article §3 triggers, fast path, subscription. | The person's message is the only trigger Pi can see. There is no GitHub or Feishu source. Follow-up on an open question is `super_answer`, which resumes that ticket without a new admit. Child `events` in a receipt become inferred tickets when `acceptInferred` is on. |
| Article §4 one question, speak only when a person must act or can use a result. Honest reporting. | `groundedSpeech` copies the receipt summary, or the one ask title, text, and options. It does not send that text back through the model, so the summary cannot add a check the receipt did not name. `progress` is not shown. The widget shows the oldest question and failures. |
| Article §4 full-duplex `start()` so the Router is not blocked. | Not available. Pi tool calls and `agent_before_settle` run in the session process. The loop drains workers before the turn settles, then wakes the Router once. Documented below. |
| dsh philosophy, docs/000. Act only when asked. One concrete question. Honest reporting. | `super_eval` accept / stop / ignore. `ask` blocks. `ready` means the mandate is done. `failed` stays failed. Ask-first phrases stop before any role runs. |
| dsh docs/001–003. Mandate, assignment, report, stages. | Facts in the session log. Stages: admit, dispatch, running, ready, ask, later, failed, ended. `ready` is the completed outcome. Stop and drop are `ended`. An answer to a blocked ticket returns it to dispatch and does not reset hops. |
| dsh docs/004. Router does not make technical decisions. Worker owns the change. | Lane `code` is scout → planner → worker → reviewer. `review` is the reviewer. `answer` is the scout. The Router's scope text is the mandate. Role prompts tell workers not to talk to the person. |
| dsh docs/005. Panel shows what needs a person. | `setStatus` / `setWidget`. No web panel. |
| Autoloop kernel. One round, then exit. Receipt in the last reply. | `interpretOutput` reads the last `pi-super` fence. A bad fence keeps the prose. `ask` and `later` are accepted as report names. |
| Autoloop. Rules choose the agent and permissions. Event text is data. | `.pi/super/rules.json` and the agent markdown. DATA is labeled untrusted. `cwd` is the session cwd. |
| Autoloop hop fuse, default 8, not cleared by a question or a later note. | One pipeline round increments `hops` once. `/super answer` does not reset it. `/super run <id>` is the one-shot override. |
| Autoloop. Invalid rules stay on the last good file. Append-only facts. | `SuperRuntime.reloadRules`. `pi.appendEntry("pi-super", fact)`, replayed with `sessionManager.getBranch()`. |
| Autoloop quiet delivery. | `tell: needed`. The main model is not woken for progress. |
| Official Pi subagent example. | `extensions/runner.ts`: JSONL `message_end`, pool, `{previous}` chain, project agents confirmed when the project is not trusted. |
| Official Pi plan mode. | `/super plan`, `--super-plan`, write tools removed, bash allowlist. |
| pi-subagents package layout. | `package.json` `pi` manifest, repository, `publishConfig`, `keywords` includes `pi-package`, `CHANGELOG.md`. |

## 一轮怎么走 / One turn

1. The person speaks to the main session.
2. If the Router records nothing, `agent_before_settle` injects one nudge: answer the open question, admit the work, or ignore it.
3. `super_eval` accept writes a ticket and returns. The model is told to stop.
4. On settle, the kernel drains runnable tickets up to the hop limit and `MAX_DRAIN_STEPS`. A `code` ticket runs the four roles in order. A role that asks or fails stops the round. The round counts as one hop.
5. The kernel shows one delivery built only from the receipt: the summary, or one question's title, text, and options. The model does not paraphrase it.
6. A reviewer `progress` report sends the ticket back to the worker and then the reviewer. Before `ready` is kept, the kernel runs input→output examples taken from the mandate. A quoted string elsewhere in the tree is not a pass.
7. The person answers in prose (`super_answer`) or with `/super answer`. The next settle resumes that ticket.

## 没有照搬的部分 / Not adopted

Pi's extension API is in-process and session-scoped. These reference behaviors need a host this package does not have:

- An always-on daemon, cron, or watchdog outside the session.
- Feishu, GitHub, email, or other sources and channels. The person at the terminal is the only source and the only channel.
- Subscription fan-out of external threads. A follow-up is another message in this session.
- Full-duplex `start()` / background slots that keep the Router free while workers run. Workers run during `agent_before_settle`, in this process.
- Separate compute, state, and execution environments. State is the session log. The execution environment is the session cwd.
- A web panel, SQLite store, or multi-account policy. The widget is the panel. Rules files are the policy.
- `later` does not register a timer. A later note stays on the ticket until `/super run` or a new mandate. A background timer would hold the process while waiting.

## 和规范不一致或没写清的地方 / Spec notes

1. **仓库位置。** 规范仓库是 <https://github.com/earendil-works/pi>。包名是 `@earendil-works/*`。`Type` 从 `typebox` 导入。本包对照的是已安装的 `@earendil-works/pi-coding-agent@1.5.0` 类型，不是猜的接口。
2. **peer 与本地类型检查。** 宿主包放在 `peerDependencies: "*"`，同一批也在 `devDependencies`，方便 `npm test`。`pi install` 不安装 devDependencies。
3. **`pi` 清单是整表替换。** 写了任意一种资源后，其余资源不再按目录自动发现。清单同时写了 `extensions`、`skills` 和 `prompts`。
4. **没有 agent 资源类型。** 包不能声明 agents。捆绑的 `agents/*.md` 由扩展用 `import.meta.url` 定位。
5. **状态回放用 `getBranch()`。** 放弃的分支不算当前工单。
6. **`continue: true` 会再次进入结算。** 自动循环把能跑的工单跑完，最多再叫醒主模型一次来交付，并用会话熔断封顶。进度不叫醒。
7. **子进程加 `--no-extensions`。** 避免全局 pi-super 在 worker 里再派工。信任的项目用 `--approve`，否则 `--no-approve`。
8. **`tell: never`。** 不叫醒主模型。问题仍在 widget 里，否则没法回答。
9. **`ready` 结束工单。** 这里没有 PR 线程可等。要等人就用 `ask`。
10. **工具参数的 `Type.Refine` 不会执行。** 工单字段在 `execute` 里截断和检查。
11. **`npm install` 与 `peerDependencies: "*"`。** `.npmrc` 打开 `legacy-peer-deps`。
12. **Kimi。** 已安装的 Pi 带 `kimi-coding` provider，base URL 是 `https://api.kimi.com/coding/v1`，模型 id `kimi-for-coding` 即 K2.8 Preview。验收只用进程环境变量 `KIMI_API_KEY`，不写进仓库。
