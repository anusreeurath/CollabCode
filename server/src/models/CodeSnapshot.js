const mongoose = require('mongoose');

const codeSnapshotSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      maxlength: [500_000, 'Code snapshot too large'],
    },
    language: {
      type: String,
      required: true,
    },
    savedBy: {
      type: String, // username string — simple, no ref needed
      required: true,
    },
    savedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

const CodeSnapshot = mongoose.model('CodeSnapshot', codeSnapshotSchema);
module.exports = CodeSnapshot;
