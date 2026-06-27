# world-watch-due.ps1 — SessionStart hook
# Deterministic due-check for the virtual role-org's world-watch layer. Reads
# docs/org/world-watch/state.json, computes (now - lastScan >= cadence) per role, and
# if anything is due injects a reminder (additionalContext) to run /world-watch.
#
# It does ZERO scanning: no model calls, no network. Pure date arithmetic. The actual
# poll/diff/ticket flow is the /world-watch skill, run interactively by the owner.
# This keeps the $0/interactive cost model intact (see docs/org/world-watch/DESIGN.md).
#
# Once-per-day lock: .claude/state/world-watch-lastcheck holds today's date; if it
# already equals today, we stay silent so the reminder never nags more than once a day.
#
# Fails OPEN on any error (exit 0, no output) — a hook bug must never block a session.

$ErrorActionPreference = 'Stop'
try {
    $null = [Console]::In.ReadToEnd()

    $repoRoot = (& git rev-parse --show-toplevel 2>$null)
    if ([string]::IsNullOrWhiteSpace($repoRoot)) { $repoRoot = $env:CLAUDE_PROJECT_DIR }
    if ([string]::IsNullOrWhiteSpace($repoRoot)) { $repoRoot = (Get-Location).Path }
    $repoRoot = $repoRoot.Trim()

    $statePath = Join-Path $repoRoot 'docs/org/world-watch/state.json'
    if (-not (Test-Path -LiteralPath $statePath)) { exit 0 }   # nothing wired yet

    # Once-per-day lock (gitignored .claude/state/).
    $today    = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
    $stateDir = Join-Path $repoRoot '.claude/state'
    $lockFile = Join-Path $stateDir 'world-watch-lastcheck'
    if (Test-Path -LiteralPath $lockFile) {
        $last = (Get-Content -LiteralPath $lockFile -Raw -ErrorAction SilentlyContinue)
        if ($last -and $last.Trim() -eq $today) { exit 0 }   # already checked today
    }

    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $cadenceDays = @{ weekly = 7; monthly = 30; quarterly = 90 }
    if ($state.cadenceDays) {
        if ($state.cadenceDays.weekly)    { $cadenceDays.weekly    = [int]$state.cadenceDays.weekly }
        if ($state.cadenceDays.monthly)   { $cadenceDays.monthly   = [int]$state.cadenceDays.monthly }
        if ($state.cadenceDays.quarterly) { $cadenceDays.quarterly = [int]$state.cadenceDays.quarterly }
    }

    $now = (Get-Date).ToUniversalTime()
    $due = @()
    foreach ($prop in $state.roles.PSObject.Properties) {
        $role    = $prop.Value
        $cadence = "$($role.cadence)"
        $window  = $cadenceDays[$cadence]
        if (-not $window) { $window = 30 }

        $isDue = $false
        if ($null -eq $role.lastScan -or "$($role.lastScan)".Trim() -eq '') {
            $isDue = $true   # never scanned
        } else {
            try {
                $lastScan = [datetime]::Parse("$($role.lastScan)").ToUniversalTime()
                if (($now - $lastScan).TotalDays -ge $window) { $isDue = $true }
            } catch {
                $isDue = $true   # unparseable date → treat as due rather than skip
            }
        }
        if ($isDue) {
            $due += ('  - {0} ({1}, {2})' -f $role.title, $cadence, $role.authority)
        }
    }

    # Record that we checked today, regardless of outcome (the once-per-day contract).
    if (-not (Test-Path -LiteralPath $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }
    Set-Content -LiteralPath $lockFile -Value $today -NoNewline

    if ($due.Count -eq 0) { exit 0 }   # nothing due → silent

    $lines = @()
    $lines += 'WORLD-WATCH: a scheduled external-knowledge scan is due for these roles:'
    $lines += $due
    $lines += ''
    $lines += 'Run /world-watch to cheap-poll their sources, diff vs the last snapshot, and'
    $lines += 'route any real change (auto-ticket for Security; escalate-human for Legal/DPO).'
    $lines += 'It only scans when you run it — nothing happens unattended.'
    $context = $lines -join [Environment]::NewLine

    $json = @{ additionalContext = $context } | ConvertTo-Json -Compress
    [Console]::Out.Write($json)
    exit 0
}
catch {
    exit 0
}
