# Repos & Dungeons: MVP Spec

Status: approved · 2026-10-06

## 1. What we're building

A local web app that shows a repo as a pixel-art dungeon and the coding agents working in it as a party of adventurers, **live**. Folders are rooms, files are tiles, and unexplored code stays dark. Failing tests are monsters, and context usage is a torch burning down. A timelapse of the whole session can be exported as a video to share.

It ships as a Claude Code plugin: run `/dungeon` in a repo and a browser tab opens with that repo's dungeon and every Claude Code session currently running in it.

### Success criteria (MVP)

1. `/dungeon` in any repo opens the dungeon in under 5 seconds, including 100,000-file monorepos (section 5.8).
2. A tool call in any running session shows up in the browser within 1 second.
3. The map is identical on every run for the same file tree (deterministic).
4. A 30–60 minute session exports as a 30-second MP4 or GIF that looks good on a phone.
5. Nothing leaves the machine unless the user exports. Exports contain no file contents.

### Non-goals (MVP)

- Replay of past sessions (phase 2; it reuses the same parser).
- Codex and other agents (phase 3).
- A hosted share page (phase 3; MVP exports a file).
- Interacting with the agents from the game (view only).

## 2. Decisions

| Topic | Decision |
|---|---|
| Build order | **Live first.** Replay moves to phase 2. |
| Map source | **Repo on disk**, so unread folders show as fog. |
| Event source | **Tail the transcript `.jsonl` files.** No hooks required for the core. |
| Scope of a dungeon | One repo = one dungeon. Every session running in it is a hero. Subagents are party members. |
| Packaging | Claude Code plugin (`/dungeon`) + npm package (`npx repos-and-dungeons`). |
| Art direction | Moody hi-bit pixel art (mockup v3): dark stone, dynamic torchlight, embers, fog. Readable UI fonts: Inter (body), Cinzel (headings). |
| Heroes | Claude-style coral characters with one class per model (section 7). |
| Speech | Haiku writes short in-character lines in a **D&D voice**. |
| Torch | Context window fill per hero. |
| Stamina | Plan usage (5-hour and weekly) from the status-line data; a single HUD bar, no special scene. |
| Export | Timelapse from `/dungeon` start until done, as MP4/GIF. |
| Big repos | Fixed budget: ≤ 400 rooms, ≤ ~40k tiles, log-scale rooms, file buckets, chunked rendering, director camera + minimap (section 5). |
| Sound | Fantasy music + effects, **off by default**, CC0 assets (section 11). |

## 3. Architecture

```
Claude Code sessions ──writes──▶ ~/.claude/projects/*/*.jsonl (+ <session>/subagents/*.jsonl)
                                          │ tail
┌──────────────── Node server (127.0.0.1 only) ─▼─────────────┐
│ RepoScanner ─▶ MapGenerator (seeded from paths) ─▶ DungeonMap│
│ SessionWatcher ─▶ TranscriptParser ─▶ GameEvent stream       │
│ Narrator (Haiku, D&D voice, rate-limited) ─▶ speech events   │
│ UsageReader (status-line file) ─▶ stamina events             │
│ Recorder ─▶ ~/.repos-and-dungeons/recordings/<id>.jsonl      │
└───────────────────────────┬──────────────────────────────────┘
                            │ WebSocket (session key required)
              Browser: PixiJS renderer, HUD, timelapse player, exporter
```

Each unit has one job and a plain-data interface, so it can be tested alone:

| Unit | Input | Output | Notes |
|---|---|---|---|
| `RepoScanner` | repo root | `FileTree` | Respects `.gitignore` plus a built-in ignore list. Watches for new or deleted files. |
| `MapGenerator` | `FileTree` | `DungeonMap` | Pure and deterministic. No randomness except seeded hashes of paths. |
| `SessionWatcher` | repo root | raw lines tagged with `{sessionId, agentId?}` | Finds transcripts whose `cwd` is the repo or inside it. |
| `TranscriptParser` | one raw line + parser state | `GameEvent[]` | Pure. The most heavily tested unit. Replay mode reuses it. |
| `Narrator` | recent `GameEvent`s per hero | `speech` events | Optional. Never sees file contents. |
| `UsageReader` | `~/.repos-and-dungeons/usage.json` | `stamina` events | Falls back to a token estimate. |
| `Recorder` | all events | append-only `.jsonl` | Used for the timelapse. |
| Web client | `DungeonMap` + events | pixels | Rendering only; holds no game rules. |

The server owns game state (`GameState = reduce(events)`). The browser receives the map once, then events, and runs the same reducer to stay in sync. The reducer is a shared pure module, so the timelapse is just "run the reducer over the recording, faster."

## 4. Session discovery and parsing

### Discovery

- Scan every folder under `~/.claude/projects/`. **Do not trust folder names**: a folder's encoded name doesn't always match the `cwd` of the sessions inside it (for example after moving a home directory between machines). Read the `cwd` field from the first lines of each file instead.
- A session belongs to the dungeon if its `cwd` equals the repo root or is inside it.
- "Running" means the file changed in the last 10 minutes. Files that go idle longer than that turn their hero into a resting state, and the hero leaves after 30 minutes.
- Subagent files at `<project>/<sessionId>/subagents/agent-<id>.jsonl` (lines have `isSidechain: true` and `agentId`) become party members of their parent session's hero.
- Watch with `chokidar` (MIT). Keep a byte offset per file; read only appended bytes; buffer partial lines until a newline arrives.
- On startup, read only the last 200 lines of each running session, so heroes appear where they currently are instead of replaying hours of history.

### Event schema

```ts
type HeroId = string; // sessionId, or `${sessionId}/${agentId}` for subagents
type HeroClass = 'knight' | 'squire' | 'scout' | 'wizard' | 'adventurer';

type GameEvent = { t: number; hero: HeroId } & (
  | { kind: 'hero_joined'; heroClass: HeroClass; parent?: HeroId; label: string }
  | { kind: 'hero_left' }
  | { kind: 'move'; path: string }                      // Read: walk to tile, clear fog
  | { kind: 'scout'; paths: string[] }                  // Grep/Glob/LS: faint reveal of matched tiles
  | { kind: 'forge'; path: string; created: boolean }   // Edit/Write/NotebookEdit
  | { kind: 'cast'; command: string }                   // other Bash: brief spell effect, command not shown in exports
  | { kind: 'test_result'; runner: string; failed: TestFailure[]; passed: number }
  | { kind: 'door_locked' } | { kind: 'door_opened' }   // permission prompt (optional hook)
  | { kind: 'torch'; used: number; max: number }        // context tokens
  | { kind: 'compacted' }                               // fog returns for this hero
  | { kind: 'speech'; text: string }
  | { kind: 'stamina'; fiveHourPct: number; weeklyPct: number; resetsAt?: number }
  | { kind: 'idle' } | { kind: 'thinking' }
);
type TestFailure = { file?: string; name: string };
```

### Parsing rules

- **Tool calls:** from `assistant` lines, `message.content[]` items with `type: "tool_use"`. Map by `name` and `input` (`file_path`, `path`, `pattern`, `command`). Paths are made relative to the repo root. Paths outside the repo are dropped.
- **Tool results:** from `user` lines with `toolUseResult` (Bash results have `stdout`, `stderr`, `interrupted`). Match to the call by `tool_use_id`.
- **Hero class:** from `message.model` on assistant lines (`claude-opus-*` → knight, etc.). It can change mid-session; the hero then re-equips.
- **Torch:** `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` from `message.usage` on the latest assistant line, divided by the model's context size: 200k by default, bumped to 1M once a session's usage goes past 200k.
- **Compaction:** a line with `type: "system"` and `subtype: "compact_boundary"` (verified 2026-10-06; it carries `compactMetadata.preTokens`/`postTokens`). The following `isCompactSummary: true` user line is not an event.
- **Unknown line types** are ignored, never errors. The format is undocumented and changes.

### Test detection

Run on Bash results whose command matches a known runner:

| Runner | Command match | Failure signal |
|---|---|---|
| vitest | `vitest`, `npm/pnpm/yarn test` with vitest output | `✗`/`FAIL <file>` lines, `Tests  N failed` |
| jest | `jest`, `npm test` with jest output | `FAIL <file>`, `Tests: N failed` |
| pytest | `pytest`, `python -m pytest` | `FAILED <file>::<name>`, `N failed` |
| go | `go test` | `--- FAIL: <name>`, `FAIL <pkg>` |
| generic | `npm test`, `make test`, `cargo test` | non-zero exit + the word `fail` |

Each detector is a small pure function with fixture tests built from real output. A monster spawns in the failing file's room (the root room if no file is known). A later run of the same test command with zero failures kills the monsters it spawned.

## 5. Map generation and big repos

Goal: readable, stable, and smooth (60 fps) from a 10-file toy repo to a 100,000-file monorepo. The core rule is **bounded output**: no matter how big the repo is, the map has at most ~400 rooms and ~40,000 tiles, and the browser only draws what's on screen.

### 5.1 Scanning (fast and cheap)

1. In a git repo, use `git ls-files --cached --others --exclude-standard -z`. It respects `.gitignore` and lists 100k files in well under a second. Outside git, fall back to a directory walk with the `ignore` package.
2. Always skip `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `vendor`, `__pycache__`, `target`, `.venv`, lockfiles, and binary/media files.
3. **Don't watch the whole repo** (file watchers on huge trees are slow and hit OS limits). New files are learned from Write events right away, plus a cheap re-run of `git ls-files` every 30 seconds that is diffed against the last result. Only the transcripts folder is watched.

### 5.2 Rooms: a fixed budget, split where the files are

1. Start with one room: the repo root.
2. Repeatedly split the room holding the most files into one room per child folder, until the next split would exceed **400 rooms** or no room holds more than 60 files. Folders that never get split stay folded into their parent room as **alcoves** (sub-areas inside the room with a low inner wall and their own label at close zoom).
3. The result depends only on the file tree, so it's deterministic. Small repos end up with one room per folder; huge repos get rooms only where the bulk is.

### 5.3 Room size and tiles: log scale

1. A room's floor area grows with the **square root** of its file count, clamped between 5×4 and 40×30 tiles. A 10,000-file folder is about 10× the size of a 100-file folder, not 100×.
2. If a room has more files than floor tiles, each tile is a **bucket** of files: files are sorted by path and split into contiguous ranges, one range per tile. A tile shows as read when any file in it was read, with brightness by the fraction read. Edited and monster states work per bucket too.
3. The total map is capped at about 256×256 tiles.

### 5.4 Layout (deterministic and stable)

1. Rooms are placed by walking the room tree in sorted path order. Each child is placed around its parent with a spiral search over free grid space; the start direction comes from `hash(path)`.
2. Corridors connect parent and child rooms as L-shaped paths, routed with A* on a coarse grid so they don't cut through rooms.
3. Stability: adding a file only changes its room's size when it crosses a size step (sizes are rounded up to steps of 2 tiles). Adding a folder never moves rooms that come earlier in sorted order.
4. Decor (torches, moss, cracks) is placed by `hash(path + x + y)`.

### 5.5 Rendering at scale

1. **Static layer:** floors, walls, and decor are baked once into chunk textures (32×32 tiles each). Only chunks in the viewport are drawn. This is what keeps a 256×256 map at 60 fps.
2. **Fog:** a tiny texture with one pixel per tile, upscaled on the GPU with a dither shader. Updating fog is one pixel write, not a redraw.
3. **Dynamic layer:** heroes, monsters, effects, and lights only. Lights are capped at the 24 nearest the camera.
4. **Level of detail by zoom:**
   - **Close (2×, default when following a hero):** full tiles, alcove labels, speech bubbles.
   - **Mid:** tiles drawn as color blocks, room labels only.
   - **Far (whole map):** rooms as labeled blocks with an explored-% badge; heroes as glowing dots.

### 5.6 Watching many heroes in a big map

1. **Director camera:** follows the hero with the most recent activity. It cuts to another hero only when that hero does something notable (monster, forge, join) and the current one has been quiet for 5 seconds. Click a hero in the party bar to lock the camera on it; press `Esc` to return to the director.
2. **Minimap** (bottom right): the whole dungeon with explored areas lit, hero dots, and red dots for monsters. Click to jump there.
3. **Jump-to search** (`/` key): type a file or folder name and the camera flies to its room.
4. **Off-screen indicators:** arrows at the screen edge point to heroes and monsters outside the view.

### 5.7 Keeping up with fast agents

1. The server sends events in batches at up to 10 per second.
2. Each hero has an animation queue. If it falls more than 2 seconds behind real time, the hero walks faster; past 5 seconds it "dashes" (a short blink effect) straight to the latest position. The view never lags far behind the agent.
3. Transcripts can be 50 MB or more. On startup the server reads backwards from the end of the file to get the last 200 lines; it never reads the whole file. Each file's `cwd` is read from its first 4 KB and cached in `~/.repos-and-dungeons/index.json` by path + modified time, so discovery across thousands of transcripts stays fast.

### 5.8 Performance budgets (tested in CI with a generated repo)

| Repo size | Scan + map | Browser |
|---|---|---|
| 1,000 files | < 200 ms | 60 fps |
| 10,000 files | < 600 ms | 60 fps |
| 100,000 files | < 2 s | ≥ 50 fps at 1080p, < 300 MB memory |

Output:

```ts
type DungeonMap = {
  seed: string; width: number; height: number;
  rooms: { id: string; path: string; x: number; y: number; w: number; h: number;
           alcoves: { path: string; x: number; y: number; w: number; h: number }[] }[];
  tiles: { id: number; room: string; x: number; y: number; kind: TileKind; files: [first: string, last: string]; count: number }[];
  corridors: { from: string; to: string; cells: [number, number][] }[];
  decor: { x: number; y: number; kind: string }[];
};
// Server keeps a path → tile id index; events carry paths, the client looks up the tile id via a map sent once.
```

Tests:
- Determinism: same tree twice and in shuffled input order give deep-equal output.
- Stability: adding one file moves no other room.
- Snapshot of a sample repo.
- The performance budgets above, with generated repos of 1k, 10k, and 100k files.

## 6. Game mapping

| Agent activity | In the dungeon |
|---|---|
| Read | Hero walks to the tile, fog clears for that tile and its room, crate opens into a scroll |
| Grep / Glob / LS | Hero raises the torch; matched tiles flicker visible (faint reveal, fog not fully cleared) |
| Edit / Write | Hero hammers the tile; it becomes a glowing forged tile. New files appear with a spark burst |
| Bash (non-test) | Short spell effect at the hero |
| Test failure | Red slime spawns in the failing file's room with a tag ("auth.test.ts · 2 failing") |
| Tests pass | Hero strikes, "-1" pops, the slime dies; small gold burst |
| Permission prompt | Hero stops at a locked door with a padlock icon (needs the optional hook) |
| Subagent starts / ends | New party member walks in from the entrance / waves and leaves |
| Context fill | Torch meter drains; the hero's light radius shrinks as it drops below 25% |
| Compaction | Fog rolls back over every room this hero had cleared |
| Idle > 2 min | Hero sits by a campfire |
| Plan usage | Stamina bar in the HUD (5-hour %, weekly %, reset time) |

Fog is shared by the party: a tile is cleared once any hero has seen it during this dungeon run.

## 7. Heroes

| Model | Class | Look |
|---|---|---|
| Opus | Knight | Coral Claude, steel helmet with red plume, iron sword, chestplate |
| Sonnet | Squire | Coral Claude, green bandana, wooden sword |
| Haiku | Scout | Plain coral Claude |
| Fable | Wizard | Coral Claude, purple pointed hat, glowing staff |
| Other | Adventurer | Coral Claude with a backpack |

Sprites are 16×16 and drawn by us (the v3 mockup is the reference), with 4-frame walk, attack, and idle cycles. Environment tiles come from Kenney.nl CC0 packs, recolored to the moody palette, or are drawn by us.

**Brand note:** Claude's name and look belong to Anthropic. Before a public launch, check Anthropic's brand guidelines; if needed, ship the heroes as clearly "Claude-inspired" with a neutral name.

## 8. Narrator (speech bubbles)

- Every 15 seconds at most per hero, and only after something happened, the server sends Haiku a compact summary: hero class, the last 3–5 events as tool name + file basename + test counts.
- **Never send file contents, command text, or tool output.** This keeps secrets out of both the model call and the bubbles.
- Prompt style: "You are {class} in a D&D party exploring a dungeon that is a code repo. Say one line, under 14 words, in character, about what just happened. Medieval adventurer voice, light humor, no emojis." Example outputs: "The expiry check is backwards. This ends now." / "I foresee two failing tests in auth…"
- Call: `claude -p --model haiku --setting-sources "" "<prompt>"` (works with a normal Claude Code login; `--setting-sources ""` skips user and project settings, so no hooks run). `--bare` does **not** work: it skips the subscription login.
- To verify in the build: plugin hooks are also skipped, so a narrator call never shows up as a hero in the dungeon. As a guard, the narrator runs with `cwd` set to a temp directory, which is outside the repo, so the `cwd` filter drops it anyway.
- At most 2 calls in flight. If calls fail or `--no-narrator` is set, fall back to a canned line table per event kind and class.
- Bubbles type out (30 ms per character), show for 5 seconds, and at most 3 are visible at once (including slime taunts). Changed from 4 s / 2 during Plan 3 for readability of typed lines.

## 9. Usage (stamina)

- **Primary:** an opt-in status-line wrapper. `repos-and-dungeons install-statusline` backs up `~/.claude/settings.json`, then sets the status line to our script. The script writes `rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage`, and `resets_at` to `~/.repos-and-dungeons/usage.json`, then runs the user's original status-line command and prints its output unchanged. `uninstall-statusline` restores it.
- **Fallback:** sum tokens from all local transcripts in a rolling 5-hour window, against a cap set in `~/.repos-and-dungeons/config.json`. The HUD labels this "estimated".
- The bar shows remaining stamina (100 − used %).

## 10. Recording, timelapse, export

- **Recording:** every `GameEvent` (plus the map snapshot at start and any map changes) is appended to `~/.repos-and-dungeons/recordings/<repo-name>-<timestamp>.jsonl`, from `/dungeon` start until "done": the user clicks Stop, the server stops, or every hero has left (30 minutes idle). Events are small, so a full day is a few MB.
- **Timelapse preview:** the browser re-runs the reducer over the recording, compressed to a target length (default 30 seconds; options 15/30/60). Quiet stretches are squeezed more than busy ones, so long waits don't eat the video.
- **Export:** rendered in the browser from the same renderer at 1080×1080 (square, good for social) or 1920×1080.
  - MP4/WebM: `canvas.captureStream()` + `MediaRecorder` (MP4 where the browser supports it, otherwise WebM).
  - GIF: `gifenc` (MIT), at 480 px wide and 15 fps.
- **Privacy:**
  - Exports show folder names, sprites, and speech bubbles only. Never file contents, commands, or tool output.
  - Before export, a dialog lists every folder name that will appear, with an option to rename rooms to "Room 1, Room 2…".
  - Recordings never leave the machine except through an export the user starts.

## 11. Sound (off by default)

- **Toggle:** a speaker button in the HUD, plus the `M` key. Off by default. Turning it on is the click that browsers require before audio can play. The setting is saved in `localStorage`. A small mixer offers master, music, and effects volume.
- **Music:** looping fantasy dungeon tracks with two layers. A calm **explore** layer plays normally. A **combat** layer (drums, low strings) fades in while any monster is alive and fades out 4 seconds after the last one dies. Victory jingle when the last monster falls.
- **Ambience:** a quiet torch crackle and dungeon drips under the music.
- **Sound effects:**

| Event | Sound |
|---|---|
| Read (move) | Soft footsteps; page flip on arrival |
| Grep / Glob | Torch whoosh |
| Edit / Write | Hammer on anvil; sparkle for a new file |
| Bash | Short spell shimmer |
| Monster spawns | Slime squelch + low growl |
| Tests pass / monster dies | Sword hit, then coin chime |
| Locked door / opened | Chain rattle / door creak |
| Hero joins / leaves | Short horn / soft fade |
| Speech bubble | Quiet blip, pitched per class |
| Compaction | Wind gust as the fog rolls back |

- **Not annoying:** at most 4 effects per second, repeats within 300 ms merge into one, each sound has small pitch and volume variation, and footsteps play only for the hero the camera is following.
- **Assets:** CC0 only, so the repo needs no attribution rules. Effects come from Kenney.nl audio packs (RPG Audio, Impact Sounds, Interface Sounds), and music from CC0 tracks on OpenGameArt. Every file and its source URL are listed in `assets/CREDITS.md`. If no fitting CC0 music is found, the fallback is a short loop generated in code with WebAudio.
- **Engine:** Howler.js (MIT) for playback and sprite sheets; music layers crossfade with WebAudio gain nodes.
- **Exports:** an "include sound" checkbox, available only when sound is on. The WebAudio output is mixed into the `MediaRecorder` stream. GIFs are always silent.

## 12. CLI and plugin

```
npx repos-and-dungeons [repo-path]        # start for repo (default: cwd), open browser
  --port <n>          default: random free port
  --no-open           don't open the browser
  --no-narrator       canned lines only, no Haiku calls
repos-and-dungeons install-statusline     # opt-in stamina data
repos-and-dungeons uninstall-statusline
```

Plugin (`plugin/`):
- `/dungeon` command: runs the CLI for the current repo and prints the URL.
- Optional `Notification` hook: posts permission-prompt events to the server for the locked door.

Server security: bind to `127.0.0.1`; a random session key in the URL is required for HTTP and WebSocket.

## 13. Tech stack and layout

- TypeScript everywhere; Node 20+; npm workspaces are not needed, so it's one package.
- Server: Node `http` + `ws` + `chokidar` + `ignore` (gitignore parsing). All MIT.
- Web: Vite + PixiJS v8. The light mask uses a render texture with an additive blend, as in the mockup.
- Tests: Vitest.

```
src/
  shared/      events.ts, reducer.ts, map-types.ts
  server/      scanner.ts, room-budget.ts, map-generator.ts, watcher.ts, parser/, tests-detect/, narrator.ts, usage.ts, recorder.ts, index.ts
  web/         main.ts, render/ (chunks, fog, lights, lod), camera/, hud/, minimap/, audio/, timelapse/, export/
assets/        sprites/, tiles/, audio/, CREDITS.md
  cli.ts
plugin/        .claude-plugin/plugin.json, commands/dungeon.md, hooks/
test/fixtures/ transcripts (redacted), test-runner outputs, sample repos
docs/SPEC.md
```

## 14. Testing

- **Parser:** fixture `.jsonl` files, modeled on the real transcript format, mapped to expected `GameEvent[]`. Covers Read, Edit, Write, Grep, Bash, subagents, model switch, usage, unknown lines, partial lines.
- **Test detectors:** one fixture per runner for pass, fail, and mixed output.
- **Map generator:** determinism (same input → same output, shuffled input → same output), stability (adding one file doesn't move other rooms), snapshot of a sample repo, and the performance budgets in section 5.8 (generated 1k, 10k, 100k-file repos).
- **Reducer:** event sequences → expected state (fog, monsters, party).
- **End to end:** a script appends lines to a fake transcript in a temp `~/.claude`-like folder; the test asserts the browser receives the events (Playwright).

## 15. Milestones

| # | Milestone | Done when | Estimate |
|---|---|---|---|
| 0 | Prior-art check + project scaffold | GitHub search done; TS, Vite, Vitest run | 0.5 day |
| 1 | Transcript parser + test detectors | Fixture tests pass on real sessions | 1.5 days |
| 2 | Scanner + map generator | Static map of this repo and a 100k-file generated repo, deterministic, within budget | 3 days |
| 3 | Live pipeline | Watcher → parser → WebSocket → browser log of events, under 1 s | 1 day |
| 4 | Renderer v1 | Heroes walk, fog clears, forge, monsters, HUD, v3 look; chunked rendering, LOD, director camera, minimap | 4 days |
| 5 | Narrator + stamina | D&D bubbles live; status-line install works | 1.5 days |
| 6 | Recording + timelapse + export | 30 s MP4 and GIF from a real session | 2 days |
| 6b | Sound | Toggle, music layers, effects, mixed into MP4 export | 1.5 days |
| 7 | Plugin + polish + README GIF | `/dungeon` works from a fresh install | 1 day |

Total: about 15–16 working days.

## 16. Risks and open questions

1. **Transcript format is undocumented** and changes between Claude Code versions. Mitigation: ignore unknown lines, keep fixtures per version, fail soft.
2. **Compaction marker** verified (section 4).
3. **Permission prompts** may not appear in the transcript until answered. That's why the locked door needs the optional hook.
4. **Plugin hook isolation** for narrator calls needs verifying (section 8); the temp-directory `cwd` is the fallback guard.
5. **Brand use** of Claude's look (section 7).
6. **Huge monorepos** above 100k files work through the same budget, but past ~300k files the 2-second scan budget may not hold; acceptable for MVP.
7. **Prior art (checked 2026-10-06):** [claude-pixel-agent-web](https://github.com/thousandsky2024/claude-pixel-agent-web) (knights in 5 fixed themed rooms), [lewismillerg1/claude-dungeon](https://github.com/lewismillerg1/claude-dungeon) (3D, a room per session), [agent-world](https://github.com/codemoo/agent-world) (repos as village buildings). None builds the map from the repo's own file tree, fogs unread code, or turns failing tests into monsters. That is our positioning: "your repo's dungeon", not "agents in a generic dungeon".
8. **Music licensing:** CC0 fantasy tracks of good quality are scarce; the fallback is generated music (section 11).
