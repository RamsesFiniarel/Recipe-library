/** An error with an HTTP status, sent as JSON by the error handler; `code`
 * lets the client pick a message in its language. */
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}
