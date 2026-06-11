# Hands Body and Feet Recipes

Patterns that survive restarts, delegation boundaries, and multi-agent handoffs.

## Heartbeat After Machine Sleep

Create a cron trigger that sends email when the scheduler catches up.

```json
{
  "tool": "create_trigger",
  "args": {
    "label": "daily-heartbeat",
    "source": "cron",
    "match": {
      "cron_expression": "0 9 * * *"
    },
    "action": {
      "tool_name": "send_email",
      "tool_args_template": {
        "from": "agent@local.test",
        "to": "operator@example.com",
        "subject": "HBF heartbeat",
        "body": "The agent scheduler is awake."
      }
    },
    "delegation_label": "heartbeat-email"
  }
}
```

## Payment Flow

Request payment, share the EIP-681 URI, poll status, and watch payment webhooks.

```json
{
  "tool": "payment_request",
  "args": {
    "amount_usdc": 25,
    "memo": "Scout report",
    "expiry_hours": 72,
    "wallet_label": "primary"
  }
}
```

```json
{
  "share": {
    "eip681_uri": "ethereum:0xReceiver@8453/transfer?address=0xUSDC&uint256=25000000",
    "instructions": "Send 25 USDC on Base to complete the Scout report payment."
  }
}
```

```json
{
  "tool": "payment_status",
  "args": {
    "request_id": "pay_ab12cd34"
  }
}
```

```json
{
  "tool": "read_webhook_events",
  "args": {
    "label": "payments",
    "limit": 10
  }
}
```

```json
{
  "tool": "wait_for_webhook",
  "args": {
    "label": "payments",
    "filter": {
      "body_contains": "pay_ab12cd34"
    },
    "timeout_ms": 60000
  }
}
```

## Agent Coordination

Agent A sends work to Agent B.

```json
{
  "agent": "agent-a",
  "tool": "bus_send",
  "args": {
    "to_agent": "agent-b",
    "from_agent": "agent-a",
    "payload": {
      "task": "summarize",
      "url": "https://example.com/report",
      "reply_to": "agent-a"
    }
  }
}
```

Agent B polls and claims messages.

```json
{
  "agent": "agent-b",
  "tool": "bus_poll",
  "args": {
    "agent_id": "agent-b",
    "limit": 5
  }
}
```

Agent A waits for the response.

```json
{
  "agent": "agent-a",
  "tool": "bus_wait",
  "args": {
    "agent_id": "agent-a",
    "timeout_ms": 120000,
    "poll_interval_ms": 2000
  }
}
```

Agent B replies.

```json
{
  "agent": "agent-b",
  "tool": "bus_send",
  "args": {
    "to_agent": "agent-a",
    "from_agent": "agent-b",
    "payload": {
      "task": "summarize",
      "status": "done",
      "summary": "The report says revenue rose 12%."
    }
  }
}
```

## External Inbox Binding

Bind a hosted AgentMail inbox in `~/.hands-and-feet/config.json`.

```json
{
  "externalInboxes": [
    {
      "provider": "agentmail",
      "address": "scout-01@agentmail.to",
      "api_key_memory_key": "secret:agentmail_api_key"
    }
  ]
}
```

Store the API key in HBF memory.

```json
{
  "tool": "set_memory",
  "args": {
    "key": "secret:agentmail_api_key",
    "value": "agentmail_live_key_here"
  }
}
```

Read the bound external inbox.

```json
{
  "tool": "read_inbox",
  "args": {
    "address": "scout-01@agentmail.to",
    "limit": 20
  }
}
```

Wait for a matching external email.

```json
{
  "tool": "wait_for_email",
  "args": {
    "address": "scout-01@agentmail.to",
    "filter": {
      "subject_contains": "verification"
    },
    "timeout_ms": 60000
  }
}
```
