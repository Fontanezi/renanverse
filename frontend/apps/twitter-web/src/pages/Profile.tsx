import { useState, useEffect } from "react";
import { Feed } from "@renanverse-frontend/shared";
import type { Person, ApiClient, FeedResponse } from "@renanverse-frontend/shared";

interface ProfilePageProps {
  api: ApiClient;
  user: Person;
}

export function ProfilePage({ api, user }: ProfilePageProps) {
  const userId = user.id.split("/users/")[1];
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState<any[]>([]);
  const [loadingLiked, setLoadingLiked] = useState(true);

  useEffect(() => {
    api.activities.list(userId).then((res: FeedResponse) => {
      setPosts(res.orderedItems ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.activities.liked(userId).then((res: FeedResponse) => {
      setLiked(res.orderedItems ?? []);
      setLoadingLiked(false);
    }).catch(() => setLoadingLiked(false));
  }, []);

  const likedUris = new Set(liked.map((a: any) => a.id!).filter(Boolean));

  const handleDelete = async (uri: string) => {
    try {
      await api.activities.remove(userId, uri.split("/").pop()!);
      setPosts((prev) => prev.filter((a: any) => a.id !== uri));
    } catch (e) {
      alert("Erro ao excluir: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleUnlike = async (uri: string) => {
    try {
      await api.activities.unlike(userId, uri);
      setLiked((prev) => prev.filter((a: any) => a.id !== uri));
    } catch (e) {
      alert("Erro ao remover like: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const actorNames = { [user.id]: user.preferredUsername };

  return (
    <div>
      <div style={{
        padding: "24px 24px 16px",
        borderBottom: "1px solid #eee",
      }}>
        <div style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "#1da1f2",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: "1.5rem",
          fontWeight: 700,
          marginBottom: 12,
        }}>
          {user.name[0]?.toUpperCase()}
        </div>
        <h2 style={{ margin: 0 }}>{user.name}</h2>
        <p style={{ margin: "4px 0", color: "#888" }}>@{user.preferredUsername}</p>
        {user.summary && <p style={{ margin: "8px 0", color: "#555" }}>{user.summary}</p>}
      </div>

      <h3 style={{ padding: "12px 24px", margin: 0, borderBottom: "1px solid #eee", fontSize: "1rem" }}>
        Seus posts
      </h3>
      <Feed
        items={posts}
        loading={loading}
        onDelete={handleDelete}
        userUri={user.id}
        likedUris={likedUris}
        actorNames={actorNames}
        emptyMessage="Você ainda não publicou nada."
      />

      <h3 style={{ padding: "12px 24px", margin: 0, borderBottom: "1px solid #eee", fontSize: "1rem", borderTop: "8px solid #f0f0f0" }}>
        Posts curtidos
      </h3>
      <Feed
        items={liked}
        loading={loadingLiked}
        userUri={user.id}
        onUnlike={handleUnlike}
        likedUris={likedUris}
        actorNames={actorNames}
        emptyMessage="Nenhum post curtido ainda."
      />
    </div>
  );
}
