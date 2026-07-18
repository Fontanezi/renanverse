import { useState, useCallback, useRef, useEffect } from "react";
import { Feed, useFeed, useSocket } from "@renanverse-frontend/shared";
import type { Person, Activity, ApiClient, FeedResponse } from "@renanverse-frontend/shared";
import { PostComposer } from "../components/PostComposer";

interface FeedPageProps {
  api: ApiClient;
  user: Person;
}

export function FeedPage({ api, user }: FeedPageProps) {
  const userId = user.id.split("/users/")[1];
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Activity | null>(null);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [saving, setSaving] = useState(false);
  const editingRef = useRef<Activity | null>(null);

  const { items, loading, prepend, removeByUri } = useFeed(api.client, userId);
  const [likedUris, setLikedUris] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.activities.liked(userId).then((res: FeedResponse) => {
      setLikedUris(new Set((res.orderedItems ?? []).map((a) => a.id!).filter(Boolean)));
    }).catch(() => {});
  }, [userId]);

  const handleNewActivity = useCallback((activity: Activity) => {
    prepend(activity);
  }, [prepend]);

  const handleUpdateActivity = useCallback((activity: Activity) => {
    if (editingRef.current?.id === activity.id) return;
    removeByUri(activity.id!);
    prepend(activity);
  }, [prepend, removeByUri]);

  const handleDeleteActivity = useCallback((data: { activityUri: string }) => {
    removeByUri(data.activityUri);
  }, [removeByUri]);

  useSocket("", userId, handleNewActivity, handleUpdateActivity, handleDeleteActivity);

  const handlePost = async (input: {
    title: string;
    content?: string;
    attachmentUrl?: string;
    objectType: "Link" | "Page";
    inReplyTo?: string;
  }) => {
    try {
      const activity = await api.activities.create(userId, {
        type: "Create",
        objectType: input.objectType,
        title: input.title,
        content: input.content,
        attachmentUrl: input.attachmentUrl,
        inReplyTo: input.inReplyTo,
      });
      prepend(activity);
      setComposerOpen(false);
      setReplyTo(null);
    } catch (e) {
      alert("Erro ao publicar: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleEdit = async (input: {
    title: string;
    content?: string;
    attachmentUrl?: string;
    objectType: "Link" | "Page";
  }) => {
    if (!editing?.id) return;
    setSaving(true);
    try {
      const id = editing.id.split("/").pop()!;
      const updated = await api.activities.update(userId, id, {
        title: input.title,
        content: input.content,
        attachmentUrl: input.attachmentUrl,
      });
      removeByUri(editing.id);
      prepend(updated);
      setComposerOpen(false);
      setEditing(null);
    } catch (e) {
      alert("Erro ao editar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const handleLike = async (uri: string) => {
    await api.activities.like(userId, uri);
    setLikedUris((prev) => { const next = new Set(prev); next.add(uri); return next; });
  };

  const handleUnlike = async (uri: string) => {
    await api.activities.unlike(userId, uri);
    setLikedUris((prev) => { const next = new Set(prev); next.delete(uri); return next; });
  };

  const handleShare = async (uri: string) => {
    await api.activities.announce(userId, uri);
  };

  const handleReply = (activity: Activity) => {
    setReplyTo(activity);
    setEditing(null);
    setComposerOpen(true);
  };

  const handleEditClick = (activity: Activity) => {
    setEditing(activity);
    editingRef.current = activity;
    setReplyTo(null);
    setComposerOpen(true);
  };

  const handleDelete = async (uri: string) => {
    try {
      await api.activities.remove(userId, uri.split("/").pop()!);
      removeByUri(uri);
    } catch (e) {
      alert("Erro ao excluir: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid #eee" }}>
        <button
          onClick={() => { setReplyTo(null); setEditing(null); setComposerOpen(!composerOpen); }}
          style={{
            width: "100%",
            padding: "12px 20px",
            border: "2px dashed #ff4500",
            borderRadius: 8,
            background: "#fafbfc",
            color: "#ff4500",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          {composerOpen ? "Cancelar" : editing ? "Editando..." : "Criar post"}
        </button>

        {composerOpen && (
          <div style={{ marginTop: 12 }}>
            {replyTo && (
              <p style={{ fontSize: "0.8125rem", color: "#888", marginBottom: 8 }}>
                Respondendo a @{replyTo.actorName ?? replyTo.actor?.split("/")[1] ?? replyTo.actor}
              </p>
            )}
            {editing ? (
              <PostComposer
                onSubmit={handleEdit}
                initialTitle={editing.object?.title}
                initialContent={editing.object?.content}
                initialUrl={editing.object?.attachment ?? editing.object?.attachmentUrl}
                editingId={editing.id}
                disabled={saving}
              />
            ) : (
              <PostComposer
                onSubmit={(input) => handlePost({ ...input, inReplyTo: replyTo?.id })}
              />
            )}
          </div>
        )}
      </div>

      <Feed
        items={items}
        loading={loading}
        onLike={handleLike}
        onUnlike={handleUnlike}
        onShare={handleShare}
        onReply={handleReply}
        onEdit={handleEditClick}
        onDelete={handleDelete}
        userUri={user.id}
        likedUris={likedUris}
        actorNames={{ [user.id]: user.preferredUsername }}
        emptyMessage="Nada no feed. Siga outros usuários para ver posts aqui!"
      />
    </div>
  );
}
