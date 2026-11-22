---
format: 1
type: work-order
id: WO-0000
repo: <repo name>
branch: <feature branch>
pace: normal            # normal | fast | careful
---

# <Short title>

## Why
<Lead's goal in their words, with the date it was asked.>

## What the user sees
<Behaviour after the change.>

## Tickets
| Ticket | Scope | Files owned | Depends on |
| --- | --- | --- | --- |
| T1 | <scope> | <exact paths> | — |

## Acceptance
- <Testable statement, with real numbers when it's a bug.>

## Constraints / don't do
- <What must not change.>

## Attachments
<Files under .devteam/mail/attachments/<id>/, one line each on what matters in it. "none" if none.>

## Context ahead
<2-5 lines about what the next batch needs, so choices here don't fight it. Nothing more of the plan.>

## Flags
- DB change: no
- UI change: no
- New package: no

--- END WO-0000 ---
