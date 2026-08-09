const cron = require("node-cron");
const logger = require("../utils/logger");
const { runScrapeAndSync } = require("../services/scraper.service");

/**
 * Schedules the scraper to run automatically.
 * Default: every day at 3:00 AM (see CRON_SCHEDULE in .env), runs every 24 hours.
 */
function startScheduler() {
  const schedule = process.env.CRON_SCHEDULE || "0 3 * * *";
  const timezone = process.env.CRON_TIMEZONE || "Asia/Kolkata";

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid CRON_SCHEDULE: "${schedule}"`);
  }

  logger.info(`Scheduler started. Scrape will run on schedule "${schedule}" (${timezone}).`);

  cron.schedule(
    schedule,
    async () => {
      logger.info("Scheduled scrape triggered.");
      try {
        await runScrapeAndSync();
      } catch (err) {
        logger.error(`Scheduled scrape failed: ${err.message}`);
      }
    },
    { timezone }
  );
}

module.exports = startScheduler;
