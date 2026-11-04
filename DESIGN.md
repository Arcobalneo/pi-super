# pi-super 设计说明 / Design note

主会话是编排者，工单是授权过的工作，子进程是执行者。人的注意力只花在必须拍板的地方。下面是从两个参考仓库里实际采纳的行为，以及它们在当前 Pi 扩展接口上的落点。

The main session is the orchestrator, a ticket is authorized work, and a subprocess is the executor. Human attention is spent only on a decision. This note maps behavior that is actually in the two reference repos onto the current Pi extension API.

Studied at:

- Pi monorepo [`676af1d`](https://github.com/earendil-works/pi/commit/676af1d777ef6f04b6bc8daf4cf3b9b1799cff4d) (`badlogic/pi-mono` redirects here). Package `@earendil-works/pi-coding-agent@1.5.0`. Docs: [extensions](https://pi.dev/docs/latest/extensions), [packages](https://pi.dev/docs/latest/packages), [skills](https://pi.dev/docs/latest/skills).
- [agent-autoloop `cecec75`](https://github.com/KKKKhazix/agent-autoloop/commit/cecec75be3ca26e6ca1d6833b50152ee9450088d)
- [dsh-superagent-prototype `8c32a9d`](https://github.com/deepseek-ai/dsh-superagent-prototype/commit/8c32a9dc5d72c033816c6a8110b37f40cf94fba4)

## 对照 / Mapping

| Reference behavior | Where it lives in pi-super |
| --- | --- |
| Autoloop: one round claims work, returns a receipt, then exits | `super_dispatch` runs `pi --mode json --print --no-session` and reads the last `pi-super` fence. A bad fence keeps the prose and drops the receipt. |
| Autoloop: ask / notice / later / events | `extensions/receipt.ts`. `ask` blocks the ticket. `later` is stored on the ticket and shown by `/super`, not scheduled. `events` become child tickets. `failed` keeps only `notice`. |
| Autoloop: rules choose the agent, directory, and permissions; event text does not | `.pi/super/rules.json` plus the agent markdown. The task's DATA section is labeled untrusted. `cwd` is the Pi session cwd. |
| Autoloop: hop fuse, default 8, not reset by a question | Ticket `hops` increment on every subprocess. `/super answer` does not reset them. `/super run <id>` is the explicit one-shot override. |
| Autoloop: quiet unless a person must act | `tell: needed`. The widget lists only `person/answer` and `person/blocked`. |
| Autoloop: invalid rules stay on the last good file | `SuperRuntime.reloadRules` keeps the last valid user file and the last valid project file. |
| Autoloop: append-only facts | `pi.appendEntry("pi-super", fact)`, replayed with `sessionManager.getBranch()` so an abandoned branch is not the current ledger. |
| dsh: eval then ticket, mandate, assignment, report | `super_eval` records accept / stop / ignore. Accept stores scope, strength, and `policyVersion`. Reports are `progress`, `waiting`, `ready`, `blocked`, `failed`, `dropped`. |
| dsh: `ready` finishes work that has nothing left to watch; `ask` is the structured question | `ready` and `dropped` end the ticket. An `ask` forces `blocked` and waits. There is no separate "awaiting review" stage. |
| dsh: inferred work can be record-only | `acceptInferred: false`. |
| dsh: orchestrator speaks when a result or a question is ready, and stays quiet during progress | With the loop armed, `agent_before_settle` drains runnable tickets. It requests one more model turn only to summarize a result or ask the question. |
| dsh: one question, then stop | Dispatch will not run a ticket that already has an attention. |
| Official Pi `plan-mode` example | `/super plan`, `--super-plan`, write tools removed, bash allowlist, `[plan recorded]` chooser. |
| Official Pi `subagent` example | `extensions/runner.ts`: subprocess, JSONL `message_end`, parallel pool, `{previous}` chain, project agents confirmed when the project is not trusted. Agents are markdown with frontmatter. |
| Official Pi package layout | `package.json` `pi` manifest, `keywords: ["pi-package"]`, `extensions/`, `skills/pi-super/SKILL.md`, `prompts/*.md`, `CHANGELOG.md`. |

## 没有照搬的部分 / Not adopted

- Autoloop 的 HTTP 内核、来源、通道、飞书卡片、cron、交付流水线。Pi 会话本身就是循环，没有单独的中台进程。
- dsh 的 Source、Thread、Subscription、GitHub/飞书、SQLite、网页面板、多账号授权。这里的人就是坐在终端前的操作者。
- 子进程不恢复上一次 worker 会话（官方 subagent 示例使用 `--no-session`）。上一份报告写进下一次任务。
- `later` 不注册定时器。扩展工厂不能启动后台定时器；会话里的定时器又会占着进程，和「等人时零消耗」相反。

## 和规范不一致或没写清的地方 / Spec ambiguities

1. **仓库位置。** 规范现在的仓库是 <https://github.com/earendil-works/pi>。`badlogic/pi-mono` 返回 301。包名是 `@earendil-works/*`；文档说旧的 `@mariozechner/*` 和 `@sinclair/typebox` 仍会映射，新代码不使用它们。`Type` 从 `typebox` 导入。
2. **peer 与本地类型检查。** 宿主包必须放在 `peerDependencies: "*"`，不能放进 `dependencies`。文档没有说作者自己的 `npm test` 该怎么装它们。这里把同一批包放进 `devDependencies`，`pi install` 不会安装 devDependencies。
3. **`pi` 清单是整表替换。** `package-manager.ts` 里，只要 `pi` 写了任意一种资源，其余资源就不再按目录自动发现。所以清单同时写了 `extensions`、`skills` 和 `prompts`。
4. **没有 agent 资源类型。** 官方 subagent 示例从 `~/.pi/agent/agents` 和 `.pi/agents` 读 markdown，包清单不能声明 agents。捆绑的 `agents/*.md` 由扩展自己用 `import.meta.url` 定位。`trusted` 范围是捆绑加用户；项目 agent 要 `agentScope: "all"` 或 `"project"`，且未信任时要确认。
5. **状态回放用哪份日志。** 状态管理一节说用 `getBranch()`，plan-mode 示例用 `getEntries()`。分支上的放弃历史不该算当前工单，所以这里用 `getBranch()`。
6. **`continue: true` 会再次进入结算。** 文档明确说无条件继续会空转。自动循环在 `agent_before_settle` 里把能跑的工单跑完，只在需要一句总结或一个问题时再继续一轮，并用会话熔断封顶。
7. **子进程要不要带上用户的扩展。** 官方示例没有加 `--no-extensions`。全局安装的 pi-super 若被 worker 再次加载，会自己派自己。这里加上 `--no-extensions`、`--no-skills`、`--no-prompt-templates`。信任的项目仍用 `--approve`，否则 `--no-approve`，避免子进程卡在信任提示。
8. **`tell: never` 和面板。** Pi 没有第二块「只显示等人事项」的面板，只有 `setWidget`。`never` 关掉 toast，但问题仍显示在 widget 里，否则 `/super answer` 没有入口。
9. **`ready` 是否还要等人复查。** dsh 把 `ready` 留在 person/review。这里没有 PR 线程可等，`ready` 直接结束工单，避免每张工单都停在「请复查」。要等人就用 `ask`。
10. **工具参数的 `Type.Refine` 不会执行。** 文档如此。工单字段在 `execute` 里截断和检查。
11. **帮助命令会加载扩展。** CLI 文档说 `--help` 会列出已加载扩展注册的 flag。工厂里只注册工具和命令，不启动子进程。`tests/load.test.ts` 用 `pi --no-extensions -e ./extensions/index.ts --help` 验证这件事。
12. **`npm install` 与 `peerDependencies: "*"`。** npm 10.9 的 arborist 在解析这种 peer 时会抛出 `edgesOut`。仓库里的 `.npmrc` 打开 `legacy-peer-deps`，作者本机可以安装；`pi install` 本来也不会自动安装这些 peer。
