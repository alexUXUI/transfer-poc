import express, { Request, Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3001; // Different port from the first server

// Create a directory to store received data
const dataDir = path.join(__dirname, "../received-data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// CORS configuration
const corsOptions = {
  origin: "*", // Allow all origins
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" })); // Increase the limit for large payloads

// Interface for the response
interface ResponseData {
  success: boolean;
  message: string;
  count?: number;
  timestamp?: string;
  filename?: string;
}

// POST endpoint to receive data
app.post("/upload", async (req: Request, res: Response) => {
  try {
    const data = req.body;

    // Validate the incoming data
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        message: "Invalid data format. Expected an array of items.",
      } as ResponseData);
    }

    const count = data.length;
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const filename = `data-${timestamp}.json`;
    const filePath = path.join(dataDir, filename);

    // Write the data to a file
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // Respond with success message
    res.json({
      success: true,
      message: `Successfully received and stored ${count} items.`,
      count,
      timestamp,
      filename,
    } as ResponseData);

    console.log(
      `[${timestamp}] Received and stored ${count} items in ${filename}`
    );
  } catch (error) {
    console.error("Error processing upload:", error);
    res.status(500).json({
      success: false,
      message: `Internal server error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    } as ResponseData);
  }
});

// Endpoint to check how many items have been received
app.get("/stats", (req: Request, res: Response) => {
  try {
    // Read all files in the received-data directory
    const files = fs
      .readdirSync(dataDir)
      .filter((file) => file.endsWith(".json"));
    const stats = files.map((file) => {
      const filePath = path.join(dataDir, file);
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(fileContent);
      return {
        filename: file,
        timestamp: file
          .replace("data-", "")
          .replace(".json", "")
          .replace(/-/g, ":"),
        count: Array.isArray(data) ? data.length : 0,
      };
    });

    // Calculate total count
    const totalItems = stats.reduce((total, file) => total + file.count, 0);

    res.json({
      success: true,
      message: `Found ${files.length} data files with a total of ${totalItems} items.`,
      files: stats,
      totalItems,
    });
  } catch (error) {
    console.error("Error getting stats:", error);
    res.status(500).json({
      success: false,
      message: `Internal server error: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    } as ResponseData);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Receiver server is running on port ${PORT}`);
  console.log(`Data will be stored in: ${dataDir}`);
});

export default app;
