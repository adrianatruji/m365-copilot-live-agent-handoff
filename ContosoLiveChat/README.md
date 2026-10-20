# Contoso Live Chat

A minimal mock contact center for the [live agent handoff sample](../README.md). It plays the role of Genesys, ServiceNow or Salesforce: it receives conversations from the HandoffAgent and gives a human agent a desk to read and reply.

It runs on `http://localhost:5000`, is bound to localhost only, and keeps everything in memory.

## Project Structure

```
ContosoLiveChat/
├── server.js          # REST API + signed webhook to the HandoffAgent
├── public/index.html  # Agent desk UI
└── .env.sample        # PORT, HANDOFF_AGENT_WEBHOOK_URL, WEBHOOK_SECRET
```

## API

| Method | Endpoint | Called by | Description |
|---|---|---|---|
| `POST` | `/api/chat/start` | HandoffAgent | Starts a conversation, returns `conversationId` |
| `POST` | `/api/chat/receive` | HandoffAgent | Adds a message from the user |
| `POST` | `/api/chat/end` | HandoffAgent | Closes the conversation |
| `GET` | `/api/chat/conversations` | Agent desk | Lists conversations and messages |
| `POST` | `/api/chat/send` | Agent desk | Sends the human agent's reply to the HandoffAgent webhook, signed with HMAC-SHA256 (`X-Hub-Signature-256`) |
