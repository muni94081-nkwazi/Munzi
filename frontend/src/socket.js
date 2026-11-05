import { io } from 'socket.io-client';

const SOCKET_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/api\/?$/, '');

let socket = null;

/**
 * Creates (or returns the existing) socket connection, authenticated with
 * the current session's JWT. Socket.io's client handles reconnection
 * automatically (exponential backoff, resubscribing transports) - no extra
 * code needed for that; components just react to 'connect'/'disconnect'/
 * 'connect_error' if they want to show connection status.
 */
export function connectSocket(token) {
  if (socket?.connected && socket.auth?.token === token) return socket;

  if (socket) {
    socket.close();
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.close();
    socket = null;
  }
}
