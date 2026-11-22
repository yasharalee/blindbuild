// `bb watch`: a read-only live view of one run — a board of agents, then the activity feed.
// Closing it changes nothing; it can be reopened or replayed at any time.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runFiles } from './paths.mjs';
import { readEvents, summarize } from './stream.mjs';
import { readJson } from './supervisor.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATE = { started: 'working', blocked: 'BLOCKED', done: 'DONE', failed: 'FAILED' };

export function readStatusFiles(runDir) {
  const dir = runFiles(runDir).agents;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(join(dir, f))).filter((s) => s?.agent);
}

export function renderBoard(agents, statusFiles, now = Date.now()) {
  const byAgent = new Map(statusFiles.map((s) => [s.agent, s]));
  const labels = [...new Set([...agents.keys(), ...byAgent.keys()])];
  return labels.map((label) => {
    const live = agents.get(label);
    const status = byAgent.get(label);
    const state = STATE[status?.state] || 'working';
    const text = status && status.state !== 'started' ? status.text : (live?.lastText || status?.text || '');
    const at = Date.parse(status?.at || live?.lastAt || '');
    const ago = Number.isFinite(at) ? `  (${Math.max(0, Math.round((now - at) / 1000))}s ago)` : '';
    return `${`[${label}]`.padEnd(14)} ${state.padEnd(8)} ${text}${ago}`;
  });
}

export function renderEvent(e) {
  if (!e || e.kind === 'other' || !e.text) return null;
  const who = `[${e.agent}]`;
  if (e.denied) return `DENIED ${who} ${e.text}`;
  if (e.kind === 'tool') return `${who} > ${e.text}`;
  if (e.kind === 'tool-result') return e.isError ? `${who} x ${e.text}` : null; // successful results are noise
  if (e.kind === 'result') return `${who} result: ${e.text}`;
  return `${who} ${e.text}`;
}

export async function watch(runDir, { follow = true, out = process.stdout, pollMs = 1000 } = {}) {
  const files = runFiles(runDir);
  const events = [];
  let offset = 0;
  let ctx;
  let lastBoard = '';
  out.write(`blindbuild builder - live view of ${runDir}\nClose this window any time; the builder keeps running.\n\n`);
  for (;;) {
    const read = readEvents(files.stream, offset, ctx);
    offset = read.nextByte;
    ctx = read.ctx;
    events.push(...read.events);
    for (const e of read.events) { const line = renderEvent(e); if (line) out.write(`${line}\n`); }
    const board = renderBoard(summarize(events).agents, readStatusFiles(runDir)).join('\n');
    const states = board.replace(/\s+\(\d+s ago\)/g, '');
    if (follow && board && states !== lastBoard) { out.write(`\n--- agents ---\n${board}\n--------------\n`); lastBoard = states; }
    const summary = readJson(files.summary);
    if (summary || !follow) {
      if (!follow && board) out.write(`\n--- agents ---\n${board}\n`);
      if (summary) {
        for (const err of summary.errors || []) out.write(`! ${err}\n`);
        out.write(`\n=== DONE: ${summary.outcome}${summary.ok ? '' : ' (needs attention)'} ===\n`);
      }
      return summary;
    }
    await sleep(pollMs);
  }
}
