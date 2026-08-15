#!/usr/bin/env node
// examples/run-all.js — runs setup, all scenarios in order, and teardown,
// then prints a pass/fail summary. Each step is spawned as its own `node`
// child process (not an in-process function call) — this matters
// specifically for 02-reboot-offline-check.js, whose "new process" claim
// needs to be genuinely true even when driven by this orchestrator.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const examplesDir = path.dirname(fileURLToPath(import.meta.url));

const scenarioFiles = [
  '01-first-activation.js',
  '02-reboot-offline-check.js',
  '03-background-refresh.js',
  '04-revoked-license.js',
  '05-deactivate-and-reactivate.js',
  '06-tampered-state-rejection.js',
];

function runStep(scriptPath) {
  const label = path.basename(scriptPath);
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, [scriptPath], { stdio: 'inherit' });
  const ok = result.status === 0;
  console.log(`=== ${label}: ${ok ? 'PASS' : 'FAIL'} ===`);
  return { label, ok };
}

function main() {
  const summary = [];

  const setupResult = runStep(path.join(examplesDir, 'setup-fixtures.js'));
  summary.push(setupResult);

  if (setupResult.ok) {
    for (const file of scenarioFiles) {
      const result = runStep(path.join(examplesDir, 'scenarios', file));
      summary.push(result);
      if (!result.ok) break; // later scenarios assume earlier ones succeeded
    }
  } else {
    console.error('\nsetup-fixtures.js failed — skipping scenarios.');
  }

  // Always attempt teardown, even after a failure above: sweepFixtures()
  // discovers fixtures by name prefix, so it cleans up partial state safely
  // regardless of where the run stopped.
  summary.push(runStep(path.join(examplesDir, 'teardown-fixtures.js')));

  console.log('\n=== Summary ===');
  for (const { label, ok } of summary) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  }

  process.exitCode = summary.every((s) => s.ok) ? 0 : 1;
}

main();
