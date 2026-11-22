// What must be true on this machine before blindbuild can run unattended. Reports only; never installs anything.
import { spawnSync } from 'node:child_process';
import { checkAuth } from './run.mjs';

export const MIN_CLAUDE = [2, 1, 197]; // the version blindbuild 0.6 was tested on

const newerOrSame = (v, min) => {
  for (let i = 0; i < min.length; i += 1) if ((v[i] || 0) !== min[i]) return (v[i] || 0) > min[i];
  return true;
};

export function preflight({ spawnSyncFn = spawnSync, platform = process.platform } = {}) {
  const shell = platform === 'win32';
  const run = (cmd, args) => spawnSyncFn(cmd, args, { encoding: 'utf8', shell, timeout: 30_000 });
  const checks = [];
  const add = (check, ok, detail, required = true) => checks.push({ check, ok, detail, required });

  const [major] = process.versions.node.split('.').map(Number);
  add('node', major >= 18, `Node.js ${process.versions.node} (needs 18+)`);
  const gitRes = run('git', ['--version']);
  add('git', gitRes.status === 0, gitRes.status === 0 ? String(gitRes.stdout).trim() : 'git not found: install Git');

  const ver = run('claude', ['--version']);
  const match = String(ver.stdout || '').match(/(\d+)\.(\d+)\.(\d+)/);
  const parts = match ? match.slice(1).map(Number) : null;
  add('claude version', Boolean(parts && newerOrSame(parts, MIN_CLAUDE)),
    parts ? `Claude Code ${parts.join('.')} (tested on ${MIN_CLAUDE.join('.')}+)` : 'Claude Code not found: install it first');

  const auth = checkAuth({ spawnSyncFn, force: true });
  add('claude login', auth.ok, auth.ok ? 'logged in' : auth.reason);

  const gh = run('gh', ['auth', 'status']);
  add('gh login', gh.status === 0, gh.status === 0 ? 'GitHub CLI logged in' : 'GitHub CLI missing or not logged in: the builder can still work, without reading PRs or CI runs', false);

  if (platform === 'win32') {
    const wt = spawnSyncFn('where', ['wt'], { encoding: 'utf8' });
    add('Windows Terminal', wt.status === 0, wt.status === 0 ? 'found: the live viewer opens in a tab' : 'not found: the viewer falls back to a plain console window', false);
  }
  return checks;
}
