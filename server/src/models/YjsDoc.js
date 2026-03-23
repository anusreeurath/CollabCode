const mongoose = require('mongoose');

// Stores the binary Yjs document state (encoded update vector) per room.
// This allows code to persist across server restarts.
const yjsDocSchema = new mongoose.Schema(
  {
    roomId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },
    // Y.encodeStateAsUpdate() produces a Uint8Array — store as Buffer (BSON Binary)
    state: {
      type:     Buffer,
      required: true,
    },
    savedAt: {
      type:    Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

module.exports = mongoose.model('YjsDoc', yjsDocSchema);
