# Acceptance

Recorded 2026-11-04 against Pi `@earendil-works/pi-coding-agent@1.5.0` and Kimi `kimi-for-coding` (K2.8 Preview) at `https://api.kimi.com/coding/v1`. The provider id is `kimi-coding`. The API key was only `KIMI_API_KEY` on the pi process. It is not in this file.

`npm run check` is green: typecheck and 35 tests, including the false-ready case where `formatCents` returns `"1.99"` while `"$1.99"` only appears in a `parseCents` test. That review is rejected.

```bash
KIMI_KEY_FILE=/path/to/key.txt node scripts/accept.mjs
```

Exit code 0. Both scenarios passed.

## formatCents / parseCents — pass

The mandate requires `formatCents(199)` → `"$1.99"`, `formatCents(5)` → `"$0.05"`, `formatCents(-40)` → `"-$0.40"`, and the inverse `parseCents` calls.

The model restated those examples as `decimals(...)`. The first review said ready. The kernel ran the examples, `decimals` was not defined, and the ticket went back:

```text
2026-11-04T07:18:46Z progress
Behavior mismatch: decimals(199) but decimals is not defined in the tree; expected "$1.99".
```

Hop 2 ran worker then reviewer. The delivery is that receipt, with no extra quoted text:

```text
From the worker receipt:
t1 ready.
All mandate examples verified: decimals(199)="$1.99", decimals(5)="$0.05", decimals(-40)="-$0.40", formatCents(199)="$1.99", parseCents("$1.99")=199. Tests in tests/cents.test.ts assert these exact literals; all 11 tests pass via node --test.
```

Independent calls after the run:

| Call | Result |
| --- | --- |
| `formatCents(199)` | `"$1.99"` |
| `formatCents(5)` | `"$0.05"` |
| `formatCents(-40)` | `"-$0.40"` |
| `parseCents("$1.99")` | `199` |
| `parseCents("$0.05")` | `5` |
| `parseCents("-$0.40")` | `-40` |

`formatCents` returns `` `${sign}$${dollars}.${rem}` ``. The earlier failure, where the function returned `"1.99"` and the tests only mentioned `"$1.99"` for `parseCents`, is the unit test `rejects ready when formatCents drops the dollar sign but the tests mention it`.

## One question, then super_answer — pass

The Router asked once and did not write a file. The shown text is the receipt:

```text
From the worker receipt:
t1 needs you: pace(n) behavior
Should pace(n) return n or n * 2?
1. keep
2. double
```

Opened 2026-11-04T07:19:59Z. The next message was `double`. The tool call was `super_answer`. One hop (scout, planner, worker, reviewer) ended at 07:21:32Z. The delivery copied the receipt:

```text
From the worker receipt:
t1 ready.
Criterion pace(n) === n*2 satisfied: src/pace.ts:2 returns n * 2; ran pace(2)===4 and pace(5)===10, both correct.
```

`src/pace.ts` is `return n * 2`.

## v0.2.1: slugify with ask-first and constraints (pass)

Recorded 2026-11-04 with Pi 1.5.0 and `kimi-coding/kimi-for-coding`, pi-super installed with `pi install`. The person's message:

> 我想给 src/slug.ts 里的 slugify(title) 做真正的实现……还没想好中文/非 ASCII 字符怎么处理——是原样保留还是直接删掉，这点需要你问我。顺便加 src/slug.test.ts（node:test），不要加依赖，不要 commit。

Turn 1: the Router called `super_eval` with `constraints` and `ask`. t1 started waiting. No role ran. The delivery was the question:

```text
t1 needs you: 非 ASCII 字符如何处理？
slugify 遇到中文等非 ASCII 字符时，应该原样保留还是直接删掉？
1. 原样保留
2. 直接删掉
```

Turn 2: `原样保留` → `super_answer`. Scout, planner, worker, and reviewer each ran once (one hop) and the ticket ended ready. The tree changed only `src/slug.ts` and the new `src/slug.test.ts`. No package.json, no commit. `node --test` gives 5 pass. `slugify("Hello, World!")` returns `"hello-world"`, `slugify("你好 World")` returns `"你好-world"`, and `slugify("  --a--b  ")` returns `"a-b"`.

`scripts/accept.mjs` passed both earlier scenarios again: cents in one hop, pace with one question and `pace(2) === 4`.
