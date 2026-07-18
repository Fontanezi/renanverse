import { useState, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { createApi, Navbar } from "@renanverse-frontend/shared";
import type { Person } from "@renanverse-frontend/shared";
import { LoginPage } from "./pages/Login";
import { FeedPage } from "./pages/Feed";
import { ProfilePage } from "./pages/Profile";
import { ExplorePage } from "./pages/Explore";

const api = createApi("");

export default function App() {
  const [user, setUser] = useState<Person | null>(() => {
    const stored = localStorage.getItem("instagram_user");
    return stored ? JSON.parse(stored) : null;
  });

  const handleLogin = useCallback((person: Person) => {
    setUser(person);
    localStorage.setItem("instagram_user", JSON.stringify(person));
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
    localStorage.removeItem("instagram_user");
  }, []);

  if (!user) {
    return <LoginPage api={api} onLogin={handleLogin} />;
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", minHeight: "100vh", borderLeft: "1px solid #eee", borderRight: "1px solid #eee" }}>
      <Navbar
        title="Renanverse"
        userId={user.preferredUsername}
        onLogout={handleLogout}
      />
      <Routes>
        <Route path="/" element={<FeedPage api={api} user={user} />} />
        <Route path="/explore" element={<ExplorePage api={api} user={user} />} />
        <Route path="/profile" element={<ProfilePage api={api} user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
