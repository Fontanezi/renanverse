import { useState, useCallback } from "react";
import { Feed, useFeed, useSocket } from "@renanverse-frontend/shared";
import type { Person, Activity, ApiClient } from "@renanverse-frontend/shared";
import { PostComposer } from "../components/PostComposer";

interface FeedPageProps {
  api: ApiClient;
  user: Person;
}

export function FeedPage({ api, user }: FeedPageProps) {
  const userId = user.id.split("/users/")[1];
  const [composerOpen, setComposerOpen] = useState(false);

  const { items, loading, prepend, removeByUri } = useFeed(api.client, userId);

  const handleNewActivity = useCallback((activity: Activity) => {
    prepend(activity);
  }, [prepend]);

  const handleDeleteActivity = useCallback((data: { activityUri: string }) => {
    removeByUri(data.activityUri);
  }, [removeByUri]);

  useSocket("", userId, handleNewActivity, undefined, handleDeleteActivity);

  const handlePost = async (attachmentUrl: string, caption?: string) => {
    try {
      const activity = await api.activities.create(userId, {
        type: "Create",
        objectType: "Image",
        content: caption,
        attachmentUrl,
      });
      prepend(activity);
      setComposerOpen(false);
    } catch (e) {
      alert("Erro ao publicar: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleLike = async (uri: string) => {
    await api.activities.like(userId, uri);
  };

  const handleShare = async (uri: string) => {
    await api.activities.announce(userId, uri);
  };

  return (
    <div>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #eee" }}>
        <button
          onClick={() => setComposerOpen(!composerOpen)}
          style={{
            width: "100%",
            padding: "12px 20px",
            border: "2px dashed #e1306c",
            borderRadius: 12,
            background: "#fafafa",
            color: "#e1306c",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          {composerOpen ? "Cancelar" : "Nova publicação"}
        </button>

        {composerOpen && (
          <div style={{ marginTop: 12 }}>
            <PostComposer onSubmit={handlePost} />
          </div>
        )}
      </div>

      <Feed
        items={items}
        loading={loading}
        onLike={handleLike}
        onShare={handleShare}
        emptyMessage="Nenhuma foto no feed. Siga outros usuários!"
      />
    </div>
  );
}
