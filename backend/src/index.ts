import "dotenv/config";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 4000);
// Optional - unset (default "0.0.0.0") preserves today's behavior. The IIS
// deployment (see /iis_deployment.md) sets HOST=127.0.0.1 so this service is
// only reachable through the IIS reverse proxy, not directly from outside.
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp();

app.listen(port, host, () => {
  console.log(`Budgeting System API listening on http://${host}:${port}`);
});
