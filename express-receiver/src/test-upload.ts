import fetch from "node-fetch";

// Sample data to send
const testData = Array.from({ length: 10 }, (_, i) => ({
  id: `test-${i}`,
  value: `Test value ${i}`,
  timestamp: new Date().toISOString(),
}));

const testUpload = async () => {
  try {
    console.log(`Sending ${testData.length} items to the receiver server...`);

    const response = await fetch("http://localhost:3001/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testData),
    });

    const result = await response.json();

    console.log("Response from server:", result);

    if (result.success) {
      console.log("✅ Test successful!");
    } else {
      console.log("❌ Test failed!");
    }
  } catch (error) {
    console.error("Error during test:", error);
  }
};

// Run the test
testUpload();
