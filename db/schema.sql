-- Esquema del portal en PostgreSQL (objetivo: PostgreSQL 18).
-- Todas las tablas llevan tenant_id (empresa) y erp_id (identificador original en el ERP).
-- La seguridad a nivel de fila (RLS) impide ver filas de otra empresa o fuera del alcance del usuario,
-- aunque la aplicación tenga un fallo. La API fija en cada conexión:
--   SET app.tenant_id = '<empresa>'; SET app.role = '<rol>'; SET app.sales_rep_id = '<id>'; SET app.customer_ids = '{id1,id2}';

CREATE EXTENSION IF NOT EXISTS pg_trgm;              -- búsqueda por trozos de texto en el catálogo

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
-- Cartera de cada comercial (y la comprobación de RLS para SalesRep y SalesManager).
CREATE INDEX customer_sales_rep ON customer (tenant_id, sales_rep_id);

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
CREATE INDEX delivery_order ON delivery (tenant_id, order_id);

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
CREATE INDEX invoice_order ON invoice (tenant_id, order_id) WHERE order_id IS NOT NULL;
-- Facturas sin cobrar: la consulta más frecuente del resumen. Índice parcial, solo ocupa las pendientes.
CREATE INDEX invoice_unpaid ON invoice (tenant_id, customer_id, due_date) WHERE paid_date IS NULL;

-- Catálogo y pedidos desde el portal

CREATE TABLE product (
    tenant_id     text NOT NULL REFERENCES tenant(id),
    erp_id        text NOT NULL,                       -- MATNR
    description   text NOT NULL,
    unit          text NOT NULL,
    category      text,
    base_price    numeric(15,2) NOT NULL,
    tax_rate      numeric(5,2) NOT NULL DEFAULT 21,
    stock         numeric(15,3),
    min_quantity  numeric(15,3) NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, erp_id)
);
CREATE INDEX product_category ON product (tenant_id, category, description);
CREATE INDEX product_search ON product USING gin (description gin_trgm_ops);

CREATE TABLE customer_price (
    tenant_id    text NOT NULL,
    customer_id  text NOT NULL,
    material_id  text NOT NULL,
    price        numeric(15,2) NOT NULL,
    -- La clave primaria sirve de índice para "precio de este artículo para este cliente".
    PRIMARY KEY (tenant_id, customer_id, material_id),
    FOREIGN KEY (tenant_id, customer_id) REFERENCES customer(tenant_id, erp_id),
    FOREIGN KEY (tenant_id, material_id) REFERENCES product(tenant_id, erp_id)
);

CREATE TABLE ship_to (
    tenant_id    text NOT NULL,
    customer_id  text NOT NULL,
    erp_id       text NOT NULL,                        -- KUNWE
    name         text NOT NULL,
    address      text NOT NULL,
    PRIMARY KEY (tenant_id, customer_id, erp_id),
    FOREIGN KEY (tenant_id, customer_id) REFERENCES customer(tenant_id, erp_id)
);

CREATE TABLE order_request (
    tenant_id          text NOT NULL,
    id                 text NOT NULL,                  -- W261020-7KQ4M
    customer_id        text NOT NULL,
    created_by         text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    customer_reference text,
    requested_date     date NOT NULL,
    ship_to_id         text,
    notes              text,
    currency           char(3) NOT NULL DEFAULT 'EUR',
    lines              jsonb NOT NULL,                 -- posiciones con precio calculado al enviar
    status             text NOT NULL DEFAULT 'PendienteErp',
    erp_order_id       text,
    message            text,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, customer_id) REFERENCES customer(tenant_id, erp_id)
);
CREATE INDEX order_request_customer ON order_request (tenant_id, customer_id, created_at DESC);
-- Los que esperan respuesta de SAP: pocos, y se consultan en cada sincronización.
CREATE INDEX order_request_pending ON order_request (tenant_id) WHERE status = 'PendienteErp';

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

-- Comisiones: datos propios del portal (no vienen de SAP). Las ventas salen de invoice y order_line.

CREATE TYPE commission_basis AS ENUM ('Cobrado', 'Facturado');

CREATE TABLE commission_settings (
    tenant_id     text PRIMARY KEY REFERENCES tenant(id),
    basis         commission_basis NOT NULL DEFAULT 'Cobrado',
    default_rate  numeric(5,2) NOT NULL DEFAULT 0,     -- % cuando ninguna regla encaja
    bonus_rate    numeric(5,2) NOT NULL DEFAULT 0      -- % extra sobre lo que supera el objetivo del mes
);

-- Columnas vacías = vale para todos. Gana la regla más concreta: cliente > familia > comercial.
CREATE TABLE commission_rule (
    tenant_id     text NOT NULL REFERENCES tenant(id),
    id            text NOT NULL,
    sales_rep_id  text,
    customer_id   text,
    category      text,                                -- familia de artículo (product.category)
    rate          numeric(5,2) NOT NULL CHECK (rate BETWEEN 0 AND 100),
    valid_from    date,
    valid_to      date,
    note          text,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, sales_rep_id) REFERENCES sales_rep(tenant_id, erp_id),
    FOREIGN KEY (tenant_id, customer_id) REFERENCES customer(tenant_id, erp_id),
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE TABLE sales_target (
    tenant_id     text NOT NULL,
    sales_rep_id  text NOT NULL,
    year          smallint NOT NULL,
    month         smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    amount        numeric(15,2) NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (tenant_id, sales_rep_id, year, month),
    FOREIGN KEY (tenant_id, sales_rep_id) REFERENCES sales_rep(tenant_id, erp_id)
);

-- Mes cerrado: la base y la comisión quedan congeladas aunque cambien reglas o lleguen abonos.
CREATE TABLE commission_settlement (
    tenant_id     text NOT NULL,
    sales_rep_id  text NOT NULL,
    year          smallint NOT NULL,
    month         smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    base_amount   numeric(15,2) NOT NULL,
    commission    numeric(15,2) NOT NULL,
    lines         jsonb NOT NULL DEFAULT '[]',         -- detalle por factura en el momento del cierre
    closed_at     timestamptz NOT NULL DEFAULT now(),
    closed_by     text NOT NULL,
    paid_at       timestamptz,
    PRIMARY KEY (tenant_id, sales_rep_id, year, month),
    FOREIGN KEY (tenant_id, sales_rep_id) REFERENCES sales_rep(tenant_id, erp_id)
);
-- Ventas del año por fecha de factura y de cobro (base del dashboard).
CREATE INDEX invoice_date ON invoice (tenant_id, invoice_date);
CREATE INDEX invoice_paid ON invoice (tenant_id, paid_date) WHERE paid_date IS NOT NULL;

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
ALTER TABLE customer_price ENABLE ROW LEVEL SECURITY;
ALTER TABLE ship_to        ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_request  ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rule       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_target          ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_settlement ENABLE ROW LEVEL SECURITY;

-- La función se ejecuta con los permisos de su dueño para poder leer customer sin recursión de políticas.
ALTER FUNCTION app_can_see_customer(text, text) SECURITY DEFINER;

CREATE POLICY customer_scope    ON customer    USING (app_can_see_customer(tenant_id, erp_id));
CREATE POLICY order_scope       ON sales_order USING (app_can_see_customer(tenant_id, customer_id));
CREATE POLICY invoice_scope     ON invoice     USING (app_can_see_customer(tenant_id, customer_id));
CREATE POLICY order_line_scope  ON order_line  USING (EXISTS (SELECT 1 FROM sales_order o WHERE o.tenant_id = order_line.tenant_id AND o.erp_id = order_line.order_id));
CREATE POLICY price_scope       ON customer_price USING (app_can_see_customer(tenant_id, customer_id));
CREATE POLICY ship_to_scope     ON ship_to        USING (app_can_see_customer(tenant_id, customer_id));
CREATE POLICY request_scope     ON order_request  USING (app_can_see_customer(tenant_id, customer_id));
-- Comisiones: administración lo gestiona todo; cada comercial (o jefe de ventas, su equipo) solo lee lo suyo.
CREATE FUNCTION app_can_see_rep(p_tenant text, p_rep text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT CASE current_setting('app.role', true)
        WHEN 'PlatformAdmin' THEN true
        WHEN 'CompanyAdmin'  THEN p_tenant = current_setting('app.tenant_id', true)
        WHEN 'SalesManager'  THEN p_tenant = current_setting('app.tenant_id', true) AND (p_rep IS NULL OR EXISTS (
            SELECT 1 FROM sales_rep r WHERE r.tenant_id = p_tenant AND r.erp_id = p_rep
              AND current_setting('app.sales_rep_id', true) IN (r.erp_id, r.manager_id)))
        WHEN 'SalesRep'      THEN p_tenant = current_setting('app.tenant_id', true)
            AND (p_rep IS NULL OR p_rep = current_setting('app.sales_rep_id', true))
        ELSE false
    END
$$;
CREATE FUNCTION app_is_admin(p_tenant text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT current_setting('app.role', true) = 'PlatformAdmin'
        OR (current_setting('app.role', true) = 'CompanyAdmin' AND p_tenant = current_setting('app.tenant_id', true))
$$;
CREATE POLICY settings_read    ON commission_settings   FOR SELECT USING (app_can_see_rep(tenant_id, NULL));
CREATE POLICY settings_admin   ON commission_settings   USING (app_is_admin(tenant_id));
CREATE POLICY rule_read        ON commission_rule       FOR SELECT USING (app_can_see_rep(tenant_id, sales_rep_id));
CREATE POLICY rule_admin       ON commission_rule       USING (app_is_admin(tenant_id));
CREATE POLICY target_read      ON sales_target          FOR SELECT USING (app_can_see_rep(tenant_id, sales_rep_id));
CREATE POLICY target_admin     ON sales_target          USING (app_is_admin(tenant_id));
CREATE POLICY settlement_read  ON commission_settlement FOR SELECT USING (app_can_see_rep(tenant_id, sales_rep_id));
CREATE POLICY settlement_admin ON commission_settlement USING (app_is_admin(tenant_id));
CREATE POLICY delivery_scope    ON delivery    USING (EXISTS (SELECT 1 FROM sales_order o WHERE o.tenant_id = delivery.tenant_id AND o.erp_id = delivery.order_id));

-- Rol con el que se conecta la API web (solo lectura sobre datos del ERP; la importación usa otro rol).
CREATE ROLE portal_api NOLOGIN;
GRANT SELECT ON customer, sales_order, order_line, delivery, tracking_event, invoice, sales_rep, product, customer_price, ship_to TO portal_api;
GRANT SELECT, INSERT ON order_request TO portal_api;
GRANT SELECT, INSERT, UPDATE ON incident, app_user TO portal_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON commission_settings, commission_rule, sales_target, commission_settlement TO portal_api;
