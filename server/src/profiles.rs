use std::collections::HashMap;
use std::sync::LazyLock;

use crate::types::{
    ActionBindings, ActionName, KeyName, Modifier, ProfileBindings, ProfileName, ALL_ACTIONS,
    ALL_PROFILES,
};

type ActionMap = HashMap<ActionName, ActionRecipe>;

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

static GENERIC: LazyLock<ActionMap> = LazyLock::new(|| {
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

static YOUTUBE: LazyLock<ActionMap> = LazyLock::new(|| {
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

static NETFLIX: LazyLock<ActionMap> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert(
        ActionName::NextEpisode,
        key_mod(KeyName::N, &[Modifier::Shift]),
    );
    m
});

fn format_key(key: KeyName) -> String {
    match key {
        KeyName::Space => "␣".into(),
        KeyName::Left => "←".into(),
        KeyName::Right => "→".into(),
        KeyName::Up => "↑".into(),
        KeyName::Down => "↓".into(),
        KeyName::Enter => "Enter".into(),
        KeyName::Escape => "Esc".into(),
        KeyName::F => "F".into(),
        KeyName::M => "M".into(),
        KeyName::C => "C".into(),
        KeyName::J => "J".into(),
        KeyName::K => "K".into(),
        KeyName::L => "L".into(),
        KeyName::N => "N".into(),
        KeyName::Comma => ",".into(),
        KeyName::Period => ".".into(),
        KeyName::Tab => "Tab".into(),
        KeyName::Backspace => "⌫".into(),
        KeyName::Delete => "Del".into(),
        KeyName::Home => "Home".into(),
        KeyName::End => "End".into(),
        KeyName::PageUp => "PgUp".into(),
        KeyName::PageDown => "PgDn".into(),
        KeyName::A => "A".into(),
        KeyName::D => "D".into(),
        KeyName::R => "R".into(),
        KeyName::T => "T".into(),
        KeyName::V => "V".into(),
        KeyName::W => "W".into(),
        KeyName::X => "X".into(),
        KeyName::Z => "Z".into(),
        KeyName::F12 => "F12".into(),
    }
}

fn format_modifier(modifier: Modifier) -> &'static str {
    match modifier {
        Modifier::Shift => "Shift",
        Modifier::Ctrl => "Ctrl",
        Modifier::Alt => "Alt",
        Modifier::Win => "Win",
    }
}

fn format_recipe(recipe: &ActionRecipe) -> Option<String> {
    if let Some(combo) = &recipe.combo {
        return format_combo(combo);
    }

    recipe.key.map(|key| {
        let key_label = format_key(key);
        if recipe.mods.is_empty() {
            key_label
        } else {
            let modifiers = recipe
                .mods
                .iter()
                .map(|modifier| format_modifier(*modifier))
                .collect::<Vec<_>>()
                .join("+");
            format!("{modifiers}+{key_label}")
        }
    })
}

fn format_combo(keys: &[KeyName]) -> Option<String> {
    let first = *keys.first()?;
    if keys.iter().all(|key| *key == first) {
        return Some(format!("{}×{}", format_key(first), keys.len()));
    }

    Some(
        keys.iter()
            .map(|key| format_key(*key))
            .collect::<Vec<_>>()
            .join(" "),
    )
}

fn bindings_for_profile(profile: ProfileName) -> ProfileBindings {
    ALL_ACTIONS
        .iter()
        .filter_map(|action| {
            resolve_action(Some(profile), *action)
                .and_then(format_recipe)
                .map(|binding| (*action, binding))
        })
        .collect()
}

pub fn action_bindings() -> ActionBindings {
    ALL_PROFILES
        .iter()
        .map(|profile| (*profile, bindings_for_profile(*profile)))
        .collect()
}

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

#[cfg(test)]
mod tests {
    use super::{action_bindings, bindings_for_profile};
    use crate::types::{ActionName, ProfileName};

    #[test]
    fn generic_play_pause_uses_space_symbol() {
        let bindings = bindings_for_profile(ProfileName::Generic);
        assert_eq!(
            bindings.get(&ActionName::PlayPause).map(String::as_str),
            Some("␣")
        );
    }

    #[test]
    fn generic_seek_thirty_formats_repeated_combo() {
        let bindings = bindings_for_profile(ProfileName::Generic);
        assert_eq!(
            bindings.get(&ActionName::SeekBack30).map(String::as_str),
            Some("←×3")
        );
        assert_eq!(
            bindings.get(&ActionName::SeekFwd30).map(String::as_str),
            Some("→×3")
        );
    }

    #[test]
    fn youtube_speed_controls_include_shift_modifier() {
        let bindings = bindings_for_profile(ProfileName::Youtube);
        assert_eq!(
            bindings.get(&ActionName::SpeedDown).map(String::as_str),
            Some("Shift+,")
        );
        assert_eq!(
            bindings.get(&ActionName::SpeedUp).map(String::as_str),
            Some("Shift+.")
        );
    }

    #[test]
    fn netflix_next_episode_binding_is_exported() {
        let bindings = bindings_for_profile(ProfileName::Netflix);
        assert_eq!(
            bindings.get(&ActionName::NextEpisode).map(String::as_str),
            Some("Shift+N")
        );
    }

    #[test]
    fn auto_bindings_match_current_generic_resolution() {
        let bindings = action_bindings();
        let auto = bindings.get(&ProfileName::Auto).expect("auto bindings");
        let generic = bindings
            .get(&ProfileName::Generic)
            .expect("generic bindings");

        assert_eq!(
            auto.get(&ActionName::PlayPause).map(String::as_str),
            Some("␣")
        );
        assert_eq!(auto, generic);
    }
}
