import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import router from "./routes/router.js";
dotenv.config({ quiet: true });

const app = express();
const port = 3000;

app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/", router);

async function startApp() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    app.listen(port, () => {
      console.log(`Server is listening on port ${port}`);
    });
  } catch (err) {
    console.error("❌ Failed to connect to the database:", err.message);
    process.exit(1);
  }
}

startApp();
