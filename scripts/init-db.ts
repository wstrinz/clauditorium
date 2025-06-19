import Database from 'better-sqlite3';

const db = new Database('./claudeitorium.db');

// Create sessions table
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    working_directory TEXT NOT NULL,
    has_backend_process INTEGER DEFAULT 0,
    use_continue_flag INTEGER DEFAULT 0,
    can_reinitialize INTEGER DEFAULT 0,
    metadata TEXT
  )
`);

// Create session_history table
db.exec(`
  CREATE TABLE IF NOT EXISTS session_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
  )
`);

// Create indexes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_session_history_session_id ON session_history(session_id);
  CREATE INDEX IF NOT EXISTS idx_session_history_timestamp ON session_history(timestamp);
`);

console.log('Database tables created successfully!');
db.close();