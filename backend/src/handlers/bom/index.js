/**
 * @module handlers/bom
 * @description Lambda handlers for Bill of Materials (BOM) management in the socks factory ERP.
 * Covers BOM creation, versioning, activation/deactivation, and cost estimation using
 * yarn warehouse pricing data.
 */

import { query, transaction } from '../../db/connection.js';
import { ok, created, badRequest, notFound, serverError } from '../../utils/response.js';
import { withAuth, withRole } from '../../middleware/auth.js';

/**
 * GET /bom/{product_id}
 * Returns the active BOM header and all items with yarn details for a product.
 * Returns 404 if no active BOM exists.
 */
export const getBOM = withAuth(async (event) => {
  try {
    const { product_id } = event.pathParameters;

    const bomResult = await query(
      `SELECT b.id, b.product_id, b.version, b.status,
              b.effective_date, b.notes, b.created_at, b.updated_at
       FROM boms b
       WHERE b.product_id = $1 AND b.status = 'active' AND b.deleted_at IS NULL`,
      [product_id],
    );

    if (bomResult.rows.length === 0) {
      return notFound('No active BOM found for this product');
    }

    const bom = bomResult.rows[0];

    const itemsResult = await query(
      `SELECT bi.id, bi.yarn_item_id, yi.name AS yarn_name, yi.sku AS yarn_sku,
              yi.fibre_composition, bi.quantity_kg, bi.waste_factor_pct, bi.notes,
              bi.created_at
       FROM bom_items bi
       JOIN yarn_warehouse.yarn_items yi ON yi.id = bi.yarn_item_id
       WHERE bi.bom_id = $1
       ORDER BY yi.name`,
      [bom.id],
    );

    return ok({ ...bom, items: itemsResult.rows });
  } catch (err) {
    console.error('getBOM error', err);
    return serverError('Failed to get BOM');
  }
});

/**
 * POST /bom
 * Creates a new BOM with items in a transaction. Requires admin, manager, or production_supervisor role.
 * Ensures no other active BOM exists for the same product before creating.
 */
export const createBOM = withRole(['admin', 'manager', 'production_supervisor'], async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { product_id, version, effective_date, notes, items } = body;

    if (!product_id || !version) {
      return badRequest('product_id and version are required');
    }
    if (!Array.isArray(items) || items.length === 0) {
      return badRequest('items must be a non-empty array');
    }

    for (const item of items) {
      if (!item.yarn_item_id || item.quantity_kg == null) {
        return badRequest('Each item requires yarn_item_id and quantity_kg');
      }
    }

    const activeBOM = await query(
      `SELECT id FROM boms WHERE product_id = $1 AND status = 'active' AND deleted_at IS NULL`,
      [product_id],
    );
    if (activeBOM.rows.length > 0) {
      return badRequest('An active BOM already exists for this product. Deactivate it first or create as draft.');
    }

    const versionConflict = await query(
      `SELECT id FROM boms WHERE product_id = $1 AND version = $2 AND deleted_at IS NULL`,
      [product_id, version],
    );
    if (versionConflict.rows.length > 0) {
      return badRequest('A BOM with this version already exists for this product');
    }

    let newBOM;
    await transaction(async (client) => {
      const bomInsert = await client.query(
        `INSERT INTO boms (product_id, version, status, effective_date, notes)
         VALUES ($1, $2, 'draft', $3, $4)
         RETURNING *`,
        [product_id, version, effective_date || null, notes || null],
      );
      newBOM = bomInsert.rows[0];

      for (const item of items) {
        await client.query(
          `INSERT INTO bom_items (bom_id, yarn_item_id, quantity_kg, waste_factor_pct, notes)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            newBOM.id,
            item.yarn_item_id,
            item.quantity_kg,
            item.waste_factor_pct || 0,
            item.notes || null,
          ],
        );
      }
    });

    const itemsResult = await query(
      `SELECT bi.id, bi.yarn_item_id, yi.name AS yarn_name,
              bi.quantity_kg, bi.waste_factor_pct, bi.notes
       FROM bom_items bi
       JOIN yarn_warehouse.yarn_items yi ON yi.id = bi.yarn_item_id
       WHERE bi.bom_id = $1
       ORDER BY yi.name`,
      [newBOM.id],
    );

    return created({ ...newBOM, items: itemsResult.rows });
  } catch (err) {
    console.error('createBOM error', err);
    return serverError('Failed to create BOM');
  }
});

/**
 * PUT /bom/{id}
 * Updates BOM header fields and replaces items. Only allowed when status is 'draft'.
 * Requires admin, manager, or production_supervisor role.
 */
export const updateBOM = withRole(['admin', 'manager', 'production_supervisor'], async (event) => {
  try {
    const { id } = event.pathParameters;
    const body = JSON.parse(event.body || '{}');

    const bomResult = await query(
      'SELECT id, status FROM boms WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (bomResult.rows.length === 0) {
      return notFound('BOM not found');
    }

    const bom = bomResult.rows[0];
    if (bom.status !== 'draft') {
      return badRequest('Only draft BOMs can be updated');
    }

    const allowedHeader = ['version', 'effective_date', 'notes'];
    const updates = [];
    const params = [];

    for (const field of allowedHeader) {
      if (field in body) {
        params.push(body[field]);
        updates.push(`${field} = $${params.length}`);
      }
    }

    let updatedBOM;
    await transaction(async (client) => {
      if (updates.length > 0) {
        updates.push('updated_at = now()');
        params.push(id);
        const result = await client.query(
          `UPDATE boms SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        );
        updatedBOM = result.rows[0];
      } else {
        const result = await client.query('SELECT * FROM boms WHERE id = $1', [id]);
        updatedBOM = result.rows[0];
      }

      if (Array.isArray(body.items)) {
        if (body.items.length === 0) {
          throw new Error('items must be a non-empty array');
        }

        for (const item of body.items) {
          if (!item.yarn_item_id || item.quantity_kg == null) {
            throw new Error('Each item requires yarn_item_id and quantity_kg');
          }
        }

        await client.query('DELETE FROM bom_items WHERE bom_id = $1', [id]);

        for (const item of body.items) {
          await client.query(
            `INSERT INTO bom_items (bom_id, yarn_item_id, quantity_kg, waste_factor_pct, notes)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, item.yarn_item_id, item.quantity_kg, item.waste_factor_pct || 0, item.notes || null],
          );
        }
      }
    });

    const itemsResult = await query(
      `SELECT bi.id, bi.yarn_item_id, yi.name AS yarn_name,
              bi.quantity_kg, bi.waste_factor_pct, bi.notes
       FROM bom_items bi
       JOIN yarn_warehouse.yarn_items yi ON yi.id = bi.yarn_item_id
       WHERE bi.bom_id = $1
       ORDER BY yi.name`,
      [id],
    );

    return ok({ ...updatedBOM, items: itemsResult.rows });
  } catch (err) {
    if (err.message === 'items must be a non-empty array' ||
        err.message === 'Each item requires yarn_item_id and quantity_kg') {
      return badRequest(err.message);
    }
    console.error('updateBOM error', err);
    return serverError('Failed to update BOM');
  }
});

/**
 * POST /bom/{id}/activate
 * Activates a BOM. Deactivates any other active BOM for the same product in a transaction.
 * Requires admin or manager role.
 */
export const activateBOM = withRole(['admin', 'manager'], async (event) => {
  try {
    const { id } = event.pathParameters;

    const bomResult = await query(
      'SELECT id, product_id, status FROM boms WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (bomResult.rows.length === 0) {
      return notFound('BOM not found');
    }

    const bom = bomResult.rows[0];
    if (bom.status === 'active') {
      return badRequest('BOM is already active');
    }

    await transaction(async (client) => {
      await client.query(
        `UPDATE boms SET status = 'inactive', updated_at = now()
         WHERE product_id = $1 AND status = 'active' AND id != $2 AND deleted_at IS NULL`,
        [bom.product_id, id],
      );

      await client.query(
        `UPDATE boms SET status = 'active', updated_at = now() WHERE id = $1`,
        [id],
      );
    });

    const updated = await query('SELECT * FROM boms WHERE id = $1', [id]);
    return ok(updated.rows[0]);
  } catch (err) {
    console.error('activateBOM error', err);
    return serverError('Failed to activate BOM');
  }
});

/**
 * POST /bom/{id}/deactivate
 * Deactivates a BOM. Requires admin role.
 */
export const deactivateBOM = withRole(['admin'], async (event) => {
  try {
    const { id } = event.pathParameters;

    const bomResult = await query(
      'SELECT id, status FROM boms WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (bomResult.rows.length === 0) {
      return notFound('BOM not found');
    }

    if (bomResult.rows[0].status !== 'active') {
      return badRequest('Only active BOMs can be deactivated');
    }

    const updated = await query(
      `UPDATE boms SET status = 'inactive', updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id],
    );

    return ok(updated.rows[0]);
  } catch (err) {
    console.error('deactivateBOM error', err);
    return serverError('Failed to deactivate BOM');
  }
});

/**
 * GET /bom/{product_id}/versions
 * Returns all BOM headers for a product ordered by version descending.
 */
export const listBOMVersions = withAuth(async (event) => {
  try {
    const { product_id } = event.pathParameters;

    const productCheck = await query(
      'SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL',
      [product_id],
    );
    if (productCheck.rows.length === 0) {
      return notFound('Product not found');
    }

    const result = await query(
      `SELECT id, product_id, version, status, effective_date, notes, created_at, updated_at
       FROM boms
       WHERE product_id = $1 AND deleted_at IS NULL
       ORDER BY version DESC`,
      [product_id],
    );

    return ok(result.rows);
  } catch (err) {
    console.error('listBOMVersions error', err);
    return serverError('Failed to list BOM versions');
  }
});

/**
 * GET /bom/{product_id}/cost
 * Calculates estimated yarn cost for the active BOM of a product.
 * Joins yarn_warehouse.yarn_items for unit cost data.
 */
export const getBOMCost = withAuth(async (event) => {
  try {
    const { product_id } = event.pathParameters;

    const bomResult = await query(
      `SELECT id, version FROM boms
       WHERE product_id = $1 AND status = 'active' AND deleted_at IS NULL`,
      [product_id],
    );

    if (bomResult.rows.length === 0) {
      return notFound('No active BOM found for this product');
    }

    const bom = bomResult.rows[0];

    const itemsResult = await query(
      `SELECT bi.id, yi.name AS yarn_name, yi.sku AS yarn_sku,
              bi.quantity_kg, bi.waste_factor_pct,
              yi.unit_cost,
              ROUND(bi.quantity_kg * (1 + bi.waste_factor_pct / 100.0) * yi.unit_cost, 4) AS line_cost
       FROM bom_items bi
       JOIN yarn_warehouse.yarn_items yi ON yi.id = bi.yarn_item_id
       WHERE bi.bom_id = $1
       ORDER BY yi.name`,
      [bom.id],
    );

    const total_yarn_cost = itemsResult.rows.reduce(
      (sum, row) => sum + parseFloat(row.line_cost || 0),
      0,
    );

    return ok({
      product_id,
      bom_id: bom.id,
      bom_version: bom.version,
      total_yarn_cost: Math.round(total_yarn_cost * 10000) / 10000,
      items: itemsResult.rows.map((row) => ({
        yarn_name: row.yarn_name,
        yarn_sku: row.yarn_sku,
        qty_kg: parseFloat(row.quantity_kg),
        waste_factor_pct: parseFloat(row.waste_factor_pct),
        unit_cost: parseFloat(row.unit_cost),
        line_cost: parseFloat(row.line_cost),
      })),
    });
  } catch (err) {
    console.error('getBOMCost error', err);
    return serverError('Failed to calculate BOM cost');
  }
});
