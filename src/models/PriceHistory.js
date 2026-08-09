const mongoose = require("mongoose");

const priceHistorySchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
  wcId: { type: Number, required: true, index: true },

  regularPrice: { type: Number, default: null },
  salePrice: { type: Number, default: null },

  recordedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("PriceHistory", priceHistorySchema);
