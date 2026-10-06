# Instagram Reels MCP server

A small MCP stdio server that lets Claude post a local `.mp4` to Instagram as a Reel and research trending short-form formats.
To post, it uploads the video to Manus and asks a Manus task to publish it through the Manus Instagram connector.
To research, it asks a Manus task to find the top trending short-form videos for one platform and niche, writes a format breakdown for each (hook, structure, audio, on-screen text, caption style, hashtags, and a recipe), and downloads the clips locally with yt-dlp into a swipe-file folder.
The research is for shooting your own original content in a trending format; reference clips stay local and are never edited or reposted.

> **Publishing is not yet verified live.**
> A real end-to-end publish through Manus has not been tested yet.
> Try it on a test account first.
> Trend research has been run live end to end on YouTube Shorts; TikTok, Instagram, and X have not been tried yet.

## Requirements

- Node.js 22.9 or newer.
- A Manus account and an API key.
- The Instagram connector installed in the Manus web app under Settings > Connectors > Add Connector > Instagram.
  It is an early-beta connector and needs an Instagram professional (creator or business) account.
  It is not the "Instagram Creator Marketplace" connector.
- For trend research, yt-dlp and ffmpeg on your `PATH` (`brew install yt-dlp ffmpeg` on macOS).

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

### `research_trends`

Starts a billed Manus task that finds the top public short-form videos for one platform and niche and writes a format breakdown for each.
Only adult creators and non-explicit content are considered.
It returns as soon as the task is created; research takes several minutes.
Every call starts a new billed task.

| Input      | Description                                                                      |
| ---------- | -------------------------------------------------------------------------------- |
| `platform` | `tiktok`, `instagram` (Reels), `youtube_shorts`, or `x`.                         |
| `niche`    | Niche to search, for example `gym`, `beach`, or `fashion`. Up to 100 characters. |
| `count`    | How many top videos to research, 1 to 10. Defaults to 10.                        |
| `days`     | Only consider videos posted within this many days, 1 to 30. Defaults to 7.       |

Output: `taskId`, `taskUrl` (the Manus task page), and `outputDir` (the swipe-file folder the clips will be saved to).

### `get_research_status`

Checks a `research_trends` task.
The first call after Manus finishes starts downloading the clips in the background.

| Input    | Description                            |
| -------- | -------------------------------------- |
| `taskId` | `taskId` returned by `research_trends` |

Output: `taskId`, `taskUrl`, `state`, and optionally `message`, `outputDir`, and `videos`.
Each video has `platform`, `url`, `creator`, `postedAt`, `views`, `likes`, the breakdown fields (`hook`, `structure`, `audio`, `onScreenText`, `captionStyle`, `hashtags`, `recipe`), and either `localPath` or `downloadError`.

| `state`           | Meaning                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `running`         | Manus is still researching.                                                                      |
| `needs_attention` | Manus is waiting for input, for example at a login wall. Open `taskUrl` and resolve it in Manus. |
| `downloading`     | Manus finished and the clips are downloading. Call again shortly.                                |
| `complete`        | The swipe file is ready in `outputDir`; each video has a `localPath` or a `downloadError`.       |
| `failed`          | Research failed; `message` says why.                                                             |

The swipe-file folder is `<RESEARCH_DIR>/<YYYY-MM-DD>-<platform>-<niche-slug>-<taskId>/` and contains the clips as `NN-<creator>.mp4`, the original request in `request.json`, a readable breakdown in `README.md`, and everything as data in `manifest.json`.

## Environment variables

| Variable                     | Required | Default                  | Description                                                                       |
| ---------------------------- | -------- | ------------------------ | --------------------------------------------------------------------------------- |
| `MANUS_API_KEY`              | Yes      |                          | Manus API key.                                                                    |
| `MANUS_INSTAGRAM_CONNECTOR`  | No       | `Instagram`              | Name (case-insensitive) or id of the Manus connector to use.                      |
| `RESEARCH_DIR`               | No       | `~/Movies/reel-research` | Absolute folder for research swipe files; `~/` is allowed.                        |
| `YTDLP_PATH`                 | No       | `yt-dlp`                 | yt-dlp command or absolute path.                                                  |
| `YTDLP_COOKIES_FROM_BROWSER` | No       |                          | Browser yt-dlp reads cookies from, for example `chrome`, to get past login walls. |
| `UI_PORT`                    | No       | `3000`                   | Port for the local web UI.                                                        |

The Instagram connector's id is not documented, so the server looks it up by name with Manus `connector.list`.
Empty values are treated as unset.
`npm start` loads `.env` from the current directory if present.

## Usage

Ask Claude something like:

> Post ~/videos/reel.mp4 to Instagram with caption "Behind the scenes of today's shoot #studio"

Claude calls `post_reel`, then `get_post_status` until the state is `published`, `failed`, or `needs_attention`.

> Research the top 10 YouTube Shorts in the gym niche from the last 7 days

Claude calls `research_trends`, then `get_research_status` until the state is `complete`, `failed`, or `needs_attention`, and summarizes the formats.

## Web UI

A minimal local page for posting a Reel without Claude.

```sh
npm run build
npm run ui
```

Open http://127.0.0.1:3000 (or your `UI_PORT`), enter the absolute path to an `.mp4` and the caption, and click Post to Instagram.
It uses the same publish logic as `post_reel` and polls the same status as `get_post_status` until the Reel is `published` or `failed`.
The button stays disabled once a post starts, so reload the page to post another Reel.
Every click publishes a new Reel and starts a new billed Manus task.
The server only listens on 127.0.0.1.

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
- Trend research has only been run live on YouTube Shorts so far.
- `research_trends` is not idempotent either: every call is a new billed Manus task.
- TikTok and Instagram may show login walls.
  During research these show up as `needs_attention`; during download they show up as a per-video `downloadError`.
  Setting `YTDLP_COOKIES_FROM_BROWSER` to a browser where you are logged in helps with downloads.
- Views, likes, and post dates are read off the page by Manus and are approximate.
- Reference clips are for studying formats, not for reposting.

## Development

```sh
npm run check
```

This runs the format check, lint, and typecheck.
