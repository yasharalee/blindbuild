// Thin git helpers. Nothing here discards work: rescue uses a temporary index and never touches the working tree.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function git(cwd, args, env) {
  try {
    return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    // Say why: a bare "Command failed" hid a Windows-only failure for a whole debugging session.
    e.message = `git ${args.join(' ')} failed in ${cwd} [status=${e.status} signal=${e.signal} code=${e.code}] ${String(e.stderr || '').trim()}`;
    throw e;
  }
}

export const currentBranch = (cwd) => git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
export const headSha = (cwd) => git(cwd, ['rev-parse', 'HEAD']);
export const hasTrackedChanges = (cwd) => git(cwd, ['status', '--porcelain', '--untracked-files=no']) !== '';
export const excludeFile = (cwd) => git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']);

// Files changed by work done since `sha`. Diffs from the merge base, so a builder that switched to a branch
// started elsewhere (e.g. from base) is judged only on its own commits, not on the branch it left.
export function changedFilesSince(cwd, sha) {
  const from = git(cwd, ['merge-base', sha, 'HEAD']);
  const committed = git(cwd, ['diff', '--name-only', `${from}..HEAD`]);
  const pending = git(cwd, ['status', '--porcelain']).split('\n').filter(Boolean).map((l) => l.slice(3));
  return [...new Set([...committed.split('\n').filter(Boolean), ...pending])];
}

// Saves the whole working tree (tracked + untracked, minus ignored) on a new branch without changing anything checked out.
export function rescueBranch(cwd, label) {
  const dir = mkdtempSync(join(tmpdir(), 'blindbuild-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
  try {
    git(cwd, ['read-tree', 'HEAD'], env);
    git(cwd, ['add', '-A'], env);
    const tree = git(cwd, ['write-tree'], env);
    const commit = git(cwd, ['commit-tree', tree, '-p', 'HEAD', '-m', `blindbuild rescue: ${label}`], env);
    const name = `rescue/${label}`;
    git(cwd, ['branch', name, commit]);
    return name;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
