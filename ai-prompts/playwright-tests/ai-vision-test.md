# Objective - Playwright Test for Demoing (faking) the following contrived AI Chat

you'll be creating the entire playwright test case, that showcases the following chat sequence between the human and the AI. Notice you have a `SKILL.md` file for playwrite tests.

## FLOW

- Start browsing in 'mkbrowser-test'.

- Narrate that we'll be doing an AI vision query

- Highlight the element on the page that contains the text `ai-vision-demo`. Mention we'll be going into the 'ai-vision-demo` folder (then search search for that text and click it, because that's the folder name we're going into)

- mention that we're now seeing the image we're going to be asking a question about , and take a screenshot of the page .

- at this point, run the code to check and verify that the folder we're browsing in only has a single file in it in that that file is named `mystery-location.png`, and if that's not the case, then print an error message saying that this test must be run with this folder only having that image in it (for this verification, you're not mentioning anything and the narration , and it's not part of the test , it's just validating that the folder we're in is ready to go and cleaned out from previous runs .)

- Click on Tools menu icon (data-testid=tools-menu-button), after first narrating that we're going to click on it and highlighting it and taking a screenshot .

- On tools menu click the "New AI Chat" menu item (data-testid=menu-new-ai-chat)

- that will have taken the user to the chat tab, so mention that we're on the chat tab view, and we'll enter our query here.

- enter the following text into the text area for the prompt: "What's in this image? Where is this located?\n\n#file:*" (you won't be including the double quotes and you'll need to convert the \n\n to actual new line characters )

- mentioned to the user that our prompt will send the image to the AI only because we have because we have included "#file:*" (we're just called a file directive), and explaining that the asterisk at the end of that is a wild card so that everything including the image we just saw gets sent to the AI. 

- Queue up the mocked AI answer (below) by calling `queueScriptedAnswer` function passing the answer text to it. This makes the AI engine bypass the actual LLM call, but we don't mention that, because we're pretending to demo a real AI call.
<answer>
- What’s in the image: Mont Saint-Michel—the iconic tidal island with a medieval abbey at the top and a village on the slopes. It’s lit up, with water and marshes around that reflect the lights.

- Where it’s located: Mont Saint-Michel, in Normandy, France (off the coast in the bay near Avranches, Manche). It’s a famous UNESCO World Heritage site.
</answer>

- Then click the "Ask AI" button (data-testid="ask-ai-button")

- You can then make the script wait for "Saint-Michel" to appear using Playwright APIs.

- Once you detect the string mention that we now have our answer.

- next mention that we can now go back over to the browse tab, to see the files and folders, hold the conversation. but find and highlight the browser tab by searching for the element that contains the text "Browse" and highlighting that , then click it after you've told the user we're going to go to the browser view .

- now mention that we'll have to click the "Up Level" button to go up one level in the folders to see where we started out from , and have the  (data-testid="navigate-up-button") highlighter does you say that .

- then click the button "Up Level" ( data-testid="navigate-up-button") and wait a second and then mentioned to the user that we're now back where we started and we can see that our answer folder is there. then mention that we can continue the conversation by branching at any location we want and we can do it all from in the browse tab or from in the chat tab ,