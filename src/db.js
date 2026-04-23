'use strict';

// =============================================================
// db.js — PostgreSQL connection pool (Neon)
// =============================================================

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set in environment');
}

// Strip channel_binding param — not supported by pg driver, causes SSL warnings.
// SSL is enforced via the ssl:{} option below.
const cleanUrl = process.env.DATABASE_URL
  .replace(/[&?]channel_binding=[^&]*/g, '')
  .replace(/[&?]sslmode=[^&]*/g, '');

// Pool auto-reconnects on Neon idle-connection drops.
const pool = new Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Executes a parameterized query. Throws on error — callers must handle.
 */
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

module.exports = { pool, query };
