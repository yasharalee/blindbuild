// The v0.5 loop (deprecated in 0.6: the planner runs `bb run` itself). Kept for one version.
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { killTree } from './builder-run.mjs';
import { excludeFile, rescueBranch } from './git.mjs';
import { devteam, pluginRoot, repoRoot } from './paths.mjs';
import { loadProfile } from './profile.mjs';
import { normalize } from './text.mjs';
import { copyTemplates, pendingMessage, pidAlive, prepareRun, readJson, say, stamp, supervise, verifyRules, writeLock } from './supervisor.mjs';

export { pendingMessage, verifyRules };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function init(cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const p = devteam(root);
  for (const dir of [p.mail, p.state, p.runs, p.worktrees, p.templates]) mkdirSync(dir, { recursive: true });
  for (const box of [p.toBuilder, p.toPlanner]) if (!existsSync(box)) writeFileSync(box, '');
  const exclude = excludeFile(root);
  mkdirSync(join(exclude, '..'), { recursive: true });
  const current = existsSync(exclude) ? normalize(readFileSync(exclude, 'utf8')) : '';
  if (!current.split('\n').includes('.devteam/')) appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}.devteam/\n`);
  if (!existsSync(p.profile)) cpSync(join(pluginRoot, 'templates', 'profile.json'), p.profile);
  copyTemplates(p);
  for (const launcher of ['bb.cmd', 'bb.ps1', 'bb.sh']) cpSync(join(pluginRoot, 'templates', launcher), join(p.dt, launcher));
  chmodSync(join(p.dt, 'bb.sh'), 0o755);
  writeFileSync(join(p.dt, 'plugin-root.txt'), pluginRoot); // launcher fallback when the global record is missing
  say(`ready in ${p.dt} (ignored through .git/info/exclude, nothing committed).`);
  return root;
}

// One run in the foreground (the v0.5 `run-once`). The same supervisor as `bb run`, without detaching.
export async function runOnce(cwd = process.cwd(), { quietBlock = false } = {}) {
  const root = repoRoot(cwd);
  const p = devteam(root);
  let run;
  try { run = prepareRun(root); } catch (e) {
    const nothing = e.message.startsWith('nothing to do');
    if (!quietBlock || nothing) say(e.message);
    return nothing ? { ok: true, ran: false } : { ok: false, ran: false, reason: e.message };
  }
  const lock = { pid: process.pid, runDir: run.runDir, runId: run.runId, message: run.message, startedAt: run.startedAt };
  writeLock(p.runLock, lock); // lock before the builder starts, so a second run refuses
  const summary = await supervise(root, run.runDir, {
    onStart: (builderPid) => { lock.builderPid = builderPid; writeLock(p.runLock, { ...lock, phase: 'building' }); },
    onPhase: (phase) => writeLock(p.runLock, { ...lock, phase }),
    markRetryable: true,
  });
  return { ok: summary.ok, ran: true, summary };
}

export async function start(cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const p = devteam(root);
  const profile = loadProfile(p.profile);
  const loop = readJson(p.loopLock);
  if (loop && pidAlive(loop.pid)) { say(`a loop is already running for this project (pid ${loop.pid}).`); return 1; }
  const rules = verifyRules();
  if (!rules.ok) { say(`refusing to start: ${rules.reason}.`); return 1; }
  for (const f of [p.stopFile, p.haltFile]) rmSync(f, { force: true });
  writeFileSync(p.loopLock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  const { max_runs: maxRuns, max_hours: maxHours, tick_seconds: tick } = profile.loop;
  const deadline = Date.now() + maxHours * 3_600_000;
  let runs = 0;
  let code = 0;
  let lastPause = '';
  say("'start' is deprecated; the planner now runs 'bb run' itself. Running the old loop for this session.");
  say(`loop started (max ${maxRuns} runs, ${maxHours} h). Stop with the stop script.`);
  try {
    while (runs < maxRuns && Date.now() < deadline) {
      if (existsSync(p.stopFile) || existsSync(p.haltFile)) { say('stop requested.'); break; }
      writeFileSync(p.heartbeat, new Date().toISOString());
      if (pendingMessage(p)) {
        const res = await runOnce(root, { quietBlock: true });
        if (res.reason && res.reason !== lastPause) say(`paused: ${res.reason}`);
        lastPause = res.reason || '';
        if (res.ran) runs += 1;
        if (!res.ok && res.ran) { code = 1; say('a run needs attention; waiting for the next message (the loop keeps running).'); }
      }
      await sleep(tick * 1000);
    }
  } finally {
    rmSync(p.loopLock, { force: true });
    rmSync(p.stopFile, { force: true });
  }
  if (runs >= maxRuns) say(`reached ${maxRuns} runs; start the loop again to continue.`);
  return code;
}

export function stop(cwd = process.cwd()) {
  const p = devteam(repoRoot(cwd));
  writeFileSync(p.stopFile, new Date().toISOString());
  say('stop requested: the loop exits after the current step.');
}

export function halt(cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const p = devteam(root);
  writeFileSync(p.haltFile, new Date().toISOString());
  const run = readJson(p.runLock);
  if (run?.builderPid && pidAlive(run.builderPid)) killTree(run.builderPid);
  if (run && run.pid !== process.pid && pidAlive(run.pid)) killTree(run.pid);
  const branch = rescueBranch(root, `halt-${stamp()}`);
  rmSync(p.runLock, { force: true });
  say(`halted. Work saved on ${branch}; nothing in your folder was changed or deleted.`);
  return branch;
}

export function status(cwd = process.cwd()) {
  const p = devteam(repoRoot(cwd));
  const loop = readJson(p.loopLock);
  const run = readJson(p.runLock);
  const beat = existsSync(p.heartbeat) ? readFileSync(p.heartbeat, 'utf8').trim() : null;
  const report = {
    loop: loop && pidAlive(loop.pid) ? `running (pid ${loop.pid})` : 'off',
    builder: run && pidAlive(run.pid) ? `running ${run.message} since ${run.startedAt}` : 'idle',
    heartbeat: beat,
    pending: pendingMessage(p)?.id ?? null,
    lastRun: readJson(join(p.state, 'last-run.json')),
    stopRequested: existsSync(p.stopFile),
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}
