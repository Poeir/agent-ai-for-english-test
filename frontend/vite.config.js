import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ command }) => ({
    plugins: [react()],
    base: "/ui/",
    server: {
        fs: {
            strict: false,
        },
        proxy: {
            "/api": "http://localhost:8000",
        },
    },
}));
