# Objective - Playwright Test for "Search" Feature.

I would like for you to create a new Playwright test, which will be for testing our search feature. You'll find a 'SKILL.md' for this if you look, which will help you know how to create the test. As always, you'll be creating the screenshots and the narrative described in the skill and the example mentioned in the skill.

Here's the flow for the test (i.e. action is taken in the GUI), below.

# FLOW

- Start browsing in 'mkbrowser-test'.

- Narrate that we'll be searching inside Federalist Papers content.

- Find HTML element containing 'federalist-papers', and click.

- Click search icon at top of page (data-testid=search-menu-button)

- Click HTML element containing "New Search..."

- Find 'search field text area' (data-testid=search-query-input), and enter the string "political" into it as the search text.

- Click "search" (data-testid=execute-search-button)

- Next we'll jump to a search result file by clicking it. Click HTML element containing 'federalist-03/federalist-03-08.md', to jump over to that file.

- Wait a half second or so and , assume see that the file is now visible, and narrate that it is.
