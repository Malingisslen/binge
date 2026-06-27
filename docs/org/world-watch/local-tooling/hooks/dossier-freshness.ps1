# dossier-freshness.ps1 — PostToolUse(Write|Edit) hook
# When a file is written/edited, match its repo-relative path against the committed
# ownership map (docs/org/ownership-map.json) and drop a staleness marker for every
# role that owns a matching path. The /refresh-dossiers skill later re-audits ONLY the
# flagged roles and clears their markers.
#
# This hook ONLY ever writes documentation-freshness markers under .claude/state/ —
# it never touches app code, never blocks, and produces no tool output.
# Fails OPEN on any error (exit 0). Ships with no markers (all dossiers fresh).
#
# Markers: .claude/state/dossier-stale/<roleNumber>.marker (gitignored), each line
# "<editedPath>\t<utc-timestamp>". Self-edits to the docs that DEFINE the system
# (.claude/, docs/org/, the role doc itself) are skipped so the loop can't self-trigger.

$ErrorActionPreference = 'Stop'
try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
    $payload = $raw | ConvertFrom-Json

    $tool = "$($payload.tool_name)"
    if ($tool -notin @('Write', 'Edit', 'MultiEdit', 'NotebookEdit')) { exit 0 }

    $filePath = "$($payload.tool_input.file_path)"
    if ([string]::IsNullOrWhiteSpace($filePath)) { exit 0 }

    $repoRoot = (& git rev-parse --show-toplevel 2>$null)
    if ([string]::IsNullOrWhiteSpace($repoRoot)) { $repoRoot = $env:CLAUDE_PROJECT_DIR }
    if ([string]::IsNullOrWhiteSpace($repoRoot)) { $repoRoot = (Get-Location).Path }
    $repoRoot = $repoRoot.Trim()

    # Repo-relative, forward-slash.
    $full = try { (Resolve-Path -LiteralPath $filePath -ErrorAction Stop).Path } catch { $filePath }
    $rootNorm = $repoRoot.Replace('\','/').TrimEnd('/')
    $rel = $full.Replace('\','/')
    if ($rel.ToLower().StartsWith($rootNorm.ToLower() + '/')) {
        $rel = $rel.Substring($rootNorm.Length + 1)
    }
    $relLower = $rel.ToLower()

    # Skip the docs that define the system (no self-trigger) + non-repo paths.
    if ($relLower.StartsWith('.claude/')) { exit 0 }
    if ($relLower.StartsWith('docs/org/')) { exit 0 }
    if ($relLower -eq 'docs/role-responsibilities.md') { exit 0 }
    if ($rel.StartsWith('/') -or $rel -match '^[a-zA-Z]:/') { exit 0 }  # outside repo

    $mapPath = Join-Path $repoRoot 'docs/org/ownership-map.json'
    if (-not (Test-Path -LiteralPath $mapPath)) { exit 0 }
    $map = Get-Content -LiteralPath $mapPath -Raw | ConvertFrom-Json

    function Test-PatternMatch([string]$rel, [string]$relLower, [string]$pattern) {
        $p = $pattern.Replace('\','/')
        $pLower = $p.ToLower()
        if ($p.Contains('*')) {
            $rx = '^' + [regex]::Escape($pLower).Replace('\*', '[^/]*') + '$'
            return ($relLower -match $rx)
        }
        if ($p.EndsWith('/')) { return $relLower.StartsWith($pLower) }     # dir prefix
        if (-not $p.Contains('/')) { return ($relLower -eq $pLower) }       # root file
        return ($relLower -eq $pLower -or $relLower.StartsWith($pLower + '/'))
    }

    $owning = @()
    foreach ($prop in $map.roles.PSObject.Properties) {
        $num = $prop.Name
        foreach ($pat in $prop.Value.patterns) {
            if (Test-PatternMatch $rel $relLower "$pat") { $owning += $num; break }
        }
    }
    if ($owning.Count -eq 0) { exit 0 }

    $staleDir = Join-Path $repoRoot '.claude/state/dossier-stale'
    if (-not (Test-Path -LiteralPath $staleDir)) {
        New-Item -ItemType Directory -Path $staleDir -Force | Out-Null
    }
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    foreach ($num in ($owning | Select-Object -Unique)) {
        $marker = Join-Path $staleDir ("{0}.marker" -f $num)
        Add-Content -LiteralPath $marker -Value ("{0}`t{1}" -f $rel, $stamp)
    }
    exit 0
}
catch {
    exit 0
}
