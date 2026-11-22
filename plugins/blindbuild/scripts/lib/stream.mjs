// Reads Claude Code's stream-json output (`claude -p --output-format stream-json --verbose`).
// Pure parsing shared by the supervisor, the waiter and the viewer. Unknown event types are kept as kind 'other', never thrown on.
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';

const AGENT_LABEL = /^(dev-|reviewer|db-)/;
const short = (s, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

// Parser memory across lines: which tool call spawned which agent, and what each tool call ran.
export const newContext = () => ({ labels: new Map(), tools: new Map(), spawned: 0 });

const toolText = (name, input = {}) => {
  if (input.command) return String(input.command);
  if (name === 'Agent' || name === 'Task') return `spawn ${input.description || 'agent'}`;
  if (input.file_path) return `${name} ${input.file_path}`;
  if (input.pattern) return `${name} ${input.pattern}`;
  return name;
};

const resultText = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : c.text || '')).join(' ');
  return '';
};

export function parseLine(line, ctx = newContext()) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  let e;
  try { e = JSON.parse(raw); } catch { return null; }
  if (!e || typeof e !== 'object') return null;
  const pid = e.parent_tool_use_id;
  const agent = pid ? (ctx.labels.get(pid) || 'subagent') : 'lead';
  const base = { type: e.type, agent, at: e.timestamp || null, kind: 'other', text: '' };
  const blocks = Array.isArray(e.message?.content) ? e.message.content : [];

  if (e.type === 'assistant') {
    const use = blocks.find((b) => b.type === 'tool_use');
    if (use) {
      const text = toolText(use.name, use.input);
      ctx.tools.set(use.id, { tool: use.name, text, agent });
      if (use.name === 'Agent' || use.name === 'Task') {
        const desc = String(use.input?.description || '');
        ctx.spawned += 1;
        ctx.labels.set(use.id, AGENT_LABEL.test(desc) ? desc : `subagent-${ctx.spawned}`);
      }
      return { ...base, kind: 'tool', tool: use.name, toolUseId: use.id, text };
    }
    const said = blocks.find((b) => b.type === 'text');
    if (said) return { ...base, kind: 'text', text: short(said.text), errorCode: e.error || null };
    return base;
  }
  if (e.type === 'user') {
    const res = blocks.find((b) => b.type === 'tool_result');
    if (res) return { ...base, kind: 'tool-result', toolUseId: res.tool_use_id, isError: res.is_error === true, text: short(resultText(res.content)) };
    return base;
  }
  if (e.type === 'system' && e.subtype === 'permission_denied') {
    const used = ctx.tools.get(e.tool_use_id);
    const agentOf = used?.agent || agent;
    return { ...base, agent: agentOf, kind: 'tool-result', toolUseId: e.tool_use_id, isError: true, denied: true, tool: e.tool_name, text: `${e.tool_name}: ${used?.text || ''}`.trim() };
  }
  if (e.type === 'result') {
    const denials = (e.permission_denials || []).map((d) => `${d.tool_name}: ${toolText(d.tool_name, d.tool_input)}`);
    return { ...base, kind: 'result', isError: e.is_error === true, text: String(e.result ?? ''), apiStatus: e.api_error_status ?? null, denials };
  }
  return base;
}

// Reads complete lines from byte `fromByte`. A trailing line without its newline is left for the next read.
export function readEvents(file, fromByte = 0, ctx = newContext()) {
  if (!existsSync(file)) return { events: [], nextByte: fromByte, ctx };
  const size = statSync(file).size;
  if (size <= fromByte) return { events: [], nextByte: fromByte, ctx };
  const buf = Buffer.alloc(size - fromByte);
  const fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, buf.length, fromByte); } finally { closeSync(fd); }
  const lastNewline = buf.lastIndexOf(0x0a);
  if (lastNewline === -1) return { events: [], nextByte: fromByte, ctx };
  const text = buf.subarray(0, lastNewline + 1).toString('utf8').replace(/^﻿/, '');
  const events = text.split('\n').map((l) => parseLine(l, ctx)).filter(Boolean);
  return { events, nextByte: fromByte + lastNewline + 1, ctx };
}

export function summarize(events) {
  const agents = new Map();
  const open = new Map();
  const denials = [];
  let lastResult = null;
  let auth = false;
  for (const e of events) {
    if (e.kind !== 'other') {
      const a = agents.get(e.agent) || { lastText: '', lastAt: null, state: 'working' };
      if (e.text) a.lastText = e.text;
      a.lastAt = e.at || a.lastAt;
      agents.set(e.agent, a);
    }
    if (e.kind === 'tool' && e.tool !== 'Agent' && e.tool !== 'Task') open.set(e.toolUseId, { tool: e.tool, text: e.text, since: e.at, agent: e.agent });
    if (e.kind === 'tool-result') open.delete(e.toolUseId);
    if (e.denied && e.text && !denials.includes(e.text)) denials.push(e.text);
    if (e.errorCode === 'authentication_failed') auth = true;
    if (e.kind === 'result') {
      lastResult = e;
      for (const d of e.denials || []) if (!denials.includes(d)) denials.push(d);
    }
  }
  let outcome = null;
  if (auth || (lastResult?.isError && /not logged in|\/login/i.test(lastResult.text))) outcome = 'auth';
  else if (lastResult?.isError && (lastResult.apiStatus === 429 || /rate limit|usage limit/i.test(lastResult.text))) outcome = 'rate-limit';
  else if (lastResult?.isError) outcome = 'error';
  else if (lastResult) outcome = 'ok';
  const inFlight = [...open.values()].pop() || null;
  return { agents, inFlight, outcome, denials, resultText: lastResult?.text ?? '' };
}
