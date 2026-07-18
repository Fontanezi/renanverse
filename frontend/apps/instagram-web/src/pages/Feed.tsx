import { useState, useCallback, useRef } from "react";
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
  const [editing, setEditing] = useState<Activity | null>(null);
  const [saving, setSaving] = useState(false);
  const editingRef = useRef<Activity | null>(null);

  const { items, loading, prepend, removeByUri } = useFeed(api.client, userId);

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

  const handleEdit = async (attachmentUrl: string, caption?: string) => {
    if (!editing?.id) return;
    setSaving(true);
    try {
      const id = editing.id.split("/").pop()!;
      const updated = await api.activities.update(userId, id, {
        content: caption,
        attachmentUrl,
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
  };

  const handleShare = async (uri: string) => {
    await api.activities.announce(userId, uri);
  };

  const handleEditClick = (activity: Activity) => {
    setEditing(activity);
    editingRef.current = activity;
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
          onClick={() => { setEditing(null); setComposerOpen(!composerOpen); }}
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
          {composerOpen ? "Cancelar" : editing ? "Editando..." : "Nova publicação"}
        </button>

        {composerOpen && (
          <div style={{ marginTop: 12 }}>
            {editing ? (
              <PostComposer
                onSubmit={(url, caption) => handleEdit(url, caption)}
                initialUrl={editing.object?.attachment ?? editing.object?.attachmentUrl}
                initialCaption={editing.object?.content}
                editingId={editing.id}
                disabled={saving}
              />
            ) : (
              <PostComposer onSubmit={handlePost} />
            )}
          </div>
        )}
      </div>

      <Feed
        items={items}
        loading={loading}
        onLike={handleLike}
        onShare={handleShare}
        onEdit={handleEditClick}
        onDelete={handleDelete}
        isOwn={true}
        emptyMessage="Nenhuma foto no feed. Siga outros usuários!"
      />
    </div>
  );
}
