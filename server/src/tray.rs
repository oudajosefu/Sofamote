use muda::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{TrayIcon, TrayIconBuilder};

const ACTIVE_ICON: &[u8] = include_bytes!("../assets/icon-active.png");
const INACTIVE_ICON: &[u8] = include_bytes!("../assets/icon-inactive.png");

pub enum TrayCmd {
    SetActive(bool),
    SetAutoLaunch(bool),
}

pub struct TrayHandle {
    _icon: TrayIcon,
    active_item: CheckMenuItem,
    autolaunch_item: CheckMenuItem,
    pairing_url: String,
}

impl TrayHandle {
    pub fn set_active(&self, active: bool) {
        self.active_item.set_checked(active);
        if let Ok(icon) = load_icon(active) {
            self._icon.set_icon(Some(icon)).ok();
        }
        self._icon
            .set_tooltip(Some(tooltip(active, &self.pairing_url)))
            .ok();
    }

    pub fn set_auto_launch(&self, enabled: bool) {
        self.autolaunch_item.set_checked(enabled);
    }
}

pub struct MenuIds {
    pub active: muda::MenuId,
    pub autolaunch: muda::MenuId,
    pub show_qr: muda::MenuId,
    pub quit: muda::MenuId,
}

pub fn build_tray(
    pairing_url: &str,
    initial_active: bool,
    initial_autolaunch: bool,
) -> Result<(TrayHandle, MenuIds), Box<dyn std::error::Error>> {
    let active_item =
        CheckMenuItem::new("Active (forwarding keystrokes)", true, initial_active, None);
    let autolaunch_item = CheckMenuItem::new("Launch on startup", true, initial_autolaunch, None);
    let show_qr_item = MenuItem::new("Show pairing QR\u{2026}", true, None);
    let quit_item = MenuItem::new("Quit", true, None);

    let ids = MenuIds {
        active: active_item.id().clone(),
        autolaunch: autolaunch_item.id().clone(),
        show_qr: show_qr_item.id().clone(),
        quit: quit_item.id().clone(),
    };

    let menu = Menu::new();
    menu.append_items(&[
        &active_item,
        &autolaunch_item,
        &PredefinedMenuItem::separator(),
        &show_qr_item,
        &PredefinedMenuItem::separator(),
        &quit_item,
    ])?;

    let icon = load_icon(initial_active)?;
    let tray = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_icon(icon)
        .with_tooltip(tooltip(initial_active, pairing_url))
        .build()?;

    let handle = TrayHandle {
        _icon: tray,
        active_item,
        autolaunch_item,
        pairing_url: pairing_url.to_string(),
    };

    Ok((handle, ids))
}

pub fn poll_menu_event() -> Option<MenuEvent> {
    MenuEvent::receiver().try_recv().ok()
}

fn load_icon(active: bool) -> Result<tray_icon::Icon, Box<dyn std::error::Error>> {
    let bytes = if active { ACTIVE_ICON } else { INACTIVE_ICON };
    let img = image::load_from_memory(bytes)?.to_rgba8();
    let (w, h) = img.dimensions();
    Ok(tray_icon::Icon::from_rgba(img.into_raw(), w, h)?)
}

fn tooltip(active: bool, pairing_url: &str) -> String {
    format!(
        "Sofamote \u{2014} {}\n{}",
        if active { "Active" } else { "Paused" },
        pairing_url
    )
}
