import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { normalizeDshBaseUrl, probeDsh } from "../src/dsh/probe.ts";

const servers: Server[] = [];
const websocketServers: WebSocketServer[] = [];

afterEach(async () => {
  for (const wss of websocketServers.splice(0))
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("probeDsh", () => {
  it("recognizes the DSH multiplexed remote.mux WebSocket and $events ready frame", async () => {
    const baseUrl = await startFixture(true, "/fixture-home");

    await expect(probeDsh(baseUrl)).resolves.toMatchObject({
      kind: "dsh",
      baseUrl,
      description: { home: "/fixture-home" },
    });
  });

  it("does not recognize an endpoint when remote.mux is missing", async () => {
    const baseUrl = await startFixture(false, "/fixture-home");

    await expect(probeDsh(baseUrl)).resolves.toMatchObject({
      kind: "not-dsh",
      baseUrl,
    });
  });

  it("passes the cookie header in the WebSocket upgrade when provided", async () => {
    const baseUrl = await startFixture(true, "/fixture-home", "test-cookie-value");

    await expect(probeDsh(baseUrl, 3_000, "test-cookie-value")).resolves.toMatchObject({
      kind: "dsh",
      baseUrl,
      description: { home: "/fixture-home" },
    });
  });

  it("rejects when the server requires a cookie but none is provided", async () => {
    const baseUrl = await startFixture(true, "/fixture-home", "test-cookie-value");

    await expect(probeDsh(baseUrl)).resolves.toMatchObject({
      kind: "not-dsh",
      baseUrl,
    });
  });

  it("rejects credentials and non-root paths in external URLs", () => {
    expect(() =>
      normalizeDshBaseUrl("https://user:secret@example.com:3080"),
    ).toThrow(/用户名或密码/u);
    expect(() => normalizeDshBaseUrl("https://example.com:3080/dsh")).toThrow(
      /根路径/u,
    );
  });
});

/**
 * Start a fixture server that either accepts /api/remote.mux upgrades and
 * delivers the $events ready frame (when serveMux=true), or rejects all
 * upgrades (when serveMux=false). When requireCookie is set, the upgrade is
 * rejected unless the Cookie header matches.
 */
async function startFixture(
  serveMux: boolean,
  home: string,
  requireCookie?: string,
): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (!serveMux || request.url !== "/api/remote.mux") {
      socket.destroy();
      return;
    }
    if (requireCookie !== undefined) {
      const cookie = request.headers.cookie;
      if (cookie !== requireCookie) {
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(request, socket, head, (ws) =>
      wss.emit("connection", ws, request),
    );
  });
  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as {
        type: string;
        streamId: string;
        endpoint: string;
      };
      if (message.type === "open" && message.endpoint === "$events") {
        // Send the ready item.
        ws.send(
          JSON.stringify({
            type: "item",
            streamId: message.streamId,
            value: {
              type: "ready",
              clientId: "fixture-client",
              host: { home },
            },
          }),
        );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  websocketServers.push(wss);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}
