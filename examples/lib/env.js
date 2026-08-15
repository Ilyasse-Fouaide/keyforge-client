// Loads examples/.env (best-effort — falls back to already-exported shell env
// vars if it doesn't exist) and validates the config this suite needs.
// Uses Node's built-in `process.loadEnvFile`, no `dotenv` dependency, matching
// this repo's existing dependency-light stance.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const examplesDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

try {
  process.loadEnvFile(path.join(examplesDir, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const required = ['KEYFORGE_ADMIN_EMAIL', 'KEYFORGE_ADMIN_PASSWORD', 'KEYFORGE_PUBLIC_KEY_PATH'];

export function loadConfig() {
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(', ')}. ` +
        `Copy examples/.env.example to examples/.env and fill them in (see examples/README.md).`,
    );
  }

  return {
    baseUrl: process.env.KEYFORGE_BASE_URL ?? 'http://localhost:3000',
    adminEmail: process.env.KEYFORGE_ADMIN_EMAIL,
    adminPassword: process.env.KEYFORGE_ADMIN_PASSWORD,
    publicKeyPath: path.resolve(process.env.KEYFORGE_PUBLIC_KEY_PATH),
    keyVersion: process.env.KEYFORGE_KEY_VERSION ?? '1',
  };
}
