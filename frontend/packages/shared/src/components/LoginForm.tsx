import { useState } from "react";

interface LoginFormProps {
  onSubmit: (username: string, name: string) => void;
  loading?: boolean;
}

export function LoginForm({ onSubmit, loading }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && name.trim()) {
      onSubmit(username.trim(), name.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{
      display: "flex",
      flexDirection: "column",
      gap: 16,
      maxWidth: 400,
      margin: "40px auto",
      padding: 24,
    }}>
      <h2 style={{ margin: 0, textAlign: "center" }}>Entrar no Renanverse</h2>
      <input
        placeholder="Nome de usuário"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
        style={inputStyle}
      />
      <input
        placeholder="Nome de exibição"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        style={inputStyle}
      />
      <button type="submit" disabled={loading} style={{
        padding: "10px 20px",
        border: "none",
        borderRadius: 8,
        background: "#1a73e8",
        color: "#fff",
        fontWeight: 600,
        cursor: "pointer",
        opacity: loading ? 0.7 : 1,
      }}>
        {loading ? "Criando..." : "Criar conta"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 14px",
  border: "1px solid #ddd",
  borderRadius: 8,
  fontSize: "1rem",
};
