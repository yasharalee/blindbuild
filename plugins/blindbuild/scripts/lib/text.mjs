// Mailbox text handling. Everything is normalised to LF first, so Windows CRLF never breaks a mark.
import { existsSync, readFileSync } from 'node:fs';

export const normalize = (s) => s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
export const readText = (file) => (existsSync(file) ? normalize(readFileSync(file, 'utf8')) : '');

const END = /^--- END (.+?) ---[ \t]*$/;

// The last message in a mailbox file. It counts as complete only when the file ENDS with an END mark,
// so a half-written message is never acted on.
export function lastMessage(text) {
  const lines = normalize(text).trimEnd().split('\n');
  const last = lines.at(-1) ?? '';
  if (lines.length === 1 && last === '') return { empty: true, complete: false, id: null, body: '' };
  const mark = last.match(END);
  if (!mark) return { empty: false, complete: false, id: null, body: '' };
  let start = lines.length - 1;
  while (start > 0 && !END.test(lines[start - 1])) start--;
  return { empty: false, complete: true, id: mark[1].trim(), body: lines.slice(start, -1).join('\n') };
}

// Value of a `key: value` line in a message's front matter (first match wins).
export function frontValue(body, key) {
  const m = body.match(new RegExp(`^${key}:\\s*([^#\\n]*?)\\s*(?:#.*)?$`, 'm'));
  return m ? m[1] : null;
}
