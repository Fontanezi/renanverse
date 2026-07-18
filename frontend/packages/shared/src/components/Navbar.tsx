interface NavbarProps {
  title: string;
  userId?: string;
  onLogout?: () => void;
}

export function Navbar({ title, userId, onLogout }: NavbarProps) {
  return (
    <nav style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "12px 24px",
      borderBottom: "1px solid #e0e0e0",
      background: "#fff",
    }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>{title}</h1>
        <a href="/" style={{ fontSize: "0.875rem", color: "#1a73e8", textDecoration: "none" }}>Início</a>
        <a href="/explore" style={{ fontSize: "0.875rem", color: "#1a73e8", textDecoration: "none" }}>Explorar</a>
        <a href="/profile" style={{ fontSize: "0.875rem", color: "#1a73e8", textDecoration: "none" }}>Perfil</a>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {userId && <span style={{ fontSize: "0.875rem", color: "#666" }}>{userId}</span>}
        {onLogout && (
          <button onClick={onLogout} style={{
            padding: "6px 16px",
            border: "1px solid #ccc",
            borderRadius: 6,
            background: "#fff",
            cursor: "pointer",
          }}>
            Sair
          </button>
        )}
      </div>
    </nav>
  );
}
