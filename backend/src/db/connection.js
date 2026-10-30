'use strict';

const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Connection pool
// Lambda reuses execution environments, so the pool persists across warm
// invocations. For cold starts a new pool is created and the first query
// will establish the TCP connection to RDS.
// ---------------------------------------------------------------------------

/** @type {Pool | null} */
let pool = null;

/**
 * Returns the singleton Pool, creating it on first call.
 * All configuration is read from environment variables so that:
 *  - local dev can use a .env file
 *  - Lambda uses environment variables set via Terraform / SSM
 *
 * @returns {Pool}
 */
function getPool() {
  if (pool) return pool;

  const {
    DB_HOST,
    DB_PORT = '5432',
    DB_NAME,
    DB_USER,
    DB_PASSWORD,
    DB_SSL = 'true',
  } = process.env;

  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
    throw new Error(
      'Missing required database environment variables: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD'
    );
  }

  const sslEnabled = DB_SSL !== 'false';

  pool = new Pool({
    host: DB_HOST,
    port: parseInt(DB_PORT, 10),
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    ssl: sslEnabled ? { rejectUnauthorized: true } : false,

    // Pool sizing tuned for Lambda:
    //   - max 2 per execution environment (Lambda concurrency * 2 = actual DB connections)
    //   - idleTimeoutMillis releases connections quickly on warm-but-idle containers
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    console.error('[db] Unexpected pool error', { message: err.message });
    // Reset pool so the next invocation creates a fresh one
    pool = null;
  });

  return pool;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Execute a single parameterized query and return all rows.
 *
 * @param {string} text  - SQL query with $1, $2 … placeholders
 * @param {Array}  [params=[]] - Parameter values
 * @returns {Promise<import('pg').QueryResult>}
 *
 * @example
 * const result = await query(
 *   'SELECT * FROM inventory WHERE sku = $1',
 *   ['SOCK-BLK-M']
 * );
 * console.log(result.rows);
 */
async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await getPool().query(text, params);
    const duration = Date.now() - start;
    if (duration > 500) {
      console.warn('[db] Slow query detected', {
        duration,
        rowCount: result.rowCount,
        query: text.substring(0, 120),
      });
    }
    return result;
  } catch (err) {
    console.error('[db] Query error', {
      message: err.message,
      query: text.substring(0, 120),
      params: params.length,
    });
    throw err;
  }
}

/**
 * Execute multiple queries inside a single database transaction.
 * Automatically commits on success and rolls back on any thrown error.
 *
 * @param {function(client: import('pg').PoolClient): Promise<T>} callback
 *   Receives a pg PoolClient. Run all queries through client.query() inside
 *   this callback. The return value of the callback becomes the return value
 *   of transaction().
 * @returns {Promise<T>}
 *
 * @example
 * const result = await transaction(async (client) => {
 *   await client.query('UPDATE inventory SET qty = qty - $1 WHERE id = $2', [10, itemId]);
 *   const order = await client.query(
 *     'INSERT INTO orders (item_id, qty) VALUES ($1, $2) RETURNING *',
 *     [itemId, 10]
 *   );
 *   return order.rows[0];
 * });
 */
async function transaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[db] Transaction rolled back', { message: err.message });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully end the pool. Call this in Lambda shutdown hooks or tests.
 * @returns {Promise<void>}
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { query, transaction, closePool, getPool };
