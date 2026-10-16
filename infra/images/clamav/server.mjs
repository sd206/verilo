// Minimal HTTP front end for clamd (Cloud Run only accepts HTTP, clamd speaks a TCP protocol).
//   POST /scan   body = file bytes  -> 200 {"status":"CLEAN"} | {"status":"INFECTED","signature":"..."}
//   GET  /health                    -> 200 when clamd answers PING
// No dependencies; Node 22+.
import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.PORT ?? 8080);
const CLAMD_HOST = process.env.CLAMD_HOST ?? "127.0.0.1";
const CLAMD_PORT = Number(process.env.CLAMD_PORT ?? 3310);
const MAX_BYTES = Number(process.env.SCAN_MAX_BYTES ?? 16 * 1024 * 1024);
const TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS ?? 60_000);

function clamdCommand(command, body) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: CLAMD_HOST, port: CLAMD_PORT });
    const chunks = [];
    sock.setTimeout(TIMEOUT_MS, () => sock.destroy(new Error("clamd timeout")));
    sock.on("data", (c) => chunks.push(c));
    sock.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim()));
    sock.on("error", reject);
    sock.on("connect", async () => {
      sock.write(`z${command}\0`);
      if (!body) return;
      try {
        let total = 0;
        for await (const chunk of body) {
          total += chunk.length;
          if (total > MAX_BYTES) throw Object.assign(new Error("too large"), { status: 413 });
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length);
          sock.write(len);
          sock.write(chunk);
        }
        sock.write(Buffer.alloc(4)); // zero-length chunk ends the stream
      } catch (e) {
        sock.destroy();
        reject(e);
      }
    });
  });
}

function send(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      const reply = await clamdCommand("PING");
      return reply === "PONG" ? send(res, 200, { ok: true }) : send(res, 503, { ok: false });
    }
    if (req.method === "POST" && req.url === "/scan") {
      const reply = await clamdCommand("INSTREAM", req);
      // "stream: OK" | "stream: <Signature> FOUND" | "INSTREAM size limit exceeded. ERROR"
      if (reply.endsWith(": OK")) return send(res, 200, { status: "CLEAN" });
      const found = reply.match(/^stream: (.+) FOUND$/);
      if (found) return send(res, 200, { status: "INFECTED", signature: found[1] });
      console.error(JSON.stringify({ severity: "ERROR", message: "clamd error", reply }));
      return send(res, 502, { error: "scan failed" });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    const status = e?.status ?? 503;
    console.error(JSON.stringify({ severity: "ERROR", message: "scan request failed", error: String(e) }));
    if (!res.headersSent) send(res, status, { error: status === 413 ? "too large" : "scanner unavailable" });
  }
});

server.listen(PORT, () => console.log(JSON.stringify({ severity: "INFO", message: `clamav http listening on ${PORT}` })));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
