# Unified moderation implementation plan

**Goal:** Review each submission and its files together; account exemptions cover all associated files.

**Architecture:** Reuse moderation jobs, revision/comment bindings, private storage and existing publication transactions. Isolate review UI in an admin component and shared attachment approval in a server helper. No schema migration, existing data or settings reset.

**Stack:** React, Fastify, PostgreSQL/PGlite, Vitest, Playwright.

1. Extend exemption and moderation integration tests to capture pending-file publication, actual uploads, task-bound preview permissions and unchanged download counts; verify failures before implementing.
2. Share transactional attachment release between manual review and exemption. Read current exemption during upload; retain blocked-file and structural validation.
3. Return exact bound files with each job and provide permission-scoped file preview/download. Keep private normal reads unchanged.
4. Add reusable review materials component, show it in queue and decision dialog, remove separate file review UI and correct exemption/upload copy.
5. Extend browser tests for unified body/files review and mobile layout. Run relevant integration suites, type/build checks and browser regressions; inspect screenshots and update maintenance documentation with results.

No production deployment is included in this change until requested.

Additional authorized mobile work: normalize cover/title/card geometry; isolate pull-to-refresh and double-home-tap in `src/mobile`; add background API refresh without clearing existing content; update likes from authoritative response and refresh only replies after comment submission. Verify dimensions across 320/390/760px, touch and failure behavior, stable DOM and scroll, and desktop/route regression.

## Verification completed

- `npm test`: 14 files / 135 tests passed on final server code.
- `npm run check`, production build (including server TypeScript), final client rebuild, and `git diff --check` passed. Existing large bundle warning remains; no dependencies were added.
- Full browser run: 56/57 passed; the new reply test selected a topic locked by an earlier forum test. Fixed the fixture to choose an unlocked topic. Reran forum, mobile interactions, unified review and exemption/image performance together: 12/12 passed, including the previously failing case. No unresolved test failures.
- Browser checks confirm equal card height at 320/390/760px, no horizontal overflow, pull and double-tap refresh, duplicate-refresh suppression, ranking refresh, preserved content on refresh failure, stable DOM/scroll on likes and no body reload after comments. Existing desktop, editor, auth, media, forum and honors flows remain covered.
- Inspected real rendered screenshots: `outputs/mobile-home.png`, `mobile-aligned-390.png`, `人工审核-免填原因.png`, `统一审核-手机.png`. These use isolated fixtures; no production data was changed.
- No migration, dependency change, server sync or deployment was performed. Existing v8 production receipt remains the live baseline.
