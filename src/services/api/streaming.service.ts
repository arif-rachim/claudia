import { createParser, ParsedEvent, ReconnectInterval } from 'eventsource-parser';
import { ChatCompletionRequest } from '../../types/api.types';
import { ToolCall } from '../../types/message.types';
import { MessageUsage } from '../../types/statistics.types';

export interface StreamCallbacks {
  onChunk: (content: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  onToolCalls?: (toolCalls: ToolCall[]) => void;
  onReasoning?: (reasoning: string) => void;
  onUsage?: (usage: MessageUsage) => void;
}

/**
 * Stream chat completions from Open WebUI using Server-Sent Events
 */
export async function streamChatCompletion(
  baseUrl: string,
  apiKey: string,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal,
  _traceId?: string
): Promise<void> {
  const { onChunk, onComplete, onError, onToolCalls, onReasoning, onUsage } = callbacks;

  // Normalize baseUrl - remove trailing slash and /api suffix to prevent duplication
  let normalizedBaseUrl = baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
  // Remove /api suffix if present (case-insensitive) to prevent /api/api duplication
  normalizedBaseUrl = normalizedBaseUrl.replace(/\/api$/i, '');

  try {
    const response = await fetch(`${normalizedBaseUrl}/api/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        ...request,
        stream: true,
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorMessage;
      } catch {
        // Use default error message if JSON parsing fails
      }

      throw new Error(errorMessage);
    }

    if (!response.body) {
      throw new Error('No response body received');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // Accumulate tool calls from streaming deltas
    const accumulatedToolCalls: Map<number, ToolCall> = new Map();

    // Accumulate content and track chunks for logging
    let accumulatedContent = '';
    let accumulatedReasoning = '';
    let chunkCount = 0;

    // State for parsing inline <think> tags in content
    let isInsideThinkBlock = false;
    let pendingBuffer = ''; // Buffer for partial tag detection
    let formatDetected = false; // Whether we've detected if this response uses think tags
    const FORMAT_DETECTION_THRESHOLD = 3000; // Buffer this many chars before assuming no think tags

    // Helper function to process buffer once format is known
    const processBufferWithKnownFormat = () => {
      let processedContent = '';
      let processedReasoning = '';

      while (pendingBuffer.length > 0) {
        if (isInsideThinkBlock) {
          // Look for closing tag
          const closeMatch = pendingBuffer.match(/<\/think(?:ing)?>/i);
          if (closeMatch && closeMatch.index !== undefined) {
            const reasoningPart = pendingBuffer.slice(0, closeMatch.index);
            processedReasoning += reasoningPart;
            pendingBuffer = pendingBuffer.slice(closeMatch.index + closeMatch[0].length);
            isInsideThinkBlock = false;
          } else if (pendingBuffer.length > 15) {
            // Keep last 15 chars in buffer in case closing tag spans chunks
            const safeLength = pendingBuffer.length - 15;
            processedReasoning += pendingBuffer.slice(0, safeLength);
            pendingBuffer = pendingBuffer.slice(safeLength);
            break;
          } else {
            break;
          }
        } else {
          // Look for opening tag first
          const openMatch = pendingBuffer.match(/<think(?:ing)?>/i);
          // Also look for closing tag (implicit think - no opening tag)
          const closeMatch = pendingBuffer.match(/<\/think(?:ing)?>/i);

          if (openMatch && openMatch.index !== undefined &&
              (!closeMatch || openMatch.index < closeMatch.index!)) {
            // Found opening tag (and it comes before any closing tag)
            const contentPart = pendingBuffer.slice(0, openMatch.index);
            processedContent += contentPart;
            pendingBuffer = pendingBuffer.slice(openMatch.index + openMatch[0].length);
            isInsideThinkBlock = true;
          } else if (closeMatch && closeMatch.index !== undefined) {
            // Found closing tag without opening - implicit think mode
            // Everything before </think> is reasoning
            console.log('[StreamingService] IMPLICIT THINK: Found </think> at index', closeMatch.index);
            const reasoningPart = pendingBuffer.slice(0, closeMatch.index);
            processedReasoning += reasoningPart;
            pendingBuffer = pendingBuffer.slice(closeMatch.index + closeMatch[0].length);
            isInsideThinkBlock = false;
          } else if (pendingBuffer.length > 15 && !pendingBuffer.slice(-15).includes('<')) {
            // No tags in sight, emit as content
            const safeLength = pendingBuffer.length - 15;
            processedContent += pendingBuffer.slice(0, safeLength);
            pendingBuffer = pendingBuffer.slice(safeLength);
            break;
          } else {
            break;
          }
        }
      }

      // Dispatch processed content and reasoning
      if (processedContent) {
        console.log('[StreamingService] EMIT CONTENT:', JSON.stringify(processedContent.slice(0, 100)));
        accumulatedContent += processedContent;
        onChunk(processedContent);
      }
      if (processedReasoning && onReasoning) {
        console.log('[StreamingService] EMIT REASONING:', JSON.stringify(processedReasoning.slice(0, 100)));
        accumulatedReasoning += processedReasoning;
        onReasoning(processedReasoning);
      }
    };

    // Helper to flush pending buffer and complete streaming
    const flushBufferAndComplete = () => {
      console.log('[StreamingService] FLUSH called. formatDetected:', formatDetected, 'bufferLength:', pendingBuffer.length);
      console.log('[StreamingService] Final buffer:', JSON.stringify(pendingBuffer));
      // If format wasn't detected yet (short response), check for think tags now
      if (!formatDetected && pendingBuffer.length > 0) {
        const closeMatch = pendingBuffer.match(/<\/think(?:ing)?>/i);
        const openMatch = pendingBuffer.match(/<think(?:ing)?>/i);

        if (openMatch && openMatch.index !== undefined) {
          // Has opening tag - process as think block
          console.log('[StreamingService] FLUSH: Found opening tag at', openMatch.index);
          const contentBefore = pendingBuffer.slice(0, openMatch.index);
          if (contentBefore) {
            console.log('[StreamingService] FLUSH EMIT CONTENT (before tag):', JSON.stringify(contentBefore.slice(0, 100)));
            accumulatedContent += contentBefore;
            onChunk(contentBefore);
          }

          const afterOpen = pendingBuffer.slice(openMatch.index + openMatch[0].length);
          const closeInRest = afterOpen.match(/<\/think(?:ing)?>/i);
          if (closeInRest && closeInRest.index !== undefined) {
            const reasoning = afterOpen.slice(0, closeInRest.index);
            if (reasoning && onReasoning) {
              accumulatedReasoning += reasoning;
              onReasoning(reasoning);
            }
            const contentAfter = afterOpen.slice(closeInRest.index + closeInRest[0].length);
            if (contentAfter) {
              accumulatedContent += contentAfter;
              onChunk(contentAfter);
            }
          } else {
            // No closing tag - treat rest as reasoning
            if (afterOpen && onReasoning) {
              accumulatedReasoning += afterOpen;
              onReasoning(afterOpen);
            }
          }
          pendingBuffer = '';
        } else if (closeMatch && closeMatch.index !== undefined) {
          // Has closing tag without opening - implicit think at start
          console.log('[StreamingService] FLUSH: Found closing tag (implicit think) at', closeMatch.index);
          const reasoning = pendingBuffer.slice(0, closeMatch.index);
          if (reasoning && onReasoning) {
            console.log('[StreamingService] FLUSH EMIT REASONING:', JSON.stringify(reasoning.slice(0, 100)));
            accumulatedReasoning += reasoning;
            onReasoning(reasoning);
          }
          const contentAfter = pendingBuffer.slice(closeMatch.index + closeMatch[0].length);
          if (contentAfter) {
            console.log('[StreamingService] FLUSH EMIT CONTENT (after tag):', JSON.stringify(contentAfter.slice(0, 100)));
            accumulatedContent += contentAfter;
            onChunk(contentAfter);
          }
          pendingBuffer = '';
        } else {
          // No think tags - emit as content
          console.log('[StreamingService] FLUSH: No think tags found, emitting as content');
          accumulatedContent += pendingBuffer;
          onChunk(pendingBuffer);
          pendingBuffer = '';
        }
      } else if (pendingBuffer.length > 0) {
        // Format was detected, flush remaining based on state
        if (isInsideThinkBlock) {
          // Still inside think block - treat remaining as reasoning
          if (onReasoning) {
            accumulatedReasoning += pendingBuffer;
            onReasoning(pendingBuffer);
          }
        } else {
          // Treat remaining as regular content
          accumulatedContent += pendingBuffer;
          onChunk(pendingBuffer);
        }
        pendingBuffer = '';
      }
      onComplete();
    };

    // Create SSE parser
    const parser = createParser((event: ParsedEvent | ReconnectInterval) => {
      if (event.type === 'event') {
        const data = event.data;

        // OpenAI/Open WebUI sends [DONE] when stream is complete
        if (data === '[DONE]') {
          flushBufferAndComplete();
          return;
        }

        try {
          const json = JSON.parse(data);
          // Log full JSON to debug what fields are available
          if (!json.choices?.[0]?.delta?.content) {
            console.log('[StreamingService] Non-content chunk:', JSON.stringify(json));
          }
          const delta = json.choices?.[0]?.delta;
          const content = delta?.content;
          const toolCallDeltas = delta?.tool_calls;
          const reasoningContent = delta?.reasoning;
          const usage = json.usage;

          if (content) {
            chunkCount++;
            pendingBuffer += content;

            // DEBUG: Log raw content chunks
            console.log('[StreamingService] Raw chunk:', JSON.stringify(content));
            console.log('[StreamingService] Buffer state:', {
              formatDetected,
              isInsideThinkBlock,
              bufferLength: pendingBuffer.length,
              bufferPreview: pendingBuffer.length > 100
                ? pendingBuffer.slice(0, 50) + '...' + pendingBuffer.slice(-50)
                : pendingBuffer
            });

            // Phase 1: Format detection
            // Buffer content until we detect whether this response uses think tags
            if (!formatDetected) {
              // Check for opening <think> tag
              const openMatch = pendingBuffer.match(/<think(?:ing)?>/i);
              if (openMatch) {
                console.log('[StreamingService] FORMAT DETECTED: Opening <think> tag found at index', openMatch.index);
                formatDetected = true;
                // Process content before the tag
                const contentBefore = pendingBuffer.slice(0, openMatch.index);
                if (contentBefore) {
                  accumulatedContent += contentBefore;
                  onChunk(contentBefore);
                }
                pendingBuffer = pendingBuffer.slice(openMatch.index! + openMatch[0].length);
                isInsideThinkBlock = true;
                // Continue processing
                processBufferWithKnownFormat();
              }
              // Check for closing </think> without opening (implicit think at start)
              else if (pendingBuffer.match(/<\/think(?:ing)?>/i)) {
                console.log('[StreamingService] FORMAT DETECTED: Closing </think> tag found (implicit think mode)');
                formatDetected = true;
                const closeMatch = pendingBuffer.match(/<\/think(?:ing)?>/i)!;
                // Everything before </think> is reasoning
                const reasoningPart = pendingBuffer.slice(0, closeMatch.index);
                if (reasoningPart && onReasoning) {
                  accumulatedReasoning += reasoningPart;
                  onReasoning(reasoningPart);
                }
                pendingBuffer = pendingBuffer.slice(closeMatch.index! + closeMatch[0].length);
                isInsideThinkBlock = false;
                // Continue processing rest as content
                processBufferWithKnownFormat();
              }
              // No tags found yet - check if we should keep buffering
              else if (pendingBuffer.length >= FORMAT_DETECTION_THRESHOLD) {
                // Buffered enough - assume no think tags in this response
                console.log('[StreamingService] FORMAT DETECTED: No think tags found after', pendingBuffer.length, 'chars, assuming regular content');
                formatDetected = true;
                // Emit all buffered content
                processBufferWithKnownFormat();
              }
              // else: keep buffering, wait for more content
            }
            // Phase 2: Format already detected, process normally
            else {
              processBufferWithKnownFormat();
            }
          }

          if (reasoningContent && onReasoning) {
            accumulatedReasoning += reasoningContent;
            onReasoning(reasoningContent);
          }

          // Handle usage data
          if (usage && onUsage) {
            console.log('[StreamingService] USAGE DATA received:', usage);
            onUsage(usage);
          }

          // Accumulate tool call deltas
          if (toolCallDeltas && onToolCalls) {
            for (const toolCallDelta of toolCallDeltas) {
              const index = toolCallDelta.index;
              const existing = accumulatedToolCalls.get(index);

              if (!existing) {
                // First chunk for this tool call
                accumulatedToolCalls.set(index, {
                  id: toolCallDelta.id || '',
                  type: toolCallDelta.type || 'function',
                  function: {
                    name: toolCallDelta.function?.name || '',
                    arguments: toolCallDelta.function?.arguments || '',
                  },
                });
              } else {
                // Subsequent chunks - append arguments
                if (toolCallDelta.function?.arguments) {
                  existing.function.arguments += toolCallDelta.function.arguments;
                }
                // Update ID if it wasn't set in first chunk
                if (toolCallDelta.id && !existing.id) {
                  existing.id = toolCallDelta.id;
                }
                // Update name if it wasn't set in first chunk
                if (toolCallDelta.function?.name && !existing.function.name) {
                  existing.function.name = toolCallDelta.function.name;
                }
              }
            }
          }

          // Check if stream is done via finish_reason
          if (json.choices?.[0]?.finish_reason) {
            // Send usage FIRST before anything else (including tool calls)
            if (json.usage && onUsage) {
              onUsage(json.usage);
            }

            // Then send accumulated tool calls if any
            if (accumulatedToolCalls.size > 0 && onToolCalls) {
              const toolCallsArray = Array.from(accumulatedToolCalls.values()).map(tc => ({
                ...tc,
                // Ensure arguments is valid JSON - default to empty object if empty
                function: {
                  ...tc.function,
                  arguments: tc.function.arguments || '{}',
                },
              }));
              onToolCalls(toolCallsArray);
            }

            // NOTE: Don't call onComplete() here - usage data may arrive in subsequent chunks
            // onComplete() will be called when stream actually ends (done=true or [DONE])
          }
        } catch (error) {
          // Continue processing other chunks even if one fails
        }
      }
    });

    // Read the stream
    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          flushBufferAndComplete();
          break;
        }

        // Decode the chunk and feed to parser
        const chunk = decoder.decode(value, { stream: true });
        parser.feed(chunk);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Stream was aborted by user
        flushBufferAndComplete();
      } else {
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // Stream was aborted before setup, nothing to flush
      onComplete();
    } else {
      onError(error instanceof Error ? error : new Error('Unknown streaming error'));
    }
  }
}

/**
 * Create an abort controller for cancelling streaming requests
 */
export function createStreamAbortController(): AbortController {
  return new AbortController();
}
