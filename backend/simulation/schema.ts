import Database from "better-sqlite3";

export function migrate(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_telemetry (
      trip_number INTEGER PRIMARY KEY,
      driver_name TEXT,
      lat REAL,
      lon REAL,
      speed_kmh REAL,
      hos_remaining REAL,
      progress REAL,
      status TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS driver_status (
      driver_name TEXT PRIMARY KEY,
      duty_status TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS load_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_name TEXT,
      trip_number INTEGER,
      event_type TEXT,
      timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS simulation_selection (
      trip_number INTEGER PRIMARY KEY,
      selected_at TEXT
    );

    CREATE TABLE IF NOT EXISTS geofence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_number INTEGER,
      driver_name TEXT,
      zone_name TEXT,
      event_type TEXT,
      timestamp TEXT,
      real_dwell_hours REAL,
      detention_fee REAL
    );
  `);
}
