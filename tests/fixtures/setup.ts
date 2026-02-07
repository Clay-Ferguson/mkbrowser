/**
 * Test fixture setup for search tests.
 *
 * Creates ~60 .md and .txt files under <projectRoot>/test-data/ with varied content.
 * The entire test-data/ directory is wiped and rebuilt before the suite runs.
 * Tests MUST NOT modify these files — they are read-only fixtures.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Absolute path to the test-data root */
export const TEST_DATA_DIR = path.resolve(__dirname, '..', '..', 'test-data');

/** Convenience: build the expected relative path for assertions */
export function rel(...segments: string[]): string {
  return segments.join(path.sep);
}

/**
 * Format a Date as MM/DD/YYYY HH:MM AM/PM (matching extractTimestamp's expected format).
 */
function formatDateForFixture(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const hh = String(h).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} ${hh}:${min} ${ampm}`;
}

// ─── File definitions ────────────────────────────────────────────────
// Each entry is [relativePath, content].
// Content is designed so that specific search queries hit a known set of files.

const FILES: [string, string][] = [
  // ── Top-level files ──────────────────────────────────────────────
  ['readme.md', `# Project Overview

This project demonstrates various features of the MkBrowser application.
It is designed for browsing Markdown files with inline rendering.
`],

  ['notes.txt', `Random notes file.
Remember to pick up groceries.
The quick brown fox jumps over the lazy dog.
Meeting scheduled for 03/15/2026 10:00 AM.
`],

  ['empty.md', ''],

  ['special-chars.md', '# Special Characters Test\n\nThis file contains special regex characters: .+?^${}()|[]\\\\\nBrackets [like this] and parentheses (like this) appear here.\nPrice is $19.99 plus tax.\nEmail: user@example.com\n'],

  ['unicode.md', `# Unicode Content

Héllo wörld! Ñoño café résumé naïve.
日本語テスト Chinese: 中文测试
Emoji: 🚀 🎉 ✅
`],

  // ── docs/ subfolder ──────────────────────────────────────────────
  ['docs/getting-started.md', `# Getting Started

Welcome to the getting started guide.
First, install the dependencies using npm install.
Then run the application with npm start.
The application will open in your default browser.
`],

  ['docs/api-reference.md', `# API Reference

## searchFolder

The searchFolder function accepts a folder path and query string.
It returns an array of SearchResult objects.

## createContentSearcher

Creates a content searcher that checks for case-insensitive matches.
`],

  ['docs/faq.md', `# Frequently Asked Questions

Q: How do I search for files?
A: Use the search dialog (Ctrl+F) to search file contents.

Q: Can I use wildcards?
A: Yes, use * as a wildcard character in wildcard mode.

Q: What file types are searched?
A: Only .md and .txt files are searched for content.
`],

  ['docs/changelog.md', `# Changelog

## Version 2.0.0
- Added wildcard search support
- Improved search performance
- Fixed bug in literal search matching

## Version 1.0.0
- Initial release
- Basic literal search
- File browsing capability
`],

  ['docs/architecture.md', `# Architecture

The application follows a three-process architecture:
1. Main process handles file system operations
2. Preload process bridges main and renderer
3. Renderer process handles the React UI

Search is performed in the main process using the fdir library.
`],

  // ── topics/science/ subfolder ────────────────────────────────────
  ['topics/science/physics.md', `# Physics Notes

Newton's laws of motion:
1. An object at rest stays at rest
2. Force equals mass times acceleration (F=ma)
3. Every action has an equal and opposite reaction

The speed of light is approximately 299,792,458 meters per second.
Einstein's theory of relativity changed our understanding of physics.
`],

  ['topics/science/chemistry.md', `# Chemistry Notes

The periodic table organizes elements by atomic number.
Water (H2O) is composed of hydrogen and oxygen.
Chemical reactions involve the rearrangement of atoms.
The pH scale measures acidity from 0 to 14.
`],

  ['topics/science/biology.md', `# Biology Notes

Cells are the basic unit of life.
DNA contains the genetic blueprint for organisms.
Photosynthesis converts sunlight into chemical energy.
Evolution occurs through natural selection over time.
The mitochondria is the powerhouse of the cell.
`],

  ['topics/science/astronomy.txt', `Astronomy Notes

The Milky Way galaxy contains billions of stars.
Jupiter is the largest planet in our solar system.
The speed of light is approximately 299,792,458 meters per second.
Black holes are regions where gravity is so strong that nothing can escape.
The universe is approximately 13.8 billion years old.
`],

  // ── topics/math/ subfolder ───────────────────────────────────────
  ['topics/math/calculus.md', `# Calculus

The derivative measures the rate of change of a function.
Integration is the reverse of differentiation.
The fundamental theorem of calculus connects derivatives and integrals.
Limits are the foundation of calculus.
`],

  ['topics/math/algebra.md', `# Algebra

Solving equations involves isolating the variable.
Quadratic equations can be solved using the quadratic formula.
Linear equations graph as straight lines.
Polynomials are expressions with multiple terms.
`],

  ['topics/math/statistics.txt', `Statistics Notes

The mean is the average of a dataset.
Standard deviation measures the spread of data.
Normal distribution follows a bell curve shape.
Correlation does not imply causation.
Probability ranges from 0 to 1.
`],

  // ── topics/programming/ subfolder ────────────────────────────────
  ['topics/programming/javascript.md', `# JavaScript Guide

JavaScript is a dynamic programming language.
Functions are first-class citizens in JavaScript.
The DOM allows JavaScript to manipulate HTML elements.
Promises handle asynchronous operations.
Arrow functions provide concise syntax.
The event loop manages JavaScript's single-threaded execution.
`],

  ['topics/programming/typescript.md', `# TypeScript Guide

TypeScript adds static typing to JavaScript.
Interfaces define the shape of objects.
Generics allow writing reusable typed code.
TypeScript compiles to plain JavaScript.
The compiler catches type errors at build time.
`],

  ['topics/programming/python.md', `# Python Guide

Python is known for its readable syntax.
Indentation is used to define code blocks.
List comprehensions provide concise iteration.
Python supports both procedural and object-oriented programming.
The speed of development is one of Python's strengths.
`],

  ['topics/programming/rust.md', `# Rust Guide

Rust ensures memory safety without garbage collection.
The borrow checker prevents data races at compile time.
Ownership is a key concept in Rust.
Pattern matching with match is powerful and expressive.
Rust achieves performance comparable to C and C++.
`],

  ['topics/programming/go.txt', `Go Programming Language

Go (or Golang) was created at Google.
Goroutines enable lightweight concurrent programming.
Channels facilitate safe communication between goroutines.
Go compiles to a single static binary.
The standard library is comprehensive and well-designed.
`],

  ['topics/programming/sql.md', `# SQL Guide

SQL is used for managing relational databases.
SELECT statements retrieve data from tables.
JOIN operations combine data from multiple tables.
Indexes improve query performance significantly.
Transactions ensure data consistency using ACID properties.
`],

  // ── journal/ subfolder (files with timestamps) ───────────────────
  ['journal/entry-2026-01-15.md', `# Journal Entry
01/15/2026 9:30 AM

Today I started working on the search feature.
The literal search mode is working correctly now.
Need to implement wildcard search next.
`],

  ['journal/entry-2026-01-20.md', `# Journal Entry
01/20/2026 2:00 PM

Wildcard search is now complete.
Testing with various patterns shows good results.
The search performance is excellent.
`],

  ['journal/entry-2026-02-01.md', `# Journal Entry  
02/01/2026 10:00 AM

Starting work on advanced search expressions.
The $ function for content searching is implemented.
Need to add timestamp extraction next.
`],

  ['journal/entry-2026-02-05.md', `# Journal Entry
02/05/2026 3:30 PM

Advanced search is feature-complete.
All three search modes are working:
- Literal: simple text matching
- Wildcard: pattern matching with *
- Advanced: JavaScript expression evaluation
`],

  ['journal/old-entry.md', `# Old Journal Entry
06/15/2024 8:00 AM

This is an older entry from 2024.
It should not match future() searches in 2026.
`],

  // ── projects/ subfolder ──────────────────────────────────────────
  ['projects/webapp.md', `# Web Application Project

This project uses React for the frontend.
The backend is built with Node.js and Express.
PostgreSQL is the database of choice.
The application is deployed on AWS.
User authentication uses JSON Web Tokens (JWT).
`],

  ['projects/mobile-app.md', `# Mobile Application Project

Built using React Native for cross-platform support.
The app communicates with a REST API backend.
Push notifications are handled through Firebase.
Local storage uses SQLite for offline capability.
`],

  ['projects/cli-tool.md', `# CLI Tool Project

A command-line tool written in TypeScript.
It parses arguments using the commander library.
Output is formatted with chalk for colored terminal text.
The tool supports both interactive and batch modes.
Configuration is stored in a YAML file.
`],

  ['projects/data-pipeline.txt', `Data Pipeline Project

An ETL pipeline processing large datasets.
Apache Kafka handles real-time data streaming.
Data is transformed using Apache Spark.
Results are stored in a data warehouse.
The pipeline processes millions of records daily.
`],

  // ── recipes/ subfolder (for fun variety) ─────────────────────────
  ['recipes/chocolate-cake.md', `# Chocolate Cake Recipe

## Ingredients
- 2 cups flour
- 1 cup sugar
- 3/4 cup cocoa powder
- 2 eggs
- 1 cup milk
- 1/2 cup vegetable oil

## Instructions
1. Preheat oven to 350°F
2. Mix dry ingredients together
3. Add wet ingredients and stir until smooth
4. Pour into greased pan
5. Bake for 30-35 minutes
`],

  ['recipes/pasta-sauce.md', `# Pasta Sauce Recipe

## Ingredients
- 2 cans crushed tomatoes
- 4 cloves garlic, minced
- 1 onion, diced
- Fresh basil
- Olive oil
- Salt and pepper

## Instructions
1. Heat olive oil in a large pan
2. Sauté onion and garlic until soft
3. Add crushed tomatoes and simmer
4. Season with salt, pepper, and basil
5. Cook for 20 minutes on low heat
`],

  ['recipes/smoothie.txt', `Green Smoothie Recipe

Ingredients:
- 1 banana
- 1 cup spinach
- 1/2 cup blueberries
- 1 cup almond milk
- 1 tablespoon honey

Blend all ingredients until smooth. Serves 1.
`],

  // ── nested/deep/structure/ subfolder ─────────────────────────────
  ['nested/deep/structure/deep-file.md', `# Deep File

This file is nested deeply in the directory structure.
It should still be found by recursive search.
The search algorithm traverses all subdirectories.
`],

  ['nested/deep/structure/another-deep-file.txt', `Another deeply nested file.
This one is a .txt file instead of .md.
Both file types should be searchable.
`],

  // ── case-testing/ subfolder ──────────────────────────────────────
  ['case-testing/uppercase.md', `# UPPERCASE CONTENT

THIS ENTIRE FILE IS IN UPPERCASE.
SEARCHING SHOULD BE CASE-INSENSITIVE.
THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.
`],

  ['case-testing/mixedcase.md', `# Mixed Case Content

ThIs FiLe HaS mIxEd CaSe TeXt.
The Quick Brown Fox Jumps Over The Lazy Dog.
camelCaseVariable and PascalCaseClass are common patterns.
snake_case_variable is used in Python.
`],

  ['case-testing/lowercase.txt', `all lowercase content here.
no capital letters at all.
the quick brown fox jumps over the lazy dog.
searching should find this regardless of query case.
`],

  // ── duplicates/ subfolder (same content in multiple files) ───────
  ['duplicates/copy-one.md', `# Duplicate Content

This exact paragraph appears in multiple files.
The search should find all copies and report correct match counts.
Unique marker: ALPHA-DUPLICATE-MARKER
`],

  ['duplicates/copy-two.md', `# Duplicate Content

This exact paragraph appears in multiple files.
The search should find all copies and report correct match counts.
Unique marker: ALPHA-DUPLICATE-MARKER
`],

  ['duplicates/copy-three.md', `# Duplicate Content

This exact paragraph appears in multiple files.
The search should find all copies and report correct match counts.
Unique marker: ALPHA-DUPLICATE-MARKER
`],

  // ── multi-match/ subfolder (files with repeated terms) ──────────
  ['multi-match/repeated.md', `# Repeated Terms

apple apple apple
This file contains the word apple three times on one line.
And here is apple again on another line.
That makes four total occurrences of apple in this file.
Plus one more apple for five total.
`],

  ['multi-match/single-match.md', `# Single Match

This file contains exactly one instance of the word banana.
No other mentions of that particular fruit.
`],

  ['multi-match/no-match.md', `# No Matching Terms

This file is designed to NOT match common search terms.
It contains only generic text with no special keywords.
Nothing interesting to find here.
`],

  // ── Non-searchable files (should be ignored by content search) ──
  ['images/photo.jpg', 'FAKE_BINARY_DATA_NOT_REAL_IMAGE'],
  ['data/config.json', '{"key": "value", "search": "should not appear"}'],
  ['data/settings.yaml', 'search_term: should_not_appear_in_results\n'],

  // ── wildcard-testing/ subfolder ──────────────────────────────────
  ['wildcard-testing/hello-world.md', `# Hello World

This is a hello world example file.
hello_world and helloWorld are naming conventions.
`],

  ['wildcard-testing/help-wanted.md', `# Help Wanted

Looking for contributors to help with testing.
Any help is appreciated.
`],

  ['wildcard-testing/hero-banner.md', `# Hero Banner

The hero section displays a large banner image.
Heroes of open source contribute daily.
`],

  ['wildcard-testing/boundaries.md', `# Boundary Tests

StartMARKEREnd appears as one word.
MARKER is also standalone on this line.
PrefixMARKER and MARKERSuffix test boundaries.
ALPHA_1234567890_1234567890_12345_OMEGA on this line the gap exceeds twenty five characters.
`],

  ['wildcard-testing/multi-wildcard.md', `# Multi Wildcard

The cat sat on the mat.
The car drove past the bar.
A dog and a log in the fog.
`],

  // ── line-numbers/ subfolder (for file-lines mode testing) ────────
  ['line-numbers/known-lines.md', `Line one has nothing special.
Line two contains TARGET_WORD here.
Line three is plain text.
Line four also has TARGET_WORD in it.
Line five is the last line.`],

  ['line-numbers/multi-per-line.md', `No matches on line one.
FIND_ME and FIND_ME appear twice on line two.
Line three says hello.
FIND_ME shows up once on line four.
Empty line follows.
`],

  // ── ignored-test/ subfolder (for ignoredPaths testing) ───────────
  ['ignored-test/visible-file.md', `# Visible File

This file should appear in search results.
It contains the word IGNORED_TEST_MARKER.
`],

  ['ignored-test/skipme/hidden-file.md', `# Hidden File

This file is inside the skipme folder.
It also contains IGNORED_TEST_MARKER but should be excluded.
`],

  ['ignored-test/also-skip.md', `# Also Skip

This file should be excluded by name pattern.
IGNORED_TEST_MARKER is here too.
`],
];

/**
 * Wipe and recreate the entire test-data/ directory with all fixture files.
 * Call this in beforeAll() for the search test suite.
 */
export async function setupTestData(): Promise<void> {
  // Remove existing test-data directory if it exists
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }

  // Create all static files
  for (const [relativePath, content] of FILES) {
    const fullPath = path.join(TEST_DATA_DIR, relativePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  // Create dynamic timestamp files (dates relative to "now")
  const now = new Date();

  const todayDate = formatDateForFixture(now);
  writeFixture('journal/entry-today.md', `# Today's Entry\n${todayDate}\n\nThis entry was created today.\nTODAY_MARKER is here for identification.\n`);

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowDate = formatDateForFixture(tomorrow);
  writeFixture('journal/entry-tomorrow.md', `# Tomorrow's Entry\n${tomorrowDate}\n\nThis entry has a future date.\nFUTURE_MARKER is here for identification.\n`);

  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextWeekDate = formatDateForFixture(nextWeek);
  writeFixture('journal/entry-next-week.md', `# Next Week Entry\n${nextWeekDate}\n\nThis entry is one week from now.\nFUTURE_WEEK_MARKER is here.\n`);

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayDate = formatDateForFixture(yesterday);
  writeFixture('journal/entry-yesterday.md', `# Yesterday's Entry\n${yesterdayDate}\n\nThis entry has yesterday's date.\nRECENT_PAST_MARKER is here.\n`);

  const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const farFutureDate = formatDateForFixture(farFuture);
  writeFixture('journal/entry-far-future.md', `# Far Future Entry\n${farFutureDate}\n\nThis entry is a year from now.\nFAR_FUTURE_MARKER is here.\n`);
}

/** Helper to write a single fixture file */
function writeFixture(relativePath: string, content: string): void {
  const fullPath = path.join(TEST_DATA_DIR, relativePath);
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

/**
 * Remove the test-data/ directory entirely.
 * Call this in afterAll() if desired, or leave for inspection.
 */
export async function teardownTestData(): Promise<void> {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}
