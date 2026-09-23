import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_ORIGINS, publicConfig } from "./config.js";
import { metrics } from "./metrics.js";

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

function readJsonBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export function createHttpServer({ checkHealth, leaderboard, playerRepository, matchRepository, publicRoomPage, onDrain } = {}) {
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
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const requested = decodeURIComponent(requestUrl.pathname);

    if (requested === "/drain") {
      if (onDrain) {
        Promise.resolve(onDrain()).catch((err) => console.error("[http] onDrain error:", err));
      }
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify({ draining: true }));
      return;
    }

    if (requested === "/health/live") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify({ status: "alive" }));
      return;
    }

    if (requested === "/health/ready") {
      Promise.resolve(checkHealth ? checkHealth() : { ready: true })
        .then((health) => {
          const isReady = health?.ready !== false;
          res.writeHead(isReady ? 200 : 503, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          });
          res.end(JSON.stringify(health || { ready: true }));
        })
        .catch((err) => {
          res.writeHead(503, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          });
          res.end(JSON.stringify({ ready: false, error: err.message }));
        });
      return;
    }

    if (requested === "/metrics" || requested === "/metrics.json" || requested === "/api/metrics") {
      const acceptsJson = requested.endsWith(".json") || requested.startsWith("/api/") || (req.headers.accept && req.headers.accept.includes("application/json"));
      if (acceptsJson) {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        });
        res.end(JSON.stringify(metrics.getSnapshot()));
      } else {
        res.writeHead(200, {
          "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          "Cache-Control": "no-store"
        });
        res.end(metrics.formatPrometheus());
      }
      return;
    }

    if (requested === "/config.json") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify(publicConfig()));
      return;
    }
    if (requested === "/leaderboard.json") {
      Promise.all([
        Promise.resolve(leaderboard?.top("1v1", 10) || []),
        Promise.resolve(leaderboard?.top("2v2", 10) || [])
      ])
        .then(([board1v1, board2v2]) => {
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          });
          res.end(
            JSON.stringify({
              boards: {
                "1v1": board1v1,
                "2v2": board2v2
              }
            })
          );
        })
        .catch((err) => {
          res.writeHead(500, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          });
          res.end(JSON.stringify({ error: "Leaderboard unavailable", details: err.message }));
        });
      return;
    }
    if (requested === "/rooms.json") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(
        JSON.stringify(
          publicRoomPage?.({
            offset: Number(requestUrl.searchParams.get("offset")) || 0,
            status: requestUrl.searchParams.get("status")
          }) || { rooms: [], total: 0, hasMore: false, nextOffset: 0 }
        )
      );
      return;
    }

    if (requested.startsWith("/api/profile")) {
      if (req.method === "POST") {
        readJsonBody(req)
          .then(async (body) => {
            const profile = await playerRepository?.getOrCreatePlayer(body);
            res.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store"
            });
            res.end(JSON.stringify({ profile }));
          })
          .catch((err) => {
            res.writeHead(400, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store"
            });
            res.end(JSON.stringify({ error: err.message }));
          });
        return;
      }

      if (req.method === "GET") {
        const pathPart = requested.replace(/^\/api\/profile\/?/, "").trim();
        const id = pathPart || requestUrl.searchParams.get("id");
        const handle = requestUrl.searchParams.get("handle");

        Promise.resolve()
          .then(async () => {
            let player = null;
            if (id) {
              player = await playerRepository?.getPlayer(id);
            }
            if (!player && handle) {
              player = await playerRepository?.getPlayerByHandle(handle);
            }
            if (!player && id && !id.includes("-")) {
              player = await playerRepository?.getPlayerByHandle(id);
            }

            if (!player) {
              res.writeHead(404, {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
              });
              res.end(JSON.stringify({ error: "Player not found" }));
              return;
            }

            const matches = matchRepository ? await matchRepository.getPlayerMatches(player.id, 10) : [];
            res.writeHead(200, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store"
            });
            res.end(JSON.stringify({ profile: player, matches }));
          })
          .catch((err) => {
            res.writeHead(500, {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store"
            });
            res.end(JSON.stringify({ error: "Internal error", details: err.message }));
          });
        return;
      }
    }

    if (requested === "/api/ranked/leaderboard") {
      const limit = Number(requestUrl.searchParams.get("limit")) || 25;
      Promise.resolve(playerRepository?.getRankedLeaderboard(limit) || [])
        .then((leaderboardList) => {
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          });
          res.end(JSON.stringify({ leaderboard: leaderboardList }));
        })
        .catch((err) => {
          res.writeHead(500, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          });
          res.end(JSON.stringify({ error: "Failed to load ranked leaderboard", details: err.message }));
        });
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
