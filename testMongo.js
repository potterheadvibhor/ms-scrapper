const mongoose = require("mongoose");

const uri =
  "MONGO_URI=mongodb+srv://vibhorjain460_db_user:TestMongo123!@mycluster17.akfktpj.mongodb.net/metro_sports?retryWrites=true&w=majority&appName=MYcluster17";

async function test() {
  try {
    await mongoose.connect(uri);
    console.log("✅ Connected successfully");
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to connect");
    console.error(err);
    process.exit(1);
  }
}

test();