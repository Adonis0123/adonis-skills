import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createGateway } from "./server.mjs";

function request(server, { host, path }) {
  const address = server.address();

  return new Promise((resolve, reject) => {
    const clientRequest = http.request(
      {
        host: "127.0.0.1",
        port: address.port,
        path,
        headers: { host },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({ body, statusCode: response.statusCode });
        });
      },
    );

    clientRequest.on("error", reject);
    clientRequest.end();
  });
}

test("serves the existing skills surface", async (context) => {
  const server = createGateway();
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => server.close());

  const response = await request(server, {
    host: "skills.localhost:17333",
    path: "/",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "skills home");
});
