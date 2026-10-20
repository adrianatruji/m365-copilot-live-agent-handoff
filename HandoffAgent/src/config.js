// Reads and validates settings from .env so misconfiguration fails fast with a clear message.

const required = [
  'clientId', 'clientSecret', 'tenantId',
  'COPILOT_STUDIO_ENVIRONMENT_ID', 'COPILOT_STUDIO_SCHEMA_NAME',
  'LIVE_CHAT_URL', 'WEBHOOK_SECRET'
]

const missing = required.filter(name => !process.env[name])
if (missing.length) {
  console.error(`Missing settings in HandoffAgent/.env: ${missing.join(', ')}. See .env.sample or run setup.ps1.`)
  process.exit(1)
}

module.exports = {
  port: Number(process.env.PORT || 3978),
  tenantId: process.env.tenantId,
  clientId: process.env.clientId,
  copilotStudio: {
    environmentId: process.env.COPILOT_STUDIO_ENVIRONMENT_ID,
    schemaName: process.env.COPILOT_STUDIO_SCHEMA_NAME
  },
  liveChatUrl: process.env.LIVE_CHAT_URL.replace(/\/$/, ''),
  webhookSecret: process.env.WEBHOOK_SECRET,
  handoffTimeoutMinutes: Number(process.env.HANDOFF_TIMEOUT_MINUTES || 5)
}
