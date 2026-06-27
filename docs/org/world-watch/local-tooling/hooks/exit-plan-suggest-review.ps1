# exit-plan-suggest-review.ps1 — PreToolUse(ExitPlanMode) hook
# When a plan is finalized, scan its text for HIGH-STAKES surfaces and, only then,
# non-blockingly SUGGEST running /stakeholder-review first. Stays silent on low-risk
# plans so it never nags — the validation run showed the blind panel is worth its cost
# on data/rules/auth/legal plans but wasteful on routine ones (see DESIGN.md §2.6).
#
# It SUGGESTS, never blocks and never runs the panel (the panel is interactive + costs
# tokens; the human decides). Fails OPEN (exit 0, no output) on any error.
#
# Wired in .claude/settings.json PreToolUse matcher "ExitPlanMode".

$ErrorActionPreference = 'Stop'
try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
    $payload = $raw | ConvertFrom-Json

    if ("$($payload.tool_name)" -ne 'ExitPlanMode') { exit 0 }
    $plan = "$($payload.tool_input.plan)"
    if ([string]::IsNullOrWhiteSpace($plan)) { exit 0 }

    # High-stakes signals: security rules, GDPR/privacy data, auth, moderation, functions,
    # destructive data ops. Only suggest the panel when the plan touches these.
    $signals = @(
        'firestore\.rules', 'firestore\.indexes', 'functions/',
        'src/lib/firebase/(groups|userData|dataExport)', 'submitReport',
        'AuthContext', 'passwordStrength', 'App ?Check',
        '\bGDPR\b', 'integritet', '\bprivacy\b', 'personuppgift',
        '\bauth(entication|orization)?\b', 'security rule', 'moderation',
        '\b(deletion|erasure|radering|retention)\b'
    )
    $hits = @()
    foreach ($s in $signals) {
        if ($plan -imatch $s) { $hits += ($plan | Select-String -Pattern $s -AllMatches).Matches[0].Value }
    }
    if ($hits.Count -eq 0) { exit 0 }   # low-risk plan → stay silent

    $uniq = ($hits | Select-Object -Unique) -join ', '

    # Measurement (fail-open, never breaks the hook): log that the trigger fired so
    # /org-retro can score calibration (suggested vs actually-ran). Best-effort only.
    try {
        $repoRoot = (& git rev-parse --show-toplevel 2>$null)
        if ([string]::IsNullOrWhiteSpace($repoRoot)) { $repoRoot = $env:CLAUDE_PROJECT_DIR }
        if (-not [string]::IsNullOrWhiteSpace($repoRoot)) {
            $logger  = Join-Path $repoRoot.Trim() 'docs/org/metrics/log_event.mjs'
            $sigJson = ($uniq.Split(',') | ForEach-Object { '"' + $_.Trim().Replace('"','') + '"' }) -join ','
            $payload = '{"signals":[' + $sigJson + '],"suggested":true}'
            if (Test-Path -LiteralPath $logger) { & node $logger trigger $payload 2>$null | Out-Null }
        }
    } catch { }   # logging must never break the hook

    $msg = "This plan appears to touch high-stakes surfaces ($uniq). Consider offering the " +
           "user /stakeholder-review before executing — it runs a blind multi-role critique " +
           "(Security / Legal / DPO / DBA / DevOps as relevant) and escalates any legal/privacy " +
           "tradeoff to the owner. It's a suggestion, not a requirement — skip it for low-risk work."

    # Non-blocking: add context for the agent; do not block ExitPlanMode.
    $out = @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; additionalContext = $msg } }
    [Console]::Out.Write(($out | ConvertTo-Json -Compress -Depth 5))
    exit 0
}
catch {
    exit 0
}
