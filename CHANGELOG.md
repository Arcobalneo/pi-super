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
- Delivery wakes the Router only for a result, one question, a failure, or a spent hop fuse. Progress stays quiet.
- Receipt names `ask` and `later`, matching the lifecycle.
- `--super-off` leaves the session as a normal coding agent.
- `scripts/accept.mjs` runs a real Pi session against `kimi-coding/kimi-for-coding` without writing the API key into the repo. Evidence is in `ACCEPTANCE.md`.

### Changed

- The loop is armed on a fresh session. `/super loop` still toggles it and resets the fuse when armed.
- `super_dispatch` stays available when the loop is off. The Router does not see it while the loop is on.

## [0.1.0] - 2026-11-04

- Initial Pi package: ticket ledger, plan mode, ask-first gate, hop fuse, and subprocess subagents.

## Release notes draft (GitHub Release 0.2.0)

pi-super 0.2.0 makes the main Pi session a Super-agent Router.

After `pi install npm:pi-super` you only talk to that session. It admits work, asks one concrete question when it is blocked, and reports a result worth reading. scout, planner, worker, and reviewer run as isolated `pi` processes. The loop drains them without another prompt. Progress does not wake the Router.

This package does not start a cloud daemon and does not connect Feishu or GitHub. Those triggers need a host Pi's extension API does not provide. The session log is the ledger.

### Install

```bash
pi install npm:pi-super
```

Node.js 22.19 or newer, and a Pi that can already call a model.

### Publish

Version `0.2.0` is already set in `package.json`. From a checkout of the release commit, with an npm account that can publish `pi-super`:

```bash
npm whoami
npm publish --access public
```

If npm requires a one-time password:

```bash
npm publish --access public --otp <code>
```

Do not put the Kimi key, the npm token, or the OTP in the repo, the changelog, or a fixture.

Tag the GitHub Release `v0.2.0` from this section.
