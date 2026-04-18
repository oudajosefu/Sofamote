import type { ActionName, KeyName, Modifier, ProfileName } from "./types.js";

export interface ActionRecipe {
  key?: KeyName;
  mods?: Modifier[];
  combo?: KeyName[];
}

type ActionMap = Partial<Record<ActionName, ActionRecipe>>;

const GENERIC: ActionMap = {
  playPause: { key: "space" },
  seekBack10: { key: "left" },
  seekFwd10: { key: "right" },
  seekBack30: { combo: ["left", "left", "left"] },
  seekFwd30: { combo: ["right", "right", "right"] },
  volUp: { key: "up" },
  volDown: { key: "down" },
  mute: { key: "m" },
  fullscreen: { key: "f" },
  captions: { key: "c" }
};

const YOUTUBE: ActionMap = {
  playPause: { key: "k" },
  seekBack10: { key: "j" },
  seekFwd10: { key: "l" },
  seekBack30: { key: "left", mods: ["shift"] },
  seekFwd30: { key: "right", mods: ["shift"] },
  volUp: { key: "up" },
  volDown: { key: "down" },
  mute: { key: "m" },
  fullscreen: { key: "f" },
  captions: { key: "c" },
  nextEpisode: { key: "n", mods: ["shift"] },
  speedDown: { key: "comma", mods: ["shift"] },
  speedUp: { key: "period", mods: ["shift"] }
};

const NETFLIX: ActionMap = {
  ...GENERIC,
  nextEpisode: { key: "n", mods: ["shift"] }
};

const PROFILES: Record<ProfileName, ActionMap> = {
  auto: GENERIC,
  generic: GENERIC,
  youtube: YOUTUBE,
  netflix: NETFLIX
};

export function resolveAction(
  profile: ProfileName | undefined,
  action: ActionName
): ActionRecipe | null {
  const map = PROFILES[profile ?? "auto"];
  return map[action] ?? GENERIC[action] ?? null;
}

export function listProfiles(): ProfileName[] {
  return Object.keys(PROFILES) as ProfileName[];
}
