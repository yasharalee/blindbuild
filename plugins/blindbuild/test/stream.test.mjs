import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseLine, readEvents, summarize } from '../scripts/lib/stream.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/streams/', import.meta.url));
const real = (name) => readEvents(join(fixtures, `${name}.jsonl`)).events;

test('parseLine ignores unknown types and junk', () => {
  assert.equal(parseLine('{"type":"rate_limit_event"}').kind, 'other');
  assert.equal(parseLine('not json'), null);
  assert.equal(parseLine(''), null);
});

test('readEvents skips a half-written last line, then picks it up', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'bb-stream-')), 'stream.jsonl');
  const full = '{"type":"rate_limit_event"}\n{"type":"rate_limit_event"}\n';
  writeFileSync(file, `${full}{"type":"assist`);
  const first = readEvents(file);
  assert.equal(first.events.length, 2);
  assert.equal(first.nextByte, Buffer.byteLength(full));
  appendFileSync(file, 'ant","message":{"content":[{"type":"text","text":"hi"}]}}\n');
  const second = readEvents(file, first.nextByte);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].text, 'hi');
});

test('subagent events are attributed to the agent that spawned them', () => {
  const events = real('real-subagent');
  assert.ok(events.some((e) => e.agent === 'dev-T1' && e.kind === 'tool' && /node -v/.test(e.text)));
  assert.ok(events.some((e) => e.agent === 'lead' && e.kind === 'tool' && e.tool === 'Agent'));
  const { agents } = summarize(events);
  assert.ok(agents.has('lead') && agents.has('dev-T1'));
});

test('denials are reported with the denied command', () => {
  const { denials } = summarize(real('real-denied'));
  assert.ok(denials.some((d) => d.includes('gh pr list')));
  assert.ok(real('real-denied').some((e) => e.denied && /gh pr list/.test(e.text)));
});

test('auth failure is detected', () => {
  assert.equal(summarize(real('real-auth')).outcome, 'auth');
});

test('a clean run has outcome ok and uses the last result', () => {
  const s = summarize(real('real-subagent'));
  assert.equal(s.outcome, 'ok');
  assert.equal(s.resultText, 'DONE');
});

test('rate limit stop is detected', () => {
  const e = parseLine(JSON.stringify({ type: 'result', is_error: true, api_error_status: 429, result: 'Rate limited' }));
  assert.equal(summarize([e]).outcome, 'rate-limit');
});

test('inFlight is the last tool_use without a result', () => {
  const use = parseLine(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } }));
  const done = parseLine(JSON.stringify({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }));
  const open = summarize([use]).inFlight;
  assert.equal(open.tool, 'Bash');
  assert.match(open.text, /npm test/);
  assert.equal(summarize([use, done]).inFlight, null);
});
