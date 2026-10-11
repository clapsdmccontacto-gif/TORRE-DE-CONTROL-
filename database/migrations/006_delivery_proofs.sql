-- =============================================================================
-- Migración 006 · Comprobantes de entrega (e-POD)
-- =============================================================================
-- Cada entrega registrada por el conductor: quién recibió (nombre y RUT), cantidades,
-- motivo de entrega parcial o rechazo, posición GPS y distancia a la obra (JSON en
-- `data`), con firma y fotos en `bytea`. El backend también crea estas tablas si no
-- existen (por ejemplo, en la base gratuita de Render).

BEGIN;

CREATE TABLE IF NOT EXISTS delivery_proofs (
  id            text PRIMARY KEY,
  order_id      text NOT NULL,
  vehicle_plate text NOT NULL,
  outcome       text NOT NULL CHECK (outcome IN ('ENTREGADO', 'ENTREGA_PARCIAL', 'RECHAZADO')),
  captured_at   timestamptz NOT NULL,
  data          jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_proofs_captured_at ON delivery_proofs (captured_at);
CREATE INDEX IF NOT EXISTS delivery_proofs_order ON delivery_proofs (order_id);

CREATE TABLE IF NOT EXISTS delivery_images (
  id         text PRIMARY KEY,
  proof_id   text NOT NULL REFERENCES delivery_proofs (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('FIRMA', 'FOTO')),
  mime       text NOT NULL,
  bytes      bytea NOT NULL CHECK (octet_length(bytes) <= 1000000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_images_proof ON delivery_images (proof_id);

COMMENT ON TABLE delivery_proofs IS 'Comprobantes de entrega (e-POD): JSON validado por el backend.';
COMMENT ON TABLE delivery_images IS 'Firma y fotos de cada comprobante (máximo 1 MB por imagen).';

COMMIT;
