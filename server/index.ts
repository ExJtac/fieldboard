import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { openDb, migrate } from "./db.ts";
import { createApp, errorHandler } from "./app.ts";
const production = process.env.NODE_ENV === "production";
if (
  production &&
  (!process.env.APP_ORIGIN?.startsWith("https://") || !process.env.SETUP_TOKEN)
)
  throw new Error("Production requires APP_ORIGIN=https://... and SETUP_TOKEN");
const db = await openDb(process.env.DATABASE_URL);
await migrate(db);
const app = createApp(db, {
  production,
  origin: process.env.APP_ORIGIN,
  setupToken: process.env.SETUP_TOKEN,
});
const server = createServer(app);
const port = Number(process.env.PORT || 4310);
if (production || process.argv.includes("--preview")) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use(errorHandler);
server.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `Fieldboard ready at http://${process.env.HOST || "127.0.0.1"}:${port}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await db.close();
      process.exit(0);
    }),
  );
