#!/usr/bin/env node
// examples/scenarios/03-background-refresh.js — refresh() against a live
// server, confirms the on-disk watermarks (highestIssuedAtSeen,
// lastValidatedAt) and entitlementToken actually advance. Requires
// 01-first-activation.js (and 02, narratively) to have run first.

import { createKeyforgeClient } from 'keyforge-client';

import { createJsonFileAdapter } from '../../src/storage/json-file.js';
import { statePath } from '../lib/paths.js';
import { check, loadFixtures, loadPublicKeys, requireExistingState, run } from '../lib/scenario.js';

async function snapshot() {
  // A second adapter instance pointed at the same file — legitimate use of
  // the public StorageAdapter interface to observe what's actually
  // persisted, which is exactly the point of this scenario.
  const storage = createJsonFileAdapter({ filePath: statePath });
  return {
    entitlementToken: await storage.get('entitlementToken'),
    lastValidatedAt: await storage.get('lastValidatedAt'),
    highestIssuedAtSeen: await storage.get('highestIssuedAtSeen'),
  };
}

run(async () => {
  await requireExistingState('01-first-activation.js');
  const fixtures = await loadFixtures();
  const publicKeys = await loadPublicKeys(fixtures);

  const client = await createKeyforgeClient({
    baseUrl: fixtures.baseUrl,
    publicKeys,
    storage: createJsonFileAdapter({ filePath: statePath }),
  });

  const before = await snapshot();
  console.log(`before refresh() -> ${JSON.stringify(before)}`);

  const refreshResult = await client.refresh();
  console.log(`refresh() -> ${JSON.stringify(refreshResult)}`);
  check(
    refreshResult.status === 'updated',
    `refresh() reports 'updated' (got '${refreshResult.status}')`,
  );

  const after = await snapshot();
  console.log(`after refresh()  -> ${JSON.stringify(after)}`);
  check(
    Number(after.highestIssuedAtSeen) > Number(before.highestIssuedAtSeen),
    'highestIssuedAtSeen watermark advanced',
  );
  check(
    Number(after.lastValidatedAt) >= Number(before.lastValidatedAt),
    'lastValidatedAt watermark did not go backwards',
  );
  check(after.entitlementToken !== before.entitlementToken, 'entitlementToken was replaced');

  const entitlement = await client.getEntitlement();
  console.log(`getEntitlement() -> ${JSON.stringify(entitlement)}`);
  check(
    entitlement.status === 'valid',
    `getEntitlement() still reports 'valid' after refresh (got '${entitlement.status}')`,
  );
});
