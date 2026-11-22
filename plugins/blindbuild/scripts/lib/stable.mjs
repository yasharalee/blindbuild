// The stable copy: a git worktree beside the repo where the user runs and tests accepted work.
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { git } from './git.mjs';
import { devteam, repoRoot } from './paths.mjs';
import { loadProfile } from './profile.mjs';

export const stablePath = (root) => join(dirname(root), `${basename(root)}-stable`);

// Points the stable copy at `ref` (default: the base branch), creating it on first use. Detached, so no branch is ever moved.
export function promote(ref, cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const profile = loadProfile(devteam(root).profile);
  if (profile.stable_copy !== 'worktree') {
    throw new Error('blindbuild: promote needs "stable_copy": "worktree" in .devteam/profile.json (same-folder mode tests in the repo itself).');
  }
  const target = ref || profile.git.base_branch;
  const sha = git(root, ['rev-parse', '--verify', `${target}^{commit}`]);
  const path = stablePath(root);
  if (!existsSync(path)) git(root, ['worktree', 'add', '--detach', path, sha]);
  else {
    if (git(path, ['status', '--porcelain', '--untracked-files=no']) !== '') {
      throw new Error(`blindbuild: the stable copy at ${path} has local edits; commit or discard them yourself first.`);
    }
    git(path, ['switch', '--detach', sha]);
  }
  console.log(`blindbuild: stable copy at ${path} now runs ${target} (${sha.slice(0, 7)}). Start the app there to test.`);
  return path;
}
