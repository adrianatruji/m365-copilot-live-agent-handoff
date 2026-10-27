<#
.SYNOPSIS
  Prints the end-to-end timeline of one conversation (HandoffAgent + Copilot Studio) from Application Insights.

.EXAMPLE
  ./telemetry/show-conversation.ps1                       # most recent conversation
  ./telemetry/show-conversation.ps1 -ConversationId '19:abc...@thread.v2'
#>
#Requires -Version 7.0
param(
  [string] $ConversationId,   # Microsoft 365 Copilot conversation id; defaults to the most recent one
  [string] $Since = '1d'      # how far back to look (e.g. 2h, 1d, 7d)
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$state = Get-Content "$root/setup-output.json" -Raw -ErrorAction Stop | ConvertFrom-Json
if (-not $state.appInsights) { throw 'Telemetry is not set up. Run ./telemetry/enable-telemetry.ps1 first.' }

function Invoke-Kql ($kql) {
  # az is a .cmd wrapper on Windows: pass the query as a single line, without // comment lines.
  $kql = ($kql -split "`r?`n" | Where-Object { $_ -notmatch '^\s*//' }) -join ' '
  $json = az monitor app-insights query -g $state.resourceGroup -a $state.appInsights --offset $Since --analytics-query $kql -o json
  if ($LASTEXITCODE -ne 0) { throw 'Query failed (see the error above).' }
  $table = ($json | ConvertFrom-Json).tables[0]
  foreach ($row in $table.rows) {
    $item = [ordered]@{}
    for ($i = 0; $i -lt $table.columns.Count; $i++) { $item[$table.columns[$i].name] = $row[$i] }
    [pscustomobject]$item
  }
}

if (-not $ConversationId) {
  $latest = Invoke-Kql "customEvents | where isnotempty(customDimensions.copilotConversationId) | top 1 by timestamp desc | project id = tostring(customDimensions.copilotConversationId)"
  if (-not $latest) { throw "No HandoffAgent events in the last $Since. Telemetry can take 2-5 minutes to arrive." }
  $ConversationId = $latest.id
}

Write-Host "Conversation: $ConversationId`n" -ForegroundColor Cyan
$kql = (Get-Content "$PSScriptRoot/queries/conversation-timeline.kql" -Raw).Replace('<COPILOT_CONVERSATION_ID>', $ConversationId)
Invoke-Kql $kql |
  Select-Object @{ n = 'Time'; e = { ([datetime]$_.timestamp).ToLocalTime().ToString('HH:mm:ss') } }, @{ n = 'Source'; e = { $_.source } },
    @{ n = 'Step'; e = { $_.step } }, @{ n = 'Details'; e = { $_.details } } |
  Format-Table -AutoSize -Wrap
