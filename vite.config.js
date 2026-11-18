import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
    server: {
        host: "127.0.0.1",
        port: 5173,
        strictPort: true
    },

    preview: {
        host: "127.0.0.1",
        port: 4173,
        strictPort: true
    },

    build: {
        rollupOptions: {
            input: {
                main: resolve("index.html"),
                account: resolve("account.html"),
                menu: resolve("menu.html"),
                about: resolve("about.html"),
                contact: resolve("contact.html"),
                adminLogin: resolve("admin/login.html"),
                adminDashboard: resolve("admin/admin.html")
            }
        }
    }
});
