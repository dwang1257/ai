import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createAnimator } from "./animate.js";
import { loadConfig } from "./config.js";
import { InstagramPublisher } from "./instagram.js";
import { ManusClient } from "./manus.js";
import { TrendResearcher } from "./research.js";
import { createServer } from "./server.js";
import { TrendScout } from "./trends.js";

const config = loadConfig();
const manus = new ManusClient(config.apiKey);
const publisher = new InstagramPublisher(manus, config.instagramConnector);
const researcher = new TrendResearcher(
  new TrendScout(manus, config.manusBrowser),
  {
    researchDir: config.researchDir,
    ytdlpPath: config.ytdlpPath,
    ...(config.ytdlpCookiesFromBrowser && {
      cookiesFromBrowser: config.ytdlpCookiesFromBrowser
    })
  }
);

const animator = createAnimator(config);

serveStdio(() => createServer(publisher, researcher, animator));
