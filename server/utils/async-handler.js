/** Forwards rejected promises to the error handler (Express 4 doesn't). */
export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
