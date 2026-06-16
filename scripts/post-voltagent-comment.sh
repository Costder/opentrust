#!/bin/bash
BODY='Hey @uchibeke -- OpenTrust implements exactly what this issue describes.\n\nWe built an open standard for MCP tool passports: signed JSON that encodes permissions, cost constraints, and trust level so agents can run deterministic pre-call verification before a tool fires.\n\nWe already wrote a VoltAgent passport + integration spec: https://costder.github.io/opentrust/voltagent.html\n\nHappy to help wire this into VoltAgent tool-call hook layer. The integration path is in the passport file.'
if command -v gh >/dev/null 2>&1; then gh issue comment VoltAgent/voltagent#1166 --body "$BODY" && echo done && exit 0; fi
echo "Manual: github.com/VoltAgent/voltagent/issues/1166"
echo "$BODY"