const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);


const mongoose = require("mongoose");
const logger = require("../utils/logger");

async function connectDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error("MONGO_URI is not set in .env");
  }

  mongoose.connection.on("connected", () => {
    logger.info("MongoDB connected");
  });

  mongoose.connection.on("error", (err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
  });

  await mongoose.connect(uri);
}

module.exports = connectDB;
