import { useState } from "react";

interface PostComposerProps {
  onSubmit: (attachmentUrl: string, caption?: string, inReplyTo?: string) => void;
  initialUrl?: string;
  initialCaption?: string;
  editingId?: string;
  disabled?: boolean;
  replyToHandle?: string;
}

export function PostComposer({ onSubmit, initialUrl, initialCaption, editingId, disabled }: PostComposerProps) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [caption, setCaption] = useState(initialCaption ?? "");

  const handleSubmit = () => {
    if (!url.trim()) return;
    onSubmit(url.trim(), caption.trim() || undefined);
    if (!editingId) {
      setUrl("");
      setCaption("");
    }
  };

  return (
    <div>
      {editingId && (
        <p style={{ fontSize: "0.8125rem", color: "#888", marginBottom: 8 }}>
          Editando publicação
        </p>
      )}
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL da imagem..."
        required
        style={inputStyle}
      />
      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="Legenda (opcional)"
        rows={2}
        style={{ ...inputStyle, resize: "none", marginTop: 8 }}
      />
      {url.trim() && (
        <div style={{ margin: "8px 0" }}>
          <img
            src={url.trim()}
            alt="preview"
            style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 8 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      )}
      <button
        onClick={handleSubmit}
        disabled={disabled || !url.trim()}
        style={{
          width: "100%",
          padding: "10px",
          marginTop: 8,
          border: "none",
          borderRadius: 8,
          background: url.trim() ? "#e1306c" : "#ccc",
          color: "#fff",
          fontWeight: 600,
          cursor: url.trim() ? "pointer" : "default",
        }}
      >
        {editingId ? "Salvar" : "Publicar"}
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  border: "1px solid #ddd",
  borderRadius: 8,
  fontSize: "0.9375rem",
  boxSizing: "border-box",
};
