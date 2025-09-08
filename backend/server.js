const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json({limit: '50mb'}));

const dataDir = path.join(__dirname, 'data');

// Ensure data directory exists
fs.mkdir(dataDir, { recursive: true });

const collections = [
  'settings',
  'profiles',
  'playlists',
  'history',
  'search-history',
  'subscription-cache'
];

// In-memory cache for the latest data
const dataCache = {};

async function getLatestData(collection) {
  try {
    const files = await fs.readdir(path.join(dataDir, collection));
    if (files.length === 0) {
      return [];
    }
    const latestFile = files.sort().pop();
    const data = await fs.readFile(path.join(dataDir, collection, latestFile), 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // No directory for collection yet
    }
    console.error(`Error reading latest data for ${collection}:`, error);
    return [];
  }
}

async function loadAllData() {
    for (const collection of collections) {
        const collectionPath = path.join(dataDir, collection);
        await fs.mkdir(collectionPath, { recursive: true });
        dataCache[collection] = await getLatestData(collection);
    }
}

app.get('/api/:collection', async (req, res) => {
  const { collection } = req.params;
  if (!collections.includes(collection)) {
    return res.status(404).send('Collection not found');
  }
  res.json(dataCache[collection] || []);
});

app.post('/api/:collection', async (req, res) => {
    const { collection } = req.params;
    if (!collections.includes(collection)) {
        return res.status(404).send('Collection not found');
    }

    const data = req.body;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}.json`;
    const collectionPath = path.join(dataDir, collection);

    try {
        await fs.mkdir(collectionPath, { recursive: true });
        await fs.writeFile(path.join(collectionPath, filename), JSON.stringify(data, null, 2));
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


loadAllData().then(() => {
    app.listen(port, () => {
        console.log(`Backend server listening at http://localhost:${port}`);
    });
});
