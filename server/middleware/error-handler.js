import { HttpError } from "../utils/http-error.js";

export function notFoundHandler(req, res) {
  res.status(404).json({ error: "Route introuvable" });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    res.status(err.status).json(err.code ? { error: err.message, code: err.code } : { error: err.message });
    return;
  }
  // Body over its size limit: a 413, not a server failure.
  if (err.type === "entity.too.large") {
    res.status(413).json({ error: "Requête trop volumineuse" });
    return;
  }
  // Malformed JSON body: express.json() throws a SyntaxError with a status.
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    res.status(400).json({ error: "Corps de requete JSON invalide" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Erreur interne du serveur" });
}
