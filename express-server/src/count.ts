import fs from "fs";
import path from "path";

interface DataResponse {
  matches: any[];
}

// Function to count all items in all JSON files
const countAllItems = (): number => {
  const dataDir = path.join(__dirname, "../../data");
  const files = fs
    .readdirSync(dataDir)
    .filter((file) => file.endsWith(".json"));

  let totalCount = 0;
  let fileDetails: { [key: string]: number } = {};

  files.forEach((file) => {
    try {
      const filePath = path.join(dataDir, file);
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const data: DataResponse = JSON.parse(fileContent);

      if (data && data.matches && Array.isArray(data.matches)) {
        fileDetails[file] = data.matches.length;
        totalCount += data.matches.length;
      }
    } catch (error) {
      console.error(`Error reading file ${file}:`, error);
    }
  });

  console.log("Number of items in each file:");
  Object.entries(fileDetails).forEach(([file, count]) => {
    console.log(`${file}: ${count} items`);
  });

  console.log(`\nTotal number of items across all files: ${totalCount}`);
  return totalCount;
};

// Run the count
countAllItems();
