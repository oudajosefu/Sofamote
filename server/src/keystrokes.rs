use enigo::{Direction, Enigo, Key, Keyboard, Settings};

use crate::types::{KeyName, Modifier};

fn map_key(k: KeyName) -> Key {
    match k {
        KeyName::Space  => Key::Space,
        KeyName::Left   => Key::LeftArrow,
        KeyName::Right  => Key::RightArrow,
        KeyName::Up     => Key::UpArrow,
        KeyName::Down   => Key::DownArrow,
        KeyName::Enter  => Key::Return,
        KeyName::Escape => Key::Escape,
        KeyName::F      => Key::Unicode('f'),
        KeyName::M      => Key::Unicode('m'),
        KeyName::C      => Key::Unicode('c'),
        KeyName::J      => Key::Unicode('j'),
        KeyName::K      => Key::Unicode('k'),
        KeyName::L      => Key::Unicode('l'),
        KeyName::N      => Key::Unicode('n'),
        KeyName::Comma  => Key::Unicode(','),
        KeyName::Period => Key::Unicode('.'),
    }
}

fn map_mod(m: Modifier) -> Key {
    match m {
        Modifier::Shift => Key::Shift,
        Modifier::Ctrl  => Key::Control,
        Modifier::Alt   => Key::Alt,
    }
}

pub fn tap(key: KeyName, mods: &[Modifier]) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    for &m in mods {
        enigo.key(map_mod(m), Direction::Press).map_err(|e| e.to_string())?;
    }
    enigo.key(map_key(key), Direction::Click).map_err(|e| e.to_string())?;
    for &m in mods.iter().rev() {
        enigo.key(map_mod(m), Direction::Release).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn combo(keys: &[KeyName]) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    for &k in keys {
        enigo.key(map_key(k), Direction::Click).map_err(|e| e.to_string())?;
    }
    Ok(())
}
