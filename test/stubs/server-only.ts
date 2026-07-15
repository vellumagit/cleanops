// No-op stand-in for the `server-only` package under Vitest. The real package
// throws if imported outside a React Server Component build; our unit tests run
// pure logic in Node, where that guard is irrelevant.
export {};
