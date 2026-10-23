import { http } from "./http.js";

/** The tags added by hand in the settings (see server/routes/tags.routes.js). */
export const tagsApi = {
  list: () => http.get("/tags"),
  create: (label) => http.post("/tags", { label }),
  remove: (key) => http.del(`/tags/${encodeURIComponent(key)}`),
};
