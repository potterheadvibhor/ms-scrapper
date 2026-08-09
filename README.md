# Metro Sports Scraper (MERN-stack, MongoDB + Node.js)

Pulls the full product catalog from `metrosports.co.in`'s public WooCommerce
**Store API** (JSON, no browser/Playwright needed), and syncs it into MongoDB:

- **New product on the site** → inserted as a new document
- **Existing product, price or details changed** → document updated, and the
  *old* price is archived in a `PriceHistory` collection (so you get a price-change trail over time)
- **Existing product, nothing changed** → just `lastCheckedAt` is bumped, no write noise
- Runs once immediately on startup, then **automatically every 24 hours** via `node-cron`
- Every run is logged to a `ScrapeRun` collection (counts of new/updated/unchanged, timestamps, errors)

---

## Folder structure

```
metro-sports-scraper/
├── src/
│   ├── config/
│   │   └── db.js               # MongoDB connection
│   ├── models/
│   │   ├── Product.js          # main product collection
│   │   ├── PriceHistory.js     # historical price snapshots
│   │   └── ScrapeRun.js        # log of each scrape run's stats
│   ├── services/
│   │   └── scraper.service.js  # fetch + normalize + upsert logic (the core)
│   ├── jobs/
│   │   └── scheduler.js        # node-cron: runs scraper every 24h
│   ├── utils/
│   │   └── logger.js           # winston logger (console + logs/scraper.log)
│   └── index.js                # entry point
├── logs/                       # log file output (gitignored)
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Setup

1. **Install dependencies**
   ```bash
   cd metro-sports-scraper
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env`:
   - `MONGO_URI` — your MongoDB connection string (local or Atlas)
   - `CRON_SCHEDULE` — defaults to `0 3 * * *` (every day at 3:00 AM). Change if you want a different time — it will still run every 24 hours.
   - Leave `STORE_API_BASE_URL` as-is unless the site changes its API path.

3. **Make sure MongoDB is running** (local `mongod`, or an Atlas cluster with your IP allow-listed).

---

## Usage

**Run once and exit** (good for testing, or if you'd rather trigger it from your own OS-level cron/Task Scheduler instead of the built-in one):
```bash
npm run scrape
```

**Run continuously** (scrapes immediately, then keeps the process alive and auto-runs every 24 hours):
```bash
npm start
```

For production, run this with a process manager so it survives reboots/crashes, e.g.:
```bash
npm install -g pm2
pm2 start src/index.js --name metro-scraper
pm2 save
pm2 startup
```

---

## Using the data in your MERN app

The `Product` collection is the one your frontend/API should read from — it always
reflects the latest known state of every product. Example fields:

```js
{
  wcId: 4907,
  name: "Gold Master Cage (Without Counter Balanced Smith)",
  sku: "GM-CAGE (A)",
  brand: "Gold Master",
  category: "Unique Items",
  regularPrice: 328125,
  salePrice: 262499,
  discountPct: 20,
  onSale: true,
  inStock: true,
  averageRating: "0",
  reviewCount: 0,
  productUrl: "https://metrosports.co.in/product/...",
  imageUrl: "https://...",
  firstSeenAt: "2026-08-05T...",
  lastUpdatedAt: "2026-08-05T...",  // last time something actually changed
  lastCheckedAt: "2026-08-05T..."   // last time the scraper checked it, even if unchanged
}
```

Since this is plain Mongoose/MongoDB, you can plug it straight into an existing
Express API — e.g. add a route like `GET /api/products` that queries this same
`Product` model, and your React frontend consumes that endpoint as usual.

To show a "price dropped" indicator or a price history chart, query `PriceHistory`
by `wcId`.

---

## Notes

- This uses the site's own public Store API (same one their cart/checkout UI calls),
  not HTML scraping — it's fast, structured, and much less likely to break if they
  redesign the site visually. If the API is ever locked down, the fetch logic in
  `scraper.service.js` is the only file that would need to change to an HTML-parsing
  approach (e.g. with `cheerio`).
- `REQUEST_DELAY_MS` adds a small pause between paginated requests to be respectful
  of their server — safe to leave as-is.
- Prices are stored as plain numbers in INR (already converted from the API's minor-unit format).
