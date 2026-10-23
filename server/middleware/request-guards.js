import os from "node:os";
import { isIP } from "node:net";

/** No login by choice: anyone on the LAN may use the app. These guards stop
 * a web page opened elsewhere from reaching it through a LAN browser. */

// Request host without its port ("[::1]:3000" -> "::1"), or null.
function requestHostname(hostHeader) {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  } catch {
    return null;
  }
}

/** DNS rebinding: a foreign name made to resolve to this machine still
 * shows in the Host header. Only IPs, localhost, the machine name (and its
 * .local form) and `allowedHosts` are answered. */
export function hostGuard({ allowedHosts = [], machineName = os.hostname() } = {}) {
  const machine = machineName.toLowerCase().replace(/\.local$/, "");
  const names = new Set(["localhost", machine, `${machine}.local`, ...allowedHosts.map((name) => name.toLowerCase())]);
  return (req, res, next) => {
    const hostname = requestHostname(req.headers.host);
    if (hostname && (isIP(hostname) || names.has(hostname))) return next();
    console.warn(`Requête refusée : hôte inconnu ${JSON.stringify(req.headers.host ?? null)} depuis ${req.ip}`);
    res.status(421).json({ error: "Hôte non autorisé" });
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Whether a request only reads. */
export const isSafeMethod = (req) => SAFE_METHODS.has(req.method);

// "http://192.168.1.20:3000" -> "192.168.1.20:3000"; null for "null" or junk.
function originHost(origin) {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Changes must come from this site's own pages (Sec-Fetch-Site, or Origin
 * on older browsers). JSON bodies without CORS already block them; this
 * makes it explicit. No header at all: not a web page. */
export function sameOriginGuard(req, res, next) {
  if (isSafeMethod(req)) return next();
  const site = req.headers["sec-fetch-site"];
  const origin = req.headers.origin;
  let allowed;
  if (site) allowed = site === "same-origin" || site === "none";
  else if (origin) allowed = originHost(origin) === (req.headers.host ?? "").toLowerCase();
  else allowed = true;
  if (allowed) return next();
  console.warn(`Requête refusée : ${req.method} ${req.originalUrl} venue d'un autre site (${site ?? origin}) depuis ${req.ip}`);
  res.status(403).json({ error: "Requête d'un autre site refusée" });
}
