---
format: 1
type: backlog
---

# Backlog (the queue)

One row per work order. The planner is the only writer. Fixes go to the top.

| Work order | Epic | Title | Status | Branch | Waiting on |
| --- | --- | --- | --- | --- | --- |

Status: TODO → BUILDING → REVIEW → WAITING_HUMAN → ACCEPTED, or DROPPED.
"Waiting on" says why when the status is WAITING_HUMAN: acceptance, DB approval, UI approval, question, package.
