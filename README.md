# pi-super

Pi 的 superagent 扩展。主会话负责评估和派工，工单记在会话日志里，干活的是隔离的子进程。能自己做完的就做完；只有规则点名的风险，或者确实做不下去，才停下来问你。

A Pi package that turns the coding agent into a small superagent. The main session evaluates and routes work. Tickets live in the session log. Workers are isolated `pi` subprocesses. The loop finishes what it can, and stops when a person has to decide.

## 它做什么 / What it does

- **工单 / Tickets.** `super_eval` 接受、停止或忽略一件事。接受会写下授权：范围、强度、当时的规则版本。
- **派工 / Dispatch.** `super_dispatch` 用官方示例同款的 `pi --mode json` 子进程跑 scout、planner、worker、reviewer。支持单个、并行和 `{previous}` 链式步骤。
- **只在必要时问 / Ask only then.** 回执里的 `ask`，以及规则里的 ask-first 短语，会打开一个问题。循环在这里停住，不再耗模型。
- **跳数熔断 / Hop fuse.** 每跑一次子进程，工单跳数加一，默认最多 8。会话自动循环另有一道同样的熔断，`/super loop` 重新打开时清零。
- **计划模式 / Plan mode.** 只读。写完计划后由你决定要不要派工。

不包含飞书、GitHub、定时守护进程或网页面板。那些是参考项目里的部署方式，不是 Pi 扩展的接口。对照见 [DESIGN.md](DESIGN.md)。

## 安装 / Install

需要 Node.js 22.19 或更新，以及已经能登录模型的 [Pi](https://github.com/earendil-works/pi)（`@earendil-works/pi-coding-agent`）。

Install the package (extension, skill, and prompts together):

```bash
pi install /absolute/path/to/pi-super
# or, once this repo is on a git remote:
pi install git:github.com/you/pi-super
```

Try it once without saving the install:

```bash
pi -e /absolute/path/to/pi-super
```

`pi -e ./extensions/index.ts` loads only the extension file. Skills and prompts come with a directory install.

In a session:

```text
/skill:pi-super
/super-implement add a receipt parser
/super
```

Flags for one process: `--super` arms the loop, `--super-plan` starts read-only.

## 用法 / Usage

1. 说明要做的事，或运行 `/super-implement <task>`。
2. 模型调用 `super_eval` 建工单，再调用 `super_dispatch`。
3. 子进程把最后的 `pi-super` 代码块交回来。`ready` 结束工单；`ask` 停下来等你。
4. `/super answer t1 1` 选择第一个选项，会话会接着做。
5. `/super loop` 打开自动循环：结算前，内核自己把还能跑的工单派出去，只有需要你看结果或回答时才再叫一次模型。

Workers do not load Pi extensions (`--no-extensions`), so a globally installed pi-super cannot recurse. They also skip discovered skills and prompt templates. Repo instructions such as `AGENTS.md` still load when the project is trusted.

## 命令 / Commands

| Command | 作用 |
| --- | --- |
| `/super` | 状态：开着的工单、熔断、谁在等你 |
| `/super plan` | 开关只读计划模式。`Ctrl+Alt+S` 看状态 |
| `/super loop` | 开关自动循环。打开时熔断清零 |
| `/super run [id]` | 派工。写下 id 时，这一次可以越过跳数上限 |
| `/super answer <id> <n\|text>` | 回答工单上的问题 |
| `/super stop <id>` | 撤回这张工单的授权 |
| `/super why [id]` | 从事实日志里看这张工单为什么是现在这样 |

工具：`super_eval`、`super_dispatch`、`super_report`、`super_status`。

## 规则 / Rules

缺文件就用默认值。用户文件是 `~/.pi/agent/super/rules.json`。项目文件是仓库里最近的 `.pi/super/rules.json`（目录名跟着 Pi 的 `CONFIG_DIR_NAME`）。文件写坏时，上一份有效规则继续生效，并在状态里报错。

```json
{
  "hopLimit": 8,
  "parallel": 4,
  "tell": "needed",
  "acceptInferred": true,
  "askFirst": ["rm -rf", "git push --force", "git push -f", "git reset --hard", "drop table", "delete data", "spend money", "external message"]
}
```

`tell`：`needed` 只在有结果或问题时提示，`always` 连进展一起提示，`never` 不弹提示。等人的问题仍留在编辑器上方，否则没法回答。

`acceptInferred: false` 时，模型猜出来的工作和子进程抛出的后续事件只记账，不建工单。

事件正文、回执里的 `summary` 会放进任务的 DATA 段。它们是资料，不是指令。用哪个 agent、在哪个目录、给哪些工具，只由规则和 agent 定义决定。

## 开发 / Develop

```bash
npm install
npm run check
```

`npm run check` 做类型检查、单元测试，并用当前安装的 `pi --help` 确认扩展能被加载、`--super` 和 `--super-plan` 已注册。`.npmrc` 打开 `legacy-peer-deps`，因为 npm 10 在 `peerDependencies: "*"` 上会崩溃。

Host packages (`@earendil-works/pi-*`, `typebox`) are `peerDependencies` with `"*"`. They are also `devDependencies` so this repo can typecheck. Do not move them to `dependencies`.

## 许可 / License

[MIT](LICENSE). 本包独立于 [agent-autoloop](https://github.com/KKKKhazix/agent-autoloop) 与 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)，不代表它们的作者或 DeepSeek。
