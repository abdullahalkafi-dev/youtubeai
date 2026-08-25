import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl } from './api';

let socket: Socket | null = null;

export function getAutomationSocket(): Socket {
  if (!socket) {
    const baseUrl = getApiBaseUrl();
    socket = io(`${baseUrl}/automation`, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
      // connected
    });

    socket.on('disconnect', () => {
      // disconnected
    });
  }

  return socket;
}

export function joinChannelAutomation(channelId: string) {
  const s = getAutomationSocket();
  if (s.connected) {
    s.emit('join_channel', { channelId });
  } else {
    s.once('connect', () => {
      s.emit('join_channel', { channelId });
    });
  }
}

export function leaveChannelAutomation(channelId: string) {
  const s = getAutomationSocket();
  if (s.connected) {
    s.emit('leave_channel', { channelId });
  }
}
