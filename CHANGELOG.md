# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- A `ready` review on a code ticket is rejected when a quoted literal from the mandate is absent from the project. The ticket goes back with `Missing acceptance literal`, and that sentence is what the person sees if the hop limit stops the repair.

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
