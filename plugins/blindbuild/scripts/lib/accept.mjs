// "Accept & merge to base": the only way accepted work reaches the base branch. Run by the user (or on their approval).
import { rmSync } from 'node:fs';
import { currentBranch, git, hasTrackedChanges } from './git.mjs';
import { devteam, repoRoot } from './paths.mjs';
import { loadProfile } from './profile.mjs';

const branchExists = (root, name) => {
  try { git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]); return true; } catch { return false; }
};

export function accept(branch, cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const profile = loadProfile(devteam(root).profile);
  const base = profile.git.base_branch;
  if (!branch) throw new Error('blindbuild: accept needs the feature branch name, e.g. `accept feature/login`.');
  if (['main', 'master', base].includes(branch)) throw new Error(`blindbuild: '${branch}' can't be accepted into ${base}.`);
  for (const name of [branch, base]) if (!branchExists(root, name)) throw new Error(`blindbuild: branch '${name}' does not exist.`);
  if (hasTrackedChanges(root)) throw new Error('blindbuild: commit or put away your changes first; accept needs a clean folder.');

  const back = currentBranch(root);
  git(root, ['switch', '--quiet', base]);
  try {
    git(root, ['merge', '--no-ff', '--quiet', '-m', `Merge ${branch} into ${base}`, branch]);
  } catch (e) {
    try { git(root, ['merge', '--abort']); } catch { /* nothing to abort */ }
    git(root, ['switch', '--quiet', back]);
    throw new Error(`blindbuild: merging ${branch} into ${base} conflicts; nothing was changed. Ask the planner for a fix work order. (${e.message.split('\n')[0]})`);
  }
  const tag = `accepted/${branch.replace(/[^\w.-]+/g, '-')}`;
  git(root, ['tag', '-f', tag]);
  git(root, ['switch', '--quiet', back]);
  rmSync(devteam(root).pauseFile, { force: true });
  console.log(`blindbuild: ${branch} merged into ${base} and tagged ${tag}. main was not touched; nothing was pushed.`);
  return tag;
}
