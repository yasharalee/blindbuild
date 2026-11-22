// `bb wait`: the planner starts this in the background and ends its turn. It exits when there is something
// for the planner to do: a summary, a crash, a user halt, a stall, or the wait limit (then the planner re-arms).
// It only reads; it never kills or changes anything.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { devteam, repoRoot, runFiles } from './paths.mjs';
import { readEvents, summarize } from './stream.mjs';
import { pidAlive, readJson } from './supervisor.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mins = (ms) => Math.max(0, Math.round(ms / 60_000));

// The run to follow: the given id, else the active run, else the newest run folder. Null when there is none.
export function selectRun(root, runId) {
  const p = devteam(root);
  if (runId) return existsSync(join(p.runs, runId)) ? join(p.runs, runId) : null;
  const lock = readJson(p.runLock);
  if (lock?.runDir && existsSync(lock.runDir)) return lock.runDir;
  if (!existsSync(p.runs)) return null;
  const dirs = readdirSync(p.runs).filter((d) => existsSync(join(p.runs, d, 'run.json'))).sort();
  return dirs.length ? join(p.runs, dirs[dirs.length - 1]) : null;
}

function summaryText(s, root) {
  const lines = [`outcome: ${s.outcome}${s.ok ? '' : ' (checks failed)'}`, `message: ${s.message}`];
  for (const e of s.errors || []) lines.push(`error: ${e}`);
  for (const d of s.denials || []) lines.push(`denied: ${d}`);
  lines.push(`result: ${join(root, '.devteam', 'mail', 'to-planner.md')}`);
  return lines.join('\n');
}

function lastSeen(agents) {
  let best = null;
  for (const [agent, a] of agents) if (a.lastText && (!best || String(a.lastAt) >= String(best.lastAt))) best = { agent, ...a };
  return best ? `${best.agent}: ${best.lastText}` : 'nothing yet';
}

export async function waitFor(cwd = process.cwd(), { runId, stallMinutes = 10, maxWaitMinutes = 30, pollMs = 2000, now = Date.now } = {}) {
  const root = repoRoot(cwd);
  const p = devteam(root);
  const runDir = selectRun(root, runId);
  if (!runDir) return { case: 'timeout', runId: null, text: 'no run found. Start one with: bb run' };
  const files = runFiles(runDir);
  const id = readJson(files.run)?.runId || runDir.split(/[\\/]/).pop();
  const deadline = now() + maxWaitMinutes * 60_000;
  const events = [];
  let offset = 0;
  let ctx;
  for (;;) {
    const summary = readJson(files.summary);
    if (summary) return { case: 'summary', runId: id, text: summaryText(summary, root) };

    let lock = readJson(p.runLock);
    // Compare by run id: the same folder can be spelled two ways (/var vs /private/var, short Windows names).
    const live = (l) => l && (l.runId ? l.runId === id : l.runDir === runDir) && pidAlive(l.pid);
    if (!live(lock)) {
      await sleep(Math.min(pollMs, 500)); // look twice before calling it a crash
      lock = readJson(p.runLock);
      if (readJson(files.summary) || live(lock)) continue;
      const started = Date.parse(readJson(files.run)?.startedAt || '') || 0;
      if (existsSync(p.haltFile) && statSync(p.haltFile).mtimeMs >= started - 1000) {
        return { case: 'halted', runId: id, text: `the user halted run ${id} (bb halt). Do not relaunch; ask the user what to do next.` };
      }
      return { case: 'crash', runId: id, text: `the supervisor for run ${id} is gone without a summary. See ${files.supervisorLog} and ${files.stderr}.` };
    }

    const read = readEvents(files.stream, offset, ctx);
    events.push(...read.events);
    offset = read.nextByte;
    ctx = read.ctx;
    const { agents, inFlight } = summarize(events);
    const started = Date.parse(readJson(files.run)?.startedAt || '') || now();
    const activity = existsSync(files.stream) ? Math.max(statSync(files.stream).mtimeMs, started) : started;
    const silent = now() - activity;
    const stallMs = stallMinutes * 60_000;
    const checking = lock.phase === 'checking';
    if (!checking && ((!inFlight && silent > stallMs) || (inFlight && silent > stallMs * 3))) {
      const doing = inFlight ? `${inFlight.agent}: ${inFlight.text}` : lastSeen(agents);
      return { case: 'stall', runId: id, text: `no activity for ${mins(silent)}m. Last: ${doing}. The builder is still running; nothing was stopped.` };
    }
    if (now() >= deadline) {
      if (checking) return { case: 'timeout', runId: id, text: `the builder finished; the supervisor is checking the builder's work (gate re-run). Start bb wait ${id} again.` };
      if (inFlight) return { case: 'running', runId: id, text: `running: ${inFlight.agent}: ${inFlight.text} for ${mins(silent)}m. Start bb wait ${id} again.` };
      return { case: 'timeout', runId: id, text: `still running; last activity ${lastSeen(agents)} (${mins(silent)}m ago). Start bb wait ${id} again.` };
    }
    await sleep(pollMs);
  }
}
