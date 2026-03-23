const express = require('express');
const Room = require('../models/Room');
const { protect } = require('../middleware/auth');

const router = express.Router();

// All room routes require authentication
router.use(protect);

// ── POST /api/rooms ──────────────────────────────────────────────────────────
// Create a new room and return shareable roomId
router.post('/', async (req, res) => {
  try {
    const { name, language } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    const room = await Room.create({
      name: name.trim(),
      language: language || 'javascript',
      createdBy: req.user.id,
    });

    res.status(201).json({
      message: 'Room created successfully',
      room: room.toPublic(),
      shareLink: `/room/${room.roomId}`,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join('. ') });
    }
    console.error('[POST /rooms]', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// ── GET /api/rooms ───────────────────────────────────────────────────────────
// Get rooms created by OR joined by the current user, excluding hidden ones.
router.get('/', async (req, res) => {
  try {
    const rooms = await Room.find({
      $and: [
        // must be creator or member
        { $or: [{ createdBy: req.user.id }, { members: req.user.id }] },
        // must NOT be hidden by this user
        { hiddenBy: { $ne: req.user.id } },
      ],
    })
      .sort({ updatedAt: -1 })
      .limit(50)
      .select('roomId name language createdBy createdAt updatedAt');

    res.json({ rooms });
  } catch (error) {
    console.error('[GET /rooms]', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// ── POST /api/rooms/:roomId/join ─────────────────────────────────────────────
// Record that the current user has joined this room (called on room entry)
router.post('/:roomId/join', async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Don't add the creator to members — they already own it
    if (room.createdBy.toString() !== req.user.id) {
      await Room.updateOne(
        { roomId: req.params.roomId },
        { $addToSet: { members: req.user.id } }
      );
    }

    res.json({ message: 'Joined room successfully' });
  } catch (error) {
    console.error('[POST /rooms/:roomId/join]', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// (leave route removed — DELETE now handles dashboard removal for all users)

// ── GET /api/rooms/:roomId ───────────────────────────────────────────────────
// Get room info by shareable roomId
router.get('/:roomId', async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId }).populate(
      'createdBy',
      'username'
    );

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({ room: room.toPublic() });
  } catch (error) {
    console.error('[GET /rooms/:roomId]', error);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

// ── DELETE /api/rooms/:roomId ────────────────────────────────────────────────
// Hide a room from the requesting user's dashboard only.
// The room is NEVER permanently deleted — it stays visible to all other members.
router.delete('/:roomId', async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Add this user to hiddenBy so the room disappears from their dashboard
    await Room.updateOne(
      { roomId: req.params.roomId },
      { $addToSet: { hiddenBy: req.user.id } }
    );

    res.json({ message: 'Room removed from your dashboard' });
  } catch (error) {
    console.error('[DELETE /rooms/:roomId]', error);
    res.status(500).json({ error: 'Failed to remove room' });
  }
});

module.exports = router;
