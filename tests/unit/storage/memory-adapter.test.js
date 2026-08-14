import { describe, expect, it } from 'vitest';

import { createMemoryAdapter } from '../../helpers/memoryAdapter.js';
import { runStorageAdapterContractTests } from '../../helpers/storageAdapterContract.js';

runStorageAdapterContractTests(createMemoryAdapter);

describe('createMemoryAdapter', () => {
  it('does not share state between separate instances', async () => {
    const first = createMemoryAdapter();
    const second = createMemoryAdapter();

    await first.set('key', 'value');
    await expect(second.get('key')).resolves.toBeNull();
  });
});
