import { t } from "../../shared/i18n/i18n.js";

/** An error with the HTTP status (pages branch on 404) and the server's
 * `code`, if any. */
export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// `body` goes as JSON, `file` (a Blob) as it is.
async function request(path, { body, file, ...options } = {}) {
  const sent =
    file !== undefined
      ? { body: file, headers: { "Content-Type": "application/octet-stream" } }
      : body !== undefined
        ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
        : {};
  const response = await fetch(`/api${path}`, { ...options, ...sent });

  if (response.status === 204) return null;

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? t("common.error"), payload?.code);
  }
  return payload;
}

export const http = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  del: (path) => request(path, { method: "DELETE" }),
  upload: (path, file) => request(path, { method: "POST", file }),
};
