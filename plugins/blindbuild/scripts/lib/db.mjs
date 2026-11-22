// Applies an approved database change. Approval = the user typing the first 8 characters of the files' hash,
// so a single changed character in the SQL voids it. Local databases only; never shared or remote ones.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { devteam, repoRoot } from './paths.mjs';
import { loadProfile } from './profile.mjs';
import { readText } from './text.mjs';

export function changeHash(folder) {
  const hash = createHash('sha256');
  for (const name of ['migration.sql', 'rollback.sql']) hash.update(`${name}\n${readText(join(folder, name))}\n`);
  return hash.digest('hex');
}

const run = (command, file, root) => {
  const res = spawnSync(command.replaceAll('{file}', `"${file}"`), { cwd: root, shell: true, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`blindbuild: \`${command}\` failed:\n${res.stdout}${res.stderr}`);
  return `${res.stdout}${res.stderr}`.trim();
};

// args: [folder, '--confirm', '<8 chars>', '--irreversible'?]
export function dbApply(args, cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const profile = loadProfile(devteam(root).profile);
  const [dir] = args;
  if (!dir) throw new Error('blindbuild: db-apply needs the change folder, e.g. `db-apply db/changes/0007-add-roles --confirm <code>`.');
  const folder = resolve(root, dir);
  if (profile.database.kind !== 'local') {
    throw new Error(`blindbuild: database kind is '${profile.database.kind}'. Blindbuild applies changes to local databases only; run ${join(folder, 'migration.sql')} yourself.`);
  }
  if (!profile.commands.db_apply || !profile.commands.db_backup) {
    throw new Error('blindbuild: set commands.db_apply and commands.db_backup in .devteam/profile.json first ({file} = the SQL file).');
  }
  for (const name of ['migration.sql', 'rollback.sql', 'impact.md']) {
    if (!existsSync(join(folder, name))) throw new Error(`blindbuild: ${name} is missing in ${folder}; no rollback or impact summary, no apply.`);
  }
  const code = changeHash(folder).slice(0, 8);
  const given = args[args.indexOf('--confirm') + 1];
  if (!args.includes('--confirm') || given !== code) {
    throw new Error(`blindbuild: not applied. Review ${folder}, then re-run with \`--confirm ${code}\`. The code changes if any SQL changes.`);
  }
  if (/reversible:\s*no/i.test(readText(join(folder, 'impact.md'))) && !args.includes('--irreversible')) {
    throw new Error('blindbuild: impact.md says this change is NOT reversible. Re-run with --irreversible if you are sure.');
  }
  console.log(run(profile.commands.db_backup, join(folder, 'migration.sql'), root));
  console.log(run(profile.commands.db_apply, join(folder, 'migration.sql'), root));
  console.log(`blindbuild: applied ${join(folder, 'migration.sql')} after a backup. Undo with ${join(folder, 'rollback.sql')}.`);
  return code;
}
