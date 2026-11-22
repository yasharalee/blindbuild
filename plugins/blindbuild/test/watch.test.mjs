import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeRepo, quiet, waitForFile } from './helpers.mjs';
import { launch } from '../scripts/lib/run.mjs';
import { readEvents } from '../scripts/lib/stream.mjs';
import { renderBoard, renderEvent, watch } from '../scripts/lib/watch.mjs';
import { notify, viewerLaunchers } from '../scripts/lib/window.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/streams/', import.meta.url));

test('board shows BLOCKED from an agent status file', () => {
  const agents = new Map([['dev-T2', { lastText: 'reading config', lastAt: null }]]);
  const lines = renderBoard(agents, [{ agent: 'dev-T2', state: 'blocked', text: 'needs src/config.ts' }], Date.now());
  assert.ok(lines.some((l) => /\[dev-T2\]\s+BLOCKED\s+needs src\/config\.ts/.test(l)), lines.join('\n'));
});

test('denied tool calls render in the DENIED style with the command', () => {
  const { events } = readEvents(join(fixtures, 'real-denied.jsonl'));
  const lines = events.map(renderEvent).filter(Boolean);
  assert.ok(lines.some((l) => l.startsWith('DENIED') && l.includes('gh pr list')), lines.join('\n'));
});

test('unknown events render nothing', () => {
  assert.equal(renderEvent({ kind: 'other', agent: 'lead', text: '' }), null);
});

test('windows launcher keeps the window title as one argument', () => {
  const [wt] = viewerLaunchers('win32', 'node.exe', 'C:\\bb\\cli.mjs', 'C:\\r\\runs\\x');
  assert.equal(wt.file, 'wt');
  assert.ok(wt.args.includes('blindbuild builder'));
});

test('launcher paths with spaces stay single arguments', () => {
  const runDir = 'C:\\My Projects\\app\\.devteam\\runs\\x';
  for (const platform of ['win32', 'linux']) {
    for (const l of viewerLaunchers(platform, 'node', 'C:\\bb\\cli.mjs', runDir)) assert.ok(l.args.includes(runDir), `${platform} ${l.file}`);
  }
  const [mac] = viewerLaunchers('darwin', '/usr/bin/node', '/bb/cli.mjs', '/My Projects/app/.devteam/runs/x');
  assert.match(mac.args.join(' '), /'\/My Projects\/app\/\.devteam\/runs\/x'/);
});

test('watch replays a finished run and ends with the outcome', async () => {
  process.env.FAKE_MODE = 'slow';
  const repo = makeRepo();
  const { runDir } = quiet(() => launch(repo, { openViewer: false }));
  assert.ok(await waitForFile(join(runDir, 'summary.json')));
  let out = '';
  await watch(runDir, { follow: false, out: { write: (s) => { out += s; } } });
  assert.match(out, /working step 3/);
  assert.match(out.trim(), /=== DONE: done ===$/);
  assert.ok(readFileSync(join(runDir, 'summary.json'), 'utf8'));
});

test('notify never throws', () => {
  assert.doesNotThrow(() => notify('t', 'x', { platform: 'win32', spawnFn: () => { throw new Error('no'); } }));
});
