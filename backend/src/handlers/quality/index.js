/**
 * @module quality
 * @description Lambda handlers for Quality Control in the Socks Factory ERP.
 *
 * Covers QC plan management, checkpoint definitions, inspection execution,
 * non-conformance tracking, and quality statistics.
 *
 * Auth model:
 *   - All reads:       withAuth
 *   - Plan create/checkpoints/inspections/resolve: withRole(['admin','manager','qc_inspector'])
 *   - Plan header update: withRole(['admin','manager'])
 *
 * Tables referenced (schema: quality):
 *   qc_plans, qc_checkpoints, qc_results, qc_result_details, non_conformances
 *
 * Pagination defaults: page=1, limit=20, max limit=100.
 * Soft deletes: deleted_at IS NULL on all reads.
 */

import { query, transaction } from '../../db/connection.js';
import { ok, created, badRequest, notFound, serverError } from '../../utils/response.js';
import { withAuth, withRole } from '../../middleware/auth.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const QC_ROLES = ['admin', 'manager', 'qc_inspector'];

function parsePage(qs) {
  const page  = Math.max(1, parseInt(qs?.page  ?? '1',  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(qs?.limit ?? '20', 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

// ─── 1. listQCPlans ──────────────────────────────────────────────────────────

/**
 * GET /quality/plans
 * Query params: product_id, is_active, page, limit
 */
export const listQCPlans = withAuth(async (event) => {
  try {
    const qs = event.queryStringParameters ?? {};
    const { page, limit, offset } = parsePage(qs);

    const conditions = ['p.deleted_at IS NULL'];
    const params = [];

    if (qs.product_id) {
      params.push(qs.product_id);
      conditions.push(`p.product_id = $${params.length}`);
    }
    if (qs.is_active !== undefined && qs.is_active !== '') {
      params.push(qs.is_active === 'true' || qs.is_active === '1');
      conditions.push(`p.is_active = $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total
         FROM quality.qc_plans p
        WHERE ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const rows = await query(
      `SELECT
            p.id,
            p.name,
            p.description,
            p.is_active,
            p.created_at,
            p.updated_at,
            p.product_id,
            pr.name        AS product_name,
            COUNT(c.id)    AS checkpoint_count
         FROM quality.qc_plans p
         LEFT JOIN products.products pr ON pr.id = p.product_id
         LEFT JOIN quality.qc_checkpoints c
                ON c.qc_plan_id = p.id AND c.deleted_at IS NULL
        WHERE ${where}
        GROUP BY p.id, pr.name
        ORDER BY p.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return ok({
      data:       rows.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('listQCPlans error', err);
    return serverError('Failed to list QC plans');
  }
});

// ─── 2. getQCPlan ────────────────────────────────────────────────────────────

/**
 * GET /quality/plans/{id}
 */
export const getQCPlan = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing plan id');

    const planResult = await query(
      `SELECT
            p.*,
            pr.name AS product_name
         FROM quality.qc_plans p
         LEFT JOIN products.products pr ON pr.id = p.product_id
        WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id]
    );
    if (planResult.rows.length === 0) return notFound('QC plan not found');

    const plan = planResult.rows[0];

    const checkpointResult = await query(
      `SELECT *
         FROM quality.qc_checkpoints
        WHERE qc_plan_id = $1 AND deleted_at IS NULL
        ORDER BY sort_order ASC, created_at ASC`,
      [id]
    );

    plan.checkpoints = checkpointResult.rows;
    return ok(plan);
  } catch (err) {
    console.error('getQCPlan error', err);
    return serverError('Failed to retrieve QC plan');
  }
});

// ─── 3. createQCPlan ─────────────────────────────────────────────────────────

/**
 * POST /quality/plans
 * Body: product_id, name, description, checkpoints[{name,description,check_type,acceptable_range,unit}]
 */
export const createQCPlan = withRole(QC_ROLES)(async (event) => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const { product_id, name, description, checkpoints = [] } = body;

    if (!product_id)    return badRequest('product_id is required');
    if (!name)          return badRequest('name is required');
    if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
      return badRequest('checkpoints must be a non-empty array');
    }

    for (let i = 0; i < checkpoints.length; i++) {
      if (!checkpoints[i].name)       return badRequest(`checkpoints[${i}].name is required`);
      if (!checkpoints[i].check_type) return badRequest(`checkpoints[${i}].check_type is required`);
    }

    const result = await transaction(async (client) => {
      const planResult = await client.query(
        `INSERT INTO quality.qc_plans
              (product_id, name, description, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, true, NOW(), NOW())
         RETURNING *`,
        [product_id, name, description ?? null]
      );
      const plan = planResult.rows[0];

      const insertedCheckpoints = [];
      for (let i = 0; i < checkpoints.length; i++) {
        const cp = checkpoints[i];
        const cpResult = await client.query(
          `INSERT INTO quality.qc_checkpoints
                (qc_plan_id, name, description, check_type, acceptable_range, unit, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
           RETURNING *`,
          [
            plan.id,
            cp.name,
            cp.description ?? null,
            cp.check_type,
            cp.acceptable_range ?? null,
            cp.unit ?? null,
            cp.sort_order ?? i + 1,
          ]
        );
        insertedCheckpoints.push(cpResult.rows[0]);
      }

      return { ...plan, checkpoints: insertedCheckpoints };
    });

    return created(result);
  } catch (err) {
    console.error('createQCPlan error', err);
    return serverError('Failed to create QC plan');
  }
});

// ─── 4. updateQCPlan ─────────────────────────────────────────────────────────

/**
 * PATCH /quality/plans/{id}
 * Body (partial): name, description, is_active
 */
export const updateQCPlan = withRole(['admin', 'manager'])(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing plan id');

    const existing = await query(
      `SELECT id FROM quality.qc_plans WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('QC plan not found');

    const body = JSON.parse(event.body ?? '{}');
    const setClauses = [];
    const params = [];

    if (body.name !== undefined) {
      params.push(body.name);
      setClauses.push(`name = $${params.length}`);
    }
    if (body.description !== undefined) {
      params.push(body.description);
      setClauses.push(`description = $${params.length}`);
    }
    if (body.is_active !== undefined) {
      params.push(body.is_active);
      setClauses.push(`is_active = $${params.length}`);
    }

    if (setClauses.length === 0) return badRequest('No updatable fields provided');

    setClauses.push('updated_at = NOW()');
    params.push(id);

    const result = await query(
      `UPDATE quality.qc_plans
          SET ${setClauses.join(', ')}
        WHERE id = $${params.length}
       RETURNING *`,
      params
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('updateQCPlan error', err);
    return serverError('Failed to update QC plan');
  }
});

// ─── 5. addCheckpoint ────────────────────────────────────────────────────────

/**
 * POST /quality/plans/{id}/checkpoints
 * Body: name, description, check_type, acceptable_range, unit, sort_order
 */
export const addCheckpoint = withRole(QC_ROLES)(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing plan id');

    const planResult = await query(
      `SELECT id FROM quality.qc_plans WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (planResult.rows.length === 0) return notFound('QC plan not found');

    const body = JSON.parse(event.body ?? '{}');
    const { name, description, check_type, acceptable_range, unit, sort_order } = body;

    if (!name)       return badRequest('name is required');
    if (!check_type) return badRequest('check_type is required');

    let effectiveSortOrder = sort_order;
    if (effectiveSortOrder == null) {
      const maxResult = await query(
        `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
           FROM quality.qc_checkpoints
          WHERE qc_plan_id = $1 AND deleted_at IS NULL`,
        [id]
      );
      effectiveSortOrder = maxResult.rows[0].next_order;
    }

    const result = await query(
      `INSERT INTO quality.qc_checkpoints
            (qc_plan_id, name, description, check_type, acceptable_range, unit, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [id, name, description ?? null, check_type, acceptable_range ?? null, unit ?? null, effectiveSortOrder]
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('addCheckpoint error', err);
    return serverError('Failed to add checkpoint');
  }
});

// ─── 6. runQCInspection ──────────────────────────────────────────────────────

/**
 * POST /quality/inspections
 * Body: work_order_id, qc_plan_id, inspected_by, inspection_date, sample_size,
 *       results[{checkpoint_id, measured_value, passed, notes}]
 *
 * Transaction:
 *   1. Insert qc_results header
 *   2. Insert per-checkpoint qc_result_details
 *   3. Compute overall_passed (all results passed)
 *   4. If NOT passed, insert non_conformances record with status=open
 */
export const runQCInspection = withRole(QC_ROLES)(async (event) => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const { work_order_id, qc_plan_id, inspected_by, inspection_date, sample_size, results = [] } = body;

    if (!work_order_id)   return badRequest('work_order_id is required');
    if (!qc_plan_id)      return badRequest('qc_plan_id is required');
    if (!inspected_by)    return badRequest('inspected_by is required');
    if (!inspection_date) return badRequest('inspection_date is required');
    if (sample_size == null) return badRequest('sample_size is required');
    if (!Array.isArray(results) || results.length === 0) {
      return badRequest('results must be a non-empty array');
    }

    for (let i = 0; i < results.length; i++) {
      if (!results[i].checkpoint_id) return badRequest(`results[${i}].checkpoint_id is required`);
      if (results[i].passed === undefined) return badRequest(`results[${i}].passed is required`);
    }

    const inspectionResult = await transaction(async (client) => {
      const overallPassed = results.every((r) => r.passed === true || r.passed === 'true');

      const headerResult = await client.query(
        `INSERT INTO quality.qc_results
              (work_order_id, qc_plan_id, inspected_by, inspection_date,
               sample_size, overall_passed, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING *`,
        [work_order_id, qc_plan_id, inspected_by, inspection_date, sample_size, overallPassed]
      );
      const inspection = headerResult.rows[0];

      const details = [];
      for (const r of results) {
        const detailResult = await client.query(
          `INSERT INTO quality.qc_result_details
                (qc_result_id, checkpoint_id, measured_value, passed, notes, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           RETURNING *`,
          [
            inspection.id,
            r.checkpoint_id,
            r.measured_value ?? null,
            r.passed === true || r.passed === 'true',
            r.notes ?? null,
          ]
        );
        details.push(detailResult.rows[0]);
      }

      let nonConformance = null;
      if (!overallPassed) {
        const ncResult = await client.query(
          `INSERT INTO quality.non_conformances
                (qc_result_id, work_order_id, qc_plan_id, status, detected_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'open', $4, NOW(), NOW())
           RETURNING *`,
          [inspection.id, work_order_id, qc_plan_id, inspection_date]
        );
        nonConformance = ncResult.rows[0];
      }

      return { ...inspection, results: details, non_conformance: nonConformance };
    });

    return created(inspectionResult);
  } catch (err) {
    console.error('runQCInspection error', err);
    return serverError('Failed to record QC inspection');
  }
});

// ─── 7. listInspections ──────────────────────────────────────────────────────

/**
 * GET /quality/inspections
 * Query params: work_order_id, passed, date_from, date_to, page, limit
 */
export const listInspections = withAuth(async (event) => {
  try {
    const qs = event.queryStringParameters ?? {};
    const { page, limit, offset } = parsePage(qs);

    const conditions = ['r.deleted_at IS NULL'];
    const params = [];

    if (qs.work_order_id) {
      params.push(qs.work_order_id);
      conditions.push(`r.work_order_id = $${params.length}`);
    }
    if (qs.passed !== undefined && qs.passed !== '') {
      params.push(qs.passed === 'true' || qs.passed === '1');
      conditions.push(`r.overall_passed = $${params.length}`);
    }
    if (qs.date_from) {
      params.push(qs.date_from);
      conditions.push(`r.inspection_date >= $${params.length}`);
    }
    if (qs.date_to) {
      params.push(qs.date_to);
      conditions.push(`r.inspection_date <= $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM quality.qc_results r WHERE ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const rows = await query(
      `SELECT
            r.id,
            r.work_order_id,
            r.qc_plan_id,
            r.inspection_date,
            r.sample_size,
            r.overall_passed,
            r.created_at,
            p.name            AS plan_name,
            e.full_name       AS inspector_name
         FROM quality.qc_results r
         LEFT JOIN quality.qc_plans p       ON p.id = r.qc_plan_id
         LEFT JOIN employees.employees e    ON e.id = r.inspected_by
        WHERE ${where}
        ORDER BY r.inspection_date DESC, r.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return ok({
      data:       rows.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('listInspections error', err);
    return serverError('Failed to list inspections');
  }
});

// ─── 8. getInspection ────────────────────────────────────────────────────────

/**
 * GET /quality/inspections/{id}
 */
export const getInspection = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing inspection id');

    const headerResult = await query(
      `SELECT
            r.*,
            p.name           AS plan_name,
            e.full_name      AS inspector_name
         FROM quality.qc_results r
         LEFT JOIN quality.qc_plans p       ON p.id = r.qc_plan_id
         LEFT JOIN employees.employees e    ON e.id = r.inspected_by
        WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [id]
    );
    if (headerResult.rows.length === 0) return notFound('Inspection not found');

    const inspection = headerResult.rows[0];

    const detailsResult = await query(
      `SELECT
            d.*,
            c.name             AS checkpoint_name,
            c.check_type,
            c.acceptable_range,
            c.unit
         FROM quality.qc_result_details d
         LEFT JOIN quality.qc_checkpoints c ON c.id = d.checkpoint_id
        WHERE d.qc_result_id = $1
        ORDER BY c.sort_order ASC, d.created_at ASC`,
      [id]
    );

    inspection.results = detailsResult.rows;
    return ok(inspection);
  } catch (err) {
    console.error('getInspection error', err);
    return serverError('Failed to retrieve inspection');
  }
});

// ─── 9. listNonConformances ───────────────────────────────────────────────────

/**
 * GET /quality/non-conformances
 * Query params: status (open|under_review|resolved|closed), product_id, date_from, date_to, page, limit
 */
export const listNonConformances = withAuth(async (event) => {
  try {
    const qs = event.queryStringParameters ?? {};
    const { page, limit, offset } = parsePage(qs);

    const conditions = ['nc.deleted_at IS NULL'];
    const params = [];

    if (qs.status) {
      params.push(qs.status);
      conditions.push(`nc.status = $${params.length}`);
    }
    if (qs.product_id) {
      params.push(qs.product_id);
      conditions.push(`p.product_id = $${params.length}`);
    }
    if (qs.date_from) {
      params.push(qs.date_from);
      conditions.push(`nc.detected_at >= $${params.length}`);
    }
    if (qs.date_to) {
      params.push(qs.date_to);
      conditions.push(`nc.detected_at <= $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total
         FROM quality.non_conformances nc
         LEFT JOIN quality.qc_plans p ON p.id = nc.qc_plan_id
        WHERE ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const rows = await query(
      `SELECT
            nc.id,
            nc.status,
            nc.detected_at,
            nc.resolved_at,
            nc.resolution,
            nc.root_cause,
            nc.created_at,
            nc.work_order_id,
            p.name           AS plan_name,
            p.product_id,
            pr.name          AS product_name,
            e.full_name      AS resolved_by_name
         FROM quality.non_conformances nc
         LEFT JOIN quality.qc_plans p       ON p.id = nc.qc_plan_id
         LEFT JOIN products.products pr     ON pr.id = p.product_id
         LEFT JOIN employees.employees e    ON e.id = nc.resolved_by
        WHERE ${where}
        ORDER BY nc.detected_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return ok({
      data:       rows.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('listNonConformances error', err);
    return serverError('Failed to list non-conformances');
  }
});

// ─── 10. resolveNonConformance ────────────────────────────────────────────────

/**
 * POST /quality/non-conformances/{id}/resolve
 * Body: resolution, resolved_by, root_cause
 */
export const resolveNonConformance = withRole(QC_ROLES)(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing non-conformance id');

    const existing = await query(
      `SELECT id, status FROM quality.non_conformances
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Non-conformance not found');
    if (['resolved', 'closed'].includes(existing.rows[0].status)) {
      return badRequest(`Non-conformance is already ${existing.rows[0].status}`);
    }

    const body = JSON.parse(event.body ?? '{}');
    const { resolution, resolved_by, root_cause } = body;

    if (!resolution)  return badRequest('resolution is required');
    if (!resolved_by) return badRequest('resolved_by is required');

    const result = await query(
      `UPDATE quality.non_conformances
          SET status      = 'resolved',
              resolution  = $1,
              resolved_by = $2,
              root_cause  = $3,
              resolved_at = NOW(),
              updated_at  = NOW()
        WHERE id = $4
       RETURNING *`,
      [resolution, resolved_by, root_cause ?? null, id]
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('resolveNonConformance error', err);
    return serverError('Failed to resolve non-conformance');
  }
});

// ─── 11. getQualityStats ──────────────────────────────────────────────────────

/**
 * GET /quality/stats
 * Returns:
 *   total_inspections_30d, pass_rate_pct, open_non_conformances,
 *   defect_rate_by_product (top 5), inspections_by_day (last 14 days)
 */
export const getQualityStats = withAuth(async (event) => {
  try {
    const [summaryResult, ncResult, defectByProductResult, byDayResult] = await Promise.all([
      query(
        `SELECT
              COUNT(*)                                              AS total_inspections_30d,
              ROUND(
                CASE WHEN COUNT(*) = 0 THEN 0
                     ELSE SUM(CASE WHEN overall_passed THEN 1 ELSE 0 END)::numeric
                          / COUNT(*) * 100
                END, 2
              )                                                     AS pass_rate_pct
           FROM quality.qc_results
          WHERE inspection_date >= CURRENT_DATE - INTERVAL '30 days'
            AND deleted_at IS NULL`,
        []
      ),
      query(
        `SELECT COUNT(*) AS open_non_conformances
           FROM quality.non_conformances
          WHERE status = 'open' AND deleted_at IS NULL`,
        []
      ),
      query(
        `SELECT
              pr.id                                       AS product_id,
              pr.name                                     AS product_name,
              COUNT(nc.id)                                AS non_conformance_count,
              COUNT(r.id)                                 AS inspection_count,
              ROUND(
                CASE WHEN COUNT(r.id) = 0 THEN 0
                     ELSE COUNT(nc.id)::numeric / COUNT(r.id) * 100
                END, 2
              )                                           AS defect_rate_pct
           FROM products.products pr
           LEFT JOIN quality.qc_plans p
                  ON p.product_id = pr.id AND p.deleted_at IS NULL
           LEFT JOIN quality.qc_results r
                  ON r.qc_plan_id = p.id
                 AND r.inspection_date >= CURRENT_DATE - INTERVAL '30 days'
                 AND r.deleted_at IS NULL
           LEFT JOIN quality.non_conformances nc
                  ON nc.qc_plan_id = p.id
                 AND nc.detected_at >= CURRENT_DATE - INTERVAL '30 days'
                 AND nc.deleted_at IS NULL
          WHERE pr.deleted_at IS NULL
          GROUP BY pr.id, pr.name
          ORDER BY non_conformance_count DESC
          LIMIT 5`,
        []
      ),
      query(
        `SELECT
              TO_CHAR(d.day, 'YYYY-MM-DD') AS inspection_date,
              COUNT(r.id)                  AS total,
              SUM(CASE WHEN r.overall_passed THEN 1 ELSE 0 END) AS passed,
              SUM(CASE WHEN NOT r.overall_passed THEN 1 ELSE 0 END) AS failed
           FROM generate_series(
                  CURRENT_DATE - INTERVAL '13 days',
                  CURRENT_DATE,
                  '1 day'::interval
                ) AS d(day)
           LEFT JOIN quality.qc_results r
                  ON r.inspection_date = d.day AND r.deleted_at IS NULL
          GROUP BY d.day
          ORDER BY d.day ASC`,
        []
      ),
    ]);

    return ok({
      total_inspections_30d:   parseInt(summaryResult.rows[0].total_inspections_30d, 10),
      pass_rate_pct:           parseFloat(summaryResult.rows[0].pass_rate_pct ?? 0),
      open_non_conformances:   parseInt(ncResult.rows[0].open_non_conformances, 10),
      defect_rate_by_product:  defectByProductResult.rows,
      inspections_by_day:      byDayResult.rows,
    });
  } catch (err) {
    console.error('getQualityStats error', err);
    return serverError('Failed to retrieve quality stats');
  }
});
