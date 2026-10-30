/**
 * @module handlers/products
 * @description Lambda handlers for product catalogue management in the socks factory ERP.
 * Covers products, product variants, and product categories with pagination, filtering,
 * and role-based access control.
 */

import { query, transaction } from '../../db/connection.js';
import { ok, created, badRequest, notFound, serverError } from '../../utils/response.js';
import { withAuth, withRole } from '../../middleware/auth.js';

/**
 * GET /products
 * Returns a paginated list of products with optional filters.
 * Query params: category_id, is_active, search, page, limit
 */
export const listProducts = withAuth(async (event) => {
  try {
    const {
      category_id,
      is_active,
      search,
      page = '1',
      limit = '20',
    } = event.queryStringParameters || {};

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = ['p.deleted_at IS NULL'];
    const params = [];

    if (category_id) {
      params.push(category_id);
      conditions.push(`p.category_id = $${params.length}`);
    }

    if (is_active !== undefined) {
      params.push(is_active === 'true');
      conditions.push(`p.is_active = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
    }

    const where = conditions.join(' AND ');
    const countParams = [...params];

    params.push(limitNum);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT p.id, p.name, p.sku, p.category_id, c.name AS category_name,
                p.description, p.target_weight_g, p.composition, p.care_instructions,
                p.is_active, p.created_at, p.updated_at
         FROM products p
         LEFT JOIN product_categories c ON c.id = p.category_id
         WHERE ${where}
         ORDER BY p.name ASC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        params,
      ),
      query(`SELECT COUNT(*) AS total FROM products p WHERE ${where}`, countParams),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    return ok({
      data: dataResult.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error('listProducts error', err);
    return serverError('Failed to list products');
  }
});

/**
 * GET /products/{id}
 * Returns full product detail including variants and active BOM summary.
 */
export const getProduct = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters;

    const productResult = await query(
      `SELECT p.id, p.name, p.sku, p.category_id, c.name AS category_name,
              p.description, p.target_weight_g, p.composition, p.care_instructions,
              p.is_active, p.created_at, p.updated_at
       FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id],
    );

    if (productResult.rows.length === 0) {
      return notFound('Product not found');
    }

    const product = productResult.rows[0];

    const [variantsResult, bomResult] = await Promise.all([
      query(
        `SELECT pv.id, pv.size_id, s.label AS size_label,
                pv.colour_id, col.name AS colour_name,
                pv.barcode, pv.additional_weight_g, pv.is_active
         FROM product_variants pv
         LEFT JOIN sizes s ON s.id = pv.size_id
         LEFT JOIN colours col ON col.id = pv.colour_id
         WHERE pv.product_id = $1 AND pv.deleted_at IS NULL
         ORDER BY s.sort_order, col.name`,
        [id],
      ),
      query(
        `SELECT b.id AS bom_id, b.version,
                COUNT(bi.id) AS yarn_count,
                SUM(bi.quantity_kg) AS total_weight_kg
         FROM boms b
         LEFT JOIN bom_items bi ON bi.bom_id = b.id
         WHERE b.product_id = $1 AND b.status = 'active'
         GROUP BY b.id, b.version`,
        [id],
      ),
    ]);

    return ok({
      ...product,
      variants: variantsResult.rows,
      active_bom_summary: bomResult.rows[0] || null,
    });
  } catch (err) {
    console.error('getProduct error', err);
    return serverError('Failed to get product');
  }
});

/**
 * POST /products
 * Creates a new product. Requires admin or manager role.
 */
export const createProduct = withRole(['admin', 'manager'], async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, sku, category_id, description, target_weight_g, composition, care_instructions } = body;

    if (!name || !sku) {
      return badRequest('name and sku are required');
    }

    const existing = await query(
      'SELECT id FROM products WHERE sku = $1 AND deleted_at IS NULL',
      [sku],
    );
    if (existing.rows.length > 0) {
      return badRequest('A product with this SKU already exists');
    }

    const result = await query(
      `INSERT INTO products (name, sku, category_id, description, target_weight_g, composition, care_instructions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        name,
        sku,
        category_id || null,
        description || null,
        target_weight_g || null,
        composition ? JSON.stringify(composition) : null,
        care_instructions || null,
      ],
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('createProduct error', err);
    return serverError('Failed to create product');
  }
});

/**
 * PUT /products/{id}
 * Partially updates a product. Requires admin or manager role.
 */
export const updateProduct = withRole(['admin', 'manager'], async (event) => {
  try {
    const { id } = event.pathParameters;
    const body = JSON.parse(event.body || '{}');

    const existing = await query(
      'SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (existing.rows.length === 0) {
      return notFound('Product not found');
    }

    const allowedFields = [
      'name', 'sku', 'category_id', 'description',
      'target_weight_g', 'composition', 'care_instructions', 'is_active',
    ];
    const updates = [];
    const params = [];

    for (const field of allowedFields) {
      if (field in body) {
        params.push(field === 'composition' ? JSON.stringify(body[field]) : body[field]);
        updates.push(`${field} = $${params.length}`);
      }
    }

    if (updates.length === 0) {
      return badRequest('No valid fields provided for update');
    }

    updates.push('updated_at = now()');
    params.push(id);

    const result = await query(
      `UPDATE products SET ${updates.join(', ')}
       WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING *`,
      params,
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('updateProduct error', err);
    return serverError('Failed to update product');
  }
});

/**
 * DELETE /products/{id}
 * Soft-deletes a product. Requires admin role.
 * Returns 409 if there are active production orders referencing this product.
 */
export const deleteProduct = withRole(['admin'], async (event) => {
  try {
    const { id } = event.pathParameters;

    const existing = await query(
      'SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (existing.rows.length === 0) {
      return notFound('Product not found');
    }

    const activeOrders = await query(
      `SELECT id FROM production_orders
       WHERE product_id = $1 AND status NOT IN ('completed', 'cancelled') AND deleted_at IS NULL
       LIMIT 1`,
      [id],
    );
    if (activeOrders.rows.length > 0) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Cannot delete product with active production orders' }),
      };
    }

    await query(
      'UPDATE products SET deleted_at = now(), updated_at = now() WHERE id = $1',
      [id],
    );

    return ok({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error('deleteProduct error', err);
    return serverError('Failed to delete product');
  }
});

/**
 * GET /products/{id}/variants
 * Lists all variants for a product.
 */
export const listVariants = withAuth(async (event) => {
  try {
    const { id } = event.pathParameters;

    const productCheck = await query(
      'SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (productCheck.rows.length === 0) {
      return notFound('Product not found');
    }

    const result = await query(
      `SELECT pv.id, pv.product_id, pv.size_id, s.label AS size_label,
              pv.colour_id, col.name AS colour_name,
              pv.barcode, pv.additional_weight_g, pv.is_active,
              pv.created_at, pv.updated_at
       FROM product_variants pv
       LEFT JOIN sizes s ON s.id = pv.size_id
       LEFT JOIN colours col ON col.id = pv.colour_id
       WHERE pv.product_id = $1 AND pv.deleted_at IS NULL
       ORDER BY s.sort_order, col.name`,
      [id],
    );

    return ok(result.rows);
  } catch (err) {
    console.error('listVariants error', err);
    return serverError('Failed to list variants');
  }
});

/**
 * POST /products/{id}/variants
 * Creates a new variant for a product. Requires admin or manager role.
 */
export const createVariant = withRole(['admin', 'manager'], async (event) => {
  try {
    const { id } = event.pathParameters;
    const body = JSON.parse(event.body || '{}');
    const { size_id, colour_id, barcode, additional_weight_g } = body;

    if (!size_id || !colour_id) {
      return badRequest('size_id and colour_id are required');
    }

    const productCheck = await query(
      'SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (productCheck.rows.length === 0) {
      return notFound('Product not found');
    }

    const dupCheck = await query(
      `SELECT id FROM product_variants
       WHERE product_id = $1 AND size_id = $2 AND colour_id = $3 AND deleted_at IS NULL`,
      [id, size_id, colour_id],
    );
    if (dupCheck.rows.length > 0) {
      return badRequest('A variant with this size and colour already exists for this product');
    }

    const result = await query(
      `INSERT INTO product_variants (product_id, size_id, colour_id, barcode, additional_weight_g)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, size_id, colour_id, barcode || null, additional_weight_g || 0],
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('createVariant error', err);
    return serverError('Failed to create variant');
  }
});

/**
 * GET /products/categories
 * Returns all product categories.
 */
export const listCategories = withAuth(async (_event) => {
  try {
    const result = await query(
      `SELECT id, name, description, parent_id, sort_order, is_active, created_at, updated_at
       FROM product_categories
       WHERE deleted_at IS NULL
       ORDER BY sort_order, name`,
      [],
    );

    return ok(result.rows);
  } catch (err) {
    console.error('listCategories error', err);
    return serverError('Failed to list categories');
  }
});
