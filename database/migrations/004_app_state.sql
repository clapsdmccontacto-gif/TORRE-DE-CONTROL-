-- =============================================================================
-- Migración 004 · Datos maestros que carga la empresa desde la app
-- =============================================================================
-- Bodega, camiones (patente + tipo), productos, obras y pedidos se guardan como un
-- documento JSON por clave mientras se construyen los adaptadores relacionales
-- (fase 2: vehicles, products, sites, orders). El backend también crea esta tabla si
-- no existe (por ejemplo, en la base gratuita de Render).

BEGIN;

CREATE TABLE IF NOT EXISTS app_state (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_state IS 'Datos maestros de la app (clave master-data): JSON validado por el backend.';

COMMIT;
