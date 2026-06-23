# Hackathon Submission -- Updated June 22

**Prize:** $10K cash + NVIDIA DGX Spark + $5K Stripe credits
**Deadline:** June 30, 2026
**How to submit:** tweet @NousResearch + Nous Research Discord #submissions

---

## Tweet (copy-paste, attach video or https://files.catbox.moe/0sdtmm.mp4)

Built a full agent commerce platform on @stripe + @NousResearch Hermes:

- MCP tool trust passports (8 trust levels + community reviews)
- Escrow payments + 5% marketplace fee structure
- Discovery: featured listings, collections, tag filtering
- Analytics dashboard for tool maintainers
- Cloud relay + HBF physical execution layer

Agents that earn, spend, run ops -- for real.
#HermesHackathon @NousResearch @stripe

---

## Discord #submissions message

OpenTrust -- agent commerce platform: trust passports + Stripe escrow + marketplace fees + discovery/analytics.
Agents that earn, spend, and run operations at scale.
Demo: https://files.catbox.moe/0sdtmm.mp4
GitHub: https://github.com/Costder/opentrust

---

## Features built (last 3 days, all relevant to hackathon theme)

**Agents that EARN:**
- 5% marketplace settlement fee on agent-to-agent transactions (fee_calculator.py)
- $2 flat + 4% job board listing fees collected via Stripe
- Featured listings route with admin endpoints (monetization surface)
- Analytics route for listing performance (tool maintainers can optimize revenue)

**Agents that SPEND:**
- Stripe escrow: agents pay in, platform holds, releases on delivery
- USDC settlement track (Coinbase Commerce)
- 90-day fee waiver for early adopters (growth lever)

**Agents that RUN OPERATIONS:**
- Cloud relay: remote agents register webhooks, receive bus messages at scale
- HBF physical execution layer with Hermes adapter auto-install
- Discovery system: collections, tag filtering, UsedByCounter, FeaturedBadge
- Reviews system: community trust signals on tools

---

## Demo options

**Option A (fastest, 5 min):** Use old video (catbox.moe) + this tweet. The text describes the new features. Submit today.

**Option B (stronger, ~30 min):** Quick screen record showing:
1. New marketplace UI (discovery/collections/analytics)
2. Fee calculator: POST /api/v1/fees/calculate, show 5% math
3. Cloud relay: register a webhook, see message delivery
Then tweet new video.

---

## Exact steps

1. Open Twitter/X
2. Paste tweet text above
3. Attach video
4. Post
5. Go to discord.gg/nous -> #submissions -> paste Discord message + tweet URL
6. Done.
