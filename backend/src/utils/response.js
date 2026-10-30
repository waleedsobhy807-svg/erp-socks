'use strict';

// ---------------------------------------------------------------------------
// Standard CORS headers attached to every response.
// In production, narrow Access-Control-Allow-Origin to your Amplify domain.
// ---------------------------------------------------------------------------
const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Cache-Control': 'no-store',
};

// ---------------------------------------------------------------------------
// Internal builder
// ---------------------------------------------------------------------------

/**
 * Build a Lambda HTTP response object.
 *
 * @param {number} statusCode   - HTTP status code
 * @param {object|null} body    - response body (will be JSON-serialised)
 * @param {object} [extraHeaders] - additional or overriding headers
 * @returns {{ statusCode: number, headers: object, body: string }}
 */
function buildResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...BASE_HEADERS, ...extraHeaders },
    body: body !== null ? JSON.stringify(body) : '',
  };
}

// ---------------------------------------------------------------------------
// 2xx — success
// ---------------------------------------------------------------------------

/**
 * 200 OK — return a successful response with data.
 *
 * @param {*} data
 * @param {{ meta?: object }} [opts]  - optional pagination / meta envelope
 * @returns {object} Lambda response
 *
 * @example
 * return ok({ items: [...], total: 42, page: 1 });
 */
function ok(data, opts = {}) {
  const body = opts.meta ? { data, meta: opts.meta } : { data };
  return buildResponse(200, body);
}

/**
 * 201 Created — return after a successful resource creation.
 *
 * @param {*} data  - the newly created resource
 * @param {string} [location]  - optional Location header value (resource URL)
 * @returns {object} Lambda response
 *
 * @example
 * return created(newOrder, `/orders/${newOrder.id}`);
 */
function created(data, location) {
  const extraHeaders = location ? { Location: location } : {};
  return buildResponse(201, { data }, extraHeaders);
}

/**
 * 204 No Content — successful operation with no body (e.g. DELETE).
 *
 * @returns {object} Lambda response
 */
function noContent() {
  return buildResponse(204, null);
}

// ---------------------------------------------------------------------------
// 4xx — client errors
// ---------------------------------------------------------------------------

/**
 * 400 Bad Request — invalid input, validation failure, or missing fields.
 *
 * @param {string} message  - human-readable error description
 * @param {Array<{ field: string, message: string }>} [errors]  - field-level errors from Zod / manual validation
 * @returns {object} Lambda response
 *
 * @example
 * return badRequest('Validation failed', [{ field: 'qty', message: 'Must be positive' }]);
 */
function badRequest(message, errors) {
  const body = { error: 'Bad Request', message };
  if (errors && errors.length > 0) body.errors = errors;
  return buildResponse(400, body);
}

/**
 * 401 Unauthorized — missing or invalid authentication credentials.
 *
 * @param {string} [message='Authentication required']
 * @returns {object} Lambda response
 */
function unauthorized(message = 'Authentication required') {
  return buildResponse(401, { error: 'Unauthorized', message });
}

/**
 * 403 Forbidden — authenticated but lacking required permissions/roles.
 *
 * @param {string} [message='You do not have permission to perform this action']
 * @returns {object} Lambda response
 */
function forbidden(message = 'You do not have permission to perform this action') {
  return buildResponse(403, { error: 'Forbidden', message });
}

/**
 * 404 Not Found — resource does not exist.
 *
 * @param {string} [message='Resource not found']
 * @returns {object} Lambda response
 *
 * @example
 * return notFound(`Order ${id} not found`);
 */
function notFound(message = 'Resource not found') {
  return buildResponse(404, { error: 'Not Found', message });
}

/**
 * 409 Conflict — state conflict, e.g. duplicate SKU or concurrent modification.
 *
 * @param {string} message
 * @returns {object} Lambda response
 */
function conflict(message) {
  return buildResponse(409, { error: 'Conflict', message });
}

/**
 * 422 Unprocessable Entity — semantically invalid request (passes schema but
 * fails business rules, e.g. quantity exceeds stock).
 *
 * @param {string} message
 * @param {Array} [errors]
 * @returns {object} Lambda response
 */
function unprocessable(message, errors) {
  const body = { error: 'Unprocessable Entity', message };
  if (errors && errors.length > 0) body.errors = errors;
  return buildResponse(422, body);
}

/**
 * 429 Too Many Requests.
 *
 * @param {string} [message='Rate limit exceeded. Please retry later.']
 * @returns {object} Lambda response
 */
function tooManyRequests(message = 'Rate limit exceeded. Please retry later.') {
  return buildResponse(429, { error: 'Too Many Requests', message });
}

// ---------------------------------------------------------------------------
// 5xx — server errors
// ---------------------------------------------------------------------------

/**
 * 500 Internal Server Error — unexpected server-side failure.
 * Never include raw error objects or stack traces in the body; log them instead.
 *
 * @param {string} [message='An unexpected error occurred']
 * @returns {object} Lambda response
 *
 * @example
 * try {
 *   // ...
 * } catch (err) {
 *   console.error('Unhandled error', err);
 *   return serverError();
 * }
 */
function serverError(message = 'An unexpected error occurred') {
  return buildResponse(500, { error: 'Internal Server Error', message });
}

/**
 * 502 Bad Gateway — upstream dependency (external API, DB) returned an error.
 *
 * @param {string} [message='Upstream service error']
 * @returns {object} Lambda response
 */
function badGateway(message = 'Upstream service error') {
  return buildResponse(502, { error: 'Bad Gateway', message });
}

/**
 * 503 Service Unavailable — temporarily unable to handle the request.
 *
 * @param {string} [message='Service temporarily unavailable']
 * @returns {object} Lambda response
 */
function serviceUnavailable(message = 'Service temporarily unavailable') {
  return buildResponse(503, { error: 'Service Unavailable', message });
}

// ---------------------------------------------------------------------------
// Zod validation helper
// ---------------------------------------------------------------------------

/**
 * Parse and validate request body using a Zod schema.
 * Returns { success: true, data } or a ready-made badRequest() response.
 *
 * @template T
 * @param {import('zod').ZodSchema<T>} schema
 * @param {string | object} rawBody  - event.body (string) or already-parsed object
 * @returns {{ success: true, data: T } | { success: false, response: object }}
 *
 * @example
 * const result = parseBody(CreateOrderSchema, event.body);
 * if (!result.success) return result.response;
 * const { qty, sku } = result.data;
 */
function parseBody(schema, rawBody) {
  let parsed;
  try {
    parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch {
    return { success: false, response: badRequest('Request body is not valid JSON') };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return { success: false, response: badRequest('Validation failed', errors) };
  }

  return { success: true, data: result.data };
}

module.exports = {
  ok,
  created,
  noContent,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  tooManyRequests,
  serverError,
  badGateway,
  serviceUnavailable,
  parseBody,
};
