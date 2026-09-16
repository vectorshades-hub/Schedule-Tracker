/**
 * Wraps an async Express route handler so a rejected promise (e.g. a Mongoose
 * CastError from a malformed ID) is forwarded to next(err) instead of becoming
 * an unhandled promise rejection — which, on Node 15+, terminates the entire
 * process. This was found the hard way: an unvalidated `id` sent to
 * /editing-log/update-cell crashed the whole server for every connected user.
 * Harmless to apply even to handlers that already have their own try/catch —
 * their promise just resolves normally and this never fires.
 */
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
