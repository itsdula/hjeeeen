HJEN Studio Skills
==================

Files added here appear in the Skills dropdown inside HJEN Studio.
You can also create and edit these files from Library > Skills in the app.

Supported layouts:

1. One Markdown file
   skills/my-skill.md

2. A standard skill folder
   skills/my-skill/SKILL.md

The Markdown entry file can use YAML frontmatter:

---
name: My Skill
description: What this skill changes in the prompt.
version: 1.0.0
---

Write the skill instructions below the frontmatter.

HJEN refreshes the list whenever the Skills dropdown opens or the app regains
focus. Nested reference files are allowed; only SKILL.md is treated as the
entry point inside a skill folder.
