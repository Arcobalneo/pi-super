# Acceptance

Recorded 2026-11-04 against Pi `@earendil-works/pi-coding-agent@1.5.0` and Kimi `kimi-for-coding` (K2.8 Preview) at `https://api.kimi.com/coding/v1`. The provider id in Pi is `kimi-coding`. The API key was only `KIMI_API_KEY` on the pi process. It is not in this file.

`npm run check` is green: typecheck and 32 tests. The load test sees `--super`, `--super-plan`, and `--super-off`.

```bash
KIMI_KEY_FILE=/path/to/key.txt node scripts/accept.mjs
KIMI_KEY_FILE=/path/to/key.txt ACCEPT_ONLY=ask node scripts/accept.mjs
```

Overall: the one-question resume **passed**. The harder coding task **failed** the independent behavior check. Details below.

## One question, then super_answer — pass

Prompt: add `src/pace.ts` exporting `pace(n: number): number`, but do not choose whether it returns `n` or `n * 2`. Ask one question whose only options are `keep` and `double`. Do not write the file until the person answers.

The Router called `super_eval` and `super_report`. It did not write `src/pace.ts`. The shown text was the receipt, not a paraphrase:

```text
From the worker receipt:
t1 needs you: pace(n) behavior
Should pace(n) return n as-is, or n doubled?
1. keep
2. double
```

One attention, opened 2026-11-04T06:51:22Z. No second question.

The next message in the same session was `double`. The only tool call was `super_answer` with `choice: "double"`. Then one hop:

| Time (UTC) | Fact |
| --- | --- |
| 06:51:29 | `attention.answered` double |
| 06:51:32 | scout, hops 1 |
| 06:51:52 | planner, hops 1 |
| 06:52:00 | worker, hops 1 |
| 06:52:10 | reviewer, hops 1 |
| 06:52:25 | `ready` |

`src/pace.ts`:

```ts
export function pace(n: number): number {
  return n * 2;
}
```

The delivery copied the receipt:

```text
From the worker receipt:
t1 ready.
Criteria met: src/pace.ts exists with `export function pace(n: number)` (line 1) and `return n * 2;` (line 2), matching the mandate's pace(n) doubles n. No test command exists to run.
```

That sentence matches the file. The Router model did not add a check the receipt did not contain.

## Cents task — fail

Prompt: `formatCents(199)` is `"$1.99"`, `formatCents(5)` is `"$0.05"`, `formatCents(-40)` is `"-$0.40"`, and `parseCents` is the inverse for those three strings. Tests must use `node:test`.

pi exited 0. The lane ran, and the kernel did send a mismatch back:

| Time (UTC) | Fact |
| --- | --- |
| 06:40:59 | ticket created |
| 06:41:05–06:42:41 | scout, planner, worker, reviewer, hops 1 |
| 06:43:05 | `progress`: `Missing acceptance literal: "$1.99", "$0.05", "-$0.40".` |
| 06:43:05–06:43:49 | worker, then reviewer, hops 2 |
| 06:44:27 | `ready` |

The first review was not accepted, because those quoted strings were not in the tree. The repair added them on `parseCents` only. The final receipt, which the delivery copied verbatim (`quotesOutsideReceipt` was empty), said the literals were present and that 14 tests passed.

Independent check of the functions after that run:

| Call | Required | Actual |
| --- | --- | --- |
| `formatCents(199)` | `"$1.99"` | `"1.99"` |
| `formatCents(5)` | `"$0.05"` | `"0.05"` |
| `formatCents(-40)` | `"-$0.40"` | `"-0.40"` |
| `parseCents("$1.99")` | `199` | `199` |
| `parseCents("$0.05")` | `5` | `5` |
| `parseCents("-$0.40")` | `-40` | `-40` |

`formatCents` never emits `$`. The test file contains `"$1.99"` only as a `parseCents` input, and it expects `formatCents(parseCents("$1.99"))` to be `"1.99"`. The quoted-literal gate therefore allowed `ready`. The reviewer did not catch that the format function drops the dollar sign. The Router did not invent that claim: the speech is the receipt. The receipt is wrong about `formatCents`.

`scripts/accept.mjs` treats that behavior check as required, so the full script exits 1.

## What this does and does not show

- Grounded delivery: pass. Question text, options, and the ready summary are copied from the receipt. A unit test rejects a ready summary that mentions `Ada` when the evidence does not.
- One question and `super_answer`: pass, on the run above.
- Reviewer or kernel send-back when a quoted literal is missing from the tree: pass, on the cents run's first review.
- Reviewer catching a wrong `formatCents` result when the dollar strings merely appear somewhere in the tests: fail.
