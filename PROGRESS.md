# Progress

Running status log. See `ARCHITECTURE.md` for design decisions and the phase plan (§13).

**Current state: Phase 2 complete.**

---

## Phase 0 — Scaffold ✅

`package.json`, ESLint/Prettier config, Vitest, and the empty `src/`/`tests/`
structure from §11. No storage, crypto, clock, or network logic yet —
that's Phases 1-4.

Verified end-to-end:

- `npm install` succeeds
- `npm test` — 1 passing (`tests/unit/placeholder.test.js`), no real
  functionality under test yet
- `npm run lint` — clean
- `npm run format:check` — clean

### Decisions made during Phase 0

| Decision | Rationale |
|---|---|
| **`storage/json-file.js`, not `storage/sqlite.js`** (§11 corrected) | §11's file tree still names `sqlite.js`, but §5 explicitly corrected the default adapter to a plain JSON file — SQLite would add native-binary (`better-sqlite3`) install friction with no benefit here. Stubbed with the corrected name so a later phase doesn't recreate the SQLite path §5 already ruled out. |
| **Tooling versions pinned to match Keyforge's own `package.json` exactly** (`eslint`, `prettier`, `vitest`, `jose`, etc.) | Consistency with the sibling server repo per ARCHITECTURE.md §13; for `jose` specifically this is also what §3 asks for directly — same library, same version, not just same algorithm. |
| **No `dev`/`start` npm scripts** | Unlike Keyforge, this is a library with no standalone runtime entrypoint — `src/index.js` is imported, not run. Scripts are limited to `test`/`test:watch`/`lint`/`lint:fix`/`format`/`format:check`. |
| **`main`/`exports` added to `package.json`**, pointing at `src/index.js` | Not called out in ARCHITECTURE.md, but necessary packaging metadata — without it the package isn't importable once Phase 4 fills `index.js` in. |
| **`package-lock.json` gitignored** | Mirrors Keyforge's own `.gitignore`/`.prettierignore` convention. |
| **`private: true`, `"license": "UNLICENSED"`** | Mirrored from Keyforge as a reasonable default for an unpublished internal package; revisit once distribution (private registry vs. git dependency) is decided. |
| **`no-console: 'warn'` kept in ESLint config, without Keyforge's pino-specific comment** | Keyforge's rule exists to protect its redacting logger's redact list; this module has no logger, so the rule is kept as general library hygiene only, with the now-inapplicable justification dropped. |
| **`src/*.js` stubs are comment-only, no exports** | Function signatures for `activate`/`getEntitlement`/`refresh`/`deactivate` depend on §15's still-open decisions (public-key init shape, error/status vocabulary mapping). Stubbing an export now would lock in a shape ahead of those decisions. |
| **`crypto/`, `clock/`, `tests/offline-flow/`, `tests/integration/` tracked via `.gitkeep`** | Git doesn't track empty directories; §11 doesn't name specific files inside `crypto/`/`clock/` (unlike `storage/`), so no filenames were invented for them this phase. |

### Carry-forward — things later phases must not forget

- §15's three open questions are still open: exact public-key init shape (§8), exact error/status vocabulary mapping (§9), exact JSON storage file layout/path convention (§5). Propose these explicitly before Phase 1/2 implementation, don't guess.
- `tests/unit/placeholder.test.js` is scaffolding only — replace/remove it once Phase 1 adds real storage-adapter tests.

---

## Phase 1 — Storage adapter interface + default JSON-file implementation ✅

`src/storage/adapter.js` (the `StorageAdapter` contract plus shared
`assertValidKey`/`assertValidValue` validation) and `src/storage/json-file.js`
(the default adapter). An in-memory fake (`tests/helpers/memoryAdapter.js`)
and a parameterized shared test suite (`tests/helpers/storageAdapterContract.js`)
prove both implementations honor the identical contract. Resolves §15's
third open question (exact JSON file layout/location convention). No crypto,
network, or `index.js` work — that's Phases 2-4.

Verified end-to-end:

- `npm test` — 34 passing across 2 files, includes both adapters running the
  identical shared contract suite plus adapter-specific cases
- `npm run lint` / `npm run format:check` — clean
- Manual sanity check (ad hoc script, deleted after): `set()` on a fresh
  adapter produces `.keyforge-client/state.json`-shaped file
  (`{ entitlementToken, installationToken }` flat map, pretty-printed) with
  no leftover `.tmp` file after a successful write

### Decisions made during Phase 1

| Decision | Rationale |
|---|---|
| **Single flat JSON file, `{ [key]: value }`, not one-file-per-key** | §5 already shows this shape (`{ entitlementToken, installationToken }`); the adapter itself stays key-agnostic rather than hardcoding those two names, since the interface is generic `get`/`set`/`delete`. The interface never asks for listing/iterating keys, so one file is simpler and sufficient. |
| **Default path `<cwd>/.keyforge-client/state.json`, overridable via `filePath`** | Mirrors Keyforge's own precedent for local file-based state (`scripts/generate-signing-keypair.js`'s cwd-relative `keys/` directory) rather than a home-directory or OS-specific app-data path — fits a long-lived branch backend process with its own meaningful working directory. |
| **Missing-key → `null`, never throws** | Not a fresh decision — already specified by §5's own interface signature (`get(key): Promise<string \| null>`). `delete()` on a missing key is a no-op, doesn't throw (not specified in §5, decided here — standard key-value semantics). |
| **Shared `assertValidKey`/`assertValidValue` in `adapter.js`** | One place enforcing the string-typed key/value contract so the JSON-file adapter and the in-memory fake can't drift apart. `get`/`set`/`delete` are declared `async` specifically so a validation throw becomes a rejected promise rather than a synchronous throw — caught a real bug during implementation where non-`async` methods let validation errors escape `expect(...).rejects`. |
| **In-process promise-queue serialization in `json-file.js`** | Without it, two concurrent `set()` calls on one adapter instance race a read-modify-write on the shared file and can lose an update — this is what the "concurrent writes" test (`does not lose an update when concurrent sets target different keys`) exercises. Scoped to calls within one process only; cross-process file locking isn't attempted, matching §2's one-process-owns-this-file design and §5's local-machine-is-the-trust-boundary reasoning. |
| **Atomic write: write to `<path>.tmp`, then `rename()` onto the real path** | A crash mid-write must never leave a half-written, unparseable `state.json` — that would look like corrupted licensing state on next boot. `node:fs` only, no new dependency. |
| **Corrupted JSON throws (`SyntaxError` propagates), never silently resets to `{}`** | Silently discarding unparseable existing data could turn a real problem into a quiet `not_activated` report later (Phase 2). Only `ENOENT` (no file yet) is treated as an empty store. |
| **`writeFile(..., { mode: 0o600 })`, `mkdir(..., { mode: 0o700, recursive: true })`** | Matches §5's "chmod 600-equivalent" ask and mirrors Keyforge's own `generate-signing-keypair.js` pattern for sensitive local files. Best-effort/no-op on this Windows dev machine; meaningful on the POSIX branch machines this actually ships to. |
| **In-memory fake lives in `tests/helpers/memoryAdapter.js`, not `src/`** | It's a test double (§10), not a production adapter, but ARCHITECTURE.md §10 frames it as reusable across later phases' test suites too — so it's placed under `tests/helpers/`, matching Keyforge's own `tests/helpers/*.js` convention, rather than buried in one test file. |
| **Shared parameterized contract suite (`tests/helpers/storageAdapterContract.js`)** | Runs the identical `describe`/`it` list against both adapters via a factory function, directly proving §10's swappability claim rather than just asserting it in prose. |

### Carry-forward — things later phases must not forget

- §15's other two open questions are still open: exact public-key init shape (§8), exact error/status vocabulary mapping (§9). Propose these explicitly before Phase 2/3 implementation, don't guess.
- Phase 2's `entitlement.js` will be the first real consumer of `createJsonFileAdapter`/`createMemoryAdapter` — inject the memory adapter in its unit tests rather than hitting disk, per §10.

---

## Phase 2 — Local verification: crypto + clock + getEntitlement() ✅

Ported `verifyEntitlementToken` (`src/crypto/verify.js`, `src/crypto/errors.js`)
and `assertNoClockRollback` (`src/clock/rollback.js`) line-by-line from
Keyforge server's `src/crypto/verify.js`/`errors.js` and
`tests/helpers/offlineClock.js`, via fresh subagent re-reads immediately
before each was written (not from an earlier paraphrase in the same
session). Composed them in `src/entitlement.js`'s `createEntitlementChecker()`,
translating the reference's exception-based contract into this module's own
status-object vocabulary. Resolves §15's other two open questions (public-key
init shape, error/status mapping). Full offline-flow scenario suite per §10,
plus a mandatory fresh-context adversarial security review that found two
confirmed, PoC-verified issues beyond the original plan — both handled before
considering this phase done (details below). No `activate`/`refresh`/
`deactivate` or `index.js` work — that's Phases 3-4.

Verified end-to-end:

- `npm test` — 81 passing across 6 files (was 34 after Phase 1)
- `npm run lint` / `npm run format:check` — clean
- Manual sanity check (ad hoc script, deleted after): a real Ed25519-signed
  token, driven through the real `createJsonFileAdapter` (real disk, temp
  dir) end-to-end through `createEntitlementChecker` — confirms `state.json`
  grows a `lastValidatedAt` key after a `valid` check
- Manual PoC re-verification (ad hoc script, deleted after): re-ran the
  security review's stale-token-replay scenario directly against `src/`
  (not just the new unit tests) and confirmed it now reports `tampered`
  instead of `valid`

### Decisions made during Phase 2

| Decision | Rationale |
|---|---|
| **Public-key init shape (closes §15/§8): inline PEM strings**, `{ publicKeys: { '1': '<PEM>' } }`, passed to `createEntitlementChecker()` and converted once via a new `src/crypto/keys.js` (`loadPublicKeys`, not a port) using `jose`'s `importSPKI` | This module never does file I/O for keys itself — the integrator supplies resolved PEM content however they already manage config. Matches Phase 1's "build the minimal shape now" precedent (plain JSON storage instead of SQLite) rather than porting the server's file-manifest loader and its relative-path-resolution questions. User-approved before implementation. |
| **Status vocabulary (closes §15/§9): +`unknown_key_version`**, mapped from `UnknownKeyVersionError` | Preserves the distinction the server's own client-SDK doc draws ("stale embedded key, needs a config update" vs. `tampered`'s "fraudulent token") — different operator response. Required and received an explicit, scoped `ARCHITECTURE.md` §4 edit (one line) before implementation, user-approved. All other collapsing (malformed structure, bad signature, schema violations, keyVersion/kid mismatch → `tampered`) is inherited unchanged from the server's own `TokenInvalidError` design. |
| **`getEntitlement()` ratchets `lastValidatedAt` forward** on every check where the clock check passes, regardless of the token's own verify outcome | Without this, rollback protection only guards against rolling back before the *last server refresh*, not the last local check. `getEntitlement()` stays network-free but is no longer read-only against storage — user-approved trade-off. |
| **New third storage key, `lastValidatedAt`, string-encoded unix seconds** | Follows the existing `StorageAdapter` contract (`get`/`set` are string-only, per `assertValidValue`). Missing (`null`) is passed through as `null`, never coerced via `Number(null)` (which is `0`, a finite number) — that coercion would silently defeat the fail-closed guard for "token exists but no watermark was ever written" (the state before Phase 3's `activate()` runs). This exact hazard has its own test. |
| **`getNow` injection seam**, defaulting to `() => Math.floor(Date.now()/1000)`, passed once at `createEntitlementChecker()` construction (not per-call) | Lets tests control "now" deterministically without faking global timers, consistent with `storage`/`publicKeys` also being construction-time dependencies. |
| **No `zod` dependency; `assertValidPayloadShape` in `verify.js` checks only `expiresAt`** instead of porting the server's full `entitlementTokenSchema` | Repo is deliberately dependency-light (`jose` only). Signature verification already proves authenticity; the server validated shape at signing time. Only `expiresAt` is checked because it's the only field this client's logic dereferences before a throw/no-throw decision — `now > payload.expiresAt` is `false` (not expired) for a missing/non-numeric `expiresAt`, the same silent-permissive-fallthrough shape as the clock-rollback bug this guards against by the same technique (`Number.isFinite`, not a bare comparison). `keyVersion` needs no separate check (`String(undefined)` can't match a real `kid`). `features` is passed through with zero shape validation — safe (never branched on locally) but a conscious scope boundary. |
| **`rollback.js`, not `offlineClock.js`** (the source file's name) | "Offline" described the *source's* context (a test helper for an offline-flow suite, with no in-repo caller — explicitly reference-only code there); here it's real production code, and the name should describe what it does. |
| **`src/crypto/keys.js` is new code, not a port** — Keyforge server's own `keys.js` (file-manifest loader) was read for shape reference only, never ported | Follows directly from the public-key init shape decision above: no file I/O, no manifest, no relative-path resolution to replicate. |
| **Storage errors always propagate, never map to a status** — confirmed by a dedicated test (corrupt `state.json` via the real `json-file` adapter → `getEntitlement()` rejects with `SyntaxError`, not any status object) | Matches Phase 1's own "corrupted JSON throws, never silently resets" philosophy; an unexpected error becoming a plausible-looking status (e.g. `tampered`) would be worse than a loud crash. |

### Security review — findings and disposition

A fresh-context adversarial subagent review (the packaged `security-review`
skill couldn't run here — its preamble hard-codes a `git log origin/HEAD...`
diff and this repo has no remote configured; adding one to work around it
would mean editing git config, which is off-limits, so the equivalent review
was run directly via a briefed subagent instead) found two confirmed,
PoC-verified issues and one low-severity code-quality note, none of which
were anticipated in the original plan:

1. **Fixed — stale/superseded token replay.** Neither `verify.js` nor
   `entitlement.js` compared a token's `issuedAt` against anything
   remembered locally, so restoring an old-but-still-validly-signed,
   still-unexpired `entitlementToken` file (e.g. one saved before a
   plan downgrade) verified cleanly as `valid` — no clock tampering
   required, just a second file. Fixed by adding a second watermark,
   `highestIssuedAtSeen` (same string-encoded-unix-seconds pattern as
   `lastValidatedAt`, same file), checked and ratcheted in
   `entitlement.js` right after a *successful* signature verification: a
   `payload.issuedAt` behind the watermark reports `tampered`; otherwise
   the watermark advances. Unlike `lastValidatedAt`, a missing
   `highestIssuedAtSeen` is **not** fail-closed — the first token an
   installation ever verifies has nothing prior to compare against, so
   absence just means "nothing seen yet," not "something is wrong."
   Verified both by new tests (`tests/offline-flow/getEntitlement.test.js`,
   "stale token replay protection" block) and by re-running the review's
   own PoC script directly against `src/` after the fix.
2. **Documented as an accepted limitation, not fixed — clock+watermark
   co-tampering.** An attacker with the filesystem write access the
   project's own threat model already grants (§5: "whoever has access to
   that machine already controls the ... system running on it") can roll
   the OS clock back *and* edit the plaintext `lastValidatedAt` down to
   match in the same stroke, defeating both the rollback check and the
   expiry check together for an otherwise-genuine, untampered token. There
   is no proportionate software fix within this module's stated
   constraints (dependency-light, no hardware anchor) — any local,
   secret-free value is exactly as editable as the one it's meant to
   protect. This is the same shape as §7's already-accepted
   revocation-propagation trade-off, just now concretely demonstrated
   rather than theoretical. The pre-fix code comment overclaimed what the
   watermark achieves ("closes the gap ... would otherwise look valid
   again," stated unconditionally); corrected to name the naive-rollback
   case it actually closes and the co-tampering case it does not.
   **Proposing, not self-approving:** an `ARCHITECTURE.md` addition near
   §5/§7 documenting this explicitly (mirroring §7's own treatment) — flagged
   to the user, not made, since only the one pre-approved §4 edit was
   authorized this phase.
3. **Fixed — bare `catch` around the clock check.** Tightened to match the
   verification `catch` block's pattern (`instanceof TypeError \|\|
   instanceof ClockRollbackDetectedError`, rethrow anything else). Not
   currently exploitable (`assertNoClockRollback` can only throw those two
   types today), but was a latent trap for a future change to that file.

Also explicitly tried and ruled out by the reviewer: algorithm-confusion,
prototype-pollution-style key names (the `Map` keying rules this out
structurally), non-string values written directly to the storage file
bypassing `assertValidValue`, and cross-process file races (already
out-of-scope per Phase 1's one-process-owns-this-file design).

### Carry-forward — things later phases must not forget

- **Phase 3's `activate()` must write an initial `lastValidatedAt` on
  success**, or every `getEntitlement()` call post-activation fails closed
  (`clock_rollback`) forever — there's no other way to bootstrap the
  watermark. `getEntitlement()` self-sustains it thereafter; `refresh()`
  doesn't strictly need to touch it.
- **Phase 3's `activate()` should also seed `highestIssuedAtSeen`** with the
  newly-activated token's own `issuedAt`, for the same reason and by the
  same pattern as `lastValidatedAt` above (harmless if omitted — the field
  fails open on first use — but seeding it is the more consistent,
  slightly-more-defensive choice).
- `revoked` still has no producing mechanism (e.g. a stored revocation flag
  `refresh()` could set after a 403) — Phase 3's to design; Phase 2
  deliberately built no hook for it.
- **`installationId` is never checked locally** — a validly-signed token for
  a *different* installation would currently verify `valid` here. Not
  closeable in Phase 2: there's nothing yet recording what this
  installation's own `installationId` should be. Phase 3's `activate()`
  should store the expected `installationId` so `entitlement.js` can
  compare against it.
- **Clock+watermark co-tampering** (security review finding #2 above) is a
  documented, accepted limitation, not a bug — don't attempt a local
  software fix without a genuinely new primitive (e.g. a monotonic-clock
  cross-check) being explicitly discussed and approved first; don't
  rediscover this and "fix" it with something that only adds false
  confidence.
- A narrow, bounded, non-attacker-exploitable race exists if `getEntitlement()`
  is ever called concurrently on the same checker instance (two reads of a
  stale watermark could write back out of order) — documented limitation,
  not fixed now; would need an atomic compare-and-swap primitive Phase 1's
  `StorageAdapter` contract doesn't have. Applies to both `lastValidatedAt`
  and the new `highestIssuedAtSeen`.
- An `ARCHITECTURE.md` addition documenting the clock+watermark limitation
  (see security review finding #2) is proposed but not yet made — needs
  explicit user approval before editing, per this repo's own rule.
