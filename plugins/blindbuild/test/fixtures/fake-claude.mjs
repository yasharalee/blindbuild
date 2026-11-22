// Stand-in for `claude -p` in tests. Behaviour is chosen by FAKE_MODE.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const mode = process.env.FAKE_MODE || 'done';
const prompt = readFileSync(0, 'utf8'); // consume the prompt from stdin, like the real CLI
if (process.env.BLINDBUILD_ROLE !== 'builder') process.exit(3);
const streaming = process.argv.includes('stream-json');
const emit = (event) => { if (streaming) process.stdout.write(`${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`); };
const say = (text) => emit({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } });
const finish = (isError = false, text = 'finished') => emit({ type: 'result', subtype: 'success', is_error: isError, result: text, permission_denials: [] });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
emit({ type: 'system', subtype: 'init', session_id: 'fake' });
say(`prompt: ${prompt.trim().slice(0, 80)}`);
if (mode === 'auth') {
  emit({ type: 'assistant', parent_tool_use_id: null, error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } });
  finish(true, 'Not logged in · Please run /login');
  process.exit(1);
}
if (mode === 'slow') {
  const lines = Number(process.env.FAKE_LINES || 5);
  for (let i = 1; i <= lines; i += 1) { say(`working step ${i}`); await pause(Number(process.env.FAKE_INTERVAL_MS || 200)); }
}
if (mode === 'long-tool') {
  emit({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'tool-long', name: 'Bash', input: { command: 'npm test' } }] } });
  await pause(Number(process.env.FAKE_SLEEP_MS || 1000));
  emit({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'tool-long', content: 'tests passed' }] } });
}
const git = (...args) => execFileSync('git', args, { stdio: 'ignore' });

const result = (status, extra = '') => `---
format: 1
type: result
work-order: WO-0001
status: ${status}
---

# Result

## Commits
| Hash | Area | Message |
| --- | --- | --- |

## Gate
- Command: node --test
- Outcome: PASSED, 1 test, 1 s

## How it was built
alone

## Reuse check
none found

## Impact map
| Caller | Test |
| --- | --- |

## Review
clean

## Untested paths
none

## DB change needed
no
${extra}
--- END RESULT WO-0001 ---
`;

if (mode === 'crash') process.exit(1);
if (mode === 'done' || mode === 'outside' || mode === 'slow' || mode === 'long-tool') {
  writeFileSync('src/greet.mjs', 'export const greet = (n) => `Hello, ${n}`;\n');
  if (mode === 'outside') writeFileSync('README.md', 'changed outside scope\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feat(greet): add greet');
  appendFileSync('.devteam/mail/to-planner.md', result('done'));
}
if (mode === 'question') {
  appendFileSync('.devteam/mail/to-planner.md', result('question', '\n## Questions for the planner\n\nWhich greeting? A) Hello B) Hi. Recommend A.\n'));
}
if (mode === 'bad-result') appendFileSync('.devteam/mail/to-planner.md', '---\ntype: result\nstatus: done\n---\n# nothing\n--- END RESULT WO-0001 ---\n');
// mode 'silent': write nothing
if (mode === 'done-no-commit') appendFileSync('.devteam/mail/to-planner.md', result('done'));
if (mode === 'rewrite') {
  writeFileSync('src/greet.mjs', 'export const greet = (n) => `Hi, ${n}`;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feat(greet): add greet');
  writeFileSync('.devteam/mail/to-planner.md', result('done')); // replaces instead of appending
}
if (mode === 'switch-from-base') {
  git('switch', '-q', '-c', 'feature/other', 'main');
  mkdirSync('src', { recursive: true });
  writeFileSync('src/greet.mjs', 'export const greet = (n) => `Hello, ${n}`;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feat(greet): add greet');
  appendFileSync('.devteam/mail/to-planner.md', result('done'));
}
finish(mode === 'crash');
