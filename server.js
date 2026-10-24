// Face Wars server — no npm install needed. Run: node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const cards = new Map(); // id -> {buf, t}
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const ips = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);

// drop cards older than 2 hours
setInterval(() => {
  const now = Date.now();
  for (const [id, c] of cards) if (now - c.t > 2 * 3600e3) cards.delete(id);
}, 10 * 60e3);

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;

    if (req.method === "POST" && p === "/api/card") {
      const chunks = [];
      let size = 0;
      req.on("data", (d) => {
        size += d.length;
        if (size > 8e6) req.destroy();
        else chunks.push(d);
      });
      req.on("end", () => {
        const id = crypto.randomBytes(5).toString("hex");
        cards.set(id, { buf: Buffer.concat(chunks), t: Date.now() });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id }));
      });
      return;
    }

    if (p === "/api/info") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ips: ips(), port: PORT }));
    }

    // Page opened by scanning the QR: shows the photo + download button
    let m = p.match(/^\/card\/(\w+)$/);
    if (m) {
      if (!cards.has(m[1])) {
        res.writeHead(404);
        return res.end("Card expired or not found");
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Face Wars card</title>
<body style="margin:0;background:#050318;color:#fff;font-family:system-ui;text-align:center;padding:16px">
<img src="/card/${m[1]}.jpg" style="width:100%;max-width:640px;border-radius:12px;border:3px solid #5fe9ff">
<p><a href="/card/${m[1]}.jpg" download="face-wars.jpg"
 style="display:inline-block;margin-top:12px;padding:14px 28px;background:#ffe45e;color:#111;font-weight:700;border-radius:10px;text-decoration:none">Download photo</a></p>
<p style="opacity:.7;font-size:14px">Or long-press the photo to save it.</p></body>`);
    }
    m = p.match(/^\/card\/(\w+)\.jpg$/);
    if (m) {
      const c = cards.get(m[1]);
      if (!c) {
        res.writeHead(404);
        return res.end("Not found");
      }
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Disposition": 'inline; filename="face-wars.jpg"',
      });
      return res.end(c.buf);
    }

    // static files
    const file = path.join(ROOT, p === "/" ? "index.html" : p);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (e, data) => {
      if (e) {
        res.writeHead(404);
        return res.end("Not found");
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      });
      res.end(data);
    });
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`Face Wars: http://localhost:${PORT}`);
    ips().forEach((ip) =>
      console.log(`  Phone (same Wi-Fi): http://${ip}:${PORT}`),
    );
  });
