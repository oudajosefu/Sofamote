pub fn set_auto_launch(enabled: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    platform::set_auto_launch(enabled, &exe)
}

#[cfg(target_os = "windows")]
mod platform {
    use std::path::PathBuf;
    use winreg::enums::*;
    use winreg::RegKey;

    const APP_NAME: &str = "Sofamote";
    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

    pub fn set_auto_launch(enabled: bool, exe: &PathBuf) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run = hkcu
            .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE | KEY_QUERY_VALUE)
            .map_err(|e| e.to_string())?;

        if enabled {
            let vbs_path = write_vbs_wrapper(exe).map_err(|e| e.to_string())?;
            let cmd = format!("wscript.exe \"{}\"", vbs_path.display());
            run.set_value(APP_NAME, &cmd).map_err(|e| e.to_string())
        } else {
            run.delete_value(APP_NAME).or_else(|_| Ok(()))
        }
    }

    fn write_vbs_wrapper(exe: &PathBuf) -> std::io::Result<PathBuf> {
        let config_dir = dirs::config_dir().unwrap().join("sofamote");
        std::fs::create_dir_all(&config_dir)?;
        let vbs = config_dir.join("start.vbs");
        let script = format!(
            "Set sh = CreateObject(\"WScript.Shell\")\nsh.Run \"\"\"{}\"\"\", 0, False\n",
            exe.display()
        );
        std::fs::write(&vbs, script)?;
        Ok(vbs)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use std::path::PathBuf;

    const DESKTOP_FILE: &str = "sofamote.desktop";

    pub fn set_auto_launch(enabled: bool, exe: &PathBuf) -> Result<(), String> {
        let autostart = dirs::config_dir().ok_or("no config dir")?.join("autostart");
        let desktop = autostart.join(DESKTOP_FILE);
        if enabled {
            std::fs::create_dir_all(&autostart).map_err(|e| e.to_string())?;
            let content = format!(
                "[Desktop Entry]\nType=Application\nName=Sofamote\nExec={}\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n",
                exe.display()
            );
            std::fs::write(&desktop, content).map_err(|e| e.to_string())
        } else {
            std::fs::remove_file(&desktop).or_else(|_| Ok(()))
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::path::PathBuf;

    const PLIST_FILE: &str = "com.sofamote.plist";

    pub fn set_auto_launch(enabled: bool, exe: &PathBuf) -> Result<(), String> {
        let agents_dir = dirs::home_dir()
            .ok_or("no home dir")?
            .join("Library")
            .join("LaunchAgents");
        let plist = agents_dir.join(PLIST_FILE);
        if enabled {
            std::fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;
            let content = format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
                 <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
                 <plist version=\"1.0\">\n\
                 <dict>\n\
                   <key>Label</key><string>com.sofamote</string>\n\
                   <key>ProgramArguments</key>\n\
                   <array><string>{}</string></array>\n\
                   <key>RunAtLoad</key><true/>\n\
                 </dict>\n\
                 </plist>\n",
                exe.display()
            );
            std::fs::write(&plist, content).map_err(|e| e.to_string())
        } else {
            std::fs::remove_file(&plist).or_else(|_| Ok(()))
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
mod platform {
    use std::path::PathBuf;
    pub fn set_auto_launch(_enabled: bool, _exe: &PathBuf) -> Result<(), String> {
        Err("auto-launch not supported on this platform".into())
    }
}
