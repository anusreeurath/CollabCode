import { io } from 'socket.io-client';

// Connect to the server (not through Vite proxy since socket.io needs direct WS)
// Using the same origin in dev since Vite proxy handles /socket.io
const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:5000';

let socket = null;

export const getSocket = () => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
  }
  return socket;
};

export const connectSocket = () => {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
};

export const disconnectSocket = () => {
  if (socket?.connected) {
    socket.disconnect();
  }
};
