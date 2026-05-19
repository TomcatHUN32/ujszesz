import { defineConfig, Plugin } from "vite";
import { miaodaDevPlugin } from "miaoda-sc-plugin";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import http from "http";

/**
 * API proxy plugin: a platform gateway express.json() middleware megeszi a
 * POST/PUT/PATCH body-ját mielőtt Vite-ra proxyzná, ezért a Vite proxy helyett
 * közvetlenül kezeljük a kéréseket. Az axios interceptor a body-t X-Body-Data
 * headerbe base64-kódolva is elküldi — ezt a plugin kicsomagolja és friss
 * http.request()-et küld a backendnek.
 */
function apiProxyPlugin(): Plugin {
  return {
    name: "api-proxy-direct",
    configureServer(server) {
      // /api/* kérések kezelése közvetlenül (Vite proxy helyett)
      server.middlewares.use("/api", (req, res) => {
        const bodyDataHeader = req.headers["x-body-data"] as string | undefined;
        let bodyBuffer: Buffer | null = null;
        if (bodyDataHeader) {
          try {
            bodyBuffer = Buffer.from(bodyDataHeader, "base64");
          } catch {
            // ha nem sikerül dekódolni, body nélkül küldjük
          }
        }

        // Fejlécek másolása (host és x-body-data kihagyásával)
        const forwardHeaders: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (key === "host" || key === "x-body-data") continue;
          if (value !== undefined) forwardHeaders[key] = value as string | string[];
        }
        forwardHeaders["content-type"] = "application/json";
        forwardHeaders["content-length"] = bodyBuffer
          ? String(bodyBuffer.length)
          : "0";

        const options: http.RequestOptions = {
          hostname: "localhost",
          port: 3001,
          // req.url a connect-ben már /api prefix nélküli (/auth/login stb.)
          path: `/api${req.url ?? "/"}`,
          method: req.method ?? "GET",
          headers: forwardHeaders,
        };

        const proxyReq = http.request(options, (proxyRes) => {
          const responseHeaders: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(proxyRes.headers)) {
            if (v !== undefined) responseHeaders[k] = v as string | string[];
          }
          res.writeHead(proxyRes.statusCode ?? 200, responseHeaders);
          proxyRes.pipe(res);
        });

        proxyReq.on("error", (err) => {
          console.error("[API Proxy] Backend hiba:", err.message);
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Backend nem elérhető" }));
          }
        });

        if (bodyBuffer && bodyBuffer.length > 0) {
          proxyReq.write(bodyBuffer);
        }
        proxyReq.end();
      });

      // /uploads/* statikus fájlok proxyzása a backendre
      server.middlewares.use("/uploads", (req, res) => {
        const options: http.RequestOptions = {
          hostname: "localhost",
          port: 3001,
          path: `/uploads${req.url ?? "/"}`,
          method: "GET",
        };
        const proxyReq = http.request(options, (proxyRes) => {
          const responseHeaders: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(proxyRes.headers)) {
            if (v !== undefined) responseHeaders[k] = v as string | string[];
          }
          res.writeHead(proxyRes.statusCode ?? 200, responseHeaders);
          proxyRes.pipe(res);
        });
        proxyReq.on("error", () => {
          if (!res.headersSent) res.writeHead(404).end();
        });
        proxyReq.end();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    miaodaDevPlugin(),
    apiProxyPlugin(),
    svgr({
      svgrOptions: {
        icon: true,
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // /socket.io proxyzása a backendre (WebSocket)
    proxy: {
      "/socket.io": {
        target: "http://localhost:3001",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
