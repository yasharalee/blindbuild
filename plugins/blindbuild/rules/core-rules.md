# Blindbuild core rules (locked)

These 19 rules bind the planner, the tech lead, every developer and the reviewer, on every change.
They ship inside the plugin and can't be edited per project: the loop verifies this file's checksum
on every start and refuses to run if it changed. A project may ADD rules in `.devteam/rules.md`.
If a project rule contradicts a core rule, the core rule wins.

The reviewer checks every rule below and reports each finding as BLOCKER, SHOULD-FIX or NIT with
file:line. SOLID, DRY, KISS, YAGNI and separation of concerns are the reviewer's named anchors.
Coverage is the reviewer's judgement, not a fixed number.

## Architecture

1. **Single source of truth, zero duplication.** Before adding a feature, table, column, state or
   any component, search the codebase for one that exists or can be reused. One place per fact or
   rule. Deduplicate knowledge, not lookalike code: two functions that change for different reasons
   stay separate. The result must include a "Reuse check" section (what was searched, what was found).
2. **Modularity and loose coupling.** Components and features are independent, reusable and
   isolated, and talk through small interfaces.
3. **Simplicity.** Write the shortest code that stays equally or more readable. No redundant or
   speculative code. Clever-but-hard-to-read is rejected.
4. **Impact analysis and regression.** Before changing existing behaviour, find everything that
   depends on it. After the change, test every affected area. The result must include an
   "Impact map" (each caller found, and the test that covers it).
5. **Engines.** When 3 or more features gather around the same domain or route, the planner
   suggests consolidating them into an engine and asks the user first. An engine owns ONE domain
   behind a small public interface; callers ask the engine, never reach inside it; engines never
   call each other's internals.
6. **No god objects.** Break code into small, meaningful files, classes and functions with one
   clear job each, for reuse and easy debugging.

## Correctness and safety

7. **Security by default.** Validate input at trust boundaries, use parameterised queries, never put
   secrets in code, logs or results, give each role least privilege.
8. **Bugs start with a failing test.** Reproduce the bug, prove the root cause, rule out the
   alternatives, then fix. The result states the root cause.
9. **Backward compatibility.** No breaking change to a public API, contract or schema without the
   user's approval. Changes are additive by default.
10. **Error handling.** Never swallow an error. Fail fast and loud. Log in a structured way, without
    personal data.
11. **Delete dead code.** Retired code is removed, and a guard test stops it coming back.
12. **Follow existing conventions.** The codebase's naming, structure and style beat the agent's
    taste.
13. **Dependency discipline.** Standard library and existing dependencies first. A new package or
    library always needs the user's approval, with: why existing options can't do it, license, last
    release, known vulnerabilities, size and transitive dependencies, and 1-2 alternatives.
14. **Performance hygiene.** No N+1 queries, no unbounded loops or result sets, pagination by
    default.
15. **No hard-coding.** Configuration over constants. No hard-coded URLs, paths, IDs or credentials.
16. **Reversible by default.** Risky changes ship behind a feature flag or with an undo path.

## Process

17. **Decision records.** Each engine and each significant architecture decision gets a one-page
    ADR (Architecture Decision Record): context, decision, consequences.
18. **Test quality.** No sleeps or timing waits; use fake clocks. Assert by identity, not by index.
    Test through the real entry points. A green gate is not proof of an untested path: list
    untested paths in the result.
19. **UI basics.** UI work follows an approved mockup, meets accessibility basics (labels, keyboard
    use, contrast) and works on small and large screens.
