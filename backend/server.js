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
    data TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );
`);

// In-memory cache for the latest data
const dataCache = {};

function getData(collection) {
  const stmt = db.prepare('SELECT data, version FROM collections WHERE name = ?');
  const row = stmt.get(collection);
  if (row) {
    const data = row.data ? JSON.parse(row.data) : [];
    return { data, version: row.version };
  }
  return { data: [], version: 0 };
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
  res.json(dataCache[collection] || { data: [], version: 0 });
});

app.post('/api/:collection', (req, res) => {
    const { collection } = req.params;
    if (!collections.includes(collection)) {
        return res.status(404).send('Collection not found');
    }

    const { data, version: clientVersion } = req.body;
    if (data === undefined || clientVersion === undefined) {
        return res.status(400).send('Bad request: missing data or version');
    }

    const updateTx = db.transaction(() => {
        const stmt_get = db.prepare('SELECT version FROM collections WHERE name = ?');
        const row = stmt_get.get(collection);
        const dbVersion = row ? row.version : 0;

        if (dbVersion !== clientVersion) {
            return { success: false, version: dbVersion }; // Conflict
        }

        const newVersion = dbVersion + 1;
        if (row) {
            const stmt_update = db.prepare('UPDATE collections SET data = ?, version = ? WHERE name = ?');
            stmt_update.run(JSON.stringify(data), newVersion, collection);
        } else {
            const stmt_insert = db.prepare('INSERT INTO collections (name, data, version) VALUES (?, ?, ?)');
            stmt_insert.run(collection, JSON.stringify(data), newVersion);
        }
        return { success: true, version: newVersion };
    });

    try {
        const result = updateTx();
        if (result.success) {
            dataCache[collection] = { data, version: result.version };
            res.status(200).json({ message: 'Data saved successfully', version: result.version });
        } else {
            dataCache[collection] = getData(collection);
            res.status(409).json({ message: 'Conflict: data has been modified by another user.', version: result.version });
        }
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
