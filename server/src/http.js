import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_ORIGINS, publicConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../../client/public");
const clientSrcDir = path.resolve(__dirname, "../../client/src");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const NO_STORE_EXTENSIONS = new Set([".html", ".js", ".css", ".webmanifest"]);

export function createHttpServer() {
  return http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin || ALLOWED_ORIGINS[0]);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }

    const requested = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    if (requested === "/config.json") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify(publicConfig()));
      return;
    }

    const servesClientSource = requested.startsWith("/src/");
    const rootDir = servesClientSource ? clientSrcDir : publicDir;
    const relativePath = servesClientSource ? requested.slice("/src/".length) : requested.replace(/^[/\\]+/, "") || "index.html";
    const filePath = path.resolve(rootDir, relativePath);
    if (!filePath.startsWith(rootDir + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": NO_STORE_EXTENSIONS.has(ext) || filePath.endsWith("sw.js") ? "no-store" : "public, max-age=3600"
      });
      res.end(data);
    });
  });
}
