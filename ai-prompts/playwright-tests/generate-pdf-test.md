# Objective - Playwright Test for "Generate PDF" Feature.

I would like for you to create a new Playwright test, which will be for testing our Generate PDF feature. You'll find a 'SKILL.md' (for Playwright) for this if you look, which will help you know how to create the test. As always, you'll be creating the screenshots and the narrative described in the skill and the example mentioned in the skill.

Here's the flow for the test (i.e. action is taken in the GUI), below.

# FLOW

- Start browsing in 'mkbrowser-test'.

- Narrate that we'll be generating a PDF of Federalist Papers content.

- Find HTML element containing 'federalist-papers', and click.

- Click Tools icon at top of page (data-testid=tools-menu-button)

- Click HTML element containing "Export...", which will open the "Export Dialog"

- Find 'Output Folder' text field (data-testid=export-output-folder), and enter the string "/home/clay/exports" into it.

- Find 'File Name' text field (data-textid=export-file-name), and enter "federalist-papers" into it.

- There are 4 checkboxes on the page , and you can click them all, but you don't need to explain each one in the narrative, you can just say we're clicking all four checkboxes. Their data-testids are: export-include-subfolders, export-include-filenames, export-include-dividers, export-to-pdf.

- Click "Export" button (data-testid=export-submit-button), to run the export.

- At this point, en external operating system terminal window will pop up, and run the export. So you can just narrate that this happens and that now we can go to the output folder to view the files, but end the demo/test there without attempting to go look for the output files.