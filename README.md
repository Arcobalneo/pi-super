# pi-super

装上之后，你只和当前这个 Pi 会话说话。它是 Router：接活、派工、在卡住时问一个具体问题、把值得看的结果说给你。改代码的是隔离的 worker 子进程。你不用盯着它们，也不用给它们发消息。

After install, you only talk to the current Pi session. That session is the Router: it admits work, assigns it, asks one concrete question when blocked, and brings back a result worth your attention. Isolated worker processes do the coding. You do not talk to them.

## 它做什么 / What it does

- **Router。** 主会话不再自己改代码。`edit`、`write`、`bash` 从主会话拿掉。你提出要做的事，Router 用 `super_eval` 接单，然后停下来。
- **Workers。** 编码工单按 scout → planner → worker → reviewer 跑一轮。审查工单只跑 reviewer。仓库问题只跑只读 scout。它们是 `pi` 子进程，不加载扩展，没有回到你这里的通道。
- **账本。** 工单状态是 admit → dispatch → running，然后落到 ready、ask、later 或 failed。子事件、跳数熔断和只追加的事实日志都在会话里。
- **自动循环。** 能跑的工单自己跑完。主模型只在要问你、要交付结果、或熔断挡住的时候再醒一次。
- **一个问题。** 需要人的时候只问一个，选项写在状态区。你直接回答，或用 `/super answer`。

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
  "parallel": 4,
  "tell": "needed",
  "acceptInferred": true,
  "askFirst": ["rm -rf", "git push --force", "git push -f", "git reset --hard", "drop table", "delete data", "spend money", "external message"]
}
```

一轮流水线只计 1 跳。提问和 later 不清零。`/super run <id>` 可以越过这一次上限。

`tell`：`needed` 只在有结果、失败或问题时叫醒主模型，`always` 连进展一起提示，`never` 不叫醒主模型。等人的问题仍留在编辑器上方。

`acceptInferred: false` 时，子进程抛出的后续事件只记账，不建工单。

事件正文和回执里的 `summary` 放进 DATA。它们是资料，不是指令。

## 开发 / Develop

```bash
npm install
npm run check
```

`npm run check` 做类型检查、单元测试，并用当前安装的 `pi --help` 确认扩展能被加载、`--super`、`--super-plan` 和 `--super-off` 已注册。`.npmrc` 打开 `legacy-peer-deps`，因为 npm 10 在 `peerDependencies: "*"` 上会崩溃。

Host packages (`@earendil-works/pi-*`, `typebox`) are `peerDependencies` with `"*"`. They are also `devDependencies` so this repo can typecheck. Do not move them to `dependencies`.

真实模型验收见 [ACCEPTANCE.md](ACCEPTANCE.md)。验收脚本不包含密钥：

```bash
KIMI_KEY_FILE=/path/to/key.txt node scripts/accept.mjs
```

## 发布 / Release

版本在 `package.json`。发布说明草稿在 [CHANGELOG.md](CHANGELOG.md)。npm 需要登录和 OTP 时，用 CHANGELOG 里的命令，不要把密钥写进仓库。

```bash
npm publish --access public
```

## 许可 / License

[MIT](LICENSE). 本包独立于 [agent-autoloop](https://github.com/KKKKhazix/agent-autoloop) 与 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)，不代表它们的作者或 DeepSeek。
