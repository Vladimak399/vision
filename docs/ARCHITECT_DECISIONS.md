# Architecture Decision Records

## ADR-004: Disable automatic Vercel deployments during agent development

**Date:** 2026-07-10
**Status:** Accepted
**Task:** PV-00-05

### Context

Agent development generates many small branches and commits. Each push to GitHub can trigger an automatic Vercel deployment, consuming build limits unnecessarily. Deployments are only needed at control points after external architect approval.

### Decision

Disable automatic Vercel deployments by setting `"deploymentEnabled": false` in `vercel.json`. Deployments are done manually via Vercel Dashboard or CLI only when explicitly approved.

### Consequences

- No build limit waste on intermediate branches.
- No accidental deployment of work-in-progress code.
- Manual deploy at control points provides an explicit release gate.
- Team must remember to deploy manually before production verification.
- Preview URLs for PR review must be generated on demand.

### References

- `vercel.json` — `git.deploymentEnabled: false`
