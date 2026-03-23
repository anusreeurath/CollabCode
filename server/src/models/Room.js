const mongoose = require('mongoose');
const { nanoid } = require('nanoid');

const SUPPORTED_LANGUAGES = [
  'javascript', 'typescript', 'python', 'java', 'cpp',
  'c', 'csharp', 'go', 'rust', 'html', 'css', 'json',
  'markdown', 'sql', 'php', 'ruby', 'swift', 'kotlin',
];

const roomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      default: () => nanoid(10),
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Room name is required'],
      trim: true,
      minlength: [1, 'Room name cannot be empty'],
      maxlength: [60, 'Room name must be at most 60 characters'],
    },
    language: {
      type: String,
      enum: SUPPORTED_LANGUAGES,
      default: 'javascript',
    },
    content: {
      type: String,
      default: '// Start coding here...\n',
      maxlength: [500000, 'Content too large'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    // Users who have dismissed this room from their dashboard.
    // The room is NOT deleted — it just won't appear for these users.
    hiddenBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Virtual to return a safe public object
roomSchema.methods.toPublic = function () {
  return {
    roomId: this.roomId,
    name: this.name,
    language: this.language,
    createdBy: this.createdBy,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const Room = mongoose.model('Room', roomSchema);
module.exports = Room;
