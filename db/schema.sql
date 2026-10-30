-- =============================================================================
-- ERP SOCKS MANUFACTURING - PostgreSQL Database Schema
-- Generated: 2026-10-30
-- =============================================================================
-- Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "btree_gin";  -- composite indexes
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- text search indexes

-- =============================================================================
-- ENUM TYPES (global, defined before schemas)
-- =============================================================================

CREATE TYPE public.gender_type     AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');
CREATE TYPE public.unit_of_measure AS ENUM ('kg', 'g', 'meter', 'cone', 'pair', 'dozen', 'box', 'pallet', 'piece');
CREATE TYPE public.currency_code   AS ENUM ('USD', 'EUR', 'GBP', 'CNY', 'INR', 'BDT', 'VND', 'TRY');

-- =============================================================================
-- SCHEMA: auth
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS auth;
COMMENT ON SCHEMA auth IS 'Authentication, authorisation, roles and permissions. Cognito user_id is the external identity anchor.';

-- ---------- ENUMS ----------

CREATE TYPE auth.permission_action AS ENUM ('create', 'read', 'update', 'delete', 'approve', 'export', 'admin');

-- ---------- TABLES ----------

CREATE TABLE auth.roles (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL UNIQUE,
    description TEXT,
    is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);
COMMENT ON TABLE  auth.roles            IS 'Application roles (e.g. admin, manager, production_supervisor).';
COMMENT ON COLUMN auth.roles.is_system  IS 'System roles cannot be deleted via the UI.';

CREATE TABLE auth.permissions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    module      TEXT        NOT NULL,
    resource    TEXT        NOT NULL,
    action      auth.permission_action NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (module, resource, action)
);
COMMENT ON TABLE auth.permissions IS 'Fine-grained permission definitions per module/resource/action triple.';

CREATE TABLE auth.role_permissions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id       UUID        NOT NULL REFERENCES auth.roles(id)       ON DELETE RESTRICT,
    permission_id UUID        NOT NULL REFERENCES auth.permissions(id) ON DELETE RESTRICT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (role_id, permission_id)
);
COMMENT ON TABLE auth.role_permissions IS 'Many-to-many mapping of roles to permissions.';

CREATE TABLE auth.users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    cognito_user_id TEXT        NOT NULL UNIQUE,
    email           TEXT        NOT NULL UNIQUE,
    full_name       TEXT        NOT NULL,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
COMMENT ON TABLE  auth.users                 IS 'Internal user record linked to AWS Cognito via cognito_user_id.';
COMMENT ON COLUMN auth.users.cognito_user_id IS 'Cognito sub (UUID string). Used for JWT validation.';

CREATE TABLE auth.user_roles (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    role_id    UUID        NOT NULL REFERENCES auth.roles(id) ON DELETE RESTRICT,
    granted_by UUID        REFERENCES auth.users(id) ON DELETE RESTRICT,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    UNIQUE (user_id, role_id)
);
COMMENT ON TABLE auth.user_roles IS 'Role assignments; supports optional expiry for temporary privilege escalation.';

-- ---------- INDEXES ----------

CREATE INDEX idx_auth_users_cognito         ON auth.users(cognito_user_id);
CREATE INDEX idx_auth_users_email           ON auth.users(email);
CREATE INDEX idx_auth_users_deleted_at      ON auth.users(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_auth_user_roles_user_id    ON auth.user_roles(user_id);
CREATE INDEX idx_auth_user_roles_role_id    ON auth.user_roles(role_id);
CREATE INDEX idx_auth_role_perms_role_id    ON auth.role_permissions(role_id);
CREATE INDEX idx_auth_role_perms_perm_id    ON auth.role_permissions(permission_id);

-- =============================================================================
-- SCHEMA: customers
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS customers;
COMMENT ON SCHEMA customers IS 'Customer master data: companies, contacts, shipping/billing addresses, and price lists.';

-- ---------- ENUMS ----------

CREATE TYPE customers.customer_status AS ENUM ('prospect', 'active', 'on_hold', 'inactive', 'blacklisted');
CREATE TYPE customers.address_type    AS ENUM ('billing', 'shipping', 'headquarters', 'warehouse', 'other');
CREATE TYPE customers.price_list_type AS ENUM ('standard', 'wholesale', 'retail', 'contract', 'promotional');

-- ---------- TABLES ----------

CREATE TABLE customers.customers (
    id              UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT                     NOT NULL UNIQUE,
    company_name    TEXT                     NOT NULL,
    trade_name      TEXT,
    status          customers.customer_status NOT NULL DEFAULT 'prospect',
    currency        public.currency_code      NOT NULL DEFAULT 'USD',
    payment_terms   TEXT,
    credit_limit    NUMERIC(14,2),
    tax_id          TEXT,
    website         TEXT,
    notes           TEXT,
    created_by      UUID                     REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ              NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
COMMENT ON TABLE customers.customers IS 'Master record for each customer (B2B company).';
COMMENT ON COLUMN customers.customers.code IS 'Unique human-readable customer code, e.g. CUST-0001.';

CREATE TABLE customers.contacts (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID        NOT NULL REFERENCES customers.customers(id) ON DELETE RESTRICT,
    first_name   TEXT        NOT NULL,
    last_name    TEXT        NOT NULL,
    job_title    TEXT,
    email        TEXT,
    phone        TEXT,
    is_primary   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);
COMMENT ON TABLE customers.contacts IS 'Individual contact persons at a customer organisation.';

CREATE TABLE customers.addresses (
    id           UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID                     NOT NULL REFERENCES customers.customers(id) ON DELETE RESTRICT,
    address_type customers.address_type   NOT NULL DEFAULT 'shipping',
    address_line1 TEXT                    NOT NULL,
    address_line2 TEXT,
    city         TEXT                     NOT NULL,
    state        TEXT,
    postal_code  TEXT,
    country      TEXT                     NOT NULL,
    is_default   BOOLEAN                  NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ              NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);
COMMENT ON TABLE customers.addresses IS 'Shipping, billing and other address records per customer.';

CREATE TABLE customers.price_lists (
    id              UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID                      REFERENCES customers.customers(id) ON DELETE RESTRICT,
    name            TEXT                      NOT NULL,
    list_type       customers.price_list_type NOT NULL DEFAULT 'standard',
    currency        public.currency_code       NOT NULL DEFAULT 'USD',
    valid_from      DATE                       NOT NULL,
    valid_to        DATE,
    is_active       BOOLEAN                    NOT NULL DEFAULT TRUE,
    created_by      UUID                       REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ                NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ                NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
COMMENT ON TABLE  customers.price_lists             IS 'Named price lists; NULL customer_id means a global/default list.';
COMMENT ON COLUMN customers.price_lists.customer_id IS 'NULL = global price list; NOT NULL = customer-specific override.';

CREATE TABLE customers.price_list_items (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    price_list_id UUID        NOT NULL REFERENCES customers.price_lists(id) ON DELETE RESTRICT,
    product_id    UUID        NOT NULL,   -- FK added after products schema
    variant_id    UUID,                   -- FK added after products schema
    unit_price    NUMERIC(12,4) NOT NULL,
    min_qty       INTEGER     NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE customers.price_list_items IS 'Line-level pricing per product (or variant) within a price list.';

-- ---------- INDEXES ----------

CREATE INDEX idx_cust_customers_status       ON customers.customers(status);
CREATE INDEX idx_cust_customers_deleted_at   ON customers.customers(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_cust_contacts_customer_id   ON customers.contacts(customer_id);
CREATE INDEX idx_cust_addresses_customer_id  ON customers.addresses(customer_id);
CREATE INDEX idx_cust_pricelists_customer_id ON customers.price_lists(customer_id);
CREATE INDEX idx_cust_pricelists_active      ON customers.price_lists(is_active, valid_from, valid_to);
CREATE INDEX idx_cust_pli_price_list_id      ON customers.price_list_items(price_list_id);
CREATE INDEX idx_cust_pli_product_id         ON customers.price_list_items(product_id);

-- =============================================================================
-- SCHEMA: samples
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS samples;
COMMENT ON SCHEMA samples IS 'Sample requests from customers: versioning, approval workflow, and feedback tracking.';

-- ---------- ENUMS ----------

CREATE TYPE samples.sample_status   AS ENUM ('draft', 'submitted', 'in_production', 'ready_for_review', 'approved', 'rejected', 'cancelled');
CREATE TYPE samples.approval_status AS ENUM ('pending', 'approved', 'rejected', 'revision_requested');
CREATE TYPE samples.feedback_rating AS ENUM ('excellent', 'good', 'acceptable', 'needs_improvement', 'rejected');

-- ---------- TABLES ----------

CREATE TABLE samples.sample_requests (
    id            UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    request_no    TEXT                    NOT NULL UNIQUE,
    customer_id   UUID                    NOT NULL REFERENCES customers.customers(id) ON DELETE RESTRICT,
    title         TEXT                    NOT NULL,
    description   TEXT,
    due_date      DATE,
    status        samples.sample_status   NOT NULL DEFAULT 'draft',
    requested_by  UUID                    REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at    TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ             NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);
COMMENT ON TABLE samples.sample_requests IS 'Top-level sample request raised by a sales rep for a customer.';

CREATE TABLE samples.sample_versions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sample_request_id UUID       NOT NULL REFERENCES samples.sample_requests(id) ON DELETE RESTRICT,
    version_number   INTEGER     NOT NULL,
    notes            TEXT,
    yarn_spec        JSONB,
    design_file_url  TEXT,
    created_by       UUID        REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sample_request_id, version_number)
);
COMMENT ON TABLE  samples.sample_versions           IS 'Each iteration of a sample; version_number increments per request.';
COMMENT ON COLUMN samples.sample_versions.yarn_spec IS 'Snapshot of yarn specification JSON at time of version creation.';

CREATE TABLE samples.approvals (
    id                 UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
    sample_version_id  UUID                      NOT NULL REFERENCES samples.sample_versions(id) ON DELETE RESTRICT,
    approver_id        UUID                      NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    status             samples.approval_status   NOT NULL DEFAULT 'pending',
    comments           TEXT,
    decided_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ               NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ               NOT NULL DEFAULT now()
);
COMMENT ON TABLE samples.approvals IS 'Approval decision by an authorised user on a specific sample version.';

CREATE TABLE samples.feedbacks (
    id                UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    sample_version_id UUID                    NOT NULL REFERENCES samples.sample_versions(id) ON DELETE RESTRICT,
    submitted_by      UUID                    REFERENCES auth.users(id) ON DELETE RESTRICT,
    rating            samples.feedback_rating NOT NULL,
    comments          TEXT,
    attachments       JSONB,
    created_at        TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ             NOT NULL DEFAULT now()
);
COMMENT ON TABLE samples.feedbacks IS 'Customer or internal feedback on a sample version with rating and comments.';

-- ---------- INDEXES ----------

CREATE INDEX idx_samp_requests_customer_id    ON samples.sample_requests(customer_id);
CREATE INDEX idx_samp_requests_status         ON samples.sample_requests(status);
CREATE INDEX idx_samp_requests_deleted_at     ON samples.sample_requests(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_samp_versions_request_id     ON samples.sample_versions(sample_request_id);
CREATE INDEX idx_samp_approvals_version_id    ON samples.approvals(sample_version_id);
CREATE INDEX idx_samp_approvals_approver_id   ON samples.approvals(approver_id);
CREATE INDEX idx_samp_feedbacks_version_id    ON samples.feedbacks(sample_version_id);

-- =============================================================================
-- SCHEMA: products
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS products;
COMMENT ON SCHEMA products IS 'Product master, variant hierarchy (size/colour/style) and category taxonomy.';

-- ---------- ENUMS ----------

CREATE TYPE products.product_status  AS ENUM ('concept', 'development', 'active', 'discontinued', 'archived');
CREATE TYPE products.variant_status  AS ENUM ('active', 'inactive', 'discontinued');
CREATE TYPE products.sock_style      AS ENUM ('ankle', 'crew', 'knee_high', 'over_knee', 'no_show', 'toe_sock', 'compression', 'sport', 'dress', 'casual');
CREATE TYPE products.gender_segment  AS ENUM ('mens', 'womens', 'unisex', 'kids', 'infant');

-- ---------- TABLES ----------

CREATE TABLE products.categories (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id   UUID        REFERENCES products.categories(id) ON DELETE RESTRICT,
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,
    description TEXT,
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);
COMMENT ON TABLE  products.categories           IS 'Hierarchical product category tree.';
COMMENT ON COLUMN products.categories.parent_id IS 'NULL = root category.';

CREATE TABLE products.products (
    id              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    sku             TEXT                    NOT NULL UNIQUE,
    name            TEXT                    NOT NULL,
    description     TEXT,
    category_id     UUID                    REFERENCES products.categories(id) ON DELETE RESTRICT,
    style           products.sock_style     NOT NULL DEFAULT 'crew',
    gender_segment  products.gender_segment NOT NULL DEFAULT 'unisex',
    status          products.product_status NOT NULL DEFAULT 'concept',
    unit_of_measure public.unit_of_measure  NOT NULL DEFAULT 'pair',
    image_url       TEXT,
    weight_g        NUMERIC(8,2),
    tags            TEXT[],
    attributes      JSONB,
    created_by      UUID                    REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
COMMENT ON TABLE  products.products    IS 'Product master record for each sock style/design.';
COMMENT ON COLUMN products.products.attributes IS 'Flexible key-value store for extra product attributes.';

CREATE TABLE products.sizes (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code       TEXT        NOT NULL UNIQUE,
    label      TEXT        NOT NULL,
    sort_order INTEGER     NOT NULL DEFAULT 0
);
COMMENT ON TABLE products.sizes IS 'Reference table for sock size codes (e.g. S, M, L, 6-8, 9-11).';

CREATE TABLE products.colors (
    id          UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT   NOT NULL UNIQUE,
    name        TEXT   NOT NULL,
    hex_value   CHAR(7)
);
COMMENT ON TABLE products.colors IS 'Reference table for colour codes used in variants.';

CREATE TABLE products.variants (
    id          UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID                    NOT NULL REFERENCES products.products(id) ON DELETE RESTRICT,
    sku_variant TEXT                    NOT NULL UNIQUE,
    size_id     UUID                    REFERENCES products.sizes(id) ON DELETE RESTRICT,
    color_id    UUID                    REFERENCES products.colors(id) ON DELETE RESTRICT,
    status      products.variant_status NOT NULL DEFAULT 'active',
    barcode     TEXT,
    weight_g    NUMERIC(8,2),
    created_at  TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ             NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);
COMMENT ON TABLE products.variants IS 'Stock-keeping variant combining product + size + colour.';

-- ---------- INDEXES ----------

CREATE INDEX idx_prod_products_category_id   ON products.products(category_id);
CREATE INDEX idx_prod_products_status        ON products.products(status);
CREATE INDEX idx_prod_products_sku           ON products.products(sku);
CREATE INDEX idx_prod_products_deleted_at    ON products.products(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_prod_variants_product_id    ON products.variants(product_id);
CREATE INDEX idx_prod_variants_size_id       ON products.variants(size_id);
CREATE INDEX idx_prod_variants_color_id      ON products.variants(color_id);
CREATE INDEX idx_prod_variants_status        ON products.variants(status);
CREATE INDEX idx_prod_categories_parent_id   ON products.categories(parent_id);

-- ---------- DEFERRED FK now products schema exists ----------

ALTER TABLE customers.price_list_items
    ADD CONSTRAINT fk_pli_product_id FOREIGN KEY (product_id) REFERENCES products.products(id) ON DELETE RESTRICT;
ALTER TABLE customers.price_list_items
    ADD CONSTRAINT fk_pli_variant_id FOREIGN KEY (variant_id) REFERENCES products.variants(id) ON DELETE RESTRICT;

-- =============================================================================
-- SCHEMA: bom
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS bom;
COMMENT ON SCHEMA bom IS 'Bill of materials per product variant, including yarn specifications.';

-- ---------- ENUMS ----------

CREATE TYPE bom.bom_status    AS ENUM ('draft', 'active', 'superseded', 'archived');
CREATE TYPE bom.yarn_ply      AS ENUM ('1ply', '2ply', '3ply', '4ply', '6ply', '8ply');
CREATE TYPE bom.yarn_type     AS ENUM ('cotton', 'merino_wool', 'acrylic', 'nylon', 'polyester', 'bamboo', 'cashmere', 'modal', 'lycra_spandex', 'recycled_polyester', 'blended');

-- ---------- TABLES ----------

CREATE TABLE bom.yarn_specs (
    id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    code             TEXT           NOT NULL UNIQUE,
    name             TEXT           NOT NULL,
    yarn_type        bom.yarn_type  NOT NULL,
    ply              bom.yarn_ply   NOT NULL DEFAULT '2ply',
    count_nm         NUMERIC(8,2),     -- yarn count in metric number
    count_ne         NUMERIC(8,2),     -- yarn count in English number
    composition_pct  JSONB          NOT NULL DEFAULT '{}'::JSONB,
    supplier         TEXT,
    color_fastness   TEXT,
    tensile_strength NUMERIC(8,2),
    notes            TEXT,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);
COMMENT ON TABLE  bom.yarn_specs                IS 'Yarn specification library; referenced by BOM items.';
COMMENT ON COLUMN bom.yarn_specs.composition_pct IS 'JSON map of fibre -> percentage, e.g. {"cotton": 75, "polyester": 25}.';

CREATE TABLE bom.boms (
    id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID           NOT NULL REFERENCES products.products(id) ON DELETE RESTRICT,
    variant_id  UUID           REFERENCES products.variants(id) ON DELETE RESTRICT,
    version     INTEGER        NOT NULL DEFAULT 1,
    status      bom.bom_status NOT NULL DEFAULT 'draft',
    notes       TEXT,
    approved_by UUID           REFERENCES auth.users(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ,
    created_by  UUID           REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE (product_id, variant_id, version)
);
COMMENT ON TABLE bom.boms IS 'Versioned bill of materials header linked to a product (or specific variant).';

CREATE TABLE bom.bom_items (
    id            UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id        UUID                  NOT NULL REFERENCES bom.boms(id) ON DELETE RESTRICT,
    yarn_spec_id  UUID                  NOT NULL REFERENCES bom.yarn_specs(id) ON DELETE RESTRICT,
    sequence      INTEGER               NOT NULL,
    quantity      NUMERIC(12,4)         NOT NULL,
    uom           public.unit_of_measure NOT NULL DEFAULT 'g',
    scrap_pct     NUMERIC(5,2)          NOT NULL DEFAULT 0,
    notes         TEXT,
    created_at    TIMESTAMPTZ           NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ           NOT NULL DEFAULT now()
);
COMMENT ON TABLE  bom.bom_items          IS 'Individual material line within a BOM.';
COMMENT ON COLUMN bom.bom_items.scrap_pct IS 'Expected scrap percentage added on top of quantity for planning.';

-- ---------- INDEXES ----------

CREATE INDEX idx_bom_boms_product_id    ON bom.boms(product_id);
CREATE INDEX idx_bom_boms_variant_id    ON bom.boms(variant_id);
CREATE INDEX idx_bom_boms_status        ON bom.boms(status);
CREATE INDEX idx_bom_items_bom_id       ON bom.bom_items(bom_id);
CREATE INDEX idx_bom_items_yarn_spec_id ON bom.bom_items(yarn_spec_id);
CREATE INDEX idx_bom_yarn_specs_type    ON bom.yarn_specs(yarn_type);
CREATE INDEX idx_bom_yarn_specs_deleted ON bom.yarn_specs(deleted_at) WHERE deleted_at IS NULL;

-- =============================================================================
-- SCHEMA: yarn_warehouse
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS yarn_warehouse;
COMMENT ON SCHEMA yarn_warehouse IS 'Yarn inventory: stock items, locations, receipts, issues and adjustments.';

-- ---------- ENUMS ----------

CREATE TYPE yarn_warehouse.transaction_type  AS ENUM ('receipt', 'issue', 'adjustment', 'transfer', 'return', 'scrap');
CREATE TYPE yarn_warehouse.receipt_status    AS ENUM ('pending', 'in_transit', 'received', 'qc_hold', 'accepted', 'rejected');
CREATE TYPE yarn_warehouse.location_type     AS ENUM ('rack', 'bin', 'floor', 'quarantine', 'outgoing');

-- ---------- TABLES ----------

CREATE TABLE yarn_warehouse.stock_locations (
    id            UUID                           PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT                           NOT NULL UNIQUE,
    name          TEXT                           NOT NULL,
    location_type yarn_warehouse.location_type   NOT NULL DEFAULT 'rack',
    aisle         TEXT,
    rack          TEXT,
    level         TEXT,
    capacity_kg   NUMERIC(10,2),
    is_active     BOOLEAN                        NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ                    NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ                    NOT NULL DEFAULT now()
);
COMMENT ON TABLE yarn_warehouse.stock_locations IS 'Physical storage locations within the yarn warehouse.';

CREATE TABLE yarn_warehouse.yarn_items (
    id              UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
    yarn_spec_id    UUID                  NOT NULL REFERENCES bom.yarn_specs(id) ON DELETE RESTRICT,
    lot_number      TEXT                  NOT NULL,
    location_id     UUID                  REFERENCES yarn_warehouse.stock_locations(id) ON DELETE RESTRICT,
    quantity_on_hand NUMERIC(14,4)        NOT NULL DEFAULT 0,
    quantity_reserved NUMERIC(14,4)       NOT NULL DEFAULT 0,
    uom             public.unit_of_measure NOT NULL DEFAULT 'kg',
    expiry_date     DATE,
    cost_per_unit   NUMERIC(12,4),
    currency        public.currency_code   NOT NULL DEFAULT 'USD',
    created_at      TIMESTAMPTZ            NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ            NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT chk_qty_non_negative   CHECK (quantity_on_hand  >= 0),
    CONSTRAINT chk_reserved_non_negative CHECK (quantity_reserved >= 0),
    CONSTRAINT chk_reserved_lte_on_hand  CHECK (quantity_reserved <= quantity_on_hand)
);
COMMENT ON TABLE  yarn_warehouse.yarn_items                  IS 'Lot-level yarn inventory record with current on-hand and reserved quantities.';
COMMENT ON COLUMN yarn_warehouse.yarn_items.quantity_reserved IS 'Quantity allocated to open production orders, not yet consumed.';

CREATE TABLE yarn_warehouse.receipts (
    id             UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_no     TEXT                          NOT NULL UNIQUE,
    yarn_spec_id   UUID                          NOT NULL REFERENCES bom.yarn_specs(id) ON DELETE RESTRICT,
    supplier       TEXT                          NOT NULL,
    po_number      TEXT,
    lot_number     TEXT                          NOT NULL,
    quantity       NUMERIC(14,4)                 NOT NULL,
    uom            public.unit_of_measure         NOT NULL DEFAULT 'kg',
    received_date  DATE                          NOT NULL,
    status         yarn_warehouse.receipt_status NOT NULL DEFAULT 'pending',
    location_id    UUID                          REFERENCES yarn_warehouse.stock_locations(id) ON DELETE RESTRICT,
    cost_per_unit  NUMERIC(12,4),
    currency       public.currency_code           NOT NULL DEFAULT 'USD',
    notes          TEXT,
    received_by    UUID                          REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at     TIMESTAMPTZ                   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ                   NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ
);
COMMENT ON TABLE yarn_warehouse.receipts IS 'Goods receipt records for incoming yarn shipments.';

CREATE TABLE yarn_warehouse.issues (
    id               UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_no         TEXT                          NOT NULL UNIQUE,
    yarn_item_id     UUID                          NOT NULL REFERENCES yarn_warehouse.yarn_items(id) ON DELETE RESTRICT,
    work_order_id    UUID,                          -- FK deferred to manufacturing schema
    quantity_issued  NUMERIC(14,4)                 NOT NULL,
    uom              public.unit_of_measure         NOT NULL DEFAULT 'kg',
    issued_at        TIMESTAMPTZ                   NOT NULL DEFAULT now(),
    issued_by        UUID                          REFERENCES auth.users(id) ON DELETE RESTRICT,
    notes            TEXT,
    created_at       TIMESTAMPTZ                   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ                   NOT NULL DEFAULT now()
);
COMMENT ON TABLE yarn_warehouse.issues IS 'Records of yarn issued from stock to a production work order.';

CREATE TABLE yarn_warehouse.stock_adjustments (
    id               UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
    adj_no           TEXT                          NOT NULL UNIQUE,
    yarn_item_id     UUID                          NOT NULL REFERENCES yarn_warehouse.yarn_items(id) ON DELETE RESTRICT,
    transaction_type yarn_warehouse.transaction_type NOT NULL DEFAULT 'adjustment',
    quantity_delta   NUMERIC(14,4)                 NOT NULL,
    uom              public.unit_of_measure         NOT NULL DEFAULT 'kg',
    reason           TEXT                          NOT NULL,
    approved_by      UUID                          REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_by       UUID                          REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at       TIMESTAMPTZ                   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ                   NOT NULL DEFAULT now()
);
COMMENT ON TABLE  yarn_warehouse.stock_adjustments             IS 'Manual stock adjustments (positive or negative delta) with audit trail.';
COMMENT ON COLUMN yarn_warehouse.stock_adjustments.quantity_delta IS 'Positive = stock increase; negative = stock decrease.';

-- ---------- INDEXES ----------

CREATE INDEX idx_yw_locations_type         ON yarn_warehouse.stock_locations(location_type);
CREATE INDEX idx_yw_yarn_items_spec_id     ON yarn_warehouse.yarn_items(yarn_spec_id);
CREATE INDEX idx_yw_yarn_items_location_id ON yarn_warehouse.yarn_items(location_id);
CREATE INDEX idx_yw_yarn_items_lot         ON yarn_warehouse.yarn_items(lot_number);
CREATE INDEX idx_yw_receipts_spec_id       ON yarn_warehouse.receipts(yarn_spec_id);
CREATE INDEX idx_yw_receipts_status        ON yarn_warehouse.receipts(status);
CREATE INDEX idx_yw_issues_yarn_item_id    ON yarn_warehouse.issues(yarn_item_id);
CREATE INDEX idx_yw_issues_work_order_id   ON yarn_warehouse.issues(work_order_id);
CREATE INDEX idx_yw_adj_yarn_item_id       ON yarn_warehouse.stock_adjustments(yarn_item_id);

-- =============================================================================
-- SCHEMA: planning
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS planning;
COMMENT ON SCHEMA planning IS 'Production planning: orders, lines, schedules and capacity planning.';

-- ---------- ENUMS ----------

CREATE TYPE planning.order_status    AS ENUM ('draft', 'confirmed', 'in_production', 'completed', 'cancelled', 'on_hold');
CREATE TYPE planning.schedule_status AS ENUM ('planned', 'released', 'started', 'paused', 'completed', 'cancelled');
CREATE TYPE planning.priority        AS ENUM ('low', 'normal', 'high', 'urgent', 'critical');

-- ---------- TABLES ----------

CREATE TABLE planning.production_orders (
    id              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    order_no        TEXT                    NOT NULL UNIQUE,
    customer_id     UUID                    REFERENCES customers.customers(id) ON DELETE RESTRICT,
    status          planning.order_status   NOT NULL DEFAULT 'draft',
    priority        planning.priority       NOT NULL DEFAULT 'normal',
    requested_date  DATE,
    planned_start   DATE,
    planned_end     DATE,
    notes           TEXT,
    created_by      UUID                    REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
COMMENT ON TABLE planning.production_orders IS 'Top-level production order, potentially covering multiple products/variants.';

CREATE TABLE planning.order_lines (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    production_order_id UUID       NOT NULL REFERENCES planning.production_orders(id) ON DELETE RESTRICT,
    product_id         UUID        NOT NULL REFERENCES products.products(id) ON DELETE RESTRICT,
    variant_id         UUID        REFERENCES products.variants(id) ON DELETE RESTRICT,
    bom_id             UUID        REFERENCES bom.boms(id) ON DELETE RESTRICT,
    planned_qty        INTEGER     NOT NULL,
    produced_qty       INTEGER     NOT NULL DEFAULT 0,
    uom                public.unit_of_measure NOT NULL DEFAULT 'pair',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE planning.order_lines IS 'Individual product-variant line within a production order.';

CREATE TABLE planning.schedules (
    id                UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
    order_line_id     UUID                      NOT NULL REFERENCES planning.order_lines(id) ON DELETE RESTRICT,
    status            planning.schedule_status  NOT NULL DEFAULT 'planned',
    scheduled_start   TIMESTAMPTZ               NOT NULL,
    scheduled_end     TIMESTAMPTZ               NOT NULL,
    actual_start      TIMESTAMPTZ,
    actual_end        TIMESTAMPTZ,
    machine_id        UUID,                      -- FK deferred to machines schema
    shift             TEXT,
    notes             TEXT,
    created_by        UUID                      REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at        TIMESTAMPTZ               NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ               NOT NULL DEFAULT now()
);
COMMENT ON TABLE planning.schedules IS 'Detailed schedule record assigning an order line to a time window and machine.';

CREATE TABLE planning.capacity_plans (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_week       DATE        NOT NULL,         -- Monday of the week
    machine_id      UUID,                         -- FK deferred to machines schema
    available_hours NUMERIC(6,2) NOT NULL,
    planned_hours   NUMERIC(6,2) NOT NULL DEFAULT 0,
    notes           TEXT,
    created_by      UUID        REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_week, machine_id)
);
COMMENT ON TABLE  planning.capacity_plans          IS 'Weekly capacity plan per machine; available vs. planned hours.';
COMMENT ON COLUMN planning.capacity_plans.plan_week IS 'Always stored as Monday of the ISO week for consistency.';

-- ---------- INDEXES ----------

CREATE INDEX idx_plan_orders_customer_id  ON planning.production_orders(customer_id);
CREATE INDEX idx_plan_orders_status       ON planning.production_orders(status);
CREATE INDEX idx_plan_orders_priority     ON planning.production_orders(priority);
CREATE INDEX idx_plan_orders_deleted_at   ON planning.production_orders(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_plan_lines_order_id      ON planning.order_lines(production_order_id);
CREATE INDEX idx_plan_lines_product_id    ON planning.order_lines(product_id);
CREATE INDEX idx_plan_lines_variant_id    ON planning.order_lines(variant_id);
CREATE INDEX idx_plan_schedules_line_id   ON planning.schedules(order_line_id);
CREATE INDEX idx_plan_schedules_machine   ON planning.schedules(machine_id);
CREATE INDEX idx_plan_capacity_week       ON planning.capacity_plans(plan_week);

-- =============================================================================
-- SCHEMA: machines
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS machines;
COMMENT ON SCHEMA machines IS 'Machine registry, preventive maintenance schedules, and downtime tracking.';

-- ---------- ENUMS ----------

CREATE TYPE machines.machine_status    AS ENUM ('operational', 'maintenance', 'breakdown', 'decommissioned', 'standby');
CREATE TYPE machines.maintenance_type  AS ENUM ('preventive', 'corrective', 'predictive', 'calibration', 'overhaul');
CREATE TYPE machines.downtime_cause    AS ENUM ('breakdown', 'planned_maintenance', 'material_shortage', 'power_failure', 'operator_absence', 'quality_issue', 'changeover', 'other');
CREATE TYPE machines.machine_type      AS ENUM ('circular_knitting', 'flat_knitting', 'linking', 'boarding', 'dyeing', 'inspection', 'packaging', 'embroidery', 'printing');

-- ---------- TABLES ----------

CREATE TABLE machines.machines (
    id              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_code      TEXT                    NOT NULL UNIQUE,
    name            TEXT                    NOT NULL,
    machine_type    machines.machine_type   NOT NULL,
    manufacturer    TEXT,
    model           TEXT,
    serial_number   TEXT,
    purchase_date   DATE,
    installation_date DATE,
    status          machines.machine_status NOT NULL DEFAULT 'operational',
    location        TEXT,
    gauge           TEXT,                    -- e.g. "144 needles"
    max_rpm         INTEGER,
    notes           TEXT,
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
COMMENT ON TABLE  machines.machines      IS 'Master record for each piece of manufacturing equipment.';
COMMENT ON COLUMN machines.machines.gauge IS 'Needle gauge for knitting machines, e.g. 144F.';

CREATE TABLE machines.maintenance_logs (
    id               UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id       UUID                      NOT NULL REFERENCES machines.machines(id) ON DELETE RESTRICT,
    maintenance_type machines.maintenance_type NOT NULL DEFAULT 'preventive',
    scheduled_date   DATE                      NOT NULL,
    actual_date      DATE,
    technician       TEXT,
    cost             NUMERIC(12,2),
    currency         public.currency_code       NOT NULL DEFAULT 'USD',
    description      TEXT                      NOT NULL,
    parts_replaced   JSONB,
    next_due_date    DATE,
    created_by       UUID                      REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at       TIMESTAMPTZ               NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ               NOT NULL DEFAULT now()
);
COMMENT ON TABLE  machines.maintenance_logs              IS 'Log of all maintenance activities per machine.';
COMMENT ON COLUMN machines.maintenance_logs.parts_replaced IS 'JSON array of replaced part names and quantities.';

CREATE TABLE machines.downtime_records (
    id            UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id    UUID                    NOT NULL REFERENCES machines.machines(id) ON DELETE RESTRICT,
    started_at    TIMESTAMPTZ             NOT NULL,
    ended_at      TIMESTAMPTZ,
    duration_min  INTEGER GENERATED ALWAYS AS (
                      CASE WHEN ended_at IS NOT NULL
                           THEN EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER / 60
                           ELSE NULL END
                  ) STORED,
    cause         machines.downtime_cause NOT NULL DEFAULT 'breakdown',
    description   TEXT,
    reported_by   UUID                    REFERENCES auth.users(id) ON DELETE RESTRICT,
    resolved_by   UUID                    REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at    TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ             NOT NULL DEFAULT now()
);
COMMENT ON TABLE  machines.downtime_records              IS 'Records each downtime event; duration_min is auto-computed.';
COMMENT ON COLUMN machines.downtime_records.duration_min IS 'Computed column: (ended_at - started_at) in minutes.';

-- ---------- INDEXES ----------

CREATE INDEX idx_mach_machines_type        ON machines.machines(machine_type);
CREATE INDEX idx_mach_machines_status      ON machines.machines(status);
CREATE INDEX idx_mach_machines_deleted_at  ON machines.machines(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_mach_maint_machine_id     ON machines.maintenance_logs(machine_id);
CREATE INDEX idx_mach_maint_scheduled      ON machines.maintenance_logs(scheduled_date);
CREATE INDEX idx_mach_downtime_machine_id  ON machines.downtime_records(machine_id);
CREATE INDEX idx_mach_downtime_started_at  ON machines.downtime_records(started_at);

-- ---------- DEFERRED FKs to machines ----------

ALTER TABLE planning.schedules
    ADD CONSTRAINT fk_schedules_machine_id
    FOREIGN KEY (machine_id) REFERENCES machines.machines(id) ON DELETE RESTRICT;

ALTER TABLE planning.capacity_plans
    ADD CONSTRAINT fk_capacity_machine_id
    FOREIGN KEY (machine_id) REFERENCES machines.machines(id) ON DELETE RESTRICT;

-- =============================================================================
-- SCHEMA: manufacturing
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS manufacturing;
COMMENT ON SCHEMA manufacturing IS 'Shop-floor execution: work orders, process steps, machine assignments, and production logs.';

-- ---------- ENUMS ----------

CREATE TYPE manufacturing.wo_status   AS ENUM ('draft', 'released', 'in_progress', 'paused', 'completed', 'cancelled', 'scrapped');
CREATE TYPE manufacturing.step_status AS ENUM ('pending', 'in_progress', 'completed', 'skipped', 'failed');
CREATE TYPE manufacturing.log_type    AS ENUM ('output', 'scrap', 'rework', 'downtime', 'material_consumption', 'note');

-- ---------- TABLES ----------

CREATE TABLE manufacturing.work_orders (
    id                  UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_number           TEXT                     NOT NULL UNIQUE,
    order_line_id       UUID                     NOT NULL REFERENCES planning.order_lines(id) ON DELETE RESTRICT,
    status              manufacturing.wo_status  NOT NULL DEFAULT 'draft',
    planned_qty         INTEGER                  NOT NULL,
    produced_qty        INTEGER                  NOT NULL DEFAULT 0,
    scrap_qty           INTEGER                  NOT NULL DEFAULT 0,
    rework_qty          INTEGER                  NOT NULL DEFAULT 0,
    planned_start       TIMESTAMPTZ,
    planned_end         TIMESTAMPTZ,
    actual_start        TIMESTAMPTZ,
    actual_end          TIMESTAMPTZ,
    supervisor_id       UUID                     REFERENCES auth.users(id) ON DELETE RESTRICT,
    notes               TEXT,
    created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);
COMMENT ON TABLE manufacturing.work_orders IS 'Shop floor work order derived from a planning order line.';

CREATE TABLE manufacturing.work_order_steps (
    id              UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id   UUID                       NOT NULL REFERENCES manufacturing.work_orders(id) ON DELETE RESTRICT,
    step_number     INTEGER                    NOT NULL,
    step_name       TEXT                       NOT NULL,
    description     TEXT,
    status          manufacturing.step_status  NOT NULL DEFAULT 'pending',
    planned_duration_min INTEGER,
    actual_duration_min  INTEGER,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ                NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ                NOT NULL DEFAULT now(),
    UNIQUE (work_order_id, step_number)
);
COMMENT ON TABLE manufacturing.work_order_steps IS 'Ordered process steps within a work order (e.g. knitting, linking, boarding).';

CREATE TABLE manufacturing.machine_assignments (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id   UUID        NOT NULL REFERENCES manufacturing.work_orders(id) ON DELETE RESTRICT,
    machine_id      UUID        NOT NULL REFERENCES machines.machines(id) ON DELETE RESTRICT,
    step_id         UUID        REFERENCES manufacturing.work_order_steps(id) ON DELETE RESTRICT,
    assigned_from   TIMESTAMPTZ NOT NULL,
    assigned_to     TIMESTAMPTZ,
    operator_id     UUID        REFERENCES auth.users(id) ON DELETE RESTRICT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE manufacturing.machine_assignments IS 'Assigns a machine to a work order (optionally to a specific step) for a time window.';

CREATE TABLE manufacturing.production_logs (
    id              UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id   UUID                       NOT NULL REFERENCES manufacturing.work_orders(id) ON DELETE RESTRICT,
    step_id         UUID                       REFERENCES manufacturing.work_order_steps(id) ON DELETE RESTRICT,
    log_type        manufacturing.log_type     NOT NULL DEFAULT 'output',
    quantity        NUMERIC(12,4)              NOT NULL,
    uom             public.unit_of_measure      NOT NULL DEFAULT 'pair',
    logged_at       TIMESTAMPTZ                NOT NULL DEFAULT now(),
    logged_by       UUID                       REFERENCES auth.users(id) ON DELETE RESTRICT,
    notes           TEXT,
    created_at      TIMESTAMPTZ                NOT NULL DEFAULT now()
);
COMMENT ON TABLE manufacturing.production_logs IS 'Timestamped events recording output, scrap, rework, and material consumption per work order.';

-- ---------- INDEXES ----------

CREATE INDEX idx_mfg_wo_order_line_id      ON manufacturing.work_orders(order_line_id);
CREATE INDEX idx_mfg_wo_status             ON manufacturing.work_orders(status);
CREATE INDEX idx_mfg_wo_supervisor_id      ON manufacturing.work_orders(supervisor_id);
CREATE INDEX idx_mfg_wo_deleted_at         ON manufacturing.work_orders(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_mfg_steps_wo_id           ON manufacturing.work_order_steps(work_order_id);
CREATE INDEX idx_mfg_assignments_wo_id     ON manufacturing.machine_assignments(work_order_id);
CREATE INDEX idx_mfg_assignments_machine   ON manufacturing.machine_assignments(machine_id);
CREATE INDEX idx_mfg_logs_wo_id            ON manufacturing.production_logs(work_order_id);
CREATE INDEX idx_mfg_logs_logged_at        ON manufacturing.production_logs(logged_at);

-- ---------- DEFERRED FK: yarn_warehouse.issues -> work orders ----------

ALTER TABLE yarn_warehouse.issues
    ADD CONSTRAINT fk_issues_work_order_id
    FOREIGN KEY (work_order_id) REFERENCES manufacturing.work_orders(id) ON DELETE RESTRICT;

-- =============================================================================
-- SCHEMA: employees
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS employees;
COMMENT ON SCHEMA employees IS 'HR module: employee records, KPI definitions and tracking, and attendance.';

-- ---------- ENUMS ----------

CREATE TYPE employees.employment_type   AS ENUM ('full_time', 'part_time', 'contract', 'temporary', 'apprentice');
CREATE TYPE employees.employment_status AS ENUM ('active', 'on_leave', 'terminated', 'suspended', 'retired');
CREATE TYPE employees.attendance_type   AS ENUM ('present', 'absent', 'half_day', 'late', 'leave', 'holiday', 'remote');
CREATE TYPE employees.kpi_unit          AS ENUM ('percent', 'count', 'pairs_per_hour', 'defects_per_thousand', 'hours', 'score', 'currency');

-- ---------- TABLES ----------

CREATE TABLE employees.departments (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT        NOT NULL UNIQUE,
    manager_id UUID,                          -- self-ref, added below
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE employees.departments IS 'Organisational departments (e.g. Production, Quality, Warehouse).';

CREATE TABLE employees.employees (
    id                UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_no       TEXT                        NOT NULL UNIQUE,
    user_id           UUID                        REFERENCES auth.users(id) ON DELETE RESTRICT,
    first_name        TEXT                        NOT NULL,
    last_name         TEXT                        NOT NULL,
    date_of_birth     DATE,
    gender            public.gender_type,
    department_id     UUID                        REFERENCES employees.departments(id) ON DELETE RESTRICT,
    job_title         TEXT,
    employment_type   employees.employment_type   NOT NULL DEFAULT 'full_time',
    employment_status employees.employment_status NOT NULL DEFAULT 'active',
    hire_date         DATE                        NOT NULL,
    termination_date  DATE,
    phone             TEXT,
    email             TEXT,
    address           TEXT,
    emergency_contact JSONB,
    notes             TEXT,
    created_at        TIMESTAMPTZ                 NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ                 NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);
COMMENT ON TABLE employees.employees IS 'Employee master record; optionally linked to an auth.users account.';

-- Add self-referencing FK for department manager
ALTER TABLE employees.departments
    ADD COLUMN manager_id UUID REFERENCES employees.employees(id) ON DELETE RESTRICT;

CREATE TABLE employees.performance_kpis (
    id           UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    code         TEXT                 NOT NULL UNIQUE,
    name         TEXT                 NOT NULL,
    description  TEXT,
    unit         employees.kpi_unit   NOT NULL DEFAULT 'score',
    target_value NUMERIC(12,4),
    min_value    NUMERIC(12,4),
    max_value    NUMERIC(12,4),
    is_active    BOOLEAN              NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ          NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ          NOT NULL DEFAULT now()
);
COMMENT ON TABLE employees.performance_kpis IS 'KPI definitions applicable to employees in manufacturing and quality roles.';

CREATE TABLE employees.kpi_records (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id    UUID        NOT NULL REFERENCES employees.employees(id) ON DELETE RESTRICT,
    kpi_id         UUID        NOT NULL REFERENCES employees.performance_kpis(id) ON DELETE RESTRICT,
    period_start   DATE        NOT NULL,
    period_end     DATE        NOT NULL,
    actual_value   NUMERIC(12,4) NOT NULL,
    target_value   NUMERIC(12,4),
    notes          TEXT,
    recorded_by    UUID        REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE employees.kpi_records IS 'Periodic KPI measurement records per employee.';

CREATE TABLE employees.attendance (
    id              UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID                      NOT NULL REFERENCES employees.employees(id) ON DELETE RESTRICT,
    attendance_date DATE                      NOT NULL,
    attendance_type employees.attendance_type NOT NULL DEFAULT 'present',
    check_in        TIMESTAMPTZ,
    check_out       TIMESTAMPTZ,
    notes           TEXT,
    recorded_by     UUID                      REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ               NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ               NOT NULL DEFAULT now(),
    UNIQUE (employee_id, attendance_date)
);
COMMENT ON TABLE employees.attendance IS 'Daily attendance record per employee.';

-- ---------- INDEXES ----------

CREATE INDEX idx_emp_employees_dept_id       ON employees.employees(department_id);
CREATE INDEX idx_emp_employees_status        ON employees.employees(employment_status);
CREATE INDEX idx_emp_employees_user_id       ON employees.employees(user_id);
CREATE INDEX idx_emp_employees_deleted_at    ON employees.employees(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_emp_kpi_records_emp_id      ON employees.kpi_records(employee_id);
CREATE INDEX idx_emp_kpi_records_kpi_id      ON employees.kpi_records(kpi_id);
CREATE INDEX idx_emp_kpi_records_period      ON employees.kpi_records(period_start, period_end);
CREATE INDEX idx_emp_attendance_emp_id       ON employees.attendance(employee_id);
CREATE INDEX idx_emp_attendance_date         ON employees.attendance(attendance_date);

-- =============================================================================
-- SCHEMA: quality
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS quality;
COMMENT ON SCHEMA quality IS 'Quality management: QC plans, inspection checkpoints, results, defects, and non-conformances.';

-- ---------- ENUMS ----------

CREATE TYPE quality.qc_plan_status    AS ENUM ('draft', 'active', 'archived');
CREATE TYPE quality.qc_result_status  AS ENUM ('pass', 'fail', 'conditional_pass', 'pending');
CREATE TYPE quality.defect_severity   AS ENUM ('critical', 'major', 'minor', 'cosmetic');
CREATE TYPE quality.nc_status         AS ENUM ('open', 'under_review', 'resolved', 'closed', 'rejected');
CREATE TYPE quality.inspection_stage  AS ENUM ('incoming', 'in_process', 'final', 'outgoing', 'audit');

-- ---------- TABLES ----------

CREATE TABLE quality.qc_plans (
    id              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT                    NOT NULL UNIQUE,
    name            TEXT                    NOT NULL,
    product_id      UUID                    REFERENCES products.products(id) ON DELETE RESTRICT,
    inspection_stage quality.inspection_stage NOT NULL DEFAULT 'in_process',
    status          quality.qc_plan_status  NOT NULL DEFAULT 'draft',
    description     TEXT,
    aql_level       TEXT,
    sample_size     INTEGER,
    created_by      UUID                    REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
COMMENT ON TABLE  quality.qc_plans           IS 'Quality control plan header; references a product and inspection stage.';
COMMENT ON COLUMN quality.qc_plans.aql_level IS 'Acceptable Quality Level (e.g. 1.0, 2.5, 4.0) per ISO 2859-1.';

CREATE TABLE quality.qc_checkpoints (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    qc_plan_id    UUID        NOT NULL REFERENCES quality.qc_plans(id) ON DELETE RESTRICT,
    sequence      INTEGER     NOT NULL,
    checkpoint_name TEXT      NOT NULL,
    description   TEXT,
    measurement_unit TEXT,
    lower_limit   NUMERIC(12,4),
    upper_limit   NUMERIC(12,4),
    is_mandatory  BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (qc_plan_id, sequence)
);
COMMENT ON TABLE quality.qc_checkpoints IS 'Individual inspection checkpoints within a QC plan with acceptance limits.';

CREATE TABLE quality.qc_results (
    id                UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    qc_plan_id        UUID                     NOT NULL REFERENCES quality.qc_plans(id) ON DELETE RESTRICT,
    work_order_id     UUID                     REFERENCES manufacturing.work_orders(id) ON DELETE RESTRICT,
    checkpoint_id     UUID                     NOT NULL REFERENCES quality.qc_checkpoints(id) ON DELETE RESTRICT,
    inspected_qty     INTEGER                  NOT NULL,
    defective_qty     INTEGER                  NOT NULL DEFAULT 0,
    measured_value    NUMERIC(12,4),
    status            quality.qc_result_status NOT NULL DEFAULT 'pending',
    inspector_id      UUID                     REFERENCES auth.users(id) ON DELETE RESTRICT,
    inspected_at      TIMESTAMPTZ              NOT NULL DEFAULT now(),
    notes             TEXT,
    created_at        TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ              NOT NULL DEFAULT now()
);
COMMENT ON TABLE quality.qc_results IS 'Recorded inspection results per checkpoint per work order.';

CREATE TABLE quality.defects (
    id              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    qc_result_id    UUID                    NOT NULL REFERENCES quality.qc_results(id) ON DELETE RESTRICT,
    defect_code     TEXT                    NOT NULL,
    description     TEXT                    NOT NULL,
    severity        quality.defect_severity NOT NULL DEFAULT 'minor',
    quantity        INTEGER                 NOT NULL DEFAULT 1,
    image_urls      JSONB,
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ             NOT NULL DEFAULT now()
);
COMMENT ON TABLE quality.defects IS 'Individual defect records linked to a QC inspection result.';

CREATE TABLE quality.non_conformances (
    id              UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    nc_number       TEXT               NOT NULL UNIQUE,
    work_order_id   UUID               REFERENCES manufacturing.work_orders(id) ON DELETE RESTRICT,
    qc_result_id    UUID               REFERENCES quality.qc_results(id) ON DELETE RESTRICT,
    title           TEXT               NOT NULL,
    description     TEXT               NOT NULL,
    severity        quality.defect_severity NOT NULL DEFAULT 'major',
    status          quality.nc_status  NOT NULL DEFAULT 'open',
    root_cause      TEXT,
    corrective_action TEXT,
    preventive_action TEXT,
    assigned_to     UUID               REFERENCES auth.users(id) ON DELETE RESTRICT,
    due_date        DATE,
    resolved_at     TIMESTAMPTZ,
    created_by      UUID               REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ        NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ        NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
COMMENT ON TABLE quality.non_conformances IS 'Non-conformance reports (NCR) for systematic quality issues requiring CAPA.';

-- ---------- INDEXES ----------

CREATE INDEX idx_qc_plans_product_id        ON quality.qc_plans(product_id);
CREATE INDEX idx_qc_plans_status            ON quality.qc_plans(status);
CREATE INDEX idx_qc_checkpoints_plan_id     ON quality.qc_checkpoints(qc_plan_id);
CREATE INDEX idx_qc_results_plan_id         ON quality.qc_results(qc_plan_id);
CREATE INDEX idx_qc_results_wo_id           ON quality.qc_results(work_order_id);
CREATE INDEX idx_qc_results_inspector_id    ON quality.qc_results(inspector_id);
CREATE INDEX idx_qc_defects_result_id       ON quality.defects(qc_result_id);
CREATE INDEX idx_qc_nc_wo_id                ON quality.non_conformances(work_order_id);
CREATE INDEX idx_qc_nc_status               ON quality.non_conformances(status);
CREATE INDEX idx_qc_nc_assigned_to          ON quality.non_conformances(assigned_to);
CREATE INDEX idx_qc_nc_deleted_at           ON quality.non_conformances(deleted_at) WHERE deleted_at IS NULL;

-- =============================================================================
-- SCHEMA: shipping
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS shipping;
COMMENT ON SCHEMA shipping IS 'Outbound logistics: packing lists, shipments, line items, and carrier records.';

-- ---------- ENUMS ----------

CREATE TYPE shipping.shipment_status   AS ENUM ('draft', 'ready_to_ship', 'in_transit', 'delivered', 'returned', 'cancelled', 'lost');
CREATE TYPE shipping.incoterm          AS ENUM ('EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF');
CREATE TYPE shipping.packaging_type    AS ENUM ('box', 'carton', 'pallet', 'bag', 'polybag', 'bulk');

-- ---------- TABLES ----------

CREATE TABLE shipping.carriers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    website     TEXT,
    tracking_url_template TEXT,
    notes       TEXT,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE  shipping.carriers                      IS 'Freight and courier carrier master list.';
COMMENT ON COLUMN shipping.carriers.tracking_url_template IS 'URL with {tracking_number} placeholder for tracking link generation.';

CREATE TABLE shipping.packing_lists (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    packing_list_no TEXT        NOT NULL UNIQUE,
    production_order_id UUID    REFERENCES planning.production_orders(id) ON DELETE RESTRICT,
    customer_id     UUID        REFERENCES customers.customers(id) ON DELETE RESTRICT,
    address_id      UUID        REFERENCES customers.addresses(id) ON DELETE RESTRICT,
    packing_date    DATE        NOT NULL,
    gross_weight_kg NUMERIC(10,2),
    net_weight_kg   NUMERIC(10,2),
    total_cartons   INTEGER,
    notes           TEXT,
    created_by      UUID        REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
COMMENT ON TABLE shipping.packing_lists IS 'Packing list document grouping packed goods before shipment.';

CREATE TABLE shipping.packing_list_items (
    id                UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    packing_list_id   UUID                     NOT NULL REFERENCES shipping.packing_lists(id) ON DELETE RESTRICT,
    variant_id        UUID                     NOT NULL REFERENCES products.variants(id) ON DELETE RESTRICT,
    work_order_id     UUID                     REFERENCES manufacturing.work_orders(id) ON DELETE RESTRICT,
    quantity          INTEGER                  NOT NULL,
    uom               public.unit_of_measure   NOT NULL DEFAULT 'pair',
    carton_no         TEXT,
    packaging_type    shipping.packaging_type  NOT NULL DEFAULT 'carton',
    created_at        TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ              NOT NULL DEFAULT now()
);
COMMENT ON TABLE shipping.packing_list_items IS 'Line items in a packing list specifying variant quantity and carton assignment.';

CREATE TABLE shipping.shipments (
    id                UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_no       TEXT                     NOT NULL UNIQUE,
    packing_list_id   UUID                     REFERENCES shipping.packing_lists(id) ON DELETE RESTRICT,
    carrier_id        UUID                     NOT NULL REFERENCES shipping.carriers(id) ON DELETE RESTRICT,
    tracking_number   TEXT,
    status            shipping.shipment_status NOT NULL DEFAULT 'draft',
    incoterm          shipping.incoterm        NOT NULL DEFAULT 'FOB',
    ship_date         DATE,
    estimated_arrival DATE,
    actual_arrival    DATE,
    origin_address    TEXT,
    destination_address TEXT,
    freight_cost      NUMERIC(12,2),
    currency          public.currency_code      NOT NULL DEFAULT 'USD',
    notes             TEXT,
    created_by        UUID                     REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at        TIMESTAMPTZ              NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ              NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);
COMMENT ON TABLE shipping.shipments IS 'Shipment header linking a packing list to a carrier with tracking and freight details.';

CREATE TABLE shipping.shipment_items (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id     UUID        NOT NULL REFERENCES shipping.shipments(id) ON DELETE RESTRICT,
    packing_item_id UUID        NOT NULL REFERENCES shipping.packing_list_items(id) ON DELETE RESTRICT,
    quantity_shipped INTEGER    NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE shipping.shipment_items IS 'Actual shipped quantities per packing list item within a shipment.';

-- ---------- INDEXES ----------

CREATE INDEX idx_ship_packing_lists_order_id  ON shipping.packing_lists(production_order_id);
CREATE INDEX idx_ship_packing_lists_cust_id   ON shipping.packing_lists(customer_id);
CREATE INDEX idx_ship_packing_lists_deleted   ON shipping.packing_lists(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_ship_pl_items_packing_id     ON shipping.packing_list_items(packing_list_id);
CREATE INDEX idx_ship_pl_items_variant_id     ON shipping.packing_list_items(variant_id);
CREATE INDEX idx_ship_shipments_carrier_id    ON shipping.shipments(carrier_id);
CREATE INDEX idx_ship_shipments_status        ON shipping.shipments(status);
CREATE INDEX idx_ship_shipments_packing_id    ON shipping.shipments(packing_list_id);
CREATE INDEX idx_ship_shipments_deleted       ON shipping.shipments(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_ship_items_shipment_id       ON shipping.shipment_items(shipment_id);

-- =============================================================================
-- SCHEMA: reports
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS reports;
COMMENT ON SCHEMA reports IS 'Materialised views and summary tables for dashboard KPIs and reporting.';

-- ---------- MATERIALISED VIEWS ----------

CREATE MATERIALIZED VIEW reports.mv_production_daily_output AS
SELECT
    date_trunc('day', pl.logged_at)  AS report_date,
    wo.id                             AS work_order_id,
    wo.wo_number,
    p.id                              AS product_id,
    p.sku                             AS product_sku,
    p.name                            AS product_name,
    v.sku_variant,
    SUM(CASE WHEN pl.log_type = 'output' THEN pl.quantity ELSE 0 END)  AS total_output,
    SUM(CASE WHEN pl.log_type = 'scrap'  THEN pl.quantity ELSE 0 END)  AS total_scrap,
    SUM(CASE WHEN pl.log_type = 'rework' THEN pl.quantity ELSE 0 END)  AS total_rework
FROM manufacturing.production_logs pl
JOIN manufacturing.work_orders    wo ON wo.id = pl.work_order_id
JOIN planning.order_lines         ol ON ol.id = wo.order_line_id
JOIN products.products             p ON p.id = ol.product_id
LEFT JOIN products.variants        v ON v.id = ol.variant_id
WHERE pl.log_type IN ('output', 'scrap', 'rework')
GROUP BY 1, 2, 3, 4, 5, 6, 7
WITH DATA;

COMMENT ON MATERIALIZED VIEW reports.mv_production_daily_output IS 'Daily production output, scrap and rework aggregated per work order.';

CREATE UNIQUE INDEX idx_mv_prod_daily_wo_date
    ON reports.mv_production_daily_output (report_date, work_order_id);

-- ----------

CREATE MATERIALIZED VIEW reports.mv_yarn_stock_summary AS
SELECT
    ys.id          AS yarn_spec_id,
    ys.code        AS yarn_code,
    ys.name        AS yarn_name,
    ys.yarn_type,
    sl.code        AS location_code,
    sl.name        AS location_name,
    yi.lot_number,
    yi.quantity_on_hand,
    yi.quantity_reserved,
    (yi.quantity_on_hand - yi.quantity_reserved) AS quantity_available,
    yi.uom,
    yi.cost_per_unit,
    yi.currency
FROM yarn_warehouse.yarn_items yi
JOIN bom.yarn_specs              ys ON ys.id = yi.yarn_spec_id
LEFT JOIN yarn_warehouse.stock_locations sl ON sl.id = yi.location_id
WHERE yi.deleted_at IS NULL
WITH DATA;

COMMENT ON MATERIALIZED VIEW reports.mv_yarn_stock_summary IS 'Current yarn stock levels per lot and location with available quantity.';

CREATE UNIQUE INDEX idx_mv_yarn_stock_item
    ON reports.mv_yarn_stock_summary (yarn_spec_id, lot_number);

-- ----------

CREATE MATERIALIZED VIEW reports.mv_machine_downtime_monthly AS
SELECT
    date_trunc('month', dr.started_at)  AS report_month,
    m.id                                 AS machine_id,
    m.asset_code,
    m.name                               AS machine_name,
    m.machine_type,
    COUNT(dr.id)                         AS downtime_events,
    SUM(dr.duration_min)                 AS total_downtime_min,
    AVG(dr.duration_min)                 AS avg_downtime_min,
    dr.cause
FROM machines.downtime_records dr
JOIN machines.machines m ON m.id = dr.machine_id
WHERE dr.ended_at IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 9
WITH DATA;

COMMENT ON MATERIALIZED VIEW reports.mv_machine_downtime_monthly IS 'Monthly machine downtime by cause for OEE and maintenance reporting.';

CREATE INDEX idx_mv_machine_dt_month ON reports.mv_machine_downtime_monthly (report_month, machine_id);

-- ----------

CREATE MATERIALIZED VIEW reports.mv_defect_rate_by_product AS
SELECT
    p.id          AS product_id,
    p.sku,
    p.name        AS product_name,
    qr.inspected_at::DATE AS inspection_date,
    SUM(qr.inspected_qty)  AS total_inspected,
    SUM(qr.defective_qty)  AS total_defective,
    ROUND(
        100.0 * SUM(qr.defective_qty) / NULLIF(SUM(qr.inspected_qty), 0),
        2
    )                       AS defect_rate_pct
FROM quality.qc_results qr
JOIN quality.qc_plans  qp ON qp.id = qr.qc_plan_id
JOIN products.products  p ON p.id = qp.product_id
GROUP BY 1, 2, 3, 4
WITH DATA;

COMMENT ON MATERIALIZED VIEW reports.mv_defect_rate_by_product IS 'Daily defect rate percentage per product for quality KPI dashboard.';

CREATE INDEX idx_mv_defect_rate_product ON reports.mv_defect_rate_by_product (product_id, inspection_date);

-- ----------

CREATE MATERIALIZED VIEW reports.mv_shipment_summary AS
SELECT
    s.id                  AS shipment_id,
    s.shipment_no,
    s.status,
    s.ship_date,
    s.estimated_arrival,
    s.actual_arrival,
    c.id                  AS customer_id,
    c.company_name,
    cr.name               AS carrier_name,
    s.tracking_number,
    s.freight_cost,
    s.currency,
    SUM(si.quantity_shipped) AS total_pairs_shipped
FROM shipping.shipments s
LEFT JOIN shipping.packing_lists pl ON pl.id = s.packing_list_id
LEFT JOIN customers.customers     c  ON c.id  = pl.customer_id
JOIN shipping.carriers           cr  ON cr.id = s.carrier_id
LEFT JOIN shipping.shipment_items si ON si.shipment_id = s.id
WHERE s.deleted_at IS NULL
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
WITH DATA;

COMMENT ON MATERIALIZED VIEW reports.mv_shipment_summary IS 'Shipment summary with customer, carrier, dates, cost and total units shipped.';

CREATE UNIQUE INDEX idx_mv_shipment_summary_id ON reports.mv_shipment_summary (shipment_id);

-- ---------- SUMMARY TABLES (written by ETL / triggers) ----------

CREATE TABLE reports.kpi_snapshots (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    kpi_name      TEXT        NOT NULL,
    kpi_category  TEXT        NOT NULL,
    dimension     TEXT,
    dimension_id  UUID,
    period_start  DATE        NOT NULL,
    period_end    DATE        NOT NULL,
    value         NUMERIC(18,4) NOT NULL,
    unit          TEXT,
    source_query  TEXT,
    computed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE  reports.kpi_snapshots             IS 'Point-in-time KPI snapshot table for historical dashboard charts.';
COMMENT ON COLUMN reports.kpi_snapshots.dimension   IS 'e.g. product, machine, employee, customer.';
COMMENT ON COLUMN reports.kpi_snapshots.dimension_id IS 'UUID of the dimension entity.';

CREATE INDEX idx_rpt_kpi_snapshots_name_period ON reports.kpi_snapshots (kpi_name, period_start, period_end);
CREATE INDEX idx_rpt_kpi_snapshots_category    ON reports.kpi_snapshots (kpi_category, period_start);

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- ---------- Roles ----------

INSERT INTO auth.roles (id, name, description, is_system) VALUES
    (gen_random_uuid(), 'admin',                'Full system access',                            TRUE),
    (gen_random_uuid(), 'manager',              'Cross-department management access',            TRUE),
    (gen_random_uuid(), 'production_supervisor','Manage work orders and production floor',       TRUE),
    (gen_random_uuid(), 'qc_inspector',         'Quality control inspections and NCR management',TRUE),
    (gen_random_uuid(), 'warehouse_keeper',     'Yarn warehouse receipts and stock management',  TRUE),
    (gen_random_uuid(), 'sales_rep',            'Customer, sample and order management',         TRUE);

-- ---------- Machine Types seed (via enum - values already in type) ----------
-- Machines are created when assets are registered; the enum covers type.
-- Insert representative machine records for reference.

INSERT INTO machines.machines (asset_code, name, machine_type, manufacturer, gauge, status) VALUES
    ('MCH-CK-001', '144F Circular Knitting Machine #1',  'circular_knitting', 'Lonati',  '144F', 'operational'),
    ('MCH-CK-002', '144F Circular Knitting Machine #2',  'circular_knitting', 'Lonati',  '144F', 'operational'),
    ('MCH-CK-003', '200F Circular Knitting Machine',     'circular_knitting', 'Santoni', '200F', 'operational'),
    ('MCH-LK-001', 'Linking Machine #1',                 'linking',           'Detexomat', NULL, 'operational'),
    ('MCH-BD-001', 'Boarding Machine #1',                'boarding',          'Cortese',   NULL, 'operational'),
    ('MCH-BD-002', 'Boarding Machine #2',                'boarding',          'Cortese',   NULL, 'operational'),
    ('MCH-DY-001', 'Yarn Dyeing Vat #1',                 'dyeing',            'Thies',     NULL, 'operational'),
    ('MCH-IN-001', 'Inspection Conveyor #1',             'inspection',        'Generic',   NULL, 'operational'),
    ('MCH-PK-001', 'Packaging Line #1',                  'packaging',         'Generic',   NULL, 'operational'),
    ('MCH-EM-001', 'Embroidery Machine #1',              'embroidery',        'Tajima',    NULL, 'standby');

-- ---------- Yarn Specs (types seed) ----------

INSERT INTO bom.yarn_specs (code, name, yarn_type, ply, composition_pct, supplier) VALUES
    ('YRN-COT-80-20', 'Cotton/Polyester 80/20 2-ply',    'cotton',            '2ply', '{"cotton":80,"polyester":20}'::JSONB,      'YarnCo Ltd'),
    ('YRN-COT-100',   'Combed Cotton 100% 2-ply',         'cotton',            '2ply', '{"cotton":100}'::JSONB,                   'NaturalFibers Inc'),
    ('YRN-MER-100',   'Merino Wool 100% 3-ply',           'merino_wool',       '3ply', '{"merino_wool":100}'::JSONB,              'AustralWool Co'),
    ('YRN-ACR-100',   'Acrylic Bulky 100% 4-ply',         'acrylic',           '4ply', '{"acrylic":100}'::JSONB,                  'SyntheticTextiles'),
    ('YRN-NYL-70-30', 'Nylon/Cotton 70/30 2-ply',         'nylon',             '2ply', '{"nylon":70,"cotton":30}'::JSONB,         'PolyFibers Co'),
    ('YRN-BAM-75-25', 'Bamboo/Cotton 75/25 2-ply',        'bamboo',            '2ply', '{"bamboo":75,"cotton":25}'::JSONB,        'EcoYarns Asia'),
    ('YRN-CSH-100',   'Cashmere 100% 2-ply Premium',      'cashmere',          '2ply', '{"cashmere":100}'::JSONB,                 'LuxuryWool Ltd'),
    ('YRN-LYC-95-5',  'Cotton/Lycra 95/5 2-ply Stretch',  'blended',           '2ply', '{"cotton":95,"lycra_spandex":5}'::JSONB,  'ElasticTextiles'),
    ('YRN-REC-100',   'Recycled Polyester 100% 2-ply',    'recycled_polyester','2ply', '{"recycled_polyester":100}'::JSONB,       'GreenFibers Inc'),
    ('YRN-MOD-60-40', 'Modal/Cotton 60/40 2-ply',         'modal',             '2ply', '{"modal":60,"cotton":40}'::JSONB,         'SoftFibers EU');

-- ---------- Yarn Stock Locations seed ----------

INSERT INTO yarn_warehouse.stock_locations (code, name, location_type, aisle, rack, level) VALUES
    ('LOC-A01-01', 'Aisle A, Rack 01, Level 1', 'rack',        'A', '01', '1'),
    ('LOC-A01-02', 'Aisle A, Rack 01, Level 2', 'rack',        'A', '01', '2'),
    ('LOC-A02-01', 'Aisle A, Rack 02, Level 1', 'rack',        'A', '02', '1'),
    ('LOC-B01-01', 'Aisle B, Rack 01, Level 1', 'rack',        'B', '01', '1'),
    ('LOC-QAR-01', 'Quarantine Area 01',         'quarantine',  NULL, NULL, NULL),
    ('LOC-FLR-01', 'Production Floor Buffer',    'floor',       NULL, NULL, NULL),
    ('LOC-OUT-01', 'Outgoing Staging Area',      'outgoing',    NULL, NULL, NULL);

-- ---------- Product categories seed ----------

INSERT INTO products.categories (id, name, slug) VALUES
    (gen_random_uuid(), 'Casual Socks',      'casual-socks'),
    (gen_random_uuid(), 'Sport Socks',       'sport-socks'),
    (gen_random_uuid(), 'Dress Socks',       'dress-socks'),
    (gen_random_uuid(), 'Compression Socks', 'compression-socks'),
    (gen_random_uuid(), 'Kids Socks',        'kids-socks'),
    (gen_random_uuid(), 'Novelty Socks',     'novelty-socks');

-- ---------- Reference sizes ----------

INSERT INTO products.sizes (code, label, sort_order) VALUES
    ('XS',   'Extra Small (UK 2-4)',   10),
    ('S',    'Small (UK 4-6)',         20),
    ('M',    'Medium (UK 6-8)',        30),
    ('L',    'Large (UK 8-10)',        40),
    ('XL',   'Extra Large (UK 10-12)', 50),
    ('ONE',  'One Size Fits All',       60),
    ('KIDS', 'Kids (UK 10-13)',         70);

-- ---------- Reference colors ----------

INSERT INTO products.colors (code, name, hex_value) VALUES
    ('BLK', 'Black',        '#000000'),
    ('WHT', 'White',        '#FFFFFF'),
    ('NVY', 'Navy Blue',    '#001F5B'),
    ('GRY', 'Grey Marl',    '#808080'),
    ('RED', 'Red',          '#CC0000'),
    ('GRN', 'Olive Green',  '#556B2F'),
    ('BLU', 'Sky Blue',     '#87CEEB'),
    ('PNK', 'Pink',         '#FFB6C1'),
    ('MUL', 'Multi-colour', NULL);

-- =============================================================================
-- REFRESH FUNCTION FOR MATERIALISED VIEWS
-- =============================================================================

CREATE OR REPLACE FUNCTION reports.refresh_all_mv()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY reports.mv_production_daily_output;
    REFRESH MATERIALIZED VIEW CONCURRENTLY reports.mv_yarn_stock_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY reports.mv_machine_downtime_monthly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY reports.mv_defect_rate_by_product;
    REFRESH MATERIALIZED VIEW CONCURRENTLY reports.mv_shipment_summary;
END;
$$;

COMMENT ON FUNCTION reports.refresh_all_mv() IS 'Refresh all reporting materialised views concurrently. Schedule via pg_cron or application job.';

-- =============================================================================
-- UPDATED_AT TRIGGER HELPER
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS 'Trigger function to auto-update the updated_at column on row modification.';

-- Apply trigger to every table that has updated_at
DO $$
DECLARE
    tbl RECORD;
BEGIN
    FOR tbl IN
        SELECT table_schema, table_name
        FROM information_schema.columns
        WHERE column_name = 'updated_at'
          AND table_schema IN (
              'auth','customers','samples','products','bom',
              'yarn_warehouse','planning','machines','manufacturing',
              'employees','quality','shipping','reports'
          )
        GROUP BY table_schema, table_name
    LOOP
        EXECUTE format(
            'CREATE OR REPLACE TRIGGER trg_%s_%s_updated_at
             BEFORE UPDATE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
            tbl.table_schema, tbl.table_name,
            tbl.table_schema, tbl.table_name
        );
    END LOOP;
END;
$$;

-- =============================================================================
-- SCHEMA SUMMARY
-- =============================================================================
-- Schema          | Tables / Views
-- ----------------+-------------------------------------------------------
-- auth            |  5 tables  (roles, permissions, role_permissions,
--                 |             users, user_roles)
-- customers       |  5 tables  (customers, contacts, addresses,
--                 |             price_lists, price_list_items)
-- samples         |  4 tables  (sample_requests, sample_versions,
--                 |             approvals, feedbacks)
-- products        |  5 tables  (categories, products, sizes, colors,
--                 |             variants)
-- bom             |  3 tables  (yarn_specs, boms, bom_items)
-- yarn_warehouse  |  5 tables  (stock_locations, yarn_items, receipts,
--                 |             issues, stock_adjustments)
-- planning        |  4 tables  (production_orders, order_lines,
--                 |             schedules, capacity_plans)
-- machines        |  3 tables  (machines, maintenance_logs,
--                 |             downtime_records)
-- manufacturing   |  4 tables  (work_orders, work_order_steps,
--                 |             machine_assignments, production_logs)
-- employees       |  5 tables  (departments, employees,
--                 |             performance_kpis, kpi_records, attendance)
-- quality         |  5 tables  (qc_plans, qc_checkpoints, qc_results,
--                 |             defects, non_conformances)
-- shipping        |  5 tables  (carriers, packing_lists,
--                 |             packing_list_items, shipments,
--                 |             shipment_items)
-- reports         |  5 MVs + 1 table
--                 |           (mv_production_daily_output,
--                 |            mv_yarn_stock_summary,
--                 |            mv_machine_downtime_monthly,
--                 |            mv_defect_rate_by_product,
--                 |            mv_shipment_summary,
--                 |            kpi_snapshots)
-- ----------------+-------------------------------------------------------
-- TOTAL           |  58 tables + 5 materialised views = 63 objects
-- =============================================================================
