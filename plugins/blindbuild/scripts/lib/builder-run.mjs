// Starts one locked-down headless Claude Code run as the builder.
import { spawn, spawnSync } from 'node:child_process';
import { openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginRoot, runFiles } from './paths.mjs';

const isWindows = process.platform === 'win32';

const GIT_ALLOWED = ['status', 'diff', 'log', 'show', 'add', 'commit', 'worktree', 'merge', 'branch', 'switch', 'rev-parse', '-C'];
// Read-only GitHub CLI. The guard blocks every gh write and any non-GET `gh api` call.
export const GH_READ_ONLY = ['gh pr view', 'gh pr list', 'gh pr diff', 'gh pr checks', 'gh run view', 'gh run list', 'gh issue view', 'gh issue list', 'gh repo view', 'gh api'];
const RESTORE_ALLOWED = ['npm ci', 'pnpm install --frozen-lockfile', 'yarn install --immutable', 'dotnet restore', 'pip install -r'];

// Claude Code runs shell commands through its Bash tool, or its PowerShell tool on Windows; allow both.
const allowBash = (cmd) => ['Bash', 'PowerShell'].flatMap((tool) => [`${tool}(${cmd})`, `${tool}(${cmd} *)`]);

export function builderSettings(profile) {
  const commands = [profile.commands.gate, profile.commands.lint, ...profile.builder.allowed_commands].filter(Boolean);
  return {
    permissions: {
      allow: [
        'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent', 'TodoWrite',
        ...GIT_ALLOWED.flatMap((sub) => allowBash(`git ${sub}`)),
        ...RESTORE_ALLOWED.flatMap(allowBash),
        ...GH_READ_ONLY.flatMap(allowBash),
        ...commands.flatMap(allowBash),
      ],
      deny: [
        'Read(~/.devteam/**)', 'Edit(~/.devteam/**)',
        'Read(.env)', 'Read(.env.*)', 'Read(*.pem)', 'Read(*.key)', 'Read(*.pfx)',
        `mcp__${profile.database.stable_connection}`, // the stable/shared database server is never the builder's
        'Edit(.devteam/mail/to-builder.md)', 'Edit(.devteam/profile.json)', 'Edit(.devteam/rules.md)', 'Edit(.devteam/state/**)',
      ],
      blockReadsOutsideWorkingDirectories: true,
    },
    autoMemoryEnabled: false, // auto-memory is per project and shared with the planner's session
  };
}

export const BUILDER_PROMPT = '/blindbuild:builder Process the newest message in .devteam/mail/to-builder.md, following the builder skill exactly.';
export const builderPrompt = (runId) => (runId ? `${BUILDER_PROMPT} Run id: ${runId}.` : BUILDER_PROMPT);

// model: '' keeps the user's Claude Code default; otherwise an alias or ID such as 'sonnet' or 'opus'.
export function builderArgs(settingsFile, model = '') {
  return [
    ...(model ? ['--model', model] : []),
    '-p', '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
    '--settings', settingsFile,
    '--append-system-prompt-file', join(pluginRoot, 'rules', 'core-rules.md'),
    '--output-format', 'stream-json', '--verbose', // live events: the supervisor, waiter and viewer read them
  ];
}

// The claude binary; BLINDBUILD_CLAUDE_BIN overrides it (a .mjs/.js path runs under node — used by tests).
export function claudeCommand(args) {
  const bin = process.env.BLINDBUILD_CLAUDE_BIN || 'claude';
  if (/\.(mjs|js)$/.test(bin)) return { file: process.execPath, args: [bin, ...args], shell: false };
  // npm installs claude as a .cmd shim on Windows, which needs a shell; quote args that contain spaces.
  if (isWindows) return { file: bin, args: args.map((a) => (/\s/.test(a) ? `"${a}"` : a)), shell: true };
  return { file: bin, args, shell: false };
}

// The planner works in this repo too; its Claude Code auto-memory must not load into the builder.
export const builderEnv = (base = process.env) => ({ ...base, BLINDBUILD_ROLE: 'builder', CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });

export function startBuilder({ root, profile, runDir, runId }) {
  const settingsFile = join(runDir, 'settings.json');
  writeFileSync(settingsFile, JSON.stringify(builderSettings(profile), null, 2));
  const { file, args, shell } = claudeCommand(builderArgs(settingsFile, profile.builder.model));
  const child = spawn(file, args, {
    cwd: root,
    shell,
    detached: !isWindows,
    env: builderEnv(),
    stdio: ['pipe', openSync(runFiles(runDir).stream, 'w'), openSync(runFiles(runDir).stderr, 'w')],
  });
  child.stdin.end(builderPrompt(runId));
  return child;
}

export function killTree(pid) {
  if (!pid) return;
  if (isWindows) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try { process.kill(-pid, 'SIGTERM'); } catch { /* group already gone */ }
  }
}
