# AI Brief Manager

## Executive Summary
- Purpose: Manage SEO/marketing content briefs inside Google Sheets with AI-assisted generation and a streamlined editor sidebar.
- Connectivity: The repo no longer includes any proxy. Configure Apps Script to call a publicly reachable, OpenAI-compatible API directly via Script Properties.

## Repository Layout
- `main.gs` — Apps Script backend: sheet CRUD, dialog wiring, AI request, model preference persistence.
- `base.html` — Sidebar UI: RTL layout, form fields, AI actions, and browser-side behavior.
- `README.md` — This document.

## How It Works
- A custom menu “Content Brief” appears when the sheet opens.
- The sidebar lets editors create/edit a structured brief (title, SEO title, meta description, outline, FAQ, keywords, etc.).
- On demand, Apps Script calls your configured AI endpoint and inserts the returned text into the active field.
- Data persists in a sheet named `BriefData` with fixed headers; the code ensures headers exist and stay aligned.

## Setup in Google Apps Script
1. Open your target Google Sheet, then go to: Extensions → Apps Script.
2. Add two files:
   - `main.gs` — paste the content from this repo.
   - `sidebar` (HTML) — paste the content of `base.html`.
3. Save. Reload the spreadsheet to see the “Content Brief” menu.

## Configuration (Script Properties)
Set in: Extensions → Apps Script → Project Settings → Script Properties
- `API_URL` — Public, OpenAI-compatible endpoint, e.g.:
  - OpenAI: `https://api.openai.com/v1/chat/completions`
  - Enterprise gateway: your corporate API gateway or reverse proxy URL
- `API_KEY` — Bearer token required by the AI endpoint.
- Optional `DEFAULT_AI_MODEL` — Default model (e.g., `gpt-4o-mini`, `llama3.1`).

Notes
- The code falls back to a built-in `DEFAULT_MODEL` if `DEFAULT_AI_MODEL` is not set.
- The endpoint must be reachable by Google’s infrastructure (public DNS + HTTPS).

## Usage
- Select a cell and choose Content Brief → Create/Edit Brief.
- Enter a topic/title. Click the pencil icon to switch to edit mode for AI actions.
- Choose a model, then click the AI button next to a field to generate content.
- Click Save to persist to `BriefData`. Use the copy modal to export as plain text.

## Operational Guidance (Admins)
- Identity and Access: Protect the upstream with bearer tokens or an SSO-backed gateway. Rotate secrets regularly.
- Network/Egress: Since there is no built-in proxy, publish private backends through approved ingress (API gateway, Cloudflare, or Nginx+TLS) and use that URL as `API_URL`.
- Observability: Monitor your upstream API for rate limits, latency, and errors. Logging should live in your gateway, not in this repo.

## Troubleshooting
- 401 Unauthorized: Verify `API_KEY` and token scopes.
- DNS/Timeout: Ensure `API_URL` is public and reachable from Google; local-only hosts will fail.
- Model name mismatch: Add the model value to the dropdown in `base.html` if needed.

## Security
- Do not hardcode secrets in code; always use Script Properties.
- Enforce HTTPS-only endpoints and least-privilege tokens.

