import { useState } from "react";
import { LoginForm } from "@renanverse-frontend/shared";
import type { Person, ApiClient } from "@renanverse-frontend/shared";

interface LoginPageProps {
  api: ApiClient;
  onLogin: (person: Person) => void;
}

export function LoginPage({ api, onLogin }: LoginPageProps) {
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (username: string, name: string) => {
    setLoading(true);
    try {
      const person = await api.users.create({ preferredUsername: username, name });
      onLogin(person);
    } catch (e) {
      alert("Erro ao criar usuário: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", paddingTop: 60 }}>
      <h1 style={{ textAlign: "center", fontSize: "2rem", marginBottom: 8 }}>🔴</h1>
      <p style={{ textAlign: "center", color: "#666", marginBottom: 24 }}>
        Entre no Renanverse Reddit
      </p>
      <LoginForm onSubmit={handleSubmit} loading={loading} />
    </div>
  );
}
