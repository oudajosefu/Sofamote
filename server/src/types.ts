import { z } from "zod";

export const keyNameSchema = z.enum([
  "space",
  "left",
  "right",
  "up",
  "down",
  "enter",
  "escape",
  "f",
  "m",
  "c",
  "j",
  "k",
  "l",
  "n",
  "comma",
  "period"
]);
export type KeyName = z.infer<typeof keyNameSchema>;

export const modifierSchema = z.enum(["shift", "ctrl", "alt"]);
export type Modifier = z.infer<typeof modifierSchema>;

export const profileNameSchema = z.enum(["auto", "generic", "youtube", "netflix"]);
export type ProfileName = z.infer<typeof profileNameSchema>;

export const actionNameSchema = z.enum([
  "playPause",
  "seekBack10",
  "seekFwd10",
  "seekBack30",
  "seekFwd30",
  "volUp",
  "volDown",
  "mute",
  "fullscreen",
  "captions",
  "nextEpisode",
  "speedDown",
  "speedUp"
]);
export type ActionName = z.infer<typeof actionNameSchema>;

export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("key"),
    key: keyNameSchema,
    mods: z.array(modifierSchema).optional()
  }),
  z.object({
    type: z.literal("combo"),
    keys: z.array(keyNameSchema).min(1).max(8)
  }),
  z.object({
    type: z.literal("action"),
    name: actionNameSchema,
    profile: profileNameSchema.optional()
  })
]);
export type Command = z.infer<typeof commandSchema>;

export type ServerMessage =
  | { type: "hello"; version: string; profiles: ProfileName[] }
  | { type: "state"; active: boolean }
  | { type: "ack"; id?: string; suppressed?: boolean }
  | { type: "error"; message: string };
