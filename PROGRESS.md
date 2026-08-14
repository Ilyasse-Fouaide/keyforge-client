# Progress

Running status log. See `ARCHITECTURE.md` for design decisions and the phase plan (§13).

**Current state: Phase 0 complete.**

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
