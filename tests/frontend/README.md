# Frontend unit scope

Holds `*.unit.test.ts` / `*.unit.test.tsx` files that exercise isolated React
components, hooks and client utilities in jsdom. So far only the Pica chat tests
of PAGE-28 live here (`app/components/chat/`, with a fake chat interface in
`chat-fixture.tsx`). `setup.ts` registers React DOM cleanup; it contains no test
cases.

See [scope selection, mocking boundaries and coverage](../README.md).
