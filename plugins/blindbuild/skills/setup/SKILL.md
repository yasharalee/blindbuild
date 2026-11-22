---
name: setup
description: Set up blindbuild in the current project, interactively in Claude Code. Use when the user says "set up blindbuild", "/blindbuild:setup", or wants to start using the blindbuild planner + builder on a repo.
disable-model-invocation: true
---

# Blindbuild setup (run in Claude Code, inside the project folder)

You set up blindbuild for this project by interviewing the user. Nothing is auto-detected: ask, and suggest only when you can see the evidence (for example a `package.json` with a `test` script). Give every path in full (for example `C:\dev\my-app\.devteam\profile.json`, never `.devteam\profile.json`), and every command ready to paste for the user's shell.

Plugin scripts live at `${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs`.

## 1. Preconditions

1. Git: run `git rev-parse --show-toplevel`. Not a repo → explain that blindbuild needs git (branches, rescue, history) and offer `git init`; stop if they decline.
2. Run the preflight: `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" preflight`. It checks Node.js 18+, git, the Claude Code version, the Claude Code login (`claude auth status`), the GitHub CLI (optional) and Windows Terminal (optional, Windows). Show the table. Any required `FAIL` → say exactly how to fix it and stop. It reports only; never install anything for the user without asking.
3. Never touch the user's own `CLAUDE.md`, `AGENTS.md` or `.gitignore`. Blindbuild keeps everything in `.devteam\`, ignored through `.git\info\exclude`.

## 2. Interview

Use AskUserQuestion, a few questions at a time, your recommendation first. Explain each choice in one plain sentence.

1. **Project name** (used for the plan folder): suggest the folder name.
2. **Stage:** new · early · mid-development · mature.
3. **Gate:** the one command that must pass before anything is committed (exit code 0 = pass). Suggest only from what you can see. No tests yet → say so: autopilot stays off and the first work order builds the gate.
4. **Targeted test commands** developers may run (for example `node --test`, `dotnet test`, `pytest`) and a lint command, if any.
5. **Builder lead model:** the user's Claude Code default (empty) · `sonnet` (cheaper) · `opus` (strongest). Mention the demo cost about $0.76 per small run on Opus.
6. **Where to test accepted work (stable copy):** none (test on the feature branch; new runs wait while you test) · separate copy (git worktree beside the repo, keeps running while the builder works). Explain both.
7. **Database:** none · local · shared/remote, and which type. Shared/remote → the builder never writes to it; it only produces SQL files.
   - Local: ask for the backup and apply commands (`{file}` = the SQL file), for example `sqlcmd -S localhost -d MyDb -i {file}`. They go to `commands.db_backup` / `commands.db_apply`.
   - For inspecting the schema, suggest the user install a database MCP server they trust, preferring the database vendor's official one, and mark the suggestion "verify". Two entries: `db-test` (builder may use it) and `db-stable` (builder must not). Least-privilege logins; credentials in environment variables, never in the repo. Warn loudly if the test login can reach the stable database.
8. **Shared resources** the builder must never write to (dev DBs, queues, shared APIs).
9. **Workspace:** is this repo one of several services planned together? If yes, use the same plan folder name for every repo in it (one roadmap, one loop per repo).
10. **Branch names:** neutral (`feature/login`) or with IDs (`feature/WO-0012-login`), and whether commit messages carry work-order IDs (default: no; no AI evidence in git).
11. **Approval preset:** manual · assisted (recommended) · autopilot. Explain in one line each.

## 3. Initialise

1. ALWAYS run `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" init`, even when `.devteam` already exists: it is safe to re-run and refreshes the launchers (`bb.cmd`, `bb.ps1`, `bb.sh`) and templates. It creates `<repo>\.devteam\` (mailbox, settings, launchers) and ignores it through `.git\info\exclude`.
2. Write the answers into `<repo>\.devteam\profile.json` (keep every key that is already there; only fill in values).
3. **Base branch:** if the profile's base branch doesn't exist, explain it (a copy of main that accepted work merges into; main is never touched) and, with approval, run `git branch <base> <main branch>`.
4. **Commit signing:** run `git config --get commit.gpgsign`. If `true`, explain that an unattended builder can't type a key passphrase, and ask:
   - turn signing off for this repo only (`git config commit.gpgsign false`; the global setting is unchanged) — recommended for most people; or
   - keep signing and load the key into an agent before each session, then set `"signing_works_unattended": true` under `"git"` in the profile.
5. **Plan folder:** create `~/.devteam/plans/<project name>/` (show the full path, for example `C:\Users\<name>\.devteam\plans\my-app`), copy the four files from `${CLAUDE_PLUGIN_ROOT}/templates/plan/` into it, and run `git init` there (local history only, never pushed). Refuse a name that already exists unless it is this project's.
6. **Gate check:** if a gate is set, run it once and report pass/fail with counts. A failing gate must be fixed (or made the first work order) before autopilot.

## 4. Planner setup (explain, don't do)

Tell the user, with their real full paths:

- The planner is an interactive **Claude Code** session in the repo, with the plan folder attached. Start it with `<repo>\.devteam\bb.cmd plan` (Windows) or `<repo>/.devteam/bb.sh plan` (macOS/Linux). It opens Claude Code with `--add-dir <plan folder>` and asks for the planner.
- The first time, Claude Code asks "trust this folder?" for the repo: they answer it while they are there, so nothing stalls later.
- The planner launches the builder itself (`bb run`) and waits for it in the background (`bb wait`). A live viewer window opens for each run; closing it changes nothing, and `bb watch` reopens it.
- Cowork as the planner is no longer supported (since 0.6): its shell can't reach their `gh` login and a Cowork chat can't be woken when the builder finishes.

## 5. Finish

Print a short summary:

- What was set up, with full paths: profile, mailbox, plan folder.
- How to start planning: `<repo>\.devteam\bb.cmd plan` (Windows; `bb.cmd` works even when PowerShell scripts are blocked) or `<repo>/.devteam/bb.sh plan` (macOS/Linux). The planner runs the builder from there. `bb.cmd halt` stops a run now and saves its work to a rescue branch.
- Anything still open (no gate yet, signing undecided).
