import { useMemo } from "react";
import type { Activity } from "../types";
import { ActivityCard } from "./ActivityCard";

interface FeedProps {
  items: Activity[];
  loading?: boolean;
  onLike?: (uri: string) => void;
  onUnlike?: (uri: string) => void;
  onShare?: (uri: string) => void;
  onReply?: (activity: Activity) => void;
  onEdit?: (activity: Activity) => void;
  onDelete?: (uri: string) => void;
  emptyMessage?: string;
  actorNames?: Record<string, string>;
  userUri?: string;
  likedUris?: Set<string>;
}

function parentName(activity: Activity, actorNames: Record<string, string> | undefined, actorNameById: Map<string, string>): string | undefined {
  const parentId = activity.object?.inReplyTo;
  if (!parentId) return undefined;
  return actorNameById.get(parentId);
}

function childTree(items: Activity[], actorNames: Record<string, string> | undefined): { roots: Activity[]; childrenByParent: Map<string, Activity[]>; actorNameById: Map<string, string> } {
  const actorNameById = new Map<string, string>();
  for (const item of items) {
    if (item.id) {
      actorNameById.set(item.id, actorNames?.[item.actor] ?? item.actor.split("//")[1] ?? item.actor);
    }
  }

  const childrenByParent = new Map<string, Activity[]>();
  const roots: Activity[] = [];

  for (const item of items) {
    const parentId = item.object?.inReplyTo;
    if (parentId) {
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId)!.push(item);
    } else {
      roots.push(item);
    }
  }

  return { roots, childrenByParent, actorNameById };
}

export function Feed({ items, loading, onLike, onUnlike, onShare, onReply, onEdit, onDelete, emptyMessage, actorNames, userUri, likedUris }: FeedProps) {
  const { roots, childrenByParent, actorNameById } = useMemo(
    () => childTree(items, actorNames),
    [items, actorNames]
  );

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
      {roots.map((activity) => {
        const replies = activity.id ? childrenByParent.get(activity.id) : undefined;
        return (
          <div key={activity.id}>
            <ActivityCard
              activity={activity}
              onLike={onLike}
              onUnlike={onUnlike}
              onShare={onShare}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              isOwn={activity.actor === userUri}
              actorNames={actorNames}
              likedUris={likedUris}
            />
            {replies?.map((reply) => (
              <div key={reply.id} style={{
                marginLeft: 20,
                borderLeft: "2px solid #e0e0e0",
                paddingLeft: 16,
                background: "#fafafa",
              }}>
                <ActivityCard
                  activity={reply}
                  onLike={onLike}
                  onUnlike={onUnlike}
                  onShare={onShare}
                  onReply={onReply}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  isOwn={reply.actor === userUri}
                  actorNames={actorNames}
                  likedUris={likedUris}
                  isReply
                  replyingToName={parentName(reply, actorNames, actorNameById)}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
