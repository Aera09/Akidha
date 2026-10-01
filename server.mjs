// Local stand-in for Netlify: serves public/ and runs the functions in
// netlify/functions at their config.path. Start with `npm start`.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// Load .env if it exists. Without it the page still loads; API calls
// return a message saying what's missing.
const envPath = join(root, ".env");
try {
  process.loadEnvFile(envPath);
  const names = Object.keys(process.env).filter((k) => /^(SUPABASE|AKIDHA|DASHBOARD)_/.test(k));
  console.log(`Loaded ${envPath}: ${names.join(", ") || "no SUPABASE_/AKIDHA_/DASHBOARD_ settings"}`);
} catch (err) {
  console.warn(`Could not read ${envPath}: ${err.message}`);
  console.warn("Copy .env.example to .env and fill it in.");
}
const publicDir = join(root, "public");
const functionsDir = join(root, "netlify/functions");
const port = Number(process.env.PORT || 8888);

const routes = new Map();
for (const file of await readdir(functionsDir)) {
  if (!file.endsWith(".mjs")) continue;
  const mod = await import(pathToFileURL(join(functionsDir, file)).href);
  routes.set(mod.config?.path || `/.netlify/functions/${file.slice(0, -4)}`, mod.default);
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const handler = routes.get(url.pathname);
    if (handler) {
      const hasBody = !["GET", "HEAD"].includes(req.method);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? "half" : undefined,
      });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = join(publicDir, rel);
    if (!file.startsWith(publicDir)) throw Object.assign(new Error(), { code: "ENOENT" });
    const data = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR") {
      res.writeHead(404).end("Not found");
    } else {
      console.error(err);
      res.writeHead(500).end("Server error");
    }
  }
}).listen(port, () => {
  console.log(`Dashboard running at http://localhost:${port}`);
  console.log(`API routes: ${[...routes.keys()].join(", ")}`);
});
