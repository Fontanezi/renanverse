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

  useEffect(() => {
    api.activities.list(userId).then((res: FeedResponse) => {
      setPosts(res.orderedItems ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleDelete = async (uri: string) => {
    try {
      await api.activities.remove(userId, uri.split("/").pop()!);
      setPosts((prev) => prev.filter((a: any) => a.id !== uri));
    } catch (e) {
      alert("Erro ao excluir: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div>
      <div style={{ padding: "24px 24px 16px", borderBottom: "1px solid #eee" }}>
        <div style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          border: "3px solid #e1306c",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "2rem",
          marginBottom: 12,
        }}>
          {user.name[0]?.toUpperCase()}
        </div>
        <h2 style={{ margin: 0 }}>{user.name}</h2>
        <p style={{ margin: "4px 0", color: "#888" }}>@{user.preferredUsername}</p>
      </div>

      <h3 style={{ padding: "12px 24px", margin: 0, borderBottom: "1px solid #eee", fontSize: "1rem" }}>
        Suas publicações
      </h3>
      <Feed
        items={posts}
        loading={loading}
        onDelete={handleDelete}
        isOwn={true}
        actorNames={{ [user.id]: user.preferredUsername }}
        emptyMessage="Nenhuma publicação ainda."
      />
    </div>
  );
}
