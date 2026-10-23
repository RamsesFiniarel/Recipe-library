import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";
import { pipeline } from "node:stream";
import { HttpError } from "../utils/http-error.js";
import { WEB_PAGE_MAX_BYTES, WEB_PAGE_TIMEOUT_MS } from "../config.js";

/** Fetches a page for the web recipe import: the server's only request to
 * the internet. Guarded against SSRF: public addresses only, checked on
 * the address connected to and at each redirect, usual ports, limited time
 * and size. Errors carry a `code` for the client's message: invalid-address,
 * private-address, not-found, unreachable, refused, missing, not-html (then
 * no-recipe or unreadable once parsed). */

// Not the internet: this machine, the LAN and reserved ranges (IPv4-mapped
// IPv6 is checked against the IPv4 rules).
const NOT_PUBLIC = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) {
  NOT_PUBLIC.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
]) {
  NOT_PUBLIC.addSubnet(address, prefix, "ipv6");
}

export const isPublicAddress = (address) =>
  net.isIP(address) !== 0 && !NOT_PUBLIC.check(address, net.isIPv6(address) ? "ipv6" : "ipv4");

const MAX_ADDRESS_LENGTH = 2048;
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
// An honest name, never a browser's (bot shields reject fake browsers);
// shields differ on robot names, so a second one is tried if refused.
const USER_AGENTS = ["Cuisine/1.0 (recettes familiales)", "Mozilla/5.0 (compatible; Cuisine/1.0; recettes familiales)"];
const HEADERS = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "Accept-Language": "fr,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
};
const PAGE_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain)$/i;

const privateAddress = () => new HttpError(400, "Adresse du réseau local refusée", "private-address");

/** The URL if the server may fetch it: http(s), no credentials, default
 * port, no private IP literal. A 400 otherwise. */
export function checkedUrl(address) {
  let url;
  try {
    url = new URL(address);
  } catch {
    url = null;
  }
  if (
    !url ||
    address.length > MAX_ADDRESS_LENGTH ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new HttpError(400, "Adresse invalide", "invalid-address");
  }
  // A name is checked once looked up (publicLookup); an IP never is.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host)) throw privateAddress();
  return url;
}

// DNS lookup for the connection itself: every address must be public.
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || !addresses.every(({ address }) => isPublicAddress(address))) {
      return callback(Object.assign(new Error(`${hostname}: private address`), { code: "EPRIVATE" }));
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function get(url, { signal, userAgent, cookies }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.get(url, {
      headers: { ...HEADERS, "User-Agent": userAgent, ...(cookies ? { Cookie: cookies } : {}) },
      lookup: publicLookup,
      signal,
      agent: false,
      // Some sites send long headers (policies, cookies).
      maxHeaderSize: 64 * 1024,
    });
    request.on("response", resolve);
    request.on("error", reject);
  });
}

// What the site sent, decompressed, up to WEB_PAGE_MAX_BYTES (the rest left).
async function readBody(response) {
  const encoding = String(response.headers["content-encoding"] ?? "").trim().toLowerCase();
  const decoder =
    encoding === "gzip" || encoding === "x-gzip"
      ? zlib.createGunzip()
      : encoding === "br"
        ? zlib.createBrotliDecompress()
        : encoding === "deflate"
          ? zlib.createInflate()
          : null;
  const stream = decoder ? pipeline(response, decoder, () => {}) : response;
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    size += chunk.length;
    if (size >= WEB_PAGE_MAX_BYTES) break;
  }
  response.destroy();
  return Buffer.concat(chunks).subarray(0, WEB_PAGE_MAX_BYTES);
}

// Charset from the headers or the page's first bytes, else UTF-8.
function decode(body, contentType) {
  const label =
    /charset=["']?([\w.:-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(body.subarray(0, 4096).toString("latin1"))?.[1];
  try {
    return new TextDecoder(label ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function failure(err) {
  if (err instanceof HttpError) return err;
  if (err.code === "EPRIVATE") return privateAddress();
  if (err.code === "ENOTFOUND") return new HttpError(502, "Site introuvable", "not-found");
  // Timed out, refused, cut off, a certificate that doesn't hold...
  return new HttpError(502, "Site injoignable", "unreachable");
}

// Cookies set on the way (redirect checks), sent back to the same host only.
function keepCookies(jar, url, response) {
  const set = response.headers["set-cookie"] ?? [];
  if (!set.length) return;
  const cookies = jar.get(url.hostname) ?? new Map();
  for (const line of set) {
    const [pair] = line.split(";");
    const at = pair.indexOf("=");
    if (at > 0) cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
  }
  jar.set(url.hostname, cookies);
}

const REFUSED = new Set([401, 402, 403, 429, 451]);

// One try, as `userAgent`: the response with the page, after redirects.
async function follow(address, { signal, userAgent }) {
  const jar = new Map();
  let url = checkedUrl(address);
  for (let redirects = 0; ; redirects += 1) {
    const cookies = [...(jar.get(url.hostname) ?? [])].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await get(url, { signal, userAgent, cookies });
    const status = response.statusCode;
    keepCookies(jar, url, response);
    if (REDIRECTS.has(status) && response.headers.location) {
      response.destroy();
      if (redirects === MAX_REDIRECTS) throw new HttpError(502, "Trop de redirections", "unreachable");
      url = checkedUrl(new URL(response.headers.location, url).href);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      if (status === 404 || status === 410) throw new HttpError(502, "Page introuvable sur ce site", "missing");
      if (REFUSED.has(status)) throw new HttpError(502, "Le site refuse de donner la page", "refused");
      throw new HttpError(502, "Le site ne répond pas", "unreachable");
    }
    return { response, url };
  }
}

/** The page at `address`: { html, url } (its final URL after redirects). */
export async function fetchPage(address) {
  const signal = AbortSignal.timeout(WEB_PAGE_TIMEOUT_MS);
  try {
    for (const [index, userAgent] of USER_AGENTS.entries()) {
      let found;
      try {
        found = await follow(address, { signal, userAgent });
      } catch (err) {
        if (err.code === "refused" && index < USER_AGENTS.length - 1) continue;
        throw err;
      }
      const { response, url } = found;
      const contentType = String(response.headers["content-type"] ?? "");
      if (contentType && !PAGE_TYPES.test(contentType.split(";")[0].trim())) {
        response.destroy();
        throw new HttpError(422, "Cette adresse ne mène pas à une page web", "not-html");
      }
      return { html: decode(await readBody(response), contentType), url: url.href };
    }
  } catch (err) {
    throw failure(err);
  }
}
