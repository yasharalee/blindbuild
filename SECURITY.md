# Security policy

Blindbuild runs an AI agent on your machine with guarded permissions, so security reports matter.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private vulnerability reporting on this repository (Security tab → Report a vulnerability). Include the version, your OS, and steps to reproduce.

You'll get an acknowledgement within 7 days.

## In scope

- Ways the builder can read the plan folder, write outside its working folder, push, deploy, install packages or touch shared resources despite the guards.
- Ways to bypass the locked rules checksum or the approval gates.
- Secrets leaking into logs, results or commits.
