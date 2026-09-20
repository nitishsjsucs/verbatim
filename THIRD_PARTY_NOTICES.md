# Third-party material

Verbatim itself is MIT licensed — see [LICENSE](LICENSE). Some files in this
repository were not written for it and carry their own upstream licenses. They
are listed here so the attribution travels with the code.

## shadcn/ui — `web/src/components/ui/`

The UI primitives (`button.tsx`, `card.tsx`, `dialog.tsx`, `dropdown-menu.tsx`,
`avatar.tsx`, `input.tsx`, `label.tsx`, `scroll-area.tsx`, `separator.tsx`,
`sheet.tsx`, `table.tsx`) were added with the shadcn/ui CLI, which copies
component source into the consuming project rather than shipping it as a
dependency. `web/components.json` records the generator configuration.

- Upstream: https://github.com/shadcn-ui/ui
- License: MIT — see the upstream repository for the full notice.
- Built on Radix UI primitives (MIT), consumed as the `radix-ui` npm dependency.

## Better Auth documentation — `llms.txt`

`llms.txt` is a verbatim copy of the Better Auth documentation index, kept in the
tree as a reference for the auth integration in `web/`.

- Upstream: https://github.com/better-auth/better-auth
- License: MIT — see the upstream repository for the full notice.

## Convex generated code — `convex_qwerty/_generated/`

Produced by the Convex CLI (`npx convex dev`); the files carry a
"THIS CODE IS AUTOMATICALLY GENERATED" header. Regenerate rather than edit.

- Upstream: https://github.com/get-convex/convex-js
- License: Apache-2.0 — see the upstream repository for the full notice.

The Convex agent skills referenced by `convex_qwerty/skills-lock.json` are
fetched from https://github.com/get-convex/agent-skills and are not vendored
into this repository.

## Next.js scaffold — `web/`

`web/` was bootstrapped with `create-next-app`; `web/README.md` is the
unmodified scaffold README.

- Upstream: https://github.com/vercel/next.js
- License: MIT — see the upstream repository for the full notice.

## Evaluation source material — `rbi_open_ended_300_qa.md`, `tests/accuracy/kyc_qa_bank.json`

The evaluation question banks are derived from public Reserve Bank of India
directions — RBI/DOR/2025-26/163 (Commercial Banks – Asset Liability Management)
and RBI/DOR/2025-26/169 (Commercial Banks – Know Your Customer). The questions
and reference answers were written for this project; the underlying regulatory
text is a public Government of India document and is reproduced only in
quotation and paraphrase.
