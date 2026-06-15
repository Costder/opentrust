#!/bin/bash
# Post comment on VoltAgent/voltagent#1166 (the 'local passport' authorization issue)
# Usage: bash scripts/post-voltagent-comment.sh
# Requires: gh CLI authenticated (run 'gh auth login' once if needed)

BODY="Hey @uchibeke -- OpenTrust implements exactly what this issue describes.

We built an open standard for MCP tool passports: signed JSON that encodes permissions, cost constraints, and trust level so agents can run deterministic pre-call verification before a tool fires.

We already wrote a VoltAgent passport + integration spec: https://costder.github.io/opentrust/voltagent.html

Happy to help wire this into VoltAgent's tool-call hook layer. The integration path is in the passport file."

gh issue comment VoltAgent/voltagent#1166 --body "$BODY"
echo 'Done -- comment posted to VoltAgent/voltagent#1166'
