# Agent guide

Instagram Reels MCP server: a stdio MCP server that lets Claude post a local `.mp4` to Instagram as a Reel through a Manus task and the Manus Instagram connector.
It also researches trending short-form formats through a Manus browser task and downloads the reference clips locally with yt-dlp into a swipe-file folder.
Stack: TypeScript on Node 22.9+, `@modelcontextprotocol/server`, zod, and the yt-dlp and ffmpeg binaries for research downloads.

## Orientation

- All code lives in `src/`; there is no test suite.
- `src/main.ts` wires config, the Manus client, the publisher, the trend researcher, and the stdio transport.
- `src/server.ts` registers the `post_reel`, `get_post_status`, `research_trends`, and `get_research_status` tools.
- `src/instagram.ts` validates the video, resolves the connector, builds the publish prompt, and maps Manus task state to `running`, `needs_attention`, `published`, or `failed`.
- `src/trends.ts` builds the Manus trend discovery prompt and maps Manus task state to a trend result.
- `src/research.ts` orchestrates the swipe file: starts discovery, tracks downloads, and writes `request.json`, `README.md`, and `manifest.json` into the research folder.
- `src/ytdlp.ts` downloads reference clips with yt-dlp.
- `src/manus.ts` is the Manus v2 HTTP client; `src/config.ts` parses env vars.
- Manus API reference: https://open.manus.ai/docs/v2 (the Instagram connector's id is not documented, so it is resolved by name via `connector.list`).
- Rules that must not break:
  - Never write to stdout, since it is the MCP channel; use stderr for diagnostics.
  - Never add automatic retries of `task.create` or `post_reel`; a retry can publish the same Reel twice.
  - `post_reel` must stay non-idempotent in its annotations and description, and must not report success before Manus confirms the Reel is live.
  - Keep the caption passed through exactly; do not let the prompt invite Manus to edit it.
  - Never auto-retry `research_trends` either; each call is a new billed Manus task.
  - The discovery prompt must keep its safety filter: adult creators only and no explicit content.
  - Reference clips stay local for format research; never add code that edits or reposts them.
- Use `rg` to find code.

## Commands

Run from the repo root with npm and Node 22.9+.

- `npm install` - install dependencies
- `npm run build` - compile to `dist/`
- `npm start` - run the built server on stdio (loads `.env` if present)
- `npm run lint && npm run typecheck` - lint and typecheck
- `npm run check` - format check, lint, and typecheck together

## Done means

- Bug fixes: reproduce first, verify the same flow after.
- `npm run check` passes.
- Report what changed and what was actually verified, and say plainly that live Manus publishing was not exercised unless it was.

## Gotchas

- Only call `post_reel` against live Manus when the user explicitly asks, since each task is billed and publishes a real Reel.
  Read-only calls such as `user.me` and `connector.list` are free.
- Claude launches `dist/main.js`, so run `npm run build` after changing `src/` before testing through Claude.
- `npm start` and the checked-in `.mcp.json` load `.env` only if present.
- Empty env values are treated as unset, so blank entries in `.env.example` fall back to defaults.
- New env vars go in the zod schema in `src/config.ts`, `.env.example`, and the README.
- Manus deletes uploaded files 48 hours after upload and rejects files over 512 MB.
- Research downloads need `yt-dlp` and `ffmpeg` on `PATH` (`brew install yt-dlp ffmpeg`); `YTDLP_PATH` overrides the yt-dlp binary.
- Only call `research_trends` against live Manus when the user explicitly asks, since each task is billed.
