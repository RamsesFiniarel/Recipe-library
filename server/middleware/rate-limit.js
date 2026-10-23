/** At most `max` requests per `windowMs` per address, then 429 with
 * Retry-After. Fixed window in memory (single process). */
export function rateLimit({ windowMs, max, label }) {
  const hits = new Map(); // address -> { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    let entry = hits.get(req.ip);
    if (!entry || entry.resetAt <= now) {
      // Addresses whose window has passed go, before the map can grow.
      if (hits.size > 1000) for (const [address, old] of hits) if (old.resetAt <= now) hits.delete(address);
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(req.ip, entry);
    }
    entry.count += 1;
    if (entry.count <= max) return next();
    if (entry.count === max + 1) console.warn(`Requêtes limitées (${label}) : ${req.ip} a dépassé ${max} en ${windowMs / 1000} s`);
    res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    res.status(429).json({ error: "Trop de requêtes, réessayez dans un instant" });
  };
}
