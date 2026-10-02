-- =============================================================================
-- Migración 003 · Rutas ajustadas con calles y tráfico reales (TomTom)
-- =============================================================================

BEGIN;

-- Origen de la distancia planificada: estimada (línea recta × factor) o calculada por
-- las calles con tráfico en vivo. Con 'CALLES', planned_path sigue el trazado real.
ALTER TABLE routes
  ADD COLUMN planned_distance_source text NOT NULL DEFAULT 'ESTIMADA'
    CHECK (planned_distance_source IN ('ESTIMADA', 'CALLES')),
  ADD COLUMN planned_traffic_delay_min smallint CHECK (planned_traffic_delay_min >= 0),
  ADD COLUMN planned_toll_km numeric(7, 2) CHECK (planned_toll_km >= 0),
  ADD CONSTRAINT routes_road_data_only_with_streets CHECK (
    planned_distance_source = 'CALLES'
    OR (planned_traffic_delay_min IS NULL AND planned_toll_km IS NULL)
  );

COMMENT ON COLUMN routes.planned_traffic_delay_min IS
  'Demora por congestión informada por el proveedor de rutas al planificar.';

COMMIT;
