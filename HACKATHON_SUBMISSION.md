# Hackathon Submission -- Updated June 22

**Prize:** $10K cash + NVIDIA DGX Spark + $5K Stripe credits
**Deadline:** June 30, 2026
**How to submit:** tweet @NousResearch + Nous Research Discord #submissions

---

## Tweet (copy-paste, attach video file or https://files.catbox.moe/0sdtmm.mp4)

Built a full agent commerce stack on @stripe + @NousResearch Hermes:

- MCP tool trust passports (8 trust levels)
- Escrow payments between agents
- 5% marketplace fee + $2 job board listing
- Cloud relay for remote agent webhooks
- HBF physical execution layer

Agents that earn, spend, run ops -- for real.
#HermesHackathon @NousResearch @stripe

---

## Discord #submissions message

OpenTrust -- agent commerce stack: trust passports + Stripe escrow + 5% fee structure + cloud relay.
Agents that earn, spend, and run operations. Demo: https://files.catbox.moe/0sdtmm.mp4
GitHub: https://github.com/Costder/opentrust

---

## Why the new features matter

Hackathon theme: 'agents that earn, spend, and run real operations.'

- **Fee structure (5c7458f):** 5% marketplace settlement + $2 flat job listing + 4% job settlement fee.
  Collected in USDC via Stripe rail. 90-day launch waiver built in. Real platform economics.
- **Cloud relay (188be7a):** Remote agents register a webhook, receive bus messages. Scales to any agent.
- **Hermes adapter (aa5b77c):** Auto-installs. Judges can run against their own agent in minutes.

The old demo video predates these features. Two options:
1. Submit with existing video + this tweet text (text describes new features, video is proof of concept)
2. Quick screen record: run the API, hit /api/v1/fees/calculate, show 5% fee math. 60 seconds. Stronger.

---

## Exact steps

1. Open Twitter/X
2. Paste tweet text above
3. Attach video (drag opentrust-demo/opentrust-demo-final.mp4 OR paste catbox URL in tweet)
4. Post
5. Go to discord.gg/nous -> #submissions -> paste Discord message + tweet URL
6. Done. You are entered.
