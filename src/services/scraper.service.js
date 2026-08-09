const axios = require("axios");
const cheerio = require("cheerio");
const Product = require("../models/Product");
const PriceHistory = require("../models/PriceHistory");
const ScrapeRun = require("../models/ScrapeRun");
const logger = require("../utils/logger");
const { decode } = require("html-entities");

const SHOP_BASE_URL = process.env.SHOP_BASE_URL || "https://metrosports.co.in/shop/";
const PRODUCT_API_URL =
  process.env.PRODUCT_API_URL || "https://metrosports.co.in/wp-json/wc/store/v1/products";
const REQUEST_DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS || "800", 10);
const MAX_PAGES_SAFETY_CAP = parseInt(process.env.MAX_PAGES_SAFETY_CAP || "300", 10);

const client = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  },
});

/**
 * Fallback brand inference from SKU prefix / product name, used only when the API
 * enrichment call didn't return a brand (either the site genuinely has none set,
 * or the request failed). Based on this store's known SKU-prefix conventions.
 * Extend this map as you learn more prefixes.
 */
function inferBrandFromSkuOrName(sku, productName) {
  const s = (sku || "").toUpperCase().trim();
  const n = decode(productName || "").toUpperCase();

  // ---------- Brand from Product Name ----------
  if (n.includes("AEROFIT")) return "AEROFIT";
  if (n.includes("EVERISE")) return "EVERISE FITNESS";
  if (n.includes("XPEED")) return "XPEED";
  if (n.includes("USI")) return "USI";
  if (n.includes("POWERMAX")) return "POWERMAX FITNESS";
  if (n.includes("CONCEPT2") || n.includes("BIKEERG") || n.includes("ROWERG"))
    return "CONCEPT2";
  if (n.includes("ZOREX")) return "ZOREX FITNESS";
  if (n.includes("ASSAULT")) return "ASSAULT FITNESS";

  // ---------- SKU Prefix ----------
  if (
    s.startsWith("AF") ||
    s.startsWith("NF") ||
    s.startsWith("AAW") ||
    s.startsWith("AAH") ||
    s.startsWith("AAJ") ||
    s.startsWith("AAP")
  ) {
    return "AEROFIT";
  }

  if (s.startsWith("XP")) return "XPEED";

  if (s.startsWith("ZF") || s.startsWith("HGZ"))
    return "ZOREX FITNESS";

  if (
    s.startsWith("EFR") ||
    s.startsWith("IM") ||
    s.startsWith("EV") ||
    s.startsWith("DY") ||
    s.startsWith("EL") ||
    s.startsWith("ODS") ||
    s.startsWith("GM")
  ) {
    return "EVERISE FITNESS";
  }

  if (s.startsWith("USI")) return "USI";

  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pull the URL slug out of a product permalink, e.g.
 * "https://metrosports.co.in/product/aerofit-af-551-treadmill/" -> "aerofit-af-551-treadmill"
 * Used as a fallback identifier for the rare product missing a numeric wcId.
 */
function slugFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  } catch {
    return null;
  }
}

function pageUrl(pageNum) {
  if (pageNum <= 1) return SHOP_BASE_URL;
  const trimmed = SHOP_BASE_URL.replace(/\/$/, "");
  return `${trimmed}/page/${pageNum}/`;
}

/**
 * Turn a WooCommerce-formatted price string like "₹2,62,499.00" into a plain number: 262499.00
 */
function parsePriceText(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^\d.]/g, ""); // strip currency symbol, commas, whitespace
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? null : num;
}

/**
 * The shop archive listing doesn't expose brand/category, only the sidebar filters do.
 * BUT the Store API's single-product endpoint (unlike its broken list/collection endpoint)
 * returns full structured data including categories and the "Brand" attribute. One light
 * JSON call per product is far more reliable than parsing brand off individual HTML pages
 * (brand isn't always shown as visible page text on this site).
 */
async function fetchProductDetails(wcId) {
  try {
    const res = await client.get(`${PRODUCT_API_URL}/${wcId}`);
    const data = res.data;
    if (!data || typeof data !== "object") return null;

const category = (data.categories || [])
  .map((c) => decode(c.name))
  .join(", ");

    let brand = "";
    const brandAttr = (data.attributes || []).find(
      (a) => a.taxonomy === "pa_brand" || (a.name || "").toLowerCase() === "brand"
    );
    if (brandAttr && Array.isArray(brandAttr.terms)) {
brand = brandAttr.terms
  .map((t) => decode(t.name))
  .join(", ");    }

    const imageUrl = (data.images && data.images[0] && data.images[0].src) || "";

    return { category, brand, imageUrl };
  } catch (err) {
    logger.warn(`Couldn't fetch details for product ${wcId}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch shop page 1 to figure out how many total pages exist, using the
 * "Showing 1-12 of 1411 results" text WooCommerce renders, with a pagination-link
 * fallback in case that text isn't present (e.g. on a filtered/sorted view).
 */
async function getTotalPages($) {
  const resultsText = $(".woocommerce-result-count").text() || $("body").text();
  const match = resultsText.match(/of\s+([\d,]+)\s+results/i);
  const perPageCount = $("ul.products li.product").length || 12;

  if (match) {
    const total = parseInt(match[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(total) && perPageCount > 0) {
      return { totalPages: Math.ceil(total / perPageCount), totalProducts: total, perPageCount };
    }
  }

  // Fallback: read the highest page number link in the pagination nav
  let maxPage = 1;
  $(".page-numbers a, a.page-numbers").each((_, el) => {
    const num = parseInt($(el).text().trim(), 10);
    if (!Number.isNaN(num) && num > maxPage) maxPage = num;
  });

  return { totalPages: maxPage, totalProducts: null, perPageCount };
}

/**
 * Parse a single <li class="product ..."> node into our flat product shape.
 */
function parseProductNode($, el) {
  const $el = $(el);

  const link = $el.find("a.woocommerce-loop-product__link, a.woocommerce-LoopProduct-link").first();
  const productUrl = link.attr("href") || $el.find("a").first().attr("href") || "";

 const name = decode(
  $el.find(".woocommerce-loop-product__title").first().text().trim() ||
  $el.find("h2, h3").first().text().trim()
);

  // The <li> itself carries WordPress's own "post-{ID}" class (from post_class()),
  // completely independent of the "Add to cart" button. This is the MOST reliable
  // source - it's present even for out-of-stock or variable products, which show a
  // "Read more" link instead of "Add to cart" and so have no data-product_id at all.
  const classAttrForId = $el.attr("class") || "";
  const postClassMatch = classAttrForId.match(/(?:^|\s)post-(\d+)(?:\s|$)/);
  let wcId = postClassMatch ? parseInt(postClassMatch[1], 10) : null;

  const addToCartBtn = $el.find("a.add_to_cart_button, a[data-product_id]").first();

  if (!wcId) {
    const wcIdRaw = addToCartBtn.attr("data-product_id");
    wcId = wcIdRaw ? parseInt(wcIdRaw, 10) : null;
  }

  if (!wcId) {
    // Last-resort fallback: pull the id from ?add-to-cart=1234 in the button href
    const href = addToCartBtn.attr("href") || "";
    const m = href.match(/add-to-cart=(\d+)/);
    if (m) wcId = parseInt(m[1], 10);
  }

  const sku = addToCartBtn.attr("data-product_sku") || "";

  const priceBlock = $el.find(".price").first();
  const hasSale = priceBlock.find("del").length > 0;

  let regularPrice = null;
  let salePrice = null;

  if (hasSale) {
    regularPrice = parsePriceText(priceBlock.find("del .amount, del bdi").first().text());
    salePrice = parsePriceText(priceBlock.find("ins .amount, ins bdi").first().text());
  } else {
    const single = parsePriceText(priceBlock.find(".amount, bdi").first().text());
    regularPrice = single;
    salePrice = single;
  }

  let discountPct = null;
  if (regularPrice && salePrice && regularPrice > 0 && hasSale) {
    discountPct = Math.round((1 - salePrice / regularPrice) * 1000) / 10;
  }

  const onSale = hasSale || $el.find(".onsale").length > 0;

  const inStock = !classAttrForId.includes("outofstock");

  let imageUrl =
    $el.find("img").first().attr("data-src") ||
    $el.find("img").first().attr("src") ||
    "";
  // Strip WordPress's automatic thumbnail size suffix (e.g. -500x500) to get the full image where possible
  imageUrl = imageUrl.replace(/-\d+x\d+(?=\.\w{3,4}$)/, "");

  return {
    wcId,
    slug: slugFromUrl(productUrl),
    name,
    sku,
    brand: "", // not exposed on the shop archive listing; filled in later via enrichment/inference
    brandSource: "",
    category: "", // not exposed on the shop archive listing; left blank for now
    regularPrice,
    salePrice,
    discountPct,
    onSale,
    inStock,
    averageRating: "0",
    reviewCount: 0,
    productUrl,
    imageUrl,
  };
}

/**
 * Crawl every page of /shop/ and collect all products.
 */
async function fetchAllProducts() {
  const all = [];

  const firstRes = await client.get(pageUrl(1));
  const $first = cheerio.load(firstRes.data);
  const { totalPages, totalProducts } = await getTotalPages($first);

  logger.info(
    `Shop reports ${totalProducts ?? "an unknown number of"} products across ${totalPages} pages`
  );

  const pagesToFetch = Math.min(totalPages, MAX_PAGES_SAFETY_CAP);

  for (let page = 1; page <= pagesToFetch; page++) {
    let $;
    if (page === 1) {
      $ = $first;
    } else {
      const res = await client.get(pageUrl(page));
      $ = cheerio.load(res.data);
      await sleep(REQUEST_DELAY_MS);
    }

    const nodes = $("ul.products li.product").toArray();
    if (nodes.length === 0) {
      logger.warn(`Page ${page} had no product nodes - stopping early.`);
      break;
    }

    for (const el of nodes) {
      const product = parseProductNode($, el);
      if (product.wcId || product.slug) {
        all.push(product);
      } else {
        logger.warn(
          `Skipped a product on page ${page} - no wcId AND no usable URL/slug (name: "${product.name}")`
        );
      }
    }

    logger.info(`Fetched page ${page}/${pagesToFetch} (${nodes.length} products, ${all.length} total so far)`);
  }

  return all;
}

/**
 * Compare the newly-fetched product against what's in the DB.
 * Returns true if any tracked field actually changed.
 */
function hasChanged(existing, incoming) {
  const fieldsToCompare = [
  "name",
  "sku",
  "brand",
  "category",
  "imageUrl",
  "productUrl",
  "regularPrice",
  "salePrice",
  "discountPct",
  "onSale",
  "inStock"
];
  return fieldsToCompare.some((field) => existing[field] !== incoming[field]);
}

/**
 * Main entry point: crawl the shop and sync results into MongoDB.
 */
async function runScrapeAndSync() {
  const run = await ScrapeRun.create({ startedAt: new Date() });
  const stats = { totalFetched: 0, newProducts: 0, updatedProducts: 0, unchangedProducts: 0 };

  try {
    const products = await fetchAllProducts();
    stats.totalFetched = products.length;

    for (const incoming of products) {
      let existing = null;
      if (incoming.wcId) existing = await Product.findOne({ wcId: incoming.wcId });
      if (!existing && incoming.slug) existing = await Product.findOne({ slug: incoming.slug });

      const needsEnrichment =
        !existing || !existing.category || !existing.brand || existing.brandSource === "inferred";
      // The enrichment endpoint is looked up by numeric wcId, so skip it for the rare
      // product that only has a slug - it'll just keep blank brand/category, same as before.
      if (needsEnrichment && incoming.wcId) {
        const details = await fetchProductDetails(incoming.wcId);
        if (details) {
          if (details.category) incoming.category = details.category;
          if (details.brand) {
            incoming.brand = details.brand;
            incoming.brandSource = "api";
          }
          if (details.imageUrl) incoming.imageUrl = details.imageUrl;
        }
        await sleep(REQUEST_DELAY_MS);
      }

      // Last resort: if we still have no brand after the API attempt (site genuinely
      // has none set, or the request failed), try inferring it from the SKU prefix.
      if (!incoming.brand) {
        const inferred = inferBrandFromSkuOrName(incoming.sku, incoming.name);
        if (inferred) {
          incoming.brand = inferred;
          incoming.brandSource = "inferred";
        }
      }

      if (!existing) {
        await Product.create({
          ...incoming,
          firstSeenAt: new Date(),
          lastUpdatedAt: new Date(),
          lastCheckedAt: new Date(),
        });
        stats.newProducts += 1;
        logger.info(`NEW product added: [${incoming.wcId}] ${incoming.name}`);
        continue;
      }

      const priceChanged =
        existing.regularPrice !== incoming.regularPrice || existing.salePrice !== incoming.salePrice;
      const gotNewEnrichment =
        (incoming.category && incoming.category !== existing.category) ||
        (incoming.brand && incoming.brand !== existing.brand);
      const changed = hasChanged(existing, incoming) || gotNewEnrichment;

      if (changed) {
        if (priceChanged) {
          await PriceHistory.create({
            product: existing._id,
            wcId: existing.wcId,
            regularPrice: existing.regularPrice,
            salePrice: existing.salePrice,
          });
        }

        // Preserve category/brand/brandSource if we already had them from a previous enrichment
        const { category, brand, brandSource, ...rest } = incoming;
        Object.assign(existing, rest);
        if (category) existing.category = category;
        if (brand) {
          existing.brand = brand;
          existing.brandSource = brandSource;
        }

        existing.lastUpdatedAt = new Date();
        existing.lastCheckedAt = new Date();
        await existing.save();

        stats.updatedProducts += 1;
        logger.info(
          `UPDATED product: [${incoming.wcId}] ${incoming.name}` +
            (priceChanged ? ` | price changed: ${existing.salePrice} -> ${incoming.salePrice}` : "")
        );
      } else {
        existing.lastCheckedAt = new Date();
        await existing.save();
        stats.unchangedProducts += 1;
      }
    }

    run.finishedAt = new Date();
    run.totalFetched = stats.totalFetched;
    run.newProducts = stats.newProducts;
    run.updatedProducts = stats.updatedProducts;
    run.unchangedProducts = stats.unchangedProducts;
    run.status = "success";
    await run.save();

    logger.info(
      `Scrape complete. Fetched: ${stats.totalFetched}, New: ${stats.newProducts}, ` +
        `Updated: ${stats.updatedProducts}, Unchanged: ${stats.unchangedProducts}`
    );

    return stats;
  } catch (err) {
    run.finishedAt = new Date();
    run.status = "failed";
    run.errorMessage = err.message;
    await run.save();
    logger.error(`Scrape failed: ${err.message}`);
    throw err;
  }
}

module.exports = {
  fetchAllProducts,
  parseProductNode,
  runScrapeAndSync,
};
