# Changelog

All notable changes to this project are listed here. Versions follow [semver](https://semver.org): a MAJOR bump means a project file format changed.

## 0.6.0 — 2026-11-22

The planner moves to Claude Code and runs the builder itself. Fixes four problems found in real use of 0.5:

- **The planner can wake up.** It now runs in an interactive Claude Code session (`bb plan`, with the plan folder attached). It starts the builder with `bb run` and waits with `bb wait` in the background; the waiter exits on a summary, a crash, a stall or a time limit, which wakes the planner. No scheduled tasks, no sleeping, no polling in the chat.
- **No more manual restarts.** Each work order is one supervised run. Questions end the run with a result; the planner answers and launches again.
- **`gh` works.** The planner uses your real shell. The builder may read GitHub (`gh pr view/list/diff/checks`, `gh run view/list`, `gh issue view/list`, `gh repo view`, `gh api` GET); every GitHub write is blocked by the guard.
- **Parallel by default.** Two or more independent tickets run as parallel developer agents; building alone needs a stated reason. Planners split work orders into independent tickets.

Also new:

- `bb run` starts a detached supervisor that re-runs the gate, checks commits and scope, and always writes `summary.json` (a failing check becomes an error in it, never a silent crash). It logs to `runs/<id>/supervisor.log`.
- `bb wait` reports `summary`, `crash`, `stall`, `running` (a long command, not a stall) or `timeout`; it never kills anything. No false stalls while the supervisor checks the work.
- `bb watch` and an automatic **"blindbuild builder"** window: a live board of every agent (status files plus the stream), denied commands in red, replayable later. OS notification when a run ends.
- Detected and reported as such: not logged in, rate or usage limits, crashes, denied commands.
- `preflight` checks Node, git, the Claude Code version and login, `gh`, and Windows Terminal.
- Screenshots and files for the builder go in `.devteam/mail/attachments/<work order>/`.
- Recovery table in the planner, keyed to the approval preset.
- Tests: the stable-copy test compares resolved paths (macOS `/private/var`, Windows short names). CI runs `npm test` with actions v6.

Hardening (from the pre-release review):

- The guard reads `gh api` flags like a shell does and fails closed: any write form (`-X "DELETE"`, `--method=PUT`, `-f`, `--input`, chained commands) is blocked.
- Guard paths ignore letter case, so `.DevTeam/Profile.json` is protected on Windows and macOS.
- The builder runs with Claude Code auto-memory off and cannot read `~/.claude/projects`, so the planner's conversation cannot reach it.
- After an auth, rate-limit or crash run, `bb run` retries the same work order.
- A builder that outlives its supervisor still blocks a second run; lock files are written atomically; `bb wait` reports `halted` after `bb halt` (the planner never relaunches it).

Deprecated: `start` and `stop` (the old loop) still work for one version; the loop no longer exits after a run that needs attention. Cowork as the planner is no longer supported.

## 0.5.0 — 2026-11-17 (first public release)

- CI: tests on Windows, macOS and Linux with Node 18 and 22, core-rules check, plugin and marketplace validation.
- Issue templates (bug, idea) and private security reporting link.
- README quickstart and `docs/walkthrough.md` (a real run, step by step).
- `npm test` lists test files explicitly so it runs on Node 18.

## 0.4.0 — 2026-11-17

- Stable copy: `promote [ref]` keeps a detached worktree at `<repo>-stable` on base or a feature branch; no branch is moved. Same-folder mode: a planner-written `pause` file stops new runs until `accept` clears it.
- Database changes: `db-apply <folder> --confirm <code>`; the code is the first 8 characters of the SQL files' hash, so any edit voids the approval. Needs rollback + impact summary, runs the backup first, local databases only, `--irreversible` when flagged.
- Guard: blocks builder commands that mention a listed shared resource, and the user-only commands (`accept`, `promote`, `db-apply`, loop launchers). Builder settings deny the stable database MCP server.
- Setup and planner skills: database flow, MCP guidance, workspaces of several repos.

## 0.3.0 — 2026-11-17

- Planner skill (Cowork): session start with access check and history, goals → roadmap, just-in-time work orders with file ownership and "Context ahead", check-ins with backoff, evidence-first review (the loop's own gate log and summary), answers, acceptance, batch close, recovery.
- Setup skill (`/blindbuild:setup`, Claude Code): interview, init, base branch, commit-signing decision, plan folder from templates, gate check, Cowork instructions with full paths.
- `accept <branch>` command: merges a feature into the base branch with `--no-ff` and an `accepted/` tag; aborts cleanly on conflict; refuses main, unknown branches and a dirty folder.
- Builder lead model is a profile setting (`builder.model`).
- Plan templates: roadmap, backlog, history, decisions.
- Fix: the scope check diffs from the merge base, so a run that starts on one feature branch and builds on a new branch from base is no longer flagged for the files it left behind.

## 0.2.0 — 2026-11-17

- Builder side. One Node CLI (`scripts/cli.mjs`, Node 18+, no dependencies): `init`, `start`, `stop`, `halt`, `status`, `run-once`, `verify-rules`, plus the `guard` and `record-root` hooks. Thin `bb.cmd` / `bb.ps1` / `bb.sh` launchers per project (`bb.cmd` works even when PowerShell scripts are blocked).
- Locked-down headless builder run: `dontAsk` mode, explicit allow-list, deny rules for secrets and the plan folder, reads outside the repo blocked, core rules appended to the system prompt.
- Role-aware PreToolUse guard (active only for the builder): no push, no history rewrites, no checkout/stash/clean, no commits or merges on main/master/base, no package installs (lockfile restores allowed), no plan-folder access, no writes to planner-owned files. Fails closed.
- Agents: developer (Sonnet), reviewer (read-only), db-specialist (files only).
- Builder skill: full sprint playbook (waves, developer worktrees, merge, review, one gate, commits, result).
- After each run: result validation, a scope guard (changed files must be listed in the work order), a check that a `done` result really committed, and the loop re-runs the gate itself and keeps the log.
- Preflight: a repo that signs commits is refused before the run, with the fix (an unattended builder can't type a key passphrase).
- Allowed commands work in both the Bash and PowerShell tools (Windows).
- `halt` saves all work to a `rescue/` branch through a temporary index, without touching your folder.
- Project profile is now `profile.json` (was YAML); the shell verify scripts were replaced by `cli.mjs verify-rules`.
- 22 automated tests (`npm test`); `demo/` project with an example work order.

## 0.1.0 — 2026-11-17

- Repo is its own marketplace; plugin manifest.
- 19 locked core rules with an LF-normalised SHA-256 checksum and verify scripts (bash + PowerShell).
- Templates: work order, result, project profile, ADR (all `format: 1`).
- Planner and builder skills as skeletons.
