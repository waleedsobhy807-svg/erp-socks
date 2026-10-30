/**
 * @module employees
 * @description Lambda handlers for employee management in the Socks Factory ERP.
 *
 * Covers employee CRUD, attendance tracking, KPI definition and recording,
 * and performance summaries.
 *
 * All reads are protected with `withAuth`.
 * Writes require at minimum `withRole(['admin','manager'])`;
 * attendance and KPI result recording also permit `production_supervisor`.
 * SQL is parameterised throughout; soft-deletes use `deleted_at`.
 * Pagination uses `page` / `limit` query-string params (defaults: page=1, limit=20).
 *
 * Tables referenced (schema: employees):
 *   employees, attendance, performance_kpis, kpi_records
 */

import { query, transaction } from '../../db/connection.js';
import { ok, created, badRequest, notFound, serverError } from '../../utils/response.js';
import { withAuth, withRole } from '../../middleware/auth.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const MANAGER_ROLES    = ['admin', 'manager'];
const SUPERVISOR_ROLES = ['admin', 'manager', 'production_supervisor'];

function parsePage(qs) {
  const page  = Math.max(1, parseInt(qs?.page  ?? '1',  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(qs?.limit ?? '20', 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

// ─── 1. listEmployees ────────────────────────────────────────────────────────

/**
 * GET /employees
 * Query params: department, status, search (matches name or emp_no), page, limit
 */
export const listEmployees = withAuth(async (event) => {
  try {
    const qs = event.queryStringParameters ?? {};
    const { page, limit, offset } = parsePage(qs);

    const conditions = ['e.deleted_at IS NULL'];
    const params     = [];

    if (qs.department) {
      params.push(qs.department);
      conditions.push(`e.department = $${params.length}`);
    }
    if (qs.status) {
      params.push(qs.status);
      conditions.push(`e.status = $${params.length}`);
    }
    if (qs.search) {
      params.push(`%${qs.search}%`);
      conditions.push(`(e.full_name ILIKE $${params.length} OR e.emp_no ILIKE $${params.length})`);
    }

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM employees.employees e WHERE ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const rows = await query(
      `SELECT
            e.id,
            e.emp_no,
            e.full_name,
            e.department,
            e.job_title,
            e.hire_date,
            e.status,
            e.phone,
            e.email,
            e.created_at
         FROM employees.employees e
        WHERE ${where}
        ORDER BY e.full_name ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return ok({
      data:       rows.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('listEmployees error', err);
    return serverError('Failed to list employees');
  }
});

// ─── 2. getEmployee ──────────────────────────────────────────────────────────

/**
 * GET /employees/{id}
 * Returns full employee record plus their latest KPI records (last 90 days).
 */
export const getEmployee = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing employee id');

    const empResult = await query(
      `SELECT * FROM employees.employees
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (empResult.rows.length === 0) return notFound('Employee not found');

    const employee = empResult.rows[0];

    const kpiResult = await query(
      `SELECT
            kr.*,
            kpi.name        AS kpi_name,
            kpi.unit        AS kpi_unit,
            kpi.target_value,
            kpi.weight_pct
         FROM employees.kpi_records kr
         JOIN employees.performance_kpis kpi ON kpi.id = kr.kpi_id
        WHERE kr.employee_id = $1
          AND kr.period_end >= NOW() - INTERVAL '90 days'
        ORDER BY kr.period_end DESC`,
      [id]
    );

    employee.latest_kpi_records = kpiResult.rows;

    return ok(employee);
  } catch (err) {
    console.error('getEmployee error', err);
    return serverError('Failed to retrieve employee');
  }
});

// ─── 3. createEmployee ───────────────────────────────────────────────────────

/**
 * POST /employees
 * Body: emp_no, full_name, department, job_title, hire_date, gender,
 *       phone, email, base_salary, currency
 */
export const createEmployee = withRole(MANAGER_ROLES)(async (event) => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const {
      emp_no, full_name, department, job_title,
      hire_date, gender, phone, email,
      base_salary, currency,
    } = body;

    if (!emp_no)     return badRequest('emp_no is required');
    if (!full_name)  return badRequest('full_name is required');
    if (!department) return badRequest('department is required');
    if (!hire_date)  return badRequest('hire_date is required');

    // Validate uniqueness of emp_no
    const dupCheck = await query(
      `SELECT id FROM employees.employees WHERE emp_no = $1 AND deleted_at IS NULL`,
      [emp_no]
    );
    if (dupCheck.rows.length > 0) return badRequest(`emp_no '${emp_no}' is already in use`);

    const result = await query(
      `INSERT INTO employees.employees
            (emp_no, full_name, department, job_title, hire_date, gender,
             phone, email, base_salary, currency, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', NOW(), NOW())
       RETURNING *`,
      [emp_no, full_name, department, job_title ?? null, hire_date,
       gender ?? null, phone ?? null, email ?? null,
       base_salary ?? null, currency ?? 'USD']
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('createEmployee error', err);
    return serverError('Failed to create employee');
  }
});

// ─── 4. updateEmployee ───────────────────────────────────────────────────────

/**
 * PATCH /employees/{id}
 * Accepts any subset of: full_name, department, job_title, phone, email,
 *                         base_salary, currency, gender
 */
export const updateEmployee = withRole(MANAGER_ROLES)(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing employee id');

    const body = JSON.parse(event.body ?? '{}');

    const allowed = ['full_name', 'department', 'job_title', 'phone', 'email',
                     'base_salary', 'currency', 'gender'];
    const setClauses = [];
    const params     = [];

    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        params.push(body[field]);
        setClauses.push(`${field} = $${params.length}`);
      }
    }

    if (setClauses.length === 0) return badRequest('No updatable fields provided');

    params.push(id);
    const result = await query(
      `UPDATE employees.employees
          SET ${setClauses.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) return notFound('Employee not found');
    return ok(result.rows[0]);
  } catch (err) {
    console.error('updateEmployee error', err);
    return serverError('Failed to update employee');
  }
});

// ─── 5. terminateEmployee ────────────────────────────────────────────────────

/**
 * POST /employees/{id}/terminate
 * Body: termination_date, reason
 */
export const terminateEmployee = withRole(['admin'])(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing employee id');

    const body = JSON.parse(event.body ?? '{}');
    const { termination_date, reason } = body;

    if (!termination_date) return badRequest('termination_date is required');
    if (!reason)           return badRequest('reason is required');

    const existing = await query(
      `SELECT id, status FROM employees.employees
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Employee not found');
    if (existing.rows[0].status === 'terminated') {
      return badRequest('Employee is already terminated');
    }

    const result = await query(
      `UPDATE employees.employees
          SET status           = 'terminated',
              termination_date = $1,
              termination_reason = $2,
              updated_at       = NOW()
        WHERE id = $3
       RETURNING *`,
      [termination_date, reason, id]
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('terminateEmployee error', err);
    return serverError('Failed to terminate employee');
  }
});

// ─── 6. recordAttendance ─────────────────────────────────────────────────────

/**
 * POST /employees/{id}/attendance
 * Body: date, check_in, check_out (nullable), status (present/absent/late/half_day), notes
 */
export const recordAttendance = withRole(SUPERVISOR_ROLES)(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing employee id');

    const body = JSON.parse(event.body ?? '{}');
    const { date, check_in, check_out, status, notes } = body;

    if (!date)   return badRequest('date is required');
    if (!status) return badRequest('status is required');

    const VALID_STATUSES = ['present', 'absent', 'late', 'half_day'];
    if (!VALID_STATUSES.includes(status)) {
      return badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const existing = await query(
      `SELECT id FROM employees.employees WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Employee not found');

    const result = await query(
      `INSERT INTO employees.attendance
            (employee_id, date, check_in, check_out, status, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (employee_id, date)
       DO UPDATE SET
            check_in  = EXCLUDED.check_in,
            check_out = EXCLUDED.check_out,
            status    = EXCLUDED.status,
            notes     = EXCLUDED.notes,
            updated_at = NOW()
       RETURNING *`,
      [id, date, check_in ?? null, check_out ?? null, status, notes ?? null]
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('recordAttendance error', err);
    return serverError('Failed to record attendance');
  }
});

// ─── 7. listAttendance ───────────────────────────────────────────────────────

/**
 * GET /employees/{id}/attendance
 * Query params: date_from, date_to, page, limit
 */
export const listAttendance = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing employee id');

    const qs = event.queryStringParameters ?? {};
    const { page, limit, offset } = parsePage(qs);

    const existing = await query(
      `SELECT id FROM employees.employees WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Employee not found');

    const conditions = ['employee_id = $1'];
    const params     = [id];

    if (qs.date_from) {
      params.push(qs.date_from);
      conditions.push(`date >= $${params.length}`);
    }
    if (qs.date_to) {
      params.push(qs.date_to);
      conditions.push(`date <= $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM employees.attendance WHERE ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const rows = await query(
      `SELECT * FROM employees.attendance
        WHERE ${where}
        ORDER BY date DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return ok({
      data:       rows.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('listAttendance error', err);
    return serverError('Failed to list attendance');
  }
});

// ─── 8. setKPI ───────────────────────────────────────────────────────────────

/**
 * POST /employees/kpis
 * Body: name, description, unit, target_value, weight_pct, department
 */
export const setKPI = withRole(MANAGER_ROLES)(async (event) => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const { name, description, unit, target_value, weight_pct, department } = body;

    if (!name)           return badRequest('name is required');
    if (!unit)           return badRequest('unit is required');
    if (target_value == null) return badRequest('target_value is required');
    if (weight_pct == null)   return badRequest('weight_pct is required');

    const result = await query(
      `INSERT INTO employees.performance_kpis
            (name, description, unit, target_value, weight_pct, department, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [name, description ?? null, unit, target_value, weight_pct, department ?? null]
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('setKPI error', err);
    return serverError('Failed to create KPI');
  }
});

// ─── 9. recordKPIResult ──────────────────────────────────────────────────────

/**
 * POST /employees/{id}/kpi-results
 * Body: kpi_id, period_start, period_end, actual_value, notes
 * Computes score = (actual_value / target_value) * 100
 */
export const recordKPIResult = withRole(SUPERVISOR_ROLES)(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing employee id');

    const body = JSON.parse(event.body ?? '{}');
    const { kpi_id, period_start, period_end, actual_value, notes } = body;

    if (!kpi_id)       return badRequest('kpi_id is required');
    if (!period_start) return badRequest('period_start is required');
    if (!period_end)   return badRequest('period_end is required');
    if (actual_value == null) return badRequest('actual_value is required');

    const empCheck = await query(
      `SELECT id FROM employees.employees WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (empCheck.rows.length === 0) return notFound('Employee not found');

    const kpiCheck = await query(
      `SELECT id, target_value FROM employees.performance_kpis WHERE id = $1`,
      [kpi_id]
    );
    if (kpiCheck.rows.length === 0) return notFound('KPI not found');

    const target_value = parseFloat(kpiCheck.rows[0].target_value);
    const score = target_value > 0
      ? Math.round((parseFloat(actual_value) / target_value) * 100 * 100) / 100
      : 0;

    const result = await query(
      `INSERT INTO employees.kpi_records
            (employee_id, kpi_id, period_start, period_end, actual_value, score, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [id, kpi_id, period_start, period_end, actual_value, score, notes ?? null]
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('recordKPIResult error', err);
    return serverError('Failed to record KPI result');
  }
});

// ─── 10. getPerformanceSummary ────────────────────────────────────────────────

/**
 * GET /employees/{id}/performance
 * Query params: period_start, period_end
 * Returns: kpi_results[], weighted_score, attendance_rate, overall_rating
 */
export const getPerformanceSummary = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing employee id');

    const qs = event.queryStringParameters ?? {};
    const { period_start, period_end } = qs;

    const empCheck = await query(
      `SELECT id, full_name, department FROM employees.employees
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (empCheck.rows.length === 0) return notFound('Employee not found');

    const kpiParams  = [id];
    const kpiFilters = ['kr.employee_id = $1'];

    if (period_start) {
      kpiParams.push(period_start);
      kpiFilters.push(`kr.period_start >= $${kpiParams.length}`);
    }
    if (period_end) {
      kpiParams.push(period_end);
      kpiFilters.push(`kr.period_end <= $${kpiParams.length}`);
    }

    const kpiResult = await query(
      `SELECT
            kr.id,
            kr.kpi_id,
            kr.period_start,
            kr.period_end,
            kr.actual_value,
            kr.score,
            kr.notes,
            kpi.name        AS kpi_name,
            kpi.unit        AS kpi_unit,
            kpi.target_value,
            kpi.weight_pct
         FROM employees.kpi_records kr
         JOIN employees.performance_kpis kpi ON kpi.id = kr.kpi_id
        WHERE ${kpiFilters.join(' AND ')}
        ORDER BY kr.period_end DESC, kpi.name ASC`,
      kpiParams
    );

    // Weighted score: sum(score * weight_pct) / sum(weight_pct)
    let weightedScore = 0;
    let totalWeight   = 0;
    for (const row of kpiResult.rows) {
      const w = parseFloat(row.weight_pct) || 0;
      const s = parseFloat(row.score)      || 0;
      weightedScore += s * w;
      totalWeight   += w;
    }
    const weightedScoreFinal = totalWeight > 0
      ? Math.round((weightedScore / totalWeight) * 100) / 100
      : 0;

    // Attendance rate for the same period
    const attParams  = [id];
    const attFilters = ['employee_id = $1'];
    if (period_start) {
      attParams.push(period_start);
      attFilters.push(`date >= $${attParams.length}`);
    }
    if (period_end) {
      attParams.push(period_end);
      attFilters.push(`date <= $${attParams.length}`);
    }

    const attResult = await query(
      `SELECT
            COUNT(*) AS total_days,
            SUM(CASE WHEN status IN ('present','late','half_day') THEN 1 ELSE 0 END) AS present_days
         FROM employees.attendance
        WHERE ${attFilters.join(' AND ')}`,
      attParams
    );

    const totalDays   = parseInt(attResult.rows[0].total_days,   10) || 0;
    const presentDays = parseInt(attResult.rows[0].present_days, 10) || 0;
    const attendanceRate = totalDays > 0
      ? Math.round((presentDays / totalDays) * 100 * 100) / 100
      : null;

    // Overall rating: simple band on weighted score
    let overall_rating = 'N/A';
    if (totalWeight > 0) {
      if      (weightedScoreFinal >= 90) overall_rating = 'Excellent';
      else if (weightedScoreFinal >= 75) overall_rating = 'Good';
      else if (weightedScoreFinal >= 60) overall_rating = 'Satisfactory';
      else                               overall_rating = 'Needs Improvement';
    }

    return ok({
      employee:        empCheck.rows[0],
      kpi_results:     kpiResult.rows,
      weighted_score:  weightedScoreFinal,
      attendance_rate: attendanceRate,
      overall_rating,
    });
  } catch (err) {
    console.error('getPerformanceSummary error', err);
    return serverError('Failed to retrieve performance summary');
  }
});
