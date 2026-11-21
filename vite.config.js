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
        host: "0.0.0.0",
        port: 3000,
        allowedHosts: true,
        hmr: false,
        ws: false
    },

    preview: {
        host: "0.0.0.0",
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
                adminLogin: resolve("admin/login.html"),
                adminDashboard: resolve("admin/admin.html")
            }
        }
    }
});
