use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};

use crate::types::{KeyName, Modifier, MouseButton};

fn map_key(k: KeyName) -> Key {
    match k {
        KeyName::Space => Key::Space,
        KeyName::Left => Key::LeftArrow,
        KeyName::Right => Key::RightArrow,
        KeyName::Up => Key::UpArrow,
        KeyName::Down => Key::DownArrow,
        KeyName::Enter => Key::Return,
        KeyName::Escape => Key::Escape,
        KeyName::F => Key::Unicode('f'),
        KeyName::M => Key::Unicode('m'),
        KeyName::C => Key::Unicode('c'),
        KeyName::J => Key::Unicode('j'),
        KeyName::K => Key::Unicode('k'),
        KeyName::L => Key::Unicode('l'),
        KeyName::N => Key::Unicode('n'),
        KeyName::Comma => Key::Unicode(','),
        KeyName::Period => Key::Unicode('.'),
        KeyName::Tab => Key::Tab,
        KeyName::Backspace => Key::Backspace,
        KeyName::Delete => Key::Delete,
        KeyName::Home => Key::Home,
        KeyName::End => Key::End,
        KeyName::PageUp => Key::PageUp,
        KeyName::PageDown => Key::PageDown,
        KeyName::A => Key::Unicode('a'),
        KeyName::D => Key::Unicode('d'),
        KeyName::R => Key::Unicode('r'),
        KeyName::T => Key::Unicode('t'),
        KeyName::V => Key::Unicode('v'),
        KeyName::W => Key::Unicode('w'),
        KeyName::X => Key::Unicode('x'),
        KeyName::Z => Key::Unicode('z'),
        KeyName::F12 => Key::F12,
    }
}

fn map_mod(m: Modifier) -> Key {
    match m {
        Modifier::Shift => Key::Shift,
        Modifier::Ctrl => Key::Control,
        Modifier::Alt => Key::Alt,
        Modifier::Win => Key::Meta,
    }
}

pub fn tap(key: KeyName, mods: &[Modifier]) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    for &m in mods {
        enigo
            .key(map_mod(m), Direction::Press)
            .map_err(|e| e.to_string())?;
    }
    enigo
        .key(map_key(key), Direction::Click)
        .map_err(|e| e.to_string())?;
    for &m in mods.iter().rev() {
        enigo
            .key(map_mod(m), Direction::Release)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn combo(keys: &[KeyName]) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    for &k in keys {
        enigo
            .key(map_key(k), Direction::Click)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn mouse_move(dx: f32, dy: f32) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo
        .move_mouse(dx.round() as i32, dy.round() as i32, Coordinate::Rel)
        .map_err(|e| e.to_string())
}

pub fn mouse_click(button: MouseButton) -> Result<(), String> {
    let btn = match button {
        MouseButton::Left => Button::Left,
        MouseButton::Right => Button::Right,
        MouseButton::Middle => Button::Middle,
    };
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.button(btn, Direction::Click).map_err(|e| e.to_string())
}

pub fn mouse_scroll(dx: f32, dy: f32) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    // Negate dy: positive touch-delta (finger moves down) → scroll content down (natural scrolling)
    let vy = (-dy).round() as i32;
    let vx = (-dx).round() as i32;
    if vy != 0 {
        enigo
            .scroll(vy, Axis::Vertical)
            .map_err(|e| e.to_string())?;
    }
    if vx != 0 {
        enigo
            .scroll(vx, Axis::Horizontal)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn type_text(text: &str) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.text(text).map_err(|e| e.to_string())
}
