// Talks to the Copilot Studio agent through the Copilot Studio client API.
// Keeps one Copilot Studio conversation per Microsoft 365 Copilot chat.

const { Activity } = require('@microsoft/agents-activity')
const { CopilotStudioClient, ConnectionSettings } = require('@microsoft/agents-copilotstudio-client')
const config = require('./config')
const { getCopilotStudioToken } = require('./copilotStudioAuth')
const { track } = require('./telemetry')

// Name of the event the Copilot Studio Escalate topic sends (see copilot-studio/Escalate.yaml).
const HANDOFF_EVENT = 'handoff.requested'
const MAX_ATTEMPTS = 3

const settings = new ConnectionSettings(config.copilotStudio)
const conversations = new Map() // M365 Copilot conversation id -> Copilot Studio conversation id

// Copilot Studio streams typing activities with either a short status ("Generating plan...")
// or the answer so far. Only short statuses are relayed to the user as progress updates.
const isStatus = (text) => typeof text === 'string' && text.trim().length > 0 && text.trim().length <= 60 && /(\.\.\.|…)$/.test(text.trim())

// Retries only when the stream fails before anything arrives, so a message is never sent twice.
async function withRetry (makeStream, onActivity) {
  for (let attempt = 1; ; attempt++) {
    let received = 0
    try {
      for await (const activity of makeStream()) { received++; onActivity(activity) }
      return
    } catch (err) {
      if (received > 0 || attempt === MAX_ATTEMPTS) throw err
      track('CopilotStudioRetry', { error: err.message }, { attempt })
      await new Promise(resolve => setTimeout(resolve, 500 * attempt))
    }
  }
}

/**
 * Sends one user turn to Copilot Studio.
 * @param {string} chatId Microsoft 365 Copilot conversation id.
 * @param {string} text User message.
 * @param {object} [value] Card submission payload (e.g. a connector consent card), passed through as-is.
 * @param {(status: string) => void} [onProgress] Called with Copilot Studio status updates.
 * @returns {Promise<{ replies: object[], handoff: { context: any } | null, mcsConversationId: string }>}
 */
async function sendToCopilotStudio (chatId, text, value, onProgress = () => {}) {
  const client = new CopilotStudioClient(settings, await getCopilotStudioToken())

  let mcsConversationId = conversations.get(chatId)
  if (!mcsConversationId) {
    // Starting the conversation returns the agent's greeting; it is not shown to the user.
    await withRetry(() => client.startConversationStreaming(true), (a) => { mcsConversationId ??= a.conversation?.id })
    conversations.set(chatId, mcsConversationId)
  }

  const replies = []
  let handoff = null
  let firstActivityMs
  const sentAt = Date.now()
  const activity = Activity.fromObject(value ? { type: 'message', text, value } : { type: 'message', text })

  await withRetry(() => client.sendActivityStreaming(activity, mcsConversationId), (a) => {
    firstActivityMs ??= Date.now() - sentAt
    if (a.type === 'typing' && isStatus(a.text)) onProgress(a.text.trim())
    else if (a.type === 'event' && a.name === HANDOFF_EVENT) handoff = { context: a.value }
    else if (a.type === 'message' && (a.text || a.attachments?.length)) replies.push(a)
    else if (a.type === 'endOfConversation') conversations.delete(chatId)
  })

  track('CopilotStudioTurn',
    { copilotConversationId: chatId, mcsConversationId, handoffRequested: !!handoff },
    { durationMs: Date.now() - sentAt, firstActivityMs, replyCount: replies.length })

  // After a handoff the next turn starts a fresh Copilot Studio conversation.
  if (handoff) conversations.delete(chatId)
  return { replies, handoff, mcsConversationId }
}

module.exports = { sendToCopilotStudio }
