#!/usr/bin/env node
// blindbuild command line. Usage: node cli.mjs <preflight|init|plan|run|wait [run]|watch [run]|halt|status|accept <branch>|promote [ref]|db-apply <folder> --confirm <code>|verify-rules|run-once|start|stop|guard|record-root|supervise>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { currentBranch } from './lib/git.mjs';
import { accept } from './lib/accept.mjs';
import { dbApply } from './lib/db.mjs';
import { promote } from './lib/stable.mjs';
import { decide } from './lib/guard.mjs';
import { halt, init, runOnce, start, status, stop, verifyRules } from './lib/loop.mjs';
import { launch, openPlanner } from './lib/run.mjs';
import { preflight } from './lib/preflight.mjs';
import { selectRun, waitFor } from './lib/wait.mjs';
import { watch } from './lib/watch.mjs';
import { notify } from './lib/window.mjs';
import { readJson, supervise, writeLock } from './lib/supervisor.mjs';
import { devteam, pluginRoot, pluginRootRecord, repoRoot } from './lib/paths.mjs';
import { loadProfile, protectedBranches } from './lib/profile.mjs';

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error('blindbuild: Node.js 18 or newer is required.');
  process.exit(1);
}

// PreToolUse hook. Exit 2 blocks the tool call and shows the reason to Claude. Fails closed for the builder.
function guard() {
  if (process.env.BLINDBUILD_ROLE !== 'builder') return 0;
  try {
    const event = JSON.parse(readFileSync(0, 'utf8') || '{}');
    const cwd = event.cwd || process.cwd();
    const root = repoRoot(cwd);
    const profile = loadProfile(devteam(root).profile);
    const verdict = decide(event.tool_name, event.tool_input, {
      cwd,
      repoRoot: root,
      protectedBranches: protectedBranches(profile),
      sharedResources: profile.shared_resources,
      branchOf: (dir) => { try { return currentBranch(dir); } catch { return ''; } },
    });
    if (!verdict.block) return 0;
    console.error(`blindbuild guard: ${verdict.reason}`);
    return 2;
  } catch (e) {
    console.error(`blindbuild guard failed closed: ${e.message}`);
    return 2;
  }
}

// Internal: the detached half of `bb run`. Refuses unless the run lock names this run.
async function superviseCommand() {
  const runDir = process.argv[3];
  const root = repoRoot(runDir);
  const p = devteam(root);
  const lock = readJson(p.runLock);
  if (!lock || lock.runDir !== runDir) {
    console.error('blindbuild: supervise is internal to `bb run` and needs the matching run lock.');
    return 1;
  }
  let state = { ...lock, pid: process.pid };
  process.on('uncaughtException', (e) => { console.error(`blindbuild supervisor crashed: ${e.stack || e.message}`); process.exit(1); });
  const summary = await supervise(root, runDir, {
    onStart: (builderPid) => { state = { ...lock, pid: process.pid, builderPid, phase: 'building' }; writeLock(p.runLock, state); },
    onPhase: (phase) => { state = { ...state, phase }; writeLock(p.runLock, state); },
    notifyFn: process.env.BLINDBUILD_NO_NOTIFY ? () => {} : notify, // tests set BLINDBUILD_NO_NOTIFY
  });
  return summary.ok ? 0 : 1;
}

// SessionStart hook: remembers where the installed plugin lives, so the project launchers can find it after updates.
function recordRoot() {
  mkdirSync(dirname(pluginRootRecord()), { recursive: true });
  writeFileSync(pluginRootRecord(), pluginRoot);
  return 0;
}

const commands = {
  init: () => (init(), 0),
  start: () => start(),
  stop: () => (stop(), 0),
  halt: () => (halt(), 0),
  status: () => (status(), 0),
  'run-once': async () => ((await runOnce()).ok ? 0 : 1),
  run: () => (launch(), 0),
  plan: () => openPlanner(),
  preflight: () => {
    const checks = preflight();
    for (const c of checks) console.log(`${c.ok ? 'ok  ' : c.required ? 'FAIL' : 'warn'}  ${c.check.padEnd(16)} ${c.detail}`);
    return checks.some((c) => c.required && !c.ok) ? 1 : 0;
  },
  watch: async () => {
    const runDir = selectRun(repoRoot(process.cwd()), process.argv[3]);
    if (!runDir) { console.log('blindbuild: no run found.'); return 1; }
    await watch(runDir);
    return 0;
  },
  wait: async () => {
    const root = repoRoot(process.cwd());
    const { run } = loadProfile(devteam(root).profile);
    const r = await waitFor(root, { runId: process.argv[3], stallMinutes: run.stall_minutes, maxWaitMinutes: run.max_wait_minutes });
    console.log(`CASE: ${r.case}\n${r.text}`);
    return 0;
  },
  supervise: superviseCommand,
  accept: () => (accept(process.argv[3]), 0),
  promote: () => (promote(process.argv[3]), 0),
  'db-apply': () => (dbApply(process.argv.slice(3)), 0),
  'verify-rules': () => {
    const r = verifyRules();
    console.log(r.ok ? 'blindbuild: core rules intact' : `blindbuild: ${r.reason}`);
    return r.ok ? 0 : 1;
  },
  guard,
  'record-root': recordRoot,
};

const name = process.argv[2];
if (!commands[name]) {
  console.error(`Usage: blindbuild <${Object.keys(commands).join('|')}>`);
  process.exit(64);
}
try {
  process.exitCode = await commands[name]();
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
