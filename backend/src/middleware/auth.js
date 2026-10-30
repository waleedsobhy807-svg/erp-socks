'use strict';

const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');

// ---------------------------------------------------------------------------
// JWKS client — cached for the Lambda execution environment lifetime so that
// warm invocations skip the network round-trip to the Cognito JWKS endpoint.
// ---------------------------------------------------------------------------

/** @type {import('jwks-rsa').JwksClient | null} */
let cachedJwksClient = null;

/**
 * Returns a memoized JwksClient pointed at the Cognito User Pool JWKS endpoint.
 * @returns {import('jwks-rsa').JwksClient}
 */
function getJwksClient() {
  if (cachedJwksClient) return cachedJwksClient;

  const { COGNITO_USER_POOL_ID, AWS_REGION } = process.env;

  if (!COGNITO_USER_POOL_ID || !AWS_REGION) {
    throw new Error(
      'Missing required environment variables: COGNITO_USER_POOL_ID, AWS_REGION'
    );
  }

  const jwksUri = `https://cognito-idp.${AWS_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}/.well-known/jwks.json`;

  cachedJwksClient = jwksClient({
    jwksUri,
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 10 * 60 * 1000, // 10 minutes
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });

  return cachedJwksClient;
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve the public signing key for a given JWT key ID from the JWKS endpoint.
 * @param {string} kid
 * @returns {Promise<string>} PEM-encoded public key
 */
function getSigningKey(kid) {
  return new Promise((resolve, reject) => {
    getJwksClient().getSigningKey(kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

/**
 * Decode the JWT header to extract the key ID (kid) without verifying the
 * signature. We need the kid before we can fetch the right JWKS key.
 *
 * @param {string} token
 * @returns {{ kid: string, alg: string }}
 */
function decodeHeader(token) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || !decoded.header || !decoded.header.kid) {
    throw new Error('Invalid token: missing kid in header');
  }
  return decoded.header;
}

/**
 * Fully verify a Cognito-issued JWT (ID or Access token).
 *
 * @param {string} token
 * @returns {Promise<import('jsonwebtoken').JwtPayload>} verified claims
 */
async function verifyToken(token) {
  const { COGNITO_USER_POOL_ID, AWS_REGION } = process.env;
  const expectedIssuer = `https://cognito-idp.${AWS_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;

  const header = decodeHeader(token);
  const signingKey = await getSigningKey(header.kid);

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      signingKey,
      {
        algorithms: ['RS256'],
        issuer: expectedIssuer,
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Role extraction
// ---------------------------------------------------------------------------

/**
 * Extract Cognito group memberships from a verified JWT payload.
 * Cognito stores groups under the "cognito:groups" claim.
 *
 * @param {import('jsonwebtoken').JwtPayload} claims
 * @returns {string[]} array of group names, e.g. ["erp-admins", "erp-staff"]
 */
function extractRoles(claims) {
  return Array.isArray(claims['cognito:groups']) ? claims['cognito:groups'] : [];
}

// ---------------------------------------------------------------------------
// Lambda middleware
// ---------------------------------------------------------------------------

/**
 * Lambda middleware that authenticates the incoming request using a Cognito
 * JWT from the `Authorization: Bearer <token>` header.
 *
 * On success it attaches an `event.user` object:
 * ```
 * {
 *   user_id:  string,   // Cognito sub (UUID)
 *   email:    string,
 *   roles:    string[], // cognito:groups
 *   claims:   object,   // full verified JWT payload
 * }
 * ```
 *
 * On failure it returns a 401 response immediately without calling the handler.
 *
 * Usage — wrap a Lambda handler:
 * ```js
 * const { withAuth } = require('./middleware/auth');
 * const { ok } = require('./utils/response');
 *
 * exports.handler = withAuth(async (event) => {
 *   const { user_id, roles } = event.user;
 *   return ok({ user_id, roles });
 * });
 * ```
 *
 * @param {function(event: object, context: object): Promise<object>} handler
 * @returns {function(event: object, context: object): Promise<object>}
 */
function withAuth(handler) {
  return async (event, context) => {
    try {
      // Support both HTTP API (v2) and REST API (v1) header shapes
      const headers = event.headers || {};
      const authHeader =
        headers['Authorization'] || headers['authorization'] || '';

      if (!authHeader.startsWith('Bearer ')) {
        return unauthorizedResponse('Missing or malformed Authorization header');
      }

      const token = authHeader.slice(7).trim();
      if (!token) {
        return unauthorizedResponse('Empty bearer token');
      }

      const claims = await verifyToken(token);

      // Attach parsed identity to the event for downstream handlers
      event.user = {
        user_id: claims.sub,
        email: claims.email || claims['cognito:username'] || '',
        roles: extractRoles(claims),
        claims,
      };

      return handler(event, context);
    } catch (err) {
      if (
        err.name === 'TokenExpiredError' ||
        err.name === 'JsonWebTokenError' ||
        err.name === 'NotBeforeError'
      ) {
        return unauthorizedResponse(`Token invalid: ${err.message}`);
      }

      console.error('[auth] Unexpected error during token verification', {
        message: err.message,
        name: err.name,
      });

      // Do not leak internal error details to the caller
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Internal authentication error' }),
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Role-based access helpers
// ---------------------------------------------------------------------------

/**
 * Returns a middleware that also enforces group membership.
 * Use instead of `withAuth` when a route is restricted to specific roles.
 *
 * @param {string | string[]} requiredRoles  - one or more Cognito group names
 * @param {function} handler
 * @returns {function}
 *
 * @example
 * exports.handler = withRole('erp-admins', async (event) => {
 *   // only erp-admins reach here
 * });
 */
function withRole(requiredRoles, handler) {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];

  return withAuth(async (event, context) => {
    const userRoles = event.user.roles;
    const hasRole = roles.some((r) => userRoles.includes(r));

    if (!hasRole) {
      return {
        statusCode: 403,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: 'Forbidden',
          message: `Requires one of: ${roles.join(', ')}`,
        }),
      };
    }

    return handler(event, context);
  });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}

function unauthorizedResponse(message) {
  return {
    statusCode: 401,
    headers: corsHeaders(),
    body: JSON.stringify({ error: 'Unauthorized', message }),
  };
}

module.exports = { withAuth, withRole, verifyToken, extractRoles };
