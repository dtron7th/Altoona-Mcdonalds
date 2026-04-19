require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS signatures (
      id BIGSERIAL PRIMARY KEY,
      image_data_url TEXT NOT NULL,
      device_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS supports (
      id BIGSERIAL PRIMARY KEY,
      device_id TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/api/health', function(_req, res) {
  res.json({ ok: true });
});

app.get('/api/signatures', async function(_req, res) {
  try {
    const result = await pool.query(
      'SELECT id, image_data_url AS "imageDataUrl", device_id AS "deviceId", created_at AS "createdAt" FROM signatures ORDER BY id DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to load signatures:', error);
    res.status(500).json({ error: 'Failed to load signatures' });
  }
});

app.delete('/api/signatures/:id', async function(req, res) {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Valid signature id is required' });
  }

  try {
    const result = await pool.query('DELETE FROM signatures WHERE id = $1 RETURNING id', [id]);
    res.json({ removed: result.rowCount > 0 });
  } catch (error) {
    console.error('Failed to delete signature:', error);
    res.status(500).json({ error: 'Failed to delete signature' });
  }
});

app.delete('/api/signatures', async function(_req, res) {
  try {
    await pool.query('DELETE FROM signatures');
    res.json({ cleared: true });
  } catch (error) {
    console.error('Failed to clear signatures:', error);
    res.status(500).json({ error: 'Failed to clear signatures' });
  }
});

app.get('/api/signatures/count', async function(_req, res) {
  try {
    const result = await pool.query('SELECT COUNT(*)::INT AS count FROM signatures');
    res.json({ count: result.rows[0].count || 0 });
  } catch (error) {
    console.error('Failed to count signatures:', error);
    res.status(500).json({ error: 'Failed to count signatures' });
  }
});

app.post('/api/signatures', async function(req, res) {
  const imageDataUrl = req.body && req.body.imageDataUrl;
  const deviceId = req.body && req.body.deviceId ? String(req.body.deviceId) : null;

  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return res.status(400).json({ error: 'imageDataUrl is required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO signatures (image_data_url, device_id) VALUES ($1, $2) RETURNING id, created_at AS "createdAt"',
      [imageDataUrl, deviceId]
    );

    res.status(201).json({
      id: result.rows[0].id,
      createdAt: result.rows[0].createdAt
    });
  } catch (error) {
    console.error('Failed to save signature:', error);
    res.status(500).json({ error: 'Failed to save signature' });
  }
});

app.get('/api/supports', async function(_req, res) {
  try {
    const result = await pool.query(
      'SELECT id, device_id AS "deviceId", created_at AS "createdAt" FROM supports ORDER BY id DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to load supports:', error);
    res.status(500).json({ error: 'Failed to load supports' });
  }
});

app.get('/api/supports/count', async function(_req, res) {
  try {
    const result = await pool.query('SELECT COUNT(*)::INT AS count FROM supports');
    res.json({ count: result.rows[0].count || 0 });
  } catch (error) {
    console.error('Failed to count supports:', error);
    res.status(500).json({ error: 'Failed to count supports' });
  }
});

app.get('/api/supports/:deviceId', async function(req, res) {
  const deviceId = String(req.params.deviceId || '');

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, device_id AS "deviceId", created_at AS "createdAt" FROM supports WHERE device_id = $1 LIMIT 1',
      [deviceId]
    );

    if (!result.rowCount) {
      return res.status(404).json({ exists: false });
    }

    res.json({ exists: true, record: result.rows[0] });
  } catch (error) {
    console.error('Failed to lookup support by device:', error);
    res.status(500).json({ error: 'Failed to lookup support by device' });
  }
});

app.post('/api/supports', async function(req, res) {
  const deviceId = req.body && req.body.deviceId ? String(req.body.deviceId) : '';

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  try {
    const existing = await pool.query(
      'SELECT id, device_id AS "deviceId", created_at AS "createdAt" FROM supports WHERE device_id = $1 LIMIT 1',
      [deviceId]
    );

    if (existing.rowCount) {
      return res.status(200).json({ added: false, record: existing.rows[0] });
    }

    const inserted = await pool.query(
      'INSERT INTO supports (device_id) VALUES ($1) RETURNING id, device_id AS "deviceId", created_at AS "createdAt"',
      [deviceId]
    );

    res.status(201).json({ added: true, record: inserted.rows[0] });
  } catch (error) {
    console.error('Failed to add support:', error);
    res.status(500).json({ error: 'Failed to add support' });
  }
});

app.delete('/api/supports/:deviceId', async function(req, res) {
  const deviceId = String(req.params.deviceId || '');

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  try {
    const result = await pool.query('DELETE FROM supports WHERE device_id = $1 RETURNING id', [deviceId]);
    res.json({ removed: result.rowCount > 0 });
  } catch (error) {
    console.error('Failed to remove support:', error);
    res.status(500).json({ error: 'Failed to remove support' });
  }
});

app.delete('/api/database', async function(_req, res) {
  const providedAdminKey = String(_req.get('x-admin-key') || '');

  if (!ADMIN_API_KEY) {
    return res.status(503).json({ error: 'ADMIN_API_KEY is not configured on server' });
  }

  if (!providedAdminKey || providedAdminKey !== ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM supports');
    await pool.query('DELETE FROM signatures');
    await pool.query('COMMIT');
    res.json({ reset: true });
  } catch (error) {
    await pool.query('ROLLBACK').catch(function() {});
    console.error('Failed to reset database:', error);
    res.status(500).json({ error: 'Failed to reset database' });
  }
});

initDb()
  .then(function() {
    app.listen(PORT, function() {
      console.log('Server listening on http://localhost:' + PORT);
    });
  })
  .catch(function(error) {
    console.error('Database init failed:', error);
    process.exit(1);
  });
