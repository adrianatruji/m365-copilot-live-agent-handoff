// Web server:
//   POST /api/messages            Microsoft 365 Copilot -> agent (Bot Framework, JWT-validated by the SDK)
//   POST /api/livechat/messages   Contact center -> agent (human replies, HMAC-signed webhook)

const config = require('./config')
const express = require('express')
const { loadAuthConfigFromEnv } = require('@microsoft/agents-hosting')
const { createAgentRequestHandler } = require('@microsoft/agents-hosting-express')
const { HandoffAgent } = require('./agent')
const liveChat = require('./liveChat')

const agent = new HandoffAgent()
const app = express()

app.post('/api/messages', express.json(), createAgentRequestHandler(agent, loadAuthConfigFromEnv()))

// Raw body is kept so the signature can be checked against exactly what was sent.
app.post('/api/livechat/messages', express.raw({ type: 'application/json', limit: '32kb' }), async (req, res) => {
  if (!liveChat.verifyWebhook(req.body, req.get('x-hub-signature-256'))) {
    return res.status(401).json({ error: 'Invalid signature' })
  }
  let payload
  try { payload = JSON.parse(req.body.toString('utf8')) } catch { return res.status(400).json({ error: 'Invalid JSON' }) }

  const { conversationId, message, sender = 'Support agent' } = payload
  if (typeof conversationId !== 'string' || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'conversationId and message are required' })
  }
  try {
    const delivered = await agent.deliverAgentReply(conversationId, String(sender).slice(0, 100), message.slice(0, 4000))
    if (!delivered) return res.status(404).json({ error: 'No active handoff for this conversation' })
    res.json({ ok: true })
  } catch (err) {
    console.error('Proactive delivery failed:', err.message)
    res.status(502).json({ error: 'Could not deliver the message to Microsoft 365 Copilot' })
  }
})

app.get('/', (_req, res) => res.send('HandoffAgent is running.'))

// Return JSON errors (e.g. 413 for oversized webhook bodies) instead of HTML pages with stack traces.
app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' })
})

// Express 5 passes listen errors (e.g. EADDRINUSE) to this callback instead of throwing.
app.listen(config.port, (err) => {
  if (err) {
    console.error(`Could not start on port ${config.port}: ${err.message}`)
    process.exit(1)
  }
  console.log(`HandoffAgent listening on port ${config.port}`)
})
