#!/bin/bash

# Example of posting data to the receiver server using curl

# Create a sample JSON file with an array of objects
cat > sample-data.json << EOF
[
  { "id": "curl1", "name": "Posted with curl", "value": 123 },
  { "id": "curl2", "name": "Second curl item", "value": 456 },
  { "id": "curl3", "name": "Third curl item", "value": 789 }
]
EOF

echo "Posting data to receiver server..."

# Post the data using curl
curl -X POST http://localhost:3001/upload \
  -H "Content-Type: application/json" \
  -d @sample-data.json

echo -e "\n\nChecking stats on receiver server..."

# Get stats from the receiver server
curl http://localhost:3001/stats

echo -e "\n\nDone!" 