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
      <Feed items={posts} loading={loading} emptyMessage="Você ainda não publicou nada." />
    </div>
  );
}
