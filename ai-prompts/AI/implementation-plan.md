# Adding AI to MkBrowser Application

This file is instructions for the AI coding agent. If you're an AI Agent seeing this file, you should do what it says in the steps below. 

We will be adding AI capabilities to this application. This document will contain a step-by-step sequence of refactoring steps, where we will logically, have each step building upon the previous step, to get to our final architecture. As we begin at step one, there are no AI capabilities in the app at all and LangChain/LangGraph as not yet been added to the project. We will not be writing any of the steps ahead of time, but we'll be writing the steps as we go along and implementing each new step one at a time. Each step will be written as a prompt, to you (the AI Agent), telling you what to do for that step.

# Step 1 (done)

Based on the assumption that we're going to eventually be building a full-featured chatbot (with support for tool calling, file attachments) into this application, i'm thinking we probably need LangGraph instead of simply LangChain, to be installed with our `yarn` package manager, so please do this first. Then write a simple test case named `tests/ai.test.ts`, that demonstrates we're able to run the AI API calls against a remote cloud service. We'll be using Anthropic as our cloud provider, and you can expect the API key to be in the environment variable 'ANTHROPIC_API_KEY'. part of this test script should be to check the existence of that key and make sure it's set. You can follow the conventions and patterns you see in our existing `search.test.ts` test file, if you have any questions about how to set up the test. as for the content of the test itself just run the query "What is 3+4?", then, assert that the response does contain the text "7" or "seven".

# Step 2 (done)

Now we're going to begin our GUI work. We're going to make it where any markdown file named `HUMAN.md` we will automatically have an "Ask AI" button in the header of the `MarkdownEntry.tsx` component. If the user clicks this button, we will submit the entire content of the markdown file as an AI prompt, and when we get the response back from the AI, we will write the text representation (which will likely also be markdown) into a file named `AI.md` and in a subfolder named "A" (A==Agent), underneath the folder that contained `HUMAN.md` (creating the "A" folder, if it doesn't already exist). in other words, all of the responses from the AI always go into the subfolder named "A" and into a file named "AI.md". If an "AI.md" file already exists we look for the next numbered file to use "AI1.md, AI2.md, etc", using the first available numbered filename we find.

Now because I can foresee that there's going to be significant amount of code that we will have related to AI functionality, let's create a new project folder for all of the AI source, and put it in a folder named `src/ai`. for now you can simply put everything in `src/ai/aiUti.ts`, but try to put anything AI specific that you can, into that file. Since we've already accomplished step one above, you can look inside `ai.test.ts` if you have any questions about how to interact with the AI.

