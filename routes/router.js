import express from "express";
import axios from "axios";
import mongoose from "mongoose";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

const titleHistorySchema = new mongoose.Schema({
  title: String,
  data: mongoose.Schema.Types.Mixed,
  recommendations: mongoose.Schema.Types.Mixed,
});

const favoritesSchema = new mongoose.Schema({
  title: String,
  rating: Number,
  data: mongoose.Schema.Types.Mixed,
});

const TitleHistory = mongoose.model("TitleHistory", titleHistorySchema);
const Favorites = mongoose.model("Favorites", favoritesSchema);

const router = express.Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_APIKEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
const url = `http://www.omdbapi.com/?apikey=${process.env.OMDB_APIKEY}&t=`;

let title = "";

router.get("/", async (req, res) => {
  let recents = [];
  let recommendations = [];
  let favorites = [];
  try {
    const dbResult = await TitleHistory.find().sort({ _id: -1 });
    const favoritesResult = await Favorites.find().sort({ _id: -1 });
    recents = dbResult.map((doc) => doc.data);
    recommendations = dbResult[0]?.recommendations || [];
    favorites = favoritesResult;
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

router.post("/title", async (req, res) => {
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
    const existing = await TitleHistory.findOne({ title: result.data.Title });
    if (existing) {
      await TitleHistory.deleteOne({ title: result.data.Title });
    }
    await new TitleHistory({
      title: result.data.Title,
      data: result.data,
      recommendations: recommendedTitles,
    }).save();
    res.redirect("/");
  } catch (err) {
    console.error("Route Error:", err.stack);
    res.redirect("/");
  }
});

router.post("/delete", async (req, res) => {
  try {
    await TitleHistory.deleteOne({ title: req.body.title });
  } catch (err) {
    console.error("Error deleting title", err.stack);
  }
  res.redirect("/");
});

router.post("/add", async (req, res) => {
  let movieTitle = req.body.title;
  try {
    const result = await axios.get(url + movieTitle);
    const movie = result.data;
    const existing = await Favorites.findOne({ title: movie.Title });
    if (existing) {
      await Favorites.deleteOne({ title: movie.Title });
    }
    await new Favorites({
      title: result.data.Title,
      data: result.data,
    }).save();
    res.redirect("/");
  } catch (err) {
    console.error("Route Error:", err.stack);
    res.redirect("/");
  }
});

router.post("/rate", async (req, res) => {
  let movieTitle = req.body.title;
  let rating = req.body.rating;
  try {
    const result = await axios.get(url + movieTitle);
    const movie = result.data;
    const existing = await Favorites.findOne({ title: movie.Title });
    if (!existing) {
      await new Favorites({
        title: movie.Title,
        rating: rating,
        data: movie,
      }).save();
    } else {
      await Favorites.updateOne({ title: movie.Title }, { rating: rating });
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("Rate Error:", err.stack);
    res.status(500).send("Error updating rating");
  }
});

router.post("/delete-fav", async (req, res) => {
  try {
    await Favorites.deleteOne({ title: req.body.title });
  } catch (err) {
    console.error("Error deleting title", err.stack);
  }
  res.redirect("/");
});

export default router;
