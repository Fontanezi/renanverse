import type { Activity } from "../types";

interface ActivityCardProps {
  activity: Activity;
  onLike?: (uri: string) => void;
  onShare?: (uri: string) => void;
  onReply?: (activity: Activity) => void;
  onEdit?: (activity: Activity) => void;
  onDelete?: (uri: string) => void;
  isOwn?: boolean;
  actorNames?: Record<string, string>;
}

function renderContent(text: string) {
  if (!text) return null;
  const parts = text.split(/(@\S+?@\S+[^\s]*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@") && part.includes("@", 1) && part.split("@").length === 3) {
      return (
        <a
          key={i}
          href="#"
          style={{ color: "#1a73e8", textDecoration: "none" }}
          onClick={(e) => {
            e.preventDefault();
            try { navigator.clipboard?.writeText(part); } catch {}
          }}
          title="Copiar handle"
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function ActivityCard({ activity, onLike, onShare, onReply, onEdit, onDelete, isOwn, actorNames }: ActivityCardProps) {
  const obj = activity.object;
  const actorUri = activity.actor;
  const actorId = actorUri?.split("/users/")[1] ?? actorUri;
  const displayName = actorNames?.[actorUri ?? ""] ?? (actorUri ? actorUri.split("//")[1] ?? actorUri : actorId);
  const attachmentUrl = obj?.attachment ?? obj?.attachmentUrl;

  return (
    <article style={{
      padding: "16px 24px",
      borderBottom: "1px solid #eee",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "#ddd",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: "0.875rem",
        }}>
          {displayName?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div>
          <strong style={{ fontSize: "0.875rem" }}>@{displayName}</strong>
          <span style={{ fontSize: "0.75rem", color: "#888", marginLeft: 8 }}>
            {activity.published ? new Date(activity.published).toLocaleString() : ""}
          </span>
        </div>
      </div>

      <div style={{ fontSize: "0.9375rem", lineHeight: 1.5 }}>
        {obj?.content && <p style={{ margin: "4px 0" }}>{renderContent(obj.content)}</p>}
        {obj?.title && <h3 style={{ margin: "4px 0" }}>{obj.title}</h3>}
        {attachmentUrl && (
          <div style={{ margin: "8px 0" }}>
            {obj.type === "Image" ? (
              <img
                src={attachmentUrl}
                alt="post attachment"
                style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 12 }}
              />
            ) : (
              <a
                href={attachmentUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#1a73e8", wordBreak: "break-all" }}
              >
                {attachmentUrl}
              </a>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 24, marginTop: 12 }}>
        {onReply && activity.id && (
          <button onClick={() => onReply(activity)} style={btnStyle}>
            💬 Reply
          </button>
        )}
        {onLike && activity.id && (
          <button onClick={() => onLike(activity.id!)} style={btnStyle}>
            ❤️ Like
          </button>
        )}
        {onShare && activity.id && (
          <button onClick={() => onShare(activity.id!)} style={btnStyle}>
            🔄 Share
          </button>
        )}
        {onEdit && isOwn && (
          <button onClick={() => onEdit(activity)} style={btnStyle}>
            ✏️ Editar
          </button>
        )}
        {onDelete && isOwn && (
          <button onClick={() => onDelete(activity.id!)} style={{ ...btnStyle, color: "#d32f2f" }}>
            🗑️ Excluir
          </button>
        )}
      </div>
    </article>
  );
}

const btnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: "0.8125rem",
  color: "#666",
  padding: "4px 8px",
  borderRadius: 4,
};
