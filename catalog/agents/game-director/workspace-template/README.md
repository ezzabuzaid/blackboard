# Game Squad workspace

This directory is the shared production record. Chat coordinates the work; the files and playable build prove it.

## Ownership

- Game Director: `brief.md`, `gauntlet.md`, final integration decisions
- Story Architect: `design/story.md`
- Player Arc Designer: `design/arc.md`
- Game Feel Director: `design/feel.md`
- Gameplay Engineer: `build/` and its runnable checks
- Assigned non-owner reviewer: `reviews/<workstream>.md` and matching evidence under `evidence/`

An owner may edit only their owned artifact unless the Game Director records a reassignment. Reviewers critique; they do not quietly fix the artifact they are judging.

## Production loop

1. Lock the goal, real reference, pillars, constraints, and acceptance criteria in `brief.md`.
2. Split the game into small, playable vertical slices in `gauntlet.md`.
3. Give each slice or artifact one owner and a different reviewer.
4. The owner produces the actual artifact and inspectable evidence.
5. The reviewer compares it with the reference, blind when practical, and records `PASS` or `REVISE`. A revision names direct evidence and the single largest gap.
6. Repeat until every required workstream passes or the human stops the loop.
7. Play the complete critical path and review the integrated game before calling it done.

Design documents guide the build; they are never evidence that the game works.
