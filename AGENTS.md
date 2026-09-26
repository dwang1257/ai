# Agent guide

Instagram Reels MCP server: a stdio MCP server that lets Claude post a local `.mp4` to Instagram as a Reel through a Manus task and the Manus Instagram connector.
Stack: TypeScript on Node 22.9+, `@modelcontextprotocol/server`, zod, Vitest.

## Orientation

- Main code lives in `src/`; tests in `test/`.
- `src/main.ts` wires config, the Manus client, and the stdio transport.
- `src/server.ts` registers the `post_reel` and `get_post_status` tools.
- `src/instagram.ts` validates the video, resolves the connector, builds the publish prompt, and maps Manus task state to `running`, `needs_attention`, `published`, or `failed`.
- `src/manus.ts` is the Manus v2 HTTP client; `src/config.ts` parses env vars.
- `test/e2e.test.ts` builds `dist/`, launches it over stdio with an MCP client, and points it at the local HTTP fake in `test/fake-manus.ts`.
- Manus API reference: https://open.manus.ai/docs/v2 (the Instagram connector's id is not documented, so it is resolved by name via `connector.list`).
- Rules that must not break:
  - Never write to stdout, since it is the MCP channel; use stderr for diagnostics.
  - Never add automatic retries of `task.create` or `post_reel`; a retry can publish the same Reel twice.
  - `post_reel` must stay non-idempotent in its annotations and description, and must not report success before Manus confirms the Reel is live.
  - Keep the caption passed through exactly; do not let the prompt invite Manus to edit it.
- Use `rg` to find code, and read the tests near what you change.

## Commands

Run from the repo root with npm and Node 22.9+.

- `npm install` - install dependencies
- `npm run build` - compile to `dist/`
- `npm start` - run the built server on stdio (loads `.env` if present)
- `npm test` - run tests
- `npm run lint && npm run typecheck` - lint and typecheck
- `npm run check` - format check, lint, typecheck, and tests together

## Done means

- Bug fixes: reproduce first, verify the same flow after.
- Add or update a test for changed behavior where practical.
- `npm run check` passes.
- Report what changed and what was actually verified, and say plainly that live Manus publishing was not exercised unless it was.

## Gotchas

- Tests must use the local fake Manus via `MANUS_BASE_URL`.
  Only call live Manus when the user explicitly asks, since each task is billed and can publish a real Reel.
- Claude launches `dist/main.js`, so run `npm run build` after changing `src/` before testing through Claude.
- `npm start` and the checked-in `.mcp.json` load `.env` only if present; `npm test` never reads it.
- Empty env values are treated as unset, so blank entries in `.env.example` fall back to defaults.
- New env vars go in the zod schema in `src/config.ts`, `.env.example`, and the README.
- Manus deletes uploaded files 48 hours after upload and rejects files over 512 MB.
