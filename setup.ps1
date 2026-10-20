<#
.SYNOPSIS
  Creates everything the live agent handoff demo needs in your tenant and writes the config files.

.DESCRIPTION
  1. Dev tunnel  - public HTTPS address for the HandoffAgent running on this machine (port 3978)
  2. Entra app   - bot identity + delegated permission to call Copilot Studio
  3. Azure Bot   - F0 (free) bot connected to the Teams / Microsoft 365 Copilot channel
  4. .env files  - for HandoffAgent and ContosoLiveChat, with a generated webhook secret
  5. App package - HandoffAgent/appPackage/handoff-demo-app.zip to upload to Teams

  Run cleanup.ps1 to delete everything again.

.EXAMPLE
  ./setup.ps1 -EnvironmentId 00000000-0000-0000-0000-000000000000 -AgentSchemaName cr123_myAgent
#>
param(
  [Parameter(Mandatory)] [string] $EnvironmentId,     # Copilot Studio > agent > Settings > Advanced > Metadata
  [Parameter(Mandatory)] [string] $AgentSchemaName,   # same page
  [string] $ResourceGroup = 'rg-copilot-handoff-demo',
  [string] $Location = 'westeurope',
  [string] $Name = "copilot-handoff-$((Get-Random -Maximum 99999).ToString('00000'))"
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$powerPlatformApi = '8578e004-a5c6-46e7-913e-12f58912df43'        # Power Platform API
$copilotStudioInvokeScope = '204440d3-c1d0-4826-b570-99eb6f5e2aeb' # CopilotStudio.Copilots.Invoke

function Step ($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Require ($cmd, $hint) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd not found. $hint" } }

Step 'Checking prerequisites'
Require az 'Install the Azure CLI: https://aka.ms/installazurecli'
Require devtunnel 'Install Dev Tunnels: winget install Microsoft.devtunnel'
Require node 'Install Node.js 20 or later: https://nodejs.org'
$account = az account show -o json 2>$null | ConvertFrom-Json
if (-not $account) { throw 'Run "az login" first (use an account in the same tenant as Copilot Studio).' }
devtunnel user show *> $null; if ($LASTEXITCODE -ne 0) { throw 'Run "devtunnel user login" first.' }
$tenantId = $account.tenantId
Write-Host "Tenant: $tenantId  Subscription: $($account.name)"

Step "Creating dev tunnel '$Name'"
devtunnel create $Name --allow-anonymous | Out-Null
devtunnel port create $Name -p 3978 | Out-Null
$tunnel = (devtunnel show $Name -j | ConvertFrom-Json).tunnel
$tunnelUrl = $tunnel.ports[0].portUri.TrimEnd('/')
Write-Host "Tunnel URL: $tunnelUrl"

Step "Creating Entra app registration '$Name'"
$app = az ad app create --display-name $Name --sign-in-audience AzureADMyOrg --is-fallback-public-client true -o json | ConvertFrom-Json
az ad sp create --id $app.appId -o none
$secret = az ad app credential reset --id $app.appId --display-name 'handoff-demo' --years 1 --query password -o tsv 2>$null
# Make sure the Power Platform API exists in this tenant, then request permission to call Copilot Studio agents.
az ad sp show --id $powerPlatformApi -o none 2>$null; if ($LASTEXITCODE -ne 0) { az ad sp create --id $powerPlatformApi -o none }
az ad app permission add --id $app.appId --api $powerPlatformApi --api-permissions "$copilotStudioInvokeScope=Scope" -o none 2>$null
az ad app permission admin-consent --id $app.appId -o none 2>$null
if ($LASTEXITCODE -ne 0) { Write-Warning 'Admin consent not granted (needs an admin). You will be asked to consent when you run "npm run login".' }

Step "Creating Azure Bot '$Name' in resource group '$ResourceGroup'"
az group create -n $ResourceGroup -l $Location -o none
az bot create -g $ResourceGroup -n $Name --app-type SingleTenant --appid $app.appId --tenant-id $tenantId `
  --sku F0 --endpoint "$tunnelUrl/api/messages" -o none
az bot msteams create -g $ResourceGroup -n $Name -o none 2>$null

Step 'Writing configuration files'
$webhookSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
@"
PORT=3978
clientId=$($app.appId)
clientSecret=$secret
tenantId=$tenantId
COPILOT_STUDIO_ENVIRONMENT_ID=$EnvironmentId
COPILOT_STUDIO_SCHEMA_NAME=$AgentSchemaName
LIVE_CHAT_URL=http://localhost:5000
WEBHOOK_SECRET=$webhookSecret
HANDOFF_TIMEOUT_MINUTES=5
"@ | Set-Content "$root/HandoffAgent/.env" -Encoding utf8
@"
PORT=5000
HANDOFF_AGENT_WEBHOOK_URL=http://localhost:3978/api/livechat/messages
WEBHOOK_SECRET=$webhookSecret
"@ | Set-Content "$root/ContosoLiveChat/.env" -Encoding utf8

Step 'Building the Teams / Microsoft 365 Copilot app package'
$pkg = "$root/HandoffAgent/appPackage"
(Get-Content "$pkg/manifest.template.json" -Raw).Replace('{{TEAMS_APP_ID}}', [guid]::NewGuid().ToString()).Replace('{{BOT_ID}}', $app.appId) |
  Set-Content "$pkg/manifest.json" -Encoding utf8
$zip = "$pkg/handoff-demo-app.zip"
Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path "$pkg/manifest.json", "$pkg/color.png", "$pkg/outline.png" -DestinationPath $zip

@{ name = $Name; resourceGroup = $ResourceGroup; appId = $app.appId; tunnel = $Name } |
  ConvertTo-Json | Set-Content "$root/setup-output.json" -Encoding utf8

Step 'Done'
Write-Host @"

Created: dev tunnel '$Name', Entra app $($app.appId), Azure Bot '$Name' (resource group '$ResourceGroup').

Next steps (see README.md for details):
  1. Terminal 1:  devtunnel host $Name
  2. Terminal 2:  cd ContosoLiveChat; npm install; npm start      -> open http://localhost:5000
  3. Terminal 3:  cd HandoffAgent;   npm install; npm run login; npm start
  4. In Teams: Apps > Manage your apps > Upload a custom app > HandoffAgent/appPackage/handoff-demo-app.zip
"@
