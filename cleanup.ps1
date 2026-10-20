<#
.SYNOPSIS
  Deletes the resources created by setup.ps1 (Azure Bot resource group, Entra app, dev tunnel).
  Remove the custom app from Teams (Apps > Manage your apps) yourself.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$state = Get-Content "$root/setup-output.json" -Raw -ErrorAction Stop | ConvertFrom-Json

Write-Host "Deleting resource group $($state.resourceGroup) (Azure Bot)..."
az group delete -n $state.resourceGroup --yes --no-wait
Write-Host "Deleting Entra app $($state.appId)..."
az ad app delete --id $state.appId
Write-Host "Deleting dev tunnel $($state.tunnel)..."
devtunnel delete $state.tunnel --force

Remove-Item "$root/setup-output.json", "$root/HandoffAgent/.env", "$root/ContosoLiveChat/.env", "$root/HandoffAgent/.msal-cache.json" -ErrorAction SilentlyContinue
Write-Host 'Done. Remember to remove "Live Agent Handoff Demo" from Teams > Apps > Manage your apps.'
