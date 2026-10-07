import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "fs";

function copyAdminScripts() {
    return {
        name: "copy-admin-scripts",

        closeBundle() {
            const sourceDir = resolve(__dirname, "admin/js");
            const targetDir = resolve(__dirname, "dist/admin/js");

            mkdirSync(targetDir, { recursive: true });

            const files = readdirSync(sourceDir);

            for (const file of files) {
                const sourcePath = resolve(sourceDir, file);
                const targetPath = resolve(targetDir, file);

                if (statSync(sourcePath).isFile()) {
                    copyFileSync(sourcePath, targetPath);
                }
            }

            console.log("Admin JS files copied successfully.");
        }
    };
}

export default defineConfig({
    plugins: [
        copyAdminScripts()
    ],

    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, "index.html"),
                adminLogin: resolve(__dirname, "admin/login.html"),
                adminDashboard: resolve(__dirname, "admin/admin.html")
            }
        }
    }
});