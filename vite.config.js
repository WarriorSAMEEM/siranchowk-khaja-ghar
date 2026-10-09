import { defineConfig } from "vite";
import { resolve } from "node:path";
import {
    copyFileSync,
    mkdirSync,
    readdirSync,
    statSync,
} from "node:fs";

function copyAdminScripts() {
    return {
        name: "copy-admin-scripts",

        closeBundle() {
            const sourceDir = resolve("admin/js");
            const targetDir = resolve("dist/admin/js");

            mkdirSync(targetDir, { recursive: true });

            for (const file of readdirSync(sourceDir)) {
                const sourcePath = resolve(sourceDir, file);
                const targetPath = resolve(targetDir, file);

                if (statSync(sourcePath).isFile()) {
                    copyFileSync(sourcePath, targetPath);
                }
            }

            console.log("Admin JS files copied successfully.");
        },
    };
}

export default defineConfig({
    plugins: [copyAdminScripts()],

    build: {
        rollupOptions: {
            input: {
                main: resolve("index.html"),
                menu: resolve("menu.html"),
                about: resolve("about.html"),
                contact: resolve("contact.html"),
                adminLogin: resolve("admin/login.html"),
                adminDashboard: resolve("admin/admin.html"),
            },
        },
    },
});