# Security Policy

## Scope

This plugin reads plan-usage data from billing APIs and renders it in the
terminal. It never writes credentials anywhere.

## Credential handling

- Credentials are resolved at runtime from OpenCode's own credential sources
  (for OpenCode Go: the key already stored in OpenCode's auth store).
- Credentials are held **in memory only**, for the duration of one request.
- This plugin does not log, print, persist or transmit credentials. There is no
  credential cache file, and no configuration key holds a secret.
- Provider adapters (`src/providers/`) must not add logging, analytics or
  third-party requests. The only network calls are to the provider's own usage
  endpoint.

If you find a code path that writes a credential to disk or a log, that is a
security bug — please report it privately rather than in a public issue.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/dimalo/opencode-v2-usage-gauge/security/advisories/new)
on this repository. Include the affected version, the provider adapter involved,
and a reproduction. Expect an acknowledgement within a few days and a fix or
mitigation plan shortly after.

Please do not disclose vulnerabilities in a public issue, gist, Discord
message or social post before a fix is available.
