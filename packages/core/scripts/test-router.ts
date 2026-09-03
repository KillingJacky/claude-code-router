import assert from "node:assert/strict";
import { resolveRouterRoute } from "../src/utils/router";

const router = {
  primary: "provider,primary",
  aliases: {
    haiku: "provider,fast",
    sonnet: "provider,capable",
    opus: "provider,reasoning",
  },
  capabilities: {
    webSearch: "provider,web",
    vision: "provider,vision",
  },
  subagents: {
    explore: "provider,fast",
  },
};

const route = (body: Record<string, unknown>) =>
  resolveRouterRoute({ body }, router);

assert.deepEqual(
  route({ model: "claude-opus-5", thinking: { type: "adaptive" }, messages: [] }),
  { model: "provider,reasoning", scenarioType: "alias", fallbackKey: "aliases.opus" }
);

assert.deepEqual(
  resolveRouterRoute(
    { body: { model: "custom-model", thinking: { type: "adaptive" }, messages: [] } },
    { primary: "provider,primary", think: "provider,ignored" }
  ),
  { model: "provider,primary", scenarioType: "default", fallbackKey: "default" }
);

assert.deepEqual(
  route({
    model: "claude-opus-5",
    messages: [],
    tools: [{ type: "web_search_20250305" }],
  }),
  { model: "provider,web", scenarioType: "webSearch", fallbackKey: "capabilities.webSearch" }
);

assert.deepEqual(
  route({
    model: "claude-sonnet-4-6[1m]",
    messages: [
      { role: "user", content: [{ type: "image", source: {} }] },
      { role: "system", content: "trailing context" },
    ],
  }),
  { model: "provider,vision", scenarioType: "image", fallbackKey: "capabilities.vision" }
);

const subagentRequest = {
  body: {
    model: "claude-haiku-4-5",
    system: [
      { type: "text", text: "first system block" },
      { type: "text", text: "<CCR-ROUTE>explore</CCR-ROUTE>agent instructions" },
    ],
    messages: [],
  },
};
assert.deepEqual(resolveRouterRoute(subagentRequest, router), {
  model: "provider,fast",
  scenarioType: "subagent",
  fallbackKey: "subagents.explore",
});
assert.equal(subagentRequest.body.system[1].text, "agent instructions");

const explicitSubagentRequest = {
  body: {
    model: "claude-haiku-4-5",
    system: [{ type: "text", text: "<CCR-SUBAGENT-MODEL>provider,chosen</CCR-SUBAGENT-MODEL>" }],
    messages: [],
  },
};
assert.deepEqual(resolveRouterRoute(explicitSubagentRequest, router), {
  model: "provider,chosen",
  scenarioType: "subagent",
  fallbackKey: "subagent",
});
assert.equal(explicitSubagentRequest.body.system[0].text, "");

assert.deepEqual(
  resolveRouterRoute(
    {
      body: {
        model: "claude-sonnet-4-6[1m]",
        messages: [{ role: "user", content: [{ type: "image", source: {} }] }],
      },
    },
    router,
    true
  ),
  { model: "provider,capable", scenarioType: "alias", fallbackKey: "aliases.sonnet" }
);

assert.deepEqual(
  resolveRouterRoute(
    { body: { model: "claude-haiku-4-5", messages: [] } },
    { default: "provider,legacy-primary", background: "provider,legacy-fast" }
  ),
  { model: "provider,legacy-fast", scenarioType: "alias", fallbackKey: "aliases.haiku" }
);

console.log("router tests passed");
