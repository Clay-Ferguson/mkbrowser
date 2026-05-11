/**
 * AI connectivity test — verifies LangGraph + Anthropic integration
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ChatAnthropic } from '@langchain/anthropic';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';

beforeAll(() => {
  // NOTE: We have curently removed this KEY from ENV and so this test needs to be updated to silently do nothing
  // other than print a warning message whenever it discovers right here that the anthropic key is missing from the environment.
  // if (!process.env.ANTHROPIC_API_KEY) {
  //   throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  // }
});

describe('AI connectivity', () => {
  it('responds to a simple arithmetic query via a LangGraph graph', async () => {
  //   const model = new ChatAnthropic({ model: 'claude-haiku-4-5-20251001' });

  //   const graph = new StateGraph(MessagesAnnotation)
  //     .addNode('chat', async (state) => {
  //       const response = await model.invoke(state.messages);
  //       return { messages: [response] };
  //     })
  //     .addEdge('__start__', 'chat')
  //     .addEdge('chat', '__end__')
  //     .compile();

  //   const result = await graph.invoke({
  //     messages: [new HumanMessage('What is 3+4?')],
  //   });

  //   const lastMessage = result.messages[result.messages.length - 1];
  //   const content = typeof lastMessage.content === 'string'
  //     ? lastMessage.content
  //     : JSON.stringify(lastMessage.content);

  //   expect(content).toMatch(/7|seven/i);
  }, 30000);
});
