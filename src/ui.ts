import Anthropic from "@anthropic-ai/sdk";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { CaptionWriter } from "./caption.js";
import { loadConfig } from "./config.js";
import { InstagramPublisher } from "./instagram.js";
import { ManusClient } from "./manus.js";

const config = loadConfig();
const publisher = new InstagramPublisher(
  new ManusClient(config.apiKey),
  config.instagramConnector
);
const captionWriter =
  config.anthropicApiKey &&
  new CaptionWriter(new Anthropic({ apiKey: config.anthropicApiKey }));
const host = "127.0.0.1";
const allowedHosts = new Set([
  `${host}:${config.uiPort}`,
  `localhost:${config.uiPort}`
]);

const postSchema = z.object({
  videoPath: z.string().min(1, { error: "Enter the path to an .mp4 file" }),
  caption: z
    .string()
    .max(2200, { error: "Caption must be 2200 characters or fewer" })
});

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Post a Reel</title>
<style>
:root { color-scheme: light dark; --bg: #f6f6f4; --card: #ffffff; --text: #1a1a1a; --muted: #6b6b6b; --border: #dcdcd8; --accent: #1a1a1a; --accent-text: #ffffff; --error: #b42318; --ok: #067647; }
@media (prefers-color-scheme: dark) { :root { --bg: #111111; --card: #1b1b1b; --text: #ececec; --muted: #9a9a9a; --border: #333333; --accent: #ececec; --accent-text: #111111; --error: #f97066; --ok: #47cd89; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, sans-serif; }
main { width: 100%; max-width: 480px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; }
h1 { margin: 0 0 20px; font-size: 20px; font-weight: 600; }
label { display: block; margin-bottom: 6px; font-weight: 500; }
input, textarea { width: 100%; margin-bottom: 16px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
textarea { min-height: 120px; resize: vertical; }
button { width: 100%; padding: 12px; border: 0; border-radius: 8px; background: var(--accent); color: var(--accent-text); font: inherit; font-weight: 600; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
#status { margin: 16px 0 0; color: var(--muted); overflow-wrap: anywhere; }
#status:empty { display: none; }
#status.error { color: var(--error); }
#status.ok { color: var(--ok); }
#status a { color: inherit; }
</style>
</head>
<body>
<main>
<h1>Post a Reel to Instagram</h1>
<form id="form">
<label for="videoPath">Video path</label>
<input id="videoPath" name="videoPath" placeholder="/Users/you/videos/reel.mp4" required autocomplete="off" spellcheck="false">
<label for="caption">Caption</label>
<textarea id="caption" name="caption" maxlength="2200" placeholder="Leave empty and Claude writes one from the video"></textarea>
<button id="post" type="submit">Post to Instagram</button>
</form>
<p id="status" role="status" aria-live="polite"></p>
</main>
<script>
const form = document.getElementById("form");
const button = document.getElementById("post");
const statusEl = document.getElementById("status");
const labels = { running: "Publishing...", needs_attention: "Needs attention in Manus", published: "Posted to Instagram", failed: "Failed" };

function link(text, href) {
  if (!/^https?:\\/\\//.test(href)) return document.createTextNode(text);
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = text;
  return a;
}

function show(parts, tone) {
  statusEl.className = tone || "";
  statusEl.replaceChildren(...parts.flatMap((part, i) => (i ? [document.createTextNode(" "), part] : [part])));
}

async function poll(taskId) {
  try {
    const response = await fetch("/api/status?id=" + encodeURIComponent(taskId));
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    const parts = [document.createTextNode(labels[body.state] + ".")];
    if (body.message) parts.push(document.createTextNode(body.message));
    if (body.postUrl) parts.push(link("View Reel", body.postUrl));
    parts.push(link("Manus task", body.taskUrl));
    show(parts, body.state === "published" ? "ok" : body.state === "failed" ? "error" : "");
    if (body.state === "published" || body.state === "failed") return;
  } catch (error) {
    show([document.createTextNode("Could not check status: " + error.message + ". Retrying...")], "error");
  }
  setTimeout(() => poll(taskId), 5000);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  const autoCaption = !form.caption.value.trim();
  show([document.createTextNode(autoCaption ? "Writing caption, then uploading video..." : "Uploading video and starting Manus task...")]);
  let response;
  try {
    response = await fetch("/api/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoPath: form.videoPath.value, caption: form.caption.value })
    });
  } catch {
    show([document.createTextNode("Lost connection to the UI server. The post may have started; check Manus before posting again.")], "error");
    return;
  }
  const body = await response.json().catch(() => ({ error: "Unreadable response from the UI server" }));
  if (!response.ok) {
    show([document.createTextNode(body.error)], "error");
    button.disabled = false;
    return;
  }
  if (autoCaption) {
    form.caption.value = body.caption;
    form.caption.readOnly = true;
  }
  show([document.createTextNode("Publishing started."), link("Manus task", body.taskUrl)]);
  poll(body.taskId);
});
</script>
</body>
</html>
`;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (!allowedHosts.has(req.headers.host ?? "")) {
    send(res, 403, { error: "Forbidden host" });
    return;
  }
  const url = new URL(req.url ?? "/", `http://${host}`);
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/post") {
    if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
      send(res, 415, { error: "Expected application/json" });
      return;
    }
    const input = postSchema.safeParse(await readJson(req).catch(() => null));
    if (!input.success) {
      send(res, 400, {
        error: input.error.issues.map((issue) => issue.message).join("; ")
      });
      return;
    }
    let caption = input.data.caption;
    if (!caption.trim()) {
      if (!captionWriter) {
        send(res, 400, {
          error:
            "Enter a caption, or set ANTHROPIC_API_KEY in .env to write one automatically"
        });
        return;
      }
      console.error(`Writing caption for ${input.data.videoPath}`);
      caption = await captionWriter.write(input.data.videoPath);
    }
    console.error(`Posting ${input.data.videoPath}`);
    const task = await publisher.postReel(input.data.videoPath, caption);
    console.error(`Started Manus task ${task.taskId}`);
    send(res, 200, { ...task, caption });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    const taskId = url.searchParams.get("id");
    if (!taskId) {
      send(res, 400, { error: "Missing id" });
      return;
    }
    send(res, 200, await publisher.getPostStatus(taskId));
    return;
  }
  send(res, 404, { error: "Not found" });
}

createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    send(res, 500, { error: message });
  });
}).listen(config.uiPort, host, () => {
  console.error(`Instagram Reel UI at http://${host}:${config.uiPort}`);
});
