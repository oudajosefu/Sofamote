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

export type ActionBindings = Record<ProfileName, Partial<Record<ActionName, string>>>;

export type InterfaceName = "media" | "fullControl" | "trackpad";

export interface ActionCommand {
  type: "action";
  name: ActionName;
  profile?: ProfileName;
}

export interface KeyCommand {
  type: "key";
  key: string;
  mods?: string[];
}

export interface MouseMoveCommand {
  type: "mouseMove";
  dx: number;
  dy: number;
}

export interface MouseClickCommand {
  type: "mouseClick";
  button: "left" | "right" | "middle";
}

export interface MouseScrollCommand {
  type: "mouseScroll";
  dx: number;
  dy: number;
}

export interface TypeTextCommand {
  type: "typeText";
  text: string;
}

export type Command =
  | ActionCommand
  | KeyCommand
  | MouseMoveCommand
  | MouseClickCommand
  | MouseScrollCommand
  | TypeTextCommand;

export type ServerMessage =
  | { type: "hello"; version: string; profiles: ProfileName[]; bindings: ActionBindings }
  | { type: "state"; active: boolean }
  | { type: "ack"; id?: string; suppressed?: boolean }
  | { type: "error"; message: string };

export type ConnectionState = "connecting" | "open" | "closed";
