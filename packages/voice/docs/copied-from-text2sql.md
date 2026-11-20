# Code copied from text2sql

This package is a copy of text2sql's `@genui/voice` (`packages/genui/voice`). It was taken from text2sql commit `3a4847ec` (2026-08-12) in blackboard commit `507f00e` the same day. Both copies keep the package name `@genui/voice`.

The code stays copied until it moves to zukhruf (backlog #4920). Until then, a fix in one copy is made in the other copy too, and the commit names both files.

Paths on the left are in text2sql `packages/genui/voice/src`. Paths on the right are in `packages/voice/src`.

## Copied without a change

| text2sql                                 | blackboard                               |
| ---------------------------------------- | ---------------------------------------- |
| `index.ts`                               | `index.ts`                               |
| `lib/voice-recorder-controller.test.tsx` | `lib/voice-recorder-controller.test.tsx` |

`lib/voice-recorder-controller.tsx` differs only in formatting (double quotes, no semicolons) and in a shorter comment on the Strict Mode reset.

## Copied with changes

**`lib/use-voice-transcription.tsx`**

- The hook does not call `useAgentStatus()` of `@workspace/genai`. The caller passes `disabled` instead. While it is true, a new recording cannot start, and a recording in progress can still stop.
  Why: blackboard has no `@workspace/genai`. Its composer knows when a turn may not start (`meta.disabled` in `apps/web/src/routes/ChatBot/ChatComposer.tsx`).
- A failed transcription shows the error's `message`, or `Transcription failed`. text2sql shows the form issues that `errorToFormIssue` of `@stdlib/ui` finds.
  Why: blackboard has no `@stdlib/ui`.
- The result reads `text.trim()`, not `text?.trim()`, because the transport's type promises a string.
- The comments are shorter. `controller` is `unmount`, and `err` is `cause`.

**`lib/VoiceRecordButton.tsx`.** The button passes `disabled` to the hook. The hook's `disabled` result is named `blocked` inside the button.

**`lib/VoiceRecordButton.test.tsx`.** The test does not mock `@workspace/genai`. A `VoiceButton` helper renders the button. One test is new: "honors caller state before starting a recording". Two tests have shorter names.

**`package.json`.** The entry point is `./src/index.ts`, with no build. The dependencies are react, lucide-react and react-media-recorder only.

**Only in blackboard:** `test-setup.ts`. text2sql removed its setup files in `8e107108` and points `setupFiles` at `@testing-library/jest-dom/vitest`.

## Fixes made in both copies

- The microphone permission effect stops on an `AbortController`: text2sql `d6ecfd02` (2026-11-02), blackboard `894a056` (2026-11-09).

## Fixes that do not apply here

- text2sql `ba09444d` (2026-09-09) reads `issues?.form`, because `errorToFormIssue` can give nothing. This copy does not use `errorToFormIssue`.
