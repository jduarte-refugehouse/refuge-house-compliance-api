# Security Backlog

## Pending items

- [ ] Add CAPTCHA challenge to public console chat flow (`/console/chat/*`) to reduce automated abuse.
  - Scope only public reviewer/auditor console routes.
  - Do **not** apply CAPTCHA to authenticated `/api/*` routes used by Pulse.
  - Candidate providers: Cloudflare Turnstile or Google reCAPTCHA.
  - Keep current route-scoped rate limiting in place as a first-line control.
