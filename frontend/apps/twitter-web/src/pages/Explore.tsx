import { FollowForm } from "@renanverse-frontend/shared";
import type { ApiClient, Person } from "@renanverse-frontend/shared";

interface ExplorePageProps {
  api: ApiClient;
  user: Person;
}

export function ExplorePage({ api, user }: ExplorePageProps) {
  const userId = user.id.split("/users/")[1];
  const userHandle = `${user.preferredUsername}@localhost:3001`;

  const handleFollow = async (handle: string) => {
    await api.users.follow(userId, { handle });
  };

  return (
    <div>
      <div style={{
        padding: "16px 24px",
        borderBottom: "1px solid #eee",
        fontSize: "1.25rem",
        fontWeight: 700,
      }}>
        Explorar
      </div>

      <div style={{
        padding: "12px 24px",
        background: "#f0f7ff",
        borderBottom: "1px solid #d0e3f7",
        fontSize: "0.875rem",
      }}>
        Seu handle: <strong>{userHandle}</strong>
        <span style={{ color: "#666", marginLeft: 8 }}>
          — compartilhe com outros usuários para eles te seguirem
        </span>
      </div>

      <FollowForm onFollow={handleFollow} backendPort="3001" />

      <div style={{ padding: "16px 24px", color: "#888", fontSize: "0.875rem", lineHeight: 1.6 }}>
        <p><strong>Para testar a federação:</strong></p>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li>Crie um usuário em outra plataforma (Instagram na porta 3002, Reddit na 3003)</li>
          <li>Copie o handle que aparece no /explore da outra plataforma</li>
          <li>Cole aqui no campo acima e clique em Seguir</li>
          <li>As publicações daquele usuário aparecerão no seu feed em tempo real</li>
        </ol>
      </div>
    </div>
  );
}
