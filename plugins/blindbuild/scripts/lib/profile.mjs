// Project profile (.devteam/profile.json), merged over defaults one level deep.
import { existsSync } from 'node:fs';
import { readText } from './text.mjs';

export const DEFAULTS = Object.freeze({
  format: 1,
  project: { name: '', stage: '', team: 'solo' },
  commands: { gate: '', run: '', lint: '', db_apply: '', db_backup: '' }, // db_*: {file} = the SQL file
  builder: { model: '', allowed_commands: [] },
  stable_copy: 'none',
  database: { kind: 'none', type: '', test_connection: 'db-test', stable_connection: 'db-stable' },
  git: { base_branch: 'base', branch_style: 'neutral', ids_in_commits: false, signing_works_unattended: false },
  approvals: { preset: 'assisted' },
  loop: { max_runs: 8, max_hours: 8, tick_seconds: 30, checkin_minutes: 15, max_parallel_devs: 3 },
  run: { stall_minutes: 10, max_wait_minutes: 30, viewer: 'on' },
  shared_resources: [],
});

export const SUPPORTED_FORMAT = 1;

export function loadProfile(file) {
  const loaded = existsSync(file) ? JSON.parse(readText(file)) : {};
  const merged = structuredClone(DEFAULTS);
  for (const [key, value] of Object.entries(loaded)) {
    const isObject = value && typeof value === 'object' && !Array.isArray(value);
    merged[key] = isObject ? { ...merged[key], ...value } : value;
  }
  if (merged.format !== SUPPORTED_FORMAT) {
    throw new Error(`blindbuild: profile format ${merged.format} is not supported (expected ${SUPPORTED_FORMAT}). Run the migrate step.`);
  }
  return merged;
}

export const protectedBranches = (profile) => ['main', 'master', profile.git.base_branch].filter(Boolean);
