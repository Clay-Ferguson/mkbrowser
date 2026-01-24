---
name: app-pages
description: Pattern for application pages
---

# Instructions

## Page Name and Component Location

Pages are the different top level views (aka panels) that we display in the application. Their names are defined in file `src/store/types.ts` in the following line of code, which shows two string types.

```
export type AppView = 'browser' | 'search-results';
```

The 'browser' one is the main default application `src/App.tsx`, but any pages other than the main (browser) page should follow a pattern similar to what you find in `src/components/SearchResultsView.tsx`

## Main Menu

Each page needs to have a main menu item for selecting it under the `Page` main application window, so for example menu `Page -> Browser` takes the user to the 'browser' page. When the user selects a particuar 'page' we update the `currentView` in the global `AppState`, and that causes the page to display at next render.