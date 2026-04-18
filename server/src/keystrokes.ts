import { keyboard, Key } from "@nut-tree-fork/nut-js";
import type { KeyName, Modifier } from "./types.js";

keyboard.config.autoDelayMs = 0;

const KEY_MAP: Record<KeyName, Key> = {
  space: Key.Space,
  left: Key.Left,
  right: Key.Right,
  up: Key.Up,
  down: Key.Down,
  enter: Key.Enter,
  escape: Key.Escape,
  f: Key.F,
  m: Key.M,
  c: Key.C,
  j: Key.J,
  k: Key.K,
  l: Key.L,
  n: Key.N,
  comma: Key.Comma,
  period: Key.Period
};

const MOD_MAP: Record<Modifier, Key> = {
  shift: Key.LeftShift,
  ctrl: Key.LeftControl,
  alt: Key.LeftAlt
};

export async function tap(key: KeyName, mods: Modifier[] = []): Promise<void> {
  const target = KEY_MAP[key];
  if (mods.length === 0) {
    await keyboard.type(target);
    return;
  }
  const modKeys = mods.map((m) => MOD_MAP[m]);
  await keyboard.type(...modKeys, target);
}

export async function combo(keys: KeyName[]): Promise<void> {
  for (const key of keys) {
    await keyboard.type(KEY_MAP[key]);
  }
}
