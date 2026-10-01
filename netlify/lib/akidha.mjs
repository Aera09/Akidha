export const STATUSES = [
  "SHIPMENT_PICKED_UP",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "RTO_INITIATED",
  "RTO_DELIVERED",
];

// Statuses allowed next, by the status last sent to Akidha ("" = not sent).
// Orders move one step at a time; COMPLETED and RTO_DELIVERED are final.
export const NEXT_STATUSES = {
  "": ["SHIPMENT_PICKED_UP"],
  SHIPMENT_PICKED_UP: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["COMPLETED", "RTO_INITIATED"],
  RTO_INITIATED: ["RTO_DELIVERED"],
  COMPLETED: [],
  RTO_DELIVERED: [],
};

export function allowedNext(currentStatus) {
  return NEXT_STATUSES[currentStatus || ""] ?? [];
}

// Reused across invocations while the function instance stays warm.
let cachedSession = null;

// AKIDHA_ENV picks a set of settings, like the ENV switch in mx-inbound:
//   AKIDHA_ENV=PROD  -> AKIDHA_BASE_URL_PROD,  AKIDHA_EMAIL_PROD,  AKIDHA_PASSWORD_PROD
//   AKIDHA_ENV=STAGE -> AKIDHA_BASE_URL_STAGE, AKIDHA_EMAIL_STAGE, AKIDHA_PASSWORD_STAGE
// Without AKIDHA_ENV the plain names (AKIDHA_BASE_URL, ...) are used. With it,
// only that environment's values count, so PROD never borrows STAGE settings.
function akidhaSetting(name) {
  const mode = (process.env.AKIDHA_ENV || "").trim().toUpperCase();
  const key = mode ? `${name}_${mode}` : name;
  const value = (process.env[key] || "").trim();
  if (!value) throw new Error(`Missing environment variable ${key}`);
  return value;
}

function baseUrl() {
  return akidhaSetting("AKIDHA_BASE_URL").replace(/\/$/, "");
}

// Akidha logs in by email. Older .env files called it AKIDHA_USERNAME.
function loginEmail() {
  try {
    return akidhaSetting("AKIDHA_EMAIL");
  } catch (err) {
    if (!process.env.AKIDHA_ENV && process.env.AKIDHA_USERNAME) return process.env.AKIDHA_USERNAME.trim();
    throw err;
  }
}

export async function akidhaLogin() {
  const res = await fetch(`${baseUrl()}/api/v1/users/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: loginEmail(),
      password: akidhaSetting("AKIDHA_PASSWORD"),
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
