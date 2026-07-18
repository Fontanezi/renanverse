import { useState } from "react";

interface TweetComposerProps {
  onSubmit: (content: string) => void;
  maxChars: number;
  placeholder?: string;
  initialContent?: string;
  editingId?: string;
  disabled?: boolean;
}

export function TweetComposer({ onSubmit, maxChars, placeholder, initialContent, editingId, disabled }: TweetComposerProps) {
  const [text, setText] = useState(initialContent ?? "");
  const remaining = maxChars - text.length;
  const isOver = remaining < 0;

  const handleSubmit = () => {
    if (!text.trim() || isOver) return;
    onSubmit(text.trim());
    setText("");
  };

  return (
    <div>
      {editingId && (
        <p style={{ fontSize: "0.8125rem", color: "#888", marginBottom: 8 }}>
          Editando post
        </p>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? "Digite algo..."}
        rows={3}
        style={{
          width: "100%",
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 12,
          fontSize: "1rem",
          resize: "none",
          boxSizing: "border-box",
        }}
      />
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 8,
      }}>
        <span style={{
          fontSize: "0.8125rem",
          color: isOver ? "#e0245e" : remaining <= 20 ? "#ffad1f" : "#888",
          fontWeight: isOver ? 700 : 400,
        }}>
          {remaining}
        </span>
        <button
          onClick={handleSubmit}
          disabled={disabled || !text.trim() || isOver}
          style={{
            padding: "8px 20px",
            border: "none",
            borderRadius: 20,
            background: text.trim() && !isOver ? "#1da1f2" : "#ccc",
            color: "#fff",
            fontWeight: 600,
            cursor: text.trim() && !isOver ? "pointer" : "default",
          }}
        >
          {editingId ? "Salvar" : "Publicar"}
        </button>
      </div>
    </div>
  );
}
