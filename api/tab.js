// Shared group tab for the birthday page.
// GET  /api/tab                 -> { spent }
// POST /api/tab {amount: n}     -> records a request (negative n = undo), returns { spent }
// POST /api/tab {reset: true}   -> starts the tab over at $0
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
let ready = null;
const setup = () => (ready ??= sql`CREATE TABLE IF NOT EXISTS tab_events (
  id BIGSERIAL PRIMARY KEY,
  amount INTEGER NOT NULL DEFAULT 0,
  reset BOOLEAN NOT NULL DEFAULT FALSE,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
)`);

// Everything after the latest reset, never below zero.
async function spent() {
  const [row] = await sql`
    SELECT COALESCE(SUM(amount), 0)::int AS spent FROM tab_events
    WHERE id > COALESCE((SELECT MAX(id) FROM tab_events WHERE reset), 0)`;
  return Math.max(0, row.spent);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    await setup();
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (body.reset === true) {
        await sql`INSERT INTO tab_events (reset) VALUES (TRUE)`;
      } else {
        const amount = Number(body.amount);
        // Requests are whole dollars; nothing a single order on the page could exceed.
        if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 200) {
          return res.status(400).json({ error: "bad amount" });
        }
        await sql`INSERT INTO tab_events (amount) VALUES (${amount})`;
      }
    } else if (req.method !== "GET") {
      return res.status(405).json({ error: "GET or POST" });
    }
    res.status(200).json({ spent: await spent() });
  } catch (e) {
    res.status(500).json({ error: "tab unavailable" });
  }
}
