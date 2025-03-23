# Express Server for JSON Data

A simple Express server that exposes JSON data from multiple files with pagination.

## Features

- Reads and combines JSON data from all files in the `/data` directory
- Exposes data through a paginated `/specification` endpoint
- Supports pagination parameters `skip` and `top`

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

### GET /specification

Returns paginated data from all JSON files.

**Query Parameters:**
- `skip` (optional): Number of items to skip (default: 0)
- `top` (optional): Maximum number of items to return (default: 10000)

**Example:**
```
GET /specification?skip=0&top=100
```

**Response:**
```json
{
  "total": 57866, 
  "skip": 0,
  "top": 100,
  "data": [...]
}
``` 

http://localhost:3000/specification?skip=0&top=100

http://localhost:3000/specification?skip=100&top=200

There are 682 items in total across all four JSON files:
input.json: 122 items
input-2.json: 200 items
input-3.json: 200 items
input-4.json: 160 items
Total: 682 items