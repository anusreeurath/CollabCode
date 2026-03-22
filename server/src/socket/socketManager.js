/**
 * Socket.io manager
 * Phase 1: Connection scaffold — just log connections/disconnections.
 * Real-time collaboration sync will be added in Phase 2.
 */

const initSocket = (io) => {
  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // ── Phase 1 placeholder events ─────────────────────────────────────────
    // Client will emit 'join-room' with { roomId, username }
    socket.on('join-room', ({ roomId, username }) => {
      socket.join(roomId);
      console.log(`👤 ${username || 'Anonymous'} joined room: ${roomId} (socket: ${socket.id})`);

      // Notify other users in the room
      socket.to(roomId).emit('user-joined', {
        socketId: socket.id,
        username: username || 'Anonymous',
        timestamp: new Date().toISOString(),
      });

      // Confirm to the joining user
      socket.emit('room-joined', {
        roomId,
        message: `Successfully joined room ${roomId}`,
        timestamp: new Date().toISOString(),
      });
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnecting', () => {
      const rooms = [...socket.rooms].filter((r) => r !== socket.id);
      rooms.forEach((roomId) => {
        socket.to(roomId).emit('user-left', {
          socketId: socket.id,
          timestamp: new Date().toISOString(),
        });
        console.log(`👋 Socket ${socket.id} left room: ${roomId}`);
      });
    });

    socket.on('disconnect', (reason) => {
      console.log(`❌ Socket disconnected: ${socket.id} (reason: ${reason})`);
    });

    socket.on('error', (err) => {
      console.error(`[socket error] ${socket.id}:`, err);
    });
  });

  console.log('✅ Socket.io initialized');
};

module.exports = { initSocket };
