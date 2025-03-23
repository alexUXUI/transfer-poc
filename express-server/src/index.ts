import express, { Request, Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration
const corsOptions = {
  origin: "*", // Allow all origins
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Interface for the data structure
interface DataItem {
  identifier: string;
  rank: number;
  index: number;
  type: string;
  pages: number[];
  entities: string[];
  topics: string[];
  section: string;
  document: {
    dateUploaded: string[];
    documentNumber: string[];
    documentTitle: string[];
    documentVersion: string[];
    id: string;
    identifier: string;
    publisher: string[];
    status: string[];
  };
  payload: {
    content: {
      regions: {
        page: number;
        rect: number[];
      }[];
      text: string;
    };
    context: {
      parents: {
        role: string;
        text: string;
      }[];
      section: {
        title: string;
      };
    };
    entities: {
      class: string;
      groups: string[];
      offsets: {
        length: number;
        start: number;
      }[];
      source: string;
      text: string;
    }[];
    id: string;
    index: number;
    path: {
      text: string;
    }[];
    type: string;
  };
}

interface DataResponse {
  matches: DataItem[];
}

// Function to load all JSON data from files
const loadAllData = (): DataItem[] => {
  const dataDir = path.join(__dirname, "../../data");
  const files = fs
    .readdirSync(dataDir)
    .filter((file) => file.endsWith(".json"));

  let allData: DataItem[] = [];

  files.forEach((file) => {
    try {
      const filePath = path.join(dataDir, file);
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const data: DataResponse = JSON.parse(fileContent);

      if (data && data.matches && Array.isArray(data.matches)) {
        allData = [...allData, ...data.matches];
      }
    } catch (error) {
      console.error(`Error reading file ${file}:`, error);
    }
  });

  return allData;
};

// GET endpoint for specification data with pagination
app.get("/specification", (req: Request, res: Response) => {
  try {
    // Parse pagination parameters
    const skip = parseInt(req.query.skip as string) || 0;
    const top = parseInt(req.query.top as string) || 10000;

    // Load all data
    const allData = loadAllData();

    // Apply pagination
    const paginatedData = allData.slice(skip, skip + top);

    // Return the paginated result
    res.json({
      total: allData.length,
      skip,
      top,
      data: paginatedData,
    });
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
