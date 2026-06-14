# Gateway Connector Manifest

Each marketplace connector should declare how it runs, what permissions it needs, what credentials it requires, and what policy OpenTrust should apply before calls.

```json
{
  "slug": "github-mcp",
  "name": "GitHub MCP",
  "execution_modes": ["api_oauth", "remote_mcp"],
  "credential_requirements": [
    {
      "type": "oauth",
      "provider": "github",
      "scopes": ["repo", "read:org"]
    }
  ],
  "tools": [
    {
      "slug": "github-mcp.create_pull_request",
      "name": "Create Pull Request",
      "risk": {
        "category": "code",
        "permissions": ["repo.write"],
        "default_decision": "approval_required",
        "approval_required_for": ["repo.write"]
      }
    }
  ],
  "recommended_policy": {
    "allowed_repos": ["owner/repo"],
    "approval_required_for": ["repo.write", "secret.write"]
  }
}
```
