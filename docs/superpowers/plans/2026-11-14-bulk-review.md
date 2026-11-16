# Bulk Review Implementation Plan

**Goal:** Deploy bulk manual review, approval without a reason and linked-file approval.
**Architecture:** Reuse manualReview for both routes; each item is a transaction. React admin selection and partial-result UI use existing components.
**Tech Stack:** Fastify, PostgreSQL/PGlite, React, TypeScript, Vitest, Playwright.
**Spec:** docs/plans/2026-11-14-bulk-review-design.md

Execution stays in this session under the user's explicit feature/deployment request. This directory has no Git repository; source snapshot is retained in the deployment workspace instead of creating commits.

## Constraints and review focus

- Preserve live users, content, sessions, keys, rules and uploads; no seed or production test posts.
- Keep scoped moderation permission, current revision and explicit deny rules checked for every item.
- Approval may omit reason; rejection requires at least 5 characters (file blocking at least 10).
- Linked non-blocked files are approved atomically with the content; unchanged/unrelated files remain unchanged. A failure must not release any files.
- Batch accepts 1–50 unique UUIDs; completed, stale, missing and unauthorized items report individual failures. Repeating a request cannot duplicate a successful review.

## Tasks

- [x] Add tests/bulk-review.test.ts covering no-reason approval, linked files, scoped permission, partial failures, invalid batches, rejection, stale revisions, blocked files, deny-rule rollback and duplicate submission. Update two old tests to the requested manual-approval behavior; run targeted tests to confirm initial failures.
- [x] Update server/moderation.ts: lock and verify the current target before approving attached files; include file.review and moderation.review audit events in the transaction. Keep provider-based approval behavior unchanged.
- [x] Update server/admin.ts: conditional reason validation; POST /api/admin/moderation/batch-review returns results, succeeded and failed; allow no-reason independent file approval. Single and batch use manualReview.
- [x] Update src/pages/Admin.tsx and src/admin-type.css: selection, current-page selection, bulk buttons, partial failures, no reason input for approval, rejection dialog; keep mobile layout within viewport.
- [x] Add browser tests for single and batch approval/rejection and partial failures; build, unit regression, browser regression and inspect screenshots. Passed 95 unit/integration tests and 32 browser tests. New browser fixtures use their own real test admin to avoid exhausting the shared account's request budget, and delete only their own test contents after each test.
- [x] Update moderation documentation, stage v4, backup and compare all data before/after switch, verify HTTPS without approving real queued content, write delivery notes.

## Production result

Deployed `20261114-v4`; backup `/srv/ai-community/backups/pre-bulk-review-20261114T092120Z`, 4.53 seconds maintenance. All 38 database tables, 10 private files, environment and blog config matched before/after. Preserved 4 users, 4 sessions, 8 contents and 19 rules; no schema migration. Passed 24 HTTPS checks, matched index and four compiled assets. Validation used missing random IDs and did not approve real queued content or create production test posts/files. Temporary verification session logged out; existing admin password remained valid.
