# Proof By Every - Related Project Review

Researched: 2026-05-27  
Related OMR ticket: `markdown-reader-msv` - Web-based markdown viewer  
Primary sources:

- Every launch post: https://every.to/on-every/introducing-proof
- Hosted product: https://www.proofeditor.ai/
- Open-source repo: https://github.com/EveryInc/proof-sdk
- Agent contract: https://github.com/EveryInc/proof-sdk/blob/main/AGENT_CONTRACT.md
- Agent docs: https://github.com/EveryInc/proof-sdk/blob/main/docs/agent-docs.md
- SDK extraction ADR: https://github.com/EveryInc/proof-sdk/blob/main/docs/adr/2026-03-proof-sdk-public-core.md

## Summary

Proof is Every's online collaborative document editor for humans and agents. Dan Shipper's launch post frames it as a replacement for agent-written Markdown files that are stuck on one laptop: a shared document surface where humans and agents can edit, comment, suggest changes, and see provenance.

The important contrast for OpenMarkdownReader is that Proof is not mainly a prettier Markdown viewer. It is a web-first collaboration substrate:

- shared hosted documents with links;
- live multi-user editing;
- comments, suggestions, and rewrite operations;
- per-character or per-span provenance for human vs AI authorship;
- agent HTTP APIs for reading state, mutating documents, posting comments, creating suggestions, and reporting presence;
- a self-hostable/open-source TypeScript repo under MIT.

## What Proof Does Differently

| Area | Proof | OpenMarkdownReader today |
| --- | --- | --- |
| Product center | Online collaborative docs for plans, PRDs, research briefs, memos, proposals, etc. | Local Mac Markdown reader/editor for files and folders. |
| Persistence model | Server-backed documents addressed by slugs/share URLs, backed by SQLite in the SDK repo. | Local files, folders, tabs, and app state on the Mac. |
| Collaboration | Realtime collaboration server with Yjs/Hocuspocus and browser sessions. | Single-user local editing; collaboration is parked as far-future work. |
| Agent interface | HTTP contract: create docs, read state/snapshots, edit blocks, add comments/suggestions, post presence, poll events. | Unix socket contract via `omr --cmd`: get state, open/save/edit/search, watch events. |
| Provenance | Visible authored marks; launch copy uses green for human and purple for AI. | No authorship/provenance model yet. |
| Review workflow | Comments, suggestions, accept/reject, rewrite operations. | Planned comments and track-changes tickets, but not implemented. |
| Online sharing | Core flow: create/share/collaborate in the browser. | Existing in-app share posts Markdown to `globalbr.ai`; requirement doc plans a read-only Cloudflare publish flow. |
| Local-first posture | Web-first; local/dev server supported. Agent docs explicitly say desktop-native workflows are outside the public SDK scope. | Local-first/offline-first is a core requirement; network features must be opt-in. |

## Source/Architecture Notes

Proof SDK repo shape:

- `server/`: Express/WS server, share routes, agent routes, collab, mutation coordination, auth policy, rate limiting, telemetry, snapshots.
- `src/editor/`: Milkdown/ProseMirror editor runtime and plugins for comments, suggestions, proof marks, agent cursor, collab cursors, mermaid, task checkboxes, find highlights, etc.
- `src/bridge/`: bridge routes/client/executor for agent-facing operations.
- `src/agent/`: hosted-product agent orchestration/proposal machinery.
- `packages/`: future SDK extraction boundary: `@proof/core`, `@proof/editor`, `@proof/server`, `@proof/sqlite`, `@proof/agent-bridge`.
- `apps/proof-example/`: small example target.

Main dependencies:

- Editor/collab: `@milkdown/*`, `yjs`, `y-prosemirror`, `y-websocket`, `@hocuspocus/server`, `@hocuspocus/provider`.
- Server/storage: `express`, `ws`, `better-sqlite3`, `zod`.
- Markdown/rendering support: `remark-gfm`, `remark-frontmatter`, `prismjs`, `beautiful-mermaid`.

Agent surface:

- Create: `POST /documents` with JSON or raw `text/markdown`.
- Read: `GET /documents/:slug/state` and `GET /documents/:slug/snapshot`.
- Mutate: `POST /documents/:slug/edit`, `POST /documents/:slug/edit/v2`, and `POST /documents/:slug/ops`.
- Review ops include `comment.add`, `comment.reply`, `comment.resolve`, `suggestion.add`, `suggestion.accept`, `suggestion.reject`, and `rewrite.apply`.
- Presence/eventing: `POST /documents/:slug/presence`, `GET /documents/:slug/events/pending`, `POST /documents/:slug/events/ack`.
- Safety mechanisms include bearer/share tokens, owner secrets, idempotency keys, optimistic locking via revision/base timestamps, and stale-base conflict responses.

## Implications For An Online OMR

The existing OMR plan in `REQUIREMENTS.md` is "one-click publish": upload Markdown, return a public read-only rendered page. That is still the right smallest online step because it preserves OMR's local-first identity and is much cheaper than multiplayer editing.

Proof suggests a useful staged roadmap:

1. Read-only publish first.
   - Keep the current planned Cloudflare Worker/KV shape or equivalent.
   - Add CLI parity: `omr --cmd publish`, `get-publish-url`, `unpublish`.
   - Avoid accounts, live editing, comments, or provenance in v1.

2. Add agent-readable publish metadata.
   - Published pages should expose both HTML and raw Markdown, probably `/:id/raw` and `Accept: text/markdown`.
   - Return structured JSON from the publish endpoint with `_links`, similar to Proof's create response.
   - This gives agents a stable online document target without requiring collaborative editing.

3. Add update/revoke before multiplayer.
   - A secret edit token for replacing a published doc is more valuable to OMR than realtime collaboration.
   - Deletion/revocation should come earlier than Proof-style open collaboration because OMR currently warns that links are permanent.

4. Add comments/suggestions as document sidecars.
   - If OMR wants web review without full collab, store comments/suggestions as sidecar JSON keyed by document ID and text anchors.
   - Mirror the local CLI commands planned in `REQUIREMENTS.md`: `add-comment`, `list-comments`, `delete-comment`, `export-comments`.

5. Treat realtime collaboration as a separate product decision.
   - Proof's stack implies a sizable rewrite: ProseMirror/Milkdown editor state, Yjs document model, server persistence, auth/share tokens, mutation conflict handling, and a browser app.
   - That is closer to "build Proof/HackMD for OMR" than "add online mode".

## Strategic Takeaway

Proof is strongest where OMR is intentionally weak today: cloud sharing, realtime collaboration, visible AI/human authorship, and agent APIs over HTTP. OMR is strongest where Proof is deliberately not focused: local files, native Mac workflows, offline use, folder/project browsing, and Unix-socket control of a desktop app.

The best contrast is not "copy Proof." It is:

- OMR should own local-first Markdown work, including project/folder reading and agent-controlled desktop workflows.
- OMR's online version should start as publishing plus agent-readable raw/JSON endpoints.
- If collaboration becomes important, borrow Proof's design constraints: stable block IDs, idempotency keys, optimistic locking, explicit agent identity, event polling, and comments/suggestions as first-class operations.

## Open Questions

- Should OMR's online publish service be anonymous like Proof's no-login flow, or tied to Jacob/noos identity from the start?
- Should the web version be read-only forever, or support comment-only review links before edit links?
- Should provenance mean "human vs AI" inside OMR, or more generally "which agent/tool/session wrote this span"?
- Should OMR eventually embed Proof SDK concepts, or only adopt the HTTP contract patterns while preserving the local EasyMDE/marked stack?
