import { query, transaction } from '../../db/connection.js';
import { ok, created, badRequest, notFound, serverError } from '../../utils/response.js';
import { withAuth, withRole } from '../../middleware/auth.js';

// ─── 1. listMachines ─────────────────────────────────────────────────────────
export const listMachines = withAuth(async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const page = Math.max(1, parseInt(params.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(params.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const { machine_type, status, search } = params;

    const conditions = [];
    const values = [];
    let idx = 1;

    if (machine_type) {
      conditions.push(`m.machine_type = $${idx++}`);
      values.push(machine_type);
    }
    if (status) {
      conditions.push(`m.status = $${idx++}`);
      values.push(status);
    }
    if (search) {
      conditions.push(`(m.name ILIKE $${idx} OR m.code ILIKE $${idx} OR m.manufacturer ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM machines.machines m ${where}`,
      values
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const rows = await query(
      `SELECT
         m.id, m.name, m.code, m.machine_type, m.manufacturer, m.model_no,
         m.serial_no, m.purchase_date, m.location, m.capacity_pairs_per_hour,
         m.status, m.notes, m.created_at, m.updated_at,
         (SELECT MAX(ml.performed_at)
            FROM machines.maintenance_logs ml
           WHERE ml.machine_id = m.id) AS last_maintenance_date,
         COALESCE(
           (SELECT SUM(
              EXTRACT(EPOCH FROM (
                COALESCE(d.ended_at, NOW()) - d.started_at
              )) / 3600
            )
            FROM machines.downtime_records d
           WHERE d.machine_id = m.id
             AND d.started_at >= NOW() - INTERVAL '30 days'),
           0
         ) AS total_downtime_hours_30d
       FROM machines.machines m
       ${where}
       ORDER BY m.name ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    );

    return ok({
      data: rows.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('listMachines error', err);
    return serverError('Failed to list machines');
  }
});

// ─── 2. getMachine ────────────────────────────────────────────────────────────
export const getMachine = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters || {};
    if (!id) return badRequest('Missing machine id');

    const machineResult = await query(
      `SELECT * FROM machines.machines WHERE id = $1`,
      [id]
    );
    if (!machineResult.rows.length) return notFound('Machine not found');

    const machine = machineResult.rows[0];

    const [maintenanceLogs, downtimeRecords, downtimeHours] = await Promise.all([
      query(
        `SELECT * FROM machines.maintenance_logs
          WHERE machine_id = $1
          ORDER BY performed_at DESC
          LIMIT 5`,
        [id]
      ),
      query(
        `SELECT * FROM machines.downtime_records
          WHERE machine_id = $1
          ORDER BY started_at DESC
          LIMIT 5`,
        [id]
      ),
      query(
        `SELECT COALESCE(SUM(
            EXTRACT(EPOCH FROM (
              COALESCE(ended_at, NOW()) - started_at
            )) / 3600
          ), 0) AS downtime_hours
         FROM machines.downtime_records
         WHERE machine_id = $1
           AND started_at >= NOW() - INTERVAL '30 days'`,
        [id]
      ),
    ]);

    const downtimeHours30d = parseFloat(downtimeRecords ? downtimeHours.rows[0].downtime_hours : 0);
    const uptimePct30d = ((720 - downtimeHours30d) / 720) * 100;

    return ok({
      ...machine,
      last_maintenance_logs: maintenanceLogs.rows,
      last_downtime_records: downtimeRecords.rows,
      downtime_hours_30d: downtimeHours30d,
      uptime_pct_30d: Math.max(0, Math.round(uptimePct30d * 100) / 100),
    });
  } catch (err) {
    console.error('getMachine error', err);
    return serverError('Failed to get machine');
  }
});

// ─── 3. createMachine ─────────────────────────────────────────────────────────
export const createMachine = withRole(['admin', 'manager'])(async (event) => {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
    const {
      name, code, machine_type, manufacturer, model_no, serial_no,
      purchase_date, location, capacity_pairs_per_hour, notes,
    } = body;

    if (!name || !code || !machine_type || !manufacturer || !model_no || !serial_no || !location) {
      return badRequest('Required fields: name, code, machine_type, manufacturer, model_no, serial_no, location');
    }

    const existing = await query(
      `SELECT id FROM machines.machines WHERE code = $1`,
      [code]
    );
    if (existing.rows.length) return badRequest(`Machine code '${code}' already exists`);

    const result = await query(
      `INSERT INTO machines.machines
         (name, code, machine_type, manufacturer, model_no, serial_no,
          purchase_date, location, capacity_pairs_per_hour, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active')
       RETURNING *`,
      [name, code, machine_type, manufacturer, model_no, serial_no,
       purchase_date || null, location, capacity_pairs_per_hour || null, notes || null]
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('createMachine error', err);
    return serverError('Failed to create machine');
  }
});

// ─── 4. updateMachine ─────────────────────────────────────────────────────────
export const updateMachine = withRole(['admin', 'manager'])(async (event) => {
  try {
    const { id } = event.pathParameters || {};
    if (!id) return badRequest('Missing machine id');

    const existing = await query(`SELECT id FROM machines.machines WHERE id = $1`, [id]);
    if (!existing.rows.length) return notFound('Machine not found');

    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});

    const allowed = [
      'name', 'code', 'machine_type', 'manufacturer', 'model_no', 'serial_no',
      'purchase_date', 'location', 'capacity_pairs_per_hour', 'notes', 'status',
    ];

    const updates = [];
    const values = [];
    let idx = 1;

    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        updates.push(`${field} = $${idx++}`);
        values.push(body[field]);
      }
    }

    if (!updates.length) return badRequest('No valid fields to update');

    if (body.code) {
      const codeConflict = await query(
        `SELECT id FROM machines.machines WHERE code = $1 AND id != $2`,
        [body.code, id]
      );
      if (codeConflict.rows.length) return badRequest(`Machine code '${body.code}' already exists`);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query(
      `UPDATE machines.machines SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('updateMachine error', err);
    return serverError('Failed to update machine');
  }
});

// ─── 5. retireMachine ─────────────────────────────────────────────────────────
export const retireMachine = withRole(['admin'])(async (event) => {
  try {
    const { id } = event.pathParameters || {};
    if (!id) return badRequest('Missing machine id');

    const existing = await query(`SELECT id, status FROM machines.machines WHERE id = $1`, [id]);
    if (!existing.rows.length) return notFound('Machine not found');
    if (existing.rows[0].status === 'retired') return badRequest('Machine is already retired');

    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
    const { reason, retirement_date } = body;
    if (!reason) return badRequest('reason is required');
    if (!retirement_date) return badRequest('retirement_date is required');

    const activeOrders = await query(
      `SELECT id FROM work_orders.work_orders
        WHERE machine_id = $1 AND status NOT IN ('completed','cancelled')
        LIMIT 1`,
      [id]
    );
    if (activeOrders.rows.length) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Cannot retire machine with active work orders' }),
      };
    }

    const result = await query(
      `UPDATE machines.machines
          SET status = 'retired',
              retirement_reason = $1,
              retirement_date = $2,
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [reason, retirement_date, id]
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('retireMachine error', err);
    return serverError('Failed to retire machine');
  }
});

// ─── 6. logMaintenance ────────────────────────────────────────────────────────
export const logMaintenance = withRole(['admin', 'manager', 'production_supervisor'])(async (event) => {
  try {
    const { id } = event.pathParameters || {};
    if (!id) return badRequest('Missing machine id');

    const machineResult = await query(`SELECT id, status FROM machines.machines WHERE id = $1`, [id]);
    if (!machineResult.rows.length) return notFound('Machine not found');

    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
    const {
      maintenance_type, performed_by, performed_at, duration_hours,
      description, parts_replaced, cost,
    } = body;

    if (!maintenance_type || !performed_by || !performed_at || duration_hours === undefined) {
      return badRequest('Required fields: maintenance_type, performed_by, performed_at, duration_hours');
    }

    const correctiveTypes = ['corrective', 'emergency'];
    const shouldActivate = correctiveTypes.includes(maintenance_type);

    const result = await transaction(async (client) => {
      const logResult = await client.query(
        `INSERT INTO machines.maintenance_logs
           (machine_id, maintenance_type, performed_by, performed_at,
            duration_hours, description, parts_replaced, cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [id, maintenance_type, performed_by, performed_at,
         duration_hours, description || null, parts_replaced || null, cost || null]
      );

      if (shouldActivate) {
        await client.query(
          `UPDATE machines.machines SET status = 'active', updated_at = NOW() WHERE id = $1`,
          [id]
        );
      }

      return logResult.rows[0];
    });

    return created(result);
  } catch (err) {
    console.error('logMaintenance error', err);
    return serverError('Failed to log maintenance');
  }
});

// ─── 7. listMaintenance ───────────────────────────────────────────────────────
export const listMaintenance = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters || {};
    if (!id) return badRequest('Missing machine id');

    const machineCheck = await query(`SELECT id FROM machines.machines WHERE id = $1`, [id]);
    if (!machineCheck.rows.length) return notFound('Machine not found');

    const params = event.queryStringParameters || {};
    const page = Math.max(1, parseInt(params.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(params.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const { type } = params;

    const conditions = [`machine_id = $1`];
    const values = [id];
    let idx = 2;

    if (type) {
      conditions.push(`maintenance_type = $${idx++}`);
      values.push(type);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [countResult, rows] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM machines.maintenance_logs ${where}`, values),
      query(
        `SELECT * FROM machines.maintenance_logs ${where}
          ORDER BY performed_at DESC
          LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset]
      ),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    return ok({
      data: rows.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('listMaintenance error', err);
    return serverError('Failed to list maintenance logs');
  }
});

// ─── 8. logDowntime ───────────────────────────────────────────────────────────
export const logDowntime = withRole(['admin', 'manager', 'production_supervisor'])(async (event) => {
  try {
    const { id } = event.pathParameters || {};
    if (!id) return badRequest('Missing machine id');

    const machineResult = await query(`SELECT id FROM machines.machines WHERE id = $1`, [id]);
    if (!machineResult.rows.length) return notFound('Machine not found');

    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
    const { started_at, ended_at, reason_code, description, reported_by } = body;

    if (!started_at || !reason_code || !reported_by) {
      return badRequest('Required fields: started_at, reason_code, reported_by');
    }

    const result = await transaction(async (client) => {
      const downtimeResult = await client.query(
        `INSERT INTO machines.downtime_records
           (machine_id, started_at, ended_at, reason_code, description, reported_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [id, started_at, ended_at || null, reason_code, description || null, reported_by]
      );

      if (!ended_at) {
        await client.query(
          `UPDATE machines.machines SET status = 'maintenance', updated_at = NOW() WHERE id = $1`,
          [id]
        );
      }

      return downtimeResult.rows[0];
    });

    return created(result);
  } catch (err) {
    console.error('logDowntime error', err);
    return serverError('Failed to log downtime');
  }
});

// ─── 9. closeDowntime ────────────────────────────────────────────────────────
export const closeDowntime = withRole(['admin', 'manager', 'production_supervisor'])(async (event) => {
  try {
    const { id, downtime_id } = event.pathParameters || {};
    if (!id) return badRequest('Missing machine id');
    if (!downtime_id) return badRequest('Missing downtime_id');

    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
    const { ended_at, resolution_notes } = body;
    if (!ended_at) return badRequest('ended_at is required');

    const existing = await query(
      `SELECT id, ended_at FROM machines.downtime_records WHERE id = $1 AND machine_id = $2`,
      [downtime_id, id]
    );
    if (!existing.rows.length) return notFound('Downtime record not found');
    if (existing.rows[0].ended_at) return badRequest('Downtime record is already closed');

    const result = await transaction(async (client) => {
      const updateResult = await client.query(
        `UPDATE machines.downtime_records
            SET ended_at = $1, resolution_notes = $2, updated_at = NOW()
          WHERE id = $3
          RETURNING *`,
        [ended_at, resolution_notes || null, downtime_id]
      );

      await client.query(
        `UPDATE machines.machines SET status = 'active', updated_at = NOW() WHERE id = $1`,
        [id]
      );

      return updateResult.rows[0];
    });

    return ok(result);
  } catch (err) {
    console.error('closeDowntime error', err);
    return serverError('Failed to close downtime record');
  }
});

// ─── 10. listDowntime ────────────────────────────────────────────────────────
export const listDowntime = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters || {};
    if (!id) return badRequest('Missing machine id');

    const machineCheck = await query(`SELECT id FROM machines.machines WHERE id = $1`, [id]);
    if (!machineCheck.rows.length) return notFound('Machine not found');

    const params = event.queryStringParameters || {};
    const page = Math.max(1, parseInt(params.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(params.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const { date_from, date_to } = params;

    const conditions = [`machine_id = $1`];
    const values = [id];
    let idx = 2;

    if (date_from) {
      conditions.push(`started_at >= $${idx++}`);
      values.push(date_from);
    }
    if (date_to) {
      conditions.push(`started_at <= $${idx++}`);
      values.push(date_to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const [countResult, rows] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM machines.downtime_records ${where}`, values),
      query(
        `SELECT * FROM machines.downtime_records ${where}
          ORDER BY started_at DESC
          LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset]
      ),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    return ok({
      data: rows.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('listDowntime error', err);
    return serverError('Failed to list downtime records');
  }
});

// ─── 11. getMachineStats ──────────────────────────────────────────────────────
export const getMachineStats = withAuth(async (_event) => {
  try {
    const [
      totalResult,
      byStatusResult,
      byTypeResult,
      mostDowntimeResult,
      maintenanceDueResult,
    ] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM machines.machines`),

      query(
        `SELECT status, COUNT(*) AS count
           FROM machines.machines
          GROUP BY status`
      ),

      query(
        `SELECT machine_type, COUNT(*) AS count
           FROM machines.machines
          GROUP BY machine_type
          ORDER BY machine_type ASC`
      ),

      query(
        `SELECT
             m.id, m.name, m.code, m.machine_type, m.status,
             COALESCE(SUM(
               EXTRACT(EPOCH FROM (
                 COALESCE(d.ended_at, NOW()) - d.started_at
               )) / 3600
             ), 0) AS downtime_hours_30d
           FROM machines.machines m
           LEFT JOIN machines.downtime_records d
             ON d.machine_id = m.id
            AND d.started_at >= NOW() - INTERVAL '30 days'
          GROUP BY m.id, m.name, m.code, m.machine_type, m.status
          ORDER BY downtime_hours_30d DESC
          LIMIT 5`
      ),

      query(
        `SELECT
             m.id, m.name, m.code, m.machine_type, m.status,
             MAX(ml.performed_at) AS last_maintenance_date
           FROM machines.machines m
           LEFT JOIN machines.maintenance_logs ml ON ml.machine_id = m.id
          WHERE m.status != 'retired'
          GROUP BY m.id, m.name, m.code, m.machine_type, m.status
         HAVING MAX(ml.performed_at) < NOW() - INTERVAL '30 days'
             OR MAX(ml.performed_at) IS NULL
          ORDER BY last_maintenance_date ASC NULLS FIRST`
      ),
    ]);

    const byStatus = { active: 0, maintenance: 0, retired: 0 };
    for (const row of byStatusResult.rows) {
      byStatus[row.status] = parseInt(row.count, 10);
    }

    return ok({
      total: parseInt(totalResult.rows[0].total, 10),
      by_status: byStatus,
      by_type: byTypeResult.rows.map((r) => ({
        machine_type: r.machine_type,
        count: parseInt(r.count, 10),
      })),
      most_downtime_30d: mostDowntimeResult.rows.map((r) => ({
        ...r,
        downtime_hours_30d: Math.round(parseFloat(r.downtime_hours_30d) * 100) / 100,
      })),
      maintenance_due: maintenanceDueResult.rows,
    });
  } catch (err) {
    console.error('getMachineStats error', err);
    return serverError('Failed to get machine stats');
  }
});
