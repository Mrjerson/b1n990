require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const { MongoClient } = require("mongodb");

const baseURL = "https://www.discudemy.com/all";
let highestNumber = 0;

// MongoDB configuration
const client = new MongoClient(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

let db;
let udemyCollection;

// Connect to MongoDB
async function connectToDatabase() {
  try {
    await client.connect();
    db = client.db(process.env.DB_NAME); // e.g., "coupon_scraper"
    udemyCollection = db.collection("udemy"); // Collection name
    console.log("Connected to MongoDB.");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
}

// Scrape highest page number
async function scrapeHighestNumber() {
  try {
    const { data } = await axios.get(baseURL);
    const $ = cheerio.load(data);
    const paginationNumbers = [];

    $("ul.pagination3.border li a").each((index, element) => {
      const text = $(element).text().trim();
      if (!isNaN(text)) {
        paginationNumbers.push(Number(text));
      }
    });

    highestNumber = Math.max(...paginationNumbers);
    console.log("Highest page number found:", highestNumber);
  } catch (error) {
    console.error("Error scraping highest page number:", error.message);
  }
}

// Scrape links from a page
async function scrapeLinksFromPage(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const links = [];

    $(".card .content .header a").each((index, element) => {
      const link = $(element).attr("href");
      if (link) {
        const lastPart = link.split("/").pop();
        const fullLink = `https://www.discudemy.com/go/${lastPart}`;
        links.push(fullLink);
      }
    });

    return links;
  } catch (error) {
    console.error("Error scraping links from page:", error.message);
    return [];
  }
}

// Delay function
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Scrape coupon link and course data
async function scrapeCouponLinks(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const couponLinks = [];

    $(".ui.segment a").each((index, element) => {
      const link = $(element).attr("href");
      if (link && link.includes("couponCode")) {
        couponLinks.push(link);
      }
    });

    const courseName = $(".ui.attached.segment h1.ui.grey.header")
      .text()
      .trim();
    const courseDescription = $(".ui.attached.segment p").text().trim();

    return { couponLinks, courseName, courseDescription };
  } catch (error) {
    console.error("Error scraping coupon links:", error.message);
    return { couponLinks: [], courseName: "", courseDescription: "" };
  } finally {
    await delay(1000);
  }
}

// Save to MongoDB
async function saveLinkToDatabase(url, name, description) {
  try {
    const existing = await udemyCollection.findOne({ url });

    if (existing) {
      console.log("URL already exists in database:", url);
      return;
    }

    await udemyCollection.insertOne({ url, name, description });
    console.log("URL saved:", url);
  } catch (err) {
    console.error("Error saving to MongoDB:", err.message);
  }
}

// Main function
async function runScrapingProcess() {
  try {
    await connectToDatabase();
    await scrapeHighestNumber();

    for (let i = 1; i <= highestNumber; i++) {
      const pageURL = `${baseURL}/${i}`;
      console.log(`Processing page: ${pageURL}`);

      const pageLinks = await scrapeLinksFromPage(pageURL);
      for (const fullLink of pageLinks) {
        const { couponLinks, courseName, courseDescription } =
          await scrapeCouponLinks(fullLink);

        for (const couponLink of couponLinks) {
          await saveLinkToDatabase(couponLink, courseName, courseDescription);
        }
      }

      await delay(2000);
    }

    console.log("All coupon links saved.");
  } catch (error) {
    console.error("Error during scraping process:", error.message);
  } finally {
    await client.close();
  }
}

// Run it
runScrapingProcess();
