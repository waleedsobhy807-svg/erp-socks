/**
 * Sample request management handlers for the Socks Factory ERP.
 *
 * Covers the full sample lifecycle:
 *  - Listing and retrieving sample requests (with customer info, versions, feedback)
 *  - Creating and updating sample requests (draft / revision stage)
 *  - Submitting a request for review
 *  - Recording prototype versions (production supervisor)
 *  - Approving or rejecting samples (manager / admin), using transactions where
 *    two tables must be written atomically
 *
 * All handlers are exported as AWS Lambda-compatible async functions wrapped
 * with the appropriate auth middleware.
 */

import { query, transaction } from '../db/connection.js';
import { ok, created, badRequest, notFound, serverError } from '../utils/response.js';
import { withAuth, withRole } from '../middleware/auth.js';

// ─── Sample Requests ─────────────────────────────────────────────────────────

async function listSampleRequests(event) {
  try {
    const {
      customer_id,
      status,
      date_from,
      date_to,
      page: rawPage,
      limit: rawLimit,
    } = event.queryStringParameters || {};

    const page   = Math.max(1, parseInt(rawPage  || '1',  10));
    const limit  = Math.min(100, Math.max(1, parseInt(rawLimit || '20', 10)));
    const offset = (page - 1) * limit;

    const conditions = ['sr.deleted_at IS NULL'];
    const params     = [];

    if (customer_id) {
      params.push(customer_id);
      conditions.push(`sr.customer_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`sr.status = $${params.length}`);
    }
    if (date_from) {
      params.push(date_from);
      conditions.push(`sr.created_at >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      conditions.push(`sr.created_at <= $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await query(
      `SELECT COUNT(sr.id) AS total
       FROM samples.sample_requests sr
       ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const dataResult = await query(
      `SELECT sr.*, c.name AS customer_name
       FROM samples.sample_requests sr
       JOIN customers.customer_master c ON c.id = sr.customer_id
       ${where}
       ORDER BY sr.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return ok({ data: dataResult.rows, total, page, limit });
  } catch (err) {
    console.error('listSampleRequests error', err);
    return serverError('Failed to list sample requests');
  }
}

async function getSampleRequest(event) {
  try {
    const { id } = event.pathParameters || {};

    const sampleResult = await query(
      `SELECT sr.*, c.name AS customer_name
       FROM samples.sample_requests sr
       JOIN customers.customer_master c ON c.id = sr.customer_id
       WHERE sr.id = $1 AND sr.deleted_at IS NULL`,
      [id],
    );

    if (sampleResult.rows.length === 0) {
      return notFound('Sample request not found');
    }

    const sample = sampleResult.rows[0];

    const [versionsResult, feedbackResult] = await Promise.all([
      query(
        `SELECT * FROM samples.versions
         WHERE sample_request_id = $1
         ORDER BY version_number DESC`,
        [id],
      ),
      query(
        `SELECT * FROM samples.feedback
         WHERE sample_request_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [id],
      ),
    ]);

    return ok({
      ...sample,
      versions:        versionsResult.rows,
      latest_feedback: feedbackResult.rows[0] || null,
    });
  } catch (err) {
    console.error('getSampleRequest error', err);
    return serverError('Failed to get sample request');
  }
}

async function createSampleRequest(event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const {
      customer_id,
      product_description,
      target_delivery_date,
      specifications,
      reference_images_s3_keys,
    } = body;

    if (!customer_id) {
      return badRequest('customer_id is required');
    }
    if (!product_description || typeof product_description !== 'string' || product_description.trim() === '') {
      return badRequest('product_description is required');
    }
    if (target_delivery_date && isNaN(Date.parse(target_delivery_date))) {
      return badRequest('target_delivery_date must be a valid date');
    }
    if (specifications !== undefined && (typeof specifications !== 'object' || Array.isArray(specifications))) {
      return badRequest('specifications must be a JSON object');
    }
    if (reference_images_s3_keys !== undefined && !Array.isArray(reference_images_s3_keys)) {
      return badRequest('reference_images_s3_keys must be an array');
    }

    const customerCheck = await query(
      `SELECT id FROM customers.customer_master WHERE id = $1 AND deleted_at IS NULL`,
      [customer_id],
    );
    if (customerCheck.rows.length === 0) {
      return notFound('Customer not found');
    }

    const id = crypto.randomUUID();

    const result = await query(
      `INSERT INTO samples.sample_requests
         (id, customer_id, product_description, target_delivery_date, specifications,
          reference_images_s3_keys, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft')
       RETURNING *`,
      [
        id,
        customer_id,
        product_description.trim(),
        target_delivery_date || null,
        specifications              ? JSON.stringify(specifications)           : null,
        reference_images_s3_keys   ? JSON.stringify(reference_images_s3_keys) : null,
      ],
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('createSampleRequest error', err);
    return serverError('Failed to create sample request');
  }
}

async function updateSampleRequest(event) {
  try {
    const { id } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');

    const existing = await query(
      `SELECT id, status FROM samples.sample_requests WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (existing.rows.length === 0) {
      return notFound('Sample request not found');
    }

    const { status: currentStatus } = existing.rows[0];
    if (!['draft', 'revision_requested'].includes(currentStatus)) {
      return badRequest(`Sample request cannot be updated in status "${currentStatus}"`);
    }

    const allowed = [
      'product_description',
      'target_delivery_date',
      'specifications',
      'reference_images_s3_keys',
    ];

    const setClauses = [];
    const params     = [];

    for (const field of allowed) {
      if (body[field] !== undefined) {
        const value = (field === 'specifications' || field === 'reference_images_s3_keys')
          ? JSON.stringify(body[field])
          : body[field];
        params.push(value);
        setClauses.push(`${field} = $${params.length}`);
      }
    }

    if (setClauses.length === 0) {
      return badRequest('No updatable fields provided');
    }

    params.push(id);
    const result = await query(
      `UPDATE samples.sample_requests
       SET ${setClauses.join(', ')}, updated_at = now()
       WHERE id = $${params.length} AND deleted_at IS NULL
       RETURNING *`,
      params,
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('updateSampleRequest error', err);
    return serverError('Failed to update sample request');
  }
}

async function submitSampleRequest(event) {
  try {
    const { id } = event.pathParameters || {};

    const existing = await query(
      `SELECT id, status FROM samples.sample_requests WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (existing.rows.length === 0) {
      return notFound('Sample request not found');
    }

    const { status: currentStatus } = existing.rows[0];
    if (!['draft', 'revision_requested'].includes(currentStatus)) {
      return badRequest(`Only draft or revision_requested requests can be submitted (current: "${currentStatus}")`);
    }

    const result = await query(
      `UPDATE samples.sample_requests
       SET status = 'submitted', submitted_at = now(), updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [id],
    );

    return ok(result.rows[0]);
  } catch (err) {
    console.error('submitSampleRequest error', err);
    return serverError('Failed to submit sample request');
  }
}

// ─── Versions ────────────────────────────────────────────────────────────────

async function createSampleVersion(event) {
  try {
    const { id: sampleRequestId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { version_number, notes, prototype_s3_key, yarn_used } = body;

    if (version_number === undefined || version_number === null) {
      return badRequest('version_number is required');
    }
    if (!Number.isInteger(Number(version_number)) || Number(version_number) < 1) {
      return badRequest('version_number must be a positive integer');
    }

    const sampleCheck = await query(
      `SELECT id FROM samples.sample_requests WHERE id = $1 AND deleted_at IS NULL`,
      [sampleRequestId],
    );
    if (sampleCheck.rows.length === 0) {
      return notFound('Sample request not found');
    }

    // prevent duplicate version numbers
    const dupCheck = await query(
      `SELECT id FROM samples.versions WHERE sample_request_id = $1 AND version_number = $2`,
      [sampleRequestId, Number(version_number)],
    );
    if (dupCheck.rows.length > 0) {
      return badRequest(`Version ${version_number} already exists for this sample request`);
    }

    const id = crypto.randomUUID();

    const result = await query(
      `INSERT INTO samples.versions
         (id, sample_request_id, version_number, notes, prototype_s3_key, yarn_used)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        sampleRequestId,
        Number(version_number),
        notes            || null,
        prototype_s3_key || null,
        yarn_used        ? JSON.stringify(yarn_used) : null,
      ],
    );

    return created(result.rows[0]);
  } catch (err) {
    console.error('createSampleVersion error', err);
    return serverError('Failed to create sample version');
  }
}

// ─── Approvals & Rejections ──────────────────────────────────────────────────

async function approveSample(event) {
  try {
    const { id } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { approved_by_name, comments } = body;

    if (!approved_by_name || typeof approved_by_name !== 'string' || approved_by_name.trim() === '') {
      return badRequest('approved_by_name is required');
    }

    const existing = await query(
      `SELECT id, status FROM samples.sample_requests WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (existing.rows.length === 0) {
      return notFound('Sample request not found');
    }
    if (existing.rows[0].status === 'approved') {
      return badRequest('Sample request is already approved');
    }

    const approvalId = crypto.randomUUID();

    const result = await transaction(async (client) => {
      await client.query(
        `INSERT INTO samples.approvals
           (id, sample_request_id, approved_by_name, comments)
         VALUES ($1, $2, $3, $4)`,
        [approvalId, id, approved_by_name.trim(), comments || null],
      );

      const updated = await client.query(
        `UPDATE samples.sample_requests
         SET status = 'approved', updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING *`,
        [id],
      );

      return updated.rows[0];
    });

    return ok(result);
  } catch (err) {
    console.error('approveSample error', err);
    return serverError('Failed to approve sample');
  }
}

async function rejectSample(event) {
  try {
    const { id } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { comments } = body;

    if (!comments || typeof comments !== 'string' || comments.trim() === '') {
      return badRequest('comments are required when rejecting a sample');
    }

    const existing = await query(
      `SELECT id, status FROM samples.sample_requests WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (existing.rows.length === 0) {
      return notFound('Sample request not found');
    }

    const currentStatus = existing.rows[0].status;
    if (['approved', 'revision_requested'].includes(currentStatus)) {
      return badRequest(`Cannot reject a sample in status "${currentStatus}"`);
    }

    const feedbackId = crypto.randomUUID();

    await transaction(async (client) => {
      await client.query(
        `UPDATE samples.sample_requests
         SET status = 'revision_requested', updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );

      await client.query(
        `INSERT INTO samples.feedback
           (id, sample_request_id, comments)
         VALUES ($1, $2, $3)`,
        [feedbackId, id, comments.trim()],
      );
    });

    const updated = await query(
      `SELECT * FROM samples.sample_requests WHERE id = $1`,
      [id],
    );

    return ok(updated.rows[0]);
  } catch (err) {
    console.error('rejectSample error', err);
    return serverError('Failed to reject sample');
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const listSampleRequestsHandler  = withAuth(listSampleRequests);
export const getSampleRequestHandler    = withAuth(getSampleRequest);
export const createSampleRequestHandler = withRole(['admin', 'manager', 'sales_rep'])(createSampleRequest);
export const updateSampleRequestHandler = withRole(['admin', 'manager', 'sales_rep'])(updateSampleRequest);
export const submitSampleRequestHandler = withRole(['admin', 'manager', 'sales_rep'])(submitSampleRequest);
export const createSampleVersionHandler = withRole(['admin', 'manager', 'production_supervisor'])(createSampleVersion);
export const approveSampleHandler       = withRole(['admin', 'manager'])(approveSample);
export const rejectSampleHandler        = withRole(['admin', 'manager'])(rejectSample);
