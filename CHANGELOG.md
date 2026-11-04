# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - unreleased

A general redesign after studying the DeepSeek Harness post and three reference implementations (dsh-superagent-prototype, agent-autoloop, dsh-session-superagent). v0.2.1 fixed one scenario with special-case rules; v0.3 replaces them with structure.

### Changed

- The person's words are the mandate. Each ticket keeps the original request and every follow-up verbatim, and workers derive requirements from them. The Router no longer writes a `scope`; it may add a 30-word routing `note` that is marked as not a requirement.
- `ready` is grounded generically. A deliverable receipt must list `checks` (commands) and `changed` (files). The kernel reruns each check and confirms each file exists and changed. A failed check sends the ticket back.
- Each ticket has one persistent session per role (`--session-dir/--session-id`). Resumed rounds continue the same conversation instead of starting cold.
- Receipts keep the whole summary. Prose fallback takes the last full paragraph, `json`-labelled blocks are accepted, and a missing receipt gets one repair turn in the same session without redoing the work.
- Agent prompts are domain-neutral: coding, refactoring, writing, and research tasks follow the same contract.

### Added

- Routing decisions `attach` (follow-up to an existing ticket, reopening it) and `stop`, beside `accept` and `ignore`.
- `after` dependencies between tickets. A ticket whose dependency failed is reported `blocked`.
- A `task` lane for non-code deliverables.
- Asks carry `recommend` and `about`. A key already decided by the person is fed back instead of asked again.
- `super_recall` reads an earlier ticket in full (chain of recall).
- An intake question is returned as the Router's reply text and is not delivered a second time.
- A `blocked` report from any lane step (scout, planner) stops the lane and waits for the person.
- Checks that cannot fail (`true`, `echo …`, `… || true`) are rejected.
- `scripts/accept.mjs` runs the five v0.3 scenarios with machine checks.
- README section citing the design references.
- A run that crashes, exits non-zero without a receipt, or passes `stepTimeoutMinutes` (default 30) is re-dispatched once in the same session. A second failure reports `failed` and names `/super run <id>`.
- After a restart, an assignment the ledger still shows as running is recovered, and the ticket runs again.
- A `failed` receipt keeps only its notice: any ask and events are dropped.
- Receipts can be rewritten up to twice.
- `/super status` shows runs, tokens, and cost per ticket, and why a waiting ticket waits.
- Acceptance scenarios `timeout` and `restart`.

### Removed

- The `constraints` parameter and the phrase-matching constraint checker. Constraints are read from the verbatim request by the worker and reviewer, and proven through checks.

## [0.2.1] - 2026-11-04

A real k2.8 run of the slugify scenario showed four gaps. The person said "ask me" and was never asked; the worker added devDependencies and moved the test; the reviewer said ready; and the Router said a question was sent after the tool refused it. This release closes them.

### Added

- `super_eval` takes `ask`. The Router can ask the one blocking question at intake. The ticket starts waiting and runs only after `super_answer`.
- `super_eval` takes `constraints` (`askFirst`, `noNewDeps`, `noCommit`, `files`). The kernel also reads "ask me / 需要你问我", "no new dependencies / 不要加依赖", and "do not commit / 不要 commit" from the person's message.
- A kernel check before `ready` on code tickets. It sends the ticket back when a dependency was added, when code imports an undeclared package, when a required file is missing, when a commit was made, when ask-first was never asked, or when nothing changed.
- Workers and reviewers see the constraints in the assignment. The reviewer checks them, runs the stated rules as calls, and uses the test runner the mandate names.

### Changed

- When the person asked to be asked first and no question was given, `super_eval` refuses with `NOT ACCEPTED`. No ticket is created.
- Once the one question is answered, a later worker question on that ticket becomes a repair pass. The person is asked at most once.
- `super_report` on a closed ticket returns an error that starts with `QUESTION NOT SENT`. The Router contract says to report that plainly.
- `scripts/accept.mjs` checks `pace` by calling it, not by matching the source text.

## [0.2.0] - 2026-11-04

The main Pi session is the Router. Workers, receipts, and the loop stay under it.

### Added

- Router mode is on after install. The main session loses `edit`, `write`, and `bash`. It admits work with `super_eval` and does not implement it.
- Lanes. `code` runs scout, planner, worker, then reviewer. `review` runs the reviewer. `answer` runs a read-only scout. One round counts as one hop.
- `super_answer` so a reply in the main session resumes the open question. `/super answer` still works and, with the loop on, resumes the ticket itself.
- Lifecycle statuses: admit, dispatch, running, ready, ask, later, failed. The widget shows the oldest question and failures.
- A delivery is shown from the receipt itself: the summary, or one question's title, text, and options. Progress stays quiet.
- Receipt names `ask` and `later`, matching the lifecycle.
- `--super-off` leaves the session as a normal coding agent.
- `scripts/accept.mjs` runs a real Pi session against `kimi-coding/kimi-for-coding` without writing the API key into the repo. Evidence is in `ACCEPTANCE.md`.

### Changed

- The loop is armed on a fresh session. `/super loop` still toggles it and resets the fuse when armed.
- `super_dispatch` stays available when the loop is off. The Router does not see it while the loop is on.
- A delivery is the worker receipt, shown as written. The Router model does not paraphrase it, so it cannot add a check, name, or command the receipt did not contain.
- A reviewer `progress` report sends the ticket back to the worker, then the reviewer checks the mandate again. `ready` is only for a review that finds every required check.

### Fixed

- The spoken summary no longer restates the person's request as if the receipt had said it. The text is `groundedSpeech`: receipt evidence, and nothing else.
- The reviewer is instructed to compare every acceptance criterion, including exact literals such as `greet("Ada")`, and to report `progress` instead of `ready` when a test asserts something else.
- A `ready` review is checked by running the mandate's input→output examples, such as `formatCents(199)` → `"$1.99"`. A mismatch sends the ticket back with the actual and expected values. A quoted string that only appears somewhere in the file is not proof. The literal scan remains a pre-check when the mandate has no runnable example.

## [0.1.0] - 2026-11-04

- Initial Pi package: ticket ledger, plan mode, ask-first gate, hop fuse, and subprocess subagents.

## GitHub Release v0.2.0

Paste the notes below into the GitHub Release named `v0.2.0`. Create the tag and the release after merge. This repo does not publish that release itself.

npm publish is deferred. `.github/workflows/release.yml` runs `npm run check` on the `v0.2.0` tag or the published release, then skips `npm publish` when `NPM_TOKEN` is unset. A missing token does not fail the job. When a token is added later, the same workflow publishes `pi-super@0.2.0` if that version is not already on npm.

```bash
pi install git:github.com/Arcobalneo/pi-super
```

### Notes

pi-super 0.2.0 makes the main Pi session a Super-agent Router.

You only talk to that session. It admits work, asks one concrete question when it is blocked, and shows the worker receipt as the result. It does not paraphrase that receipt, so a summary cannot add a check the receipt did not name. scout, planner, worker, and reviewer run as isolated `pi` processes. One coding round is one hop. If the reviewer finds a required check missing or different, it sends the ticket back to the worker and reviews again.

Progress stays quiet. A question is one title, one text, and its options, copied from the receipt. Answer it in the same session, or with `/super answer`.

This package does not start a cloud daemon and does not connect Feishu or GitHub. Those triggers need a host Pi's extension API does not provide. The session log is the ledger.

Install from this release:

```bash
pi install git:github.com/Arcobalneo/pi-super
```

Node.js 22.19 or newer, and a Pi that can already call a model. npm publish is not part of this release.
