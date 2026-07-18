import { useState } from "react";

interface PostComposerProps {
  onSubmit: (attachmentUrl: string, caption?: string) => void;
}

export function PostComposer({ onSubmit }: PostComposerProps) {
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");

  const handleSubmit = () => {
    if (!url.trim()) return;
    onSubmit(url.trim(), caption.trim() || undefined);
    setUrl("");
    setCaption("");
  };

  return (
    <div>
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
        disabled={!url.trim()}
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
        Publicar
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
