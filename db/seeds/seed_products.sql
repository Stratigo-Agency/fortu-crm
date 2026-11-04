-- Fortu CRM · product seed from Accurate "Daftar Barang" export (daftar-barang_accurate.xlsx, 3 Nov 2026)
-- Run after migrations 001 + 002. Safe to re-run after any new export: upserts on sku.

-- Seed generated from daftar-barang_accurate.xlsx. Re-run safely after a new export.
-- list_price stays NULL: every "Def. Hrg. Jual" in the export is 0, so reps enter unit price per deal.
INSERT INTO products (sku, name, product_line, accurate_category, item_type, unit, barcode, size_inch, is_active) VALUES
  ('SB-0001', 'Standing Bracket', 'accessory', 'Bracket', 'inventory', 'UNIT', NULL, NULL, true),
  ('DIGI07', 'Digital Signage Standing 43" - Indoor', 'DSS', 'DS STANDING', 'inventory', 'UNIT', 'FDDIGI43A', 43, true),
  ('DIGI08', 'Digital Signage Standing 55" - Indoor', 'DSS', 'DS STANDING', 'inventory', 'UNIT', 'FDDIGI55A', 55, true),
  ('DIGI20', 'Digital Signage Standing 65" - Outdoor (with camera)', 'DSS', 'DS STANDING', 'inventory', 'UNIT', 'FDODS65A', 65, true),
  ('DIGI26', 'Digital Signage Standing 65" - Indoor', 'DSS', 'DS STANDING', 'inventory', 'UNIT', 'FDDIGI65A', 65, true),
  ('DIGI13', 'Digital Signage Wall-Mounted TV 43"', 'DSS', 'DS WALL', 'inventory', 'UNIT', 'FDWM43A', 43, true),
  ('DIGI14', 'Digital Signage Wall-Mounted TV 55"', 'DSS', 'DS WALL', 'inventory', 'UNIT', 'FDWM55A', 55, true),
  ('DIGI18', 'Digital Elevator Panel 21"', 'DSS', 'DS WALL', 'inventory', 'UNIT', 'FDP21A', 21, true),
  ('DIGI19', 'Digital Elevator Panel 24"', 'DSS', 'DS WALL', 'inventory', 'UNIT', 'FDP24A', 24, true),
  ('DIGI23', 'Digital Signage Wall-Mounted TV 32"', 'DSS', 'DS WALL', 'inventory', 'UNIT', 'FDWM32A', 32, true),
  ('DIGI24', 'Digital Elevator Panel 24" - Split Screen', 'DSS', 'DS WALL', 'inventory', 'UNIT', 'FDPS24A', 24, true),
  ('DIGI29', 'Digital Signage Wall-Mounted TV 21" - Capacitive', 'DSS', 'DS WALL', 'inventory', 'UNIT', 'FDWM21A', 21, true),
  ('DIGI10', 'Interactive Flat Panel 65" - Win+Android', 'IFP', 'IFP', 'inventory', 'UNIT', 'FDIFP65W', 65, true),
  ('DIGI11', 'Interactive Flat Panel 86" - Win+Android', 'IFP', 'IFP', 'inventory', 'UNIT', 'FDIFP86W', 86, true),
  ('DIGI16', 'Interactive Flat Panel 98" - Win+Android', 'IFP', 'IFP', 'inventory', 'UNIT', 'FDIFP98W', 98, true),
  ('DIGI17', 'Interactive Flat Panel 65" - Android', 'IFP', 'IFP', 'inventory', 'UNIT', 'FDIFP65A', 65, true),
  ('DIGI35', 'Interactive Flat Panel 98" - Android', 'IFP', 'IFP', 'inventory', 'UNIT', 'FDIFP98A', 98, true),
  ('DIGI36', 'Interactive Flat Panel 75" - Win+Android', 'IFP', 'IFP', 'inventory', 'UNIT', 'FDIFP75W', 75, true),
  ('DIGI38', 'Interactive Flat Panel 86" - Android', 'IFP', 'IFP', 'inventory', 'UNIT', 'FDIFP86A', 86, true),
  ('DIGI39', 'Interactive Flat Panel 75" - Android', 'IFP', 'IFP', 'inventory', 'UNIT', NULL, 75, true),
  ('DIGI21', 'Digital Kiosk Order Machine 27" - Windows', 'DSS', 'KIOSK', 'inventory', 'UNIT', 'FDKT27W', 27, true),
  ('DIGI22', 'Digital Kiosk Order Machine 32" - Windows', 'DSS', 'KIOSK', 'inventory', 'UNIT', 'FDKB32W', 32, true),
  ('DIGI34', 'Digital Kiosk Order Machine 32" - Android Custom', 'DSS', 'KIOSK', 'inventory', 'UNIT', NULL, 32, true),
  ('DIGI37', 'Digital Kiosk Order Machine 32" - Android', 'DSS', 'KIOSK', 'inventory', 'UNIT', 'FDKB32A', 32, true),
  ('KIT-0001', 'Stylus Pen', 'accessory', 'Kit', 'non_inventory', 'UNIT', NULL, NULL, true),
  ('MS-001', 'Garansi 1 Tahun Hardware & Software', 'service', 'Managed Service', 'service', 'UNIT', NULL, NULL, true),
  ('DIGI25', 'Digital Menu Board 21"', 'DSS', 'MENU BOARD', 'inventory', 'UNIT', 'FDMB21A', 21, true),
  ('DIGI28', 'Digital Menu Board 24"', 'DSS', 'MENU BOARD', 'inventory', 'UNIT', NULL, 24, true),
  ('DIGI09', 'Smart Mobile Display 32"', 'DSS', 'MOBILE SIGN', 'inventory', 'UNIT', 'FDMS32A', 32, true),
  ('DIGI27', 'Videowall', 'LED', 'VW', 'inventory', 'UNIT', 'VW001', NULL, true),
  ('DIGI30', 'Digital Signage Wall-Mounted TV 24" - Capacitive', 'DSS', 'WALL-MOUNTED', 'inventory', 'UNIT', 'FDWM24A', 24, true),
  ('DIGI31', 'Digital Signage Wall-Mounted TV 18" - Capacitive', 'DSS', 'WALL-MOUNTED', 'inventory', 'UNIT', 'FDWM18A', 18, true)

ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name, product_line = EXCLUDED.product_line, accurate_category = EXCLUDED.accurate_category,
  item_type = EXCLUDED.item_type, unit = EXCLUDED.unit, barcode = EXCLUDED.barcode,
  size_inch = EXCLUDED.size_inch, is_active = EXCLUDED.is_active;
