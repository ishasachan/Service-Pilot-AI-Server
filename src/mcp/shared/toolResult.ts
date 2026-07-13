/**
 * Wraps any service result as an MCP tool response (JSON text content).
 *
 * @param data - Service operation result to serialize.
 */
export function jsonToolResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Wraps an error message as an MCP tool response with `success: false`.
 *
 * @param message - Human-readable error for the AI to relay.
 */
export function errorToolResult(message: string) {
  return jsonToolResult({ success: false, message });
}
