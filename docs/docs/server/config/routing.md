---
sidebar_position: 3
---

# Routing Configuration

Configure how requests are routed to different models.

## Primary Routing

Set the primary model for requests that do not require a capability or explicit
subagent route:

```json
{
  "Router": {
    "primary": "deepseek,deepseek-chat"
  }
}
```

`default` remains supported as a legacy synonym for `primary`.

## Model Aliases

Claude Code subagents can explicitly select `haiku`, `sonnet`, or `opus`.
Map those model intents to providers that fit your deployment:

```json
{
  "Router": {
    "primary": "deepseek,deepseek-chat",
    "aliases": {
      "haiku": "groq,llama-3.3-70b-versatile",
      "sonnet": "deepseek,deepseek-chat",
      "opus": "openrouter,anthropic/claude-sonnet-4"
    }
  }
}
```

The `[1m]` variant is managed by Claude Code's context policy. CCR treats
`sonnet` and `sonnet[1m]` as the same alias and never switches models based on
an estimated token count. `background` remains supported as a legacy synonym
for `aliases.haiku`.

## Capability Routing

### Web Search

Route requests that declare an Anthropic web search tool to a model that
supports web search:

```json
{
  "Router": {
    "capabilities": {
      "webSearch": "deepseek,deepseek-chat"
    }
  }
}
```

### Vision

Route a current user image to a vision-capable model. CCR keeps its image agent
as a fallback for images in earlier conversation turns.

```json
{
  "Router": {
    "capabilities": {
      "vision": "gemini,gemini-1.5-pro"
    }
  }
}
```

Legacy `webSearch` and `image` fields remain supported as synonyms for these
capabilities.

## Subagent Profiles

For a custom Claude Code agent, put an explicit route tag in its system prompt:

```text
<CCR-ROUTE>explore</CCR-ROUTE>
```

For example, create `~/.claude/agents/ccr-explore.md` (or a project-local
`.claude/agents/ccr-explore.md`):

```markdown
---
name: ccr-explore
description: Fast, read-only codebase exploration.
model: haiku
tools: Read, Glob, Grep
---

<CCR-ROUTE>explore</CCR-ROUTE>

Explore the codebase and report concise findings. Do not modify files.
```

Then map that profile in CCR:

```json
{
  "Router": {
    "subagents": {
      "explore": "groq,llama-3.3-70b-versatile"
    }
  },
  "Fallback": {
    "subagents": {
      "explore": ["openrouter,meta-llama/llama-3.3-70b-instruct"]
    }
  }
}
```

Start it with `ccr code --agent ccr-explore`, or ask Claude Code to use the
named agent. CCR removes the tag before forwarding the request.

Each named profile needs its own fallback list at
`Fallback.subagents.<profile>`; it does not inherit the fallback of the
agent's `haiku`, `sonnet`, or `opus` alias. An explicit legacy
`<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>` tag is also supported
and takes precedence over a profile tag.

## Fallback

When a request fails, you can configure a list of backup models. The system will try each model in sequence until one succeeds:

### Basic Configuration

```json
{
  "Router": {
    "primary": "deepseek,deepseek-chat",
    "aliases": {
      "haiku": "ollama,qwen2.5-coder:latest"
    },
    "capabilities": {
      "webSearch": "gemini,gemini-2.5-flash"
    }
  },
  "Fallback": {
    "primary": [
      "aihubmix,Z/glm-4.5",
      "openrouter,anthropic/claude-sonnet-4"
    ],
    "aliases": {
      "haiku": ["ollama,qwen2.5-coder:latest"],
      "sonnet": ["openrouter,anthropic/claude-sonnet-4"]
    },
    "capabilities": {
      "webSearch": ["openrouter,anthropic/claude-sonnet-4"],
      "vision": ["gemini,gemini-2.5-pro"]
    },
    "subagents": {
      "explore": ["openrouter,meta-llama/llama-3.3-70b-instruct"]
    }
  }
}
```

### How It Works

1. **Trigger**: When a model request fails for a routing scenario (HTTP error response)
2. **Auto-switch**: The system automatically checks the fallback configuration for that scenario
3. **Sequential retry**: Tries each backup model in order
4. **Success**: Once a model responds successfully, returns immediately
5. **All failed**: If all backup models fail, returns the original error

### Configuration Details

- **Format**: Each backup model format is `provider,model`
- **Validation**: Backup models must exist in the `Providers` configuration
- **Priority**: CCR first checks a route-specific nested key such as `aliases.haiku` or `capabilities.vision`, then a generic scenario key such as `alias`, and finally the legacy flat key. The primary route uses `Fallback.primary`.
- **Flexibility**: Different aliases, capabilities, and subagent profiles can have different fallback lists. Use `Fallback.subagents.<profile>` for a named subagent profile.
- **Compatibility**: Lowercase `fallback` and `fallback.default` remain supported for existing configurations. `Fallback` and `Fallback.primary` take precedence.
- **Optional**: If a scenario doesn't need fallback, omit it or use an empty array

### Use Cases

#### Scenario 1: Primary Model Quota Exhausted

```json
{
  "Router": {
    "primary": "openrouter,anthropic/claude-sonnet-4"
  },
  "Fallback": {
    "primary": [
      "deepseek,deepseek-chat",
      "aihubmix,Z/glm-4.5"
    ]
  }
}
```

Automatically switches to backup models when the primary model quota is exhausted.

#### Scenario 2: Service Reliability

```json
{
  "Router": {
    "aliases": {
      "haiku": "volcengine,deepseek-v3-250324"
    }
  },
  "Fallback": {
    "aliases": {
      "haiku": [
        "modelscope,Qwen/Qwen3-Coder-480B-A35B-Instruct",
        "dashscope,qwen3-coder-plus"
      ]
    }
  }
}
```

Automatically switches to other providers when the primary service fails.

### Log Monitoring

The system logs detailed fallback process:

```
[warn] Request failed for default, trying 2 fallback models
[info] Trying fallback model: aihubmix,Z/glm-4.5
[warn] Fallback model aihubmix,Z/glm-4.5 failed: API rate limit exceeded
[info] Trying fallback model: openrouter,anthropic/claude-sonnet-4
[info] Fallback model openrouter,anthropic/claude-sonnet-4 succeeded
```

### Important Notes

1. **Cost consideration**: Backup models may incur different costs, configure appropriately
2. **Performance differences**: Different models may have varying response speeds and quality
3. **Quota management**: Ensure backup models have sufficient quotas
4. **Testing**: Regularly test the availability of backup models

## Project-Level Routing

Configure routing per project in `~/.claude/projects/<project-id>/claude-code-router.json`:

```json
{
  "Router": {
    "primary": "groq,llama-3.3-70b-versatile"
  }
}
```

Project-level configuration takes precedence over global configuration.

## Custom Router

Create a custom JavaScript router function:

1. Create a router file (e.g., `custom-router.js`):

```javascript
module.exports = function(req, config, context) {
  if (req.body.tools?.some((tool) => tool.type?.startsWith('web_search'))) {
    return 'gemini,gemini-2.5-flash';
  }

  return 'deepseek,deepseek-chat';
};
```

2. Set the `CUSTOM_ROUTER_PATH` environment variable:

```bash
export CUSTOM_ROUTER_PATH="/path/to/custom-router.js"
```

## Token Counting

The router exposes a `tiktoken` (cl100k_base) token estimate to custom routers.
CCR itself does not use it to switch context windows; Claude Code owns context
capacity and compaction.

### Explicit Model Override

Specify a provider and model directly with the legacy override tag:

```
<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>
Please help me analyze this code...
```

## Next Steps

- [Transformers](/docs/config/transformers) - Apply transformations to requests
- [Custom Router](/docs/advanced/custom-router) - Advanced custom routing
