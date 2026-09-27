# HJEN Platform — API-First Architecture Blueprint

**Status:** Draft v1 — the founding design decision for milestone M5 (commercial backend).
**Rule this document exists to enforce:** one brain, many faces. Every client — desktop app, web app, future mobile app, MCP agents — speaks to the same API. No client ever gets private shortcuts into the backend.

## 1. The shape

```
 Desktop (Electron)  ─┐
 Web app             ─┤                ┌─ Providers (OpenAI, Google,
 Mobile (future)     ─┼──►  HJEN API ──┤   BytePlus, Kling, MiniMax…)
 MCP / agents        ─┘    (one brain) ├─ Storage + DB (GCP Dammam)
                                       └─ Billing (Lago) + Payments (Moyasar)
```

If a capability is not exposed through the API, it does not exist commercially.

## 2. Non-negotiable principles

1. **API-first.** Endpoints are designed before screens. A new client platform must require zero backend changes.
2. **Keys live server-side only.** No provider API key ever ships inside a client binary or reaches a browser. (Already enforced by this server; stays law.)
3. **Direct vendor APIs, no aggregators.** LiteLLM is a self-hosted gateway we run — not a third-party middleman.
4. **Margin floor is code, not policy.** All generation pricing flows through `src/pricing.js` (single source of truth, ≥60% floor, unknown models rejected).
5. **Credits are a liability, not revenue** — accounting treatment per the CFO playbook; the ledger must make this distinction queryable.
6. **Data residency by design.** Customer content and accounts: GCP Dammam (me-central2 via CNTXT). Diagnostics: Sentry EU, scrubbed. Product analytics: PostHog EU, consented + IP-anonymized.
7. **Telemetry is sanitized.** No emails, no IPs, no user content in error reports. Ever.
8. **Automate everything.** Status page flips via monitors, invoices via webhooks, reports via the daily agent. Humans decide; machines operate.

## 3. Components (decided in the Platform Operations Guide)

| Concern | Component | Notes |
|---|---|---|
| Identity & orgs | Clerk | JWT verified at the API edge; org = company seat model. WorkOS added when first SSO deal lands |
| API gateway & per-key metering | LiteLLM (self-hosted) | Virtual keys per account; token/spend counters per key |
| Credits, invoicing | Lago | HJEN Credits prepaid model; margin floor enforced upstream by pricing.js |
| Payments (KSA + global) | Moyasar | mada, Apple Pay, STC Pay; ZATCA e-invoicing via the accounting office's system |
| Behavior analytics | PostHog (EU) | Active users, session time, feature funnels, heatmaps, country/segment splits |
| Error tracking | Sentry (EU) | Scrubbed; repos linked for stack traces at build time |
| Uptime + status page | Better Stack | Monitors drive status.hjen.ai automatically — no manual updates by design |

## 4. API surface (sketch — to be specified per endpoint before build)

```
POST /v1/auth/…            — session exchange (Clerk-issued JWT in, HJEN session out)
GET  /v1/me                — account, org, plan, credit balance
POST /v1/makes             — create a generation job (image/video/text task named by task, not model)
GET  /v1/makes/:id         — job status + outputs
GET  /v1/credits/ledger    — prepaid balance movements (liability view)
POST /v1/credits/checkout  — top-up via Moyasar; webhook settles the ledger
GET  /v1/usage             — per-key token/spend rollups (from LiteLLM)
POST /webhooks/moyasar     — payment settlement
POST /webhooks/lago        — invoice lifecycle
```

Conventions: versioned path (`/v1`), JSON only, idempotency keys on all POSTs that move money or spawn jobs, task-named model routing via the models registry (clients name a task; the registry picks the model).

## 5. What this replaces

The current gated demo server (invite gate + quotas) is the seed: its generation core and quota logic port into this design; magic-link invitees become Clerk accounts; its `/admin` measurement grows into the unified measurement layer (PostHog + LiteLLM + Lago in one view).

## 6. Non-goals (v1)

- No self-serve org SSO (WorkOS trigger: first enterprise contract demanding it).
- No multi-region active-active; Dammam primary, backups per the 3-2-1 policy.
- No client-side provider calls of any kind, including "temporary" ones.
