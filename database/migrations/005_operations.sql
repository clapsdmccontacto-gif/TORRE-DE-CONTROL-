-- =============================================================================
-- Migración 005 · Registros de la operación
-- =============================================================================
-- Planes de ruta (con el publicado a la flota), rutas de los conductores con el avance de
-- cada parada y los eventos recientes del mapa en vivo, como registros JSON por colección.
-- Así nada se pierde cuando el servidor se reinicia o se despierta (plan gratuito de
-- Render). El backend también crea esta tabla si no existe.

BEGIN;

CREATE TABLE IF NOT EXISTS ops_records (
  collection text NOT NULL,
  id         text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);

COMMENT ON TABLE ops_records IS
  'Registros de la operación por colección (route-plans, routing, driver-sessions, tracking): JSON validado por el backend.';

COMMIT;
