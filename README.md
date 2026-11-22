# Blindbuild

A small AI software team for your own machine. A **planner** (an interactive Claude Code session) owns the roadmap and talks to you. A **builder** (a separate, headless Claude Code process with a team of developer agents) gets one work order at a time and never sees the plan. The planner starts the builder, waits for it in the background, and reports back in your chat. You can watch the builder work live in its own window.

> Status: **v0.6.0.** The planner moved from Cowork to Claude Code, the builder runs parallel developers by default, and every run is supervised and watchable. Try it on [`demo/`](demo/README.md) before a real project.

**Requires:** Git, Node.js 18+, Claude Code 2.1.197 or newer (logged in). Optional: the GitHub CLI (`gh`), so the builder can read PRs and CI runs; Windows Terminal on Windows, for the live viewer tab.

## Why "blind"

The builder builds blind to the plan: it sees only the work order in front of it. That stops scope creep, keeps its context small, and makes every change reviewable against a written spec.

## Principles

- **Local only.** Never touches `main`, never deploys beyond your machine, opens a PR only when you ask.
- **Evidence over confidence.** Nothing is committed below 9.5/10, and 9.5 means: green gate, clean independent review, every should-fix fixed, screenshots for UI.
- **19 locked engineering rules** ([core-rules.md](plugins/blindbuild/rules/core-rules.md)). Projects can add rules, never remove them.
- **Any language.** The quality gate is one command you choose; exit code 0 means pass.
- **No AI evidence in your git history.** Blindbuild's files stay in an excluded `.devteam/` folder; commits are authored by you.

## Install

In Claude Code:

```
/plugin marketplace add yasharalee/blindbuild
/plugin install blindbuild@blindbuild
```

You can also ask Claude to run those two commands for you.

## Quickstart

1. Install (above).
2. In your project folder, in Claude Code: `/blindbuild:setup`. It runs a preflight (Node, git, Claude Code version and login, `gh`), interviews you, and creates the ignored `.devteam` folder and your private plan folder.
3. Start the planner: `<repo>\.devteam\bb.cmd plan` (Windows) or `<repo>/.devteam/bb.sh plan` (macOS/Linux). Say what you want.
4. The planner writes work orders, starts the builder (`bb run`) and waits for it (`bb wait`). A **"blindbuild builder"** window shows every agent live; close it any time, `bb watch` reopens it.
5. Test the result, then accept it: `<repo>\.devteam\bb.cmd accept feature/<name>`.

The full story with real output: [docs/walkthrough.md](docs/walkthrough.md).

## How it works

```
You ⇄ Planner (Claude Code in your repo, plan folder attached)
          │ work order → .devteam/mail/to-builder.md
          │ bb run  → starts a detached supervisor, returns at once
          │ bb wait → runs in the background; wakes the planner when there's news
          ▼
      Builder (headless claude -p, locked permissions)
          │ lead + parallel developers + reviewer, one feature branch
          ▼ result → .devteam/mail/to-planner.md
      Supervisor: re-runs your gate, checks commits and scope → summary.json
      Viewer (bb watch): live board of agents, denied commands in red
```

- **The wall:** the plan folder sits outside the repo; the builder is denied reads of it by its settings and by a guard hook that fails closed.
- **Parallel by default:** independent tickets run as parallel developer agents, each on its own branch and worktree.
- **Evidence, not claims:** the supervisor re-runs your gate itself and rejects a "done" with no commit or with files outside the work order.
- **Recovery:** crashes, stalls, rate limits and a missing login are each reported as what they are; the planner follows your approval preset (autopilot recovers crashes and rate limits itself, and asks you about stalls and logins).

Commands (`bb.cmd` on Windows, `bb.sh` elsewhere): `preflight` · `plan` · `run` · `wait [run]` · `watch [run]` · `halt` (stop now; work saved to a `rescue/` branch) · `status`. Yours only: `accept <branch>` · `promote [ref]` (stable copy) · `db-apply <folder> --confirm <code>`. Deprecated since 0.6: `start` · `stop`.

**Cowork as the planner** is no longer supported since 0.6: its shell can't use your `gh` login, and a Cowork chat can't be woken when the builder finishes.

## Privacy

Blindbuild sends no telemetry to its author or any third party. Your prompts and code go to Anthropic to run Claude, as with any Claude use, under your account's data settings. Database MCP servers you choose to install are their own vendors' software.

## License

[MIT](LICENSE)
