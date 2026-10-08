import { checkAuth, json } from "../lib/http.mjs";
import { fetchOrders } from "../lib/supabase.mjs";
import { STATUSES, NEXT_STATUSES, akidhaEnv } from "../lib/akidha.mjs";

export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "Use GET" });
  const denied = checkAuth(req);
  if (denied) return denied;

  try {
    return json(200, {
      orders: await fetchOrders(),
      env: (process.env.DOCPHARMA_ENV || "").toUpperCase() || "default",
      akidhaEnv: akidhaEnv() || "not set",
      statuses: STATUSES,
      next: NEXT_STATUSES,
    });
  } catch (err) {
    console.error(err);
    return json(502, { error: err.message });
  }
};

export const config = { path: "/api/orders" };
