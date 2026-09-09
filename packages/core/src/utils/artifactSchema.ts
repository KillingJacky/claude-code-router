const UNSUPPORTED_UNICODE_PROPERTY_ESCAPE = /\\[pP]\{[^}]+\}/g;

/**
 * Make Artifact JSON Schema regexes compatible with LiteLLM's Python
 * validator while preserving the rest of each pattern constraint.
 */
export function sanitizeArtifactInputSchema(schema: any): any {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeArtifactInputSchema);
  }

  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const sanitized = { ...schema };
  if (typeof sanitized.pattern === "string") {
    const compatiblePattern = sanitized.pattern.replace(
      UNSUPPORTED_UNICODE_PROPERTY_ESCAPE,
      "",
    );
    if (compatiblePattern !== sanitized.pattern) {
      sanitized.pattern = compatiblePattern;
    }
  }

  for (const [key, value] of Object.entries(sanitized)) {
    if (key !== "pattern") {
      sanitized[key] = sanitizeArtifactInputSchema(value);
    }
  }

  return sanitized;
}

/**
 * Sanitize Artifact tools while keeping the request in its original
 * Anthropic shape. This is used for providers that bypass format conversion.
 */
export function sanitizeArtifactRequest(request: any): any {
  if (!request || !Array.isArray(request.tools)) {
    return request;
  }

  return {
    ...request,
    tools: request.tools.map((tool: any) =>
      tool?.name === "Artifact"
        ? {
            ...tool,
            input_schema: sanitizeArtifactInputSchema(tool.input_schema),
          }
        : tool,
    ),
  };
}
