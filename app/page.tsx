import PathVisualizer from "@/components/PathVisualizer";

export default function Home() {
  return (
    <>
      <header className="border-b border-white/10">
        <div className="mx-auto flex w-full max-w-6xl items-baseline justify-between px-5 py-4 sm:px-8">
          <span className="font-mono text-sm text-slate-300">pathfinding</span>
          <span className="font-mono text-xs text-slate-500">A* vs breadth-first</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8">
        <div className="mb-10 max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            How game characters find you in 16.7 milliseconds
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-slate-400">
            Picture fifty mobs coming for you at once. Not one of them knows the way. Each has to
            check the squares around it, one at a time, until it stumbles onto you, and the game
            needs every one of those routes worked out before it can draw the next frame. The
            interesting part is how a character picks which square to check next.
          </p>
        </div>

        <PathVisualizer />

        <div className="mt-16 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-2">
          <section className="bg-[#0b1020] p-6">
            <h2 className="text-lg font-semibold text-slate-100">Breadth-First Search</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-400">
              Drop a stone in a pond and watch the ripples spread. That is roughly what this does.
              It checks everything one step away, then everything two steps away, and keeps going
              until the destination turns up.
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-400">
              It has no idea where it is headed, so the square directly behind it gets the same
              attention as the square in front. This always finds the shortest route. It just does a
              lot of pointless walking to get there.
            </p>
          </section>

          <section className="bg-[#0b1020] p-6">
            <h2 className="text-lg font-semibold text-slate-100">A* Search</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-400">
              A* asks one extra question about every square: ignoring walls for a second, roughly
              how far is this from the destination? On a grid that is simple subtraction and costs
              almost nothing. The guess works like a compass needle, so squares pointing toward the
              goal get checked first and the search stretches into a narrow cone.
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-400">
              The guess has to be a careful one. As long as it never claims a square is closer than
              it really is, A* cannot be talked into a longer route. Same shortest path, a fraction
              of the squares.
            </p>
          </section>
        </div>

        <section className="mt-16 border-t border-white/10 pt-10">
          <div className="grid gap-10 md:grid-cols-[auto_1fr] md:gap-16">
            <div className="flex flex-row gap-10 self-start md:flex-col md:gap-8">
              <div>
                <div className="font-mono text-5xl font-semibold tracking-tight text-slate-100">
                  16.7<span className="text-2xl text-slate-500">ms</span>
                </div>
                <p className="mt-2 max-w-[9rem] text-sm text-slate-500">
                  to draw one frame at 60fps
                </p>
              </div>
              <div>
                <div className="font-mono text-5xl font-semibold tracking-tight text-slate-100">
                  2<span className="text-2xl text-slate-500">ms</span>
                </div>
                <p className="mt-2 max-w-[9rem] text-sm text-slate-500">
                  the slice pathfinding usually gets
                </p>
              </div>
            </div>

            <div className="max-w-xl">
              <h2 className="text-lg font-semibold text-slate-100">
                Why the wasted effort matters
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-400">
                That 2 milliseconds is shared between every character on the map, so fifty mobs get
                a fraction of a millisecond each. Checking a few hundred squares instead of a few
                thousand is the difference between a crowd that moves convincingly and a game that
                drops frames.
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-500">
                Real engines also shrink the map before searching it: rather than keeping a cell for
                every patch of floor, they carve the walkable space into a handful of large polygons
                called a navigation mesh, so A* has dozens of shapes to check instead of thousands
                of squares.
              </p>
              <p className="mt-6 text-base leading-relaxed text-slate-200">
                Neither trick makes the computer any faster. They just give it less to look at.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="mt-8 border-t border-white/10">
        <div className="mx-auto w-full max-w-6xl px-5 py-6 font-mono text-xs text-slate-600 sm:px-8">
          runs entirely in your browser
        </div>
      </footer>
    </>
  );
}
