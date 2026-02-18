# Objective - Playwright Test for "Advanced Search" Feature.

I would like for you to create a new Playwright test (named `advanced-search-demo.spec.ts`), which will be for testing our search feature, using advanced search mode. You'll find a 'SKILL.md' for this if you look, which will help you know how to create the test. As always, you'll be creating the screenshots and the narrative described in the skill and the example mentioned in the skill.

Here's the flow for the test (i.e. action is taken in the GUI), below.

# FLOW

- Start browsing in 'mkbrowser-test'.

- Narrate that we'll be doing an advanced searching inside Federalist Papers content.

- Find HTML element containing 'federalist-papers', and click.

- Click search icon at top of page (data-testid=search-menu-button)

- Click HTML element containing "New Search..."

- Click "Advanced" search option (data-testid=search-type-advanced)

- Find 'search field text area' (data-testid=search-query-input), and enter the string `$("political") && $("free people")` into it as the search text, explaining that it's a boolean "and" to find the files containing both words.

- Enter the text "Political Free People Search" into the search name field (data-testid=search-name-input), mentioning that we're going to save this search under that name.

- Click "search" (data-testid=execute-search-button)

- Wait a second and then assume the search was successful and say so.

- Now we need to switch back to the Browser tab by clicking the tab button (data-testid=tab-button-browser)

- Finally click the search icon at top of page (data-testid=search-menu-button), and explain that we can now see the search definition where we can click it to run it again any time.