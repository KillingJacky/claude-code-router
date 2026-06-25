import { UnifiedChatRequest } from "../types/llm";
import { Transformer, TransformerContext } from "../types/transformer";

/**
 * Transformer that renames the `web_search` tool to `litellm_web_search`
 * so that LiteLLM can intercept it on the /v1/chat/completions path.
 */
export class LitellmSearchTransformer implements Transformer {
  name = "litellmsearch";

  transformRequestIn(
    request: UnifiedChatRequest,
    _provider?: any,
    context?: TransformerContext
  ): UnifiedChatRequest {
    const isThinkingMode =
      request.reasoning?.enabled === true ||
      request.reasoning?.effort !== undefined ||
      request.reasoning?.max_tokens !== undefined;
    const toolChoiceUsesWebSearch =
      !!request.tool_choice &&
      typeof request.tool_choice === "object" &&
      "type" in request.tool_choice &&
      request.tool_choice.type === "function" &&
      request.tool_choice.function?.name === "web_search";
    let hasLitellmWebSearch = toolChoiceUsesWebSearch;

    if (request.tools?.length) {
      request.tools = request.tools.map((tool) => {
        if (tool.function?.name === "web_search") {
          hasLitellmWebSearch = true;
          return {
            ...tool,
            function: {
              ...tool.function,
              name: "litellm_web_search",
            },
          };
        }

        return tool;
      });
    }

    if (hasLitellmWebSearch) {
      request.stream = false;
      delete (request as UnifiedChatRequest & { stream_options?: unknown }).stream_options;
    }

    if (toolChoiceUsesWebSearch) {
      if (isThinkingMode) {
        request.tool_choice = "auto";
      } else {
        request.tool_choice = {
          type: "function",
          function: {
            name: "litellm_web_search",
          },
        };
      }
    } else if (isThinkingMode && hasLitellmWebSearch && request.tool_choice && request.tool_choice !== "none") {
      request.tool_choice = "auto";
    }

    if (hasLitellmWebSearch) {
      this.logger?.info(
        {
          reqId: context?.req?.id,
          stream: request.stream,
          toolChoice: request.tool_choice,
          tools: request.tools?.map((tool) => tool.function?.name),
          isThinkingMode,
        },
        "litellmsearch transformed request"
      );
    }

    return request;
  }
}
