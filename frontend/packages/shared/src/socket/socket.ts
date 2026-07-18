import { io, type Socket } from "socket.io-client";
import type { Activity } from "../types";

export interface ServerEvents {
  "feed:activity": (activity: Activity) => void;
  "feed:update": (activity: Activity) => void;
  "feed:delete": (data: { activityUri: string }) => void;
  joined: (room: string) => void;
}

export interface ClientEvents {
  join: (userId: string) => void;
}

export type AppSocket = Socket<ServerEvents, ClientEvents>;

let socket: AppSocket | null = null;

export function connectSocket(baseUrl: string): AppSocket {
  if (socket?.connected) return socket;
  socket = io(baseUrl, { transports: ["websocket"] }) as AppSocket;
  return socket;
}

export function disconnectSocket() {
  socket?.close();
  socket = null;
}

export function joinFeed(socket: AppSocket, userId: string) {
  socket.emit("join", userId);
}
