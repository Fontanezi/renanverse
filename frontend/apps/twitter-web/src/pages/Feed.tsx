import { useState, useCallback } from "react";
import { Feed, useFeed, useSocket } from "@renanverse-frontend/shared";
import type { Person, Activity, ApiClient } from "@renanverse-frontend/shared";
import { TweetComposer } from "../components/TweetComposer";

interface FeedPageProps {
  api: ApiClient;
  user: Person;
}

export function FeedPage({ api, user }: FeedPageProps) {
  const userId = user.id.split("/users/")[1];
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Activity | null>(null);

  const { items, loading, prepend, removeByUri } = useFeed(api.client, userId);

  const handleNewActivity = useCallback((activity: Activity) => {
    prepend(activity);
  }, [prepend]);

  const handleDeleteActivity = useCallback((data: { activityUri: string }) => {
    removeByUri(data.activityUri);
  }, [removeByUri]);

  useSocket(
    "",
    userId,
    handleNewActivity,
    undefined,
    handleDeleteActivity,
  );

  const handlePost = async (content: string, inReplyTo?: string) => {
    try {
      const activity = await api.activities.create(userId, {
        type: "Create",
        objectType: "Note",
        content,
        inReplyTo,
      });
      prepend(activity);
      setComposerOpen(false);
      setReplyTo(null);
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

  const handleReply = (activity: Activity) => {
    setReplyTo(activity);
    setComposerOpen(true);
  };

  return (
    <div>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #eee" }}>
        <button
          onClick={() => { setReplyTo(null); setComposerOpen(!composerOpen); }}
          style={{
            width: "100%",
            padding: "12px 20px",
            border: "2px dashed #1da1f2",
            borderRadius: 24,
            background: "#f7f9fa",
            color: "#1da1f2",
            fontSize: "1rem",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          {composerOpen ? "Cancelar" : "O que está acontecendo?"}
        </button>

        {composerOpen && (
          <div style={{ marginTop: 12 }}>
            {replyTo && (
              <p style={{ fontSize: "0.8125rem", color: "#888", marginBottom: 8 }}>
                Respondendo a @{replyTo.actor?.split("/users/")[1]}
              </p>
            )}
            <TweetComposer
              onSubmit={(c) => handlePost(c, replyTo?.id)}
              maxChars={280}
              placeholder="Digite seu tweet..."
            />
          </div>
        )}
      </div>

      <Feed
        items={items}
        loading={loading}
        onLike={handleLike}
        onShare={handleShare}
        onReply={handleReply}
        emptyMessage="Nenhum post no feed. Siga outros usuários para ver o que estão publicando!"
      />
    </div>
  );
}
