require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const mysql = require("mysql2");

const bodyURL = "https://www.discudemy.com/all";
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
    console.log("Scraping highest number...");
    const { data } = await axios.get(bodyURL, { timeout: 10000 });
    const $ = cheerio.load(data);
    const paginationNumbers = [];

    $("ul.pagination3.border li a").each((index, element) => {
      const text = $(element).text().trim();
      if (!isNaN(text)) {
        paginationNumbers.push(Number(text));
      }
    });

    highestNumber = Math.max(...paginationNumbers);
    console.log("Highest number scraped:", highestNumber);
  } catch (error) {
    console.error("Error scraping numbers:", error.message);
  }
}

function generateURLs() {
  if (highestNumber === 0) {
    console.error("Highest number is not set yet. Make sure scraping is complete.");
    return [];
  }

  const urls = [];
  for (let i = 1; i <= highestNumber; i++) {
    urls.push(`${bodyURL}/${i}`);
  }
  return urls;
}

async function scrapeLinksFromPage(url) {
  try {
    console.log("Scraping links from:", url);
    const { data } = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(data);

    const links = [];

    $(".card .content .header a").each((index, element) => {
      const link = $(element).attr("href");
      const lastPart = link.split("/").pop();
      const fullLink = `https://www.discudemy.com/go/${lastPart}`;
      links.push(fullLink);
    });

    console.log("Links scraped:", links.length);
    return links;
  } catch (error) {
    console.error("Error scraping links from page:", error.message);
    return [];
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scrapeCouponLinks(url) {
  try {
    console.log("Scraping coupon links from:", url);
    const { data } = await axios.get(url, { timeout: 10000 });
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
    const courseName = $(".ui.attached.segment h1.ui.grey.header").text().trim();
    const courseDescription = $(".ui.attached.segment p").text().trim();

    console.log("Coupon links scraped:", couponLinks.length);
    return { couponLinks, courseName, courseDescription };
  } catch (error) {
    console.error("Error scraping coupon links from page:", error.message);
    return { couponLinks: [], courseName: "", courseDescription: "" };
  } finally {
    await delay(5000); // 5-second delay
  }
}

async function saveLinkToDatabase(url, name, description) {
  return new Promise((resolve, reject) => {
    const checkQuery = "SELECT COUNT(*) AS count FROM udemy WHERE url = ?";
    console.log("Executing query:", checkQuery);
    db.query(checkQuery, [url], (err, results) => {
      if (err) {
        console.error("Error checking for duplicate URL:", err.message);
        reject(err);
      } else {
        if (results[0].count > 0) {
          console.log("URL already exists in database:", url);
          resolve();
        } else {
          const query = "INSERT INTO udemy (url, name, description) VALUES (?, ?, ?)";
          console.log("Executing query:", query);
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
  let iteration = 0;
  const maxIterations = 5; // Limit the number of iterations

  while (iteration < maxIterations) {
    try {
      console.log(`Starting iteration ${iteration + 1} of ${maxIterations}`);
      await scrapeHighestNumber();
      const urlsArray = generateURLs();
      let allLinks = [];
      for (let url of urlsArray) {
        const pageLinks = await scrapeLinksFromPage(url);
        allLinks = allLinks.concat(pageLinks);
      }
      let allCouponLinks = [];
      let allCourseDetails = [];
      for (let fullLink of allLinks) {
        const { couponLinks, courseName, courseDescription } = await scrapeCouponLinks(fullLink);
        allCouponLinks = allCouponLinks.concat(couponLinks);
        allCourseDetails.push({ courseName, courseDescription });
      }
      for (let i = 0; i < allCouponLinks.length; i++) {
        const couponLink = allCouponLinks[i];
        const { courseName, courseDescription } = allCourseDetails[i];
        await saveLinkToDatabase(couponLink, courseName, courseDescription);
      }

      console.log("All coupon links saved to the database.");
      iteration++;
      await delay(2000); // 2-second delay between iterations
    } catch (error) {
      console.error("Error during scraping process:", error.message);
    }
  }

  console.log("Scraping process completed.");
  db.end(); // Close the database connection
}

runScrapingProcess();
