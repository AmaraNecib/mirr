# Branch Verification Checklist

Use this checklist for every agent and integration branch before opening a PR.

## Scope & Dependencies

- [ ] Branch scope clearly defined (one phase, one feature, or one fix)
- [ ] Dependencies on other branches documented
- [ ] Blocking tasks identified (what must merge before this?)
- [ ] No ambiguous ownership of the same files as parallel branches

## Files & Changes

- [ ] List of files changed documented
- [ ] No accidental deletions or unintended changes
- [ ] No sensitive files committed (.env, secrets, credentials)
- [ ] Large files (>5MB) justified or removed

## Tests & Validation

- [ ] Unit tests added or updated for new logic
- [ ] Integration tests added where appropriate
- [ ] E2E tests added for critical user paths
- [ ] All tests passing locally (`npm test`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Linting passes (`npm run lint`)

## Local Verification Commands

Document the commands you ran to verify this branch:

```
npm install
npm run typecheck
npm run lint
npm test
npm run build (if applicable)
npm run dev (if applicable)
```

## Code Quality

- [ ] No console.logs or debug code left behind
- [ ] No TODO comments without context
- [ ] Code follows project conventions
- [ ] No obvious performance regressions
- [ ] Imports are organized and clean

## Known Risks & Follow-ups

- [ ] List any risky decisions made
- [ ] Document deferred items (what's NOT included?)
- [ ] Flag cross-cutting concerns (affects auth? schema? API contracts?)
- [ ] Note if manual testing is required beyond automation

## Branch Naming

- [ ] Agent branch: `agent/phaseN-short-description`
- [ ] Integration branch: `integration/phaseN-short-description`
- [ ] Hotfix branch: `hotfix/short-description` (only for urgent repairs)

## PR Template Completeness

- [ ] Filled in scope statement
- [ ] Filled in affected surfaces
- [ ] Filled in test coverage statement
- [ ] Filled in verification commands
- [ ] Filled in known risks or deferred items
