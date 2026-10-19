-- Esquema del portal en PostgreSQL (objetivo: PostgreSQL 18).
-- Todas las tablas llevan tenant_id (empresa) y erp_id (identificador original en el ERP).
-- La seguridad a nivel de fila (RLS) impide ver filas de otra empresa o fuera del alcance del usuario,
-- aunque la aplicación tenga un fallo. La API fija en cada conexión:
--   SET app.tenant_id = '<empresa>'; SET app.role = '<rol>'; SET app.sales_rep_id = '<id>'; SET app.customer_ids = '{id1,id2}';

CREATE TYPE order_status AS ENUM ('Abierto', 'EnPreparacion', 'Enviado', 'Entregado', 'Facturado', 'Anulado');
CREATE TYPE user_role AS ENUM ('PlatformAdmin', 'CompanyAdmin', 'SalesManager', 'SalesRep', 'Customer');

CREATE TABLE tenant (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    connector     text NOT NULL DEFAULT 'SapFiles',     -- SapFiles | SapRfc | otro ERP
    sync_cursor   text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales_rep (
    tenant_id  text NOT NULL REFERENCES tenant(id),
    erp_id     text NOT NULL,
    name       text NOT NULL,
    email      text,
    manager_id text,                                   -- jefe de ventas (otro sales_rep)
    PRIMARY KEY (tenant_id, erp_id)
);

CREATE TABLE customer (
    tenant_id      text NOT NULL REFERENCES tenant(id),
    erp_id         text NOT NULL,                      -- KUNNR en SAP
    name           text NOT NULL,
    tax_id         text,
    address        text,
    city           text,
    payment_terms  text,
    credit_limit   numeric(15,2),
    sales_rep_id   text,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, erp_id),
    FOREIGN KEY (tenant_id, sales_rep_id) REFERENCES sales_rep(tenant_id, erp_id)
);

CREATE TABLE sales_order (
    tenant_id          text NOT NULL,
    erp_id             text NOT NULL,                  -- VBELN
    customer_id        text NOT NULL,
    order_date         date NOT NULL,
    customer_reference text,                           -- BSTKD
    requested_date     date,
    incoterm           text,
    currency           char(3) NOT NULL DEFAULT 'EUR',
    status             order_status NOT NULL,
    net_amount         numeric(15,2) NOT NULL,
    tax_amount         numeric(15,2) NOT NULL,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    search             tsvector,
    PRIMARY KEY (tenant_id, erp_id),
    FOREIGN KEY (tenant_id, customer_id) REFERENCES customer(tenant_id, erp_id)
);
CREATE INDEX sales_order_customer_date ON sales_order (tenant_id, customer_id, order_date DESC);
CREATE INDEX sales_order_search ON sales_order USING gin (search);

CREATE TABLE order_line (
    tenant_id    text NOT NULL,
    order_id     text NOT NULL,
    position     integer NOT NULL,                     -- POSNR
    material_id  text NOT NULL,
    description  text NOT NULL,
    quantity     numeric(15,3) NOT NULL,
    unit         text NOT NULL,
    unit_price   numeric(15,2) NOT NULL,
    net_amount   numeric(15,2) NOT NULL,
    PRIMARY KEY (tenant_id, order_id, position),
    FOREIGN KEY (tenant_id, order_id) REFERENCES sales_order(tenant_id, erp_id) ON DELETE CASCADE
);

CREATE TABLE delivery (
    tenant_id        text NOT NULL,
    erp_id           text NOT NULL,                    -- VBELN de la entrega
    order_id         text NOT NULL,
    goods_issue_date date,
    carrier          text,
    tracking_number  text,
    packages         integer,
    weight_kg        numeric(10,3),
    pdf_file         text,
    delivered        boolean NOT NULL DEFAULT false,
    PRIMARY KEY (tenant_id, erp_id),
    FOREIGN KEY (tenant_id, order_id) REFERENCES sales_order(tenant_id, erp_id)
);
CREATE INDEX delivery_tracking ON delivery (tenant_id, tracking_number);

CREATE TABLE tracking_event (
    tenant_id       text NOT NULL REFERENCES tenant(id),
    tracking_number text NOT NULL,
    at              timestamptz NOT NULL,
    description     text NOT NULL,
    location        text,
    PRIMARY KEY (tenant_id, tracking_number, at, description)
);

CREATE TABLE invoice (
    tenant_id      text NOT NULL,
    erp_id         text NOT NULL,                      -- VBELN de la factura
    customer_id    text NOT NULL,
    order_id       text,
    invoice_date   date NOT NULL,
    due_date       date NOT NULL,
    net_amount     numeric(15,2) NOT NULL,
    tax_amount     numeric(15,2) NOT NULL,
    currency       char(3) NOT NULL DEFAULT 'EUR',
    payment_method text,
    pdf_file       text,
    paid_date      date,                               -- de la compensación en SAP (AUGDT)
    PRIMARY KEY (tenant_id, erp_id),
    FOREIGN KEY (tenant_id, customer_id) REFERENCES customer(tenant_id, erp_id)
);
CREATE INDEX invoice_customer_due ON invoice (tenant_id, customer_id, due_date);

CREATE TABLE app_user (
    id            uuid PRIMARY KEY,                    -- el "sub" del token de Keycloak
    tenant_id     text REFERENCES tenant(id),          -- null solo para administradores de plataforma
    email         text NOT NULL UNIQUE,
    name          text NOT NULL,
    role          user_role NOT NULL,
    sales_rep_id  text,
    customer_ids  text[] NOT NULL DEFAULT '{}',
    last_login_at timestamptz
);

CREATE TABLE incident (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   text NOT NULL,
    order_id    text NOT NULL,
    created_by  uuid NOT NULL REFERENCES app_user(id),
    kind        text NOT NULL,                         -- Falta material, Material dañado, Retraso...
    detail      text,
    status      text NOT NULL DEFAULT 'Abierta',
    created_at  timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, order_id) REFERENCES sales_order(tenant_id, erp_id)
);

CREATE TABLE sync_run (
    id          bigserial PRIMARY KEY,
    tenant_id   text NOT NULL REFERENCES tenant(id),
    started_at  timestamptz NOT NULL DEFAULT now(),
    ok          boolean NOT NULL,
    cursor      text,
    orders      integer NOT NULL DEFAULT 0,
    invoices    integer NOT NULL DEFAULT 0,
    issues      jsonb NOT NULL DEFAULT '[]',
    error       text
);

-- ---------------------------------------------------------------------------
-- Seguridad a nivel de fila
-- ---------------------------------------------------------------------------

CREATE FUNCTION app_can_see_customer(p_tenant text, p_customer text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT CASE current_setting('app.role', true)
        WHEN 'PlatformAdmin' THEN true
        WHEN 'CompanyAdmin'  THEN p_tenant = current_setting('app.tenant_id', true)
        WHEN 'SalesManager'  THEN p_tenant = current_setting('app.tenant_id', true) AND EXISTS (
            SELECT 1 FROM customer c JOIN sales_rep r ON r.tenant_id = c.tenant_id AND r.erp_id = c.sales_rep_id
            WHERE c.tenant_id = p_tenant AND c.erp_id = p_customer
              AND current_setting('app.sales_rep_id', true) IN (r.erp_id, r.manager_id))
        WHEN 'SalesRep'      THEN p_tenant = current_setting('app.tenant_id', true) AND EXISTS (
            SELECT 1 FROM customer c
            WHERE c.tenant_id = p_tenant AND c.erp_id = p_customer
              AND c.sales_rep_id = current_setting('app.sales_rep_id', true))
        WHEN 'Customer'      THEN p_tenant = current_setting('app.tenant_id', true)
            AND p_customer = ANY (coalesce(nullif(current_setting('app.customer_ids', true), ''), '{}')::text[])
        ELSE false
    END
$$;

ALTER TABLE customer    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_line  ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery    ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice     ENABLE ROW LEVEL SECURITY;

-- La función se ejecuta con los permisos de su dueño para poder leer customer sin recursión de políticas.
ALTER FUNCTION app_can_see_customer(text, text) SECURITY DEFINER;

CREATE POLICY customer_scope    ON customer    USING (app_can_see_customer(tenant_id, erp_id));
CREATE POLICY order_scope       ON sales_order USING (app_can_see_customer(tenant_id, customer_id));
CREATE POLICY invoice_scope     ON invoice     USING (app_can_see_customer(tenant_id, customer_id));
CREATE POLICY order_line_scope  ON order_line  USING (EXISTS (SELECT 1 FROM sales_order o WHERE o.tenant_id = order_line.tenant_id AND o.erp_id = order_line.order_id));
CREATE POLICY delivery_scope    ON delivery    USING (EXISTS (SELECT 1 FROM sales_order o WHERE o.tenant_id = delivery.tenant_id AND o.erp_id = delivery.order_id));

-- Rol con el que se conecta la API web (solo lectura sobre datos del ERP; la importación usa otro rol).
CREATE ROLE portal_api NOLOGIN;
GRANT SELECT ON customer, sales_order, order_line, delivery, tracking_event, invoice, sales_rep TO portal_api;
GRANT SELECT, INSERT, UPDATE ON incident, app_user TO portal_api;
