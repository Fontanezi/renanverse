import type { Activity } from "../types";
import { ActivityCard } from "./ActivityCard";

interface FeedProps {
  items: Activity[];
  loading?: boolean;
  onLike?: (uri: string) => void;
  onShare?: (uri: string) => void;
  onReply?: (activity: Activity) => void;
  emptyMessage?: string;
}

export function Feed({ items, loading, onLike, onShare, onReply, emptyMessage }: FeedProps) {
  if (loading) {
    return <div style={{ padding: 24, textAlign: "center", color: "#888" }}>Carregando...</div>;
  }

  if (!items.length) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#888" }}>
        {emptyMessage ?? "Nenhum post no feed."}
      </div>
    );
  }

  return (
    <div>
      {items.map((activity) => (
        <ActivityCard
          key={activity.id}
          activity={activity}
          onLike={onLike}
          onShare={onShare}
          onReply={onReply}
        />
      ))}
    </div>
  );
}
