# Walkthrough: one feature from idea to accepted

> **Note:** this walkthrough shows the 0.5 flow (planner in Cowork, `bb.cmd start`). In 0.6 the planner runs in Claude Code (`bb.cmd plan`) and starts the builder itself; see the README. The walkthrough will be refreshed from a real 0.6 run.

This follows a real run on the `demo/` project (Windows, November 2026). Paths assume the project lives at `C:\dev\my-app`; use your own.

## 1. Set up (once per project)

Open a terminal in the project and start Claude Code:

```
cd C:\dev\my-app
claude
```

Type `/blindbuild:setup`. It asks a handful of questions with clickable answers:

- **Gate:** the one command that must pass before anything is committed, for example `npm test`.
- **Targeted test commands** developers may run, for example `node --test`.
- **Builder model:** your default, `sonnet` (cheaper) or `opus` (strongest).
- **Stable copy:** none (test on the feature branch) or a separate worktree beside the repo.
- **Database, shared resources, branch names, approval preset.**

It then creates `C:\dev\my-app\.devteam\` (ignored by git through `.git\info\exclude`), the base branch, and your private plan folder `C:\Users\<you>\.devteam\plans\my-app\`. If your git signs commits, it asks how to handle that, because an unattended builder can't type a passphrase.

## 2. Connect the planner (once)

In the Claude desktop app:

1. Customize → Plugins → install blindbuild (from the GitHub marketplace, or Upload plugin with the zip).
2. Settings → Desktop app → Trusted folders: add `C:\dev` and `C:\Users\<you>\.devteam`.
3. Create a Project and add both folders: `C:\dev\my-app` and `C:\Users\<you>\.devteam\plans\my-app`.

## 3. Ask for something

In the Project chat:

> Use the blindbuild planner for my-app. Goal: add a truncate(text, max) helper with tests.

The planner reads the code, asks only what changes the build (in the demo: "what should happen when text is longer than max?"), writes the decision down, drafts the roadmap, and sends a work order. It tells you if the loop isn't running.

## 4. Start the builder loop

```
C:\dev\my-app\.devteam\bb.cmd start
```

Leave the window open. Within about 30 seconds the builder (headless Claude Code) picks up the work order. It creates `feature/truncate` from base, builds the change with tests, has an independent reviewer check it, runs the gate, commits, and writes a result. The loop then re-runs the gate itself and checks that every changed file was listed in the work order.

## 5. Review and test

The planner's next check-in (about every 15 minutes) reads the result, the loop's own gate log and the diff, then gives you smoke steps, for example:

```
cd C:\dev\my-app
git switch feature/truncate
npm test
```

With a stable copy, run `C:\dev\my-app\.devteam\bb.cmd promote feature/truncate` and test in `C:\dev\my-app-stable` instead.

## 6. Accept

```
C:\dev\my-app\.devteam\bb.cmd accept feature/truncate
```

This merges the feature into base with a merge commit and the tag `accepted/feature-truncate`. `main` is never touched and nothing is pushed. Tell the planner "accepted feature/truncate": it records it, writes the highlights to `history.md` and clears the mailbox.

## When something goes wrong

- `bb.cmd status`: what the loop and builder are doing, and the last run's result.
- `bb.cmd halt`: stop now; all work is saved to a `rescue/` branch and nothing in your folder is deleted.
- Each run's evidence is in `C:\dev\my-app\.devteam\runs\<time>\`: `summary.json`, `gate.log`, `output.json`, `stderr.log`.
