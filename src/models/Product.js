const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    // Product ID from the source site (WooCommerce product id) - used to match on re-scrape.
    // Optional + sparse because a small number of product listings don't expose this
    // (e.g. variable products without a fixed "Add to cart" button). Those fall back to `slug`.
    wcId: { type: Number, required: false, unique: true, sparse: true, index: true },

    // Slug from the product's own URL (e.g. "aerofit-af-551-treadmill"). Always present
    // since every product has a permalink - used as a fallback match key when wcId is missing,
    // and as a safety net even when wcId IS present (belt and suspenders).
    slug: { type: String, required: false, unique: true, sparse: true, index: true },

    name: { type: String, required: true },
    sku: { type: String, default: "" },
    brand: { type: String, default: "" },
    brandSource: {
      type: String,
      enum: ["api", "inferred", ""],
      default: "",
    }, // "api" = confirmed from the site's own data, "inferred" = guessed from SKU/name pattern
    category: { type: String, default: "" },

    regularPrice: { type: Number, default: null },
    salePrice: { type: Number, default: null },
    discountPct: { type: Number, default: null },
    onSale: { type: Boolean, default: false },

    inStock: { type: Boolean, default: true },
    averageRating: { type: String, default: "0" },
    reviewCount: { type: Number, default: 0 },

    productUrl: { type: String, default: "" },
    imageUrl: { type: String, default: "" },

    // Bookkeeping
    firstSeenAt: { type: Date, default: Date.now },
    lastUpdatedAt: { type: Date, default: Date.now }, // last time price/details actually changed
    lastCheckedAt: { type: Date, default: Date.now }, // last time the scraper looked at it
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);
