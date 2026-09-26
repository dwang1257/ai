# Instagram Reels MCP server

A small MCP stdio server that lets Claude post a local `.mp4` to Instagram as a Reel.
It uploads the video to Manus and asks a Manus task to publish it through the Manus Instagram connector.

> **Not yet verified live.**
> A real end-to-end publish through Manus has not been tested yet.
> Try it on a test account first.

## Requirements

- Node.js 22.9 or newer.
- A Manus account and an API key.
- The Instagram connector installed in the Manus web app under Settings > Connectors > Add Connector > Instagram.
  It is an early-beta connector and needs an Instagram professional (creator or business) account.
  It is not the "Instagram Creator Marketplace" connector.

## Setup

```sh
npm install
npm run build
```

This produces `dist/main.js`, which is what Claude launches.

## Register with Claude Code

Add it for your user, with an absolute path to this repo:

```sh
claude mcp add instagram --scope user -e MANUS_API_KEY=your-manus-api-key -- node /absolute/path/to/repo/dist/main.js
```

Or use the checked-in `.mcp.json` when running `claude` from the repo root.
It runs `node --env-file-if-exists=.env dist/main.js`, so put your key in `.env` (`cp .env.example .env`).
Claude Code asks you to approve project servers the first time.
If the server fails to start this way, use the user-scope command above, which does not depend on relative paths.

## Register with Claude Desktop

Add this to `claude_desktop_config.json` (on macOS, `~/Library/Application Support/Claude/claude_desktop_config.json`) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "instagram": {
      "command": "node",
      "args": ["/absolute/path/to/repo/dist/main.js"],
      "env": {
        "MANUS_API_KEY": "your-manus-api-key"
      }
    }
  }
}
```

If Claude Desktop cannot find `node` (for example with nvm), set `command` to the absolute path from `which node`.

## Tools

### `post_reel`

Uploads the video and starts a Manus task that publishes it.
It returns as soon as the task is created; publishing takes a few minutes.

| Input       | Description                                                              |
| ----------- | ------------------------------------------------------------------------ |
| `videoPath` | Absolute path to an `.mp4` file; `~/` is allowed. Non-empty, 512 MB max. |
| `caption`   | Exact caption, up to 2200 characters.                                    |

Output: `taskId` and `taskUrl` (the Manus task page).

### `get_post_status`

Checks a `post_reel` task.

| Input    | Description                      |
| -------- | -------------------------------- |
| `taskId` | `taskId` returned by `post_reel` |

Output: `taskId`, `taskUrl`, `state`, and optionally `postUrl` and `message`.

| `state`           | Meaning                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `running`         | Manus is still working.                                                                                    |
| `needs_attention` | Manus is waiting for input, or stopped without reporting a result. Open `taskUrl` and resolve it in Manus. |
| `published`       | The Reel is live; `postUrl` has the permalink when Manus reported one.                                     |
| `failed`          | Publishing failed; `message` says why.                                                                     |

## Environment variables

| Variable                    | Required | Default     | Description                                                  |
| --------------------------- | -------- | ----------- | ------------------------------------------------------------ |
| `MANUS_API_KEY`             | Yes      |             | Manus API key.                                               |
| `MANUS_INSTAGRAM_CONNECTOR` | No       | `Instagram` | Name (case-insensitive) or id of the Manus connector to use. |

The Instagram connector's id is not documented, so the server looks it up by name with Manus `connector.list`.
Empty values are treated as unset.
`npm start` loads `.env` from the current directory if present.

## Usage

Ask Claude something like:

> Post ~/videos/reel.mp4 to Instagram with caption "Behind the scenes of today's shoot #studio"

Claude calls `post_reel`, then `get_post_status` until the state is `published`, `failed`, or `needs_attention`.

## Automation

The server only runs while Claude runs it, so nothing is posted when Claude is not running.
To post on a schedule, have Claude call the tools from a Claude Code `/loop` in an open session or from a Claude Code desktop scheduled task on this machine.
Cloud routines cannot reach this local server.

## Limitations

- A real publish through Manus has not been verified end to end yet.
- The Manus Instagram connector is in early beta and may change or fail.
- `post_reel` is not idempotent: every call is a new billed Manus task and publishes a new Reel.
  Check `get_post_status` before retrying.
- Manus may pause for input, which shows up as `needs_attention`; resolve it in the Manus task page.
- Uploaded videos are deleted from Manus automatically 48 hours after upload.

## Development

```sh
npm run check
```

This runs the format check, lint, and typecheck.
