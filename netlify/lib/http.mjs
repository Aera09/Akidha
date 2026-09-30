import { timingSafeEqual } from "node:crypto";

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function env(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

// Returns an error Response when the dashboard password is wrong, else null.
export function checkAuth(req) {
  const expected = Buffer.from(env("DASHBOARD_PASSWORD"));
  const given = Buffer.from(req.headers.get("x-dashboard-key") || "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return json(401, { error: "Wrong dashboard password" });
  }
  return null;
}
