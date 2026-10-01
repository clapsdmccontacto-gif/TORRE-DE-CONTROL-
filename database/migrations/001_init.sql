-- =============================================================================
-- Torre de Control Logística · Constructor Center (Los Ángeles, Región del Biobío)
-- Migración 001 · Esquema inicial WMS (bodega) + TMS (flota y última milla)
-- PostgreSQL 16 + PostGIS 3.4
--
-- Convenciones
--   * Tablas y columnas en inglés; valores de negocio (estados, clases) en español,
--     tal como los usa la operación y los muestran los reportes.
--   * PK uuid: la pistola de picking y la app del conductor generan el id sin señal y
--     sincronizan después de forma idempotente (un reintento no duplica registros).
--   * Coordenadas como geography(..., 4326): ST_Distance / ST_DWithin entregan metros.
--   * Instantes en timestamptz. Las ventanas de circulación usan hora local
--     America/Santiago (columnas time).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist; -- EXCLUDE (uuid =, tstzrange &&) en reservas de andén

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM
  ('ADMIN', 'TORRE_CONTROL', 'SUPERVISOR_BODEGA', 'PICKER', 'DESPACHADOR', 'CONDUCTOR');
CREATE TYPE handling_class AS ENUM
  ('GRANEL_PESADO', 'LARGO', 'GENERAL', 'FRAGIL', 'HERRAMIENTA', 'QUIMICO');
CREATE TYPE order_status AS ENUM
  ('RECIBIDO', 'EN_PICKING', 'PICKEADO', 'EN_STAGING', 'DESPACHADO', 'ENTREGADO',
   'ENTREGADO_PARCIAL', 'CANCELADO');
CREATE TYPE order_item_status AS ENUM ('PENDIENTE', 'EN_CARRO', 'PICKEADO', 'FALTANTE');
CREATE TYPE cart_type AS ENUM ('MODULAR', 'PLATAFORMA_PESADA', 'CARRO_LARGOS');
CREATE TYPE cart_status AS ENUM ('DISPONIBLE', 'EN_USO', 'MANTENCION');
CREATE TYPE picking_task_status AS ENUM ('ASIGNADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA');
CREATE TYPE mix_severity AS ENUM ('ADVERTENCIA', 'BLOQUEO');
CREATE TYPE mix_alert_resolution AS ENUM ('ADVERTIDO', 'BLOQUEADO', 'AUTORIZADO_SUPERVISOR');
CREATE TYPE dock_type AS ENUM ('ANDEN', 'BAHIA_PATIO');
CREATE TYPE staging_status AS ENUM ('RESERVADO', 'CONSOLIDANDO', 'LISTO_PARA_CARGA', 'LIBERADO');
CREATE TYPE pallet_status AS ENUM ('ARMANDO', 'CERRADO', 'EN_ANDEN', 'CARGADO', 'ENTREGADO');
CREATE TYPE axle_type AS ENUM ('SIMPLE_RUEDA_SIMPLE', 'SIMPLE_RUEDA_DOBLE', 'DOBLE_RUEDA_DOBLE');
CREATE TYPE vehicle_status AS ENUM ('DISPONIBLE', 'EN_RUTA', 'MANTENCION', 'FUERA_DE_SERVICIO');
CREATE TYPE route_status AS ENUM ('PLANIFICADA', 'CARGANDO', 'EN_CURSO', 'FINALIZADA', 'CANCELADA');
CREATE TYPE delivery_status AS ENUM
  ('PROGRAMADA', 'EN_RUTA', 'PROXIMA', 'EN_OBRA', 'ENTREGADO_CONFORME',
   'ENTREGADO_CON_OBSERVACIONES', 'RECHAZADO', 'FALLIDA');
CREATE TYPE delivery_event_type AS ENUM
  ('CAMBIO_ESTADO', 'AVISO_PROXIMIDAD', 'ENTRADA_GEOCERCA', 'SALIDA_GEOCERCA', 'EPOD_RECIBIDO',
   'INCIDENCIA');
CREATE TYPE epod_result AS ENUM ('CONFORME', 'CON_OBSERVACIONES', 'RECHAZADO');
CREATE TYPE notification_channel AS ENUM ('WHATSAPP', 'SMS', 'EMAIL', 'PUSH');
CREATE TYPE notification_status AS ENUM ('PENDIENTE', 'ENVIADA', 'FALLIDA');
CREATE TYPE zone_type AS ENUM ('URBANA', 'RURAL');
CREATE TYPE circulation_rule_kind AS ENUM ('PROHIBICION_HORARIA', 'LIMITE_PESO', 'LIMITE_LARGO');

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 1. Maestros
-- =============================================================================
CREATE TABLE app_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text NOT NULL,
  rut         text UNIQUE,
  email       text UNIQUE,
  phone       text,
  role        user_role NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rut            text NOT NULL UNIQUE,
  business_name  text NOT NULL,
  phone          text,
  email          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE warehouses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  address     text NOT NULL,
  location    geography(Point, 4326) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Obras: destino de las entregas.
CREATE TABLE sites (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id              uuid NOT NULL REFERENCES customers (id),
  name                     text NOT NULL,
  address                  text NOT NULL,
  commune                  text NOT NULL,
  location                 geography(Point, 4326) NOT NULL,
  geofence                 geography(Polygon, 4326),
  foreman_name             text,
  foreman_phone            text,
  notify_eta_minutes       smallint NOT NULL DEFAULT 15 CHECK (notify_eta_minutes BETWEEN 1 AND 120),
  has_unloading_equipment  boolean NOT NULL DEFAULT false,
  max_vehicle_length_m     numeric(4, 1) CHECK (max_vehicle_length_m > 0),
  access_notes             text,
  active                   boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sites_geofence_covers_location CHECK (geofence IS NULL OR ST_Covers(geofence, location))
);
CREATE INDEX sites_customer_idx ON sites (customer_id);
CREATE INDEX sites_location_gix ON sites USING gist (location);
CREATE INDEX sites_geofence_gix ON sites USING gist (geofence);

COMMENT ON COLUMN sites.location IS 'Punto de descarga. Referencia para la foto georreferenciada del e-POD.';
COMMENT ON COLUMN sites.geofence IS 'Perímetro de la obra: entrada/salida marca llegada y salida del camión.';
COMMENT ON COLUMN sites.notify_eta_minutes IS 'Minutos de ETA a los que se avisa al capataz (15 por defecto).';
COMMENT ON COLUMN sites.has_unloading_equipment IS 'Grúa horquilla u otro equipo en obra: no exige camión pluma.';

CREATE TABLE products (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                         text NOT NULL UNIQUE,
  ean                         text UNIQUE,
  name                        text NOT NULL,
  brand                       text,
  category                    text,
  sales_unit                  text NOT NULL,
  handling_class              handling_class NOT NULL,
  unit_weight_kg              numeric(10, 3) NOT NULL CHECK (unit_weight_kg > 0),
  length_cm                   numeric(7, 2) NOT NULL CHECK (length_cm > 0),
  width_cm                    numeric(7, 2) NOT NULL CHECK (width_cm > 0),
  height_cm                   numeric(7, 2) NOT NULL CHECK (height_cm > 0),
  unit_volume_m3              numeric(12, 6)
                              GENERATED ALWAYS AS (length_cm * width_cm * height_cm / 1000000) STORED,
  is_fragile                  boolean NOT NULL DEFAULT false,
  requires_mechanical_unload  boolean NOT NULL DEFAULT false,
  is_high_value               boolean NOT NULL DEFAULT false,
  active                      boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_handling_class_idx ON products (handling_class);

COMMENT ON TABLE products IS 'Peso y dimensiones corresponden a la unidad de manipulación (saco, caja, barra, maxisaco).';
COMMENT ON COLUMN products.handling_class IS 'Define la compatibilidad en el carro de picking y la carga en el camión.';
COMMENT ON COLUMN products.requires_mechanical_unload IS 'Fuerza descarga mecánica aunque pese menos del límite manual (25 kg, Ley 20.949).';
COMMENT ON COLUMN products.is_high_value IS 'Herramientas Makita/Bosch, etc.: doble verificación en picking.';

-- =============================================================================
-- 2. Flota y rutas (TMS)
-- =============================================================================
CREATE TABLE vehicle_types (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                           text NOT NULL UNIQUE,
  name                           text NOT NULL,
  size_rank                      smallint NOT NULL,
  gvwr_kg                        numeric(8, 1) NOT NULL,
  front_axle_type                axle_type NOT NULL,
  front_axle_tare_kg             numeric(8, 1) NOT NULL CHECK (front_axle_tare_kg > 0),
  front_axle_rating_kg           numeric(8, 1) NOT NULL,
  rear_axle_type                 axle_type NOT NULL,
  rear_axle_tare_kg              numeric(8, 1) NOT NULL CHECK (rear_axle_tare_kg > 0),
  rear_axle_rating_kg            numeric(8, 1) NOT NULL,
  tare_kg                        numeric(8, 1)
                                 GENERATED ALWAYS AS (front_axle_tare_kg + rear_axle_tare_kg) STORED,
  max_payload_kg                 numeric(8, 1)
                                 GENERATED ALWAYS AS (gvwr_kg - front_axle_tare_kg - rear_axle_tare_kg) STORED,
  wheelbase_m                    numeric(5, 3) NOT NULL CHECK (wheelbase_m > 0),
  cargo_start_from_front_axle_m  numeric(5, 3) NOT NULL CHECK (cargo_start_from_front_axle_m >= 0),
  cargo_length_m                 numeric(4, 2) NOT NULL CHECK (cargo_length_m > 0),
  cargo_width_m                  numeric(4, 2) NOT NULL CHECK (cargo_width_m > 0),
  cargo_height_m                 numeric(4, 2) NOT NULL CHECK (cargo_height_m > 0),
  stowage_factor                 numeric(3, 2) NOT NULL DEFAULT 0.85
                                 CHECK (stowage_factor > 0 AND stowage_factor <= 1),
  max_rear_overhang_m            numeric(3, 2) NOT NULL DEFAULT 0 CHECK (max_rear_overhang_m >= 0),
  crane_max_lift_kg              numeric(8, 1) CHECK (crane_max_lift_kg > 0),
  cost_per_km                    numeric(8, 1) NOT NULL CHECK (cost_per_km > 0),
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_types_gvwr_over_tare CHECK (gvwr_kg > front_axle_tare_kg + rear_axle_tare_kg)
);

COMMENT ON TABLE vehicle_types IS 'Especificación por tipo de vehículo: entrada del simulador de cubicaje.';
COMMENT ON COLUMN vehicle_types.gvwr_kg IS 'Peso bruto vehicular (PBV) del fabricante.';
COMMENT ON COLUMN vehicle_types.front_axle_rating_kg IS 'Capacidad del eje según fabricante; el límite efectivo es el menor entre éste y el legal (DS 158 MOP).';
COMMENT ON COLUMN vehicle_types.cargo_height_m IS 'Altura máxima de carga estable, no la altura de la caja.';
COMMENT ON COLUMN vehicle_types.stowage_factor IS 'Fracción del volumen geométrico aprovechable con carga mixta.';
COMMENT ON COLUMN vehicle_types.crane_max_lift_kg IS 'NULL = vehículo sin pluma.';

CREATE TABLE vehicles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate              text NOT NULL UNIQUE,
  vehicle_type_id    uuid NOT NULL REFERENCES vehicle_types (id),
  home_warehouse_id  uuid NOT NULL REFERENCES warehouses (id),
  gps_device_id      text UNIQUE,
  status             vehicle_status NOT NULL DEFAULT 'DISPONIBLE',
  last_position      geography(Point, 4326),
  last_position_at   timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_type_idx ON vehicles (vehicle_type_id);

COMMENT ON COLUMN vehicles.last_position IS 'Última posición GPS, desnormalizada para el mapa en vivo de la torre de control.';

CREATE TABLE routes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE,
  route_date           date NOT NULL,
  warehouse_id         uuid NOT NULL REFERENCES warehouses (id),
  vehicle_id           uuid REFERENCES vehicles (id),
  driver_id            uuid REFERENCES app_users (id),
  status               route_status NOT NULL DEFAULT 'PLANIFICADA',
  planned_departure    timestamptz,
  actual_departure     timestamptz,
  actual_return        timestamptz,
  planned_path         geography(LineString, 4326),
  planned_distance_km  numeric(7, 2) CHECK (planned_distance_km >= 0),
  load_plan            jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT routes_assigned_before_loading CHECK (
    status IN ('PLANIFICADA', 'CANCELADA') OR (vehicle_id IS NOT NULL AND driver_id IS NOT NULL)
  )
);
CREATE INDEX routes_date_status_idx ON routes (route_date, status);
CREATE INDEX routes_vehicle_idx ON routes (vehicle_id, route_date);

COMMENT ON COLUMN routes.load_plan IS 'Resultado del cubicaje con que se eligió el vehículo (auditoría de la decisión).';

-- =============================================================================
-- 3. Pedidos y picking (WMS)
-- =============================================================================
CREATE TABLE orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number             text NOT NULL UNIQUE,
  customer_id              uuid NOT NULL REFERENCES customers (id),
  site_id                  uuid NOT NULL REFERENCES sites (id),
  warehouse_id             uuid NOT NULL REFERENCES warehouses (id),
  status                   order_status NOT NULL DEFAULT 'RECIBIDO',
  priority                 smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  requested_delivery_date  date NOT NULL,
  delivery_window          tstzrange,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_status_date_idx ON orders (status, requested_delivery_date);
CREATE INDEX orders_site_idx ON orders (site_id);

COMMENT ON COLUMN orders.order_number IS 'Nota de venta del ERP.';
COMMENT ON COLUMN orders.priority IS '1 = urgente, 5 = baja.';

CREATE TABLE order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  line_number      smallint NOT NULL,
  product_id       uuid NOT NULL REFERENCES products (id),
  quantity         numeric(12, 3) NOT NULL CHECK (quantity > 0),
  picked_quantity  numeric(12, 3) NOT NULL DEFAULT 0 CHECK (picked_quantity >= 0),
  status           order_item_status NOT NULL DEFAULT 'PENDIENTE',
  pick_location    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_line_unique UNIQUE (order_id, line_number),
  CONSTRAINT order_items_picked_le_quantity CHECK (picked_quantity <= quantity)
);
CREATE INDEX order_items_product_idx ON order_items (product_id);

CREATE TABLE picking_carts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,
  warehouse_id        uuid NOT NULL REFERENCES warehouses (id),
  cart_type           cart_type NOT NULL,
  max_load_kg         numeric(8, 2) NOT NULL CHECK (max_load_kg > 0),
  max_volume_m3       numeric(6, 3) NOT NULL CHECK (max_volume_m3 > 0),
  max_item_length_cm  numeric(7, 2) NOT NULL CHECK (max_item_length_cm > 0),
  status              cart_status NOT NULL DEFAULT 'DISPONIBLE',
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN picking_carts.code IS 'Código del QR pegado en el carro.';

CREATE TABLE picking_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders (id),
  cart_id       uuid NOT NULL REFERENCES picking_carts (id),
  picker_id     uuid REFERENCES app_users (id),
  status        picking_task_status NOT NULL DEFAULT 'ASIGNADA',
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Un carro físico sólo puede estar en una tarea activa a la vez.
CREATE UNIQUE INDEX picking_tasks_one_active_per_cart
  ON picking_tasks (cart_id) WHERE status IN ('ASIGNADA', 'EN_CURSO');
CREATE INDEX picking_tasks_order_idx ON picking_tasks (order_id);

COMMENT ON TABLE picking_tasks IS 'Un viaje de carro para un pedido. Un pedido mixto usa varios carros (pesado, modular, largos).';

-- Contenido físico del carro: cada escaneo confirmado.
CREATE TABLE cart_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_task_id  uuid NOT NULL REFERENCES picking_tasks (id) ON DELETE CASCADE,
  order_item_id    uuid NOT NULL REFERENCES order_items (id),
  quantity         numeric(12, 3) NOT NULL CHECK (quantity > 0),
  scanned_by       uuid REFERENCES app_users (id),
  scanned_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cart_items_task_idx ON cart_items (picking_task_id);
CREATE INDEX cart_items_order_item_idx ON cart_items (order_item_id);

-- Auditoría de la regla de mezcla incompatible (feed de la torre de control).
CREATE TABLE mix_alerts (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_task_id            uuid NOT NULL REFERENCES picking_tasks (id),
  incoming_order_item_id     uuid NOT NULL REFERENCES order_items (id),
  conflicting_order_item_id  uuid REFERENCES order_items (id),
  rule_code                  text NOT NULL,
  severity                   mix_severity NOT NULL,
  message                    text NOT NULL,
  resolution                 mix_alert_resolution NOT NULL,
  authorized_by              uuid REFERENCES app_users (id),
  authorization_reason       text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mix_alerts_resolution_matches_severity CHECK (
    (severity = 'ADVERTENCIA' AND resolution = 'ADVERTIDO')
    OR (severity = 'BLOQUEO' AND resolution IN ('BLOQUEADO', 'AUTORIZADO_SUPERVISOR'))
  ),
  CONSTRAINT mix_alerts_authorization_complete CHECK (
    (resolution = 'AUTORIZADO_SUPERVISOR')
    = (authorized_by IS NOT NULL AND authorization_reason IS NOT NULL)
  )
);
CREATE INDEX mix_alerts_task_idx ON mix_alerts (picking_task_id);
CREATE INDEX mix_alerts_created_idx ON mix_alerts (created_at DESC);

COMMENT ON COLUMN mix_alerts.rule_code IS 'MEZCLA_INCOMPATIBLE, PESADO_CON_SENSIBLE, LARGO_EXCEDE_CARRO, SOBREPESO_CARRO, ...';
COMMENT ON COLUMN mix_alerts.conflicting_order_item_id IS 'NULL en reglas de capacidad del carro.';

-- =============================================================================
-- 4. Staging virtual por obra
-- =============================================================================
CREATE TABLE docks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id        uuid NOT NULL REFERENCES warehouses (id),
  code                text NOT NULL,
  dock_type           dock_type NOT NULL,
  capacity_pallets    smallint NOT NULL CHECK (capacity_pallets > 0),
  allows_crane_truck  boolean NOT NULL DEFAULT false,
  active              boolean NOT NULL DEFAULT true,
  CONSTRAINT docks_code_unique UNIQUE (warehouse_id, code)
);

-- Reserva de un andén/bahía para consolidar los pallets de una obra antes de cargar.
CREATE TABLE staging_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dock_id          uuid NOT NULL REFERENCES docks (id),
  site_id          uuid NOT NULL REFERENCES sites (id),
  route_id         uuid REFERENCES routes (id),
  reserved_during  tstzrange NOT NULL CHECK (NOT isempty(reserved_during)),
  status           staging_status NOT NULL DEFAULT 'RESERVADO',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- La base de datos impide reservar dos veces el mismo andén en horarios que se solapan.
  CONSTRAINT staging_no_overlap
    EXCLUDE USING gist (dock_id WITH =, reserved_during WITH &&) WHERE (status <> 'LIBERADO')
);
CREATE INDEX staging_assignments_site_idx ON staging_assignments (site_id);

CREATE TABLE pallets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_code             text NOT NULL UNIQUE,
  order_id               uuid NOT NULL REFERENCES orders (id),
  staging_assignment_id  uuid REFERENCES staging_assignments (id),
  gross_weight_kg        numeric(8, 2) CHECK (gross_weight_kg > 0),
  length_cm              numeric(6, 1) CHECK (length_cm > 0),
  width_cm               numeric(6, 1) CHECK (width_cm > 0),
  height_cm              numeric(6, 1) CHECK (height_cm > 0),
  status                 pallet_status NOT NULL DEFAULT 'ARMANDO',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pallets_order_idx ON pallets (order_id);
CREATE INDEX pallets_staging_idx ON pallets (staging_assignment_id);

COMMENT ON COLUMN pallets.label_code IS 'Contenido del QR de la etiqueta (ej. CC-PLT-000123).';

-- =============================================================================
-- 5. Entregas, tracking y e-POD (última milla)
-- =============================================================================
CREATE TABLE deliveries (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id               uuid NOT NULL REFERENCES orders (id),
  route_id               uuid REFERENCES routes (id),
  stop_sequence          smallint CHECK (stop_sequence > 0),
  status                 delivery_status NOT NULL DEFAULT 'PROGRAMADA',
  planned_eta            timestamptz,
  current_eta            timestamptz,
  proximity_notified_at  timestamptz,
  arrived_at             timestamptz,
  delivered_at           timestamptz,
  failure_reason         text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- Diferible para poder reordenar paradas dentro de una transacción.
  CONSTRAINT deliveries_stop_unique UNIQUE (route_id, stop_sequence) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT deliveries_stop_requires_route CHECK ((route_id IS NULL) = (stop_sequence IS NULL)),
  CONSTRAINT deliveries_delivered_has_timestamp CHECK (
    status NOT IN ('ENTREGADO_CONFORME', 'ENTREGADO_CON_OBSERVACIONES') OR delivered_at IS NOT NULL
  )
);
CREATE INDEX deliveries_order_idx ON deliveries (order_id);
CREATE INDEX deliveries_in_progress_idx ON deliveries (status)
  WHERE status IN ('EN_RUTA', 'PROXIMA', 'EN_OBRA');

COMMENT ON TABLE deliveries IS 'Parada de una ruta. Un pedido puede tener varias (entregas parciales o carga dividida).';
COMMENT ON COLUMN deliveries.current_eta IS 'ETA recalculada con cada posición GPS.';
COMMENT ON COLUMN deliveries.proximity_notified_at IS 'Momento en que se avisó al capataz (ETA <= sites.notify_eta_minutes).';

-- Prueba de entrega digital. La firma y la foto viven en almacenamiento de objetos (S3/MinIO).
CREATE TABLE delivery_proofs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id           uuid NOT NULL UNIQUE REFERENCES deliveries (id),
  result                epod_result NOT NULL,
  receiver_name         text NOT NULL,
  receiver_rut          text,
  signature_object_key  text NOT NULL,
  photo_object_key      text NOT NULL,
  photo_location        geography(Point, 4326) NOT NULL,
  photo_accuracy_m      numeric(6, 1) CHECK (photo_accuracy_m >= 0),
  photo_taken_at        timestamptz NOT NULL,
  observations          text,
  captured_by           uuid NOT NULL REFERENCES app_users (id),
  device_id             text,
  received_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_proofs_observations_required CHECK (result = 'CONFORME' OR observations IS NOT NULL)
);

COMMENT ON COLUMN delivery_proofs.id IS 'Generado en el teléfono del conductor: reintentos sin señal no duplican la prueba.';
COMMENT ON COLUMN delivery_proofs.received_at IS 'Llegada al servidor; puede ser posterior a photo_taken_at si no había señal.';

-- Alto volumen: particionar por mes (o usar TimescaleDB) cuando la flota crezca.
CREATE TABLE gps_positions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id   uuid NOT NULL REFERENCES vehicles (id),
  route_id     uuid REFERENCES routes (id),
  recorded_at  timestamptz NOT NULL,
  position     geography(Point, 4326) NOT NULL,
  speed_kmh    numeric(5, 1) CHECK (speed_kmh >= 0),
  heading_deg  smallint CHECK (heading_deg BETWEEN 0 AND 359),
  accuracy_m   numeric(6, 1) CHECK (accuracy_m >= 0),
  CONSTRAINT gps_positions_dedupe UNIQUE (vehicle_id, recorded_at)
);
CREATE INDEX gps_positions_route_idx ON gps_positions (route_id, recorded_at);

-- Línea de tiempo de cada entrega (cambios de estado, geocercas, avisos, e-POD).
CREATE TABLE delivery_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id  uuid NOT NULL REFERENCES deliveries (id) ON DELETE CASCADE,
  event_type   delivery_event_type NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  position     geography(Point, 4326),
  payload      jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX delivery_events_delivery_idx ON delivery_events (delivery_id, occurred_at);

-- Bandeja de salida (patrón outbox) para WhatsApp/SMS al capataz.
CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id    uuid REFERENCES deliveries (id),
  channel        notification_channel NOT NULL,
  recipient      text NOT NULL,
  template_code  text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}',
  dedupe_key     text NOT NULL UNIQUE,
  status         notification_status NOT NULL DEFAULT 'PENDIENTE',
  attempts       smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz
);
CREATE INDEX notifications_pending_idx ON notifications (created_at) WHERE status = 'PENDIENTE';

COMMENT ON COLUMN notifications.dedupe_key IS 'Ej. proximidad:<delivery_id>. El GPS oscila en torno al umbral y no debe avisar dos veces.';

-- =============================================================================
-- 6. Matriz de restricción urbana y rural
-- =============================================================================
CREATE TABLE restriction_zones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  zone_type  zone_type NOT NULL,
  area       geography(MultiPolygon, 4326) NOT NULL,
  notes      text
);
CREATE INDEX restriction_zones_area_gix ON restriction_zones USING gist (area);

CREATE TABLE circulation_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id               uuid NOT NULL REFERENCES restriction_zones (id) ON DELETE CASCADE,
  kind                  circulation_rule_kind NOT NULL,
  description           text NOT NULL,
  applies_from_gvwr_kg  numeric(8, 1),
  days_of_week          smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
  time_from             time,
  time_to               time,
  max_gross_weight_kg   numeric(8, 1) CHECK (max_gross_weight_kg > 0),
  max_length_m          numeric(4, 1) CHECK (max_length_m > 0),
  valid_from            date NOT NULL DEFAULT CURRENT_DATE,
  valid_to              date,
  source_reference      text,
  active                boolean NOT NULL DEFAULT true,
  CONSTRAINT circulation_rules_iso_days CHECK (days_of_week <@ '{1,2,3,4,5,6,7}'::smallint[]),
  CONSTRAINT circulation_rules_schedule CHECK (
    kind <> 'PROHIBICION_HORARIA' OR (time_from IS NOT NULL AND time_to IS NOT NULL)
  ),
  CONSTRAINT circulation_rules_weight CHECK (kind <> 'LIMITE_PESO' OR max_gross_weight_kg IS NOT NULL),
  CONSTRAINT circulation_rules_length CHECK (kind <> 'LIMITE_LARGO' OR max_length_m IS NOT NULL),
  CONSTRAINT circulation_rules_validity CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX circulation_rules_zone_idx ON circulation_rules (zone_id) WHERE active;

COMMENT ON COLUMN circulation_rules.applies_from_gvwr_kg IS 'Aplica a vehículos con PBV >= este valor; NULL = todos.';
COMMENT ON COLUMN circulation_rules.days_of_week IS 'ISO 8601: 1 = lunes ... 7 = domingo.';
COMMENT ON COLUMN circulation_rules.time_from IS 'Hora local America/Santiago. Si time_from > time_to la ventana cruza la medianoche.';
COMMENT ON COLUMN circulation_rules.source_reference IS 'Ordenanza o resolución que respalda la regla.';

-- =============================================================================
-- 7. updated_at automático
-- =============================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_users', 'customers', 'sites', 'products', 'vehicle_types', 'vehicles', 'routes',
    'orders', 'order_items', 'picking_tasks', 'staging_assignments', 'pallets', 'deliveries'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t
    );
  END LOOP;
END;
$$;

-- =============================================================================
-- 8. Vistas para la torre de control
-- =============================================================================

-- Monitor de picking: avance por líneas y por peso (un pedido mixto con 60 sacos y un
-- taladro no avanza "50 %" al pickear el taladro).
CREATE VIEW v_picking_progress AS
SELECT
  o.id AS order_id,
  o.order_number,
  o.status,
  o.priority,
  o.requested_delivery_date,
  s.name AS site_name,
  count(*) AS total_lines,
  count(*) FILTER (WHERE oi.status = 'PICKEADO') AS picked_lines,
  count(*) FILTER (WHERE oi.status = 'FALTANTE') AS missing_lines,
  round(100 * sum(oi.picked_quantity * p.unit_weight_kg)
        / sum(oi.quantity * p.unit_weight_kg), 1) AS progress_by_weight_pct
FROM orders o
JOIN sites s ON s.id = o.site_id
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
GROUP BY o.id, s.name;

-- Perfil de carga por pedido: entrada del cubicaje cuando se planifica desde la base.
CREATE VIEW v_order_load_profile AS
SELECT
  o.id AS order_id,
  o.order_number,
  o.site_id,
  count(*) AS line_count,
  round(sum(oi.quantity * p.unit_weight_kg), 2) AS total_weight_kg,
  round(sum(oi.quantity * p.unit_volume_m3), 3) AS total_volume_m3,
  round(max(greatest(p.length_cm, p.width_cm, p.height_cm)) / 100, 2) AS longest_item_m,
  max(p.unit_weight_kg) AS heaviest_unit_kg,
  bool_or(p.requires_mechanical_unload) AS has_flagged_mechanical_unload,
  array_agg(DISTINCT p.handling_class) AS handling_classes
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
GROUP BY o.id;

-- Zonas de restricción que afectan a cada obra (cruce espacial, sin FK que mantener).
CREATE VIEW v_site_restriction_zones AS
SELECT s.id AS site_id, s.name AS site_name, z.id AS zone_id, z.code AS zone_code, z.zone_type
FROM sites s
JOIN restriction_zones z ON ST_Covers(z.area, s.location);

-- Control del e-POD: distancia entre la foto de descarga y la obra.
CREATE VIEW v_epod_audit AS
SELECT
  dp.id AS proof_id,
  d.id AS delivery_id,
  o.order_number,
  s.name AS site_name,
  dp.result,
  round(ST_Distance(dp.photo_location, s.location)::numeric) AS distance_to_site_m,
  CASE WHEN s.geofence IS NOT NULL THEN ST_Covers(s.geofence, dp.photo_location) END AS inside_geofence,
  dp.photo_taken_at,
  dp.received_at
FROM delivery_proofs dp
JOIN deliveries d ON d.id = dp.delivery_id
JOIN orders o ON o.id = d.order_id
JOIN sites s ON s.id = o.site_id;

COMMIT;
