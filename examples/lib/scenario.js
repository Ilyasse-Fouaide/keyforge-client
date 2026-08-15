// Small shared harness for the scenario scripts: loading the fixtures
// setup-fixtures.js wrote, a friendly precondition check for scripts that
// need an earlier scenario to have already run, and a PASS/FAIL checker
// mirroring the Keyforge server repo's own e2e/dashboard-smoke.js convention
// (plain console.log lines, no test framework).

import { access, constants, readFile } from 'node:fs/promises';

import { fixturesPath, statePath } from './paths.js';

export async function loadFixtures() {
  try {
    return JSON.parse(await readFile(fixturesPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        'examples/.state/fixtures.json not found — run "node examples/setup-fixtures.js" first.',
        { cause: err },
      );
    }
    throw err;
  }
}

export async function loadPublicKeys(fixtures) {
  const pem = await readFile(fixtures.publicKeyPath, 'utf8');
  return { [fixtures.keyVersion]: pem };
}

/** @param {string} hintScript e.g. "01-first-activation.js" */
export async function requireExistingState(hintScript) {
  try {
    await access(statePath, constants.F_OK);
  } catch {
    throw new Error(
      `examples/.state/state.json not found — run "node examples/scenarios/${hintScript}" first.`,
    );
  }
}

let failures = 0;

export function check(condition, description) {
  if (condition) {
    console.log(`PASS ${description}`);
  } else {
    failures += 1;
    console.error(`FAIL ${description}`);
  }
}

/** Runs a scenario's async body, reporting PASS/FAIL lines and a summary, and
 * setting a nonzero exit code on any failed check or unexpected error. */
export function run(body) {
  body()
    .then(() => {
      if (failures > 0) {
        console.error(`\n${failures} check(s) failed.`);
        process.exitCode = 1;
      } else {
        console.log('\nAll checks passed.');
      }
    })
    .catch((err) => {
      console.error(`FAIL unexpected error: ${err.stack ?? err.message}`);
      process.exitCode = 1;
    });
}
