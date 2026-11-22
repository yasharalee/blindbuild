import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeRepo, quiet } from './helpers.mjs';
import { launch } from '../scripts/lib/run.mjs';
import { waitFor } from '../scripts/lib/wait.mjs';

const fast = { pollMs: 50, stallMinutes: 0.06, maxWaitMinutes: 0.5 };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// A run folder and lock written by hand, so the test controls pids and timestamps.
function fakeRun(repo, { pid, streamAgeMs = 0, lines = [], phase }) {
  const runId = 'manual-run';
  const runDir = join(repo, '.devteam', 'runs', runId);
  mkdirSync(join(runDir, 'agents'), { recursive: true });
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ runId, runDir, message: 'WO-0001', startedAt: new Date(Date.now() - streamAgeMs).toISOString() }));
  writeFileSync(join(runDir, 'stream.jsonl'), lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  const old = new Date(Date.now() - streamAgeMs);
  utimesSync(join(runDir, 'stream.jsonl'), old, old);
  writeFileSync(join(repo, '.devteam', 'state', 'run.json'), JSON.stringify({ runId, runDir, pid, ...(phase ? { phase } : {}) }));
  return runId;
}

test('wait returns the summary once the supervisor has written it', async () => {
  process.env.FAKE_MODE = 'slow';
  const repo = makeRepo();
  const { runId } = quiet(() => launch(repo, { openViewer: false }));
  const r = await waitFor(repo, { ...fast, runId });
  assert.equal(r.case, 'summary');
  assert.equal(r.runId, runId);
  assert.match(r.text, /outcome: done/);
});

test('wait without a run id attaches to the active run', async () => {
  process.env.FAKE_MODE = 'slow';
  const repo = makeRepo();
  const { runId } = quiet(() => launch(repo, { openViewer: false }));
  const r = await waitFor(repo, fast);
  assert.equal(r.runId, runId);
});

test('wait reports a crash when the supervisor is gone without a summary', async () => {
  const repo = makeRepo();
  fakeRun(repo, { pid: 999999 });
  const r = await waitFor(repo, fast);
  assert.equal(r.case, 'crash');
});

test('wait reports a stall after silence with nothing in flight, and never kills', async () => {
  const repo = makeRepo();
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    fakeRun(repo, { pid: sleeper.pid, streamAgeMs: 10 * 60_000, lines: [{ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'thinking hard' }] } }] });
    const r = await waitFor(repo, fast);
    assert.equal(r.case, 'stall');
    assert.match(r.text, /thinking hard/);
    assert.ok(alive(sleeper.pid), 'wait must never kill anything');
  } finally { sleeper.kill(); }
});

test('a long tool run is reported as running, not as a stall', async () => {
  const repo = makeRepo();
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    fakeRun(repo, {
      pid: sleeper.pid,
      streamAgeMs: 5000, // older than stall (3.6 s), younger than 3 × stall
      lines: [{ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } }],
    });
    const r = await waitFor(repo, { ...fast, maxWaitMinutes: 0.02 });
    assert.equal(r.case, 'running');
    assert.match(r.text, /npm test/);
  } finally { sleeper.kill(); }
});

test('timeout says what was last seen', async () => {
  const repo = makeRepo();
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    fakeRun(repo, { pid: sleeper.pid, lines: [{ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'editing greet' }] } }] });
    const r = await waitFor(repo, { ...fast, maxWaitMinutes: 0.01 });
    assert.equal(r.case, 'timeout');
    assert.match(r.text, /still running.*editing greet/s);
  } finally { sleeper.kill(); }
});

test('bb wait prints the case on its first line and exits 0', async () => {
  const { spawnSync } = await import('node:child_process');
  const { cliPath } = await import('./helpers.mjs');
  const repo = makeRepo();
  const res = spawnSync(process.execPath, [cliPath, 'wait'], { cwd: repo, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.split('\n')[0], 'CASE: timeout');
  assert.match(res.stdout, /no run found/);
});

test('no false stall while the supervisor checks the work after the builder exits', async () => {
  const repo = makeRepo();
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    fakeRun(repo, { pid: sleeper.pid, phase: 'checking', streamAgeMs: 10 * 60_000, lines: [{ type: 'result', is_error: false, result: 'done' }] });
    const r = await waitFor(repo, { ...fast, maxWaitMinutes: 0.01 });
    assert.equal(r.case, 'timeout');
    assert.match(r.text, /checking the builder's work/);
  } finally { sleeper.kill(); }
});

test('a half-written lock is not mistaken for a crash', async () => {
  const repo = makeRepo();
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    const runId = fakeRun(repo, { pid: sleeper.pid });
    const lockFile = join(repo, '.devteam', 'state', 'run.json');
    const full = JSON.stringify({ runId, runDir: join(repo, '.devteam', 'runs', runId), pid: sleeper.pid });
    writeFileSync(lockFile, full.slice(0, 10)); // torn read
    setTimeout(() => writeFileSync(lockFile, full), 30);
    setTimeout(() => writeFileSync(join(repo, '.devteam', 'runs', runId, 'summary.json'), JSON.stringify({ outcome: 'done', ok: true, message: 'WO-0001' })), 400);
    const r = await waitFor(repo, { ...fast, pollMs: 200 });
    assert.equal(r.case, 'summary');
  } finally { sleeper.kill(); }
});

test('a run the user halted is reported as halted, not crash', async () => {
  const repo = makeRepo();
  fakeRun(repo, { pid: 999999 });
  writeFileSync(join(repo, '.devteam', 'state', 'halt'), new Date().toISOString());
  const r = await waitFor(repo, fast);
  assert.equal(r.case, 'halted');
});
