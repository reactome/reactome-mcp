/**
 * A stand-in for `neo4j-driver`, so no test ever opens a socket to a database.
 *
 * Use it with `vi.mock("neo4j-driver", () => fakeNeo4jModule(state))`, where
 * `state` comes from `vi.hoisted(newFakeNeo4jState)` so the mock factory and
 * the test share it across `vi.resetModules()`.
 *
 * It records every driver constructed, every session opened (with its config)
 * and every query run (with its transaction config), and answers queries
 * through `state.respond`, which a test replaces to script the database.
 */

export interface FakeRun {
  query: string;
  params: Record<string, unknown>;
  config: Record<string, unknown> | undefined;
}

export interface FakeSession {
  config: Record<string, unknown>;
  runs: FakeRun[];
  closed: boolean;
}

export interface FakeNeo4jState {
  drivers: Array<{ uri: string; config: Record<string, unknown> }>;
  sessions: FakeSession[];
  /** Rows for a query; throw to simulate a database error. */
  respond: (query: string, params: Record<string, unknown>) => unknown[] | Promise<unknown[]>;
}

export function newFakeNeo4jState(): FakeNeo4jState {
  return { drivers: [], sessions: [], respond: () => [] };
}

export function resetFakeNeo4j(state: FakeNeo4jState): void {
  state.drivers.length = 0;
  state.sessions.length = 0;
  state.respond = () => [];
}

/** All query texts run so far, across every session, in order. */
export function queriesRun(state: FakeNeo4jState): string[] {
  return state.sessions.flatMap(s => s.runs.map(r => r.query));
}

export function fakeNeo4jModule(state: FakeNeo4jState) {
  const neo4j = {
    driver(uri: string, _auth: unknown, config: Record<string, unknown> = {}) {
      state.drivers.push({ uri, config });
      return {
        session(sessionConfig: Record<string, unknown> = {}) {
          const session: FakeSession = { config: sessionConfig, runs: [], closed: false };
          state.sessions.push(session);
          return {
            async run(
              query: string,
              params: Record<string, unknown> = {},
              txConfig?: Record<string, unknown>
            ) {
              session.runs.push({ query, params, config: txConfig });
              const rows = await state.respond(query, params);
              return {
                records: rows.map(row => ({ toObject: () => row })),
              };
            },
            async close() {
              session.closed = true;
            },
          };
        },
        async close() {},
      };
    },
    auth: { basic: (user: string, _password: string) => ({ scheme: "basic", principal: user }) },
    session: { READ: "READ", WRITE: "WRITE" },
    int: (value: number | string) => ({ __int: Number(value) }),
  };
  return { default: neo4j, ...neo4j };
}
