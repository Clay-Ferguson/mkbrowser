# About Technical Notes

The technical notes in this folder describe various specific aspects of our application architecture for the technical audience (software developers) as well as for AI Agents. 

For the purposes of AI Agentic work in the code we create prompts that specifically reference one or more `technical_notes` files as needed, rather than relying on these standardized "SKILLS.md" files like Claude Code (and other agents) would expect to find in a folder named `.claude/skills`.  

We use this `technical_notes` folder (instead of a `skills` folder) for a more explicit control over AI agent context, and to avoid the context bloat associated with loading all the descriptions of skills into the agent context, during every prompt (which is what Agents always do with `SKILLS.md`). Another drawback of the `SKILLS.md` agent standard is that you never really know whether the AI is going to correctly detect exactly which files are relevant to any given conversation.

So our approach and assumption for this `technical_notes`, is that the human developer should absolutely be intimately aware of exactly what documents are here, and exactly which ones are relevant to the agent at any given time, and we'll simply mention them to the agent so the agent can read them. this way we don't waste any context, with unnecessary clutter, and although it takes a tiny amount of human effort at the beginning of each conversation (to select which of these files to mention to the AI), payoff is well worth the effort.




