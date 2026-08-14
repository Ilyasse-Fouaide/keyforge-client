# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This repo contains only `ARCHITECTURE.md` — a proposal document, not yet approved for implementation. There is no `package.json`, no source, no tests, and no commits (working tree is untracked). **Do not scaffold or write code here until the user has explicitly approved the plan in `ARCHITECTURE.md`** (its own final line says as much: "Waiting on your approval (or pushback) before starting Phase 0").

Once implementation begins, a `PROGRESS.md` will track phase-by-phase status — check it first if it exists, since it will supersede this section's "nothing built yet" description.

## What this project is

`keyforge-client` is a Node module (JavaScript, ESM, no TypeScript) that will run *inside a branch's local backend process* to talk to Keyforge (the licensing server, a separate sibling repo). It is not a browser client — no UI, no framework dependency. It manages offline-safe license verification for one branch installation: local Ed25519 signature verification is the fast path, server contact (`activate`/`refresh`/`deactivate`) is one-time or background, and **the branch app must never block startup on a network call**.

Planned public API (ARCHITECTURE.md §4): `activate(licenseKey)`, `getEntitlement()` (network-free, returns a status object, never throws for expected bad states), `refresh()` (silently no-ops when offline), `deactivate()`.

## Relationship to Keyforge (the server repo)

- Sibling repo, confirmed local path: `/c/Users/ifouaide/Documents/Keyforge`. It is a separate, already-complete (all 8 phases closed) project — this client is deliberately a new repo, not a package inside it.
- Phase 2 of this project (local verification) is a **port, not a reimplementation**, of three specific files from that repo:
  - `src/crypto/verify.js` (`verifyEntitlementToken`)
  - `tests/helpers/offlineClock.js` (`assertNoClockRollback` — including its fail-closed behavior on malformed input, a bug Keyforge's own Phase 7 review caught)
  - `tests/offline-flow/clientVerification.test.js` (`verifyStoredToken` — clock check before signature verification)
  
  Read these files line-by-line from the real repo before writing this module's equivalents; don't reconstruct their behavior from `ARCHITECTURE.md`'s prose summary or from memory. This is exactly the kind of read-heavy, reference-checking work worth delegating to a subagent so porting details don't have to stay loaded in the main session throughout.
- Keyforge's own `CLAUDE.md`/`ARCHITECTURE.md`/`docs/client-sdk-integration.md` document the server-side contract (`/activate`, `/validate`, `/refresh`, `/deactivate`, error vocabulary in `src/crypto/errors.js`) this module is a client for. Don't invent a parallel status/error vocabulary that means the same thing with different names — map onto Keyforge's existing one (ARCHITECTURE.md §9).

## Planned architecture (ARCHITECTURE.md §2, §5, §11)

```
src/
├── activate.js / refresh.js / deactivate.js   # network operations
├── entitlement.js       # getEntitlement(): local verification composition
├── crypto/              # ported verify.js equivalent (jose, same lib as server)
├── clock/               # ported offlineClock.js equivalent
├── storage/
│   ├── adapter.js       # interface: get(key)/set(key,value)/delete(key)
│   └── json-file.js     # default implementation — a plain JSON file, NOT SQLite
└── index.js             # public API surface
```

Key decisions already made in the doc (don't relitigate without flagging it first):
- **Default storage is a plain JSON file, not SQLite** — deliberately corrected from an earlier draft. Two strings (entitlement token, installation token), no queries — SQLite would add native-binary install friction (`better-sqlite3`) for no benefit. The adapter interface stays generic/pluggable so an integrator with their own DB can swap it in.
- **Embedded public key(s) come from config passed at init, not hardcoded** — mirrors Keyforge's own public-key-manifest approach, so a server-side key rotation doesn't force a new release of this module.
- **Revocation propagation is bounded by design, not a bug**: `getEntitlement()` run purely offline cannot know about revocation since the last successful `refresh()`. This is inherited from Keyforge's own architecture and must be documented in this module's README, not "fixed" here.

Three things are explicitly open design questions, not yet decided (§15): the exact public-key init shape, the exact error/status vocabulary mapping, and the exact JSON storage file layout/path convention. Propose these explicitly before implementing rather than guessing.

## Workflow

- Same discipline as the Keyforge server repo: one Claude Code session per phase, `/clear` between them, `PROGRESS.md` updated at the end of each phase so a fresh session can resume without re-explanation.
- **Changes to `ARCHITECTURE.md` require explicit user approval before the file is edited** — propose the change and stop, don't self-approve and rewrite it.
- Phase 2 (local verification/crypto porting) should be treated with the same care as Keyforge's own crypto phases — plan mode, careful review of the ported boundary conditions (clock-rollback fail-closed behavior in particular).
