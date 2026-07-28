# Publishing n8n-nodes-everypage

Internal runbook. Two stages: **npm publish** (makes the node installable on
every self-hosted n8n immediately) and **n8n verification** (gets it into the
nodes panel on n8n Cloud and marks it "verified" for self-hosts).

## 0. Pre-flight

```bash
npm run build   # tsc + icons, must be clean
npm run lint    # zero errors
npm test        # 31 tests green
```

Checklist (verification hard requirements, per docs.n8n.io as of 2026-07):

- [x] Package name starts with `n8n-nodes-` (`n8n-nodes-everypage`)
- [x] `n8n-community-node-package` in `keywords`
- [x] `n8n` attribute in package.json declaring `credentials` + `nodes` dist paths
- [x] **No runtime dependencies** (`dependencies` absent; `n8n-workflow` is a peer dep)
- [x] MIT license
- [x] README documenting operations and credentials
- [ ] Repo pushed to github.com/EveryPageApp/n8n-nodes-everypage (public)

## 1. Publish to npm

```bash
npm login                    # the EveryPage npm account
npm publish --access public  # prepublishOnly runs build + lint automatically
```

Smoke-test on a scratch n8n:

```bash
docker run -it --rm -p 5678:5678 \
  -e N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true \
  docker.n8n.io/n8nio/n8n
# then Settings → Community Nodes → install "n8n-nodes-everypage"
```

Verify: credential test passes against a real `ep_live_` key; Upload returns
the share trio; the Trigger registers a webhook (check the EveryPage
dashboard) on activate and removes it on deactivate; poll mode fires with the
per-stream cursors.

## 2. Submit for n8n verification (Cloud availability)

Submission goes through the **n8n Creator Portal**
(https://creators.n8n.io) — submit the npm package name and wait for review.
n8n reserves the right to decline nodes competing with paid features; a
document-tracking integration does not.

**Important — provenance requirement:** as of **May 1st 2026** n8n
verification requires packages to be published **via GitHub Actions with npm
provenance statements**, using npm "Trusted Publishers" (no long-lived npm
token). The current `n8n-io/n8n-nodes-starter` wires this through
`@n8n/node-cli` (>= 0.23.0) and a `publish.yml` workflow, triggered by
`npm run release` locally. Before submitting:

1. Push this repo to GitHub (public).
2. On npmjs.com → package → Settings → **Trusted Publishers** → add the
   GitHub repo + workflow (`.github/workflows/publish.yml`).
3. Add a publish workflow. Either adopt `@n8n/node-cli`'s release scripts
   (`npx n8n-node --help`; note the CLI needs Node >= 22 locally), or a
   minimal action that runs `npm ci && npm run build && npm test && npm
   publish --provenance --access public` on a version tag.
4. Publish at least one release through that pipeline, then submit in the
   Creator Portal.

Docs to re-check at submission time (they moved recently and may again):
- https://docs.n8n.io/integrations/community-nodes/building-community-nodes.md
- n8n Creator Portal submission flow

## 3. Post-approval

- Marketing page `/integrations/n8n` goes live with the release (per the
  features-ship-with-marketing-pages rule), including the copy-pasteable
  AI-agent workflow JSON from `workflows/`.
- Submit `workflows/ai-report-to-tracked-link.json` and
  `gated-leads-to-crm.json` to n8n's workflow-template library (backlink +
  distribution).
- Announce: n8n community forum, changelog, the AI-agent blog post.

## Versioning

Semver. The node's field names and output keys (`uuid`, `shortId`,
`shareUrl`, `qr_url`, `embed_code`, event shapes) are a cross-integration
contract shared with the Zapier app (and the future Make app) — breaking
them is a major version and needs a matching entry in the shared
matrix doc at `integrations/AUTOMATION-MATRIX.md` (now the canonical
source of truth — update it BEFORE changing any platform).
