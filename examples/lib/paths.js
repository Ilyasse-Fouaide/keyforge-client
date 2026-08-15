// Shared filesystem locations for the examples/ suite's runtime state.
// Distinct from the library's own default `.keyforge-client/` storage path,
// so it's obvious this is example-run scaffolding, not library behavior.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const examplesDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const stateDir = path.join(examplesDir, '.state');
export const statePath = path.join(stateDir, 'state.json');
export const fixturesPath = path.join(stateDir, 'fixtures.json');
