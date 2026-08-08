import http from "node:http";
import { pathToFileURL } from "node:url";

export function createGateway({ canonicalPort = 17333 } = {}) {
  return http.createServer((request, response) => {
    const host = request.headers.host ?? "";

    if (host === `skills.localhost:${canonicalPort}` && request.url === "/") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("skills home");
      return;
    }

    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("default admin home");
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST ?? "0.0.0.0";
  const port = Number(process.env.PORT ?? 17333);
  const server = createGateway();

  server.listen(port, host, () => {
    console.log(`Listening on http://${host}:${port}`);
  });
}
