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
  /** Records handed to the caller so far. */
  pulled: number;
  /** The caller stopped iterating early, which on a real driver discards the rest. */
  cancelled: boolean;
}

export interface FakeSession {
  config: Record<string, unknown>;
  runs: FakeRun[];
  closed: boolean;
}

/** Rows may be an array, or any iterable -- a generator stands in for a huge result. */
export type FakeRows = Iterable<unknown>;

export interface FakeNeo4jState {
  drivers: Array<{ uri: string; config: Record<string, unknown>; auth?: unknown }>;
  sessions: FakeSession[];
  /** Rows for a query; throw to simulate a database error. */
  respond: (query: string, params: Record<string, unknown>) => FakeRows | Promise<FakeRows>;
  /** How many times the module itself was loaded (set by fakeNeo4jModule). */
  moduleLoads?: number;
}

export function newFakeNeo4jState(): FakeNeo4jState {
  return { drivers: [], sessions: [], respond: () => [], moduleLoads: 0 };
}

export function resetFakeNeo4j(state: FakeNeo4jState): void {
  state.drivers.length = 0;
  state.sessions.length = 0;
  state.respond = () => [];
  state.moduleLoads = 0;
}

/** All query texts run so far, across every session, in order. */
export function queriesRun(state: FakeNeo4jState): string[] {
  return state.sessions.flatMap(s => s.runs.map(r => r.query));
}

const toRecord = (row: unknown) => ({ toObject: () => row });

/**
 * Like the driver's Result: awaitable for every record at once, or
 * async-iterable one record at a time, where `return()` -- what `break` in a
 * `for await` calls -- stops the stream.
 */
function fakeResult(state: FakeNeo4jState, run: FakeRun) {
  let rows: Promise<FakeRows> | undefined;
  const produce = () =>
    (rows ??= Promise.resolve().then(() => state.respond(run.query, run.params)));

  return {
    then<A, B>(
      onFulfilled?: (value: { records: Array<{ toObject: () => unknown }> }) => A,
      onRejected?: (reason: unknown) => B
    ) {
      return produce()
        .then(all => {
          const records: Array<{ toObject: () => unknown }> = [];
          for (const row of all) {
            run.pulled++;
            records.push(toRecord(row));
          }
          return { records };
        })
        .then(onFulfilled, onRejected);
    },
    [Symbol.asyncIterator]() {
      let it: Iterator<unknown> | undefined;
      return {
        async next() {
          it ??= (await produce())[Symbol.iterator]();
          const step = it.next();
          if (step.done) return { done: true as const, value: undefined };
          run.pulled++;
          return { done: false as const, value: toRecord(step.value) };
        },
        async return() {
          run.cancelled = true;
          it?.return?.();
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}

export function fakeNeo4jModule(state: FakeNeo4jState) {
  state.moduleLoads = (state.moduleLoads ?? 0) + 1;
  const neo4j = {
    driver(uri: string, auth: unknown, config: Record<string, unknown> = {}) {
      state.drivers.push({ uri, config, auth });
      return {
        session(sessionConfig: Record<string, unknown> = {}) {
          const session: FakeSession = { config: sessionConfig, runs: [], closed: false };
          state.sessions.push(session);
          return {
            run(
              query: string,
              params: Record<string, unknown> = {},
              txConfig?: Record<string, unknown>
            ) {
              const run: FakeRun = {
                query,
                params,
                config: txConfig,
                pulled: 0,
                cancelled: false,
              };
              session.runs.push(run);
              return fakeResult(state, run);
            },
            async close() {
              session.closed = true;
            },
          };
        },
        async close() {},
      };
    },
    auth: {
      basic: (user: string, password: string) => ({
        scheme: "basic",
        principal: user,
        credentials: password,
      }),
    },
    session: { READ: "READ", WRITE: "WRITE" },
    int: (value: number | string) => ({ __int: Number(value) }),
  };
  return { default: neo4j, ...neo4j };
}
