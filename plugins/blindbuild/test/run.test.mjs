import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeRepo, quiet, waitForFile } from './helpers.mjs';
import { checkAuth, launch } from '../scripts/lib/run.mjs';

const summaryOf = async (runDir) => {
  assert.ok(await waitForFile(join(runDir, 'summary.json')), `no summary.json in ${runDir}`);
  return JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'));
};

test('launch returns at once and the detached supervisor finishes the run', async () => {
  process.env.FAKE_MODE = 'done';
  const repo = makeRepo();
  const started = Date.now();
  const { runDir, pid } = quiet(() => launch(repo, { openViewer: false }));
  assert.ok(Date.now() - started < 2000, 'launch must not wait for the builder');
  assert.ok(pid > 0);
  const s = await summaryOf(runDir);
  assert.equal(s.outcome, 'done');
  assert.equal(s.ok, true, s.errors.join(' | '));
  assert.ok(readFileSync(join(runDir, 'gate.log'), 'utf8').length > 0);
  assert.ok(readFileSync(join(runDir, 'stream.jsonl'), 'utf8').includes('"type":"result"'));
});

test('a second launch refuses while a run is active', async () => {
  process.env.FAKE_MODE = 'slow';
  const repo = makeRepo();
  const { runDir } = quiet(() => launch(repo, { openViewer: false }));
  assert.throws(() => quiet(() => launch(repo, { openViewer: false })), /already active/);
  await summaryOf(runDir);
});

test('an auth failure becomes outcome auth, not a crash', async () => {
  process.env.FAKE_MODE = 'auth';
  const repo = makeRepo();
  const { runDir } = quiet(() => launch(repo, { openViewer: false }));
  const s = await summaryOf(runDir);
  assert.equal(s.outcome, 'auth');
  assert.equal(s.ok, false);
  assert.ok(s.errors.some((e) => /not logged in/i.test(e)));
});

test('a repo path with spaces works end to end', async () => {
  process.env.FAKE_MODE = 'done';
  const repo = makeRepo(join(mkdtempSync(join(tmpdir(), 'bb-sp-')), 'my repo'));
  const { runDir } = quiet(() => launch(repo, { openViewer: false }));
  const s = await summaryOf(runDir);
  assert.equal(s.outcome, 'done', s.errors.join(' | '));
});

test('launch refuses with no pending work order', () => {
  process.env.FAKE_MODE = 'done';
  const repo = makeRepo();
  writeFileSync(join(repo, '.devteam/mail/to-builder.md'), '');
  assert.throws(() => quiet(() => launch(repo, { openViewer: false })), /no new complete message/);
});

test('checkAuth reads claude auth status', () => {
  const fake = (out) => () => ({ status: 0, stdout: out });
  assert.equal(checkAuth({ spawnSyncFn: fake('{"loggedIn": true}'), force: true }).ok, true);
  const no = checkAuth({ spawnSyncFn: fake('{"loggedIn": false}'), force: true });
  assert.equal(no.ok, false);
  assert.match(no.reason, /not logged in/i);
});

test('the detached supervisor leaves a log of its own output', async () => {
  process.env.FAKE_MODE = 'done';
  const repo = makeRepo();
  const { runDir } = quiet(() => launch(repo, { openViewer: false }));
  await summaryOf(runDir);
  // The supervisor logs its outcome before writing summary.json, so the line must already be there.
  assert.match(readFileSync(join(runDir, 'supervisor.log'), 'utf8'), /done: committed/);
});

test('a check that throws still produces a summary (never a silent vanish)', async () => {
  process.env.FAKE_MODE = 'done';
  const repo = makeRepo();
  const { prepareRun, supervise } = await import('../scripts/lib/supervisor.mjs');
  const run = prepareRun(repo);
  const runJson = join(run.runDir, 'run.json');
  writeFileSync(runJson, JSON.stringify({ ...JSON.parse(readFileSync(runJson, 'utf8')), startSha: 'f'.repeat(40) }));
  const s = await quiet(() => supervise(repo, run.runDir));
  assert.equal(s.ok, false);
  assert.ok(s.errors.some((e) => /could not run/.test(e)), s.errors.join(' | '));
  assert.ok(readFileSync(join(run.runDir, 'summary.json'), 'utf8').includes('could not run'));
});

test('after an auth failure the same work order can be launched again', async () => {
  process.env.FAKE_MODE = 'auth';
  const repo = makeRepo();
  const first = quiet(() => launch(repo, { openViewer: false }));
  await summaryOf(first.runDir);
  process.env.FAKE_MODE = 'done';
  const second = quiet(() => launch(repo, { openViewer: false }));
  const s = await summaryOf(second.runDir);
  assert.equal(s.outcome, 'done');
});

test('a live builder whose supervisor died still blocks a second run', async () => {
  const { spawn } = await import('node:child_process');
  const repo = makeRepo();
  const orphan = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    writeFileSync(join(repo, '.devteam', 'state', 'run.json'), JSON.stringify({ runDir: join(repo, 'x'), pid: 999999, builderPid: orphan.pid }));
    assert.throws(() => quiet(() => launch(repo, { openViewer: false })), /already active/);
  } finally { orphan.kill(); }
});
