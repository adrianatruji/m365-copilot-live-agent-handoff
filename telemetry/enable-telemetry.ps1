<#
.SYNOPSIS
  Option B: adds end-to-end telemetry to the live agent handoff demo. Run after setup.ps1.

.DESCRIPTION
  1. Log Analytics workspace + Application Insights in the demo resource group
  2. APPLICATIONINSIGHTS_CONNECTION_STRING -> HandoffAgent/.env (turns on HandoffAgent/src/telemetry.js)

  One manual step remains: paste the connection string into Copilot Studio (printed at the end).
  cleanup.ps1 removes these resources too (they live in the same resource group).
#>
#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$statePath = "$root/setup-output.json"

function Step ($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
# az is a native command: $ErrorActionPreference doesn't stop on its failures, so check every value we depend on.
function Require ($value, $what) { if (-not $value) { throw "Could not $what (see the az error above)." }; $value }

if (-not (Test-Path $statePath)) { throw 'setup-output.json not found. Run ./setup.ps1 first.' }
$state = Get-Content $statePath -Raw | ConvertFrom-Json
$rg = $state.resourceGroup
$name = $state.name
$location = az group show -n $rg --query location -o tsv
if (-not $location) { throw "Resource group '$rg' not found. Are you signed in to the right subscription (az account show)?" }

az extension add -n application-insights --only-show-errors 2>$null

Step "Creating Log Analytics workspace 'law-$name'"
az monitor log-analytics workspace create -g $rg -n "law-$name" -l $location -o none
$workspaceId = Require (az monitor log-analytics workspace show -g $rg -n "law-$name" --query id -o tsv) 'create the Log Analytics workspace'

Step "Creating Application Insights 'appi-$name'"
az monitor app-insights component create -g $rg -a "appi-$name" -l $location --workspace $workspaceId --application-type web -o none
$connectionString = Require (az monitor app-insights component show -g $rg -a "appi-$name" --query connectionString -o tsv) 'create Application Insights'

Step 'Turning on telemetry in HandoffAgent/.env'
$envPath = "$root/HandoffAgent/.env"
$lines = @(Get-Content $envPath | Where-Object { $_ -notmatch '^APPLICATIONINSIGHTS_CONNECTION_STRING=' })
$lines + "APPLICATIONINSIGHTS_CONNECTION_STRING=$connectionString" | Set-Content $envPath -Encoding utf8

$state | Add-Member -NotePropertyName appInsights -NotePropertyValue "appi-$name" -Force
$state | ConvertTo-Json | Set-Content $statePath -Encoding utf8
try { Set-Clipboard -Value $connectionString; $copied = ' (copied to your clipboard)' } catch { $copied = '' }

Step 'Done'
Write-Host @"

Created: Log Analytics 'law-$name' and Application Insights 'appi-$name' in '$rg'.

Next steps (see telemetry/README.md):
  1. Restart the HandoffAgent (Ctrl+C, then npm start). You should see "Telemetry: sending to Application Insights".
  2. Copilot Studio > your agent > Settings > Advanced > Application Insights:
       - Connection string${copied}:
         $connectionString
       - Turn off "Log conversation details" (on by default; adds user names and message text).
       - Make sure "Enable logging" and "Node execution events" are on, then Save and Publish the agent.
  3. Chat with the agent in Microsoft 365 Copilot (include a handoff), wait 2-5 minutes, then run:
       ./telemetry/show-conversation.ps1
"@
