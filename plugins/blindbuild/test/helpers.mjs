// Shared test setup: a throwaway git repo with blindbuild initialised and one work order waiting.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../scripts/lib/loop.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
export const cliPath = join(here, '..', 'scripts', 'cli.mjs');
process.env.BLINDBUILD_CLAUDE_BIN = join(here, 'fixtures', 'fake-claude.mjs');
process.env.BLINDBUILD_NO_NOTIFY = '1'; // no desktop toasts from test runs
if (!process.env.BLINDBUILD_HOME) process.env.BLINDBUILD_HOME = mkdtempSync(join(tmpdir(), 'bb-home-'));

export const WORK_ORDER = `---
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

export const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeRepo(parent = mkdtempSync(join(tmpdir(), 'bb-repo-'))) {
  const repo = parent;
  mkdirSync(repo, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
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
  const profileFile = join(repo, '.devteam/profile.json');
  const profile = JSON.parse(readFileSync(profileFile, 'utf8'));
  profile.commands.gate = 'node --test';
  profile.run = { ...(profile.run || {}), viewer: 'off' };
  writeFileSync(profileFile, JSON.stringify(profile));
  writeFileSync(join(repo, '.devteam/mail/to-builder.md'), WORK_ORDER);
  return repo;
}

// Polls until `file` exists or `ms` passes; returns whether it appeared.
export async function waitForFile(file, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (existsSync(file)) return true; await sleep(100); }
  return false;
}
