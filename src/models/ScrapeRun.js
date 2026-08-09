const mongoose = require("mongoose");

const scrapeRunSchema = new mongoose.Schema({
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date },
  totalFetched: { type: Number, default: 0 },
  newProducts: { type: Number, default: 0 },
  updatedProducts: { type: Number, default: 0 },
  unchangedProducts: { type: Number, default: 0 },
  status: { type: String, enum: ["success", "failed"], default: "success" },
  errorMessage: { type: String, default: "" },
});

module.exports = mongoose.model("ScrapeRun", scrapeRunSchema);
