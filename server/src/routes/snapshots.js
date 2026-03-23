const express = require('express');
const CodeSnapshot = require('../models/CodeSnapshot');
const { protect } = require('../middleware/auth');

const router = express.Router({ mergeParams: true }); // inherits :roomId from parent
router.use(protect);

// ── POST /api/rooms/:roomId/snapshot ──────────────────────────────────────
// Save current editor state. Keeps max 20 snapshots per room.
router.post('/snapshot', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { code, language } = req.body;

    if (!code || !language) {
      return res.status(400).json({ error: 'code and language are required' });
    }

    // Save snapshot
    await CodeSnapshot.create({
      roomId,
      code,
      language,
      savedBy: req.user.username,
    });

    // Prune: keep only the 20 most recent snapshots for this room
    const all = await CodeSnapshot.find({ roomId })
      .sort({ savedAt: -1 })
      .select('_id')
      .lean();

    if (all.length > 20) {
      const toDelete = all.slice(20).map((s) => s._id);
      await CodeSnapshot.deleteMany({ _id: { $in: toDelete } });
    }

    res.status(201).json({ message: 'Snapshot saved' });
  } catch (err) {
    console.error('[POST /snapshot]', err);
    res.status(500).json({ error: 'Failed to save snapshot' });
  }
});

// ── GET /api/rooms/:roomId/snapshots ──────────────────────────────────────
// Return last 10 snapshots for the room.
router.get('/snapshots', async (req, res) => {
  try {
    const { roomId } = req.params;

    const snapshots = await CodeSnapshot.find({ roomId })
      .sort({ savedAt: -1 })
      .limit(10)
      .lean();

    res.json({ snapshots });
  } catch (err) {
    console.error('[GET /snapshots]', err);
    res.status(500).json({ error: 'Failed to fetch snapshots' });
  }
});

module.exports = router;
