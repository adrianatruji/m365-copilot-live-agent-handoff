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
| **HandoffAgent** | Application Insights (`customEvents`, `requests`, `exceptions`, plus Agents SDK spans in `dependencies` and `traces`) | Each step of the conversation: Copilot Studio response times, handoff started / ended (and why), user messages forwarded, live agent replies delivered (or failed), retries and errors. `requests` shows every call from Microsoft 365 Copilot and the contact center webhook, with durations. **No message text**: only ids, timings and outcomes. |
| **Copilot Studio agent** | Same Application Insights ([agent-level telemetry](https://learn.microsoft.com/microsoft-copilot-studio/advanced-bot-framework-composer-capture-telemetry)) | Topics, nodes and messages for the same conversation. |

**How the sources are joined:** every HandoffAgent event carries `copilotConversationId` (the Microsoft 365 Copilot chat). Copilot Studio steps also carry `mcsConversationId`, the same id Copilot Studio logs as `conversationId`.

### HandoffAgent events

| Event | When | Key fields |
|---|---|---|
| `UserMessageReceived` | Every user message | `mode` (assistant / handoff), `textLength` |
| `CopilotStudioTurn` | Copilot Studio answered | `durationMs`, `firstActivityMs`, `handoffRequested`, `mcsConversationId` |
| `CopilotStudioRetry` | Copilot Studio stream dropped before any reply | `stage` (startConversation / sendActivity), `attempt`, `error` |
| `AssistantTurnCompleted` | Answer delivered to the user | `totalMs`, `outcome`: stream result (`success`, `error`, `userCanceled`, `alreadyEnded`) or `copilotStudioError` |
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

    It creates a Log Analytics workspace and an Application Insights resource in the demo resource group and adds `APPLICATIONINSIGHTS_CONNECTION_STRING` to `HandoffAgent/.env`. It takes 2–3 minutes and is safe to run more than once.

1. **Restart the HandoffAgent** (Ctrl+C, then `npm start`). You should see `Telemetry: sending to Application Insights`.

    {: .note }
    > With telemetry on, the HandoffAgent takes about 5–8 seconds longer to start while it loads the Application Insights libraries. The **first** start after `npm install` can take a minute or two with no output (the new packages are loaded and scanned for the first time); wait for `HandoffAgent listening on port 3978`.

1. **Connect Copilot Studio** to the same resource. In Copilot Studio, open your agent and go to **Settings > Advanced > Application Insights**:
    - Paste the **connection string**. The script prints it and copies it to your clipboard.
    - Make sure **Enable logging** and **Node execution events** are on.
    - Turn **off** **Log conversation details**. It's on by default and adds user names and message text to the logs; the timeline join doesn't need it.
    - **Save**, then **Publish** the agent.

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
| [`copilot-studio-performance.kql`](./queries/copilot-studio-performance.kql) | Copilot Studio response times (median, p95, slower than 15 s), retries, Copilot Studio failures and delivery errors to Microsoft 365 Copilot |

## What You Can't See

- **Microsoft 365 Copilot's own processing** (for example, why a reply wasn't shown) isn't exposed. Use the `AssistantTurnCompleted` outcome and Microsoft support.
- **Microsoft 365 Copilot traffic in Azure Bot logs.** Microsoft 365 Copilot calls the HandoffAgent directly, so the Azure Bot resource's diagnostic logs don't record these conversations. Use the HandoffAgent's `requests` instead.
- **What the orchestrator did with generative orchestration.** Copilot Studio logs topics and nodes when a topic runs (for example *Escalate*). Turns answered directly by generative orchestration only show `BotMessageReceived` and `BotMessageSend`.
- **The contact center's side** (queue times, agent assignment). Use your contact center's own reporting; `liveChatConversationId` links the two.

{: .note }
> When the HandoffAgent runs outside Azure (for example on your machine), each start logs one `ENETUNREACH 169.254.169.254` exception: the Application Insights SDK checks whether it's running on an Azure VM. You can ignore it. The `traces` table also has one `activity.received` / `activity.sent` entry per activity the Agents SDK handles (ids and types only).

## Cleanup

`cleanup.ps1` deletes the demo resource group, which includes the workspace and Application Insights. Also clear the connection string in Copilot Studio (**Settings > Advanced > Application Insights**) and publish, so the agent stops sending telemetry to a deleted resource. To turn telemetry off but keep the resources, remove `APPLICATIONINSIGHTS_CONNECTION_STRING` from `HandoffAgent/.env` and clear the connection string in Copilot Studio.
