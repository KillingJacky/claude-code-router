---
sidebar_position: 2
---

# Providers Configuration

Detailed guide for configuring LLM providers.

## Supported Providers

### DeepSeek

```json
{
  "NAME": "deepseek",
  "HOST": "https://api.deepseek.com",
  "APIKEY": "your-api-key",
  "MODELS": ["deepseek-chat", "deepseek-coder"],
  "transformers": ["anthropic"]
}
```

### Groq

```json
{
  "NAME": "groq",
  "HOST": "https://api.groq.com/openai/v1",
  "APIKEY": "your-api-key",
  "MODELS": ["llama-3.3-70b-versatile"],
  "transformers": ["anthropic"]
}
```

### Gemini

```json
{
  "NAME": "gemini",
  "HOST": "https://generativelanguage.googleapis.com/v1beta",
  "APIKEY": "your-api-key",
  "MODELS": ["gemini-1.5-pro"],
  "transformers": ["anthropic"]
}
```

### OpenRouter

```json
{
  "NAME": "openrouter",
  "HOST": "https://openrouter.ai/api/v1",
  "APIKEY": "your-api-key",
  "MODELS": ["anthropic/claude-3.5-sonnet"],
  "transformers": ["anthropic"]
}
```

## Provider Configuration Options

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `NAME` | string | Yes | Unique provider identifier |
| `HOST` | string | Yes | API base URL |
| `APIKEY` | string | Yes | API authentication key |
| `MODELS` | string[] | No | List of available models |
| `models_1m` | string[] | No | Models from `models` that support 1M context and should also be exposed with a `[1m]` option in Claude Code |
| `transformers` | string[] | No | List of transformers to apply |

`models_1m` is an additional capability list, not a separate model list. Every entry must also appear in `models`; entries that are not present in `models` are ignored by gateway model discovery. For example:

```json
{
  "models": ["gpt-5.4", "gpt-5.4-mini"],
  "models_1m": ["gpt-5.4"]
}
```

Claude Code will show the normal `gpt-5.4` entry and an additional `gpt-5.4 [1M]` entry, while `gpt-5.4-mini` will only have its normal entry.

## Model Selection

When selecting a model in routing, use the format:

```
{provider-name},{model-name}
```

For example:

```
deepseek,deepseek-chat
```

## Next Steps

- [Routing Configuration](/docs/config/routing) - Configure how requests are routed
- [Transformers](/docs/config/transformers) - Apply transformations to requests
