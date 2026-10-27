// Optional: end-to-end telemetry in Azure Application Insights (see telemetry/README.md).
//
// Off unless APPLICATIONINSIGHTS_CONNECTION_STRING is set. When on, the agent sends one custom event
// per step of a conversation (message received, Copilot Studio turn, handoff started/ended, agent reply
// delivered...). Message text is never logged; only ids, timings and outcomes.
//
// Every event carries copilotConversationId (the Microsoft 365 Copilot chat). Copilot Studio steps also
// carry mcsConversationId, the same id Copilot Studio uses in its own Application Insights events
// (customDimensions.conversationId), which lets one query join both into a single timeline.

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim()
let client = null

if (connectionString) {
  // Must run before other modules load so outgoing HTTP calls are captured as dependencies.
  process.env.OTEL_SERVICE_NAME ??= 'handoff-agent'
  const appInsights = require('applicationinsights')
  appInsights.setup(connectionString)
    .setAutoCollectConsole(false)
    .setSendLiveMetrics(false)
    .start()
  client = appInsights.defaultClient
  console.log('Telemetry: sending to Application Insights')
}

const clean = (props) => Object.fromEntries(
  Object.entries(props).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v).slice(0, 200)])
)

/** Records a custom event. properties = text values, measurements = numbers. No-op when telemetry is off. */
function track (name, properties = {}, measurements = {}) {
  const numbers = Object.fromEntries(Object.entries(measurements).filter(([, v]) => Number.isFinite(v)))
  client?.trackEvent({ name, properties: clean(properties), measurements: numbers })
}

/** Records an exception with context. No-op when telemetry is off. */
function trackError (error, properties = {}) {
  client?.trackException({ exception: error instanceof Error ? error : new Error(String(error)), properties: clean(properties) })
}

const minutesSince = (time) => (time ? (Date.now() - time) / 60000 : undefined)

module.exports = { enabled: !!client, track, trackError, minutesSince }
