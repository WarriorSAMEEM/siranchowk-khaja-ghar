import { defineConfig } from "vite";
import { resolve } from "node:path";
import fs from "node:fs";

function copyStaticProductionFiles() {
    return {
        name: "copy-static-production-files",
        closeBundle() {
            const outDir = resolve("dist");
            if (!fs.existsSync(outDir)) return;

            for (const rootFile of ["robots.txt", "sitemap.xml", "googlee1909774878b1cd5.html"]) {
                const src = resolve(rootFile);
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, resolve(outDir, rootFile));
                }
            }

            for (const dir of ["assets/icons", "assets/images", "assets/logo"]) {
                const srcDir = resolve(dir);
                if (fs.existsSync(srcDir)) {
                    fs.cpSync(srcDir, resolve(outDir, dir), { recursive: true });
                }
            }

            const manifestSrc = resolve("assets/site.webmanifest");
            if (fs.existsSync(manifestSrc)) {
                fs.mkdirSync(resolve(outDir, "assets"), { recursive: true });
                fs.copyFileSync(manifestSrc, resolve(outDir, "assets/site.webmanifest"));
            }
        }
    };
}

export default defineConfig({
    plugins: [copyStaticProductionFiles()],

    server: {
        host: "127.0.0.1",
        port: 3000,
        allowedHosts: ["localhost", "127.0.0.1"],
        hmr: false,
        ws: false
    },

    preview: {
        host: "127.0.0.1",
        port: 4173,
        strictPort: true
    },

    build: {
        sourcemap: false,
        rollupOptions: {
            input: {
                main: resolve("index.html"),
                account: resolve("account.html"),
                menu: resolve("menu.html"),
                about: resolve("about.html"),
                contact: resolve("contact.html"),
                explore: resolve("explore.html"),
                blog: resolve("blog.html"),
                article: resolve("article.html"),
                profile: resolve("profile.html"),
                creatorStudio: resolve("creator-studio.html"),
                adminLogin: resolve("admin/login.html"),
                adminDashboard: resolve("admin/admin.html")
            }
        }
    }
});
