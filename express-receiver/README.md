# Express Receiver Server

A server that provides a POST endpoint to receive and store data sent from another server.

## Features

- Receives data through a POST endpoint `/upload`
- Validates incoming data and stores it in JSON files with timestamps
- Provides a `/stats` endpoint to check how many items have been received
- All received data is stored in the `received-data` directory

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Run the development server:
   ```
   npm run dev
   ```

3. Or build and run the production server:
   ```
   npm run build
   npm start
   ```

## API Usage

### POST /upload

Accepts an array of items to store.

**Request Body:**
```json
[
  { "item1": "data" },
  { "item2": "data" },
  ...
]
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully received and stored 682 items.",
  "count": 682,
  "timestamp": "2023-10-31T14-30-45.123Z",
  "filename": "data-2023-10-31T14-30-45.123Z.json"
}
```

### GET /stats

Returns statistics about all received data.

**Response:**
```json
{
  "success": true,
  "message": "Found 3 data files with a total of 682 items.",
  "files": [
    {
      "filename": "data-2023-10-31T14-30-45.123Z.json",
      "timestamp": "2023-10-31T14:30:45.123Z",
      "count": 200
    },
    {
      "filename": "data-2023-10-31T14-35-12.456Z.json",
      "timestamp": "2023-10-31T14:35:12.456Z",
      "count": 482
    }
  ],
  "totalItems": 682
}
``` 

```javascript
const axios = require('axios');

const data = [
  { id: "item1", description: "First item" },
  { id: "item2", description: "Second item" }
];

axios.post('http://localhost:3001/upload', data)
  .then(response => {
    console.log('Success:', response.data);
  })
  .catch(error => {
    console.error('Error:', error);
  });
```
