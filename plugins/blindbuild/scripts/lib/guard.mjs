// PreToolUse guard for the builder. Pure decision function + a tiny hook wrapper.
// Active only when the loop started Claude Code as the builder (BLINDBUILD_ROLE=builder), so the planner is never blocked.
import { isAbsolute, normalize as normPath, relative, resolve, sep } from 'node:path';
import { plansHome } from './paths.mjs';

// Matches `git <subcommand>` only in subcommand position (after global options like -C dir), never inside a file path.
const gitSub = (subs) => new RegExp(`\\bgit(?:\\s+(?:-[Cc]\\s+(?:"[^"]*"|'[^']*'|\\S+)|--?[\\w-]+(?:=\\S+)?))*\\s+(?:${subs})(?=\\s|$)`);

const BASH_RULES = [
  [gitSub('push'), 'git push is never allowed for the builder.'],
  [gitSub('reset\\s+--hard|stash|rebase|filter-branch|filter-repo|reflog\\s+expire|gc\\s+--prune'), 'Commands that rewrite history or discard work are blocked.'],
  [gitSub('clean'), 'git clean is blocked: it deletes untracked work.'],
  [gitSub('checkout|restore'), 'git checkout/restore is blocked (they can discard work). Use `git switch -c` for new branches and `git worktree add` for developers.'],
  [gitSub('branch\\s+(?:-D|-d|--delete|-M|-m|--move|-f|--force)'), 'Deleting, renaming or forcing branches is blocked; the planner cleans up.'],
  [/\b(npm|pnpm)\s+(install|i|add|update|up|upgrade)\b(?![^;&|]*--frozen-lockfile)/, 'Package installs are blocked. Restore from the lockfile only (`npm ci`, `pnpm install --frozen-lockfile`). A new package needs the user\'s approval.'],
  [/\byarn\s+(add|upgrade|up)\b/, 'Adding packages is blocked; a new package needs the user\'s approval.'],
  [/\bpip3?\s+install\b(?![^;&|]*\s-r\s)/, 'pip install is allowed only from a requirements file (`pip install -r ...`).'],
  [/\b(dotnet\s+add\s+\S*\s*package|cargo\s+(add|install)|go\s+get|gem\s+install|composer\s+require|poetry\s+add|uv\s+(add|pip\s+install)|bundle\s+add)\b/, 'Adding a dependency is blocked; a new package needs the user\'s approval.'],
  [/\b(apt|apt-get|brew|choco|winget|scoop|snap)\s+install\b/, 'System package installs are blocked.'],
  [/\|\s*(sh|bash|zsh|pwsh|powershell|iex)\b|\bInvoke-Expression\b/, 'Piping downloaded content into a shell is blocked.'],
  [/\bgh\s+(?:pr\s+(?:merge|create|close|edit|ready|review|comment|reopen)|release|repo\s+(?:create|delete|edit|fork|rename|archive)|issue\s+(?:create|close|edit|comment|delete|reopen)|secret|variable|workflow\s+(?:run|enable|disable)|label\s+(?:create|edit|delete))\b/, 'gh can only read for the builder (view, list, diff, checks).'],
  [{ test: (c) => ghApiWrites(c) }, 'gh api is read-only for the builder (GET only, no fields or input).'],
  [/\.claude[\\/]+projects\b/i, 'Claude Code transcripts and memory are off limits to the builder (they hold the planner\'s conversation).'],
  [/\.devteam[\\/]+plans\b|~[\\/]\.devteam\b|%USERPROFILE%[\\/]\.devteam|\$HOME[\\/]\.devteam|\$env:USERPROFILE[\\/]\.devteam/i, 'The plan folder is off limits to the builder.'],
];

// Shell-ish tokenizer: joins quoted parts into one token, emits unquoted ; & | as separators.
function tokens(command) {
  const out = [];
  let cur = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === '"' || ch === "'") {
      const end = command.indexOf(ch, i + 1);
      const stop = end === -1 ? command.length : end;
      cur = (cur ?? '') + command.slice(i + 1, stop);
      i = stop;
    } else if (/\s/.test(ch)) { if (cur !== null) out.push(cur); cur = null; }
    else if (';&|'.includes(ch)) { if (cur !== null) out.push(cur); cur = null; out.push(';'); }
    else cur = (cur ?? '') + ch;
  }
  if (cur !== null) out.push(cur);
  return out;
}

// gh api flags the builder may use. Fail closed: any other flag counts as a write.
const GH_API_VALUE = new Set(['-H', '--header', '-q', '--jq', '-t', '--template', '--cache', '--hostname', '-p', '--preview']);
const GH_API_BOOL = new Set(['--paginate', '-i', '--include', '--silent', '--verbose', '--slurp']);
export function ghApiWrites(command) {
  const t = tokens(command);
  for (let i = 0; i < t.length - 1; i++) {
    if (t[i] !== 'gh' || t[i + 1] !== 'api') continue;
    for (let j = i + 2; j < t.length && t[j] !== ';'; j++) {
      const tok = t[j];
      if (!tok.startsWith('-')) continue;
      const [flag, inline] = tok.startsWith('--') ? [tok.split('=')[0], tok.includes('=') ? tok.slice(tok.indexOf('=') + 1) : null] : [tok.slice(0, 2), tok.length > 2 ? tok.slice(2) : null];
      if (flag === '-X' || flag === '--method') {
        const value = inline ?? t[++j];
        if (String(value).toUpperCase() !== 'GET') return true;
      } else if (GH_API_VALUE.has(flag) && (tok.startsWith('--') || inline === null)) { if (inline === null) j++; }
      else if (GH_API_BOOL.has(tok)) { /* ok */ }
      else return true;
    }
  }
  return false;
}

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep']);
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Files only the planner or the user may change.
const PLANNER_OWNED = ['.devteam/mail/to-builder.md', '.devteam/profile.json', '.devteam/rules.md', '.devteam/state/'];
// Run evidence belongs to the supervisor; agents may only write their own status file.
const AGENT_STATUS = /^\.devteam\/runs\/[^/]+\/agents\/[^/]+\.json$/;

const inside = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

// Returns { block: boolean, reason?: string }. ctx = { cwd, repoRoot, branchOf(dir) -> string, protectedBranches: string[] }
export function decide(toolName, input = {}, ctx) {
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = String(input.command || '');
    for (const [pattern, reason] of BASH_RULES) if (pattern.test(command)) return { block: true, reason };
    if (/\bcli\.mjs\b[^;&|]*\b(accept|db-apply|promote|halt|start)\b|\bbb\.(cmd|ps1|sh)\b/.test(command)) {
      return { block: true, reason: 'Loop, accept, promote and db-apply commands are for the user only.' };
    }
    const shared = (ctx.sharedResources || []).find((r) => r && command.toLowerCase().includes(String(r).toLowerCase()));
    if (shared) return { block: true, reason: `'${shared}' is a shared resource; the builder never touches it. Produce files for the user instead.` };
    if (command.toLowerCase().includes(plansHome().toLowerCase())) return { block: true, reason: 'The plan folder is off limits to the builder.' };
    const writesHistory = gitSub('commit|merge|cherry-pick|revert|am').test(command);
    if (writesHistory) {
      const dirMatch = command.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/);
      const dir = dirMatch ? resolve(ctx.cwd, dirMatch[1].replace(/^["']|["']$/g, '')) : ctx.cwd;
      const branch = ctx.branchOf(dir);
      if (ctx.protectedBranches.includes(branch)) {
        return { block: true, reason: `Committing or merging on '${branch}' is blocked. Work only on the feature branch and developer branches.` };
      }
    }
    return { block: false };
  }

  if (FILE_TOOLS.has(toolName)) {
    const raw = input.file_path || input.notebook_path || input.path || '';
    if (!raw) return { block: false };
    const target = normPath(resolve(ctx.cwd, raw));
    if (inside(target.toLowerCase(), plansHome().toLowerCase())) return { block: true, reason: 'The plan folder is off limits to the builder.' };
    if (WRITE_TOOLS.has(toolName)) {
      // Lowercased: Windows and macOS filesystems ignore case, so .DevTeam/Profile.json is the same file.
      const rel = relative(ctx.repoRoot.toLowerCase(), target.toLowerCase()).split(sep).join('/');
      const owned = PLANNER_OWNED.find((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
      if (owned) return { block: true, reason: `${owned} belongs to the planner or the user; the builder may not change it.` };
      if (rel.startsWith('.devteam/runs/') && !AGENT_STATUS.test(rel)) {
        return { block: true, reason: 'Run evidence is written by the supervisor; agents may only write .devteam/runs/<run>/agents/<name>.json.' };
      }
    }
  }
  return { block: false };
}
