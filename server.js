require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const mysql = require("mysql2");

const baseURL = "https://www.discudemy.com/all";
let highestNumber = 0;

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

db.connect((err) => {
  if (err) {
    console.error("Error connecting to the database:", err.stack);
    return;
  }
  console.log("Connected to MySQL database.");
});

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
  } catch (error) {
    console.error("Error scraping numbers:", error.message);
  }
}

async function scrapeLinksFromPage(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const links = [];

    $(".card .content .header a").each((index, element) => {
      const link = $(element).attr("href");
      const lastPart = link.split("/").pop();
      const fullLink = `https://www.discudemy.com/go/${lastPart}`;
      links.push(fullLink);
    });

    return links;
  } catch (error) {
    console.error("Error scraping links from page:", error.message);
    return [];
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scrapeCouponLinks(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const couponLinks = [];
    const courseDetails = [];

    $(".ui.segment a").each((index, element) => {
      const link = $(element).attr("href");

      if (link && link.includes("couponCode")) {
        couponLinks.push(link);
      }
    });

    // Scrape course name and description
    const courseName = $(".ui.attached.segment h1.ui.grey.header")
      .text()
      .trim();
    const courseDescription = $(".ui.attached.segment p").text().trim();

    return { couponLinks, courseName, courseDescription };
  } catch (error) {
    console.error("Error scraping coupon links from page:", error.message);
    return { couponLinks: [], courseName: "", courseDescription: "" };
  } finally {
    await delay(500);
  }
}

async function saveLinkToDatabase(url, name, description) {
  return new Promise((resolve, reject) => {
    const checkQuery = "SELECT COUNT(*) AS count FROM udemy WHERE url = ?";
    db.query(checkQuery, [url], (err, results) => {
      if (err) {
        console.error("Error checking for duplicate URL:", err.message);
        reject(err);
      } else {
        if (results[0].count > 0) {
          console.log("URL already exists in database:", url);
          resolve();
        } else {
          const query =
            "INSERT INTO udemy (url, name, description) VALUES (?, ?, ?)";
          db.query(query, [url, name, description], (err, results) => {
            if (err) {
              console.error("Error saving URL to database:", err.message);
              reject(err);
            } else {
              console.log("URL saved:", url);
              resolve(results);
            }
          });
        }
      }
    });
  });
}

async function runScrapingProcess() {
  try {
    await scrapeHighestNumber();

    for (let i = 1; i <= highestNumber; i++) {
      const pageURL = `${baseURL}/${i}`;
      console.log(`Processing page: ${pageURL}`);

      const pageLinks = await scrapeLinksFromPage(pageURL);
      for (let fullLink of pageLinks) {
        const { couponLinks, courseName, courseDescription } =
          await scrapeCouponLinks(fullLink);
        for (let couponLink of couponLinks) {
          await saveLinkToDatabase(couponLink, courseName, courseDescription);
        }
      }
    }

    console.log("All coupon links saved to the database.");
  } catch (error) {
    console.error("Error during scraping process:", error.message);
  }
}

runScrapingProcess();
