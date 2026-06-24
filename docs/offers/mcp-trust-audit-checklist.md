# OpenTrust MCP Trust Audit Checklist

> For Standard Tier MCP server audits
> Each item marked PASS/FAIL/NA must be documented with evidence.

---

## 1. Identity Verification

- [ ] **1.1** npm/PyPI package name resolves to a real package
  - Evidence: URL, download count, last publish date
- [ ] **1.2** npm/PyPI maintainer email/domain matches GitHub repo owner
  - Check: `npm owner ls <pkg>` or PyPI maintainer list
  - Check: maintainer GitHub profile link from npm/PyPI
- [ ] **1.3** GitHub repository exists and is public
  - Evidence: repo URL, stars, forks, creation date
- [ ] **1.4** Repository description matches package purpose
  - Check for redirect/trojan packages (description mismatch is a red flag)
- [ ] **1.5** npm provenance attestation exists (npm 7+)
  - Run: `npm audit signatures --package <pkg>` — checks `npm:integrity` vs `repository`
  - If missing: flag as risk
- [ ] **1.6** PyPI OIDC trusted publisher configured
  - Check: PyPI project settings → "Trusted publishers" has a GitHub Actions entry
- [ ] **1.7** Maintainer identity history
  - Check: how long has the maintainer been publishing?
  - Check: any previous malicious packages under same identity? (check Socket.dev, npm audit log)

---

## 2. Source & Build Integrity

- [ ] **2.1** Source repository has a CI pipeline
  - Files: `.github/workflows/`, `.gitlab-ci.yml`, or `Jenkinsfile`
- [ ] **2.2** Version tag in Git matches published npm/PyPI version
  - Run: `git tag -l 'v*'` or `git tag -l '<version>'`
  - Check: tag is signed (`git tag -v`)
- [ ] **2.3** Published package tarball matches repo checkout
  - For npm: `npm pack --dry-run` and compare with published tarball
  - Check: `diff -r` the packed contents against `git checkout <tag>`
- [ ] **2.4** Dockerfile (if published as container) is reproducible
  - Check: pinned base image digest, not floating tags (`node:20-slim` vs `node:20-slim@sha256:...`)

---

## 3. Dependency Security

- [ ] **3.1** Direct dependencies are pinned (package.json: `"express": "4.21.0"` not `"^4.21.0"`)
  - Higher pinning = harder to inject via dependency confusion
- [ ] **3.2** All direct dependencies have no known open CVEs
  - Run: `npm audit` or `pip-audit`
  - Run: `snyk test` or Socket.dev check
- [ ] **3.3** Transitive dependency tree audited
  - Run: `npm ls --all` and check deep deps
  - Flag any dep >2 years stale
- [ ] **3.4** No dependency confusion vectors
  - Check: no private package names that match public packages
  - Check: npm-scoped packages (`@scope/pkg`) that could be squatting
- [ ] **3.5** No `postinstall` scripts or build hooks with network access
  - Check: package.json `scripts.postinstall`, `.npmrc`, `preinstall`, `prepare`
  - Malicious packages use postinstall to phone home
- [ ] **3.6** Lockfile present and committed
  - `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, or `requirements.txt` (pinned)
  - Check: lockfile is not stale (out of sync with manifest)

---

## 4. Tool & Permission Analysis

- [ ] **4.1** Server definition identifies all exposed tools/resources
  - Check: server code for `server.tool()`, `server.resource()`, `server.prompt()` calls
- [ ] **4.2** No hidden tools beyond what's documented
  - Compare: code-declared tools vs README/API docs
  - Flag: any undocumented tool/resource
- [ ] **4.3** Each tool's input schema is validated
  - Check: Zod/Pydantic schemas on all tool inputs
  - Flag: tools that accept `any` or untyped JSON
- [ ] **4.4** Tool descriptions don't leak internal information
  - Check: descriptions in code that expose internal endpoints, tokens, or credentials
- [ ] **4.5** Permission boundaries documented
  - Does the server's README declare what data it accesses?
  - Does it use OAuth (with scopes) or API keys?

---

## 5. STDIO Transport Security

- [ ] **5.1** Server does not execute unsanitized user input as shell commands
  - Check: no `exec()`, `spawn()`, `execSync()`, `child_process` with user input
  - Check: no format-string-style shell construction (`\`command ${input}\``)
- [ ] **5.2** If commands are executed (`exec`, `spawn`), input is argument-bounded
  - Check: `spawn('git', ['log', userInput])` vs `exec(\`git log ${userInput}\`)`
  - First is safe (arg array), second is dangerous (string concat)
- [ ] **5.3** Transport mode documented and appropriate
  - `stdio` requires trust in the hosting machine
  - Server declares in README: this server uses `stdio` — risks and mitigations listed
- [ ] **5.4** Server doesn't listen on unexpected network ports
  - Check: any `net.createServer()`, `app.listen()`, or HTTP server beyond the MCP stdio protocol
- [ ] **5.5** Server process isolation documented
  - Check: does README recommend running in Docker or container?
  - Check: does it have sane defaults for `--max-old-space-size`, `ulimit`, etc.?

---

## 6. HTTP/SSE Transport Security (if applicable)

- [ ] **6.1** TLS/HTTPS enforced
  - Check: server rejects plain HTTP
- [ ] **6.2** Authentication required
  - Check: API key, bearer token, or OAuth
- [ ] **6.3** Rate limiting applied
  - Check: rate limit headers or explicit middleware
- [ ] **6.4** No CORS misconfiguration (browser-to-server access)
  - Check: `Access-Control-Allow-Origin` is not `*` if the server manages auth

---

## 7. Code Security Scan

- [ ] **7.1** semgrep scan: command injection patterns
  - Rules: `generic.secrets.security.detecting-command-injection`, `javascript.lang.security.audit.detect-child-process`
- [ ] **7.2** semgrep scan: SSRF
  - Rules: `javascript.express.security.audit.ssrf`
- [ ] **7.3** semgrep scan: path traversal
  - Rules: `javascript.lang.security.audit.path-traversal`
- [ ] **7.4** semgrep scan: hardcoded secrets
  - Rules: `generic.secrets.gitleaks`
- [ ] **7.5** CodeQL scan (GitHub): all default security queries
  - Run from GitHub Actions: `github/codeql-action/analyze@v3`
- [ ] **7.6** Manual review of OAuth token handling
  - Check: tokens stored on disk? Environment variables only?
  - Check: tokens logged anywhere?
- [ ] **7.7** No eval() or dynamic code generation
  - Check: `eval()`, `Function()`, `new Function()`, `setTimeout(string)`

---

## 8. Secrets & Credentials

- [ ] **8.1** No API keys in source code
  - Run: `gitleaks` or `truffleHog` on the repo
- [ ] **8.2** No credentials in commit history
  - Run: `git log --all -p | grep -i 'api.key|secret|token|password'`
- [ ] **8.3** Example `.env` files use placeholder values
  - Check: `.env.example` has `YOUR_API_KEY_HERE` not real values
- [ ] **8.4** No secrets in README code examples
  - Check: README install/usage snippets don't embed hardcoded tokens

---

## 9. Provenance & SLSA Assessment

- [ ] **9.1** SLSA Build Level assessed (0–3)
  - Level 0: no provenance
  - Level 1: build script exists
  - Level 2: provenance attestation (npm provenance, OIDC)
  - Level 3: reproducible + hardened build
- [ ] **9.2** Build script is hermetic
  - Check: `npm ci` not `npm install`, locked deps, no external network in build
- [ ] **9.3** Package published from CI, not developer workstation
  - Check: npm publish runs in GitHub Actions, not `npm publish` from local

---

## 10. Trust Ladder Assignment

- [ ] **10.1** Passport created via OpenTrust schema
  - File: `passport.json` complies with `passport-schema/passport.schema.json`
- [ ] **10.2** Initial trust status assigned
  - `seller_confirmed` (level 3) if all checks 1-9 pass
  - Lower if gaps found
- [ ] **10.3** Dependencies declared
  - Passport lists all MCP-level dependencies (other tools it calls)
- [ ] **10.4** Caller requirements set
  - `min_trust_status: seller_confirmed` (agents must be at level 3+ to call)
- [ ] **10.5** Registry signature applied
  - `security.registry_signature` with Ed25519 key
  - Verify with: `opentrust validate passport.json`

---

## 11. Dispute Readiness

- [ ] **11.1** Dispute contact email listed
  - Passport field: `maintenance.dispute_contact`
- [ ] **11.2** Revocation key published
  - Check: `/.well-known/opentrust-keys.json` has a revocation key
- [ ] **11.3** Operations documented
  - How are CVEs reported after audit? Where do users file trust disputes?
- [ ] **11.4** Publisher contact info in package metadata
  - Check: package.json `author`, `bugs.url`, `repository.url`

---

## Audit Result

| Section | PASS | FAIL | NA | Notes |
|---------|------|------|----|-------|
| 1. Identity | | | | |
| 2. Source | | | | |
| 3. Dependencies | | | | |
| 4. Tools | | | | |
| 5. STDIO | | | | |
| 6. HTTP | | | | |
| 7. Code Scan | | | | |
| 8. Secrets | | | | |
| 9. Provenance | | | | |
| 10. Trust Ladder | | | | |
| 11. Dispute | | | | |

**Overall Verdict:** `seller_confirmed` / `community_reviewed` / `needs_work`
**Passport Status:** signed / unsigned / disputed
**Recommendations:** (list top 3 actionable items for the publisher)

---

## References

- OWASP MCP Top 10: https://owasp.org/www-project-mcp-top-10/
- OWASP MCP Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html
- npm provenance: https://docs.npmjs.com/generating-provenance-statements
- SLSA framework: https://slsa.dev/
- OpenTrust passport schema: https://github.com/Costder/opentrust/tree/main/passport-schema
- OpenTrust CLI: `opentrust inspect`, `opentrust validate`, `opentrust status`
