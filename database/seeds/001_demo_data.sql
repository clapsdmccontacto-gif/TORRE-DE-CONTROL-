-- =============================================================================
-- Datos de demostración · NO cargar en producción
--
-- Las coordenadas son aproximadas y las reglas de circulación son ILUSTRATIVAS:
-- validarlas con la Dirección de Tránsito de Los Ángeles y con Vialidad antes de operar.
-- Productos y flota son los mismos que usa el backend en memoria
-- (backend/src/modules/*/infrastructure).
-- =============================================================================

BEGIN;

INSERT INTO warehouses (code, name, address, location) VALUES
  ('BOD-LA', 'Bodega Los Ángeles', 'Los Ángeles, Región del Biobío (referencial)',
   ST_GeogFromText('POINT(-72.3390 -37.4610)'));

INSERT INTO app_users (full_name, email, role) VALUES
  ('Torre de Control (demo)', 'torre@demo.local', 'TORRE_CONTROL'),
  ('Supervisor Bodega (demo)', 'supervisor@demo.local', 'SUPERVISOR_BODEGA'),
  ('Picker 1 (demo)', 'picker1@demo.local', 'PICKER'),
  ('Conductor 1 (demo)', 'conductor1@demo.local', 'CONDUCTOR');

INSERT INTO customers (rut, business_name) VALUES
  ('76000001-9', 'Constructora Demo Biobío SpA'),
  ('76000002-7', 'Inmobiliaria Demo Laja Ltda.');

INSERT INTO sites (customer_id, name, address, commune, location, geofence, foreman_name,
                   foreman_phone, has_unloading_equipment, access_notes)
SELECT c.id, v.name, v.address, v.commune, v.location, ST_Buffer(v.location, v.radius_m),
       v.foreman, v.phone, v.equipment, v.notes
FROM (VALUES
  ('76000001-9', 'Edificio Las Araucarias', 'Sector centro (referencial)', 'Los Ángeles',
   ST_GeogFromText('POINT(-72.3560 -37.4720)'), 80, 'Capataz Demo 1', '+56900000001', false,
   'Descarga por calle lateral, radio urbano'),
  ('76000001-9', 'Condominio Santa Bárbara', 'Acceso rural (referencial)', 'Santa Bárbara',
   ST_GeogFromText('POINT(-72.0200 -37.6650)'), 150, 'Capataz Demo 2', '+56900000002', false,
   'Últimos 2 km de ripio'),
  ('76000002-7', 'Galpón Nacimiento', 'Sector industrial (referencial)', 'Nacimiento',
   ST_GeogFromText('POINT(-72.6700 -37.5000)'), 200, 'Capataz Demo 3', '+56900000003', true,
   'Cuenta con grúa horquilla')
) AS v (rut, name, address, commune, location, radius_m, foreman, phone, equipment, notes)
JOIN customers c ON c.rut = v.rut;

INSERT INTO products (sku, name, brand, category, sales_unit, handling_class, unit_weight_kg,
                      length_cm, width_cm, height_cm, is_fragile, requires_mechanical_unload,
                      is_high_value) VALUES
  ('CEM-ESP-25', 'Cemento especial saco 25 kg', NULL, 'Obra gruesa', 'SACO',
   'GRANEL_PESADO', 25, 55, 38, 10, false, false, false),
  ('ARE-MAXI-1M3', 'Arena gruesa maxisaco 1 m³', NULL, 'Áridos', 'MAXISACO',
   'GRANEL_PESADO', 1500, 100, 100, 100, false, true, false),
  ('FIE-A630-12', 'Fierro estriado A630-420H 12 mm x 6 m', NULL, 'Fierro', 'BARRA',
   'LARGO', 5.33, 600, 1.2, 1.2, false, false, false),
  ('OSB-11-1224', 'Plancha OSB 11,1 mm 1,22 x 2,44 m', NULL, 'Tableros', 'PLANCHA',
   'LARGO', 21, 244, 122, 1.1, false, false, false),
  ('CLA-COR-4', 'Clavo corriente 4" caja 25 kg', NULL, 'Fijaciones', 'CAJA',
   'GENERAL', 25, 35, 25, 15, false, false, false),
  ('CER-MUR-2540', 'Cerámica muro 25x40 cm caja 1,5 m²', NULL, 'Terminaciones', 'CAJA',
   'FRAGIL', 17, 41, 26, 12, true, false, false),
  ('LAV-LOZA-50', 'Lavamanos loza 50 cm', NULL, 'Sanitarios', 'UN',
   'FRAGIL', 9, 55, 45, 22, true, false, false),
  ('MAK-HP1630', 'Taladro percutor Makita HP1630 710 W', 'Makita', 'Herramientas eléctricas', 'UN',
   'HERRAMIENTA', 2.3, 32, 25, 9, false, false, true),
  ('BOS-GWS700', 'Esmeril angular Bosch GWS 700 115 mm', 'Bosch', 'Herramientas eléctricas', 'UN',
   'HERRAMIENTA', 2.1, 32, 13, 12, false, false, true),
  ('DIL-SIN-5L', 'Diluyente sintético 5 L', NULL, 'Pinturas', 'BIDON',
   'QUIMICO', 4.6, 18, 18, 30, false, false, false);

INSERT INTO vehicle_types (code, name, size_rank, gvwr_kg,
                           front_axle_type, front_axle_tare_kg, front_axle_rating_kg,
                           rear_axle_type, rear_axle_tare_kg, rear_axle_rating_kg,
                           wheelbase_m, cargo_start_from_front_axle_m, cargo_length_m,
                           cargo_width_m, cargo_height_m, stowage_factor, max_rear_overhang_m,
                           crane_max_lift_kg, cost_per_km) VALUES
  ('CAMIONETA', 'Camioneta 4x2', 1, 2910,
   'SIMPLE_RUEDA_SIMPLE', 1130, 1300, 'SIMPLE_RUEDA_SIMPLE', 790, 1850,
   3.085, 2.30, 1.55, 1.50, 0.80, 0.85, 0.30, NULL, 450),
  ('CAMION_3_4', 'Camión 3/4 plataforma', 2, 6500,
   'SIMPLE_RUEDA_SIMPLE', 1650, 2600, 'SIMPLE_RUEDA_DOBLE', 1100, 4800,
   3.36, 0.60, 4.40, 2.00, 1.80, 0.85, 1.00, NULL, 900),
  ('CAMION_PLUMA', 'Camión pluma', 3, 16000,
   'SIMPLE_RUEDA_SIMPLE', 4600, 6000, 'SIMPLE_RUEDA_DOBLE', 3900, 11000,
   4.90, 1.40, 6.00, 2.45, 1.50, 0.85, 1.00, 2000, 1600);

INSERT INTO vehicles (plate, vehicle_type_id, home_warehouse_id, gps_device_id)
SELECT v.plate, vt.id, w.id, v.gps
FROM (VALUES
  ('DEMO-01', 'CAMIONETA', 'GPS-0001'),
  ('DEMO-02', 'CAMION_3_4', 'GPS-0002'),
  ('DEMO-03', 'CAMION_3_4', 'GPS-0003'),
  ('DEMO-04', 'CAMION_PLUMA', 'GPS-0004')
) AS v (plate, type_code, gps)
JOIN vehicle_types vt ON vt.code = v.type_code
JOIN warehouses w ON w.code = 'BOD-LA';

INSERT INTO picking_carts (code, warehouse_id, cart_type, max_load_kg, max_volume_m3,
                           max_item_length_cm)
SELECT v.code, w.id, v.cart_type::cart_type, v.max_kg, v.max_m3, v.max_cm
FROM (VALUES
  ('CARRO-MOD-01', 'MODULAR', 250, 0.6, 120),
  ('CARRO-MOD-02', 'MODULAR', 250, 0.6, 120),
  ('CARRO-PES-01', 'PLATAFORMA_PESADA', 1000, 1.2, 160),
  ('CARRO-LAR-01', 'CARRO_LARGOS', 600, 0.8, 650)
) AS v (code, cart_type, max_kg, max_m3, max_cm)
JOIN warehouses w ON w.code = 'BOD-LA';

INSERT INTO docks (warehouse_id, code, dock_type, capacity_pallets, allows_crane_truck)
SELECT w.id, v.code, v.dock_type::dock_type, v.capacity, v.crane
FROM (VALUES
  ('AND-01', 'ANDEN', 6, false),
  ('AND-02', 'ANDEN', 6, false),
  ('AND-03', 'ANDEN', 8, false),
  ('BAHIA-01', 'BAHIA_PATIO', 12, true)
) AS v (code, dock_type, capacity, crane)
JOIN warehouses w ON w.code = 'BOD-LA';

INSERT INTO restriction_zones (code, name, zone_type, area, notes) VALUES
  ('LA-URBANO', 'Radio urbano Los Ángeles', 'URBANA',
   ST_GeogFromText('MULTIPOLYGON(((-72.40 -37.50, -72.31 -37.50, -72.31 -37.43, -72.40 -37.43, -72.40 -37.50)))'),
   'Polígono aproximado para demostración'),
  ('RURAL-STA-BARBARA', 'Accesos rurales Santa Bárbara', 'RURAL',
   ST_GeogFromText('MULTIPOLYGON(((-72.10 -37.72, -71.95 -37.72, -71.95 -37.62, -72.10 -37.62, -72.10 -37.72)))'),
   'Polígono aproximado para demostración'),
  ('RURAL-NACIMIENTO', 'Accesos rurales Nacimiento', 'RURAL',
   ST_GeogFromText('MULTIPOLYGON(((-72.75 -37.55, -72.60 -37.55, -72.60 -37.45, -72.75 -37.45, -72.75 -37.55)))'),
   'Polígono aproximado para demostración');

INSERT INTO circulation_rules (zone_id, kind, description, applies_from_gvwr_kg, days_of_week,
                               time_from, time_to, max_gross_weight_kg, max_length_m,
                               source_reference)
SELECT z.id, v.kind::circulation_rule_kind, v.description, v.from_gvwr::numeric,
       v.days::smallint[], v.time_from::time, v.time_to::time, v.max_kg::numeric,
       v.max_len::numeric, 'VALOR DE EJEMPLO: validar con ordenanza municipal / Vialidad'
FROM (VALUES
  ('LA-URBANO', 'PROHIBICION_HORARIA', 'Sin camiones pesados en punta mañana',
   10000, '{1,2,3,4,5}', '07:30', '09:30', NULL, NULL),
  ('LA-URBANO', 'PROHIBICION_HORARIA', 'Sin camiones pesados en punta tarde',
   10000, '{1,2,3,4,5}', '17:30', '20:00', NULL, NULL),
  ('RURAL-STA-BARBARA', 'LIMITE_PESO', 'Puente con restricción de peso en el acceso',
   NULL, '{1,2,3,4,5,6,7}', NULL, NULL, 12000, NULL),
  ('RURAL-NACIMIENTO', 'PROHIBICION_HORARIA', 'Camino rural sin iluminación: sólo tránsito diurno',
   NULL, '{1,2,3,4,5,6,7}', '21:00', '07:00', NULL, NULL)
) AS v (zone_code, kind, description, from_gvwr, days, time_from, time_to, max_kg, max_len)
JOIN restriction_zones z ON z.code = v.zone_code;

-- Pedidos para mañana -----------------------------------------------------------
INSERT INTO orders (order_number, customer_id, site_id, warehouse_id, status, priority,
                    requested_delivery_date)
SELECT v.order_number, s.customer_id, s.id, w.id, v.status::order_status, v.priority,
       CURRENT_DATE + 1
FROM (VALUES
  ('NV-100231', 'Edificio Las Araucarias', 'EN_PICKING', 2),
  ('NV-100232', 'Condominio Santa Bárbara', 'RECIBIDO', 3),
  ('NV-100233', 'Galpón Nacimiento', 'RECIBIDO', 3)
) AS v (order_number, site_name, status, priority)
JOIN sites s ON s.name = v.site_name
JOIN warehouses w ON w.code = 'BOD-LA';

INSERT INTO order_items (order_id, line_number, product_id, quantity, picked_quantity, status,
                         pick_location)
SELECT o.id, v.line_number, p.id, v.quantity, v.picked, v.status::order_item_status, v.location
FROM (VALUES
  ('NV-100231', 1, 'CEM-ESP-25', 60, 60, 'PICKEADO', 'PATIO-A'),
  ('NV-100231', 2, 'MAK-HP1630', 2, 2, 'PICKEADO', 'BODEGA-SEGURA'),
  ('NV-100231', 3, 'BOS-GWS700', 1, 0, 'PENDIENTE', 'BODEGA-SEGURA'),
  ('NV-100231', 4, 'CER-MUR-2540', 10, 0, 'PENDIENTE', 'R3-A2'),
  ('NV-100232', 1, 'FIE-A630-12', 40, 0, 'PENDIENTE', 'PATIO-FIERRO'),
  ('NV-100232', 2, 'OSB-11-1224', 20, 0, 'PENDIENTE', 'PATIO-B'),
  ('NV-100233', 1, 'ARE-MAXI-1M3', 2, 0, 'PENDIENTE', 'PATIO-ARIDOS'),
  ('NV-100233', 2, 'DIL-SIN-5L', 5, 0, 'PENDIENTE', 'R5-A1')
) AS v (order_number, line_number, sku, quantity, picked, status, location)
JOIN orders o ON o.order_number = v.order_number
JOIN products p ON p.sku = v.sku;

-- Picking del pedido mixto NV-100231: cemento en plataforma, herramientas en carro modular.
INSERT INTO picking_tasks (order_id, cart_id, picker_id, status, started_at, completed_at)
SELECT o.id, c.id, u.id, v.status::picking_task_status, now() - interval '40 minutes',
       CASE WHEN v.status = 'COMPLETADA' THEN now() - interval '25 minutes' END
FROM (VALUES ('CARRO-PES-01', 'COMPLETADA'), ('CARRO-MOD-01', 'EN_CURSO')) AS v (cart_code, status)
JOIN picking_carts c ON c.code = v.cart_code
JOIN orders o ON o.order_number = 'NV-100231'
JOIN app_users u ON u.email = 'picker1@demo.local';

INSERT INTO cart_items (picking_task_id, order_item_id, quantity, scanned_by)
SELECT t.id, oi.id, oi.picked_quantity, t.picker_id
FROM picking_tasks t
JOIN picking_carts c ON c.id = t.cart_id
JOIN order_items oi ON oi.order_id = t.order_id
JOIN products p ON p.id = oi.product_id
WHERE (c.code, p.sku) IN (('CARRO-PES-01', 'CEM-ESP-25'), ('CARRO-MOD-01', 'MAK-HP1630'));

-- El picker intentó subir la cerámica al carro de cemento: bloqueo registrado.
INSERT INTO mix_alerts (picking_task_id, incoming_order_item_id, conflicting_order_item_id,
                        rule_code, severity, message, resolution)
SELECT t.id, incoming.id, conflicting.id, 'MEZCLA_INCOMPATIBLE', 'BLOQUEO',
       'Mezcla incompatible: «Cerámica muro 25x40 cm caja 1,5 m²» (FRAGIL) no puede ir en el mismo carro que «Cemento especial saco 25 kg» (GRANEL_PESADO) (riesgo de aplastamiento y rotura).',
       'BLOQUEADO'
FROM picking_tasks t
JOIN picking_carts c ON c.id = t.cart_id AND c.code = 'CARRO-PES-01'
JOIN order_items incoming ON incoming.order_id = t.order_id AND incoming.line_number = 4
JOIN order_items conflicting ON conflicting.order_id = t.order_id AND conflicting.line_number = 1;

-- Staging, ruta y entrega de mañana ------------------------------------------------
INSERT INTO routes (code, route_date, warehouse_id, vehicle_id, driver_id, status,
                    planned_departure, planned_distance_km)
SELECT 'R-DEMO-01', CURRENT_DATE + 1, w.id, v.id, u.id, 'PLANIFICADA',
       ((CURRENT_DATE + 1) + time '09:45') AT TIME ZONE 'America/Santiago', 6.5
FROM warehouses w
JOIN vehicles v ON v.plate = 'DEMO-02'
JOIN app_users u ON u.email = 'conductor1@demo.local'
WHERE w.code = 'BOD-LA';

INSERT INTO staging_assignments (dock_id, site_id, route_id, reserved_during, status)
SELECT d.id, s.id, r.id,
       tstzrange(((CURRENT_DATE + 1) + time '08:00') AT TIME ZONE 'America/Santiago',
                 ((CURRENT_DATE + 1) + time '10:00') AT TIME ZONE 'America/Santiago'),
       'CONSOLIDANDO'
FROM docks d
JOIN sites s ON s.name = 'Edificio Las Araucarias'
JOIN routes r ON r.code = 'R-DEMO-01'
WHERE d.code = 'AND-01';

INSERT INTO pallets (label_code, order_id, staging_assignment_id, gross_weight_kg, length_cm,
                     width_cm, height_cm, status)
SELECT 'CC-PLT-000001', o.id, sa.id, 1520, 120, 100, 110, 'EN_ANDEN'
FROM orders o
JOIN staging_assignments sa ON sa.site_id = o.site_id
WHERE o.order_number = 'NV-100231';

INSERT INTO deliveries (order_id, route_id, stop_sequence, status, planned_eta)
SELECT o.id, r.id, 1, 'PROGRAMADA', r.planned_departure + interval '20 minutes'
FROM orders o
JOIN routes r ON r.code = 'R-DEMO-01'
WHERE o.order_number = 'NV-100231';

COMMIT;
