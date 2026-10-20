# HandoffAgent

Custom engine agent for Microsoft 365 Copilot (Node.js, [Microsoft 365 Agents SDK](https://learn.microsoft.com/microsoft-365/agents-sdk/)). It answers with your Copilot Studio agent and hands conversations off to a live agent. See the [main README](../README.md) for setup.

## Project Structure

```
HandoffAgent/
├── src/
│   ├── index.js              # Web server: /api/messages (Copilot) and /api/livechat/messages (webhook)
│   ├── agent.js              # Conversation logic: streaming, handoff, acknowledgements, exit, timeout
│   ├── copilotStudio.js      # Calls the Copilot Studio agent (client API), detects handoff.requested
│   ├── copilotStudioAuth.js  # Token for Copilot Studio (device-code sign-in, demo only)
│   ├── liveChat.js           # Contact center integration: replace for Genesys, ServiceNow, …
│   ├── handoffSessions.js    # Which chats are with a human (in memory)
│   ├── config.js             # Reads and validates .env
│   └── login.js              # npm run login
├── appPackage/               # Teams / Microsoft 365 Copilot app manifest + icons
└── .env.sample
```

## Endpoints

| Method | Path | Called by | Security |
|---|---|---|---|
| `POST` | `/api/messages` | Microsoft 365 Copilot (via Azure Bot) | Bot Framework JWT, validated by the Agents SDK |
| `POST` | `/api/livechat/messages` | Contact center (human replies) | HMAC-SHA256 signature (`X-Hub-Signature-256`) with `WEBHOOK_SECRET` |

## Key Behaviors (Microsoft 365 Copilot)

| Behavior | Where | Why |
|---|---|---|
| Streams answers (`context.streamingResponse`) with progress updates | `agent.js` → `answerWithCopilotStudio` | Copilot needs a first response within 15 s; the SDK adds keep-alives on slow answers |
| Replies **✓ Sent to the support agent** (streamed, with an **Exit chat with agent** card) to every message during the handoff | `agent.js` → `handleMessageDuringHandoff` / `reply` | Copilot locks the chat if a prompt gets no reply, and doesn't show plain (non-streamed) replies or `suggestedActions` |
| Pushes human replies with `proactive.sendActivity` | `agent.js` → `deliverAgentReply` | The live agent answers outside the user's turn |
| Retries the Copilot Studio call only if nothing was received | `copilotStudio.js` → `withRetry` | Recovers from dropped connections without sending a message twice |
| Passes card submissions (e.g. connector consent) to Copilot Studio | `copilotStudio.js` | Lets users approve connections in the chat |
