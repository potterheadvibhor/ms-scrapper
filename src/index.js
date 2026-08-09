require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const logger = require("./utils/logger");
const startScheduler = require("./jobs/scheduler");
const { runScrapeAndSync } = require("./services/scraper.service");

const RUN_ONCE = process.argv.includes("--once");

async function main() {
  await connectDB();

  if (RUN_ONCE) {
    // `npm run scrape` -> run a single scrape and exit (good for manual runs / testing / one-off cron)
    logger.info("Running single scrape (--once mode)...");
    await runScrapeAndSync();
    await mongoose.disconnect();
    process.exit(0);
  }

  // `npm start` -> run once immediately on boot, then keep the process alive on a 24h schedule
  logger.info("Running initial scrape on startup...");
  try {
    await runScrapeAndSync();
  } catch (err) {
    logger.error(`Initial scrape failed: ${err.message}`);
  }

  startScheduler();
  logger.info("Scraper service is running. Waiting for next scheduled run...");
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});

process.on("SIGINT", async () => {
  logger.info("Shutting down gracefully...");
  await mongoose.disconnect();
  process.exit(0);
});
