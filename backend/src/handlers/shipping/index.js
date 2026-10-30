/**
 * @module shipping
 * @description Lambda handlers for Shipping & Carrier management in the Socks Factory ERP.
 *
 * Covers packing list creation, shipment lifecycle (created → in_transit → delivered/returned),
 * carrier management, and shipping statistics.
 *
 * Auth model:
 *   - All reads:                        withAuth
 *   - Packing list / shipment creates:  withRole(['admin','manager','warehouse_keeper'])
 *   - Shipment status updates:          withRole(['admin','manager','warehouse_keeper'])
 *   - Carrier create:                   withRole(['admin','manager'])
 *
 * Tables referenced (schema: shipping):
 *   shipments, shipment_status_history, packing_lists, packing_list_items, carriers
 * Tables referenced (schema: customers):
 *   customers
 * Tables referenced (schema: production):
 *   production_orders
 *
 * Pagination defaults: page=1, limit=20, max limit=100.
 * Soft deletes: deleted_at IS NULL on all reads.
 */

import { query, transaction } from '../../db/connection.js';
import { ok, created, badRequest, notFound, serverError } from '../../utils/response.js';
import { withAuth, withRole } from '../../middleware/auth.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const WAREHOUSE_ROLES = ['admin', 'manager', 'warehouse_keeper'];

function parsePage(qs) {
  const page  = Math.max(1, parseInt(qs?.page  ?? '1',  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(qs?.limit ?? '20', 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

// ─── 1. listShipments ────────────────────────────────────────────────────────

/**
 * GET /shipping
 * Query params: status, carrier_id, customer_id, date_from, date_to, page, limit
 */
export const listShipments = withAuth(async (event) => {
  try {
    const qs = event.queryStringParameters ?? {};
    const { page, limit, offset } = parsePage(qs);

    const conditions = ['s.deleted_at IS NULL'];
    const params = [];

    if (qs.status) {
      params.push(qs.status);
      conditions.push(`s.status = $${params.length}`);
    }
    if (qs.carrier_id) {
      params.push(qs.carrier_id);
      conditions.push(`s.carrier_id = $${params.length}`);
    }
    if (qs.customer_id) {
      params.push(qs.customer_id);
      conditions.push(`s.customer_id = $${params.length}`);
    }
    if (qs.date_from) {
      params.push(qs.date_from);
      conditions.push(`s.ship_date >= $${params.length}`);
    }
    if (qs.date_to) {
      params.push(qs.date_to);
      conditions.push(`s.ship_date <= $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM shipping.shipments s WHERE ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const rows = await query(
      `SELECT
            s.id,
            s.status,
            s.ship_date,
            s.tracking_no,
            s.service_type,
            s.freight_cost,
            s.created_at,
            s.packing_list_id,
            c.id             AS carrier_id,
            c.name           AS carrier_name,
            cu.id            AS customer_id,
            cu.name          AS customer_name
         FROM shipping.shipments s
         LEFT JOIN shipping.carriers c   ON c.id = s.carrier_id
         LEFT JOIN customers.customers cu ON cu.id = s.customer_id
        WHERE ${where}
        ORDER BY s.ship_date DESC, s.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return ok({
      data:       rows.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('listShipments error', err);
    return serverError('Failed to list shipments');
  }
});

// ─── 2. getShipment ──────────────────────────────────────────────────────────

/**
 * GET /shipping/{id}
 */
export const getShipment = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing shipment id');

    const shipmentResult = await query(
      `SELECT
            s.*,
            c.name           AS carrier_name,
            c.code           AS carrier_code,
            cu.name          AS customer_name
         FROM shipping.shipments s
         LEFT JOIN shipping.carriers c    ON c.id = s.carrier_id
         LEFT JOIN customers.customers cu ON cu.id = s.customer_id
        WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [id]
    );
    if (shipmentResult.rows.length === 0) return notFound('Shipment not found');

    const shipment = shipmentResult.rows[0];

    const [plResult, itemsResult] = await Promise.all([
      query(
        `SELECT pl.*
           FROM shipping.packing_lists pl
          WHERE pl.id = $1 AND pl.deleted_at IS NULL`,
        [shipment.packing_list_id]
      ),
      query(
        `SELECT
              pli.*,
              pr.name         AS product_name,
              pv.sku          AS variant_sku
           FROM shipping.packing_list_items pli
           LEFT JOIN products.products pr        ON pr.id = pli.product_id
           LEFT JOIN products.product_variants pv ON pv.id = pli.variant_id
          WHERE pli.packing_list_id = $1
          ORDER BY pli.id ASC`,
        [shipment.packing_list_id]
      ),
    ]);

    shipment.packing_list = plResult.rows[0] ?? null;
    shipment.items        = itemsResult.rows;
    return ok(shipment);
  } catch (err) {
    console.error('getShipment error', err);
    return serverError('Failed to retrieve shipment');
  }
});

// ─── 3. createPackingList ────────────────────────────────────────────────────

/**
 * POST /shipping/packing-lists
 * Body: production_order_id, notes, items[{product_id, variant_id, quantity_pairs, box_count, weight_kg}]
 */
export const createPackingList = withRole(WAREHOUSE_ROLES)(async (event) => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const { production_order_id, notes, items = [] } = body;

    if (!production_order_id) return badRequest('production_order_id is required');
    if (!Array.isArray(items) || items.length === 0) {
      return badRequest('items must be a non-empty array');
    }

    for (let i = 0; i < items.length; i++) {
      if (!items[i].product_id)      return badRequest(`items[${i}].product_id is required`);
      if (items[i].quantity_pairs == null) return badRequest(`items[${i}].quantity_pairs is required`);
      if (items[i].box_count == null)      return badRequest(`items[${i}].box_count is required`);
    }

    const result = await transaction(async (client) => {
      const plResult = await client.query(
        `INSERT INTO shipping.packing_lists
              (production_order_id, notes, status, created_at, updated_at)
         VALUES ($1, $2, 'pending', NOW(), NOW())
         RETURNING *`,
        [production_order_id, notes ?? null]
      );
      const packingList = plResult.rows[0];

      const insertedItems = [];
      for (const item of items) {
        const itemResult = await client.query(
          `INSERT INTO shipping.packing_list_items
                (packing_list_id, product_id, variant_id, quantity_pairs, box_count, weight_kg, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           RETURNING *`,
          [
            packingList.id,
            item.product_id,
            item.variant_id ?? null,
            item.quantity_pairs,
            item.box_count,
            item.weight_kg ?? null,
          ]
        );
        insertedItems.push(itemResult.rows[0]);
      }

      return { ...packingList, items: insertedItems };
    });

    return created(result);
  } catch (err) {
    console.error('createPackingList error', err);
    return serverError('Failed to create packing list');
  }
});

// ─── 4. createShipment ───────────────────────────────────────────────────────

/**
 * POST /shipping
 * Body: packing_list_id, carrier_id, customer_id, ship_date, tracking_no,
 *       service_type, freight_cost, notes
 *
 * Validates packing list exists and is not already shipped.
 * Transaction: insert shipment + set packing_list status='shipped'.
 */
export const createShipment = withRole(WAREHOUSE_ROLES)(async (event) => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const {
      packing_list_id, carrier_id, customer_id, ship_date,
      tracking_no, service_type, freight_cost, notes,
    } = body;

    if (!packing_list_id) return badRequest('packing_list_id is required');
    if (!carrier_id)      return badRequest('carrier_id is required');
    if (!customer_id)     return badRequest('customer_id is required');
    if (!ship_date)       return badRequest('ship_date is required');

    const plCheck = await query(
      `SELECT id, status FROM shipping.packing_lists
        WHERE id = $1 AND deleted_at IS NULL`,
      [packing_list_id]
    );
    if (plCheck.rows.length === 0) return notFound('Packing list not found');
    if (plCheck.rows[0].status === 'shipped') {
      return badRequest('Packing list has already been shipped');
    }

    const result = await transaction(async (client) => {
      const shipResult = await client.query(
        `INSERT INTO shipping.shipments
              (packing_list_id, carrier_id, customer_id, ship_date,
               tracking_no, service_type, freight_cost, notes,
               status, status_history, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 'created',
                 jsonb_build_array(jsonb_build_object(
                   'status', 'created',
                   'notes', 'Shipment created',
                   'status_date', $4::text,
                   'recorded_at', NOW()::text
                 )),
                 NOW(), NOW())
         RETURNING *`,
        [
          packing_list_id, carrier_id, customer_id, ship_date,
          tracking_no ?? null, service_type ?? null, freight_cost ?? null, notes ?? null,
        ]
      );
      const shipment = shipResult.rows[0];

      await client.query(
        `UPDATE shipping.packing_lists
            SET status = 'shipped', updated_at = NOW()
          WHERE id = $1`,
        [packing_list_id]
      );

      return shipment;
    });

    return created(result);
  } catch (err) {
    console.error('createShipment error', err);
    return serverError('Failed to create shipment');
  }
});

// ─── 5. updateShipmentStatus ─────────────────────────────────────────────────

/**
 * POST /shipping/{id}/status
 * Body: status (in_transit|delivered|returned), notes, status_date
 */
export const updateShipmentStatus = withRole(WAREHOUSE_ROLES)(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing shipment id');

    const body = JSON.parse(event.body ?? '{}');
    const { status, notes, status_date } = body;

    const VALID_STATUSES = ['in_transit', 'delivered', 'returned'];
    if (!status) return badRequest('status is required');
    if (!VALID_STATUSES.includes(status)) {
      return badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    if (!status_date) return badRequest('status_date is required');

    const existing = await query(
      `SELECT id, status FROM shipping.shipments
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) return notFound('Shipment not found');

    const historyEntry = {
      status,
      notes: notes ?? null,
      status_date,
      recorded_at: new Date().toISOString(),
    };

    const result = await query(
      `UPDATE shipping.shipments
          SET status         = $1,
              status_history = COALESCE(status_history, '[]'::jsonb) || $2::jsonb,
              updated_at     = NOW()
        WHERE id = $3
       RETURNING *`,
      [status, JSON.stringify(historyEntry), id]
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('updateShipmentStatus error', err);
    return serverError('Failed to update shipment status');
  }
});

// ─── 6. listCarriers ─────────────────────────────────────────────────────────

/**
 * GET /shipping/carriers
 * Returns all active (non-deleted) carriers ordered by name.
 */
export const listCarriers = withAuth(async (event) => {
  try {
    const result = await query(
      `SELECT id, name, code, contact_person, phone, email, country, created_at
         FROM shipping.carriers
        WHERE deleted_at IS NULL
        ORDER BY name ASC`,
      []
    );

    return ok(result.rows);
  } catch (err) {
    console.error('listCarriers error', err);
    return serverError('Failed to list carriers');
  }
});

// ─── 7. createCarrier ────────────────────────────────────────────────────────

/**
 * POST /shipping/carriers
 * Body: name, code, contact_person, phone, email, country
 */
export const createCarrier = withRole(['admin', 'manager'])(async (event) => {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const { name, code, contact_person, phone, email, country } = body;

    if (!name) return badRequest('name is required');
    if (!code) return badRequest('code is required');

    const codeCheck = await query(
      `SELECT id FROM shipping.carriers WHERE code = $1 AND deleted_at IS NULL`,
      [code.toUpperCase()]
    );
    if (codeCheck.rows.length > 0) {
      return badRequest(`Carrier with code '${code}' already exists`);
    }

    const result = await query(
      `INSERT INTO shipping.carriers
            (name, code, contact_person, phone, email, country, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [name, code.toUpperCase(), contact_person ?? null, phone ?? null, email ?? null, country ?? null]
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('createCarrier error', err);
    return serverError('Failed to create carrier');
  }
});

// ─── 8. getShippingStats ──────────────────────────────────────────────────────

/**
 * GET /shipping/stats
 * Returns:
 *   total_shipments_30d, on_time_rate_pct, avg_freight_cost,
 *   by_status{}, by_carrier (top 5), shipments_by_day (last 14 days)
 */
export const getShippingStats = withAuth(async (event) => {
  try {
    const [summaryResult, byStatusResult, byCarrierResult, byDayResult] = await Promise.all([
      query(
        `SELECT
              COUNT(*)                                                AS total_shipments_30d,
              ROUND(AVG(freight_cost)::numeric, 2)                   AS avg_freight_cost,
              ROUND(
                CASE WHEN COUNT(*) = 0 THEN 0
                     ELSE SUM(
                       CASE WHEN status = 'delivered'
                                 -- on-time: delivered within 7 days of ship_date as proxy
                                 AND (updated_at::date - ship_date) <= 7
                            THEN 1 ELSE 0
                       END
                     )::numeric / COUNT(*) * 100
                END, 2
              )                                                       AS on_time_rate_pct
           FROM shipping.shipments
          WHERE ship_date >= CURRENT_DATE - INTERVAL '30 days'
            AND deleted_at IS NULL`,
        []
      ),
      query(
        `SELECT status, COUNT(*) AS count
           FROM shipping.shipments
          WHERE deleted_at IS NULL
          GROUP BY status`,
        []
      ),
      query(
        `SELECT
              c.id            AS carrier_id,
              c.name          AS carrier_name,
              COUNT(s.id)     AS shipment_count,
              ROUND(SUM(s.freight_cost)::numeric, 2) AS total_freight
           FROM shipping.shipments s
           JOIN shipping.carriers c ON c.id = s.carrier_id
          WHERE s.ship_date >= CURRENT_DATE - INTERVAL '30 days'
            AND s.deleted_at IS NULL
          GROUP BY c.id, c.name
          ORDER BY shipment_count DESC
          LIMIT 5`,
        []
      ),
      query(
        `SELECT
              TO_CHAR(d.day, 'YYYY-MM-DD') AS ship_date,
              COUNT(s.id)                  AS total,
              SUM(CASE WHEN s.status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN s.status = 'in_transit' THEN 1 ELSE 0 END) AS in_transit
           FROM generate_series(
                  CURRENT_DATE - INTERVAL '13 days',
                  CURRENT_DATE,
                  '1 day'::interval
                ) AS d(day)
           LEFT JOIN shipping.shipments s
                  ON s.ship_date = d.day AND s.deleted_at IS NULL
          GROUP BY d.day
          ORDER BY d.day ASC`,
        []
      ),
    ]);

    const byStatus = {};
    for (const row of byStatusResult.rows) {
      byStatus[row.status] = parseInt(row.count, 10);
    }

    return ok({
      total_shipments_30d: parseInt(summaryResult.rows[0].total_shipments_30d, 10),
      on_time_rate_pct:    parseFloat(summaryResult.rows[0].on_time_rate_pct ?? 0),
      avg_freight_cost:    parseFloat(summaryResult.rows[0].avg_freight_cost ?? 0),
      by_status:           byStatus,
      by_carrier:          byCarrierResult.rows,
      shipments_by_day:    byDayResult.rows,
    });
  } catch (err) {
    console.error('getShippingStats error', err);
    return serverError('Failed to retrieve shipping stats');
  }
});

// ─── 9. listPackingLists ──────────────────────────────────────────────────────

/**
 * GET /shipping/packing-lists
 * Query params: status, production_order_id, page, limit
 */
export const listPackingLists = withAuth(async (event) => {
  try {
    const qs = event.queryStringParameters ?? {};
    const { page, limit, offset } = parsePage(qs);

    const conditions = ['pl.deleted_at IS NULL'];
    const params = [];

    if (qs.status) {
      params.push(qs.status);
      conditions.push(`pl.status = $${params.length}`);
    }
    if (qs.production_order_id) {
      params.push(qs.production_order_id);
      conditions.push(`pl.production_order_id = $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM shipping.packing_lists pl WHERE ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const rows = await query(
      `SELECT
            pl.id,
            pl.production_order_id,
            pl.status,
            pl.notes,
            pl.created_at,
            pl.updated_at,
            po.order_no        AS production_order_no,
            COUNT(pli.id)      AS item_count,
            SUM(pli.quantity_pairs) AS total_pairs,
            SUM(pli.weight_kg)      AS total_weight_kg
         FROM shipping.packing_lists pl
         LEFT JOIN production.production_orders po
                ON po.id = pl.production_order_id
         LEFT JOIN shipping.packing_list_items pli
                ON pli.packing_list_id = pl.id
        WHERE ${where}
        GROUP BY pl.id, po.order_no
        ORDER BY pl.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return ok({
      data:       rows.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('listPackingLists error', err);
    return serverError('Failed to list packing lists');
  }
});

// ─── 10. getPackingList ───────────────────────────────────────────────────────

/**
 * GET /shipping/packing-lists/{id}
 */
export const getPackingList = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters ?? {};
    if (!id) return badRequest('Missing packing list id');

    const plResult = await query(
      `SELECT
            pl.*,
            po.order_no AS production_order_no
         FROM shipping.packing_lists pl
         LEFT JOIN production.production_orders po ON po.id = pl.production_order_id
        WHERE pl.id = $1 AND pl.deleted_at IS NULL`,
      [id]
    );
    if (plResult.rows.length === 0) return notFound('Packing list not found');

    const packingList = plResult.rows[0];

    const itemsResult = await query(
      `SELECT
            pli.*,
            pr.name           AS product_name,
            pv.sku            AS variant_sku,
            pv.color          AS variant_color,
            pv.size           AS variant_size
         FROM shipping.packing_list_items pli
         LEFT JOIN products.products pr         ON pr.id = pli.product_id
         LEFT JOIN products.product_variants pv  ON pv.id = pli.variant_id
        WHERE pli.packing_list_id = $1
        ORDER BY pli.id ASC`,
      [id]
    );

    packingList.items = itemsResult.rows;
    return ok(packingList);
  } catch (err) {
    console.error('getPackingList error', err);
    return serverError('Failed to retrieve packing list');
  }
});
