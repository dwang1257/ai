import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { InstagramPublisher } from "./instagram.js";
import { ManusClient } from "./manus.js";
import { createServer } from "./server.js";

const config = loadConfig();
const publisher = new InstagramPublisher(
  new ManusClient(config.apiKey, config.baseUrl),
  config.instagramConnector
);

serveStdio(() => createServer(publisher));
