// Contoso Live Chat: a minimal mock contact center.
// Plays the role Genesys / ServiceNow / Salesforce would play in production:
//   - The HandoffAgent opens a session, forwards user messages and closes it (REST API below).
//   - A human agent reads and answers in the web UI (public/index.html).
//   - Replies are delivered to the HandoffAgent via a signed webhook.
// Everything is in memory and bound to localhost; it is not meant to be exposed publicly.

const crypto = require('crypto')
const path = require('path')
const express = require('express')

const PORT = Number(process.env.PORT || 5000)
const WEBHOOK_URL = process.env.HANDOFF_AGENT_WEBHOOK_URL
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET

if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
  console.error('Missing HANDOFF_AGENT_WEBHOOK_URL or WEBHOOK_SECRET. Copy .env.sample to .env (or run setup.ps1).')
  process.exit(1)
}

// conversationId -> { id, userName, status, startedAt, messages: [{ sender, text, at }] }
const conversations = new Map()

const app = express()
app.use(express.json({ limit: '32kb' }))
app.use(express.static(path.join(__dirname, 'public')))

function getOpenConversation (id, res) {
  const conv = conversations.get(id)
  if (!conv) { res.status(404).json({ error: 'Unknown conversation' }); return null }
  if (conv.status !== 'open') { res.status(409).json({ error: 'Conversation is closed' }); return null }
  return conv
}

// ---- API used by the HandoffAgent -------------------------------------------------

// Start a live chat session. Returns the contact center's own conversation id.
app.post('/api/chat/start', (req, res) => {
  const { userName = 'Unknown user', firstMessage } = req.body || {}
  const id = crypto.randomUUID()
  const conv = { id, userName: String(userName).slice(0, 100), status: 'open', startedAt: new Date().toISOString(), messages: [] }
  if (firstMessage) conv.messages.push({ sender: 'user', text: String(firstMessage).slice(0, 4000), at: new Date().toISOString() })
  conversations.set(id, conv)
  console.log(`[start] ${id} for ${conv.userName}`)
  res.json({ conversationId: id })
})

// A message from the end user (forwarded by the HandoffAgent).
app.post('/api/chat/receive', (req, res) => {
  const { conversationId, message } = req.body || {}
  const conv = getOpenConversation(conversationId, res)
  if (!conv) return
  conv.messages.push({ sender: 'user', text: String(message || '').slice(0, 4000), at: new Date().toISOString() })
  res.json({ ok: true })
})

// The user left the live chat (or it timed out).
app.post('/api/chat/end', (req, res) => {
  const { conversationId, reason = 'ended' } = req.body || {}
  const conv = conversations.get(conversationId)
  if (!conv) return res.status(404).json({ error: 'Unknown conversation' })
  conv.status = 'closed'
  conv.messages.push({ sender: 'system', text: `Conversation closed (${reason}).`, at: new Date().toISOString() })
  console.log(`[end] ${conversationId} (${reason})`)
  res.json({ ok: true })
})

// ---- API used by the agent UI -----------------------------------------------------

app.get('/api/chat/conversations', (_req, res) => {
  res.json([...conversations.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)))
})

// The human agent replies: deliver to the HandoffAgent through the signed webhook.
app.post('/api/chat/send', async (req, res) => {
  const { conversationId, message } = req.body || {}
  const conv = getOpenConversation(conversationId, res)
  if (!conv) return
  const text = String(message || '').trim().slice(0, 4000)
  if (!text) return res.status(400).json({ error: 'Message cannot be empty' })

  const body = JSON.stringify({ conversationId, message: text, sender: 'Contoso Support' })
  const signature = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
  try {
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
      body
    })
    if (!r.ok) {
      const detail = await r.text()
      console.warn(`[send] webhook returned ${r.status}: ${detail}`)
      return res.status(502).json({ error: `Delivery failed (${r.status}): ${detail}` })
    }
    conv.messages.push({ sender: 'agent', text, at: new Date().toISOString() })
    res.json({ ok: true })
  } catch (err) {
    console.error('[send] webhook error', err.message)
    res.status(502).json({ error: `Could not reach the HandoffAgent: ${err.message}` })
  }
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Contoso Live Chat running at http://localhost:${PORT} (local only)`)
})
