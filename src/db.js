'use strict';

// =============================================================
// db.js — PostgreSQL connection pool (Neon)
// =============================================================

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set in environment');
}

const cleanUrl = (process.env.DATABASE_URL || '')
  .split('?')[0] + '?sslmode=require';

const pool = new Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

/**
 * Executes a parameterized query.
 */
async function query(sql, params = []) {
  const start = Date.now();
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res;
  } finally {
    client.release();
  }
}

module.exports = { pool, query };
