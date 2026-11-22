# Blindbuild demo: test the builder on your machine

**What this test proves:** you hand the builder a written task (a "work order"), and it writes the code, runs the tests, and commits on its own branch, without you touching anything.

**Nothing is pushed anywhere.** The demo is a brand-new local git repo with no remote.

**You need:** Git, Node.js 18 or newer, and Claude Code installed and signed in.

**Paths used below** (change them if yours differ):

| What | Path |
| --- | --- |
| Your blindbuild folder | `C:\dev\Skills-Packages\blindbuild` |
| The demo copy you'll create | `C:\dev\blindbuild-demo` |

---

## Step 1 — Install the plugin

**Where:** inside a Claude Code session (any folder).
**What it does:** tells Claude Code about your local blindbuild folder and installs the plugin from it.

```
/plugin marketplace add C:\dev\Skills-Packages\blindbuild
/plugin install blindbuild@blindbuild
```

Then **close Claude Code and open it again** so the plugin loads. Check it with `claude plugin list` in PowerShell: `blindbuild` must be listed and enabled.

## Step 2 — Make the demo project

**Where:** PowerShell.
**What it does:** copies the demo to its own folder, makes it a git repo with one commit, and creates the `base` branch blindbuild works from.

`C:\dev\blindbuild-demo` must not exist yet. If it does, PowerShell copies the demo *inside* it as a `demo` subfolder, and nothing after this step works. Delete it first: `Remove-Item -Recurse -Force C:\dev\blindbuild-demo`.

```
Copy-Item -Recurse C:\dev\Skills-Packages\blindbuild\demo C:\dev\blindbuild-demo
cd C:\dev\blindbuild-demo
git init -b main
git add -A
git commit -m "demo start"
git branch base
```

## Step 3 — Set up blindbuild in the demo

**Where:** PowerShell, still in `C:\dev\blindbuild-demo`.
**What it does:** creates the hidden `C:\dev\blindbuild-demo\.devteam` folder (mailbox, settings, launcher). Git is told to ignore it, so nothing gets committed.

```
node C:\dev\Skills-Packages\blindbuild\plugins\blindbuild\scripts\cli.mjs init
```

It ends with `blindbuild: ready in C:\dev\blindbuild-demo\.devteam`.

## Step 4 — Tell blindbuild how to test this project

**Where:** any text editor.
**What it does:** sets the "gate", the one command that must pass before the builder may commit.

Open `C:\dev\blindbuild-demo\.devteam\profile.json` and change these two lines:

```
"gate": "npm test",
"allowed_commands": ["node --test"]
```

## Step 5 — Give the builder its task

**Where:** PowerShell.
**What it does:** puts the work order into the builder's mailbox.

```
Copy-Item C:\dev\blindbuild-demo\WO-0001.md C:\dev\blindbuild-demo\.devteam\mail\to-builder.md
```

## Step 6 — Run the builder once

**Where:** PowerShell.
**What it does:** starts Claude Code in locked-down mode, lets it build the task, then checks its work. This uses some of your Claude plan's usage, and can take a few minutes.

```
C:\dev\blindbuild-demo\.devteam\bb.cmd run-once
```

---

## Did it work?

It worked if all three are true:

1. The last line printed is `blindbuild: run for WO-0001 finished cleanly.`
2. This shows new commits:
   ```
   git -C C:\dev\blindbuild-demo log feature/slugify --oneline
   ```
3. `C:\dev\blindbuild-demo\.devteam\mail\to-planner.md` ends with `--- END RESULT WO-0001 ---`.

**If it didn't:** send the printed output plus the newest folder in `C:\dev\blindbuild-demo\.devteam\runs\` (its `stderr.log` and `summary.json` say what went wrong).

macOS or Linux: same steps with `/` paths, `cp -r` instead of `Copy-Item`, and `.devteam/bb.sh` instead of `bb.cmd`.
