/**
 * Computational engine for the pathfinding visualizer.
 *
 * Everything here is pure TypeScript with no React or DOM dependency: an
 * algorithm takes a grid snapshot, runs to completion synchronously, and hands
 * back the chronological list of nodes it inspected. The UI layer is then free
 * to replay that list at whatever speed it likes.
 */

export interface GridNode {
  row: number; // Vertical coordinate in the 2D matrix (0 to ROWS - 1)
  col: number; // Horizontal coordinate in the 2D matrix (0 to COLS - 1)
  isStart: boolean; // True if this cell is the starting agent
  isFinish: boolean; // True if this cell is the target objective
  distance: number; // g(n): exact cost/steps taken from start to this node
  heuristic: number; // h(n): estimated straight-line distance to target
  totalDistance: number; // f(n) = g(n) + h(n): total evaluation priority
  isVisited: boolean; // Flag to prevent redundant re-exploration cycles
  isWall: boolean; // Barrier flag (impassable obstacle)
  previousNode: GridNode | null; // Pointer to parent node for path reconstruction
}

export type AlgorithmKey = "astar" | "bfs";

export interface Coord {
  row: number;
  col: number;
}

export interface SearchResult {
  /** Every node the algorithm inspected, in the order it inspected them. */
  visitedNodesInOrder: GridNode[];
  /** Start -> finish trajectory, or an empty array when the target is walled off. */
  shortestPathNodes: GridNode[];
}

/** The four cardinal moves. No diagonals, which is what makes Manhattan admissible. */
const MOVES: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export function createNode(row: number, col: number, start: Coord, finish: Coord): GridNode {
  return {
    row,
    col,
    isStart: row === start.row && col === start.col,
    isFinish: row === finish.row && col === finish.col,
    distance: Infinity,
    heuristic: Infinity,
    totalDistance: Infinity,
    isVisited: false,
    isWall: false,
    previousNode: null,
  };
}

export function createGrid(rows: number, cols: number, start: Coord, finish: Coord): GridNode[][] {
  const grid: GridNode[][] = [];
  for (let row = 0; row < rows; row++) {
    const currentRow: GridNode[] = [];
    for (let col = 0; col < cols; col++) {
      currentRow.push(createNode(row, col, start, finish));
    }
    grid.push(currentRow);
  }
  return grid;
}

/**
 * Copies the grid while wiping every per-run field. The algorithms mutate nodes
 * heavily, so they always run against one of these throwaway clones rather than
 * against the objects React is holding in state.
 */
export function cloneGridForRun(grid: GridNode[][]): GridNode[][] {
  return grid.map((row) =>
    row.map((node) => ({
      ...node,
      distance: Infinity,
      heuristic: Infinity,
      totalDistance: Infinity,
      isVisited: false,
      previousNode: null,
    })),
  );
}

/**
 * h(n) = |r_n - r_finish| + |c_n - c_finish|
 *
 * Manhattan distance is admissible on a 4-directional grid: it can never
 * overestimate the true number of steps remaining, which is exactly the
 * condition A* needs to stay optimal.
 */
export function manhattanDistance(node: GridNode, finish: GridNode): number {
  return Math.abs(node.row - finish.row) + Math.abs(node.col - finish.col);
}

function getUnvisitedNeighbors(node: GridNode, grid: GridNode[][]): GridNode[] {
  const neighbors: GridNode[] = [];
  for (const [dRow, dCol] of MOVES) {
    const row = node.row + dRow;
    const col = node.col + dCol;
    if (row < 0 || row >= grid.length || col < 0 || col >= grid[0].length) continue;
    const neighbor = grid[row][col];
    if (neighbor.isWall || neighbor.isVisited) continue;
    neighbors.push(neighbor);
  }
  return neighbors;
}

/**
 * A* search, the "guided compass".
 *
 * Always expands whichever frontier node has the lowest f(n) = g(n) + h(n),
 * which pulls the search into a tight cone aimed at the target instead of
 * spreading evenly in every direction.
 */
export function aStar(grid: GridNode[][], start: GridNode, finish: GridNode): GridNode[] {
  const visitedNodesInOrder: GridNode[] = [];

  start.distance = 0;
  start.heuristic = manhattanDistance(start, finish);
  start.totalDistance = start.heuristic;

  const openSet: GridNode[] = [start];
  const inOpenSet = new Set<GridNode>([start]);

  while (openSet.length > 0) {
    // The frontier stays small enough on a grid this size that a sort per
    // iteration is cheaper in practice than maintaining a binary heap.
    // Ties break toward the lower heuristic, which keeps the search directed.
    openSet.sort((a, b) => a.totalDistance - b.totalDistance || a.heuristic - b.heuristic);

    const current = openSet.shift()!;
    inOpenSet.delete(current);

    if (current.isVisited) continue;
    current.isVisited = true;
    visitedNodesInOrder.push(current);

    if (current === finish) return visitedNodesInOrder;

    for (const neighbor of getUnvisitedNeighbors(current, grid)) {
      const tentativeDistance = current.distance + 1;
      if (tentativeDistance >= neighbor.distance) continue;

      neighbor.distance = tentativeDistance;
      neighbor.heuristic = manhattanDistance(neighbor, finish);
      neighbor.totalDistance = neighbor.distance + neighbor.heuristic;
      neighbor.previousNode = current;

      if (!inOpenSet.has(neighbor)) {
        openSet.push(neighbor);
        inOpenSet.add(neighbor);
      }
    }
  }

  return visitedNodesInOrder;
}

/**
 * Breadth-first search, the "blind explorer".
 *
 * A plain FIFO queue with no notion of where the target is, so the frontier
 * expands outward like ripples in a pond. Still optimal on an unweighted grid,
 * just far more wasteful about how it gets there.
 */
export function breadthFirstSearch(
  grid: GridNode[][],
  start: GridNode,
  finish: GridNode,
): GridNode[] {
  const visitedNodesInOrder: GridNode[] = [];

  start.distance = 0;
  start.isVisited = true; // Marked on enqueue so a node is never queued twice.

  const queue: GridNode[] = [start];
  let head = 0; // Index cursor instead of shift() to keep dequeues O(1).

  while (head < queue.length) {
    const current = queue[head++];
    visitedNodesInOrder.push(current);

    if (current === finish) return visitedNodesInOrder;

    for (const neighbor of getUnvisitedNeighbors(current, grid)) {
      neighbor.isVisited = true;
      neighbor.distance = current.distance + 1;
      neighbor.previousNode = current;
      queue.push(neighbor);
    }
  }

  return visitedNodesInOrder;
}

/**
 * Walks the reverse singly-linked list built during the search
 * (finish -> previousNode -> ... -> start) and flips it into travel order.
 */
export function getNodesInShortestPathOrder(finish: GridNode): GridNode[] {
  const path: GridNode[] = [];
  let current: GridNode | null = finish;
  while (current !== null) {
    path.unshift(current);
    current = current.previousNode;
  }
  // A path that does not lead back to the start means the target was unreachable.
  return path.length > 1 && path[0].isStart ? path : [];
}

/** Runs the chosen algorithm against a fresh clone and returns both animation queues. */
export function runSearch(
  grid: GridNode[][],
  start: Coord,
  finish: Coord,
  algorithm: AlgorithmKey,
): SearchResult {
  const workingGrid = cloneGridForRun(grid);
  const startNode = workingGrid[start.row][start.col];
  const finishNode = workingGrid[finish.row][finish.col];

  const visitedNodesInOrder =
    algorithm === "astar"
      ? aStar(workingGrid, startNode, finishNode)
      : breadthFirstSearch(workingGrid, startNode, finishNode);

  return {
    visitedNodesInOrder,
    shortestPathNodes: getNodesInShortestPathOrder(finishNode),
  };
}

/**
 * Sprinkles a random scattering of walls, skipping the start and finish cells.
 * Deliberately not a perfect maze. Open clutter shows off the difference
 * between a guided and a blind search far better than narrow corridors do.
 */
/**
 * Scatters walls and then checks the destination is still reachable, retrying
 * until it is. A board with no way through is a legitimate state to draw by
 * hand, but it makes a terrible first impression, so the generated ones never
 * start that way.
 */
export function generateSolvableWalls(
  rows: number,
  cols: number,
  start: Coord,
  finish: Coord,
  density = 0.25,
  attempts = 15,
): boolean[][] {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const walls = generateRandomWalls(rows, cols, start, finish, density);

    const probe = createGrid(rows, cols, start, finish);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) probe[row][col].isWall = walls[row][col];
    }

    if (runSearch(probe, start, finish, "bfs").shortestPathNodes.length > 0) return walls;
  }

  // Every attempt walled the target off, so hand back an empty board instead.
  return generateRandomWalls(rows, cols, start, finish, 0);
}

export function generateRandomWalls(
  rows: number,
  cols: number,
  start: Coord,
  finish: Coord,
  density = 0.25,
): boolean[][] {
  const walls: boolean[][] = [];
  for (let row = 0; row < rows; row++) {
    const currentRow: boolean[] = [];
    for (let col = 0; col < cols; col++) {
      const isEndpoint =
        (row === start.row && col === start.col) || (row === finish.row && col === finish.col);
      currentRow.push(!isEndpoint && Math.random() < density);
    }
    walls.push(currentRow);
  }
  return walls;
}
