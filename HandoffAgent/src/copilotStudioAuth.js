// Token for calling the Copilot Studio agent on behalf of a signed-in user.
//
// DEMO SIMPLIFICATION: one user signs in once with a device code (npm run login) and every
// conversation calls Copilot Studio as that user. In production, use Teams SSO + on-behalf-of so
// each employee calls the agent with their own identity (see the official genesys-handoff sample).

const fs = require('fs')
const path = require('path')
const { PublicClientApplication } = require('@azure/msal-node')

const CACHE_FILE = path.join(__dirname, '..', '.msal-cache.json')
const SCOPES = ['https://api.powerplatform.com/CopilotStudio.Copilots.Invoke']

const cachePlugin = {
  beforeCacheAccess: async (ctx) => {
    if (fs.existsSync(CACHE_FILE)) ctx.tokenCache.deserialize(fs.readFileSync(CACHE_FILE, 'utf8'))
  },
  afterCacheAccess: async (ctx) => {
    if (ctx.cacheHasChanged) fs.writeFileSync(CACHE_FILE, ctx.tokenCache.serialize(), { mode: 0o600 })
  }
}

function createClient () {
  return new PublicClientApplication({
    auth: {
      clientId: process.env.clientId,
      authority: `https://login.microsoftonline.com/${process.env.tenantId}`
    },
    cache: { cachePlugin }
  })
}

async function getCopilotStudioToken () {
  const pca = createClient()
  const [account] = await pca.getTokenCache().getAllAccounts()
  if (!account) throw new Error('No signed-in user. Run "npm run login" in the HandoffAgent folder.')
  const result = await pca.acquireTokenSilent({ account, scopes: SCOPES })
  return result.accessToken
}

async function signIn () {
  const result = await createClient().acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: (r) => console.log(r.message)
  })
  return result.account.username
}

module.exports = { getCopilotStudioToken, signIn }
