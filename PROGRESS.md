# Progress

Running status log. See `ARCHITECTURE.md` for design decisions and the phase plan (§13).

**Current state: Phase 1 complete.**

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
