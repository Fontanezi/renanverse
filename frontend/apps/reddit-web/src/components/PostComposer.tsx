import { useState } from "react";

interface PostComposerProps {
  onSubmit: (input: { title: string; attachmentUrl: string }) => void;
  initialTitle?: string;
  initialUrl?: string;
  editingId?: string;
  disabled?: boolean;
}

export function PostComposer({ onSubmit, initialTitle, initialUrl, editingId, disabled }: PostComposerProps) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [url, setUrl] = useState(initialUrl ?? "");

  const canSubmit = title.trim() && url.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      attachmentUrl: url.trim(),
    });
    if (!editingId) {
      setTitle("");
      setUrl("");
    }
  };

  return (
    <div>
      {editingId && (
        <p style={{ fontSize: "0.8125rem", color: "#888", marginBottom: 8 }}>
          Editando post
        </p>
      )}

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título (obrigatório)"
        style={inputStyle}
      />

      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL do link (obrigatório)"
        style={{ ...inputStyle, marginTop: 8 }}
      />

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
