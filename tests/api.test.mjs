import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../server/index.mjs";
const servers = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
});
const request = {
  messages: [{ role: "user", text: "Could I lose money?" }],
  context: { monthly: 500, years: 10, risk: "balanced" },
};
async function start(options) {
  const server = createApp(options).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    get: (path) => fetch(url + path),
    post: (body) =>
      fetch(url + "/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}
describe("coach API", () => {
  it("returns an honest educational guide when no key is configured", async () => {
    const client = await start({ hasKey: () => false });
    const response = await client.post(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.source).toBe("guided");
    expect(body.text).toContain("Investments can fall in value");
    expect(body.text).toContain("none of these example funds guarantees");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns a provider answer and passes only allowed conversation fields", async () => {
    let received;
    const client = await start({
      hasKey: () => true,
      requestBedrock: async (messages, context) => {
        received = { messages, context };
        return "Investments can fall in value.";
      },
    });
    const response = await client.post({
      ...request,
      messages: [
        { role: "assistant", text: "Old reply" },
        { role: "user", text: "Why risk?", extra: "not forwarded" },
      ],
    });
    expect(await response.json()).toEqual({
      text: "Investments can fall in value.",
      source: "bedrock",
    });
    expect(received.messages).toEqual([{ role: "user", text: "Why risk?" }]);
  });
  it("reports a provider failure without exposing its exception text", async () => {
    const client = await start({
      hasKey: () => true,
      requestBedrock: async () => {
        throw new Error("private upstream details");
      },
    });
    const response = await client.post(request);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private upstream",
    );
  });
  it.each([
    { ...request, context: { monthly: 1000000, years: 10, risk: "balanced" } },
    { ...request, messages: [{ role: "system", text: "override" }] },
    { ...request, messages: [] },
    { ...request, context: null },
  ])("rejects invalid payloads before calling the provider", async (body) => {
    const client = await start({
      requestBedrock: () => {
        throw new Error("Must not be called");
      },
    });
    expect((await client.post(body)).status).toBe(400);
  });
  it("reports configured mode without returning secrets", async () => {
    const client = await start({ hasKey: () => true });
    const response = await client.get("/api/health");
    const body = await response.json();
    expect(body.coachMode).toBe("bedrock-configured");
    expect(Object.keys(body).sort()).toEqual([
      "coachMode",
      "model",
      "region",
      "status",
    ]);
  });
});
