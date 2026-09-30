import { env } from "./http.mjs";

export const STATUSES = [
  "SHIPMENT_PICKED_UP",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "RTO_INITIATED",
  "RTO_DELIVERED",
];

// Reused across invocations while the function instance stays warm.
let cachedSession = null;

function baseUrl() {
  return env("AKIDHA_BASE_URL").replace(/\/$/, "");
}

export async function akidhaLogin() {
  const username = env("AKIDHA_USERNAME");
  const password = env("AKIDHA_PASSWORD");
  const asJson = env("AKIDHA_LOGIN_FORMAT", "form") === "json";

  const res = await fetch(baseUrl() + env("AKIDHA_LOGIN_PATH", "/login"), {
    method: "POST",
    redirect: "manual", // login pages often 302; the cookie is on that response
    headers: {
      "content-type": asJson ? "application/json" : "application/x-www-form-urlencoded",
    },
    body: asJson
      ? JSON.stringify({ username, password })
      : new URLSearchParams({ username, password }).toString(),
  });

  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("JSESSIONID="));
  if (!cookie) {
    throw new Error(`Akidha login failed (${res.status}): no JSESSIONID cookie returned`);
  }
  cachedSession = cookie.slice("JSESSIONID=".length);
  return cachedSession;
}

async function sendStatus(jsessionid, ulid, status) {
  const path = env("AKIDHA_STATUS_PATH").replace("{ulid}", encodeURIComponent(ulid));
  const res = await fetch(baseUrl() + path, {
    method: env("AKIDHA_STATUS_METHOD", "POST"),
    headers: {
      "content-type": "application/json",
      cookie: `JSESSIONID=${jsessionid}`,
    },
    body: JSON.stringify({ ulid, status }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

export async function akidhaUpdateStatus(ulid, status) {
  let result = cachedSession ? await sendStatus(cachedSession, ulid, status) : null;
  // No session yet, or it expired: log in once and retry.
  if (!result || result.status === 401 || result.status === 403) {
    result = await sendStatus(await akidhaLogin(), ulid, status);
  }
  return result;
}
