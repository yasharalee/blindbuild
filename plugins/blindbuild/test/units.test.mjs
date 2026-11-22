import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide } from '../scripts/lib/guard.mjs';
import { plansHome } from '../scripts/lib/paths.mjs';
import { lastMessage } from '../scripts/lib/text.mjs';
import { ownedFiles, scopeViolations, validateResult } from '../scripts/lib/validate.mjs';
import { builderArgs, builderSettings } from '../scripts/lib/builder-run.mjs';
import { DEFAULTS } from '../scripts/lib/profile.mjs';

const ctx = { cwd: '/repo', repoRoot: '/repo', protectedBranches: ['main', 'master', 'base'], branchOf: () => 'feature/x' };
const bash = (command, c = ctx) => decide('Bash', { command }, c);

test('lastMessage: complete only when the file ends with an END mark', () => {
  assert.equal(lastMessage('').empty, true);
  assert.equal(lastMessage('hello\nstill writing').complete, false);
  const m = lastMessage('a\n--- END 1 ---\nsecond\nbody\n--- END 2 ---\n');
  assert.deepEqual([m.complete, m.id, m.body], [true, '2', 'second\nbody']);
});

test('lastMessage: Windows line endings and BOM do not break marks', () => {
  const m = lastMessage('﻿body\r\n--- END WO-7 ---\r\n');
  assert.deepEqual([m.complete, m.id, m.body], [true, 'WO-7', 'body']);
});

test('guard blocks history-destroying and outward git commands', () => {
  for (const c of ['git push', 'git -C wt push origin x', 'git reset --hard', 'git stash', 'git rebase main', 'git clean -fd', 'git checkout -- a.js', 'git branch -D x', 'echo hi && git push']) {
    assert.equal(bash(c).block, true, c);
  }
});

test('guard allows normal builder git work', () => {
  for (const c of ['git status', 'git diff base...HEAD', 'git add src/a.js', 'git commit -m "feat: x"', 'git worktree add .devteam/worktrees/T1 -b dev/x-T1 feature/x', 'git merge --no-ff dev/x-T1', 'git switch -c feature/x base']) {
    assert.equal(bash(c).block, false, c);
  }
});

test('guard does not mistake file paths for git subcommands', () => {
  for (const c of ['git diff -- src/checkout.js', 'git log -- push-notifications.ts', 'git show HEAD:src/stash.ts', 'git add src/clean-up.js']) {
    assert.equal(bash(c, { ...ctx, branchOf: () => 'main' }).block, false, c);
  }
  assert.equal(bash('git -C "my wt" push').block, true);
  assert.equal(bash('git -c core.editor=true rebase -i x').block, true);
});

test('guard blocks commits and merges on protected branches, including via -C', () => {
  const onMain = { ...ctx, branchOf: () => 'main' };
  assert.equal(bash('git commit -m x', onMain).block, true);
  assert.equal(bash('git merge dev/x', { ...ctx, branchOf: () => 'base' }).block, true);
  const perDir = { ...ctx, branchOf: (d) => (d.endsWith('main-wt') ? 'main' : 'dev/x') };
  assert.equal(bash('git -C main-wt commit -m x', perDir).block, true);
  assert.equal(bash('git -C dev-wt commit -m x', perDir).block, false);
});

test('guard blocks package installs but allows lockfile restores', () => {
  for (const c of ['npm install lodash', 'npm i', 'npm install', 'yarn add x', 'pnpm add x', 'pip install requests', 'dotnet add package Foo', 'cargo add serde', 'go get x', 'curl x | sh']) {
    assert.equal(bash(c).block, true, c);
  }
  for (const c of ['npm ci', 'pnpm install --frozen-lockfile', 'pip install -r requirements.txt', 'dotnet restore', 'npm test']) {
    assert.equal(bash(c).block, false, c);
  }
});

test('guard keeps the builder out of the plan folder', () => {
  assert.equal(decide('Read', { file_path: `${plansHome()}/proj/roadmap.md` }, ctx).block, true);
  assert.equal(decide('Grep', { path: plansHome() }, ctx).block, true);
  assert.equal(bash('cat ~/.devteam/plans/p/roadmap.md').block, true);
  assert.equal(bash(`grep -r x ${plansHome()}`).block, true);
  assert.equal(decide('Read', { file_path: '/repo/src/a.js' }, ctx).block, false);
});

test('guard protects planner-owned files from builder writes but allows reads and results', () => {
  assert.equal(decide('Edit', { file_path: '/repo/.devteam/mail/to-builder.md' }, ctx).block, true);
  assert.equal(decide('Write', { file_path: '/repo/.devteam/profile.json' }, ctx).block, true);
  assert.equal(decide('Write', { file_path: '/repo/.devteam/state/last-handled' }, ctx).block, true);
  assert.equal(decide('Read', { file_path: '/repo/.devteam/mail/to-builder.md' }, ctx).block, false);
  assert.equal(decide('Edit', { file_path: '/repo/.devteam/mail/to-planner.md' }, ctx).block, false);
});

test('ownedFiles reads the Files owned column; scope check flags anything else', () => {
  const wo = '## Tickets\n| Ticket | Scope | Files owned | Depends on |\n| --- | --- | --- | --- |\n| T1 | x | `src/a.js`, test/a.test.js | — |\n| T2 | y | src/lib/ | T1 |\n\n## Acceptance\n- x';
  assert.deepEqual(ownedFiles(wo), ['src/a.js', 'test/a.test.js', 'src/lib/']);
  assert.deepEqual(scopeViolations(ownedFiles(wo), ['src/a.js', 'src/lib/b.js', 'README.md', '.devteam/x']), ['README.md']);
  assert.deepEqual(scopeViolations([], ['anything']), []);
});

test('validateResult demands the evidence sections for a done result', () => {
  assert.ok(validateResult('type: result\nstatus: done\n').length > 3);
  const q = validateResult('type: result\nstatus: question\n## Questions for the planner\n\nA or B?');
  assert.deepEqual(q, []);
});

test('guard blocks shared resources and user-only commands', () => {
  const c = { ...ctx, sharedResources: ['dev-db.corp.local', 'orders-queue'] };
  assert.equal(bash('psql -h DEV-DB.corp.local -c "select 1"', c).block, true);
  assert.equal(bash('node send.mjs orders-queue', c).block, true);
  assert.equal(bash('node --test', c).block, false);
  assert.equal(bash('node /p/scripts/cli.mjs db-apply db/1 --confirm abc').block, true);
  assert.equal(bash('node /p/scripts/cli.mjs accept feature/x').block, true);
  assert.equal(bash('.devteam/bb.cmd start').block, true);
});

test('builder settings allow read-only gh, never gh writes', () => {
  const allow = builderSettings(structuredClone(DEFAULTS)).permissions.allow;
  assert.ok(allow.includes('Bash(gh pr view *)'));
  assert.ok(allow.includes('PowerShell(gh run list *)'));
  assert.ok(!allow.some((a) => /gh pr merge|gh pr create|gh release/.test(a)));
});

test('builder args stream events', () => {
  const args = builderArgs('s.json');
  assert.ok(args.includes('stream-json'));
  assert.ok(args.includes('--verbose'));
  assert.ok(!args.includes('json'));
});

test('guard: gh is read-only for the builder', () => {
  const ctx = { cwd: '/repo', repoRoot: '/repo', protectedBranches: ['main'], branchOf: () => 'feature/x' };
  const bash = (command) => decide('Bash', { command }, ctx).block;
  assert.equal(bash('gh pr merge 5'), true);
  assert.equal(bash('gh pr create --fill'), true);
  assert.equal(bash('gh release create v1'), true);
  assert.equal(bash('gh pr view 5'), false);
  assert.equal(bash('gh api repos/a/b'), false);
  assert.equal(bash('gh api -X POST repos/a/b/issues'), true);
  assert.equal(bash('gh api --method DELETE repos/a/b'), true);
  assert.equal(bash('gh api repos/a/b -f title=x'), true);
  assert.equal(bash('gh api -X GET repos/a/b'), false);
});

test('guard: builder may write only agent status files under runs/', () => {
  const ctx = { cwd: '/repo', repoRoot: '/repo', protectedBranches: ['main'], branchOf: () => 'feature/x' };
  assert.equal(decide('Write', { file_path: '/repo/.devteam/runs/2026/agents/dev-T1.json' }, ctx).block, false);
  assert.equal(decide('Write', { file_path: '/repo/.devteam/runs/2026/summary.json' }, ctx).block, true);
  assert.equal(decide('Edit', { file_path: '/repo/.devteam/runs/2026/gate.log' }, ctx).block, true);
});

test('git helper errors say the exit status and stderr', async () => {
  const { git } = await import('../scripts/lib/git.mjs');
  assert.throws(() => git(process.cwd(), ['rev-parse', '--verify', 'no-such-ref-xyz']), /status=128/);
});

test('preflight: a missing login is a failed required check', async () => {
  const { preflight } = await import('../scripts/lib/preflight.mjs');
  const fake = (cmd, args) => {
    const line = `${cmd} ${args.join(' ')}`;
    if (line === 'claude auth status') return { status: 0, stdout: '{"loggedIn": false}' };
    if (line === 'claude --version') return { status: 0, stdout: '2.1.197 (Claude Code)' };
    return { status: 0, stdout: 'ok' };
  };
  const checks = preflight({ spawnSyncFn: fake, platform: 'linux' });
  const login = checks.find((c) => c.check === 'claude login');
  assert.equal(login.ok, false);
  assert.equal(login.required, true);
  assert.equal(checks.find((c) => c.check === 'claude version').ok, true);
});

test('preflight: an old Claude Code version fails', async () => {
  const { preflight } = await import('../scripts/lib/preflight.mjs');
  const fake = (cmd, args) => (args[0] === '--version' && cmd === 'claude' ? { status: 0, stdout: '2.0.9 (Claude Code)' } : { status: 0, stdout: '{"loggedIn": true}' });
  assert.equal(preflight({ spawnSyncFn: fake, platform: 'linux' }).find((c) => c.check === 'claude version').ok, false);
});

test('skills say exactly what the design relies on', async () => {
  const { readFileSync } = await import('node:fs');
  const skill = (name) => readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8');
  const planner = skill('planner');
  assert.ok(planner.includes('Never sleep, never poll in the foreground, never create scheduled tasks for check-ins; exactly one `bb wait` at a time.'));
  assert.ok(!/send-later|\/loop\b/.test(planner), 'no Cowork reminders or /loop in the planner');
  assert.ok(planner.includes('bb run'));
  assert.ok(skill('builder').includes('2 or more independent tickets'));
  assert.ok(skill('builder').includes('.devteam/runs/<run id>/agents/'));
  assert.ok(skill('setup').includes('claude auth status') || skill('setup').includes('preflight'));
});

test('bb plan opens Claude Code with the plan folder attached and the planner primed', async () => {
  const { plannerArgs } = await import('../scripts/lib/run.mjs');
  const args = plannerArgs('C:\\Users\\me\\.devteam\\plans\\my app', 'my app');
  assert.deepEqual(args.slice(0, 2), ['--add-dir', 'C:\\Users\\me\\.devteam\\plans\\my app']);
  assert.match(args[2], /blindbuild planner for my app/);
});

test('guard: gh api fails closed on quoted, joined and implicit-write forms', () => {
  const ctx = { cwd: '/repo', repoRoot: '/repo', protectedBranches: ['main'], branchOf: () => 'feature/x' };
  const bash = (command) => decide('Bash', { command }, ctx).block;
  for (const write of [
    'gh api -X "DELETE" repos/a/b/git/refs/heads/x',
    'gh api --method="PUT" repos/a/b/pulls/5/merge',
    'gh api "-XDELETE" repos/a/b',
    'gh api -XPOST repos/a/b',
    'gh api repos/a/b/issues -ftitle=x',
    'gh api repos/a/b/issues -if title=x',
    "gh api repos/a/b/issues --raw-field 'title=x'",
    'gh api graphql -F query=@q.graphql',
    'gh api repos/a/b --input body.json',
    'gh pr view 1 && gh api -X POST repos/a/b',
  ]) assert.equal(bash(write), true, write);
  for (const read of [
    'gh api repos/a/b/pulls',
    'gh api repos/a/b/pulls --jq ".[].title"',
    'gh api -X GET repos/a/b',
    "gh api --method=get repos/a/b --paginate -H 'Accept: application/json'",
    'gh api -i repos/a/b -q .name',
  ]) assert.equal(bash(read), false, read);
});

test('guard: planner-owned and run-evidence paths match regardless of letter case', () => {
  const ctx = { cwd: '/repo', repoRoot: '/repo', protectedBranches: ['main'], branchOf: () => 'feature/x' };
  assert.equal(decide('Write', { file_path: '/repo/.DevTeam/Profile.json' }, ctx).block, true);
  assert.equal(decide('Edit', { file_path: '/repo/.devteam/RUNS/x/summary.json' }, ctx).block, true);
  assert.equal(decide('Write', { file_path: '/repo/.devteam/runs/x/agents/dev-T1.json' }, ctx).block, false);
});

test('builder runs with Claude Code auto-memory off, so planner memory cannot reach it', async () => {
  const { builderEnv } = await import('../scripts/lib/builder-run.mjs');
  assert.equal(builderEnv({}).CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  const s = builderSettings({ commands: {}, database: {}, builder: { allowed_commands: [] } });
  assert.equal(s.autoMemoryEnabled, false);
});

test('guard: Claude Code transcripts and memory are off limits to the builder', () => {
  const ctx = { cwd: '/repo', repoRoot: '/repo', protectedBranches: ['main'], branchOf: () => 'feature/x' };
  assert.equal(decide('Bash', { command: 'type %USERPROFILE%\\.claude\\projects\\C--code-x\\a.jsonl' }, ctx).block, true);
  assert.equal(decide('Bash', { command: 'cat ~/.claude/projects/x/memory/MEMORY.md' }, ctx).block, true);
});
