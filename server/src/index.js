require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const { YSocketIO } = require('y-socket.io/dist/server');

const connectDB    = require('./config/db');
const authRoutes    = require('./routes/auth');
const roomRoutes    = require('./routes/rooms');
const executeRoutes = require('./routes/execute');
const explainRoutes = require('./routes/explain');
const snapshotRoutes = require('./routes/snapshots');
const YjsDoc       = require('./models/YjsDoc');
const { initSocket } = require('./socket/socketManager');

const app = express();
const server = http.createServer(app);

// ── Socket.io ──────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

initSocket(io);

// ── Yjs CRDT sync via y-socket.io ──────────────────────────────────────────
// YSocketIO uses namespaces matching /^\/yjs\|.*$/ (e.g. /yjs|<roomId>)
// Each unique namespace = one isolated Yjs document. No custom OT needed.
const ysocketio = new YSocketIO(io, {
  gcEnabled: true, // enable garbage collection on deleted nodes
});
ysocketio.initialize();

const Y = require('yjs');

ysocketio.on('document-loaded', async (doc) => {
  const roomId = doc.name.replace('yjs|', '');
  console.log(`[Yjs] Document loaded: ${doc.name}`);

  // Restore persisted state from MongoDB if it exists
  try {
    const saved = await YjsDoc.findOne({ roomId });
    if (saved?.state) {
      Y.applyUpdate(doc, new Uint8Array(saved.state));
      console.log(`[Yjs] Restored state for: ${doc.name}`);
    }
  } catch (err) {
    console.error(`[Yjs] Failed to restore state for ${doc.name}:`, err.message);
  }
});

ysocketio.on('all-document-connections-closed', async (doc) => {
  const roomId = doc.name.replace('yjs|', '');
  console.log(`[Yjs] All connections closed for: ${doc.name}`);

  // Persist current document state to MongoDB
  try {
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    await YjsDoc.findOneAndUpdate(
      { roomId },
      { state, savedAt: new Date() },
      { upsert: true, new: true }
    );
    console.log(`[Yjs] Persisted state for: ${doc.name}`);
  } catch (err) {
    console.error(`[Yjs] Failed to persist state for ${doc.name}:`, err.message);
  }
});

// ── Security middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));

// ── Rate limiting ──────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts, please try again later.' },
});

// ── Body parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/rooms/:roomId', snapshotRoutes);  // snapshot routes get :roomId via mergeParams
app.use('/api/execute', executeRoutes);
app.use('/api/explain', explainRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ───────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// ── Start server ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`🌐 Accepting connections from ${process.env.CLIENT_URL}`);
    console.log(`🗄️  MongoDB connected\n`);
  });
});
