# Contributing

Use Node.js 24 LTS (Node 20.16+ is accepted for the initial local build). Install with `npm ci`.

Run `npm run check`, `npm test`, and `npm run build` before proposing a change. `npm run format` formats source files. Tests use isolated temporary databases and mocked Facebook/AI responses; no credentials or external API spend are required.

Keep the production app on a single HTTP(S) listener. Run `npm run build` after frontend edits; `npm run dev` watches the backend and serves the built frontend on the same port. Never commit real tokens, `.env`, the `data` directory, customer comments, or generated backups.

Preserve server-side role checks, CSRF/Origin/Host protection, parameterized queries and immutable analysis snapshots. AI output is untrusted data: validate the allowlisted filter schema, never execute generated SQL or code. Do not convert a missing author ID into a guessed identity.

Browser parser changes must include fixtures and document the Facebook layout/language actually tested. Helper/mock tests are not evidence of live capture correctness. Keep activeTab-only page access, explicit region preview, loopback-only authenticated ingestion, bounded queues and honest observed-time/identity labels. Never extract cookies or private API tokens, use hidden page state, or circumvent platform controls. Test missing IDs, DOM replacement, duplicate delivery, expired/revoked pairing and network interruption. Do not remove user data during migrations.

UI language is Vietnamese. Use semantic buttons and labels, keyboard access and responsive layouts. Clearly distinguish demo data, provisional results, missing data and actual live connections.
