---
description: Scout, plan, then implement a coding task with pi-super
argument-hint: "<task>"
---

Use pi-super for this task: $@

1. Call super_eval. decision is accept, strength is explicit, and the scope is the task.
2. Call super_dispatch with that ticketId and a chain:
   - scout: find the code relevant to the task
   - planner: write a concrete plan from {previous}
   - worker: implement the plan in {previous}
3. If the result says the ticket needs a person, stop.
