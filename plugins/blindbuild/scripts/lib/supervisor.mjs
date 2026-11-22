// One builder run, start to evidence: refuse when unsafe, start the builder, wait, then check its work.
// Used in the foreground by `run-once` and detached by `bb run` (cli.mjs supervise <runDir>).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startBuilder } from './builder-run.mjs';
import { changedFilesSince, git, hasTrackedChanges, headSha } from './git.mjs';
import { devteam, pluginRoot, runFiles } from './paths.mjs';
import { loadProfile } from './profile.mjs';
import { readEvents, summarize } from './stream.mjs';
import { frontValue, lastMessage, normalize, readText } from './text.mjs';
import { ownedFiles, scopeViolations, validateResult } from './validate.mjs';

export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
export const readJson = (file) => { try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { return null; } };
// Lock writes go through a temp file + rename, so a reader never sees half a lock.
export const writeLock = (file, obj) => { writeFileSync(`${file}.tmp`, JSON.stringify(obj)); renameSync(`${file}.tmp`, file); };
export const say = (msg) => console.log(`blindbuild: ${msg}`);
export const pidAlive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
// A post-run check that fails must not take the summary down with it: retry once (transient Windows
// file locks were seen), then report it as an error the planner can read.
function check(name, errors, fn, fallback) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try { return fn(); } catch (e) {
      if (attempt === 2) { errors.push(`the ${name} check could not run: ${e.message}`); return fallback; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  return fallback;
}
const textHash = (text) => createHash('sha256').update(text).digest('hex');
export const copyTemplates = (p) => cpSync(join(pluginRoot, 'templates'), p.templates, { recursive: true });

export function verifyRules() {
  const rules = join(pluginRoot, 'rules', 'core-rules.md');
  const expectedFile = join(pluginRoot, 'rules', 'core-rules.sha256');
  if (!existsSync(rules) || !existsSync(expectedFile)) return { ok: false, reason: 'core rules or checksum missing' };
  const actual = createHash('sha256').update(normalize(readFileSync(rules, 'utf8')), 'utf8').digest('hex');
  const expected = readFileSync(expectedFile, 'utf8').trim();
  return actual === expected ? { ok: true } : { ok: false, reason: `core rules were modified (expected ${expected}, got ${actual})` };
}

const signsCommits = (root) => {
  try { return git(root, ['config', '--get', 'commit.gpgsign']) === 'true'; } catch { return false; }
};

// Refuses to start a builder when something unsafe is true. Returns a reason or null.
export function blocker(p, profile, root) {
  const rules = verifyRules();
  if (!rules.ok) return `refusing to run: ${rules.reason}.`;
  if (existsSync(p.pauseFile)) return 'paused while the user tests a feature in this folder (accept clears the pause).';
  if (!profile.commands.gate) return 'no gate command in .devteam/profile.json; the first work order must build one, run by hand.';
  const run = readJson(p.runLock);
  if (run && (pidAlive(run.pid) || pidAlive(run.builderPid))) return `a builder run is already active (pid ${pidAlive(run.pid) ? run.pid : run.builderPid}).`;
  if (hasTrackedChanges(root)) return 'uncommitted changes in tracked files (someone edited code). Paused until they are committed.';
  if (signsCommits(root) && !profile.git.signing_works_unattended) {
    return 'this repo signs commits, and an unattended builder cannot type a key passphrase. Fix one: '
      + '(a) turn signing off for this repo only: `git config commit.gpgsign false`; '
      + '(b) or load your key into an agent (`ssh-add`) and set "signing_works_unattended": true under "git" in .devteam/profile.json.';
  }
  return null;
}

export function pendingMessage(p) {
  const msg = lastMessage(readText(p.toBuilder));
  if (!msg.complete) return null;
  const handled = existsSync(p.handled) ? readFileSync(p.handled, 'utf8').trim() : '';
  return msg.id === handled ? null : msg;
}

// The supervisor runs the gate itself, so the evidence comes from the harness, not from the builder's word.
function runGate(root, profile, runDir) {
  const res = spawnSync(profile.commands.gate, { cwd: root, shell: true, encoding: 'utf8', timeout: 3_600_000 });
  writeFileSync(runFiles(runDir).gateLog, `${res.stdout ?? ''}${res.stderr ?? ''}`);
  return res.status === 0;
}

// Checks and records everything a run needs before any process starts. Throws a plain-English reason when it can't run.
export function prepareRun(root) {
  const p = devteam(root);
  const profile = loadProfile(p.profile);
  const msg = pendingMessage(p);
  if (!msg) throw new Error('nothing to do: no new complete message in to-builder.md.');
  const why = blocker(p, profile, root);
  if (why) throw new Error(why);
  rmSync(p.haltFile, { force: true }); // a new run; an old halt no longer applies
  if (frontValue(msg.body, 'type') === 'work-order') writeFileSync(p.currentWorkOrder, msg.body);
  const runId = stamp();
  const runDir = join(p.runs, runId);
  mkdirSync(runFiles(runDir).agents, { recursive: true });
  copyTemplates(p);
  const run = { runId, runDir, message: msg.id, startSha: headSha(root), plannerBoxHash: textHash(readText(p.toPlanner)), startedAt: new Date().toISOString() };
  writeFileSync(runFiles(runDir).run, JSON.stringify(run, null, 2));
  return run;
}

// Outcome for the planner: the stream wins for auth and rate limits; otherwise the result's status.
function outcomeOf(streamOutcome, resultStatus, exitCode) {
  if (streamOutcome === 'auth' || streamOutcome === 'rate-limit') return streamOutcome;
  if (resultStatus) return resultStatus;
  return exitCode === 0 ? 'failed' : 'crash';
}

// Runs the builder for a prepared run and writes summary.json. `onStart(pid)` records the builder pid.
export async function supervise(root, runDir, { onStart = () => {}, onPhase = () => {}, notifyFn = () => {}, markRetryable = false } = {}) {
  const p = devteam(root);
  const profile = loadProfile(p.profile);
  const files = runFiles(runDir);
  const run = readJson(files.run);
  if (!run) throw new Error(`no run.json in ${runDir}`);

  const child = startBuilder({ root, profile, runDir, runId: run.runId });
  onStart(child.pid);
  const beat = setInterval(() => writeFileSync(p.heartbeat, new Date().toISOString()), 30_000);
  writeFileSync(p.heartbeat, new Date().toISOString());
  const exitCode = await new Promise((r) => child.on('exit', (code) => r(code ?? 1)));
  clearInterval(beat);
  onPhase('checking'); // the builder is done; the gate re-run can be long and silent, which is not a stall

  const stream = summarize(readEvents(files.stream).events);
  const errors = [];
  if (stream.outcome === 'auth') errors.push('Claude Code is not logged in. Run `claude`, then /login, then launch again.');
  if (stream.outcome === 'rate-limit') errors.push(`the builder hit a usage or rate limit: ${stream.resultText}`);
  if (exitCode !== 0 && !stream.outcome) errors.push(`builder exited with code ${exitCode} (see ${runDir}).`);
  const plannerText = readText(p.toPlanner);
  const result = lastMessage(plannerText);
  const fresh = result.complete && textHash(plannerText) !== run.plannerBoxHash;
  if (!fresh) {
    if (!['auth', 'rate-limit'].includes(stream.outcome)) errors.push('no new complete result in to-planner.md.');
  } else {
    errors.push(...validateResult(result.body));
    if (frontValue(result.body, 'status') === 'done') {
      const noCommit = check('new-commit', errors, () => git(root, ['rev-list', '--count', `${run.startSha}..HEAD`]) === '0'
        && git(root, ['rev-list', '--count', '--branches', `^${run.startSha}`]) === '0', false);
      if (noCommit) errors.push('result says done, but no new commit exists on any branch.');
      if (!check('gate', errors, () => runGate(root, profile, runDir), false)) errors.push(`the gate failed when the supervisor re-ran it (see ${files.gateLog}).`);
    }
  }
  const resultStatus = fresh ? frontValue(result.body, 'status') : null;
  const outOfScope = check('scope', errors, () => scopeViolations(ownedFiles(readText(p.currentWorkOrder)), changedFilesSince(root, run.startSha)), []);
  if (outOfScope.length) errors.push(`changed files outside the work order: ${outOfScope.join(', ')}`);

  const summary = {
    runId: run.runId, message: run.message, outcome: outcomeOf(stream.outcome, resultStatus, exitCode), resultStatus, exitCode,
    ok: errors.length === 0, errors, denials: stream.denials, startSha: run.startSha, endSha: check('head', [], () => headSha(root), null), finishedAt: new Date().toISOString(),
  };
  // Auth, rate-limit and crash runs did not handle the message: `bb run` must be able to retry it.
  // The deprecated loop marks them anyway (markRetryable) so it cannot spin on a failing login.
  if (markRetryable || !['auth', 'rate-limit', 'crash'].includes(summary.outcome)) writeFileSync(p.handled, run.message);
  // Log the outcome before summary.json: readers treat summary.json as "finished", so the log must be complete by then.
  if (!summary.ok) say(`run for ${run.message} FAILED checks: ${errors.join(' | ')}`);
  else if (resultStatus === 'done') say(`run for ${run.message} done: committed, and the gate passed when re-run by the supervisor.`);
  else say(`run for ${run.message} ended with status '${resultStatus}': the builder needs an answer. See .devteam/mail/to-planner.md.`);
  writeFileSync(files.summary, JSON.stringify(summary, null, 2));
  writeFileSync(join(p.state, 'last-run.json'), JSON.stringify({ ...summary, runDir }, null, 2));
  rmSync(p.runLock, { force: true });
  try { notifyFn('blindbuild', `${run.message}: ${summary.outcome}${summary.ok ? '' : ' (needs attention)'}`); } catch { /* best effort */ }
  return summary;
}

