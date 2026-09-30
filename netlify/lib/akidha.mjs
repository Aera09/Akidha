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
  const res = await fetch(`${baseUrl()}/api/v1/users/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: env("AKIDHA_EMAIL"),
      password: env("AKIDHA_PASSWORD"),
    }),
  });

  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("JSESSIONID="));
  if (!res.ok || !cookie) {
    throw new Error(`Akidha login failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  cachedSession = cookie.slice("JSESSIONID=".length);
  return cachedSession;
}

async function sendStatus(jsessionid, ulid, status) {
  const url = `${baseUrl()}/api/v1/IN/en/orders/${encodeURIComponent(ulid)}/status/${encodeURIComponent(status)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      cookie: `JSESSIONID=${jsessionid}`,
    },
    body: "{}",
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

function sessionExpired(result) {
  return result.status === 401 || result.status === 403 || result.body.includes("SessionKeyInvalid");
}

export async function akidhaUpdateStatus(ulid, status) {
  let result = cachedSession ? await sendStatus(cachedSession, ulid, status) : null;
  // No session yet, or it expired: log in once and retry.
  if (!result || (!result.ok && sessionExpired(result))) {
    result = await sendStatus(await akidhaLogin(), ulid, status);
  }
  return result;
}
