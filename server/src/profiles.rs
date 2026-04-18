use std::collections::HashMap;
use std::sync::LazyLock;

use crate::types::{ActionName, KeyName, Modifier, ProfileName};

pub struct ActionRecipe {
    pub key: Option<KeyName>,
    pub mods: Vec<Modifier>,
    pub combo: Option<Vec<KeyName>>,
}

fn key(k: KeyName) -> ActionRecipe {
    ActionRecipe {
        key: Some(k),
        mods: vec![],
        combo: None,
    }
}

fn key_mod(k: KeyName, mods: &[Modifier]) -> ActionRecipe {
    ActionRecipe {
        key: Some(k),
        mods: mods.to_vec(),
        combo: None,
    }
}

fn combo(keys: &[KeyName]) -> ActionRecipe {
    ActionRecipe {
        key: None,
        mods: vec![],
        combo: Some(keys.to_vec()),
    }
}

static GENERIC: LazyLock<HashMap<ActionName, ActionRecipe>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert(ActionName::PlayPause, key(KeyName::Space));
    m.insert(ActionName::SeekBack10, key(KeyName::Left));
    m.insert(ActionName::SeekFwd10, key(KeyName::Right));
    m.insert(
        ActionName::SeekBack30,
        combo(&[KeyName::Left, KeyName::Left, KeyName::Left]),
    );
    m.insert(
        ActionName::SeekFwd30,
        combo(&[KeyName::Right, KeyName::Right, KeyName::Right]),
    );
    m.insert(ActionName::VolUp, key(KeyName::Up));
    m.insert(ActionName::VolDown, key(KeyName::Down));
    m.insert(ActionName::Mute, key(KeyName::M));
    m.insert(ActionName::Fullscreen, key(KeyName::F));
    m.insert(ActionName::Captions, key(KeyName::C));
    m
});

static YOUTUBE: LazyLock<HashMap<ActionName, ActionRecipe>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert(ActionName::PlayPause, key(KeyName::K));
    m.insert(ActionName::SeekBack10, key(KeyName::J));
    m.insert(ActionName::SeekFwd10, key(KeyName::L));
    m.insert(
        ActionName::SeekBack30,
        key_mod(KeyName::Left, &[Modifier::Shift]),
    );
    m.insert(
        ActionName::SeekFwd30,
        key_mod(KeyName::Right, &[Modifier::Shift]),
    );
    m.insert(ActionName::VolUp, key(KeyName::Up));
    m.insert(ActionName::VolDown, key(KeyName::Down));
    m.insert(ActionName::Mute, key(KeyName::M));
    m.insert(ActionName::Fullscreen, key(KeyName::F));
    m.insert(ActionName::Captions, key(KeyName::C));
    m.insert(
        ActionName::NextEpisode,
        key_mod(KeyName::N, &[Modifier::Shift]),
    );
    m.insert(
        ActionName::SpeedDown,
        key_mod(KeyName::Comma, &[Modifier::Shift]),
    );
    m.insert(
        ActionName::SpeedUp,
        key_mod(KeyName::Period, &[Modifier::Shift]),
    );
    m
});

static NETFLIX: LazyLock<HashMap<ActionName, ActionRecipe>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert(
        ActionName::NextEpisode,
        key_mod(KeyName::N, &[Modifier::Shift]),
    );
    m
});

pub fn resolve_action(
    profile: Option<ProfileName>,
    action: ActionName,
) -> Option<&'static ActionRecipe> {
    let specific = match profile.unwrap_or(ProfileName::Auto) {
        ProfileName::Youtube => YOUTUBE.get(&action),
        ProfileName::Netflix => NETFLIX.get(&action).or_else(|| GENERIC.get(&action)),
        ProfileName::Auto | ProfileName::Generic => GENERIC.get(&action),
    };
    specific.or_else(|| GENERIC.get(&action))
}
