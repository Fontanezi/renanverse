import { useState } from "react";

interface PostComposerProps {
  onSubmit: (input: {
    title: string;
    content?: string;
    attachmentUrl?: string;
    objectType: "Link" | "Page";
  }) => void;
  initialTitle?: string;
  initialContent?: string;
  initialUrl?: string;
  editingId?: string;
  disabled?: boolean;
}

export function PostComposer({ onSubmit, initialTitle, initialContent, initialUrl, editingId, disabled }: PostComposerProps) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [content, setContent] = useState(initialContent ?? "");
  const [url, setUrl] = useState(initialUrl ?? "");
  const [type, setType] = useState<"Page" | "Link">(initialUrl ? "Link" : "Page");

  const canSubmit = title.trim() && (type === "Page" || url.trim());

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      content: content.trim() || undefined,
      attachmentUrl: url.trim() || undefined,
      objectType: type,
    });
    if (!editingId) {
      setTitle("");
      setContent("");
      setUrl("");
      setType("Page");
    }
  };

  return (
    <div>
      {editingId && (
        <p style={{ fontSize: "0.8125rem", color: "#888", marginBottom: 8 }}>
          Editando post
        </p>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          onClick={() => setType("Page")}
          style={{
            flex: 1, padding: "8px", border: "none", borderRadius: 6,
            background: type === "Page" ? "#ff4500" : "#eee",
            color: type === "Page" ? "#fff" : "#333",
            fontWeight: 600, cursor: "pointer",
          }}
        >
          Texto
        </button>
        <button
          onClick={() => setType("Link")}
          style={{
            flex: 1, padding: "8px", border: "none", borderRadius: 6,
            background: type === "Link" ? "#ff4500" : "#eee",
            color: type === "Link" ? "#fff" : "#333",
            fontWeight: 600, cursor: "pointer",
          }}
        >
          Link
        </button>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título (obrigatório)"
        style={inputStyle}
      />

      {type === "Page" && (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Texto do post (opcional)"
          rows={4}
          style={{ ...inputStyle, resize: "none", marginTop: 8 }}
        />
      )}

      {type === "Link" && (
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="URL do link (obrigatório)"
          style={{ ...inputStyle, marginTop: 8 }}
        />
      )}

      <button
        onClick={handleSubmit}
        disabled={disabled || !canSubmit}
        style={{
          width: "100%", padding: 10, marginTop: 12,
          border: "none", borderRadius: 8,
          background: canSubmit ? "#ff4500" : "#ccc",
          color: "#fff", fontWeight: 600,
          cursor: canSubmit ? "pointer" : "default",
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
