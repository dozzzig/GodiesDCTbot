'use strict';

// =============================================================
// scheduler.js — Runs the parser on a fixed interval via PM2
// =============================================================

require('dotenv').config();
const { runParser } = require('./parser');
const { PARSE_INTERVAL_MIN } = require('./config');

const INTERVAL_MS = PARSE_INTERVAL_MIN * 60 * 1_000;

async function main() {
  console.log(`[Scheduler] Starting. Parser interval: ${PARSE_INTERVAL_MIN} min`);

  // Run immediately on startup, then on each interval tick
  await runParser().catch((err) => console.error('[Scheduler] Parser error:', err.message));

  setInterval(async () => {
    await runParser().catch((err) => console.error('[Scheduler] Parser error:', err.message));
  }, INTERVAL_MS);
}

main();
