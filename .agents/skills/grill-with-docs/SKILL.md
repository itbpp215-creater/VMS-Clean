---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.
---

# Grill With Docs

Actively build and sharpen the project's domain model as you design. This skill combines a relentless Socratic interview with active documentation (ADRs and Glossary).

## 1. Grilling (The Interview)

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. Explore the codebase using tools. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty. Do not act on it until the user confirms you have reached a shared understanding.

## 2. Domain Modeling (The Documentation)

As you grill the user, actively write the glossary and decisions down the moment they crystallise. 

### Challenge against the glossary
When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately.

### Update CONTEXT.md inline
When a term is resolved, update `CONTEXT.md` right there. Don't batch these up: capture them as they happen. 
Create `CONTEXT.md` at the root lazily if it doesn't exist.
`CONTEXT.md` should be totally devoid of implementation details. It is a glossary and nothing else.
Reference `CONTEXT-FORMAT.md` in this directory for the format.

### Offer ADRs sparingly
Only offer to create an ADR (Architecture Decision Record) when all three are true:
1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Create them lazily under `docs/adr/`.
Reference `ADR-FORMAT.md` in this directory for the format.
