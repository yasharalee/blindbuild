// Where everything lives. One place, so no other module builds a path by hand.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const blindbuildHome = () => process.env.BLINDBUILD_HOME || join(homedir(), '.devteam');
export const plansHome = () => join(blindbuildHome(), 'plans');
export const pluginRootRecord = () => join(blindbuildHome(), 'plugin-root.txt');

export function repoRoot(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('blindbuild: not inside a git repository. Git is required (run `git init` first).');
  }
}

export function devteam(root) {
  const dt = join(root, '.devteam');
  const state = join(dt, 'state');
  return {
    dt,
    mail: join(dt, 'mail'),
    toBuilder: join(dt, 'mail', 'to-builder.md'),
    toPlanner: join(dt, 'mail', 'to-planner.md'),
    templates: join(dt, 'templates'),
    worktrees: join(dt, 'worktrees'),
    runs: join(dt, 'runs'),
    profile: join(dt, 'profile.json'),
    projectRules: join(dt, 'rules.md'),
    state,
    loopLock: join(state, 'loop.json'),
    runLock: join(state, 'run.json'),
    heartbeat: join(state, 'heartbeat'),
    handled: join(state, 'last-handled'),
    currentWorkOrder: join(state, 'current-work-order.md'),
    stopFile: join(state, 'stop'),
    haltFile: join(state, 'halt'),
    pauseFile: join(state, 'pause'), // written by the planner while the user tests in the same folder
  };
}

// Files of one builder run, under .devteam/runs/<id>/.
export const runFiles = (runDir) => ({
  run: join(runDir, 'run.json'),
  stream: join(runDir, 'stream.jsonl'),
  summary: join(runDir, 'summary.json'),
  gateLog: join(runDir, 'gate.log'),
  stderr: join(runDir, 'stderr.log'),
  supervisorLog: join(runDir, 'supervisor.log'), // the detached supervisor's own output, so its crashes are never silent
  agents: join(runDir, 'agents'),
});
