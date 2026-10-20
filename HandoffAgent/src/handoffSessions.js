// Which Microsoft 365 Copilot chats are currently with a human agent.
// In memory for the demo; use durable storage (e.g. Cosmos DB) in production.

const sessions = new Map() // M365 Copilot conversation id -> { liveChatId, startedAt, timer }

const get = (chatId) => sessions.get(chatId)

const findByLiveChatId = (liveChatId) => {
  for (const [chatId, session] of sessions) {
    if (session.liveChatId === liveChatId) return { chatId, session }
  }
  return null
}

function start (chatId, liveChatId) {
  sessions.set(chatId, { liveChatId, startedAt: Date.now(), timer: null })
}

function end (chatId) {
  const session = sessions.get(chatId)
  if (session) clearTimeout(session.timer)
  sessions.delete(chatId)
  return session
}

/** (Re)starts the "no reply from the human agent" timer for a chat. */
function armTimeout (chatId, minutes, onTimeout) {
  const session = sessions.get(chatId)
  if (!session) return
  clearTimeout(session.timer)
  session.timer = setTimeout(() => onTimeout(chatId), minutes * 60000)
}

module.exports = { get, findByLiveChatId, start, end, armTimeout }
