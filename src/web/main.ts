import '@fontsource/cinzel/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import './hud/hud.css';
import { Application, Container } from 'pixi.js';
import type { GameEvent, HeroClass, HeroId } from '../shared/events.js';
import type { DungeonMap } from '../shared/map-types.js';
import { initialState, reduce, remapState, type GameState } from '../shared/reducer.js';
import { buildTextures } from './art/textures.js';
import { T } from './art/tiles.js';
import { mountSoundControls } from './audio/controls.js';
import { AudioEngine } from './audio/engine.js';
import { CueLimiter, musicState, planSounds } from './audio/planner.js';
import { Hud } from './hud/hud.js';
import { isFresh } from './hud/hud-model.js';
import { Minimap } from './hud/minimap.js';
import { Search } from './hud/search.js';
import { mountTimelineBar } from './hud/timeline-bar.js';
import { connect } from './net.js';
import { ActorLayer } from './render/actors.js';
import { BubbleLayer } from './render/bubbles.js';
import { ChunkLayer } from './render/chunks.js';
import { FogLayer } from './render/fog.js';
import { LightLayer, type Light } from './render/lights.js';
import type { Controller, OverlayBubble } from './timelapse/controller.js';
import { lastRecorderState } from './timelapse/exporter.js';
import { frameBounds } from './timelapse/framing.js';
import { Timelapse } from './timelapse/timelapse.js';
import { Director } from './world/director.js';
import { lodFor } from './world/lod.js';
import { buildWalkable, findPath, type Walkable } from './world/walkable.js';

const NAMES: Record<HeroClass, string> = { knight: 'Opus', squire: 'Sonnet', scout: 'Haiku', wizard: 'Fable', adventurer: 'Adventurer' };
const BUBBLE_NAMES: Record<HeroClass, string> = { knight: 'OPUS', squire: 'SONNET', scout: 'HAIKU', wizard: 'FABLE', adventurer: 'ADVENTURER' };
const DEFAULT_ZOOM = 3;

function logLine(e: GameEvent, s: GameState): string | null {
  const who = NAMES[s.heroes[e.hero]?.heroClass ?? 'adventurer'];
  switch (e.kind) {
    case 'move': return `${who} read ${e.path}`;
    case 'forge': return `${who} ${e.created ? 'created' : 'forged'} ${e.path}`;
    case 'test_result': return e.failed.length ? `${who} ran tests · ${e.failed.length} failing — monsters!` : `${who} ran tests · all passing`;
    case 'hero_joined': return `${who} joined the party`;
    case 'hero_left': return `A hero left the dungeon`;
    case 'compacted': return `${who}'s memory fades · the fog returns`;
    case 'door_locked': return `${who} waits at a locked door`;
    default: return null;
  }
}

async function main() {
  const stageEl = document.getElementById('stage')!;
  const app = new Application();
  await app.init({ background: '#05060a', resizeTo: stageEl, antialias: false, roundPixels: true, preserveDrawingBuffer: true });
  stageEl.appendChild(app.canvas);
  await Promise.all(['700 12px Cinzel', '400 12px Inter', '600 12px Inter', '800 12px Inter'].map((f) => document.fonts.load(f)));

  const art = buildTextures();
  const world = new Container();
  app.stage.addChild(world);
  const lights = new LightLayer(app.renderer, art.gradient);
  let walkable: Walkable | null = null;
  const walk = (a: [number, number], b: [number, number]) => (walkable ? findPath(walkable, a, b) : null);
  let actors = new ActorLayer(art, walk);
  const bubbles = new BubbleLayer(document.getElementById('bubbles')!);
  const director = new Director();
  let chunks: ChunkLayer | null = null;
  let fog: FogLayer | null = null;
  let torchSpots: { x: number; y: number }[] = [];
  let forgedSpots: { x: number; y: number }[] = [];
  let forgedVersion = -1;
  let live: GameState | null = null;
  const history: GameEvent[] = [];
  const log: string[] = [];
  const audio = new AudioEngine();
  const cueLimiter = new CueLimiter();
  let lastMonsterDiedAt: number | null = null;
  let followedNow: HeroId | null = null;
  mountSoundControls(audio);

  // Timelapse playback (the scene renders `tl.state` on the video clock while `live` keeps updating).
  let tl: Timelapse | null = null;
  let videoMs = 0;
  let tlOnEnd: (() => void) | null = null;
  let tlClock = 0;
  let exporting = false;
  const scene = () => (tl ? tl.state : live);

  const cam = { x: 0, y: 0, zoom: DEFAULT_ZOOM, free: false };
  const hud = new Hud((hero) => {
    director.lock(director.lockedHero === hero ? null : hero);
    cam.free = false;
  });
  const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, (x, y) => flyTo(x * T, y * T));
  const search = new Search(() => scene()?.map ?? null, (hit) => flyTo(hit.x * T, hit.y * T, 2));

  function flyTo(x: number, y: number, zoom?: number) {
    cam.free = true;
    cam.x = x;
    cam.y = y;
    if (zoom) cam.zoom = zoom;
  }

  function setMap(map: DungeonMap) {
    chunks?.destroy();
    fog?.destroy();
    walkable = buildWalkable(map);
    chunks = new ChunkLayer(map);
    fog = new FogLayer(map);
    torchSpots = map.decor.filter((d) => d.kind === 'torch').map((d) => ({ x: d.x * T + 8, y: d.y * T + 12 }));
    forgedVersion = -1;
    world.removeChildren();
    world.addChild(chunks.container, fog.sprite, lights.world, actors.container); // heroes stay visible inside fogged rooms
    if (!app.stage.children.includes(lights.screen)) app.stage.addChild(lights.screen);
    const root = map.rooms[0];
    if (root && !cam.x && !cam.y) [cam.x, cam.y] = [(root.x + root.w / 2) * T, (root.y + root.h / 2) * T];
  }

  /** Per event, right after it was applied: actor effects and tiles to re-bake. */
  function presentOne(s: GameState, e: GameEvent, before: GameState['monsters'], dirty: number[]) {
    actors.onEvent(e, s, before);
    if (e.kind === 'move' || e.kind === 'forge') {
      const id = s.index[e.path];
      if (id !== undefined) dirty.push(id);
    }
    if (e.kind === 'compacted') chunks?.markDirty(s.tiles.keys(), s);
  }

  /** Per batch: re-bake dirty tiles, track fights for the music, play sounds. */
  function presentBatch(s: GameState, events: GameEvent[], monstersBefore: number, dirty: number[], nowT: number, fresh: (e: GameEvent) => boolean) {
    chunks?.markDirty(dirty, s);
    const monstersAfter = s.monsters.length;
    if (monstersBefore > 0 && monstersAfter === 0) lastMonsterDiedAt = nowT;
    if (audio.enabled) {
      const cues = planSounds(events.filter(fresh), { followed: followedNow, now: nowT, monstersBefore, monstersAfter });
      for (const cue of cues) if (cueLimiter.allow(cue, performance.now())) audio.play(cue);
    }
  }

  function apply(events: GameEvent[]) {
    if (!live) return;
    const dirty: number[] = [];
    const monstersBefore = live.monsters.length;
    for (const e of events) {
      history.push(e);
      const before = live.monsters;
      reduce(live, e);
      if (!tl) presentOne(live, e, before, dirty); // effects only when the live scene is on screen
      if (e.kind !== 'torch' && e.kind !== 'thinking' && e.kind !== 'stamina' && e.kind !== 'speech') director.notable(e.hero, e.kind, e.t);
      const line = logLine(e, live);
      if (line) log.unshift(line);
    }
    if (history.length > 100_000) history.splice(0, history.length - 100_000);
    log.length = Math.min(log.length, 20);
    if (!tl) presentBatch(live, events, monstersBefore, dirty, Date.now(), (e) => isFresh(e.t, Date.now()));
  }

  function rebuildScene(s: GameState, timelapse: boolean) {
    actors.destroy();
    actors = new ActorLayer(art, walk, { timelapse });
    setMap(s.map);
    actors.remap(s);
    chunks?.markDirty(s.tiles.keys(), s);
  }

  if (new URLSearchParams(location.search).has('debug'))
    Object.assign(window, { __rd: () => ({ state: scene(), live, chunks, director, exportDebug: () => ({ recorder: lastRecorderState(), tickerStarted: app.ticker.started, timelapse: !!tl }) }) });

  connect((m) => {
    if (m.type === 'hello') {
      live = initialState(m.map, m.index);
      history.length = 0;
      log.length = 0;
      if (!tl) setMap(m.map);
      apply(m.events);
    } else if (m.type === 'events') {
      apply(m.events);
    } else if (m.type === 'map' && live) {
      live = remapState(live, m.map, m.index);
      if (!tl) {
        setMap(m.map);
        actors.remap(live);
      }
    }
  }, (s) => (document.getElementById('status')!.textContent = s));

  // Input: drag to pan (free camera), wheel to zoom, keys.
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  app.canvas.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }));
  window.addEventListener('pointerup', () => (drag = null));
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) cam.free = true;
    if (cam.free) [cam.x, cam.y] = [drag.cx - dx / cam.zoom, drag.cy - dy / cam.zoom];
  });
  app.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.zoom = Math.min(6, Math.max(0.12, cam.zoom * Math.exp(-e.deltaY * 0.0015)));
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (search.isOpen || e.target instanceof HTMLInputElement) return;
    const s = scene();
    if (e.key === '/') { e.preventDefault(); search.open(); }
    else if (e.key === 'Escape') {
      if (tl) return exporting ? undefined : controller.stopTimelapse(); // an export owns its timelapse
      cam.free = false; director.lock(null); cam.zoom = Math.max(cam.zoom, 1.5);
    }
    else if (e.key === '+' || e.key === '=') cam.zoom = Math.min(6, cam.zoom * 1.25);
    else if (e.key === '-') cam.zoom = Math.max(0.12, cam.zoom / 1.25);
    else if (e.key === 'f' && s) {
      cam.free = true;
      [cam.x, cam.y] = [(s.map.width * T) / 2, (s.map.height * T) / 2];
      cam.zoom = Math.min(app.screen.width / (s.map.width * T), app.screen.height / (s.map.height * T)) * 0.9;
    }
  });

  let shown = { x: cam.x, y: cam.y, zoom: cam.zoom };
  let hudAt = 0, miniAt = 0;
  let lastBubbles: OverlayBubble[] = [];

  /** One frame of the scene. `dt` in ms; driven by the ticker, or by the exporter frame by frame. */
  function frame(dt: number, t: number) {
    const s = scene();
    if (!s || !chunks || !fog) return;
    let nowT = Date.now();
    let followed: HeroId | null;
    if (tl) {
      videoMs += dt;
      nowT = videoMs;
      const dirty: number[] = [];
      const monstersBefore = s.monsters.length;
      const res = tl.advance(videoMs, (e, st, before) => presentOne(st, e, before, dirty));
      tlClock = res.clockMs;
      if (res.fed.length) presentBatch(s, res.fed, monstersBefore, dirty, nowT, () => true);
      followed = null;
      if (!cam.free) {
        const pts = [...s.seen].slice(-1500).flatMap((id) => {
          const tile = s.tiles.get(id);
          return tile ? [{ x: tile.x, y: tile.y }] : [];
        });
        for (const h of Object.values(s.heroes)) pts.push({ x: h.x, y: h.y });
        const root = s.map.rooms[0];
        const f = frameBounds(pts, { w: app.screen.width, h: app.screen.height }, T, { center: root ? { x: root.x + root.w / 2, y: root.y + root.h / 2 } : undefined, maxZoom: 2.2 });
        [cam.x, cam.y, cam.zoom] = [f.x, f.y, f.zoom];
      }
      if (res.done && videoMs >= tl.targetMs + 600 && tlOnEnd) tlOnEnd();
    } else {
      followed = director.target(Object.keys(s.heroes), nowT);
      if (!cam.free && followed) {
        const p = actors.heroPos(followed);
        if (p) [cam.x, cam.y] = [p.x, p.y];
      }
    }
    followedNow = followed;
    if (audio.enabled) audio.setCombat(musicState(s.monsters.length, lastMonsterDiedAt, nowT).combat);
    actors.update(s, dt, nowT, t, lodFor(shown.zoom));
    const k = 1 - Math.pow(1 - (tl ? 0.06 : 0.12), dt / 16.7);
    shown = { x: shown.x + (cam.x - shown.x) * k, y: shown.y + (cam.y - shown.y) * k, zoom: shown.zoom + (cam.zoom - shown.zoom) * k };
    const W = app.screen.width, H = app.screen.height;
    world.scale.set(shown.zoom);
    world.position.set(Math.round(W / 2 - shown.x * shown.zoom), Math.round(H / 2 - shown.y * shown.zoom));
    const view = { x: shown.x - W / 2 / shown.zoom, y: shown.y - H / 2 / shown.zoom, w: W / shown.zoom, h: H / shown.zoom };
    const lod = lodFor(shown.zoom);
    chunks.update(view, lod, s);
    fog.update(s);
    fog.sprite.visible = lod !== 'far'; // the overview shows every room; explored % replaces the fog

    const inView = (x: number, y: number, pad = 120) => x > view.x - pad && x < view.x + view.w + pad && y > view.y - pad && y < view.y + view.h + pad;
    if (forgedVersion !== s.version) {
      forgedVersion = s.version;
      forgedSpots = [...s.forged].flatMap((id) => {
        const tile = s.tiles.get(id);
        return tile ? [{ x: tile.x * T + 8, y: tile.y * T + 8 }] : [];
      });
    }
    const torches = torchSpots.filter((p) => inView(p.x, p.y));
    const ls: Light[] = torches.map((p) => ({ x: p.x, y: p.y + 4, r: 74, color: 0xff8228, intensity: 0.24, flicker: 0.06 }));
    for (const p of forgedSpots) if (inView(p.x, p.y)) ls.push({ x: p.x, y: p.y, r: 22, color: 0xffd25a, intensity: 0.35, flicker: 0.04 });
    ls.push(...actors.lights(s, followed));
    const toScreen = (x: number, y: number) => ({ x: world.position.x + x * shown.zoom, y: world.position.y + y * shown.zoom });
    lights.update(ls, { x: shown.x, y: shown.y }, toScreen, shown.zoom, lod, t, torches, tl ? (lod === 'far' ? 0 : 0.42) : undefined);
    const heroScreen = (id: HeroId) => {
      const p = actors.heroPos(id);
      return p ? toScreen(p.x, p.y - 8) : null;
    };
    const monsterScreen = (hero: HeroId) => {
      const p = actors.monsterPos(s, hero);
      return p ? toScreen(p.x, p.y) : null;
    };
    bubbles.update(s, nowT, heroScreen, monsterScreen, W);
    lastBubbles = Object.values(s.heroes).flatMap((h) => {
      const p = h.speech && nowT - h.speech.t < 4000 ? heroScreen(h.id) : null;
      return p && h.speech ? [{ who: BUBBLE_NAMES[h.heroClass], color: '#e6c27a', text: h.speech.text, x: p.x, y: p.y }] : [];
    });

    if (t - hudAt > 250) {
      hudAt = t;
      hud.update(s, followed, director.lockedHero);
      hud.log(tl ? [] : log);
    }
    if (t - miniAt > 500) {
      miniAt = t;
      minimap.draw(s, { x: view.x / T, y: view.y / T, w: view.w / T, h: view.h / T });
    }
  }

  app.ticker.add((tk) => frame(Math.min(100, tk.deltaMS), performance.now()));

  const controller: Controller = {
    app,
    audio,
    hasHistory: () => history.length > 0,
    isTimelapse: () => !!tl,
    live: () => live,
    startTimelapse(targetMs, onEnd) {
      if (!live || !history.length) return false;
      tl = new Timelapse(live.map, live.index, history, targetMs);
      videoMs = 0;
      tlClock = 0;
      cam.free = false;
      tlOnEnd = () => controller.stopTimelapse(onEnd);
      document.body.classList.add('timelapse');
      rebuildScene(tl.state, true);
      return true;
    },
    stopTimelapse(onEnd) {
      if (!tl) return;
      tl = null;
      tlOnEnd = null;
      document.body.classList.remove('timelapse');
      if (live) rebuildScene(live, false);
      onEnd?.();
    },
    progress: () => ({ videoMs, targetMs: tl?.targetMs ?? 0, clockMs: tlClock }),
    overlay: () => {
      const s = scene();
      const explored = s && s.map.tiles.length ? Math.round((s.seen.size / s.map.tiles.length) * 100) : 0;
      return { clockMs: tl ? tlClock : 0, explored, bubbles: lastBubbles };
    },
    frame: (dt) => frame(dt, performance.now()),
    setExporting: (on) => {
      exporting = on;
    },
    setLabelAliases: (aliases) => chunks?.setLabelAliases(aliases),
    history: () => history,
  };
  mountTimelineBar(controller);
}

main();
