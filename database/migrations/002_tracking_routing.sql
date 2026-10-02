-- =============================================================================
-- Migración 002 · Rastreo GPS de conductores y optimización de rutas por combustible
-- =============================================================================

BEGIN;

-- Consumo de diésel por tipo de vehículo: entrada del optimizador de rutas.
-- Entre vacío y plena carga se interpola según la carga a bordo en cada tramo.
ALTER TABLE vehicle_types
  ADD COLUMN fuel_empty_l_per_100km numeric(5, 2) NOT NULL DEFAULT 15
    CHECK (fuel_empty_l_per_100km > 0),
  ADD COLUMN fuel_full_l_per_100km numeric(5, 2) NOT NULL DEFAULT 20,
  ADD CONSTRAINT vehicle_types_fuel_full_ge_empty
    CHECK (fuel_full_l_per_100km >= fuel_empty_l_per_100km);

-- Resultado del optimizador guardado en cada ruta.
ALTER TABLE routes
  ADD COLUMN planned_fuel_liters numeric(7, 2) CHECK (planned_fuel_liters >= 0),
  ADD COLUMN planned_co2_kg numeric(8, 2) CHECK (planned_co2_kg >= 0);

-- Sesión de un conductor ("operador de ruta") con su teléfono: une dispositivo,
-- vehículo y ruta mientras el GPS está activo.
CREATE TABLE driver_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    uuid REFERENCES app_users (id),
  driver_name  text NOT NULL,
  vehicle_id   uuid NOT NULL REFERENCES vehicles (id),
  route_id     uuid REFERENCES routes (id),
  device_info  text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  CONSTRAINT driver_sessions_valid_period CHECK (ended_at IS NULL OR ended_at >= started_at)
);
-- Un vehículo tiene a lo más una sesión activa (otro teléfono la reemplaza).
CREATE UNIQUE INDEX driver_sessions_one_active_per_vehicle
  ON driver_sessions (vehicle_id) WHERE ended_at IS NULL;

COMMENT ON COLUMN driver_sessions.device_info IS 'Navegador/teléfono que envía el GPS (diagnóstico).';

ALTER TABLE gps_positions ADD COLUMN session_id uuid REFERENCES driver_sessions (id);
CREATE INDEX gps_positions_session_idx ON gps_positions (session_id, recorded_at);

-- Última posición de cada sesión activa: base del mapa en vivo.
CREATE VIEW v_live_fleet AS
SELECT DISTINCT ON (ds.id)
  ds.id AS session_id,
  ds.driver_name,
  v.plate,
  vt.name AS vehicle_type,
  gp.position,
  gp.speed_kmh,
  gp.recorded_at
FROM driver_sessions ds
JOIN vehicles v ON v.id = ds.vehicle_id
JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
LEFT JOIN gps_positions gp ON gp.session_id = ds.id
WHERE ds.ended_at IS NULL
ORDER BY ds.id, gp.recorded_at DESC NULLS LAST;

-- Trayecto recorrido por sesión, como línea y distancia (reportes y auditoría).
CREATE VIEW v_session_tracks AS
SELECT
  session_id,
  count(*) AS points,
  min(recorded_at) AS started_at,
  max(recorded_at) AS last_seen_at,
  ST_MakeLine(position::geometry ORDER BY recorded_at)::geography AS track,
  round(
    (ST_Length(ST_MakeLine(position::geometry ORDER BY recorded_at)::geography) / 1000)::numeric, 2
  ) AS distance_km
FROM gps_positions
WHERE session_id IS NOT NULL
GROUP BY session_id;

COMMIT;
