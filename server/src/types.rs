use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyName {
    Space,
    Left,
    Right,
    Up,
    Down,
    Enter,
    Escape,
    F,
    M,
    C,
    J,
    K,
    L,
    N,
    Comma,
    Period,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Modifier {
    Shift,
    Ctrl,
    Alt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ActionName {
    PlayPause,
    SeekBack10,
    SeekFwd10,
    SeekBack30,
    SeekFwd30,
    VolUp,
    VolDown,
    Mute,
    Fullscreen,
    Captions,
    NextEpisode,
    SpeedDown,
    SpeedUp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileName {
    Auto,
    Generic,
    Youtube,
    Netflix,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    Key {
        key: KeyName,
        #[serde(default)]
        mods: Vec<Modifier>,
    },
    Combo {
        keys: Vec<KeyName>,
    },
    Action {
        name: ActionName,
        profile: Option<ProfileName>,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage<'a> {
    Hello {
        version: &'a str,
        profiles: &'a [ProfileName],
    },
    State {
        active: bool,
    },
    Ack {
        #[serde(skip_serializing_if = "Option::is_none")]
        suppressed: Option<bool>,
    },
    Error {
        message: String,
    },
}

pub const ALL_PROFILES: &[ProfileName] = &[
    ProfileName::Auto,
    ProfileName::Generic,
    ProfileName::Youtube,
    ProfileName::Netflix,
];

pub const VERSION: &str = "0.1.0";
