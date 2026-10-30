/**
 * Production Planning handlers for the Socks Factory ERP.
 *
 * Covers:
 *  - Production order lifecycle (list, get, create, update, confirm, cancel)
 *  - Scheduling (schedule an order, capacity plan list, schedule calendar)
 *
 * All reads require any authenticated user (withAuth).
 * Writes require admin, manager, or production_supervisor role.
 *
 * SQL schema assumptions:
 *   planning.production_orders      – (id, order_ref, customer_id, status, required_by_date,
 *                                      priority, notes, reason_cancelled, deleted_at, ...)
 *   planning.production_order_lines – (id, production_order_id, product_id, qty, unit, notes)
 *   planning.order_schedules        – (id, production_order_id, start_date, end_date, notes, created_by)
 *   planning.schedule_machines      – (schedule_id, machine_id)
 *   planning.capacity_plans         – (id, machine_id, week_start, planned_hours, actual_hours)
 *   customers.customer_master       – (id, name)
 *   products.product_master         – (id, name, sku)
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

const EDITABLE_STATUSES = ['draft', 'confirmed'];
const TERMINAL_STATUSES = ['completed', 'cancelled'];

// ─── listProductionOrders ─────────────────────────────────────────────────────

async function listProductionOrders(event) {
  try {
    const qs = event.queryStringParameters || {};
    const { page, limit, offset } = parsePage(qs);
    const { status, customer_id, product_id, date_from, date_to } = qs;

    const conditions = ['po.deleted_at IS NULL'];
    const params     = [];

    if (status) {
      params.push(status);
      conditions.push(`po.status = $${params.length}`);
    }
    if (customer_id) {
      params.push(customer_id);
      conditions.push(`po.customer_id = $${params.length}`);
    }
    if (product_id) {
      params.push(product_id);
      conditions.push(
        `EXISTS (
           SELECT 1 FROM planning.production_order_lines pol
           WHERE pol.production_order_id = po.id AND pol.product_id = $${params.length}
         )`
      );
    }
    if (date_from) {
      params.push(date_from);
      conditions.push(`po.required_by_date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`po.required_by_date <= $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM planning.production_orders po ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const dataResult = await query(
      `SELECT
         po.id,
         po.order_ref,
         po.customer_id,
         c.name            AS customer_name,
         po.status,
         po.required_by_date,
         po.priority,
         po.notes,
         po.created_at,
         po.updated_at,
         COUNT(pol.id)::int AS line_count
       FROM planning.production_orders po
       LEFT JOIN customers.customer_master       c   ON c.id  = po.customer_id
       LEFT JOIN planning.production_order_lines pol ON pol.production_order_id = po.id
       ${where}
       GROUP BY po.id, c.name
       ORDER BY po.required_by_date ASC, po.priority DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return ok({ data: dataResult.rows, total, page, limit });
  } catch (err) {
    console.error('listProductionOrders error', err);
    return serverError('Failed to list production orders');
  }
}

// ─── getProductionOrder ───────────────────────────────────────────────────────

async function getProductionOrder(event) {
  try {
    const { id } = event.pathParameters || {};

    const orderResult = await query(
      `SELECT
         po.*,
         c.name AS customer_name
       FROM planning.production_orders po
       LEFT JOIN customers.customer_master c ON c.id = po.customer_id
       WHERE po.id = $1 AND po.deleted_at IS NULL`,
      [id]
    );

    if (orderResult.rows.length === 0) return notFound('Production order not found');

    const linesResult = await query(
      `SELECT
         pol.*,
         p.name AS product_name,
         p.sku  AS product_sku
       FROM planning.production_order_lines pol
       LEFT JOIN products.product_master p ON p.id = pol.product_id
       WHERE pol.production_order_id = $1
       ORDER BY pol.created_at`,
      [id]
    );

    const scheduleResult = await query(
      `SELECT
         os.*,
         ARRAY_AGG(sm.machine_id) FILTER (WHERE sm.machine_id IS NOT NULL) AS machine_ids
       FROM planning.order_schedules os
       LEFT JOIN planning.schedule_machines sm ON sm.schedule_id = os.id
       WHERE os.production_order_id = $1
       GROUP BY os.id
       ORDER BY os.start_date`,
      [id]
    );

    return ok({
      ...orderResult.rows[0],
      order_lines: linesResult.rows,
      schedules:   scheduleResult.rows,
    });
  } catch (err) {
    console.error('getProductionOrder error', err);
    return serverError('Failed to get production order');
  }
}

// ─── createProductionOrder ────────────────────────────────────────────────────

async function createProductionOrder(event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { customer_id, order_ref, required_by_date, priority, notes, lines } = body;

    if (!customer_id)                                     return badRequest('customer_id is required');
    if (!order_ref || String(order_ref).trim() === '')    return badRequest('order_ref is required');
    if (!required_by_date)                                return badRequest('required_by_date is required');
    if (!Array.isArray(lines) || lines.length === 0)      return badRequest('lines must be a non-empty array');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.product_id)                               return badRequest(`lines[${i}].product_id is required`);
      if (!line.qty || isNaN(Number(line.qty)) || Number(line.qty) <= 0)
                                                          return badRequest(`lines[${i}].qty must be a positive number`);
      if (!line.unit || String(line.unit).trim() === '')  return badRequest(`lines[${i}].unit is required`);
    }

    // Validate customer exists
    const customerCheck = await query(
      `SELECT id FROM customers.customer_master WHERE id = $1 AND deleted_at IS NULL`,
      [customer_id]
    );
    if (customerCheck.rows.length === 0) return notFound('Customer not found');

    // Validate all products exist
    const productIds = [...new Set(lines.map((l) => l.product_id))];
    const productCheck = await query(
      `SELECT id FROM products.product_master
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [productIds]
    );
    if (productCheck.rows.length < productIds.length) {
      return notFound('One or more products not found');
    }

    // Check order_ref uniqueness
    const refDupe = await query(
      `SELECT id FROM planning.production_orders WHERE order_ref = $1 AND deleted_at IS NULL`,
      [String(order_ref).trim()]
    );
    if (refDupe.rows.length > 0) {
      return badRequest(`Production order with ref '${order_ref}' already exists`);
    }

    const orderId = crypto.randomUUID();

    const result = await transaction(async (client) => {
      const orderRow = await client.query(
        `INSERT INTO planning.production_orders
           (id, customer_id, order_ref, status, required_by_date, priority, notes, created_by)
         VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7)
         RETURNING *`,
        [
          orderId,
          customer_id,
          String(order_ref).trim(),
          required_by_date,
          priority || 'normal',
          notes || null,
          event.user.user_id,
        ]
      );

      const insertedLines = [];
      for (const line of lines) {
        const lineId = crypto.randomUUID();
        const lineRow = await client.query(
          `INSERT INTO planning.production_order_lines
             (id, production_order_id, product_id, qty, unit, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            lineId,
            orderId,
            line.product_id,
            Number(line.qty),
            String(line.unit).trim(),
            line.notes || null,
          ]
        );
        insertedLines.push(lineRow.rows[0]);
      }

      return { ...orderRow.rows[0], order_lines: insertedLines };
    });

    return created(result);
  } catch (err) {
    console.error('createProductionOrder error', err);
    return serverError('Failed to create production order');
  }
}

// ─── updateProductionOrder ────────────────────────────────────────────────────

async function updateProductionOrder(event) {
  try {
    const { id } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');

    const existing = await query(
      `SELECT id, status FROM planning.production_orders WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Production order not found');

    const { status } = existing.rows[0];
    if (!EDITABLE_STATUSES.includes(status)) {
      return conflict(`Cannot update a production order in '${status}' status`);
    }

    const allowed = ['required_by_date', 'priority', 'notes', 'order_ref'];
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
      `UPDATE planning.production_orders
       SET ${setClauses.join(', ')}, updated_at = now()
       WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) return notFound('Production order not found');

    return ok(result.rows[0]);
  } catch (err) {
    console.error('updateProductionOrder error', err);
    return serverError('Failed to update production order');
  }
}

// ─── confirmOrder ─────────────────────────────────────────────────────────────

async function confirmOrder(event) {
  try {
    const { id } = event.pathParameters || {};

    const orderResult = await query(
      `SELECT id, status FROM planning.production_orders WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (orderResult.rows.length === 0) return notFound('Production order not found');

    const { status } = orderResult.rows[0];
    if (status !== 'draft') {
      return conflict(`Order must be in 'draft' status to confirm; current status: '${status}'`);
    }

    const linesCheck = await query(
      `SELECT COUNT(*) AS cnt FROM planning.production_order_lines WHERE production_order_id = $1`,
      [id]
    );
    if (parseInt(linesCheck.rows[0].cnt, 10) === 0) {
      return badRequest('Cannot confirm an order with no lines');
    }

    const result = await query(
      `UPDATE planning.production_orders
       SET status = 'confirmed', updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('confirmOrder error', err);
    return serverError('Failed to confirm production order');
  }
}

// ─── cancelOrder ──────────────────────────────────────────────────────────────

async function cancelOrder(event) {
  try {
    const { id } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { reason } = body;

    if (!reason || String(reason).trim() === '') {
      return badRequest('reason is required');
    }

    const orderResult = await query(
      `SELECT id, status FROM planning.production_orders WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (orderResult.rows.length === 0) return notFound('Production order not found');

    const { status } = orderResult.rows[0];
    if (TERMINAL_STATUSES.includes(status)) {
      return conflict(`Cannot cancel a production order that is already '${status}'`);
    }

    const result = await query(
      `UPDATE planning.production_orders
       SET status = 'cancelled', reason_cancelled = $1, updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [String(reason).trim(), id]
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('cancelOrder error', err);
    return serverError('Failed to cancel production order');
  }
}

// ─── scheduleOrder ────────────────────────────────────────────────────────────

async function scheduleOrder(event) {
  try {
    const { id } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { start_date, end_date, machine_ids, notes } = body;

    if (!start_date)                                                  return badRequest('start_date is required');
    if (!end_date)                                                    return badRequest('end_date is required');
    if (new Date(start_date) > new Date(end_date))                    return badRequest('start_date must be before end_date');
    if (!Array.isArray(machine_ids) || machine_ids.length === 0)      return badRequest('machine_ids must be a non-empty array');

    const orderResult = await query(
      `SELECT id, status FROM planning.production_orders WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (orderResult.rows.length === 0) return notFound('Production order not found');

    const { status } = orderResult.rows[0];
    if (status === 'cancelled' || status === 'completed') {
      return conflict(`Cannot schedule a production order in '${status}' status`);
    }
    if (status === 'draft') {
      return conflict(`Order must be confirmed before scheduling; confirm it first`);
    }

    const scheduleId = crypto.randomUUID();

    const result = await transaction(async (client) => {
      const scheduleRow = await client.query(
        `INSERT INTO planning.order_schedules
           (id, production_order_id, start_date, end_date, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [scheduleId, id, start_date, end_date, notes || null, event.user.user_id]
      );

      for (const machineId of machine_ids) {
        await client.query(
          `INSERT INTO planning.schedule_machines (schedule_id, machine_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [scheduleId, machineId]
        );
      }

      await client.query(
        `UPDATE planning.production_orders
         SET status = 'scheduled', updated_at = now()
         WHERE id = $1`,
        [id]
      );

      return { ...scheduleRow.rows[0], machine_ids };
    });

    return created(result);
  } catch (err) {
    console.error('scheduleOrder error', err);
    return serverError('Failed to schedule production order');
  }
}

// ─── listCapacityPlans ────────────────────────────────────────────────────────

async function listCapacityPlans(event) {
  try {
    const qs = event.queryStringParameters || {};
    const { week_start, machine_id } = qs;

    const conditions = [];
    const params     = [];

    if (week_start) {
      params.push(week_start);
      conditions.push(`cp.week_start = $${params.length}`);
    }
    if (machine_id) {
      params.push(machine_id);
      conditions.push(`cp.machine_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT
         cp.id,
         cp.machine_id,
         cp.week_start,
         cp.planned_hours,
         cp.actual_hours,
         CASE
           WHEN cp.planned_hours = 0 THEN NULL
           ELSE ROUND((cp.actual_hours / cp.planned_hours) * 100, 2)
         END AS utilization_pct
       FROM planning.capacity_plans cp
       ${where}
       ORDER BY cp.week_start, cp.machine_id`,
      params
    );

    return ok(result.rows);
  } catch (err) {
    console.error('listCapacityPlans error', err);
    return serverError('Failed to list capacity plans');
  }
}

// ─── getScheduleCalendar ──────────────────────────────────────────────────────

async function getScheduleCalendar(event) {
  try {
    const qs = event.queryStringParameters || {};
    const { date_from, date_to } = qs;

    if (!date_from) return badRequest('date_from is required');
    if (!date_to)   return badRequest('date_to is required');

    const from = new Date(date_from);
    const to   = new Date(date_to);

    if (isNaN(from.getTime())) return badRequest('date_from is not a valid date');
    if (isNaN(to.getTime()))   return badRequest('date_to is not a valid date');
    if (from > to)             return badRequest('date_from must be before date_to');

    const diffDays = (to - from) / (1000 * 60 * 60 * 24);
    if (diffDays > 90) {
      return badRequest('Date range cannot exceed 90 days');
    }

    const result = await query(
      `SELECT
         os.id                AS schedule_id,
         os.start_date,
         os.end_date,
         os.notes             AS schedule_notes,
         po.id                AS order_id,
         po.order_ref,
         po.status            AS order_status,
         po.priority,
         po.required_by_date,
         c.id                 AS customer_id,
         c.name               AS customer_name,
         ARRAY_AGG(sm.machine_id) FILTER (WHERE sm.machine_id IS NOT NULL) AS machine_ids
       FROM planning.order_schedules os
       JOIN planning.production_orders po     ON po.id = os.production_order_id
       JOIN customers.customer_master  c      ON c.id  = po.customer_id
       LEFT JOIN planning.schedule_machines sm ON sm.schedule_id = os.id
       WHERE os.start_date <= $2
         AND os.end_date   >= $1
         AND po.deleted_at IS NULL
       GROUP BY os.id, po.id, c.id
       ORDER BY os.start_date, os.end_date`,
      [date_from, date_to]
    );

    // Group schedules by calendar date (each day within the schedule window)
    const calendar = {};
    for (const row of result.rows) {
      const start = new Date(Math.max(new Date(row.start_date), from));
      const end   = new Date(Math.min(new Date(row.end_date), to));

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        if (!calendar[key]) calendar[key] = [];
        calendar[key].push(row);
      }
    }

    // Convert to sorted array
    const dates = Object.keys(calendar)
      .sort()
      .map((date) => ({ date, orders: calendar[date] }));

    return ok(dates);
  } catch (err) {
    console.error('getScheduleCalendar error', err);
    return serverError('Failed to get schedule calendar');
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

const WRITE_ROLES = ['admin', 'manager', 'production_supervisor'];

export const listProductionOrdersHandler  = withAuth(listProductionOrders);
export const getProductionOrderHandler    = withAuth(getProductionOrder);
export const createProductionOrderHandler = withRole(WRITE_ROLES, createProductionOrder);
export const updateProductionOrderHandler = withRole(WRITE_ROLES, updateProductionOrder);
export const confirmOrderHandler          = withRole(WRITE_ROLES, confirmOrder);
export const cancelOrderHandler           = withRole(WRITE_ROLES, cancelOrder);
export const scheduleOrderHandler         = withRole(WRITE_ROLES, scheduleOrder);
export const listCapacityPlansHandler     = withAuth(listCapacityPlans);
export const getScheduleCalendarHandler   = withAuth(getScheduleCalendar);
