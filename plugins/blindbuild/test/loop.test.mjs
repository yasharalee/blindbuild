import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { halt, init, runOnce } from '../scripts/lib/loop.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const cli = join(here, '..', 'scripts', 'cli.mjs');
process.env.BLINDBUILD_CLAUDE_BIN = join(here, 'fixtures', 'fake-claude.mjs');
process.env.BLINDBUILD_HOME = mkdtempSync(join(tmpdir(), 'bb-home-'));

const WORK_ORDER = `---
format: 1
type: work-order
id: WO-0001
branch: feature/greet
---

# Add greet

## Tickets
| Ticket | Scope | Files owned | Depends on |
| --- | --- | --- | --- |
| T1 | greet | src/greet.mjs | — |

--- END WO-0001 ---
`;

let repo;
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const run = async (mode) => { process.env.FAKE_MODE = mode; const log = console.log; console.log = () => {}; try { return await runOnce(repo); } finally { console.log = log; } };

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'bb-repo-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'dev@example.com');
  git('config', 'user.name', 'Dev');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'README.md'), 'demo\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('switch', '-q', '-c', 'feature/greet');
  quiet(() => init(repo));
  const profile = JSON.parse(readFileSync(join(repo, '.devteam/profile.json'), 'utf8'));
  profile.commands.gate = 'node --test';
  writeFileSync(join(repo, '.devteam/profile.json'), JSON.stringify(profile));
  writeFileSync(join(repo, '.devteam/mail/to-builder.md'), WORK_ORDER);
});

test('init excludes .devteam through .git/info/exclude and commits nothing', () => {
  assert.match(readFileSync(join(repo, '.git/info/exclude'), 'utf8'), /^\.devteam\/$/m);
  assert.equal(git('status', '--porcelain'), '');
  assert.ok(['bb.cmd', 'bb.ps1', 'bb.sh'].every((f) => existsSync(join(repo, '.devteam', f))));
});

test('a clean run commits, validates and marks the message handled', async () => {
  const res = await run('done');
  assert.equal(res.ok, true, JSON.stringify(res.summary?.errors));
  assert.equal(git('log', '-1', '--format=%s'), 'feat(greet): add greet');
  assert.equal(readFileSync(join(repo, '.devteam/state/last-handled'), 'utf8'), 'WO-0001');
  assert.equal((await run('done')).ran, false, 'the same message never runs twice');
});

test('scope guard catches files outside the work order', async () => {
  const res = await run('outside');
  assert.equal(res.ok, false);
  assert.match(res.summary.errors.join(' '), /outside the work order: README\.md/);
});

test('a silent or crashing builder is flagged, not trusted', async () => {
  assert.equal((await run('silent')).ok, false);
  appendFileSync(join(repo, '.devteam/mail/to-builder.md'), 'retry\n--- END WO-0001-R1 ---\n');
  const crash = await run('crash');
  assert.equal(crash.ok, false);
  assert.match(crash.summary.errors.join(' '), /exited with code 1/);
});

test('an incomplete result is rejected', async () => {
  const res = await run('bad-result');
  assert.equal(res.ok, false);
  assert.match(res.summary.errors.join(' '), /Missing section/);
});

test('a question is a valid result', async () => {
  assert.equal((await run('question')).ok, true);
});

test('a half-written work order is never acted on', async () => {
  writeFileSync(join(repo, '.devteam/mail/to-builder.md'), WORK_ORDER.replace('--- END WO-0001 ---\n', ''));
  assert.equal((await run('done')).ran, false);
});

test('uncommitted human edits pause the builder', async () => {
  writeFileSync(join(repo, 'README.md'), 'human edit\n');
  const res = await run('done');
  assert.equal(res.ran, false);
  assert.match(res.reason, /uncommitted changes/);
});

test('halt saves everything to a rescue branch without touching the folder', () => {
  writeFileSync(join(repo, 'README.md'), 'half done\n');
  writeFileSync(join(repo, 'src/new.mjs'), 'new\n');
  const branch = quiet(() => halt(repo));
  assert.match(branch, /^rescue\/halt-/);
  assert.equal(git('show', `${branch}:src/new.mjs`), 'new');
  assert.equal(readFileSync(join(repo, 'README.md'), 'utf8'), 'half done\n');
  assert.equal(git('branch', '--show-current'), 'feature/greet');
});

test('guard hook: blocks the builder, ignores everyone else', () => {
  const event = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin x' }, cwd: repo });
  const asBuilder = spawnSync(process.execPath, [cli, 'guard'], { input: event, env: { ...process.env, BLINDBUILD_ROLE: 'builder' }, encoding: 'utf8' });
  assert.equal(asBuilder.status, 2);
  assert.match(asBuilder.stderr, /git push/);
  const asPlanner = spawnSync(process.execPath, [cli, 'guard'], { input: event, env: { ...process.env, BLINDBUILD_ROLE: '' }, encoding: 'utf8' });
  assert.equal(asPlanner.status, 0);
});

test('verify-rules passes on the shipped rules', () => {
  assert.equal(spawnSync(process.execPath, [cli, 'verify-rules']).status, 0);
});

test('start: runs pending work, stops at max_runs, cleans its lock', async () => {
  const { start } = await import('../scripts/lib/loop.mjs');
  const file = join(repo, '.devteam/profile.json');
  const profile = JSON.parse(readFileSync(file, 'utf8'));
  profile.loop = { ...profile.loop, max_runs: 1, tick_seconds: 0 };
  writeFileSync(file, JSON.stringify(profile));
  process.env.FAKE_MODE = 'done';
  const log = console.log; console.log = () => {};
  const code = await start(repo).finally(() => { console.log = log; });
  assert.equal(code, 0);
  assert.equal(git('log', '-1', '--format=%s'), 'feat(greet): add greet');
  assert.equal(existsSync(join(repo, '.devteam/state/loop.json')), false);
});

test('start keeps going after a run that needs attention, and handles the next message', async () => {
  const { start } = await import('../scripts/lib/loop.mjs');
  const file = join(repo, '.devteam/profile.json');
  const profile = JSON.parse(readFileSync(file, 'utf8'));
  profile.loop = { ...profile.loop, max_runs: 2, tick_seconds: 0.05, max_hours: 0.01 };
  writeFileSync(file, JSON.stringify(profile));
  process.env.FAKE_MODE = 'bad-result';
  const handled = join(repo, '.devteam/state/last-handled');
  const second = setInterval(() => {
    if (existsSync(handled) && readFileSync(handled, 'utf8').trim() === 'WO-0001') {
      clearInterval(second);
      process.env.FAKE_MODE = 'question';
      appendFileSync(join(repo, '.devteam/mail/to-builder.md'), '\n---\ntype: answer\nid: ANS-0001\n---\nUse Hello.\n--- END ANS-0001 ---\n');
    }
  }, 20);
  const log = console.log; console.log = () => {};
  await start(repo).finally(() => { console.log = log; clearInterval(second); });
  assert.equal(readFileSync(handled, 'utf8').trim(), 'ANS-0001');
});

test('a done result with no new commit is rejected', async () => {
  const res = await run('done-no-commit');
  assert.equal(res.ok, false);
  assert.match(res.summary.errors.join(' '), /no new commit/);
});

test('a repo that signs commits is refused before the run, with the fix', async () => {
  git('config', 'commit.gpgsign', 'true');
  const res = await run('done');
  assert.equal(res.ran, false);
  assert.match(res.reason, /signs commits/);
});

test('the loop re-runs the gate itself and rejects a claimed pass that fails', async () => {
  const file = join(repo, '.devteam/profile.json');
  const profile = JSON.parse(readFileSync(file, 'utf8'));
  profile.commands.gate = 'node -e "process.exit(1)"';
  writeFileSync(file, JSON.stringify(profile));
  const res = await run('done');
  assert.equal(res.ok, false);
  assert.match(res.summary.errors.join(' '), /gate failed/);
  assert.equal(res.summary.resultStatus, 'done');
});

test('a result that replaces an older one of the same size still counts as new', async () => {
  writeFileSync(join(repo, '.devteam/mail/to-planner.md'), 'x'.repeat(5000));
  const res = await run('rewrite');
  assert.equal(res.ok, true, JSON.stringify(res.summary?.errors));
});

test('accept merges the feature into base with a tag, never touching main', async () => {
  const { accept } = await import('../scripts/lib/accept.mjs');
  git('branch', 'base', 'main');
  writeFileSync(join(repo, 'src/x.mjs'), 'x\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feat: x');
  const mainBefore = git('rev-parse', 'main');
  const tag = quiet(() => accept('feature/greet', repo));
  assert.equal(tag, 'accepted/feature-greet');
  assert.equal(git('rev-parse', 'main'), mainBefore);
  assert.equal(git('show', 'base:src/x.mjs'), 'x');
  assert.equal(git('branch', '--show-current'), 'feature/greet');
});

test('accept refuses main, unknown branches and a dirty folder', async () => {
  const { accept } = await import('../scripts/lib/accept.mjs');
  git('branch', 'base', 'main');
  assert.throws(() => accept('main', repo), /can't be accepted/);
  assert.throws(() => accept('feature/nope', repo), /does not exist/);
  writeFileSync(join(repo, 'README.md'), 'dirty\n');
  assert.throws(() => accept('feature/greet', repo), /clean folder/);
});

test('builder model is passed only when set', async () => {
  const { builderArgs } = await import('../scripts/lib/builder-run.mjs');
  assert.ok(!builderArgs('s.json').includes('--model'));
  const args = builderArgs('s.json', 'sonnet');
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
});

test('a run started on another feature branch is judged only on its own commits', async () => {
  writeFileSync(join(repo, 'src/old.mjs'), 'old\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feat: old work on the branch the run started from');
  const res = await run('switch-from-base');
  assert.equal(res.ok, true, JSON.stringify(res.summary?.errors));
});

const setProfile = (fn) => {
  const file = join(repo, '.devteam/profile.json');
  const profile = JSON.parse(readFileSync(file, 'utf8'));
  fn(profile);
  writeFileSync(file, JSON.stringify(profile));
};

test('a pause file stops new runs until accept clears it', async () => {
  const { accept } = await import('../scripts/lib/accept.mjs');
  writeFileSync(join(repo, '.devteam/state/pause'), 'testing');
  const res = await run('done');
  assert.equal(res.ran, false);
  assert.match(res.reason, /paused while the user tests/);
  git('branch', 'base', 'main');
  quiet(() => accept('feature/greet', repo));
  assert.equal(existsSync(join(repo, '.devteam/state/pause')), false);
});

test('promote puts a detached stable worktree beside the repo and moves it on request', async () => {
  const { promote, stablePath } = await import('../scripts/lib/stable.mjs');
  git('branch', 'base', 'main');
  assert.throws(() => promote(undefined, repo), /stable_copy/);
  setProfile((p) => { p.stable_copy = 'worktree'; });
  const path = quiet(() => promote(undefined, repo));
  assert.equal(realpathSync.native(path),realpathSync.native(stablePath(repo)));
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path, encoding: 'utf8' }).trim(), git('rev-parse', 'base'));
  writeFileSync(join(repo, 'src/y.mjs'), 'y\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feat: y');
  quiet(() => promote('feature/greet', repo));
  assert.equal(readFileSync(join(path, 'src/y.mjs'), 'utf8'), 'y\n');
  assert.equal(git('rev-parse', 'base'), git('rev-parse', 'main'), 'no branch moved');
});

test('db-apply: local only, needs rollback + impact, the hash code, and --irreversible when flagged', async () => {
  const { changeHash, dbApply } = await import('../scripts/lib/db.mjs');
  const dir = join(repo, 'db/0001');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'migration.sql'), 'create table t (id int);\n');
  const log = join(repo, 'applied.log');
  const node = `"${process.execPath}"`;
  setProfile((p) => {
    p.database.kind = 'shared';
    p.commands.db_backup = `${node} -e "require('fs').appendFileSync(process.argv[1], 'backup\\n')" "${log}"`;
    p.commands.db_apply = `${node} -e "require('fs').appendFileSync(process.argv[1], 'apply ' + process.argv[2] + '\\n')" "${log}" {file}`;
  });
  assert.throws(() => dbApply(['db/0001'], repo), /local databases only/);
  setProfile((p) => { p.database.kind = 'local'; });
  assert.throws(() => dbApply(['db/0001'], repo), /rollback\.sql is missing/);
  writeFileSync(join(dir, 'rollback.sql'), 'drop table t;\n');
  writeFileSync(join(dir, 'impact.md'), 'reversible: yes\n');
  assert.throws(() => dbApply(['db/0001'], repo), /--confirm/);
  const code = changeHash(dir).slice(0, 8);
  writeFileSync(join(dir, 'migration.sql'), 'create table t (id bigint);\n');
  assert.throws(() => dbApply(['db/0001', '--confirm', code], repo), /not applied/, 'an edited SQL voids the approval');
  const fresh = changeHash(dir).slice(0, 8);
  writeFileSync(join(dir, 'impact.md'), 'reversible: no\n');
  assert.throws(() => dbApply(['db/0001', '--confirm', fresh], repo), /NOT reversible/);
  quiet(() => dbApply(['db/0001', '--confirm', fresh, '--irreversible'], repo));
  assert.match(readFileSync(log, 'utf8'), /^backup\napply .*migration\.sql\n$/);
});

test('builder settings deny the stable database MCP server', async () => {
  const { builderSettings } = await import('../scripts/lib/builder-run.mjs');
  const { DEFAULTS } = await import('../scripts/lib/profile.mjs');
  assert.ok(builderSettings(structuredClone(DEFAULTS)).permissions.deny.includes('mcp__db-stable'));
});
