import { useState } from "react";

interface FollowFormProps {
  onFollow: (handle: string) => Promise<void>;
  onUnfollow?: (handle: string) => Promise<void>;
  backendPort?: string;
}

export function FollowForm({ onFollow, onUnfollow, backendPort }: FollowFormProps) {
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handle.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      await onFollow(handle.trim());
      setResult({ ok: true, message: `✓ Agora você segue ${handle.trim()}` });
      setHandle("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      let display = msg;
      try {
        const parsed = JSON.parse(msg);
        if (parsed.error) display = parsed.error;
      } catch { /* not json */ }
      setResult({
        ok: false,
        message: `✗ ${display}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUnfollow = async () => {
    if (!onUnfollow || !handle.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      await onUnfollow(handle.trim());
      setResult({ ok: true, message: `✓ Você deixou de seguir ${handle.trim()}` });
      setHandle("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ ok: false, message: `✗ ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{
      padding: "16px 24px",
      borderBottom: "1px solid #eee",
    }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>Seguir usuário</h3>
      <p style={{ margin: "0 0 12px", fontSize: "0.8125rem", color: "#888", lineHeight: 1.5 }}>
        Digite o handle no formato <strong>usuario@endereco</strong>.
        {backendPort && (
          <span> Ex: <strong>alice@localhost:{backendPort}</strong></span>
        )}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder={backendPort ? `usuario@localhost:${backendPort}` : "usuario@host:porta"}
          style={{
            flex: 1,
            padding: "10px 14px",
            border: "1px solid #ddd",
            borderRadius: 8,
            fontSize: "0.9375rem",
          }}
        />
        <button
          type="submit"
          disabled={loading || !handle.trim()}
          style={{
            padding: "10px 20px",
            border: "none",
            borderRadius: 8,
            background: loading || !handle.trim() ? "#ccc" : "#1a73e8",
            color: "#fff",
            fontWeight: 600,
            cursor: loading || !handle.trim() ? "default" : "pointer",
          }}
        >
          {loading ? "Seguindo..." : "Seguir"}
        </button>
        {onUnfollow && handle.trim() && (
          <button
            type="button"
            onClick={handleUnfollow}
            disabled={loading}
            style={{
              padding: "10px 20px",
              border: "1px solid #d32f2f",
              borderRadius: 8,
              background: "#fff",
              color: "#d32f2f",
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
            }}
          >
            Deixar de seguir
          </button>
        )}
      </div>
      {result && (
        <p style={{
          margin: "8px 0 0",
          fontSize: "0.875rem",
          color: result.ok ? "#1a7d1a" : "#d32f2f",
          lineHeight: 1.4,
        }}>
          {result.message}
          {!result.ok && backendPort && (
            <span style={{ display: "block", marginTop: 4, color: "#888" }}>
              Dica: use a porta do backend (ex: <strong>localhost:{backendPort}</strong>),
              não a porta do front-end (Vite).
            </span>
          )}
        </p>
      )}
    </form>
  );
}
