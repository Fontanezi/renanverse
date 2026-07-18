import { useState, useEffect, useCallback } from "react";
import type { ApiClient } from "../api";

interface FollowRequestsProps {
  api: ApiClient;
  userId: string;
}

interface FollowerItem {
  actorUri: string;
  status: string;
}

export function FollowRequests({ api, userId }: FollowRequestsProps) {
  const [requests, setRequests] = useState<FollowerItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.users.getFollowers(userId);
      setRequests(res.items.filter((f) => f.status === "pending"));
    } catch {
      // ignore
    }
  }, [api, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAccept = async (actorUri: string) => {
    setLoading(true);
    try {
      await api.users.acceptFollower(userId, actorUri);
      setRequests((prev) => prev.filter((r) => r.actorUri !== actorUri));
    } catch (err) {
      console.error("Erro ao aceitar follow:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (actorUri: string) => {
    setLoading(true);
    try {
      await api.users.removeFollower(userId, { actorUri });
      setRequests((prev) => prev.filter((r) => r.actorUri !== actorUri));
    } catch (err) {
      console.error("Erro ao rejeitar follow:", err);
    } finally {
      setLoading(false);
    }
  };

  if (requests.length === 0) return null;

  return (
    <div style={{
      padding: "16px 24px",
      borderBottom: "1px solid #eee",
    }}>
      <h3 style={{ margin: "0 0 12px", fontSize: "1rem" }}>
        Solicitações de seguimento ({requests.length})
      </h3>
      {requests.map((r) => (
        <div key={r.actorUri} style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 0",
          borderBottom: "1px solid #f0f0f0",
        }}>
          <span style={{ fontSize: "0.875rem", fontFamily: "monospace" }}>
            @{r.actorUri.split("//")[1] || r.actorUri}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => handleAccept(r.actorUri)}
              disabled={loading}
              style={{
                padding: "6px 16px",
                border: "none",
                borderRadius: 6,
                background: loading ? "#ccc" : "#1a7d1a",
                color: "#fff",
                fontWeight: 600,
                cursor: loading ? "default" : "pointer",
                fontSize: "0.8125rem",
              }}
            >
              Aceitar
            </button>
            <button
              onClick={() => handleReject(r.actorUri)}
              disabled={loading}
              style={{
                padding: "6px 16px",
                border: "1px solid #d32f2f",
                borderRadius: 6,
                background: "#fff",
                color: "#d32f2f",
                fontWeight: 600,
                cursor: loading ? "default" : "pointer",
                fontSize: "0.8125rem",
              }}
            >
              Recusar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
