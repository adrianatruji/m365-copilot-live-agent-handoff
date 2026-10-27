# Option B: End-to-End Telemetry

Optional add-on to the [live agent handoff sample](../README.md). It sends telemetry from every part of the conversation to one **Application Insights** resource. One query then shows a single timeline across the HandoffAgent, the Copilot Studio agent and the live agent:

```
Time     Source         Step                   Details
10:16:58 HandoffAgent   UserMessageReceived    mode=assistant
10:17:08 Copilot Studio TopicStart             cre12_agent.topic.AccountsandPaymentsSearch
10:17:15 HandoffAgent   CopilotStudioTurn      answered in 11.3s (first response 0.5s), handoff=false
10:17:17 HandoffAgent   AssistantTurnCompleted total 19.1s, success
10:17:19 HandoffAgent   CopilotStudioTurn      answered in 1.7s (first response 0.4s), handoff=true
10:17:19 HandoffAgent   HandoffStarted         live chat a72a22c6-…
10:17:20 Copilot Studio TopicStart             cre12_agent.topic.Escalate
10:17:21 HandoffAgent   UserMessageForwarded   0.0 min after handoff
10:17:23 HandoffAgent   AgentReplyDelivered    ok, 0.1 min after handoff
10:17:25 HandoffAgent   HandoffEnded           userExit after 0.1 min
```

The base sample works without it. Skip this if you only want the demo.

## What You Get

| Source | Sent to | What you can see |
|---|---|---|
| **HandoffAgent** | Application Insights (`customEvents`, `requests`, `dependencies`, `exceptions`) | Each step of the conversation: Copilot Studio response times, handoff started / ended (and why), user messages forwarded, live agent replies delivered (or failed), retries and errors. **No message text**: only ids, timings and outcomes. |
| **Copilot Studio agent** | Same Application Insights ([agent-level telemetry](https://learn.microsoft.com/microsoft-copilot-studio/advanced-bot-framework-composer-capture-telemetry)) | Topics, nodes and generative answers for the same conversation. |
| **Azure Bot** | Log Analytics workspace (diagnostic settings) | Request volume and latency between Microsoft 365 Copilot and the bot. |

**How the sources are joined:** every HandoffAgent event carries `copilotConversationId` (the Microsoft 365 Copilot chat). Copilot Studio steps also carry `mcsConversationId`, the same id Copilot Studio logs as `conversationId`.

### HandoffAgent events

| Event | When | Key fields |
|---|---|---|
| `UserMessageReceived` | Every user message | `mode` (assistant / handoff), `textLength` |
| `CopilotStudioTurn` | Copilot Studio answered | `durationMs`, `firstActivityMs`, `handoffRequested`, `mcsConversationId` |
| `CopilotStudioRetry` | Copilot Studio stream dropped before any reply | `attempt`, `error` |
| `AssistantTurnCompleted` | Answer delivered to the user | `totalMs`, `outcome` (stream result or `error`) |
| `HandoffStarted` / `HandoffFailed` | Live chat opened (or couldn't be) | `liveChatConversationId` |
| `UserMessageForwarded` | User message sent to the live agent | `minutesSinceHandoff` |
| `AgentReplyDelivered` | Live agent reply pushed into the chat | `result` (ok / failed), `minutesSinceHandoff` |
| `HandoffEnded` | Back to the assistant | `reason` (userExit / noAgentReply / forwardFailed), `minutesInHandoff` |

## Setup

Run this after the base sample's [Installation](../README.md#installation) steps.

1. **Create the resources and turn telemetry on.** From the sample folder:

    ```powershell
    ./telemetry/enable-telemetry.ps1
    ```

    It creates a Log Analytics workspace and an Application Insights resource in the demo resource group, sends the Azure Bot's logs there, and adds `APPLICATIONINSIGHTS_CONNECTION_STRING` to `HandoffAgent/.env`. It's safe to run more than once.

1. **Restart the HandoffAgent** (Ctrl+C, then `npm start`). You should see `Telemetry: sending to Application Insights`.

    {: .note }
    > With telemetry on, the HandoffAgent takes about 8 seconds longer to start while it loads the Application Insights libraries.

1. **Connect Copilot Studio** to the same resource. In Copilot Studio, open your agent and go to **Settings > Advanced > Application Insights**:
    - Paste the **connection string**. The script prints it and copies it to your clipboard.
    - Turn on **Enable logging** and **Node execution events**.
    - **Save**, then **Publish** the agent.

    {: .note }
    > Leave **Log conversation details** off unless you need it: it adds user names and message text to the logs. The timeline join works without it.

1. **Have a conversation** in Microsoft 365 Copilot that includes a handoff (see [Usage](../README.md#usage)).

1. **Show the timeline.** Telemetry takes 2–5 minutes to arrive.

    ```powershell
    ./telemetry/show-conversation.ps1            # most recent conversation
    ./telemetry/show-conversation.ps1 -ConversationId '<id>' -Since 7d
    ```

## Queries

The [`queries`](./queries/) folder has ready-made KQL you can paste into **Application Insights > Logs** in the Azure portal:

| Query | Shows |
|---|---|
| [`conversation-timeline.kql`](./queries/conversation-timeline.kql) | One conversation end to end (what `show-conversation.ps1` runs) |
| [`handoff-summary.kql`](./queries/handoff-summary.kql) | Handoffs in the last 7 days: answered by a human, median minutes to first reply, how they ended |
| [`copilot-studio-performance.kql`](./queries/copilot-studio-performance.kql) | Copilot Studio response times (median, p95, slower than 15 s), retries and failures |

## What You Can't See

- **Microsoft 365 Copilot's own processing** (for example, why a reply wasn't shown) isn't exposed. Use the `AssistantTurnCompleted` outcome and Microsoft support.
- **The contact center's side** (queue times, agent assignment). Use your contact center's own reporting; `liveChatConversationId` links the two.

## Cleanup

`cleanup.ps1` deletes the demo resource group, which includes the workspace and Application Insights. To turn telemetry off but keep the resources, remove `APPLICATIONINSIGHTS_CONNECTION_STRING` from `HandoffAgent/.env` and clear the connection string in Copilot Studio.
