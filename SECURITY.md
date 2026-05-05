# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in react-amnesia, please report it
responsibly through
[GitHub Security Advisories](https://github.com/thirtytwobits/react-amnesia/security/advisories/new).
This ensures the report is handled privately and you receive credit for the
discovery.

**Please do not open a public issue for security vulnerabilities.**

### What to include

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof of concept
- The version(s) affected

### What to expect

We will acknowledge receipt of your report and provide an initial assessment as
soon as practical. The project does not currently guarantee a formal SLA for
response times or fixes, but we will make a best-effort attempt to address
confirmed vulnerabilities promptly.

## Scope

react-amnesia is a client-side React library that maintains an in-memory
undo/redo command history. It does not make network requests or persist data
on its own. Security concerns most likely to apply include:

- Memory exhaustion through unbounded history growth
- Privilege escalation through replayed commands
- Information disclosure through history snapshots

## Supported Versions

Security fixes are provided for the current `0.1.x` release line. Earlier
release lines are not supported.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1.0 | No        |
