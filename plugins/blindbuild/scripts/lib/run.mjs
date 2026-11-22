// `bb run`: starts a detached supervisor for the pending work order and returns at once.
import { spawn, spawnSync } from 'node:child_process';
import { openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { devteam, plansHome, pluginRoot, repoRoot, runFiles } from './paths.mjs';
import { loadProfile } from './profile.mjs';
import { claudeCommand } from './builder-run.mjs';
import { prepareRun, say, writeLock } from './supervisor.mjs';
import { openViewer as openViewerWindow } from './window.mjs';

const cliPath = join(pluginRoot, 'scripts', 'cli.mjs');

// Is Claude Code logged in? Skipped when tests swap in a fake claude (BLINDBUILD_CLAUDE_BIN), unless forced.
export function checkAuth({ spawnSyncFn = spawnSync, force = false } = {}) {
  if (process.env.BLINDBUILD_CLAUDE_BIN && !force) return { ok: true };
  const res = spawnSyncFn('claude', ['auth', 'status'], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 30_000 });
  try {
    const status = JSON.parse(String(res.stdout || '').trim());
    if (status.loggedIn === true) return { ok: true };
    return { ok: false, reason: 'Claude Code is not logged in. Run `claude`, type /login, finish in the browser, then try again.' };
  } catch {
    return { ok: false, reason: `could not check the Claude Code login (\`claude auth status\` said: ${String(res.stderr || res.stdout || res.error?.message || 'nothing').trim().slice(0, 200)}).` };
  }
}

// Throws a plain-English reason when it can't start. Returns { runId, runDir, pid }.
export function launch(cwd = process.cwd(), { openViewer = true, spawnFn = spawn, viewerFn = null } = {}) {
  const root = repoRoot(cwd);
  const p = devteam(root);
  const profile = loadProfile(p.profile);
  const auth = checkAuth();
  if (!auth.ok) throw new Error(auth.reason);
  const run = prepareRun(root);
  const lock = { runDir: run.runDir, runId: run.runId, message: run.message, startedAt: run.startedAt };
  // Lock first (held by this process), so a second launch refuses even before the supervisor is up.
  writeLock(p.runLock, { ...lock, pid: process.pid });
  const child = spawnFn(process.execPath, [cliPath, 'supervise', run.runDir], {
    cwd: root, detached: true, windowsHide: true, env: process.env,
    stdio: ['ignore', openSync(runFiles(run.runDir).supervisorLog, 'a'), openSync(runFiles(run.runDir).supervisorLog, 'a')],
  });
  child.unref();
  writeLock(p.runLock, { ...lock, pid: child.pid });
  say(`run ${run.runId} started for ${run.message} (supervisor pid ${child.pid}). Wait for it: bb wait ${run.runId}`);
  if (openViewer && profile.run.viewer !== 'off') {
    const opened = (viewerFn || ((dir) => openViewerWindow(dir, { cliPath })))(run.runDir);
    if (!opened) say(`watch it live: bb watch ${run.runId}`);
  }
  return { runId: run.runId, runDir: run.runDir, pid: child.pid };
}

// `bb plan`: the planner is an interactive Claude Code session in the repo, with the plan folder attached.
export const plannerArgs = (planDir, project) => ['--add-dir', planDir, `Use the blindbuild planner for ${project}.`];

export function openPlanner(cwd = process.cwd(), { spawnSyncFn = spawnSync } = {}) {
  const root = repoRoot(cwd);
  const project = loadProfile(devteam(root).profile).project.name;
  const planDir = join(plansHome(), project || '-');
  if (!project || !existsSync(planDir)) throw new Error(`no plan folder for this project (${planDir}). Run /blindbuild:setup in Claude Code first.`);
  const { file, args, shell } = claudeCommand(plannerArgs(planDir, project)); // quotes spaces for the Windows .cmd shim
  const res = spawnSyncFn(file, args, { cwd: root, stdio: 'inherit', shell });
  return res.status ?? 1;
}
