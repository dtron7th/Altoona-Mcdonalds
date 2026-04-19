require('dotenv').config();

const express = require('express');
const path = require('path');
const { sql } = require('drizzle-orm');
const { db } = require('./db/runtime-client');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
let initDbPromise = null;

async function initDb() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS signatures (
      id BIGSERIAL PRIMARY KEY,
      image_data_url TEXT NOT NULL,
      device_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    DELETE FROM signatures newer
    USING signatures older
    WHERE newer.device_id IS NOT NULL
      AND older.device_id = newer.device_id
      AND older.id < newer.id
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS signatures_device_id_unique_idx
    ON signatures (device_id)
    WHERE device_id IS NOT NULL
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS supports (
      id BIGSERIAL PRIMARY KEY,
      device_id TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function ensureDbInitialized() {
  if (!initDbPromise) {
    initDbPromise = initDb();
  }
  return initDbPromise;
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/api/health', function(_req, res) {
  res.json({ ok: true });
});

app.get('/api/signatures', async function(_req, res) {
  try {
    const result = await db.execute(sql`
      SELECT
        id,
        image_data_url AS "imageDataUrl",
        device_id AS "deviceId",
        created_at AS "createdAt"
      FROM signatures
      ORDER BY id DESC
    `);
    const rows = Array.isArray(result) ? result : (result.rows || []);
    res.json(rows);
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
    const result = await db.execute(sql`DELETE FROM signatures WHERE id = ${id} RETURNING id`);
    const rows = Array.isArray(result) ? result : (result.rows || []);
    res.json({ removed: rows.length > 0 });
  } catch (error) {
    console.error('Failed to delete signature:', error);
    res.status(500).json({ error: 'Failed to delete signature' });
  }
});

app.delete('/api/signatures', async function(_req, res) {
  try {
    await db.execute(sql`DELETE FROM signatures`);
    res.json({ cleared: true });
  } catch (error) {
    console.error('Failed to clear signatures:', error);
    res.status(500).json({ error: 'Failed to clear signatures' });
  }
});

app.get('/api/signatures/count', async function(_req, res) {
  try {
    const result = await db.execute(sql`SELECT COUNT(*)::INT AS count FROM signatures`);
    const row = Array.isArray(result) ? result[0] : (result.rows && result.rows[0]);
    const count = row && row.count ? Number(row.count) : 0;
    res.json({ count });
  } catch (error) {
    console.error('Failed to count signatures:', error);
    res.status(500).json({ error: 'Failed to count signatures' });
  }
});

app.get('/api/signatures/device/:deviceId', async function(req, res) {
  const deviceId = String(req.params.deviceId || '').trim();

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  try {
    const result = await db.execute(sql`
      SELECT
        id,
        created_at AS "createdAt"
      FROM signatures
      WHERE device_id = ${deviceId}
      LIMIT 1
    `);
    const rows = Array.isArray(result) ? result : (result.rows || []);

    if (!rows.length) {
      return res.status(404).json({ exists: false });
    }

    res.json({ exists: true, record: rows[0] });
  } catch (error) {
    console.error('Failed to lookup signature by device:', error);
    res.status(500).json({ error: 'Failed to lookup signature by device' });
  }
});

app.post('/api/signatures', async function(req, res) {
  const imageDataUrl = req.body && req.body.imageDataUrl;
  const deviceId = req.body && req.body.deviceId ? String(req.body.deviceId).trim() : '';

  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return res.status(400).json({ error: 'imageDataUrl is required' });
  }

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  try {
    const existingResult = await db.execute(sql`
      SELECT
        id,
        created_at AS "createdAt"
      FROM signatures
      WHERE device_id = ${deviceId}
      LIMIT 1
    `);
    const existingRows = Array.isArray(existingResult) ? existingResult : (existingResult.rows || []);

    if (existingRows.length) {
      return res.status(200).json({
        added: false,
        message: 'This device already submitted a signature.',
        id: existingRows[0].id,
        createdAt: existingRows[0].createdAt
      });
    }

    const result = await db.execute(sql`
      INSERT INTO signatures (image_data_url, device_id)
      VALUES (${imageDataUrl}, ${deviceId})
      RETURNING id, created_at AS "createdAt"
    `);
    const rows = Array.isArray(result) ? result : (result.rows || []);

    res.status(201).json({
      added: true,
      id: rows[0].id,
      createdAt: rows[0].createdAt
    });
  } catch (error) {
    if (error && error.code === '23505') {
      return res.status(200).json({
        added: false,
        message: 'This device already submitted a signature.'
      });
    }

    console.error('Failed to save signature:', error);
    res.status(500).json({ error: 'Failed to save signature' });
  }
});

app.get('/api/supports', async function(_req, res) {
  try {
    const result = await db.execute(sql`
      SELECT
        id,
        device_id AS "deviceId",
        created_at AS "createdAt"
      FROM supports
      ORDER BY id DESC
    `);
    const rows = Array.isArray(result) ? result : (result.rows || []);
    res.json(rows);
  } catch (error) {
    console.error('Failed to load supports:', error);
    res.status(500).json({ error: 'Failed to load supports' });
  }
});

app.get('/api/supports/count', async function(_req, res) {
  try {
    const result = await db.execute(sql`SELECT COUNT(*)::INT AS count FROM supports`);
    const row = Array.isArray(result) ? result[0] : (result.rows && result.rows[0]);
    const count = row && row.count ? Number(row.count) : 0;
    res.json({ count });
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
    const result = await db.execute(sql`
      SELECT
        id,
        device_id AS "deviceId",
        created_at AS "createdAt"
      FROM supports
      WHERE device_id = ${deviceId}
      LIMIT 1
    `);
    const rows = Array.isArray(result) ? result : (result.rows || []);

    if (!rows.length) {
      return res.status(404).json({ exists: false });
    }

    res.json({ exists: true, record: rows[0] });
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
    const existingResult = await db.execute(sql`
      SELECT
        id,
        device_id AS "deviceId",
        created_at AS "createdAt"
      FROM supports
      WHERE device_id = ${deviceId}
      LIMIT 1
    `);
    const existingRows = Array.isArray(existingResult) ? existingResult : (existingResult.rows || []);

    if (existingRows.length) {
      return res.status(200).json({ added: false, record: existingRows[0] });
    }

    const insertedResult = await db.execute(sql`
      INSERT INTO supports (device_id)
      VALUES (${deviceId})
      RETURNING id, device_id AS "deviceId", created_at AS "createdAt"
    `);
    const insertedRows = Array.isArray(insertedResult) ? insertedResult : (insertedResult.rows || []);

    res.status(201).json({ added: true, record: insertedRows[0] });
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
    const result = await db.execute(sql`DELETE FROM supports WHERE device_id = ${deviceId} RETURNING id`);
    const rows = Array.isArray(result) ? result : (result.rows || []);
    res.json({ removed: rows.length > 0 });
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
    await db.execute(sql`DELETE FROM supports`);
    await db.execute(sql`DELETE FROM signatures`);
    res.json({ reset: true });
  } catch (error) {
    console.error('Failed to reset database:', error);
    res.status(500).json({ error: 'Failed to reset database' });
  }
});

if (require.main === module) {
  ensureDbInitialized()
    .then(function() {
      app.listen(PORT, function() {
        console.log('Server listening on http://localhost:' + PORT);
      });
    })
    .catch(function(error) {
      console.error('Database init failed:', error);
      process.exit(1);
    });
}

module.exports = {
  app,
  ensureDbInitialized
};
