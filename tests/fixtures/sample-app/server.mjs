// Tiny static server for the framework's fixture web app.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const port = Number(process.env.FIXTURE_PORT ?? 4710);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(here, p);
  if (!file.startsWith(here) || !existsSync(file) || !statSync(file).isFile()) {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain");
    res.end("Not found");
    return;
  }
  const type = TYPES[path.extname(file)] ?? "application/octet-stream";
  res.setHeader("content-type", type);
  res.end(readFileSync(file));
});

server.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`fixture-app listening on http://127.0.0.1:${port}`);
});
