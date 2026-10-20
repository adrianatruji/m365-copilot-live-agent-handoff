// Integration with the contact center. Replace this file to connect a real system
// (e.g. Genesys Open Messaging): startChat / forwardUserMessage / endChat call its API,
// and verifyWebhook checks the signature on replies it sends back.

const crypto = require('crypto')
const config = require('./config')

async function call (path, body) {
  const res = await fetch(`${config.liveChatUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  })
  if (!res.ok) throw new Error(`Live chat ${path} returned ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Opens a live chat session and returns the contact center's conversation id. */
async function startChat (userName, firstMessage) {
  const { conversationId } = await call('/api/chat/start', { userName, firstMessage })
  return conversationId
}

const forwardUserMessage = (liveChatId, message) => call('/api/chat/receive', { conversationId: liveChatId, message })

const endChat = (liveChatId, reason) => call('/api/chat/end', { conversationId: liveChatId, reason })

/** Checks the HMAC-SHA256 signature (X-Hub-Signature-256) of an incoming webhook body. */
function verifyWebhook (rawBody, signatureHeader) {
  if (!rawBody || typeof signatureHeader !== 'string') return false
  const expected = 'sha256=' + crypto.createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

module.exports = { startChat, forwardUserMessage, endChat, verifyWebhook }
