require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const mysql = require("mysql2");

const baseURL = "https://www.discudemy.com/all";
let highestNumber = 0;

// Database configuration
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

// Connect to the database
db.connect((err) => {
  if (err) {
    console.error("Error connecting to the database:", err.stack);
    return;
  }
  console.log("Connected to MySQL database.");
});

// Ping the database every 60 seconds to keep the connection alive
setInterval(() => {
  db.ping((err) => {
    if (err) {
      console.error("Error pinging database:", err.message);
    } else {
      console.log("Database connection is alive.");
    }
  });
}, 60000);

// Function to scrape the highest page number
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
    console.log("Highest page number found:", highestNumber); // Debugging line
  } catch (error) {
    console.error("Error scraping highest page number:", error.message);
  }
}

// Function to scrape links from a single page
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

    console.log(`Scraped ${links.length} links from ${url}`); // Debugging line
    return links;
  } catch (error) {
    console.error("Error scraping links from page:", error.message);
    return [];
  }
}

// Function to add a delay between requests
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to scrape coupon links and course details from a single link
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

    // Scrape course name and description
    const courseName = $(".ui.attached.segment h1.ui.grey.header")
      .text()
      .trim();
    const courseDescription = $(".ui.attached.segment p").text().trim();

    console.log(`Scraped ${couponLinks.length} coupon links from ${url}`); // Debugging line
    return { couponLinks, courseName, courseDescription };
  } catch (error) {
    console.error("Error scraping coupon links from page:", error.message);
    return { couponLinks: [], courseName: "", courseDescription: "" };
  } finally {
    await delay(1000); // Increased delay to 1 second to avoid rate limiting
  }
}

// Function to save a link to the database
async function saveLinkToDatabase(url, name, description) {
  return new Promise((resolve, reject) => {
    const checkQuery = "SELECT COUNT(*) AS count FROM udemy WHERE url = ?";
    db.query(checkQuery, [url], (err, results) => {
      if (err) {
        console.error("Error checking for duplicate URL:", err.message);
        reject(err);
      } else {
        if (results[0].count > 0) {
          console.log("URL already exists in database:", url); // Debugging line
          resolve();
        } else {
          const query =
            "INSERT INTO udemy (url, name, description) VALUES (?, ?, ?)";
          db.query(query, [url, name, description], (err, results) => {
            if (err) {
              console.error("Error saving URL to database:", err.message);
              reject(err);
            } else {
              console.log("URL saved:", url); // Debugging line
              resolve(results);
            }
          });
        }
      }
    });
  });
}

// Main function to run the scraping process
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

      await delay(2000); // Add a delay between processing pages
    }

    console.log("All coupon links saved to the database.");
  } catch (error) {
    console.error("Error during scraping process:", error.message);
  } finally {
    db.end(); // Close the database connection when done
  }
}

// Run the scraping process
runScrapingProcess();
