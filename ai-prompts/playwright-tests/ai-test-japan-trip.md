# Objective - Playwright Test for Demoing (faking) the following contrived AI Chat

you'll be creating the entire playwright test case, that showcases the following chat sequence between the human and the AI. Notice you have a `SKILL.md` file for playwrite tests.

## Chat Sequence (Transcript)

Human: "I’m in Tokyo for one more night. It’s raining, I’m tired of sushi, and I want to see something 'Cyberpunk.' Where should I go?"

AI: "Head to Akihabara and duck into an upper-floor retro arcade like 'Hirose Entertainment Yard.' The neon reflections on the wet pavement outside plus the 80s synth sounds inside is peak Cyberpunk—no raw fish required."

Human: "Perfect. Is there a quiet spot nearby to grab a drink afterward?"

AI: "Check out 'Bar Sekirei.' It’s a hidden gem with a library-like atmosphere. It’s the perfect 'calm after the storm' vibe to end your trip."

## FLOW

- Start browsing in 'mkbrowser-test'.

- Narrate that we'll be doing an AI chat

- Click on Tools menu icon (data-testid=tools-menu-button)

- On tools menu click the "New AI Chat" menu item (data-testid=menu-new-ai-chat)

- Enter the first human message (see above), into the textarea that should already have focus, if you've given it about one second.

- Queue up the mocked AI answer by calling `queueScriptedAnswer` function passing the first AI response from the Transcript above. This makes the AI engine bypass the actual LLM call, but we don't mention that, because we're pretending to demo a real AI call.

- Then click the "Ask AI" button (data-testid="ask-ai-button")

- You can then make the script wait for "Head to Akihabara" to appear using Playwright APIs.

- Once you detect the string mention that we now have our answer, and that we one to ask another question.

- There should be a "Reply" button (data-testid="ai-reply-button") above the AI's answer so we'll click it next.

...NOTE...The rest is very similar to the above. for the final Question & Answer turns.

- Enter the second human message (see above), into the textarea that should already have focus, if you've given it about one second.

- Queue up the mocked AI answer by calling `queueScriptedAnswer` function passing the second AI response from the Transcript above. This makes the AI engine bypass the actual LLM call again.

- Then click the "Ask AI" button again (data-testid="ask-ai-button")

- You can then make the script wait for "Check out 'Bar Sekirei.'" to appear using Playwright APIs.

- Once you detect the string mention that we now have our answer, and then do whatever other narration you think you want to close out the demo.