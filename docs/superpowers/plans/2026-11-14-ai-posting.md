# AI Posting Implementation Plan

**Goal:** Deploy personal API keys and reviewed AI submissions to ai.yujianrx.top.
**Architecture:** Existing Fastify/PGlite/PostgreSQL stack; narrowly scoped Bearer routes reuse the website revision transaction. React profile provides key management; static OpenAPI document describes the contract.
**Spec:** docs/plans/2026-11-14-ai-posting-design.md

Execution uses this session under the user's feature and deployment authorization. The directory is not a Git repository; preserve a local source snapshot instead of creating unrelated repository history.

## Constraints and review focus

- Never reload development seed data into production. Preserve users, settings, uploads and existing sessions.
- Existing Cookie routes still require Origin and CSRF. Bearer credentials only work on the three scoped endpoints.
- Key original appears once; expired, revoked, disabled and must-reset accounts cannot use it. Password changes and resets revoke keys.
- Concurrent retry creates exactly one content/revision/job; different body under the same key returns 409.
- Text, classifications, department audience and review use existing rules. Posting cannot supply another author or approval status.
- User state is checked again inside the creation transaction; preserve audit records without secret values.

## Tasks

- [x] Add tests/open-api.test.ts with authenticated key creation initially failing, then tests for owner isolation, secrets, revocation, expiry, invalid fields, idempotency and review.
- [x] Add migrations/010_api_access.sql and server/api-keys.ts. Extend server/core.ts request typing and server/auth.ts narrow auth dispatch; revoke tokens on password changes and administrator reset/disable in server/admin.ts.
- [x] Extract saveContentRevision in server/content.ts without changing web behavior. Add server/open-api.ts with transactional /taxonomy, /posts and /posts/:id; register routes in server/app.ts.
- [x] Add src/ApiAccess.tsx and scoped CSS; integrate into src/pages/Profile.tsx. Add public/integrations/openapi.json and docs/AI-POSTING-API.md. UI provides name, expiry, one-time secret, status, revoke and copyable examples.
- [x] Add migration 011 with 19 moderation presets, configurable review/reject actions, and approval-time enforcement; test direct abuse rejection and neutral news review.
- [x] Run npm run build and npm test; add desktop/mobile tests/e2e/api-access.spec.ts and run browser regression. Inspect generated screenshots and fix issues.
- [x] Prepare isolated 20261114-v3 release, back up production and apply the two new migrations. Compare existing data summaries. Verify HTTPS/key access and remove temporary verification artifacts; deliver access instructions.

## Verification

- Production build passed; 86 unit/integration tests and 29 browser tests passed. Desktop and mobile screenshots inspected.
- Deployed 20261114-v3 with migrations 010 and 011. Backed up to `/srv/ai-community/backups/pre-api-update-20261114T085548Z`; maintenance lasted 4.02 seconds.
- All 34 existing business tables, existing rule fields, uploads, environment and blog configuration matched before/after migration. Four real accounts, four sessions and six newly created contents were preserved.
- Passed 27 HTTPS checks, including one-time key creation, taxonomy access, invalid-post rollback, Cookie/Bearer isolation, revocation, public OpenAPI and all four compiled assets. Positive posting and approval tested in isolated local tests only; production verification created no posts. Removed only the revoked verification key and logged out its temporary session; retained the security audit trail.
