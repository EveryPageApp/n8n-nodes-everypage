# n8n-nodes-everypage

An [n8n](https://n8n.io) community node for [EveryPage](https://everypage.co) —
turn any PDF in your workflow into a **tracked share link** with page-by-page
reader analytics (GDPR-friendly: cookieless, no IPs stored), and trigger
workflows the moment documents are read, downloaded, or unlock a lead gate.

The document-sharing node for people who read the source.

## Install

**Self-hosted n8n** (Settings → Community Nodes → Install):

```
n8n-nodes-everypage
```

Or manually on the host:

```bash
cd ~/.n8n/nodes
npm install n8n-nodes-everypage
```

**n8n Cloud:** available once the package passes n8n's community-node
verification (submission in progress) — verified nodes install straight from
the nodes panel.

## Credentials

Create an API key at [everypage.co/account](https://everypage.co/account)
under **API keys** (it starts with `ep_live_`) and paste it into a new
**EveryPage API** credential. The key is sent as a bearer token and validated
against `GET /api/v1/user`. The **Base URL** field only needs changing when
testing against a staging or self-hosted EveryPage deployment.

## Nodes

### EveryPage

| Resource | Operation | What it does |
| --- | --- | --- |
| File | **Upload** | Binary PDF in → tracked link out, with the full plan-tiered settings surface (viewer mode, passcode, expiry / never-expire, email gate + domain allowlist, vanity slug, watermark, view limit, page range, protection toggles, notifications) |
| File | **Import From URL** | Fetches a PDF from a URL (without your EveryPage credentials) and uploads it |
| File | **Get** / **Get Many** | Fetch one document or list them all (accepts UUID or short ID) |
| File | **Update Settings** | Change any subset of settings in place — only the options you add are sent |
| File | **Delete** | Trash by default (restorable until the purge date, receipt included) or purge permanently |
| File | **Replace Content** (Pro) | Swap the PDF behind a link — UUID, short ID, slug, QR, settings, and readership history all survive |
| File | **Get QR Code** | The tracked QR code as binary PNG (`everypage-{shortId}-qr.png`) for print/merge workflows |
| File | **Get Readership** | The plan-shaped analytics report (summary, funnel, sessions, contacts…) as JSON |
| Link Variant (Pro) | **Create / Get Many / Update / Revoke / Delete** | Per-recipient tracked links; delete supports GDPR label redaction. NOTE: variant `overrides` REPLACES the whole overrides object — never merges |
| Event | **Get Many** | Bulk pulls from the events feed (`view` / `download` / `gate`) with a `since` cursor for incremental warehouse loads |

Every file-producing operation outputs the share trio alongside `uuid` and
`shortId` — the same field names as the EveryPage Zapier app (the shared
contract lives in `integrations/AUTOMATION-MATRIX.md`):

- `shareUrl` — the link to send (short-ID based)
- `qr_url` — public QR PNG endpoint (no auth needed downstream)
- `embed_code` — an iframe pointing at the durable `/embed/` path (never the
  renameable vanity slug)

### EveryPage Trigger

**Webhook mode (instant, default):** on activation the node registers a
webhook subscription (`POST /api/v1/webhooks`) for the selected events and
removes it on deactivation. Every delivery is verified — HMAC-SHA256
signature (`X-Everypage-Signature`), 5-minute replay tolerance, constant-time
comparison — and unverified deliveries are rejected with a 401.

Events: `file.viewed`, `file.downloaded`, `gate.completed` (Pro at event
time), `note.created`, `receipt.confirmed`, `file.burned`,
`content.replaced`, `invite.viewed`, `proofing.updated`. Optionally scope the
subscription to a single document.

**Poll mode (fallback):** for self-hosted n8n instances that cannot receive
inbound webhooks. Walks the events feed on the schedule you set under Poll
Times, with independent per-stream cursors (view / download / gate) and
`type:id`-namespaced event IDs, so nothing fires twice and nothing is missed.
Poll mode covers the three feed-backed streams only.

### Event feed cursor notes (Event → Get Many)

- `since = 0` returns the newest events (descending), capped at a window
  of 100.
- `since > 0` walks forward (ascending) from that event ID — pass the highest
  ID you've already processed. With **Return All** the node pages through in
  chunks of 100 until the stream is exhausted.
- Cursors are per-stream; a `view` cursor means nothing to the `gate` stream.

## Use as an AI Agent tool

The EveryPage node is marked `usableAsTool`, so n8n AI Agent nodes can call
it directly ("upload this report and give me the tracked link", "who read the
Q3 proposal?"). On self-hosted n8n set:

```bash
N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
```

See `workflows/agent-with-everypage-tool.json` for a working chat agent.

## Example workflows

Importable JSON in [`workflows/`](./workflows):

- **`ai-report-to-tracked-link.json`** — an AI agent writes the weekly
  report, a dependency-free Code node renders it to PDF, EveryPage returns a
  tracked link, Slack gets the link. You find out whether anyone read what
  the agent produced.
- **`gated-leads-to-crm.json`** — instant `gate.completed` webhook →
  captured lead fields shaped and forwarded to sales/CRM.
- **`agent-with-everypage-tool.json`** — a chat agent with EveryPage attached
  as tools (list documents + readership analytics via `$fromAI`).

## Plan gating

Fields above your plan's tier are labelled in their description and link
[pricing](https://everypage.co/pricing). If a run trips a server-side tier
check anyway, the node maps the 403 to an error that names the plan and the
upgrade page. Size caps: Free 20 MiB, Basic 200 MiB, Pro 2 GiB. Rate limit:
120 requests/minute per key (the node surfaces a clear 429 message — enable
"Retry On Fail" for unattended workflows).

## Development

```bash
npm install
npm run build     # tsc + gulp icon/codex copy → dist/
npm run lint      # eslint-plugin-n8n-nodes-base ruleset
npm test          # node --test (signature verification + payload mapping)
```

Node.js >= 20.15. No runtime dependencies (a verified-community-node
requirement) — multipart bodies are hand-assembled, HMAC via `node:crypto`.

## License

[MIT](./LICENSE)
