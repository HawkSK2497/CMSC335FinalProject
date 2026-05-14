import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import pg from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
dotenv.config({ quiet: true });

const app = express();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_APIKEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
const port = 3000;

const db = new pg.Client({
  connectionString: process.env.POSTGRES_CONNECTION_STRING,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function startApp() {
  try {
    await db.connect();
    await db.query(
      "CREATE TABLE IF NOT EXISTS title_history (id SERIAL PRIMARY KEY, title VARCHAR(255), data JSONB, recommendations JSONB)",
    );
    await db.query(
      "CREATE TABLE IF NOT EXISTS favorites (id SERIAL PRIMARY KEY, title VARCHAR(255), rating DECIMAL(4,2), data JSONB)",
    );
    app.listen(port, () => {
      console.log(`Server is listening on port ${port}`);
    });
  } catch (err) {
    console.error("❌ Failed to connect to the database:", err.message);
    process.exit(1);
  }
}

// const db = new pg.Client({
//   user: process.env.POSTGRES_USER,
//   host: process.env.POSTGRES_HOST,
//   database: process.env.POSTGRES_DATABASE,
//   password: process.env.POSTGRES_PASSWORD,
//   port: process.env.POSTGRES_PORT,
// });

const url = `http://www.omdbapi.com/?apikey=${process.env.OMDB_APIKEY}&t=`;
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let title = "";

app.get("/", async (req, res) => {
  let recents = [];
  let recommendations = [];
  let favorites = [];
  try {
    const dbResult = await db.query(
      "SELECT * FROM title_history ORDER BY id DESC",
    );
    const favoritesResult = await db.query(
      "SELECT * FROM favorites ORDER BY id DESC NULLS LAST",
    );
    recents = dbResult.rows.map((row) => row.data);
    recommendations = dbResult.rows[0].recommendations || [];
    favorites = favoritesResult.rows;
  } catch (err) {
    //console.error("Error executing query", err.stack);
  }
  let recJSONs = [];
  try {
    for (let i = 0; i < recommendations.length; i++) {
      const result = await axios.get(url + recommendations[i]);
      if (result.data.Response !== "False") {
        recJSONs.push(result.data);
      }
    }
  } catch (err) {
    console.error(err.stack);
  }
  if (!title) {
    res.render("index.ejs", { recents, recommendations: recJSONs, favorites });
  } else {
    try {
      const result = await axios.get(url + title);
      res.render("index.ejs", {
        content: result.data,
        recents,
        recommendations: recJSONs,
        favorites,
      });
    } catch (err) {
      res.render("index.ejs", {
        error: err.message,
        recents,
        recommendations: recJSONs,
        favorites,
      });
    }
  }
});

app.post("/title", async (req, res) => {
  title = req.body.title;
  try {
    const result = await axios.get(url + title);
    if (result.data.Response === "False") {
      title = "";
      return res.redirect("/");
    }

    const movie = result.data;
    const prompt = `The user is looking at the movie "${movie.Title}" (${movie.Year}). 
    Genre: ${movie.Genre}. Plot: ${movie.Plot}.
    Suggest 4 similar movies or TV shows. 
    Return ONLY a JSON array of strings containing just the titles. 
    Example format: ["Title 1", "Title 2", "Title 3", "Title 4"]`;
    const aiResult = await model.generateContent(prompt);
    const responseText = aiResult.response.text();
    const recommendedTitles = JSON.parse(
      responseText.replace(/```json|```/g, ""),
    );
    const dbResult = await db.query(
      "SELECT * FROM title_history where title = $1",
      [result.data.Title],
    );
    if (dbResult.rowCount !== 0) {
      await db.query("DELETE FROM title_history WHERE title = $1", [
        result.data.Title,
      ]);
    }
    await db.query(
      "INSERT INTO title_history (title, data, recommendations) VALUES ($1, $2, $3)",
      [result.data.Title, result.data, JSON.stringify(recommendedTitles)],
    );
    res.redirect("/");
  } catch (err) {
    console.error("Route Error:", err.stack);
    res.redirect("/");
  }
});

app.post("/delete", async (req, res) => {
  try {
    await db.query("DELETE FROM title_history WHERE title = $1", [
      req.body.title,
    ]);
  } catch (err) {
    console.error("Error deleting title", err.stack);
  }
  res.redirect("/");
});

app.post("/add", async (req, res) => {
  let movieTitle = req.body.title;
  try {
    const result = await axios.get(url + movieTitle);
    const movie = result.data;
    const dbResult = await db.query(
      "SELECT * FROM favorites where title = $1",
      [movie.Title],
    );
    if (dbResult.rowCount !== 0) {
      await db.query("DELETE FROM favorites WHERE title = $1", [movie.Title]);
    }
    await db.query("INSERT INTO favorites (title, data) VALUES ($1, $2)", [
      result.data.Title,
      result.data,
    ]);
    res.redirect("/");
  } catch (err) {
    console.error("Route Error:", err.stack);
    res.redirect("/");
  }
});

app.post("/rate", async (req, res) => {
  let movieTitle = req.body.title;
  let rating = req.body.rating;
  try {
    const result = await axios.get(url + movieTitle);
    const movie = result.data;
    const dbResult = await db.query(
      "SELECT * FROM favorites where title = $1",
      [movie.Title],
    );
    if (dbResult.rowCount === 0) {
      await db.query(
        "INSERT INTO favorites (title, rating, data) VALUES ($1, $2, $3)",
        [movie.Title, rating, movie],
      );
    } else {
      await db.query("UPDATE favorites SET rating = $1 WHERE title = $2", [
        rating,
        movie.Title,
      ]);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("Rate Error:", err.stack);
    res.status(500).send("Error updating rating");
  }
});

app.post("/delete-fav", async (req, res) => {
  try {
    await db.query("DELETE FROM favorites WHERE title = $1", [req.body.title]);
  } catch (err) {
    console.error("Error deleting title", err.stack);
  }
  res.redirect("/");
});

startApp();
