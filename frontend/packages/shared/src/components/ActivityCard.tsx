import { useState, useCallback } from "react";
import type { Activity } from "../types";

interface ActivityCardProps {
  activity: Activity;
  onLike?: (uri: string) => void;
  onUnlike?: (uri: string) => void;
  onShare?: (uri: string) => void;
  onReply?: (activity: Activity) => void;
  onEdit?: (activity: Activity) => void;
  onDelete?: (uri: string) => void;
  isOwn?: boolean;
  actorNames?: Record<string, string>;
  isReply?: boolean;
  replyingToName?: string;
  likedUris?: Set<string>;
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

function PostBody({ obj, attachmentUrl, compact }: { obj: Activity["object"]; attachmentUrl?: string; compact?: boolean }) {
  const fontSize = compact ? "0.8125rem" : "0.9375rem";
  return (
    <div style={{ fontSize, lineHeight: 1.5 }}>
      {obj?.content && <p style={{ margin: "4px 0" }}>{renderContent(obj.content)}</p>}
      {!obj?.content && obj?.title && <h3 style={{ margin: "4px 0", fontSize }}>{obj.title}</h3>}
      {attachmentUrl && (
        <div style={{ margin: "8px 0" }}>
          {obj.type === "Image" ? (
            <img
              src={attachmentUrl}
              alt="post attachment"
              style={{ maxWidth: "100%", maxHeight: compact ? 250 : 400, borderRadius: 12 }}
            />
          ) : (
            <a
              href={attachmentUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#1a73e8", wordBreak: "break-all", fontSize }}
            >
              {attachmentUrl}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function ActivityCard({ activity, onLike, onUnlike, onShare, onReply, onEdit, onDelete, isOwn, actorNames, isReply, replyingToName, likedUris }: ActivityCardProps) {
  const obj = activity.object;
  const actorUri = activity.actor;
  const actorId = actorUri?.split("/users/")[1] ?? actorUri;
  const displayName = activity.actorName ?? actorNames?.[actorUri ?? ""] ?? (actorUri ? actorUri.split("//")[1] ?? actorUri : actorId);
  const attachmentUrl = obj?.attachment ?? obj?.attachmentUrl;
  const isLiked = !!(activity.id && likedUris?.has(activity.id));
  const [animatingLike, setAnimatingLike] = useState(false);
  const [shared, setShared] = useState(false);
  const showLiked = animatingLike ? !isLiked : isLiked;

  const handleLike = useCallback(() => {
    if (!activity.id) return;
    setAnimatingLike(true);
    setTimeout(() => setAnimatingLike(false), 600);
    if (isLiked) {
      onUnlike?.(activity.id);
    } else {
      onLike?.(activity.id);
    }
  }, [onLike, onUnlike, activity.id, isLiked]);

  const handleShare = useCallback(() => {
    if (!onShare || !activity.id) return;
    onShare(activity.id);
    setShared(true);
    setTimeout(() => setShared(false), 600);
  }, [onShare, activity.id]);

  const articlePadding = isReply ? "10px 16px" : "16px 24px";
  const avatarSize = isReply ? 28 : 36;
  const avatarFont = isReply ? "0.7rem" : "0.875rem";
  const nameFont = isReply ? "0.8rem" : "0.875rem";
  const dateFont = isReply ? "0.65rem" : "0.75rem";

  const isRepost = activity.type === "Announce";
  if (isRepost) {
    const repostOf = activity.repostOf;
    const repostDisplayName = activity.actorName ?? actorNames?.[repostOf ?? ""] ?? (repostOf ? repostOf.split("//")[1] ?? repostOf : "");
    return (
      <article style={{
        padding: "12px 24px",
        borderBottom: "1px solid #eee",
      }}>
        {replyingToName && (
          <p style={{ fontSize: "0.75rem", color: "#888", marginBottom: 6 }}>
            Respondendo a @{replyingToName}
          </p>
        )}
        <div style={{
          fontSize: "0.75rem",
          color: "#ff4500",
          fontWeight: 600,
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}>
          🔁 @{displayName} repostou
        </div>
        <div style={{
          border: "1px solid #e0e0e0",
          borderRadius: 12,
          padding: "12px 16px",
          background: "#fafafa",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <div style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "#ddd",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: "0.7rem",
            }}>
              {repostDisplayName?.[0]?.toUpperCase() ?? "?"}
            </div>
            <strong style={{ fontSize: "0.8rem" }}>@{repostDisplayName}</strong>
            <span style={{ fontSize: "0.65rem", color: "#888", marginLeft: 4 }}>
              {activity.published ? new Date(activity.published).toLocaleString() : ""}
            </span>
          </div>
          <PostBody obj={obj} attachmentUrl={attachmentUrl} compact />
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 12 }}>
          {onReply && activity.id && (
            <button onClick={() => onReply(activity)} style={btnStyle}>
              💬 Reply
            </button>
          )}
          {(onLike || onUnlike) && activity.id && (
            <button
              onClick={handleLike}
              style={{
                ...btnStyle,
                color: showLiked ? "#e1306c" : "#666",
                transform: showLiked ? "scale(1.3)" : "scale(1)",
                transition: "all 0.2s ease",
              }}
            >
              {showLiked ? "❤️" : "🤍"} Like
            </button>
          )}
          {onDelete && isOwn && (
            <button onClick={() => onDelete(activity.id!)} style={{ ...btnStyle, color: "#d32f2f" }}>
              🗑️ Desfazer repost
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <article style={{
      padding: articlePadding,
      borderBottom: "1px solid #eee",
    }}>
      {replyingToName && (
        <p style={{ fontSize: "0.75rem", color: "#888", marginBottom: 6 }}>
          Respondendo a @{replyingToName}
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{
          width: avatarSize,
          height: avatarSize,
          borderRadius: "50%",
          background: "#ddd",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: avatarFont,
        }}>
          {displayName?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div>
          <strong style={{ fontSize: nameFont }}>@{displayName}</strong>
          <span style={{ fontSize: dateFont, color: "#888", marginLeft: 8 }}>
            {activity.published ? new Date(activity.published).toLocaleString() : ""}
          </span>
        </div>
      </div>

      <PostBody obj={obj} attachmentUrl={attachmentUrl} compact={isReply} />

      <div style={{ display: "flex", gap: 24, marginTop: 12 }}>
        {onReply && activity.id && (
          <button onClick={() => onReply(activity)} style={btnStyle}>
            💬 Reply
          </button>
        )}
        {(onLike || onUnlike) && activity.id && (
          <button
            onClick={handleLike}
            style={{
              ...btnStyle,
              color: showLiked ? "#e1306c" : "#666",
              transform: showLiked ? "scale(1.3)" : "scale(1)",
              transition: "all 0.2s ease",
            }}
          >
            {showLiked ? "❤️" : "🤍"} Like
          </button>
        )}
        {onShare && activity.id && (
          <button
            onClick={handleShare}
            style={{
              ...btnStyle,
              color: shared ? "#1a8d1a" : "#666",
              transform: shared ? "scale(1.3)" : "scale(1)",
              transition: "all 0.2s ease",
            }}
          >
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
