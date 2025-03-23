// Example of posting data to the receiver server using Node.js

// Sample data - an array of objects
const data = [
  { id: "item1", name: "First Item", value: 100 },
  { id: "item2", name: "Second Item", value: 200 },
  { id: "item3", name: "Third Item", value: 300 },
];

// Using fetch (Node.js 18+ has fetch built-in)
async function postDataWithFetch() {
  try {
    console.log(`Sending ${data.length} items to the receiver server...`);

    const response = await fetch("http://localhost:3001/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    console.log("Response from server:", result);
  } catch (error) {
    console.error("Error:", error);
  }
}

// Run the example
postDataWithFetch();

/*
 * Alternative using XMLHttpRequest (browser) example:
 *
 * const xhr = new XMLHttpRequest();
 * xhr.open('POST', 'http://localhost:3001/upload', true);
 * xhr.setRequestHeader('Content-Type', 'application/json');
 * xhr.onload = function() {
 *   if (xhr.status === 200) {
 *     const response = JSON.parse(xhr.responseText);
 *     console.log('Success:', response);
 *   } else {
 *     console.error('Error:', xhr.statusText);
 *   }
 * };
 * xhr.onerror = function() {
 *   console.error('Request failed');
 * };
 * xhr.send(JSON.stringify(data));
 */

/*
 * Alternative using axios example:
 *
 * const axios = require('axios');
 *
 * axios.post('http://localhost:3001/upload', data)
 *   .then(response => {
 *     console.log('Success:', response.data);
 *   })
 *   .catch(error => {
 *     console.error('Error:', error);
 *   });
 */
