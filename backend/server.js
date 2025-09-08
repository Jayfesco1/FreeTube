const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({limit: '50mb'}));

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const db = new Database(path.join(dataDir, 'data.db'));

const collections = [
  'settings',
  'profiles',
  'playlists',
  'history',
  'search-history',
  'subscription-cache'
];

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS collections (
    name TEXT PRIMARY KEY,
    data TEXT
  );
`);

// In-memory cache for the latest data
const dataCache = {};

function getData(collection) {
  const stmt = db.prepare('SELECT data FROM collections WHERE name = ?');
  const row = stmt.get(collection);
  if (row) {
    return JSON.parse(row.data);
  }
  return [];
}

function loadAllData() {
    for (const collection of collections) {
        dataCache[collection] = getData(collection);
    }
}

app.get('/api/:collection', (req, res) => {
  const { collection } = req.params;
  if (!collections.includes(collection)) {
    return res.status(404).send('Collection not found');
  }
  res.json(dataCache[collection] || []);
});

app.post('/api/:collection', (req, res) => {
    const { collection } = req.params;
    if (!collections.includes(collection)) {
        return res.status(404).send('Collection not found');
    }

    const data = req.body;

    try {
        const stmt = db.prepare('INSERT OR REPLACE INTO collections (name, data) VALUES (?, ?)');
        stmt.run(collection, JSON.stringify(data));
        dataCache[collection] = data;
        res.status(200).send('Data saved successfully');
    } catch (error) {
        console.error(`Error saving data for ${collection}:`, error);
        res.status(500).send('Error saving data');
    }
});

// Serve static files from the Vue app build directory
const staticPath = path.join(__dirname, '../dist/web');
app.use(express.static(staticPath));

// Handle SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});

loadAllData();
app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
});
