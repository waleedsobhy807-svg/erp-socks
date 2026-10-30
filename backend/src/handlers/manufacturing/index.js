/**
 * @module manufacturing
 * @description Lambda handlers for manufacturing work-order management in the Socks Factory ERP.
 *
 * Covers the full lifecycle of a work order:
 *   pending → in_progress → completed | cancelled
 *
 * All reads are protected with `withAuth`.
 * All writes require `withRole(['admin','manager','production_supervisor'])`.
 * SQL is parameterised throughout; soft-deletes are used where applicable.
 * Pagination uses `page` / `limit` query-string params (defaults: page=1, limit=20).
 *
 * Tables referenced (schema: manufacturing):
 *   work_orders, work_order_steps, machine_assignments, production_logs
 * Tables referenced (schema: production):
 *   production_orders
 * Tables referenced (schema: inventory):
 *   machines
 */

import { query, transaction } from '../../db/connection.js';
import { ok, created, badRequest, notFound, serverError } from '../../utils/response.js';
import { withAuth, withRole } from '../../middleware/auth.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const SUPERVISOR_ROLES = ['admin', 'manager', 'production_supervisor'];

function parsePage(qs) {
  const page  = Math.max(1, parseInt(qs?.page  ?? '1',  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(qs?.limit ?? '20', 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

// ─── 1. listWorkOrders ───────────────────────────────────────────────────────

/**
 * GET /manufacturing
 * Query params: status, production_order_id, machine_id, date_from, date_to, page, limit
 */
export const listWorkOrders = withAuth(async (event) => {
  try {
    const qs = event.queryStringParameters ?? {};
    const { page, limit, offset } = parsePage(qs);

    const conditions = ['wo.deleted_at IS NULL'];
    const params     = [];

    if (qs.status) {
      params.push(qs.status);
      conditions.push(`wo.status = $${params.length}`);
    }
    if (qs.production_order_id) {
      params.push(qs.production_order_id);
      conditions.push(`wo.production_order_id = $${params.length}`);
    }
    if (qs.machine_id) {
      params.push(qs.machine_id);
      conditions.push(`wo.machine_id = $${params.length}`);
    }
    if (qs.date_from) {
      params.push(qs.date_from);
      conditions.push(`wo.planned_start >= $${params.length}`);
    }
    if (qs.date_to) {
      params.push(qs.date_to);
      conditions.push(`wo.planned_start <= $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total
         FROM manufacturing.work_orders wo
        WHERE ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const rows = await query(
      `SELECT
            wo.id,
            wo.status,
            wo.planned_start,
            wo.planned_end,
            wo.actual_start,
            wo.actual_end,
            wo.planned_qty_pairs,
            wo.produced_qty,
            wo.rejected_qty,
            wo.created_at,
            po.order_no        AS production_order_no,
            po.id              AS production_order_id,
            m.name             AS machine_name,
            m.id               AS machine_id
         FROM manufacturing.work_orders wo
         LEFT JOIN production.production_orders po ON po.id = wo.production_order_id
         LEFT JOIN inventory.machines           m  ON m.id  = wo.machine_id
        WHERE ${where}
        ORDER BY wo.planned_start DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return ok({
      data:       rows.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('listWorkOrders error', err);
    return serverError('Failed to list work orders');
  }
});

// ─── 2. getWorkOrder ─────────────────────────────────────────────────────────

/**
 * GET /manufacturing/{id}
 */
export const getWorkOrder = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing work order id');

    const woResult = await query(
      `SELECT
            wo.*,
            po.order_no  AS production_order_no,
            m.name       AS machine_name
         FROM manufacturing.work_orders wo
         LEFT JOIN production.production_orders po ON po.id = wo.production_order_id
         LEFT JOIN inventory.machines           m  ON m.id  = wo.machine_id
        WHERE wo.id = $1 AND wo.deleted_at IS NULL`,
      [id]
    );
    if (woResult.rows.length === 0) return notFound('Work order not found');

    const workOrder = woResult.rows[0];

    const [stepsResult, assignmentsResult, logsResult] = await Promise.all([
      query(
        `SELECT * FROM manufacturing.work_order_steps
          WHERE work_order_id = $1
          ORDER BY step_order ASC`,
        [id]
      ),
      query(
        `SELECT ma.*, m.name AS machine_name
           FROM manufacturing.machine_assignments ma
           LEFT JOIN inventory.machines m ON m.id = ma.machine_id
          WHERE ma.work_order_id = $1
          ORDER BY ma.assigned_from ASC`,
        [id]
      ),
      query(
        `SELECT pl.*, e.full_name AS operator_name
           FROM manufacturing.production_logs pl
           LEFT JOIN employees.employees e ON e.id = pl.operator_id
          WHERE pl.work_order_id = $1
          ORDER BY pl.logged_at ASC`,
        [id]
      ),
    ]);

    workOrder.steps              = stepsResult.rows;
    workOrder.machine_assignments = assignmentsResult.rows;
    workOrder.production_logs    = logsResult.rows;

    return ok(workOrder);
  } catch (err) {
    console.error('getWorkOrder error', err);
    return serverError('Failed to retrieve work order');
  }
});

// ─── 3. createWorkOrder ──────────────────────────────────────────────────────

/**
 * POST /manufacturing
 * Body: production_order_id, line_id, machine_id, planned_start, planned_end,
 *       planned_qty_pairs, notes
 */
export const createWorkOrder = withRole(SUPERVISOR_ROLES)(async (event) => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const { production_order_id, line_id, machine_id, planned_start, planned_end, planned_qty_pairs, notes } = body;

    if (!production_order_id) return badRequest('production_order_id is required');
    if (!planned_start)        return badRequest('planned_start is required');
    if (!planned_end)          return badRequest('planned_end is required');
    if (!planned_qty_pairs)    return badRequest('planned_qty_pairs is required');

    // Validate production order status
    const poResult = await query(
      `SELECT id, status FROM production.production_orders
        WHERE id = $1 AND deleted_at IS NULL`,
      [production_order_id]
    );
    if (poResult.rows.length === 0) return notFound('Production order not found');
    const poStatus = poResult.rows[0].status;
    if (!['confirmed', 'scheduled'].includes(poStatus)) {
      return badRequest(`Production order must be confirmed or scheduled (current: ${poStatus})`);
    }

    const result = await query(
      `INSERT INTO manufacturing.work_orders
            (production_order_id, line_id, machine_id, planned_start, planned_end,
             planned_qty_pairs, notes, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW(), NOW())
       RETURNING *`,
      [production_order_id, line_id ?? null, machine_id ?? null,
       planned_start, planned_end, planned_qty_pairs, notes ?? null]
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('createWorkOrder error', err);
    return serverError('Failed to create work order');
  }
});

// ─── 4. startWorkOrder ───────────────────────────────────────────────────────

/**
 * POST /manufacturing/{id}/start
 */
export const startWorkOrder = withRole(SUPERVISOR_ROLES)(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing work order id');

    const existing = await query(
      `SELECT id, status FROM manufacturing.work_orders
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Work order not found');
    if (existing.rows[0].status !== 'pending') {
      return badRequest(`Work order must be pending to start (current: ${existing.rows[0].status})`);
    }

    const result = await query(
      `UPDATE manufacturing.work_orders
          SET status = 'in_progress', actual_start = NOW(), updated_at = NOW()
        WHERE id = $1
       RETURNING *`,
      [id]
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('startWorkOrder error', err);
    return serverError('Failed to start work order');
  }
});

// ─── 5. logProduction ────────────────────────────────────────────────────────

/**
 * POST /manufacturing/{id}/log
 * Body: logged_at, qty_produced, qty_rejected, operator_id, notes
 */
export const logProduction = withRole(SUPERVISOR_ROLES)(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing work order id');

    const body = JSON.parse(event.body ?? '{}');
    const { logged_at, qty_produced, qty_rejected = 0, operator_id, notes } = body;

    if (!logged_at)    return badRequest('logged_at is required');
    if (qty_produced == null) return badRequest('qty_produced is required');

    const existing = await query(
      `SELECT id, status FROM manufacturing.work_orders
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Work order not found');
    if (existing.rows[0].status !== 'in_progress') {
      return badRequest(`Work order must be in_progress to log production (current: ${existing.rows[0].status})`);
    }

    let logRow;
    await transaction(async (client) => {
      const logResult = await client.query(
        `INSERT INTO manufacturing.production_logs
              (work_order_id, logged_at, qty_produced, qty_rejected, operator_id, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING *`,
        [id, logged_at, qty_produced, qty_rejected, operator_id ?? null, notes ?? null]
      );
      logRow = logResult.rows[0];

      await client.query(
        `UPDATE manufacturing.work_orders
            SET produced_qty  = COALESCE(produced_qty,  0) + $1,
                rejected_qty  = COALESCE(rejected_qty,  0) + $2,
                updated_at    = NOW()
          WHERE id = $3`,
        [qty_produced, qty_rejected, id]
      );
    });

    return created(logRow);
  } catch (err) {
    console.error('logProduction error', err);
    return serverError('Failed to log production');
  }
});

// ─── 6. completeWorkOrder ────────────────────────────────────────────────────

/**
 * POST /manufacturing/{id}/complete
 * Body: actual_end, final_qty_produced, final_qty_rejected, notes
 */
export const completeWorkOrder = withRole(SUPERVISOR_ROLES)(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing work order id');

    const body = JSON.parse(event.body ?? '{}');
    const { actual_end, final_qty_produced, final_qty_rejected = 0, notes } = body;

    if (!actual_end)             return badRequest('actual_end is required');
    if (final_qty_produced == null) return badRequest('final_qty_produced is required');

    const existing = await query(
      `SELECT id, status FROM manufacturing.work_orders
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Work order not found');
    if (existing.rows[0].status !== 'in_progress') {
      return badRequest(`Work order must be in_progress to complete (current: ${existing.rows[0].status})`);
    }

    let updated;
    await transaction(async (client) => {
      const result = await client.query(
        `UPDATE manufacturing.work_orders
            SET status             = 'completed',
                actual_end         = $1,
                produced_qty       = $2,
                rejected_qty       = $3,
                notes              = COALESCE($4, notes),
                updated_at         = NOW()
          WHERE id = $5
         RETURNING *`,
        [actual_end, final_qty_produced, final_qty_rejected, notes ?? null, id]
      );
      updated = result.rows[0];
    });

    return ok(updated);
  } catch (err) {
    console.error('completeWorkOrder error', err);
    return serverError('Failed to complete work order');
  }
});

// ─── 7. cancelWorkOrder ──────────────────────────────────────────────────────

/**
 * POST /manufacturing/{id}/cancel
 * Body: reason
 */
export const cancelWorkOrder = withRole(['admin', 'manager'])(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing work order id');

    const body = JSON.parse(event.body ?? '{}');
    const { reason } = body;
    if (!reason) return badRequest('reason is required');

    const existing = await query(
      `SELECT id, status FROM manufacturing.work_orders
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Work order not found');
    if (existing.rows[0].status === 'completed') {
      return badRequest('Cannot cancel a completed work order');
    }

    const result = await query(
      `UPDATE manufacturing.work_orders
          SET status     = 'cancelled',
              notes      = COALESCE(notes || ' | Cancel reason: ' || $1, $1),
              updated_at = NOW()
        WHERE id = $2
       RETURNING *`,
      [reason, id]
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('cancelWorkOrder error', err);
    return serverError('Failed to cancel work order');
  }
});

// ─── 8. assignMachine ────────────────────────────────────────────────────────

/**
 * POST /manufacturing/{id}/assign-machine
 * Body: machine_id, assigned_from, assigned_to
 */
export const assignMachine = withRole(SUPERVISOR_ROLES)(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing work order id');

    const body = JSON.parse(event.body ?? '{}');
    const { machine_id, assigned_from, assigned_to } = body;

    if (!machine_id)    return badRequest('machine_id is required');
    if (!assigned_from) return badRequest('assigned_from is required');

    const existing = await query(
      `SELECT id FROM manufacturing.work_orders
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Work order not found');

    const result = await query(
      `INSERT INTO manufacturing.machine_assignments
            (work_order_id, machine_id, assigned_from, assigned_to, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [id, machine_id, assigned_from, assigned_to ?? null]
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('assignMachine error', err);
    return serverError('Failed to assign machine');
  }
});

// ─── 9. listProductionLogs ───────────────────────────────────────────────────

/**
 * GET /manufacturing/{id}/logs
 * Query params: page, limit
 */
export const listProductionLogs = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing work order id');

    const qs = event.queryStringParameters ?? {};
    const { page, limit, offset } = parsePage(qs);

    const existing = await query(
      `SELECT id FROM manufacturing.work_orders
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Work order not found');

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM manufacturing.production_logs WHERE work_order_id = $1`,
      [id]
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const rows = await query(
      `SELECT pl.*, e.full_name AS operator_name
         FROM manufacturing.production_logs pl
         LEFT JOIN employees.employees e ON e.id = pl.operator_id
        WHERE pl.work_order_id = $1
        ORDER BY pl.logged_at DESC
        LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    return ok({
      data:       rows.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('listProductionLogs error', err);
    return serverError('Failed to list production logs');
  }
});

// ─── 10. getProductionSummary ─────────────────────────────────────────────────

/**
 * GET /manufacturing/summary
 * Returns dashboard-level metrics for the current day and active work orders.
 */
export const getProductionSummary = withAuth(async (event) => {
  try {
    const [activeResult, completedTodayResult, pairsResult, efficiencyResult, topMachinesResult] =
      await Promise.all([
        query(
          `SELECT COUNT(*) AS active_work_orders
             FROM manufacturing.work_orders
            WHERE status = 'in_progress' AND deleted_at IS NULL`,
          []
        ),
        query(
          `SELECT COUNT(*) AS completed_today
             FROM manufacturing.work_orders
            WHERE status = 'completed'
              AND actual_end::date = CURRENT_DATE
              AND deleted_at IS NULL`,
          []
        ),
        query(
          `SELECT COALESCE(SUM(produced_qty), 0) AS total_pairs_today
             FROM manufacturing.work_orders
            WHERE actual_end::date = CURRENT_DATE
              AND deleted_at IS NULL`,
          []
        ),
        query(
          `SELECT
                ROUND(
                  CASE WHEN SUM(planned_qty_pairs) = 0 THEN 0
                       ELSE SUM(produced_qty)::numeric / SUM(planned_qty_pairs) * 100
                  END, 2
                ) AS avg_efficiency_pct
             FROM manufacturing.work_orders
            WHERE status IN ('in_progress', 'completed')
              AND deleted_at IS NULL`,
          []
        ),
        query(
          `SELECT
                m.id,
                m.name AS machine_name,
                SUM(wo.produced_qty) AS total_produced
             FROM manufacturing.work_orders wo
             JOIN inventory.machines m ON m.id = wo.machine_id
            WHERE wo.deleted_at IS NULL
              AND wo.actual_end::date = CURRENT_DATE
            GROUP BY m.id, m.name
            ORDER BY total_produced DESC
            LIMIT 5`,
          []
        ),
      ]);

    return ok({
      active_work_orders:    parseInt(activeResult.rows[0].active_work_orders, 10),
      completed_today:       parseInt(completedTodayResult.rows[0].completed_today, 10),
      total_pairs_today:     parseInt(pairsResult.rows[0].total_pairs_today, 10),
      avg_efficiency_pct:    parseFloat(efficiencyResult.rows[0].avg_efficiency_pct ?? 0),
      top_machines_by_output: topMachinesResult.rows,
    });
  } catch (err) {
    console.error('getProductionSummary error', err);
    return serverError('Failed to retrieve production summary');
  }
});
