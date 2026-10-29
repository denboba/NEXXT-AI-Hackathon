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
    postAgent: (body) =>
      fetch(url + "/api/agent", {
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
const agentRequest = {
  task: "explain-strategy",
  input: {
    label: "Balanced",
    equityPct: 50,
    nominalLei: 98521,
    realLei: 67727,
    targetLei: 90000,
    gapLei: 0,
    horizonYears: 7,
  },
};
describe("agent API", () => {
  it("asks the browser to fall back to deterministic rules when no key is configured", async () => {
    const client = await start({
      hasKey: () => false,
      requestAgent: () => {
        throw new Error("Must not be called");
      },
    });
    const response = await client.postAgent(agentRequest);
    expect(response.status).toBe(503);
    expect((await response.json()).fallback).toBe("deterministic");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns structured output and passes only allowed input fields", async () => {
    let received;
    const client = await start({
      hasKey: () => true,
      requestAgent: async (task, input) => {
        received = { task, input };
        return { text: "An illustration, not a forecast.", citedNumbers: [] };
      },
    });
    const response = await client.postAgent({
      ...agentRequest,
      input: { ...agentRequest.input, extra: "not forwarded" },
    });
    expect(await response.json()).toEqual({
      output: { text: "An illustration, not a forecast.", citedNumbers: [] },
      source: "bedrock",
    });
    expect(received).toEqual(agentRequest);
  });
  it("forwards the optional seeded outcome range numbers and rejects non-numeric ones", async () => {
    let received;
    const client = await start({
      hasKey: () => true,
      requestAgent: async (task, input) => {
        received = { task, input };
        return { text: "An illustration, not a forecast.", citedNumbers: [] };
      },
    });
    const range = { paths: 1000, p10Lei: 78924, p50Lei: 96603, p90Lei: 118116, reachSharePct: 67 };
    const ok = await client.postAgent({ ...agentRequest, input: { ...agentRequest.input, ...range } });
    expect(ok.status).toBe(200);
    expect(received.input).toEqual({ ...agentRequest.input, ...range });
    const bad = await client.postAgent({ ...agentRequest, input: { ...agentRequest.input, p50Lei: "lots" } });
    expect(bad.status).toBe(400);
  });
  it("reports a model failure without exposing its exception text", async () => {
    const client = await start({
      hasKey: () => true,
      requestAgent: async () => {
        throw new Error("private upstream details");
      },
    });
    const response = await client.postAgent(agentRequest);
    expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("private upstream");
    expect(text).toContain("deterministic");
  });
  it.each([
    { task: "unknown-task", input: {} },
    { task: "extract-profile", input: { text: "x".repeat(9000) } },
    { task: "extract-profile", input: "not an object" },
    { ...agentRequest, input: { ...agentRequest.input, nominalLei: "lots" } },
    {
      task: "explain-objections",
      input: { findings: [{ id: "a", severity: "critical", message: "m" }] },
    },
    null,
  ])("rejects invalid agent payloads before calling the model", async (body) => {
    const client = await start({
      hasKey: () => true,
      requestAgent: () => {
        throw new Error("Must not be called");
      },
    });
    expect((await client.postAgent(body)).status).toBe(400);
  });
});
