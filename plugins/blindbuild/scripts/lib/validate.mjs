// Checks a builder result and the run's scope. Pure functions; the loop decides what to do with the errors.
import { frontValue } from './text.mjs';

export const REQUIRED_DONE_SECTIONS = [
  '## Commits', '## Gate', '## How it was built', '## Reuse check', '## Impact map',
  '## Review', '## Untested paths', '## DB change needed',
];

export function validateResult(body) {
  const errors = [];
  if (frontValue(body, 'type') !== 'result') errors.push('Result front matter must say `type: result`.');
  const status = frontValue(body, 'status');
  if (!['done', 'question', 'blocked', 'partial', 'failed'].includes(status)) errors.push(`Unknown result status '${status}'.`);
  if (status === 'done') {
    for (const heading of REQUIRED_DONE_SECTIONS) {
      if (!body.split('\n').some((line) => line.trim() === heading)) errors.push(`Missing section: ${heading}`);
    }
    if (!/^- Outcome:\s*PASSED\b/m.test(body)) errors.push('A done result needs `- Outcome: PASSED` under ## Gate.');
  }
  if (status === 'question' && !/^## Questions for the planner\s*\n+\s*\S/m.test(body)) {
    errors.push('A question result must list the question under ## Questions for the planner.');
  }
  return errors;
}

// Paths in the "Files owned" column (3rd) of the ## Tickets table. A path ending in / owns a whole folder.
export function ownedFiles(workOrderBody) {
  const section = workOrderBody.split(/^## /m).find((s) => s.startsWith('Tickets'));
  if (!section) return [];
  const rows = section.split('\n').filter((l) => l.trim().startsWith('|')).slice(2);
  return rows.flatMap((row) => (row.split('|')[3] || '').split(/[,\s]+/))
    .map((p) => p.replace(/`/g, '').trim().replace(/^\.\//, ''))
    .filter((p) => p && p !== '—' && p !== '-');
}

export function scopeViolations(owned, changed) {
  if (owned.length === 0) return [];
  return changed.filter((file) => !file.startsWith('.devteam/')
    && !owned.some((o) => (o.endsWith('/') ? file.startsWith(o) : file === o)));
}
