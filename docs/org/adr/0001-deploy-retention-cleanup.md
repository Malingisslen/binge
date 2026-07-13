# 0001. Deploy dormant retentionCleanup + reclaimOrphanFollows

- **Date:** 2026-06-27
- **Status:** Accepted (proceed-with-conditions) · one item Escalated-to-human
- **Trigger:** Plan to activate two code-ready-but-undeployed Cloud Functions
  (`retentionCleanup`, `reclaimOrphanFollows`) — the 🔴 gap in role #27's watch-items.
  (This was also the **validation run** for the stakeholder-review pipeline itself.)
- **Stakeholders (panel, blind):** DPO #6 (medium, approve-with-conditions) ·
  Financial Controller #3 (medium, approve-with-conditions) · DevOps/SRE #8 (high,
  approve-with-conditions + the lone formal objection) · DBA #27 (high,
  approve-with-conditions) · Security #4 (high, approve-with-conditions).

## Context
Two scheduled functions that enforce data-retention policy are code-ready but not in the
deploy pipeline (`deploy.yml` is hosting-only; functions need a manual
`firebase deploy --only functions`). The plan proposed a one-time manual deploy, a
RUNBOOK note, daily/weekly schedules, and **no code changes — deploy as-is**.

## Conflict
The plan's "deploy as-is, unattended, no monitoring" collided with three high-stake
reviewers: arming two **destructive, admin-privileged** jobs (they bypass
`firestore.rules`) on a schedule, with no alerting, no validated first run, and no
kill-switch — and the same drift gap that orphaned these functions once before
(per `docs/analysis/EXTERNAL_ACTIONS.md`). Separately, the plan's RUNBOOK wording
(`expiresAt + 7d`) contradicted the actual code thresholds, and the user-facing privacy
policy (`integritet` §6) is silent on the 90-day notification retention the jobs enforce.

## Decision
**Proceed-with-conditions.** Ship the deletion *logic* unchanged (DBA + Security
confirmed it is correctly batched/paginated/race-safe, needs no composite index, and is
not attacker-reachable), but **reject the operational "deploy as-is"**: require an
emulator dry-run, an observed (non-unattended) first run on the backlog, confirmed PITR,
a health/absence alert + heartbeat, post-deploy schedule verification, a written
kill-switch, drift-guard awareness for the two functions, and a Scheduler-billable-job
count against the 25 SEK cap. RUNBOOK must state the **real** thresholds.

- **Deciding tier:** **tier 3 (Data integrity & security) beats tier 6 (Velocity &
  simplicity).** The "just deploy it" shortcut loses to the safety conditions.
- The documentation-accuracy fixes (RUNBOOK thresholds, record-of-processing entry) are
  **tier 2** but reconcilable without a human — the panel unanimously prescribed the
  same fix, so there was nothing to decide.

## Consequences
10 must-haves gate activation (above); 6 follow-up tickets filed (bounded notifications
query; drift-guard entry; `followedAt`-less follow hardening; native-TTL evaluation;
privacy-policy §6 update; record-of-processing entry). The review **advises only** —
no deploy was performed.

## Escalated to human (tier 2, Legal/privacy)
> **For Malin:** Before the automated 90-day notification deletion goes live, update the
> privacy policy (`integritet` §6) to disclose that retention **in the same release**, or
> is shipping the cleanup now with the policy update as a **fast-follow** acceptable?
> *Tradeoff:* policy-first is the clean GDPR-transparency posture; ship-now closes a real
> retention-overshoot faster but briefly leaves policy text and behavior misaligned. This
> is a compliance judgment, not an engineering one — per the rubric, tier-2 timing calls
> go to you.

## Decided by
Chief-Architect agent (rubric tier 3) for the operational conflict; **Human owner (Malin)**
for the one tier-2 privacy-timing question above.
