require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const { MongoClient } = require("mongodb");

const baseURL = "https://www.discudemy.com/all";

// MongoDB connection
const client = new MongoClient(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

let db, udemyCollection;

async function connectToDatabase() {
  try {
    await client.connect();
    db = client.db(); // Uses the database specified in the connection string
    udemyCollection = db.collection("udemy");
    console.log("Connected to MongoDB database.");
  } catch (err) {
    console.error("Error connecting to the database:", err.stack);
    process.exit(1); // Exit with an error code
  }
}

// Function to scrape the highest number from the pagination buttons
async function scrapeHighestNumber() {
  try {
    const { data } = await axios.get(baseURL);
    const $ = cheerio.load(data);

    const paginationNumbers = [];

    // Find all pagination buttons and extract their text
    $("ul.pagination3.border li a").each((index, element) => {
      const text = $(element).text().trim();
      if (!isNaN(text)) {
        paginationNumbers.push(Number(text));
      }
    });

    // Find the highest number in the array
    const highestNumber = Math.max(...paginationNumbers);
    console.log("Highest number found:", highestNumber);
    return highestNumber;
  } catch (error) {
    console.error("Error scraping numbers:", error.message);
    return null;
  }
}

// Function to scrape the <a> tag text and image URL from a specific page
async function scrapePageDetails(pageNumber) {
  try {
    const url = `${baseURL}/${pageNumber}`;
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const pageDetails = [];

    // Loop through each card on the page
    $(".card").each((index, element) => {
      const name = $(element).find(".content .header a").text().trim();
      const imageUrl =
        $(element).find(".image amp-img").attr("src") ||
        $(element).find(".image img").attr("src");

      if (name && imageUrl) {
        pageDetails.push({ name, imageUrl });
      }
    });

    return pageDetails;
  } catch (error) {
    console.error(`Error scraping page ${pageNumber}:`, error.message);
    return [];
  }
}

// Function to update the image URL in the database
async function updateImageInDatabase(name, imageUrl) {
  try {
    const result = await udemyCollection.updateOne(
      { name: name },
      { $set: { image: imageUrl } },
      { upsert: false } // Only update existing documents
    );

    if (result.matchedCount > 0) {
      console.log(`Updated image for "${name}"`);
    } else {
      console.log(`No matching record found for "${name}"`);
    }
    return result;
  } catch (err) {
    console.error("Error updating image in database:", err.message);
    throw err;
  }
}

// Function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Main function to scrape and update image URLs
async function scrapeAndUpdateImages() {
  try {
    const highestNumber = await scrapeHighestNumber();

    if (!highestNumber) {
      console.error("Unable to determine the highest number. Exiting.");
      return;
    }

    // Loop through all pages from 1 to the highest number
    for (let i = 1; i <= highestNumber; i++) {
      console.log(`Scraping page ${i}...`);
      const pageDetails = await scrapePageDetails(i);

      // Update the image URLs in the database
      for (const { name, imageUrl } of pageDetails) {
        await updateImageInDatabase(name, imageUrl);
      }

      // Add a delay between pages to avoid overwhelming the server
      await delay(1000);
    }

    console.log("Scraping and updating completed.");
  } catch (error) {
    console.error("Error during scraping and updating process:", error.message);
    throw error;
  }
}

// Main function to run the script
async function main() {
  try {
    await connectToDatabase();
    await scrapeAndUpdateImages();
    console.log("Script completed successfully.");
  } catch (error) {
    console.error("Script failed:", error);
    process.exit(1);
  } finally {
    await client.close(); // Close the MongoDB connection
    console.log("Disconnected from MongoDB.");
  }
}

// Run the script
main();
