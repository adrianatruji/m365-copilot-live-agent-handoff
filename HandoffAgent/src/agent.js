// The custom engine agent users talk to in Microsoft 365 Copilot.
//
//  - Normal turns go to the Copilot Studio agent and are streamed back (progress + answer),
//    which keeps Microsoft 365 Copilot within its response-time limits.
//  - When Copilot Studio sends the handoff event, the chat is handed to a human in the contact center.
//  - During the handoff every user message is acknowledged immediately: Microsoft 365 Copilot expects
//    a reply to each prompt and locks the chat if the agent stays silent.
//  - Human replies arrive later and are pushed into the same chat with proactive messaging.

const { AgentApplication, MemoryStorage } = require('@microsoft/agents-hosting')
const { ActivityTypes } = require('@microsoft/agents-activity')
const config = require('./config')
const { sendToCopilotStudio } = require('./copilotStudio')
const liveChat = require('./liveChat')
const sessions = require('./handoffSessions')
const { track, trackError, minutesSince } = require('./telemetry')

const EXIT_COMMAND = /^(exit|cancel|stop|end chat|back to bot|exit chat with agent)$/i

const TEXT = {
  handoffStarted: 'Connecting you to a member of the support team. Their replies will appear in this chat. Type "exit" at any time to go back to the assistant.',
  handoffUnavailable: 'Sorry, nobody from the support team is available right now. Please try again later.',
  forwarded: '✓ Sent to the support agent. Their reply will appear here.',
  forwardFailed: 'The live chat has ended. You are back with the assistant.',
  exited: 'You have left the chat with the support agent and are back with the assistant. How can I help?',
  timedOut: (min) => `No one from the support team has replied in the last ${min} minutes, so you are back with the assistant. Ask for a person again if you still need help.`,
  error: 'Sorry, I could not get an answer just now. Please try again.',
  empty: 'Sorry, I did not get an answer for that. Could you rephrase it?'
}

// Microsoft 365 Copilot does not render suggestedActions, so the exit button is an Adaptive Card.
const exitCard = {
  contentType: 'application/vnd.microsoft.card.adaptive',
  content: {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.5',
    body: [],
    actions: [{ type: 'Action.Submit', title: 'Exit chat with agent', data: { action: 'exitHandoff' } }]
  }
}

/**
 * Replies to the user's turn. On streaming channels (Microsoft 365 Copilot) the reply must be sent
 * as a streamed final message: a plain sendActivity is accepted by the service but not shown, and
 * the chat times out ("The agent may still be processing your request").
 */
async function reply (context, text, { exitButton = false } = {}) {
  const stream = context.streamingResponse
  if (stream.isStreamingChannel) {
    stream.queueTextChunk(text)
    if (exitButton) stream.setAttachments([exitCard])
    await stream.endStream()
  } else {
    await context.sendActivity({ type: 'message', text, attachments: exitButton ? [exitCard] : [] })
  }
}

const storage = new MemoryStorage()
const turnQueues = new Map() // keeps each chat's Copilot Studio turns in order

function inOrder (chatId, work) {
  const next = (turnQueues.get(chatId) || Promise.resolve()).catch(() => {}).then(work)
  turnQueues.set(chatId, next)
  next.finally(() => { if (turnQueues.get(chatId) === next) turnQueues.delete(chatId) }).catch(() => {})
  return next
}

class HandoffAgent extends AgentApplication {
  constructor () {
    super({ storage, proactive: { storage } })
    this.onActivity(ActivityTypes.Message, (context) => this.handleMessage(context))
  }

  async handleMessage (context) {
    // Saves the reference needed to push human replies into this chat later.
    const chatId = await this.proactive.storeConversation(context)
    const text = (context.activity.text || '').trim()
    const value = context.activity.value
    const inHandoff = !!sessions.get(chatId)
    track('UserMessageReceived', { copilotConversationId: chatId, mode: inHandoff ? 'handoff' : 'assistant', cardSubmit: !!value }, { textLength: text.length })

    if (inHandoff) return this.handleMessageDuringHandoff(context, chatId, text, value)
    return this.answerWithCopilotStudio(context, chatId, text, value)
  }

  async handleMessageDuringHandoff (context, chatId, text, value) {
    const session = sessions.get(chatId)
    const ids = { copilotConversationId: chatId, liveChatConversationId: session.liveChatId }

    if (EXIT_COMMAND.test(text) || value?.action === 'exitHandoff') {
      sessions.end(chatId)
      track('HandoffEnded', { ...ids, reason: 'userExit' }, { minutesInHandoff: minutesSince(session.startedAt) })
      await liveChat.endChat(session.liveChatId, 'user left').catch(err => console.warn('endChat failed:', err.message))
      await reply(context, TEXT.exited)
      return
    }

    try {
      await liveChat.forwardUserMessage(session.liveChatId, text)
      track('UserMessageForwarded', ids, { minutesSinceHandoff: minutesSince(session.startedAt) })
      await reply(context, TEXT.forwarded, { exitButton: true })
    } catch (err) {
      console.warn('Forwarding to live chat failed:', err.message)
      trackError(err, { ...ids, stage: 'forwardUserMessage' })
      track('HandoffEnded', { ...ids, reason: 'forwardFailed' }, { minutesInHandoff: minutesSince(session.startedAt) })
      sessions.end(chatId)
      await reply(context, TEXT.forwardFailed)
    }
  }

  async answerWithCopilotStudio (context, chatId, text, value) {
    const started = Date.now()
    const stream = context.streamingResponse
    const progress = (status) => { try { stream.queueInformativeUpdate(status) } catch { /* stream ended */ } }
    if (stream.isStreamingChannel) progress('Looking into that...')

    let result
    try {
      result = await inOrder(chatId, () => sendToCopilotStudio(chatId, text, value, progress))
    } catch (err) {
      console.error('Copilot Studio call failed:', err.message)
      trackError(err, { copilotConversationId: chatId, stage: 'copilotStudio' })
      result = { replies: [], handoff: null, error: true }
    }

    const parts = result.error ? [TEXT.error] : result.replies.map(r => r.text).filter(Boolean)
    const attachments = result.replies.flatMap(r => r.attachments || [])
    if (result.handoff) parts.push(await this.startHandoff(context, chatId, result.handoff.context || text, result.mcsConversationId))
    const answer = parts.join('\n\n') || (attachments.length ? 'To continue, please respond to the card below.' : TEXT.empty)

    let outcome = 'sent'
    if (stream.isStreamingChannel) {
      // A streamed turn ends with one final message, so all replies are combined into it.
      stream.queueTextChunk(answer)
      if (attachments.length) stream.setAttachments(attachments)
      outcome = await stream.endStream()
    } else {
      await context.sendActivity({ type: 'message', text: answer, attachments })
    }
    track('AssistantTurnCompleted',
      { copilotConversationId: chatId, mcsConversationId: result.mcsConversationId, streamed: stream.isStreamingChannel, outcome: result.error ? 'error' : outcome },
      { totalMs: Date.now() - started })
  }

  async startHandoff (context, chatId, reason, mcsConversationId) {
    try {
      const userName = context.activity.from?.name || 'Microsoft 365 Copilot user'
      const liveChatId = await liveChat.startChat(userName, typeof reason === 'string' ? reason : JSON.stringify(reason))
      sessions.start(chatId, liveChatId)
      sessions.armTimeout(chatId, config.handoffTimeoutMinutes, (id) => this.onHumanTimeout(id))
      console.log(`Handoff started: chat ${chatId} -> live chat ${liveChatId}`)
      track('HandoffStarted', { copilotConversationId: chatId, mcsConversationId, liveChatConversationId: liveChatId })
      return TEXT.handoffStarted
    } catch (err) {
      console.error('Could not start live chat:', err.message)
      trackError(err, { copilotConversationId: chatId, mcsConversationId, stage: 'startHandoff' })
      track('HandoffFailed', { copilotConversationId: chatId, mcsConversationId, error: err.message })
      return TEXT.handoffUnavailable
    }
  }

  /** Called by the live chat webhook when a human agent replies. Returns false if the chat is unknown. */
  async deliverAgentReply (liveChatId, sender, message) {
    const found = sessions.findByLiveChatId(liveChatId)
    if (!found) return false
    const ids = { copilotConversationId: found.chatId, liveChatConversationId: liveChatId }
    const minutes = { minutesSinceHandoff: minutesSince(found.session.startedAt) }
    try {
      await this.proactive.sendActivity(this.adapter, found.chatId, { type: 'message', text: `**${sender}:** ${message}` })
    } catch (err) {
      track('AgentReplyDelivered', { ...ids, result: 'failed', error: err.message }, minutes)
      trackError(err, { ...ids, stage: 'proactiveDelivery' })
      throw err
    }
    track('AgentReplyDelivered', { ...ids, result: 'ok' }, { ...minutes, textLength: message.length })
    sessions.armTimeout(found.chatId, config.handoffTimeoutMinutes, (id) => this.onHumanTimeout(id))
    return true
  }

  async onHumanTimeout (chatId) {
    const session = sessions.end(chatId)
    if (!session) return
    track('HandoffEnded', { copilotConversationId: chatId, liveChatConversationId: session.liveChatId, reason: 'noAgentReply' }, { minutesInHandoff: minutesSince(session.startedAt) })
    await liveChat.endChat(session.liveChatId, 'no agent reply').catch(err => console.warn('endChat failed:', err.message))
    await this.proactive.sendActivity(this.adapter, chatId, { type: 'message', text: TEXT.timedOut(config.handoffTimeoutMinutes) })
      .catch(err => console.error('Timeout notice failed:', err.message))
  }
}

module.exports = { HandoffAgent }
