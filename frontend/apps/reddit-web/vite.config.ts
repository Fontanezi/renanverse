import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      "/users": "http://localhost:3003",
      "/.well-known": "http://localhost:3003",
      "/socket.io": {
        target: "http://localhost:3003",
        ws: true,
      },
    },
  },
});
