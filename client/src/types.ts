export type ProfileName = "auto" | "generic" | "youtube" | "netflix";

export type ActionName =
  | "playPause"
  | "seekBack10"
  | "seekFwd10"
  | "seekBack30"
  | "seekFwd30"
  | "volUp"
  | "volDown"
  | "mute"
  | "fullscreen"
  | "captions"
  | "nextEpisode"
  | "speedDown"
  | "speedUp";

export interface ActionCommand {
  type: "action";
  name: ActionName;
  profile?: ProfileName;
}

export type Command = ActionCommand;

export type ServerMessage =
  | { type: "hello"; version: string; profiles: ProfileName[] }
  | { type: "state"; active: boolean }
  | { type: "ack"; id?: string; suppressed?: boolean }
  | { type: "error"; message: string };

export type ConnectionState = "connecting" | "open" | "closed";
