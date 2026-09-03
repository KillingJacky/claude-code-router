---
title: 路由配置
sidebar_position: 3
---

# 路由配置

配置如何将请求路由到不同的模型。

## 主路由

为不需要能力模型或显式子代理路由的请求设置主模型：

```json
{
  "Router": {
    "primary": "deepseek,deepseek-chat"
  }
}
```

`default` 仍作为 `primary` 的兼容字段保留。

## 模型别名

Claude Code 子代理可显式选择 `haiku`、`sonnet` 或 `opus`。将这些模型意图映射到合适的 provider：

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

`[1m]` 由 Claude Code 的上下文策略管理。CCR 将 `sonnet` 和 `sonnet[1m]` 视为同一 alias，且不会按估算 token 数自动切换模型。`background` 仍作为 `aliases.haiku` 的兼容字段保留。

## 能力路由

### 网络搜索

将声明 Anthropic web search 工具的请求路由到支持搜索的模型：

```json
{
  "Router": {
    "capabilities": {
      "webSearch": "gemini,gemini-2.5-flash"
    }
  }
}
```

### 视觉

将当前用户消息中的图像路由到视觉模型；历史消息中的图片仍由 CCR Image Agent 兜底处理。

```json
{
  "Router": {
    "capabilities": {
      "vision": "gemini,gemini-2.5-pro"
    }
  }
}
```

旧的 `webSearch` 和 `image` 字段仍分别作为这些能力字段的兼容写法。

## 子代理 Profile

在自定义 Claude Code agent 的 system prompt 中加入明确的路由标签：

```text
<CCR-ROUTE>explore</CCR-ROUTE>
```

例如，创建 `~/.claude/agents/ccr-explore.md`（或项目内的
`.claude/agents/ccr-explore.md`）：

```markdown
---
name: ccr-explore
description: 快速、只读地探索代码库。
model: haiku
tools: Read, Glob, Grep
---

<CCR-ROUTE>explore</CCR-ROUTE>

探索代码库并报告简洁的结论。不要修改文件。
```

然后在 CCR 中配置该 profile：

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

使用 `ccr code --agent ccr-explore` 启动该 agent，或在 Claude Code 中要求使用
指定的 agent。CCR 会在转发请求前移除标签。

每个命名 profile 都需要在 `Fallback.subagents.<profile>` 中单独配置 fallback；
它不会继承 agent 的 `haiku`、`sonnet` 或 `opus` alias 的 fallback。旧的
`<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>` 显式覆盖标签仍受支持，
且优先级高于 profile 标签。

## 故障转移（Fallback）

当请求失败时，可以配置备用模型列表。系统会按顺序尝试每个模型，直到请求成功：

### 基本配置

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

### 工作原理

1. **触发条件**：当某个路由场景的模型请求失败时（HTTP 错误响应）
2. **自动切换**：系统自动检查该场景的 fallback 配置
3. **顺序尝试**：按照列表顺序依次尝试每个备用模型
4. **成功返回**：一旦某个模型成功响应，立即返回结果
5. **全部失败**：如果所有备用模型都失败，返回原始错误

### 配置说明

- **格式**：每个备用模型格式为 `provider,model`
- **验证**：备用模型必须在 `Providers` 配置中存在
- **优先级**：CCR 先检查 `aliases.haiku`、`capabilities.vision` 等具体嵌套 key，再检查 `alias` 等通用场景 key，最后检查旧的平铺字段。主路由使用 `Fallback.primary`。
- **灵活性**：不同 alias、能力和子代理 profile 可以配置不同的备用列表。命名子代理 profile 使用 `Fallback.subagents.<profile>`。
- **兼容性**：小写 `fallback` 与 `fallback.default` 仍可用于现有配置；`Fallback` 与 `Fallback.primary` 优先。
- **可选性**：如果某个场景不需要备用，可以不配置或使用空数组

### 使用场景

#### 场景一：主模型配额不足

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

当主模型配额用完时，自动切换到备用模型。

#### 场景二：服务稳定性保障

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

当主服务商出现故障时，自动切换到其他服务商。

### 日志监控

系统会记录详细的 fallback 过程：

```
[warn] Request failed for default, trying 2 fallback models
[info] Trying fallback model: aihubmix,Z/glm-4.5
[warn] Fallback model aihubmix,Z/glm-4.5 failed: API rate limit exceeded
[info] Trying fallback model: openrouter,anthropic/claude-sonnet-4
[info] Fallback model openrouter,anthropic/claude-sonnet-4 succeeded
```

### 注意事项

1. **成本考虑**：备用模型可能产生不同的费用，请合理配置
2. **性能差异**：不同模型的响应速度和质量可能有差异
3. **配额管理**：确保备用模型有足够的配额
4. **测试验证**：定期测试备用模型的可用性

## 项目级路由

在 `~/.claude/projects/<project-id>/claude-code-router.json` 中为每个项目配置路由：

```json
{
  "Router": {
    "primary": "groq,llama-3.3-70b-versatile"
  }
}
```

项目级配置优先于全局配置。

## 自定义路由器

创建自定义 JavaScript 路由器函数：

1. 创建路由器文件（例如 `custom-router.js`）：

```javascript
module.exports = async function(req, config) {
  // 分析请求上下文
  const userMessage = req.body.messages.find(m => m.role === 'user')?.content;

  // 自定义路由逻辑
  if (userMessage && userMessage.includes('解释代码')) {
    return 'openrouter,anthropic/claude-3.5-sonnet';
  }

  // 返回 null 以使用默认路由
  return null;
};
```

2. 在 `config.json` 中设置 `CUSTOM_ROUTER_PATH`：

```json
{
  "CUSTOM_ROUTER_PATH": "/path/to/custom-router.js"
}
```

## Token 计数

路由器会将 `tiktoken` (cl100k_base) token 估算提供给自定义路由器。CCR 本身不会用它切换上下文窗口；上下文容量和 compact 由 Claude Code 管理。

### 显式模型覆盖

使用旧的显式标签直接指定 provider 和 model：

```
<CCR-SUBAGENT-MODEL>provider,model</CCR-SUBAGENT-MODEL>
请帮我分析这段代码...
```

## 动态模型切换

在 Claude Code 中使用 `/model` 命令动态切换模型：

```
/model provider_name,model_name
```

示例：`/model openrouter,anthropic/claude-3.5-sonnet`

## 路由优先级

1. 项目级配置
2. 自定义路由器
3. 显式子代理 profile、能力路由与模型 alias
4. 主路由

## 下一步

- [转换器](/zh/docs/config/transformers) - 对请求应用转换
- [自定义路由器](/zh/docs/advanced/custom-router) - 高级自定义路由
