# Instagram Reels MCP server

A small MCP stdio server that lets Claude post a local `.mp4` to Instagram as a Reel and research trending short-form formats.
To post, it uploads the video to Manus and asks a Manus task to publish it through the Manus Instagram connector.
To research, it asks a Manus task to find the top trending short-form videos for one platform and niche, writes a format breakdown for each (hook, structure, audio, on-screen text, caption style, hashtags, and a recipe), and downloads the clips locally with yt-dlp into a swipe-file folder.
The research is for shooting your own original content in a trending format; reference clips stay local and are never edited or reposted.
It can also drive [Maestro](https://github.com/Blizaine/Maestro), a local AI video studio launched by Pinokio, to run its Viggle Animate recipe: a control video supplies the motion and a character replaces the person in it.

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
- For animation, Maestro 2.1 or newer running in Pinokio on a PC with an NVIDIA GPU, reachable from the machine that runs this server (see [Connect to Maestro](#connect-to-maestro)).

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

### `animate_video`

Uploads the files to Maestro and queues one Viggle Animate job, the same as filling in Studio's Animate form and clicking Run.
It returns as soon as the job is queued; generation takes several minutes.
Every call queues a new GPU job, so check `get_animation_status` before retrying.

| Input                | Description                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `controlVideoPath`   | Absolute path to the control video (`.mp4`, `.mov`, `.webm`, `.mkv`, `.m4v`, `.avi`); `~/` is allowed. 500 MB max. |
| `editedFramePath`    | A frame of the control video already edited to show the character (Studio's "Use an edited frame").                |
| `characterImagePath` | A character image; Maestro prepares the replacement frame with Flux 2 Klein (Studio's "Use a character").          |
| `character`          | A saved Maestro character name or id, from `list_maestro_characters`.                                              |
| `audio`              | `none` (default, silent), `control` (keep the control video's soundtrack), or `custom` (use `audioPath`).          |
| `audioPath`          | Absolute path to the soundtrack, required when `audio` is `custom`.                                                |
| `resolution`         | `auto_480p`, `auto_540p`, `auto_720p`, `auto_768p`, or `auto_1080p`. Defaults to `MAESTRO_RESOLUTION`.             |
| `seed`               | Seed; omit or `-1` for random.                                                                                     |
| `trimStart`          | Start of the section of the control video to animate, in seconds. Defaults to the whole video.                     |
| `trimEnd`            | End of that section, in seconds.                                                                                   |
| `frameSeconds`       | Time of the frame the character replaces, in seconds, inside the trimmed section.                                  |
| `imageModel`         | `flux2_klein_9b` (default) or `flux2_klein_4b`, used to prepare the character frame.                               |

Give exactly one of `editedFramePath`, `characterImagePath`, or `character`.
Control videos inside `RESEARCH_DIR` are refused, because research clips are for studying formats only.

Output: `jobId`, `queued`, `maestroUrl`, and optionally `controlVideoSeconds`.

### `get_animation_status`

Checks an `animate_video` job.
The first call after the job completes downloads the result into `MAESTRO_OUTPUT_DIR`.

| Input   | Description                         |
| ------- | ----------------------------------- |
| `jobId` | `jobId` returned by `animate_video` |

Output: `jobId`, `state`, `progress` (0 to 100), and optionally `phase`, `message`, `outputs` (local video paths), and `error`.

| `state`     | Meaning                                                      |
| ----------- | ------------------------------------------------------------ |
| `queued`    | Waiting for Maestro's GPU slot.                              |
| `running`   | Generating; `progress` and `phase` show how far along it is. |
| `completed` | Done; `outputs` lists the downloaded videos.                 |
| `failed`    | Maestro reported an error; `error` says why.                 |
| `cancelled` | The job was cancelled.                                       |

Maestro keeps jobs in memory, so after Maestro restarts an old `jobId` is unknown; finished videos are still in Maestro's gallery.

### `cancel_animation`

Cancels a queued or running `animate_video` job and returns its status.

### `list_maestro_characters`

Lists the characters saved in Maestro as `id` and `name`.

## Environment variables

| Variable                     | Required | Default                  | Description                                                                                            |
| ---------------------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `MANUS_API_KEY`              | Yes      |                          | Manus API key.                                                                                         |
| `MANUS_INSTAGRAM_CONNECTOR`  | No       | `Instagram`              | Name (case-insensitive) or id of the Manus connector to use.                                           |
| `ANTHROPIC_API_KEY`          | No       |                          | Claude API key the web UI uses to write captions automatically.                                        |
| `RESEARCH_DIR`               | No       | `~/Movies/reel-research` | Absolute folder for research swipe files; `~/` is allowed.                                             |
| `YTDLP_PATH`                 | No       | `yt-dlp`                 | yt-dlp command or absolute path.                                                                       |
| `YTDLP_COOKIES_FROM_BROWSER` | No       |                          | Browser yt-dlp reads cookies from, for example `chrome`, to get past login walls.                      |
| `UI_PORT`                    | No       | `3000`                   | Port for the local web UI.                                                                             |
| `MAESTRO_URL`                | No       |                          | Maestro address, for example `https://maestro-pc.tailnet-name.ts.net`. Needed for the animation tools. |
| `MAESTRO_OUTPUT_DIR`         | No       | `~/Movies/maestro`       | Absolute folder finished animations are downloaded to; `~/` is allowed.                                |
| `MAESTRO_RESOLUTION`         | No       | `auto_720p`              | Default output resolution for `animate_video`.                                                         |
| `MAESTRO_WORKSPACE`          | No       |                          | Maestro workspace to save outputs in; Maestro's active workspace when unset.                           |

The Instagram connector's id is not documented, so the server looks it up by name with Manus `connector.list`.
Empty values are treated as unset.
`npm start` loads `.env` from the current directory if present.

## Usage

Ask Claude something like:

> Post ~/videos/reel.mp4 to Instagram with caption "Behind the scenes of today's shoot #studio"

Claude calls `post_reel`, then `get_post_status` until the state is `published`, `failed`, or `needs_attention`.

> Research the top 10 YouTube Shorts in the gym niche from the last 7 days

Claude calls `research_trends`, then `get_research_status` until the state is `complete`, `failed`, or `needs_attention`, and summarizes the formats.

> Animate ~/clips/dance.mp4 with the saved Maestro character Ava, keeping the original audio

Claude calls `animate_video`, then `get_animation_status` until the state is `completed`, `failed`, or `cancelled`, and can pass the result to `post_reel`.

## Connect to Maestro

Maestro has no login, so keep it off networks you do not trust.
Its HTTP API is the one its own web UI uses; this server calls it directly and never clicks through the page.

On the Maestro PC:

1. In Pinokio, turn on **Autolaunch** for Maestro so it starts with the PC.
2. Use Tailscale (recommended): install Tailscale on the Maestro PC and on the machine that runs this server, sign both into the same tailnet, then click **Secure Remote Access** on Maestro's page in Pinokio (Maestro's guide: `docs/TAILSCALE_REMOTE_ACCESS.md`).
   Set `MAESTRO_URL` to the `https://<pc-name>.<tailnet>.ts.net` address it shows.
   This also pins Maestro's port, so the address does not change between restarts.
3. Or use the local network: add `PINOKIO_SHARE_LOCAL=true` to Maestro's ENVIRONMENT file in Pinokio, restart Maestro, and set `MAESTRO_URL` to `http://<pc-lan-ip>:<port>`, using the port from Maestro's Open Web UI address.
   Pinokio may pick a new port on each start, and anyone on the network can use Maestro this way.
4. If this server runs on the Maestro PC itself, use the Open Web UI address as is, for example `http://127.0.0.1:42015`.

Check the connection with `curl "$MAESTRO_URL/api/v1/system-config"`, which returns Maestro's settings including `app_version`.

## Web UI

A minimal local page for posting a Reel without Claude.

```sh
npm run build
npm run ui
```

Open http://127.0.0.1:3000 (or your `UI_PORT`), enter the absolute path to an `.mp4` and the caption, and click Post to Instagram.
Leave the caption empty to have Claude write one: it samples frames with `ffmpeg`, writes the caption, and posts it right away without review.
Generated captions are a single short safe-for-work question, aimed at 5 to 7 words and never more than 15, with no hashtags; captions you type are posted exactly as written.
This needs `ANTHROPIC_API_KEY` in `.env` and `ffmpeg` on `PATH`.
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
- The Maestro API is undocumented apart from its job queue and may change between Maestro versions; it was built against Maestro 2.1.5 and 2.6.0 source.
- `animate_video` is not idempotent: every call queues a new GPU job.
- Only animate footage and faces you have the rights and consent to use.

## Development

```sh
npm run check
```

This runs the format check, lint, and typecheck.
