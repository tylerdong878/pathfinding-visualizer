"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type AlgorithmKey,
  type Coord,
  type GridNode,
  type SearchResult,
  createGrid,
  generateSolvableWalls,
  runSearch,
} from "@/lib/algorithms";

/** Slowest the reveal ever goes: milliseconds between each explored cell. */
const VISIT_INTERVAL_MS = 12;
/** Slowest the reveal ever goes: milliseconds between each route cell. */
const PATH_INTERVAL_MS = 32;
/** Ceiling on the whole search replay, however many cells were checked. */
const MAX_SEARCH_MS = 2600;
/** Ceiling on the route reveal. */
const MAX_PATH_MS = 1200;

interface RunStats {
  explored: number;
  steps: number;
  found: boolean;
}

interface Dimensions {
  rows: number;
  cols: number;
}

const ALGORITHMS: { key: AlgorithmKey; label: string; tagline: string }[] = [
  { key: "astar", label: "A* Search", tagline: "aims toward the goal" },
  {
    key: "bfs",
    label: "Breadth-First Search",
    tagline: "checks every direction equally",
  },
];

/**
 * Picks a grid shape that fits the available width. Cells are always square, so
 * the column count is what actually drives the layout.
 */
function computeDimensions(width: number): Dimensions {
  const targetCellSize = width < 480 ? 18 : width < 768 ? 22 : 25;
  const cols = Math.max(15, Math.min(55, Math.floor(width / targetCellSize)));
  const rows = Math.max(11, Math.min(25, Math.round(cols * 0.45)));
  return { rows, cols };
}

function defaultEndpoints({ rows, cols }: Dimensions): {
  start: Coord;
  finish: Coord;
} {
  const row = Math.floor(rows / 2);
  return {
    start: { row, col: Math.max(1, Math.floor(cols * 0.15)) },
    finish: { row, col: Math.min(cols - 2, Math.floor(cols * 0.85)) },
  };
}

function sameCoord(a: Coord, b: Coord) {
  return a.row === b.row && a.col === b.col;
}

/**
 * A single square. Memoised on primitives so that painting one wall re-renders
 * one cell rather than all thirteen hundred of them. It carries no event
 * handlers at all. The parent reads `data-row` / `data-col` off the pointer
 * target instead, which keeps the props stable.
 */
const Cell = memo(function Cell({
  row,
  col,
  isStart,
  isFinish,
  isWall,
}: {
  row: number;
  col: number;
  isStart: boolean;
  isFinish: boolean;
  isWall: boolean;
}) {
  const state = isStart ? "node-start" : isFinish ? "node-finish" : isWall ? "node-wall" : "";
  return (
    <div
      id={`node-${row}-${col}`}
      data-row={row}
      data-col={col}
      className={`node aspect-square ${state}`}
    />
  );
});

export default function PathVisualizer() {
  const containerRef = useRef<HTMLDivElement>(null);

  const [dimensions, setDimensions] = useState<Dimensions | null>(null);
  const [grid, setGrid] = useState<GridNode[][]>([]);
  const [start, setStart] = useState<Coord>({ row: 0, col: 0 });
  const [finish, setFinish] = useState<Coord>({ row: 0, col: 0 });

  // Breadth-first runs first by default. On a clear board it is by far the better
  // show, and it matches the order the argument is made in: the naive search
  // first, then the guided one as the payoff.
  const [algorithm, setAlgorithm] = useState<AlgorithmKey>("bfs");
  const [isAnimating, setIsAnimating] = useState(false);
  const [runId, setRunId] = useState(0);
  const [results, setResults] = useState<Partial<Record<AlgorithmKey, RunStats>>>({});

  // Painting state lives in refs: it changes on every pointer move and must not
  // trigger a re-render of the grid.
  const paintModeRef = useRef<"draw" | "erase" | "start" | "finish" | null>(null);
  const lastPaintedRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);
  const dimensionsRef = useRef<Dimensions | null>(null);
  // Written by the run button and drained after the next commit, so the
  // queues are only replayed once the freshly remounted grid is in the DOM.
  const pendingRunRef = useRef<SearchResult | null>(null);

  /* ---------------------------------------------------------------- sizing */

  /**
   * Builds a fresh board at the given shape. Any walls the visitor had drawn are
   * dropped rather than remapped, since they no longer mean anything once the
   * grid has been re-cut at a different resolution.
   */
  const buildBoard = useCallback((next: Dimensions) => {
    const endpoints = defaultEndpoints(next);

    dimensionsRef.current = next;
    setDimensions(next);
    setStart(endpoints.start);
    setFinish(endpoints.finish);
    setGrid(createGrid(next.rows, next.cols, endpoints.start, endpoints.finish));
    setResults({});
    setRunId((id) => id + 1);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    // ResizeObserver delivers an initial callback as soon as it starts
    // observing, which doubles as the first measurement, so no synchronous read
    // needed here.
    const observer = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      if (width <= 0) return;

      const next = computeDimensions(width);
      const current = dimensionsRef.current;
      if (current && current.rows === next.rows && current.cols === next.cols) return;
      buildBoard(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [buildBoard]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* ------------------------------------------------------------- animation */

  /** Wipes every search-animation class by remounting the grid subtree. */
  const clearSearchPaint = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    isAnimatingRef.current = false;
    setIsAnimating(false);
    pendingRunRef.current = null;
    setRunId((id) => id + 1);
  }, []);

  /**
   * Drops the scoreboard, because a stat from a different wall layout is not a
   * fair comparison. Returns the same object when already empty so that dragging
   * a wall does not re-render the whole component on every pointer move.
   */
  const clearResults = useCallback(() => {
    setResults((current) => (Object.keys(current).length === 0 ? current : {}));
  }, []);

  const paintNode = useCallback((node: GridNode, className: string) => {
    if (node.isStart || node.isFinish) return;
    document.getElementById(`node-${node.row}-${node.col}`)?.classList.add(className);
  }, []);

  /**
   * Replays the two queues against the DOM directly.
   *
   * A single requestAnimationFrame loop drives the whole run: on each frame it
   * works out how many cells *should* be lit by now from the elapsed time and
   * catches up. That means no React re-renders mid-animation, one cancellable
   * handle instead of a few thousand timers, and a reveal rate that stays
   * honest even when the browser drops a frame.
   */
  const animate = useCallback(
    (visitedNodes: GridNode[], pathNodes: GridNode[]) => {
      // Breadth-first on a clear board floods the whole grid, so a fixed
      // per-cell delay would run for the better part of ten seconds. Speed the
      // reveal up as the queue gets longer to keep the run watchable.
      const visitStep = Math.min(
        VISIT_INTERVAL_MS,
        MAX_SEARCH_MS / Math.max(1, visitedNodes.length),
      );
      const pathStep = Math.min(PATH_INTERVAL_MS, MAX_PATH_MS / Math.max(1, pathNodes.length));

      let startTimestamp: number | null = null;
      let visitedIndex = 0;
      let pathIndex = 0;

      const step = (timestamp: number) => {
        if (startTimestamp === null) startTimestamp = timestamp;
        const elapsed = timestamp - startTimestamp;

        const visitedTarget = Math.min(visitedNodes.length, Math.floor(elapsed / visitStep));
        while (visitedIndex < visitedTarget) {
          paintNode(visitedNodes[visitedIndex], "node-visited");
          visitedIndex++;
        }

        if (visitedIndex >= visitedNodes.length) {
          const pathElapsed = elapsed - visitedNodes.length * visitStep;
          const pathTarget = Math.min(pathNodes.length, Math.floor(pathElapsed / pathStep));
          while (pathIndex < pathTarget) {
            paintNode(pathNodes[pathIndex], "node-path");
            pathIndex++;
          }

          if (pathIndex >= pathNodes.length) {
            rafRef.current = null;
            isAnimatingRef.current = false;
            setIsAnimating(false);
            return;
          }
        }

        rafRef.current = requestAnimationFrame(step);
      };

      rafRef.current = requestAnimationFrame(step);
    },
    [paintNode],
  );

  const handleVisualize = useCallback(() => {
    if (isAnimatingRef.current || grid.length === 0) return;

    const result = runSearch(grid, start, finish, algorithm);
    const { visitedNodesInOrder, shortestPathNodes } = result;

    isAnimatingRef.current = true;
    setIsAnimating(true);
    pendingRunRef.current = result;
    // Remounting wipes the previous run's classes off the board, and the bumped
    // id is what wakes the effect below once that commit has landed.
    setRunId((id) => id + 1);
    setResults((current) => ({
      ...current,
      [algorithm]: {
        explored: visitedNodesInOrder.length,
        steps: Math.max(0, shortestPathNodes.length - 1),
        found: shortestPathNodes.length > 0,
      },
    }));
  }, [algorithm, finish, grid, start]);

  // Effects run after the DOM commit, so the elements the animation is about to
  // paint are guaranteed to be the newly mounted ones.
  useEffect(() => {
    const pending = pendingRunRef.current;
    if (!pending) return;
    pendingRunRef.current = null;
    animate(pending.visitedNodesInOrder, pending.shortestPathNodes);
  }, [animate, runId]);

  /* ---------------------------------------------------------- board edits */

  const handleClearWalls = useCallback(() => {
    setGrid((current) => current.map((row) => row.map((node) => ({ ...node, isWall: false }))));
    setResults({});
    clearSearchPaint();
  }, [clearSearchPaint]);

  const handleReset = useCallback(() => {
    if (!dimensions) return;
    clearSearchPaint();
    buildBoard(dimensions);
  }, [buildBoard, clearSearchPaint, dimensions]);

  const handleRandomWalls = useCallback(() => {
    if (!dimensions) return;
    const walls = generateSolvableWalls(dimensions.rows, dimensions.cols, start, finish);
    setGrid((current) =>
      current.map((row, r) => row.map((node, c) => ({ ...node, isWall: walls[r][c] }))),
    );
    setResults({});
    clearSearchPaint();
  }, [clearSearchPaint, dimensions, finish, start]);

  const setWall = useCallback(
    (row: number, col: number, isWall: boolean) => {
      setGrid((current) => {
        const node = current[row]?.[col];
        if (!node || node.isStart || node.isFinish || node.isWall === isWall) return current;
        const next = current.map((r) => r.slice());
        next[row][col] = { ...node, isWall };
        return next;
      });
      clearResults();
    },
    [clearResults],
  );

  const moveEndpoint = useCallback(
    (kind: "start" | "finish", to: Coord) => {
      const from = kind === "start" ? start : finish;
      const other = kind === "start" ? finish : start;
      if (sameCoord(from, to) || sameCoord(other, to)) return;

      const flag = kind === "start" ? "isStart" : "isFinish";
      setGrid((current) => {
        if (!current[to.row]?.[to.col]) return current;
        const next = current.map((r) => r.slice());
        next[from.row][from.col] = {
          ...next[from.row][from.col],
          [flag]: false,
        };
        next[to.row][to.col] = {
          ...next[to.row][to.col],
          [flag]: true,
          isWall: false,
        };
        return next;
      });
      if (kind === "start") setStart(to);
      else setFinish(to);
      clearResults();
    },
    [clearResults, finish, start],
  );

  /* --------------------------------------------------------------- pointer */

  /** Resolves a DOM element back to the grid coordinate it represents. */
  const coordFromElement = useCallback((element: Element | null): Coord | null => {
    if (!(element instanceof HTMLElement)) return null;
    const { row, col } = element.dataset;
    if (row === undefined || col === undefined) return null;
    return { row: Number(row), col: Number(col) };
  }, []);

  const applyPaint = useCallback(
    (coord: Coord) => {
      const mode = paintModeRef.current;
      if (!mode) return;

      const key = `${coord.row}-${coord.col}`;
      if (lastPaintedRef.current === key) return;
      lastPaintedRef.current = key;

      if (mode === "draw") setWall(coord.row, coord.col, true);
      else if (mode === "erase") setWall(coord.row, coord.col, false);
      else moveEndpoint(mode, coord);
    },
    [moveEndpoint, setWall],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isAnimatingRef.current) return;
      const coord = coordFromElement(event.target as Element);
      if (!coord) return;

      const node = grid[coord.row]?.[coord.col];
      if (!node) return;

      paintModeRef.current = node.isStart
        ? "start"
        : node.isFinish
          ? "finish"
          : node.isWall
            ? "erase"
            : "draw";
      lastPaintedRef.current = null;

      // Capture on the container so drags that leave the grid still report back.
      event.currentTarget.setPointerCapture(event.pointerId);
      applyPaint(coord);
    },
    [applyPaint, coordFromElement, grid],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!paintModeRef.current) return;
      // With the pointer captured, events always target the container, so the
      // cell under the cursor has to be looked up by position.
      const coord = coordFromElement(document.elementFromPoint(event.clientX, event.clientY));
      if (coord) applyPaint(coord);
    },
    [applyPaint, coordFromElement],
  );

  const endPainting = useCallback(() => {
    paintModeRef.current = null;
    lastPaintedRef.current = null;
  }, []);

  /* ----------------------------------------------------------------- view */

  const activeAlgorithm = ALGORITHMS.find((entry) => entry.key === algorithm)!;

  // Denominator for the meters: every square the search was actually allowed to
  // enter. Using the open board rather than the larger of the two runs means one
  // algorithm's bar still means something before the other has been run.
  const openSquares = useMemo(
    () => grid.reduce((total, row) => total + row.filter((node) => !node.isWall).length, 0),
    [grid],
  );

  const ghostButton =
    "rounded px-2.5 py-1.5 text-sm text-slate-400 transition hover:bg-white/5 hover:text-slate-200 disabled:opacity-50";

  /** The one-line takeaway, once both algorithms have run on the same board. */
  const comparison = useMemo(() => {
    const astar = results.astar;
    const bfs = results.bfs;
    if (!astar?.found || !bfs?.found) return null;

    const route =
      astar.steps === bfs.steps ? (
        <>
          Both routes are <Num>{astar.steps}</Num> steps long, so neither one is shorter.
        </>
      ) : (
        <>
          A* found a <Num>{astar.steps}</Num> step route and breadth-first found{" "}
          <Num>{bfs.steps}</Num>.
        </>
      );

    const ratio = astar.explored > 0 ? bfs.explored / astar.explored : 1;
    if (ratio < 1.1) {
      return (
        <>
          {route} On this board they did about the same amount of searching. Add obstacles or drag
          the destination further away to open up the gap.
        </>
      );
    }

    return (
      <>
        {route} A* checked <Num>{ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}x</Num> fewer
        squares to get there: <Num>{astar.explored}</Num> instead of <Num>{bfs.explored}</Num>.
      </>
    );
  }, [results]);

  return (
    <section className="w-full">
      <div className="overflow-hidden rounded-lg border border-white/10 bg-[#0b1020]">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-3 py-3">
          <div
            role="radiogroup"
            aria-label="Search algorithm"
            className="flex divide-x divide-white/15 overflow-hidden rounded border border-white/15"
          >
            {ALGORITHMS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="radio"
                aria-checked={algorithm === entry.key}
                disabled={isAnimating}
                onClick={() => setAlgorithm(entry.key)}
                className={`px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                  algorithm === entry.key
                    ? "bg-cyan-500/25 font-medium text-cyan-50"
                    : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleVisualize}
            disabled={isAnimating}
            className="rounded bg-amber-500 px-4 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-amber-400 disabled:opacity-60"
          >
            {isAnimating ? "Searching..." : "Find route"}
          </button>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={handleRandomWalls}
              disabled={isAnimating}
              className={ghostButton}
            >
              Obstacles
            </button>
            <button
              type="button"
              onClick={handleClearWalls}
              disabled={isAnimating}
              className={ghostButton}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={isAnimating}
              className={ghostButton}
            >
              Reset
            </button>
          </div>
        </div>

        {/* How to use it. Sits above the board, where a first-time visitor looks. */}
        <ol className="flex flex-wrap gap-x-6 gap-y-2 border-b border-white/10 bg-white/[0.02] px-3 py-2.5 text-xs text-slate-400">
          <Step n={1}>
            Drag on the board to draw walls, or click <Key>Obstacles</Key> to scatter them randomly
          </Step>
          <Step n={2}>Choose an algorithm</Step>
          <Step n={3}>
            Click <Key>Find route</Key>, then run the other one to compare
          </Step>
        </ol>

        {/* Board */}
        <div className="p-3">
          <div
            ref={containerRef}
            className="overflow-hidden border-t border-l border-white/10"
            style={{ touchAction: "pan-y" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endPainting}
            onPointerCancel={endPainting}
          >
            {dimensions && grid.length > 0 ? (
              <div
                key={runId}
                className="grid select-none"
                style={{ gridTemplateColumns: `repeat(${dimensions.cols}, minmax(0, 1fr))` }}
              >
                {grid.map((row) =>
                  row.map((node) => (
                    <Cell
                      key={`${node.row}-${node.col}`}
                      row={node.row}
                      col={node.col}
                      isStart={node.isStart}
                      isFinish={node.isFinish}
                      isWall={node.isWall}
                    />
                  )),
                )}
              </div>
            ) : (
              // Placeholder until the container has been measured on the client.
              <div className="aspect-[55/25] w-full bg-white/[0.03]" />
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
            <Swatch color="#22c55e" label="Start" />
            <Swatch color="#ef4444" label="Destination" />
            <Swatch color="#334155" label="Wall" />
            <Swatch color="rgba(6, 182, 212, 0.42)" label="Checked" />
            <Swatch color="#f59e0b" label="Route" />
          </div>
          <p className="mt-2 text-xs text-slate-600">
            The green start and the red destination can be dragged anywhere too.
          </p>
        </div>

        {/* Readout */}
        <div className="border-t border-white/10 px-3 py-4">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="text-sm font-medium text-slate-200">Squares checked</h2>
            <span className="text-xs text-slate-500">
              this board has{" "}
              <span className="font-mono tabular-nums text-slate-400">{openSquares}</span> squares
              that are not walls
            </span>
          </div>

          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-slate-600">
                <th className="w-[11rem] py-2 font-normal">Algorithm</th>
                <th className="py-2 font-normal" />
                <th className="w-20 py-2 text-right font-normal">Checked</th>
                <th className="w-16 py-2 text-right font-normal">of board</th>
                <th className="w-24 py-2 text-right font-normal">Route</th>
              </tr>
            </thead>
            <tbody>
              {ALGORITHMS.map((entry) => {
                const stats = results[entry.key];
                const share = stats && openSquares > 0 ? stats.explored / openSquares : 0;
                return (
                  <tr key={entry.key} className="border-t border-white/[0.07]">
                    <td className="py-2.5 pr-4 text-sm text-slate-300">{entry.label}</td>

                    {/* Meter. One hue for both rows, since both measure the same thing. */}
                    <td className="py-2.5 pr-4">
                      <span className="block h-2.5 w-full min-w-16 overflow-hidden rounded-sm bg-white/[0.07]">
                        <span
                          className="block h-full rounded-r-[4px] transition-[width] duration-500"
                          style={{
                            width: `${Math.min(100, share * 100)}%`,
                            backgroundColor: "#0891b2",
                          }}
                        />
                      </span>
                    </td>

                    <td className="py-2.5 text-right font-mono text-sm tabular-nums text-slate-100">
                      {stats ? stats.explored : "-"}
                    </td>
                    <td className="py-2.5 text-right font-mono text-sm tabular-nums text-slate-500">
                      {stats ? `${Math.round(share * 100)}%` : "-"}
                    </td>
                    <td className="py-2.5 text-right font-mono text-sm tabular-nums text-slate-400">
                      {stats ? (stats.found ? `${stats.steps} steps` : "blocked") : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="mt-3 text-sm text-slate-400">
            {comparison ?? (
              <span className="text-slate-500">
                Running {activeAlgorithm.label}, which {activeAlgorithm.tagline}. Run the other one
                on the same board to compare.
              </span>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="font-mono text-[11px] text-slate-600">{n}</span>
      <span>{children}</span>
    </li>
  );
}

/** Names a control the visitor has to find, so it reads as a button and not prose. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-white/15 px-1.5 py-0.5 text-[11px] text-slate-300">
      {children}
    </span>
  );
}

/** Inline figure inside prose, so numbers stay scannable against the sentence. */
function Num({ children }: { children: React.ReactNode }) {
  return <span className="font-mono tabular-nums text-slate-200">{children}</span>;
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="h-2.5 w-2.5 rounded-sm ring-1 ring-white/15"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
