/**
 * Customer management handlers for the Socks Factory ERP.
 *
 * Covers:
 *  - Customer master CRUD (list, get, create, update, soft-delete)
 *  - Contact management per customer (list, create)
 *  - Address management per customer (list, create)
 *
 * All handlers are exported as AWS Lambda-compatible async functions and
 * wrapped with the appropriate auth middleware before export.
 */

import { query, transaction } from '../db/connection.js';
import { ok, created, badRequest, notFound, serverError } from '../utils/response.js';
import { withAuth, withRole } from '../middleware/auth.js';

// ─── Customers ───────────────────────────────────────────────────────────────

async function listCustomers(event) {
  try {
    const {
      search,
      status,
      page: rawPage,
      limit: rawLimit,
    } = event.queryStringParameters || {};

    const page  = Math.max(1, parseInt(rawPage  || '1',  10));
    const limit = Math.min(100, Math.max(1, parseInt(rawLimit || '20', 10)));
    const offset = (page - 1) * limit;

    const conditions = ['c.deleted_at IS NULL'];
    const params     = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(c.name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.phone ILIKE $${params.length})`);
    }

    if (status === 'active') {
      conditions.push('c.is_active = TRUE');
    } else if (status === 'inactive') {
      conditions.push('c.is_active = FALSE');
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    // total count
    const countResult = await query(
      `SELECT COUNT(DISTINCT c.id) AS total
       FROM customers.customer_master c
       ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // paginated data
    params.push(limit, offset);
    const dataResult = await query(
      `SELECT c.*, COUNT(co.id)::int AS contact_count
       FROM customers.customer_master c
       LEFT JOIN customers.contacts co ON co.customer_id = c.id AND co.deleted_at IS NULL
       ${where}
       GROUP BY c.id
       ORDER BY c.name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return ok({ data: dataResult.rows, total, page, limit });
  } catch (err) {
    console.error('listCustomers error', err);
    return serverError('Failed to list customers');
  }
}

async function getCustomer(event) {
  try {
    const { id } = event.pathParameters || {};

    const customerResult = await query(
      `SELECT * FROM customers.customer_master WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );

    if (customerResult.rows.length === 0) {
      return notFound('Customer not found');
    }

    const customer = customerResult.rows[0];

    const [contactsResult, addressesResult] = await Promise.all([
      query(
        `SELECT * FROM customers.contacts WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY is_primary DESC, full_name`,
        [id],
      ),
      query(
        `SELECT * FROM customers.addresses WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY address_type, created_at`,
        [id],
      ),
    ]);

    return ok({
      ...customer,
      contacts:  contactsResult.rows,
      addresses: addressesResult.rows,
    });
  } catch (err) {
    console.error('getCustomer error', err);
    return serverError('Failed to get customer');
  }
}

async function createCustomer(event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const {
      name,
      code,
      email,
      phone,
      country,
      currency,
      payment_terms_days,
      credit_limit,
    } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return badRequest('name is required');
    }
    if (!code || typeof code !== 'string' || code.trim() === '') {
      return badRequest('code is required');
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return badRequest('Invalid email format');
    }
    if (payment_terms_days !== undefined && (!Number.isInteger(Number(payment_terms_days)) || Number(payment_terms_days) < 0)) {
      return badRequest('payment_terms_days must be a non-negative integer');
    }
    if (credit_limit !== undefined && isNaN(parseFloat(credit_limit))) {
      return badRequest('credit_limit must be a number');
    }

    // ensure code uniqueness
    const existing = await query(
      `SELECT id FROM customers.customer_master WHERE code = $1 AND deleted_at IS NULL`,
      [code.trim().toUpperCase()],
    );
    if (existing.rows.length > 0) {
      return badRequest('A customer with this code already exists');
    }

    const id = crypto.randomUUID();

    const result = await query(
      `INSERT INTO customers.customer_master
         (id, name, code, email, phone, country, currency, payment_terms_days, credit_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        name.trim(),
        code.trim().toUpperCase(),
        email   || null,
        phone   || null,
        country || null,
        currency || 'USD',
        payment_terms_days !== undefined ? Number(payment_terms_days) : 30,
        credit_limit       !== undefined ? parseFloat(credit_limit)   : null,
      ],
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('createCustomer error', err);
    return serverError('Failed to create customer');
  }
}

async function updateCustomer(event) {
  try {
    const { id } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');

    const existing = await query(
      `SELECT id FROM customers.customer_master WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (existing.rows.length === 0) {
      return notFound('Customer not found');
    }

    const allowed = [
      'name', 'email', 'phone', 'country', 'currency',
      'payment_terms_days', 'credit_limit', 'is_active',
    ];

    const setClauses = [];
    const params     = [];

    for (const field of allowed) {
      if (body[field] !== undefined) {
        params.push(body[field]);
        setClauses.push(`${field} = $${params.length}`);
      }
    }

    if (setClauses.length === 0) {
      return badRequest('No updatable fields provided');
    }

    params.push(id);
    const result = await query(
      `UPDATE customers.customer_master
       SET ${setClauses.join(', ')}, updated_at = now()
       WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING *`,
      params,
    );

    if (result.rows.length === 0) {
      return notFound('Customer not found');
    }

    return ok(result.rows[0]);
  } catch (err) {
    console.error('updateCustomer error', err);
    return serverError('Failed to update customer');
  }
}

async function deleteCustomer(event) {
  try {
    const { id } = event.pathParameters || {};

    const result = await query(
      `UPDATE customers.customer_master
       SET deleted_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [id],
    );

    if (result.rows.length === 0) {
      return notFound('Customer not found');
    }

    return ok(null, 204);
  } catch (err) {
    console.error('deleteCustomer error', err);
    return serverError('Failed to delete customer');
  }
}

// ─── Contacts ────────────────────────────────────────────────────────────────

async function listContacts(event) {
  try {
    const { id: customerId } = event.pathParameters || {};

    const customerCheck = await query(
      `SELECT id FROM customers.customer_master WHERE id = $1 AND deleted_at IS NULL`,
      [customerId],
    );
    if (customerCheck.rows.length === 0) {
      return notFound('Customer not found');
    }

    const result = await query(
      `SELECT * FROM customers.contacts
       WHERE customer_id = $1 AND deleted_at IS NULL
       ORDER BY is_primary DESC, full_name`,
      [customerId],
    );

    return ok(result.rows);
  } catch (err) {
    console.error('listContacts error', err);
    return serverError('Failed to list contacts');
  }
}

async function createContact(event) {
  try {
    const { id: customerId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { full_name, job_title, email, phone, is_primary } = body;

    if (!full_name || typeof full_name !== 'string' || full_name.trim() === '') {
      return badRequest('full_name is required');
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return badRequest('Invalid email format');
    }

    const customerCheck = await query(
      `SELECT id FROM customers.customer_master WHERE id = $1 AND deleted_at IS NULL`,
      [customerId],
    );
    if (customerCheck.rows.length === 0) {
      return notFound('Customer not found');
    }

    const id = crypto.randomUUID();

    // if this contact is primary, demote existing primaries
    if (is_primary) {
      await query(
        `UPDATE customers.contacts SET is_primary = FALSE WHERE customer_id = $1 AND deleted_at IS NULL`,
        [customerId],
      );
    }

    const result = await query(
      `INSERT INTO customers.contacts
         (id, customer_id, full_name, job_title, email, phone, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        customerId,
        full_name.trim(),
        job_title || null,
        email     || null,
        phone     || null,
        is_primary === true,
      ],
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('createContact error', err);
    return serverError('Failed to create contact');
  }
}

// ─── Addresses ───────────────────────────────────────────────────────────────

async function listAddresses(event) {
  try {
    const { id: customerId } = event.pathParameters || {};

    const customerCheck = await query(
      `SELECT id FROM customers.customer_master WHERE id = $1 AND deleted_at IS NULL`,
      [customerId],
    );
    if (customerCheck.rows.length === 0) {
      return notFound('Customer not found');
    }

    const result = await query(
      `SELECT * FROM customers.addresses
       WHERE customer_id = $1 AND deleted_at IS NULL
       ORDER BY address_type, created_at`,
      [customerId],
    );

    return ok(result.rows);
  } catch (err) {
    console.error('listAddresses error', err);
    return serverError('Failed to list addresses');
  }
}

async function createAddress(event) {
  try {
    const { id: customerId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const {
      address_type,
      line1,
      line2,
      city,
      state,
      postal_code,
      country,
    } = body;

    const validTypes = ['billing', 'shipping'];
    if (!address_type || !validTypes.includes(address_type)) {
      return badRequest('address_type must be "billing" or "shipping"');
    }
    if (!line1 || typeof line1 !== 'string' || line1.trim() === '') {
      return badRequest('line1 is required');
    }
    if (!city || typeof city !== 'string' || city.trim() === '') {
      return badRequest('city is required');
    }
    if (!country || typeof country !== 'string' || country.trim() === '') {
      return badRequest('country is required');
    }

    const customerCheck = await query(
      `SELECT id FROM customers.customer_master WHERE id = $1 AND deleted_at IS NULL`,
      [customerId],
    );
    if (customerCheck.rows.length === 0) {
      return notFound('Customer not found');
    }

    const id = crypto.randomUUID();

    const result = await query(
      `INSERT INTO customers.addresses
         (id, customer_id, address_type, line1, line2, city, state, postal_code, country)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        customerId,
        address_type,
        line1.trim(),
        line2       || null,
        city.trim(),
        state       || null,
        postal_code || null,
        country.trim(),
      ],
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('createAddress error', err);
    return serverError('Failed to create address');
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const listCustomersHandler  = withAuth(listCustomers);
export const getCustomerHandler    = withAuth(getCustomer);
export const createCustomerHandler = withRole(['admin', 'manager', 'sales_rep'])(createCustomer);
export const updateCustomerHandler = withRole(['admin', 'manager', 'sales_rep'])(updateCustomer);
export const deleteCustomerHandler = withRole(['admin', 'manager'])(deleteCustomer);
export const listContactsHandler   = withAuth(listContacts);
export const createContactHandler  = withRole(['admin', 'manager', 'sales_rep'])(createContact);
export const listAddressesHandler  = withAuth(listAddresses);
export const createAddressHandler  = withRole(['admin', 'manager', 'sales_rep'])(createAddress);
