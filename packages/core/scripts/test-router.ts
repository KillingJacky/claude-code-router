import assert from "node:assert/strict";
import { getUseModel, resolveRouterRoute } from "../src/utils/router";
import {
  createGatewayModelId,
  parseGatewayModelId,
  ProviderService,
} from "../src/services/provider";

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

const gatewayModelId = createGatewayModelId("openrouter", "anthropic/claude-3.5-sonnet");
assert.ok(gatewayModelId.startsWith("claude-code-router/"));
assert.deepEqual(parseGatewayModelId(gatewayModelId), {
  provider: "openrouter",
  model: "anthropic/claude-3.5-sonnet",
  is1m: false,
});
const gateway1mModelId = createGatewayModelId(
  "openrouter",
  "anthropic/claude-3.5-sonnet",
  true
);
assert.deepEqual(parseGatewayModelId(gateway1mModelId), {
  provider: "openrouter",
  model: "anthropic/claude-3.5-sonnet",
  is1m: true,
});
assert.equal(parseGatewayModelId("claude-code-router/not-a-route"), null);

const providerService = new ProviderService(
  {
    get: (key: string) => key === "providers"
      ? [{
          name: "openrouter",
          api_base_url: "https://example.test/v1/messages",
          api_key: "test",
          models: ["anthropic/claude-3.5-sonnet"],
          models_1m: ["anthropic/claude-3.5-sonnet"],
        }]
      : undefined,
  } as any,
  {} as any,
  { info() {}, error() {} }
);
assert.deepEqual(providerService.getGatewayModels(), {
  object: "list",
  data: [{
    id: gatewayModelId,
    type: "model",
    display_name: "openrouter, anthropic/claude-3.5-sonnet",
    description: "CCR model: openrouter,anthropic/claude-3.5-sonnet",
  }, {
    id: gateway1mModelId,
    type: "model",
    display_name: "openrouter, anthropic/claude-3.5-sonnet [1M]",
    description: "CCR model: openrouter,anthropic/claude-3.5-sonnet (1M context)",
  }],
  has_more: false,
});

void (async () => {
  const explicitGatewayRoute = await getUseModel(
    { body: { model: gateway1mModelId, messages: [] } },
    {
      get: (key: string) => key === "providers"
        ? [{ name: "openrouter", models: ["anthropic/claude-3.5-sonnet"] }]
        : undefined,
    } as any
  );
  assert.deepEqual(explicitGatewayRoute, {
    model: "openrouter,anthropic/claude-3.5-sonnet",
    scenarioType: "default",
    fallbackKey: "default",
    routerSource: "explicit",
  });

  console.log("router tests passed");
})();
