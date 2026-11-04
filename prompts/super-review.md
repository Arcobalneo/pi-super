---
description: Review the current changes with the pi-super reviewer agent
argument-hint: "[focus]"
---

Use pi-super to review ${@:-the current changes}.

1. Call super_eval. decision is accept, strength is explicit, and the scope is a read-only review.
2. Call super_dispatch for that ticket with agent reviewer.
3. If the reviewer asks a question, stop and ask the user that question.
