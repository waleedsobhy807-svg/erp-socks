/**
 * Yarn Warehouse handlers for the Socks Factory ERP.
 *
 * Covers:
 *  - Yarn item master (list with filters, get detail, create, update)
 *  - Stock transactions: receive, issue, adjust
 *  - Location management (list with item counts)
 *  - Stock summary dashboard aggregate
 *
 * All write operations require the warehouse_keeper, manager, or admin role.
 * issueYarn additionally accepts production_supervisor.
 * All read operations require any authenticated user (withAuth).
 *
 * SQL schema assumptions:
 *   warehouse.yarn_items       – yarn master (id, code, name, yarn_type, supplier_id, unit, reorder_point,
 *                                             current_stock_qty, unit_cost, location_id, is_active, deleted_at, ...)
 *   warehouse.yarn_receipts    – stock-in records  (id, yarn_item_id, qty, receipt_date, supplier_ref, notes, created_by)
 *   warehouse.yarn_issues      – stock-out records (id, yarn_item_id, qty, issued_to, issue_date, production_order_id, notes, created_by)
 *   warehouse.yarn_adjustments – adj records       (id, yarn_item_id, qty_before, qty_after, delta, reason, created_by)
 *   warehouse.locations        – (id, code, name, zone, is_active, deleted_at)
 *   warehouse.suppliers        – (id, name)
 */

import { query, transaction } from '../../db/connection.js';
import { ok, created, badRequest, notFound, serverError, conflict } from '../../utils/response.js';
import { withAuth, withRole } from '../../middleware/auth.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parsePage(qs) {
  const page  = Math.max(1, parseInt(qs.page  || '1',  10));
  const limit = Math.min(100, Math.max(1, parseInt(qs.limit || '20', 10)));
  return { page, limit, offset: (page - 1) * limit };
}

// ─── listYarnItems ────────────────────────────────────────────────────────────

async function listYarnItems(event) {
  try {
    const qs = event.queryStringParameters || {};
    const { page, limit, offset } = parsePage(qs);
    const { yarn_type, supplier, is_active, search, low_stock } = qs;

    const conditions = ['yi.deleted_at IS NULL'];
    const params     = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(yi.name ILIKE $${params.length} OR yi.code ILIKE $${params.length})`
      );
    }
    if (yarn_type) {
      params.push(yarn_type);
      conditions.push(`yi.yarn_type = $${params.length}`);
    }
    if (supplier) {
      params.push(supplier);
      conditions.push(`yi.supplier_id = $${params.length}`);
    }
    if (is_active !== undefined) {
      params.push(is_active === 'true' || is_active === '1');
      conditions.push(`yi.is_active = $${params.length}`);
    }
    if (low_stock === 'true' || low_stock === '1') {
      conditions.push('yi.current_stock_qty <= yi.reorder_point');
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM warehouse.yarn_items yi ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const dataResult = await query(
      `SELECT
         yi.id,
         yi.code,
         yi.name,
         yi.yarn_type,
         yi.supplier_id,
         s.name            AS supplier_name,
         yi.unit,
         yi.current_stock_qty,
         yi.reorder_point,
         yi.unit_cost,
         yi.location_id,
         l.name            AS location_name,
         yi.is_active,
         yi.created_at,
         yi.updated_at,
         (yi.current_stock_qty <= yi.reorder_point) AS is_low_stock
       FROM warehouse.yarn_items yi
       LEFT JOIN warehouse.suppliers s  ON s.id  = yi.supplier_id
       LEFT JOIN warehouse.locations  l ON l.id  = yi.location_id
       ${where}
       ORDER BY yi.name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return ok({ data: dataResult.rows, total, page, limit });
  } catch (err) {
    console.error('listYarnItems error', err);
    return serverError('Failed to list yarn items');
  }
}

// ─── getYarnItem ──────────────────────────────────────────────────────────────

async function getYarnItem(event) {
  try {
    const { id } = event.pathParameters || {};

    const itemResult = await query(
      `SELECT
         yi.*,
         s.name AS supplier_name,
         l.name AS location_name,
         l.zone AS location_zone
       FROM warehouse.yarn_items yi
       LEFT JOIN warehouse.suppliers s  ON s.id = yi.supplier_id
       LEFT JOIN warehouse.locations  l ON l.id = yi.location_id
       WHERE yi.id = $1 AND yi.deleted_at IS NULL`,
      [id]
    );

    if (itemResult.rows.length === 0) {
      return notFound('Yarn item not found');
    }

    const [receiptsResult, issuesResult] = await Promise.all([
      query(
        `SELECT * FROM warehouse.yarn_receipts
         WHERE yarn_item_id = $1
         ORDER BY receipt_date DESC, created_at DESC
         LIMIT 10`,
        [id]
      ),
      query(
        `SELECT * FROM warehouse.yarn_issues
         WHERE yarn_item_id = $1
         ORDER BY issue_date DESC, created_at DESC
         LIMIT 10`,
        [id]
      ),
    ]);

    return ok({
      ...itemResult.rows[0],
      recent_receipts: receiptsResult.rows,
      recent_issues:   issuesResult.rows,
    });
  } catch (err) {
    console.error('getYarnItem error', err);
    return serverError('Failed to get yarn item');
  }
}

// ─── createYarnItem ───────────────────────────────────────────────────────────

async function createYarnItem(event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const {
      code,
      name,
      yarn_type,
      supplier_id,
      unit,
      reorder_point,
      unit_cost,
      location_id,
    } = body;

    if (!code || String(code).trim() === '')      return badRequest('code is required');
    if (!name || String(name).trim() === '')      return badRequest('name is required');
    if (!yarn_type || String(yarn_type).trim() === '') return badRequest('yarn_type is required');
    if (!unit || String(unit).trim() === '')      return badRequest('unit is required');

    const dupe = await query(
      `SELECT id FROM warehouse.yarn_items WHERE code = $1 AND deleted_at IS NULL`,
      [String(code).trim().toUpperCase()]
    );
    if (dupe.rows.length > 0) {
      return badRequest(`Yarn item with code '${code}' already exists`);
    }

    const id = crypto.randomUUID();

    const result = await query(
      `INSERT INTO warehouse.yarn_items
         (id, code, name, yarn_type, supplier_id, unit, reorder_point, unit_cost, location_id, current_stock_qty)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0)
       RETURNING *`,
      [
        id,
        String(code).trim().toUpperCase(),
        String(name).trim(),
        String(yarn_type).trim(),
        supplier_id  || null,
        String(unit).trim(),
        reorder_point !== undefined ? Number(reorder_point) : 0,
        unit_cost     !== undefined ? parseFloat(unit_cost) : null,
        location_id   || null,
      ]
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('createYarnItem error', err);
    return serverError('Failed to create yarn item');
  }
}

// ─── updateYarnItem ───────────────────────────────────────────────────────────

async function updateYarnItem(event) {
  try {
    const { id } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');

    const existing = await query(
      `SELECT id FROM warehouse.yarn_items WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Yarn item not found');

    const allowed = [
      'name', 'yarn_type', 'supplier_id', 'unit',
      'reorder_point', 'unit_cost', 'location_id', 'is_active',
    ];

    const setClauses = [];
    const params     = [];

    for (const field of allowed) {
      if (body[field] !== undefined) {
        params.push(body[field]);
        setClauses.push(`${field} = $${params.length}`);
      }
    }

    if (setClauses.length === 0) return badRequest('No updatable fields provided');

    params.push(id);
    const result = await query(
      `UPDATE warehouse.yarn_items
       SET ${setClauses.join(', ')}, updated_at = now()
       WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) return notFound('Yarn item not found');

    return ok(result.rows[0]);
  } catch (err) {
    console.error('updateYarnItem error', err);
    return serverError('Failed to update yarn item');
  }
}

// ─── receiveYarn ──────────────────────────────────────────────────────────────

async function receiveYarn(event) {
  try {
    const { id } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { qty, receipt_date, supplier_ref, notes } = body;

    if (!qty || isNaN(Number(qty)) || Number(qty) <= 0) {
      return badRequest('qty must be a positive number');
    }
    if (!receipt_date) return badRequest('receipt_date is required');

    const existing = await query(
      `SELECT id FROM warehouse.yarn_items WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Yarn item not found');

    const receiptId = crypto.randomUUID();

    const result = await transaction(async (client) => {
      const receiptRow = await client.query(
        `INSERT INTO warehouse.yarn_receipts
           (id, yarn_item_id, qty, receipt_date, supplier_ref, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [receiptId, id, Number(qty), receipt_date, supplier_ref || null, notes || null, event.user.user_id]
      );

      const updatedItem = await client.query(
        `UPDATE warehouse.yarn_items
         SET current_stock_qty = current_stock_qty + $1, updated_at = now()
         WHERE id = $2
         RETURNING id, code, name, current_stock_qty`,
        [Number(qty), id]
      );

      return { receipt: receiptRow.rows[0], item: updatedItem.rows[0] };
    });

    return created(result);
  } catch (err) {
    console.error('receiveYarn error', err);
    return serverError('Failed to record yarn receipt');
  }
}

// ─── issueYarn ────────────────────────────────────────────────────────────────

async function issueYarn(event) {
  try {
    const { id } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { qty, issued_to, issue_date, production_order_id, notes } = body;

    if (!qty || isNaN(Number(qty)) || Number(qty) <= 0) {
      return badRequest('qty must be a positive number');
    }
    if (!issued_to || String(issued_to).trim() === '') {
      return badRequest('issued_to is required');
    }
    if (!issue_date) return badRequest('issue_date is required');

    const itemResult = await query(
      `SELECT id, current_stock_qty FROM warehouse.yarn_items WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (itemResult.rows.length === 0) return notFound('Yarn item not found');

    const currentQty = parseFloat(itemResult.rows[0].current_stock_qty);
    const issueQty   = Number(qty);

    if (currentQty < issueQty) {
      return conflict(
        `Insufficient stock: requested ${issueQty}, available ${currentQty}`
      );
    }

    const issueId = crypto.randomUUID();

    const result = await transaction(async (client) => {
      const issueRow = await client.query(
        `INSERT INTO warehouse.yarn_issues
           (id, yarn_item_id, qty, issued_to, issue_date, production_order_id, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          issueId, id, issueQty,
          String(issued_to).trim(),
          issue_date,
          production_order_id || null,
          notes || null,
          event.user.user_id,
        ]
      );

      const updatedItem = await client.query(
        `UPDATE warehouse.yarn_items
         SET current_stock_qty = current_stock_qty - $1, updated_at = now()
         WHERE id = $2
         RETURNING id, code, name, current_stock_qty`,
        [issueQty, id]
      );

      return { issue: issueRow.rows[0], item: updatedItem.rows[0] };
    });

    return created(result);
  } catch (err) {
    console.error('issueYarn error', err);
    return serverError('Failed to record yarn issue');
  }
}

// ─── adjustStock ──────────────────────────────────────────────────────────────

async function adjustStock(event) {
  try {
    const { id } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { new_qty, reason } = body;

    if (new_qty === undefined || isNaN(Number(new_qty)) || Number(new_qty) < 0) {
      return badRequest('new_qty must be a non-negative number');
    }
    if (!reason || String(reason).trim() === '') {
      return badRequest('reason is required');
    }

    const itemResult = await query(
      `SELECT id, current_stock_qty FROM warehouse.yarn_items WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (itemResult.rows.length === 0) return notFound('Yarn item not found');

    const qtyBefore = parseFloat(itemResult.rows[0].current_stock_qty);
    const qtyAfter  = Number(new_qty);
    const delta     = qtyAfter - qtyBefore;

    const adjustId = crypto.randomUUID();

    const result = await transaction(async (client) => {
      const adjRow = await client.query(
        `INSERT INTO warehouse.yarn_adjustments
           (id, yarn_item_id, qty_before, qty_after, delta, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [adjustId, id, qtyBefore, qtyAfter, delta, String(reason).trim(), event.user.user_id]
      );

      // Verify no negative result from concurrent ops (belt-and-suspenders)
      const updatedItem = await client.query(
        `UPDATE warehouse.yarn_items
         SET current_stock_qty = $1, updated_at = now()
         WHERE id = $2 AND current_stock_qty >= 0
         RETURNING id, code, name, current_stock_qty`,
        [qtyAfter, id]
      );

      if (updatedItem.rows.length === 0) {
        throw new Error('Stock adjustment would result in negative quantity');
      }

      return { adjustment: adjRow.rows[0], item: updatedItem.rows[0] };
    });

    return ok(result);
  } catch (err) {
    if (err.message && err.message.includes('negative quantity')) {
      return badRequest(err.message);
    }
    console.error('adjustStock error', err);
    return serverError('Failed to adjust stock');
  }
}

// ─── listLocations ────────────────────────────────────────────────────────────

async function listLocations(event) {
  try {
    const qs = event.queryStringParameters || {};
    const { is_active } = qs;

    const conditions = ['l.deleted_at IS NULL'];
    const params     = [];

    if (is_active !== undefined) {
      params.push(is_active === 'true' || is_active === '1');
      conditions.push(`l.is_active = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await query(
      `SELECT
         l.id,
         l.code,
         l.name,
         l.zone,
         l.is_active,
         l.created_at,
         COUNT(yi.id) FILTER (WHERE yi.deleted_at IS NULL)::int AS item_count
       FROM warehouse.locations l
       LEFT JOIN warehouse.yarn_items yi ON yi.location_id = l.id
       ${where}
       GROUP BY l.id
       ORDER BY l.zone, l.name`,
      params
    );

    return ok(result.rows);
  } catch (err) {
    console.error('listLocations error', err);
    return serverError('Failed to list locations');
  }
}

// ─── getStockSummary ──────────────────────────────────────────────────────────

async function getStockSummary(event) {
  try {
    const [summaryResult, byTypeResult] = await Promise.all([
      query(
        `SELECT
           COUNT(*)::int                                                   AS total_items,
           COUNT(*) FILTER (WHERE current_stock_qty <= reorder_point)::int AS low_stock_count,
           COALESCE(SUM(current_stock_qty * unit_cost), 0)                 AS total_value
         FROM warehouse.yarn_items
         WHERE deleted_at IS NULL AND is_active = TRUE`,
        []
      ),
      query(
        `SELECT
           yarn_type,
           COUNT(*)::int                     AS item_count,
           SUM(current_stock_qty)            AS total_qty,
           COALESCE(SUM(current_stock_qty * unit_cost), 0) AS total_value
         FROM warehouse.yarn_items
         WHERE deleted_at IS NULL AND is_active = TRUE
         GROUP BY yarn_type
         ORDER BY yarn_type`,
        []
      ),
    ]);

    return ok({
      ...summaryResult.rows[0],
      items_by_type: byTypeResult.rows,
    });
  } catch (err) {
    console.error('getStockSummary error', err);
    return serverError('Failed to get stock summary');
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

const WRITE_ROLES = ['admin', 'manager', 'warehouse_keeper'];

export const listYarnItemsHandler   = withAuth(listYarnItems);
export const getYarnItemHandler     = withAuth(getYarnItem);
export const createYarnItemHandler  = withRole(WRITE_ROLES, createYarnItem);
export const updateYarnItemHandler  = withRole(WRITE_ROLES, updateYarnItem);
export const receiveYarnHandler     = withRole(WRITE_ROLES, receiveYarn);
export const issueYarnHandler       = withRole([...WRITE_ROLES, 'production_supervisor'], issueYarn);
export const adjustStockHandler     = withRole(WRITE_ROLES, adjustStock);
export const listLocationsHandler   = withAuth(listLocations);
export const getStockSummaryHandler = withAuth(getStockSummary);
