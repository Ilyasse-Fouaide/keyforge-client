import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createJsonFileAdapter } from '../../../src/storage/json-file.js';
import { runStorageAdapterContractTests } from '../../helpers/storageAdapterContract.js';

let tempDir;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'keyforge-client-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function filePath() {
  return path.join(tempDir, 'nested', 'state.json');
}

runStorageAdapterContractTests(() => createJsonFileAdapter({ filePath: filePath() }));

describe('createJsonFileAdapter', () => {
  it('creates the file at the resolved path on first write', async () => {
    const adapter = createJsonFileAdapter({ filePath: filePath() });
    await adapter.set('key', 'value');

    const contents = JSON.parse(await readFile(filePath(), 'utf8'));
    expect(contents).toEqual({ key: 'value' });
  });

  it('creates nested directories that do not yet exist', async () => {
    const nested = path.join(tempDir, 'a', 'b', 'c', 'state.json');
    const adapter = createJsonFileAdapter({ filePath: nested });

    await adapter.set('key', 'value');
    await expect(readFile(nested, 'utf8')).resolves.toContain('value');
  });

  it('does not leave a .tmp file behind after a successful write', async () => {
    const adapter = createJsonFileAdapter({ filePath: filePath() });
    await adapter.set('key', 'value');

    await expect(readFile(`${filePath()}.tmp`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('persists data across separate adapter instances pointed at the same file', async () => {
    const first = createJsonFileAdapter({ filePath: filePath() });
    await first.set('entitlementToken', 'token-value');

    const second = createJsonFileAdapter({ filePath: filePath() });
    await expect(second.get('entitlementToken')).resolves.toBe('token-value');
  });

  it('throws rather than silently resetting when the file contains invalid JSON', async () => {
    const target = filePath();
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'not valid json', 'utf8');

    const adapter = createJsonFileAdapter({ filePath: target });
    await expect(adapter.get('key')).rejects.toThrow(SyntaxError);
  });
});
