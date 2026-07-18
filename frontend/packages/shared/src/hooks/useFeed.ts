import { useState, useEffect, useCallback, useRef } from "react";
import type { Activity } from "../types";
import type { RawClient } from "../api/client";

export function useFeed(client: RawClient, userId: string | null) {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [feedRes, outboxRes] = await Promise.all([
        client.get<{ orderedItems: Activity[] }>(`/users/${userId}/feed`),
        client.get<{ orderedItems: Activity[] }>(`/users/${userId}/outbox`),
      ]);
      const feed = feedRes.orderedItems ?? [];
      const selfPosts = outboxRes.orderedItems ?? [];
      const seen = new Set<string>();
      const merged: Activity[] = [];
      for (const a of [...selfPosts, ...feed]) {
        if (a.id && !seen.has(a.id) && (a.type === "Create" || a.type === "Announce")) {
          seen.add(a.id);
          merged.push(a);
        }
      }
      setItems(merged);
    } finally {
      setLoading(false);
    }
  }, [client, userId]);

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  const prepend = useCallback((activity: Activity) => {
    setItems((prev) => [activity, ...prev]);
  }, []);

  const removeByUri = useCallback((activityUri: string) => {
    setItems((prev) => prev.filter((a) => a.id !== activityUri));
  }, []);

  return { items, loading, refresh, prepend, removeByUri };
}
