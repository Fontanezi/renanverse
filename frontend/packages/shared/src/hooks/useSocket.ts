import { useEffect, useRef } from "react";
import { connectSocket, joinFeed } from "../socket";
import type { Activity } from "../types";
import type { AppSocket } from "../socket";

export function useSocket(
  baseUrl: string,
  userId?: string,
  onActivity?: (activity: Activity) => void,
  onUpdate?: (activity: Activity) => void,
  onDelete?: (data: { activityUri: string }) => void,
) {
  const socketRef = useRef<AppSocket | null>(null);

  useEffect(() => {
    const socket = connectSocket(baseUrl);
    socketRef.current = socket;

    if (onActivity) socket.on("feed:activity", onActivity);
    if (onUpdate) socket.on("feed:update", onUpdate);
    if (onDelete) socket.on("feed:delete", onDelete);

    if (userId) {
      socket.on("connect", () => joinFeed(socket, userId));
      if (socket.connected) joinFeed(socket, userId);
    }

    return () => {
      socket.off("feed:activity");
      socket.off("feed:update");
      socket.off("feed:delete");
    };
  }, [baseUrl, userId]);

  return socketRef;
}
