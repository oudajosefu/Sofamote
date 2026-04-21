use std::io::{self, ErrorKind, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::time::{Duration, Instant};

use native_dialog::{DialogBuilder, MessageLevel};

pub const INSTANCE_PROBE_PATH: &str = "/.well-known/sofamote-instance";
pub const INSTANCE_HEADER_NAME: &str = "x-sofamote-instance";
pub const INSTANCE_HEADER_VALUE: &str = "1";
pub const INSTANCE_VERSION_HEADER_NAME: &str = "x-sofamote-version";

const PROBE_WINDOW: Duration = Duration::from_secs(2);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(150);
const READ_TIMEOUT: Duration = Duration::from_millis(200);
const RETRY_DELAY: Duration = Duration::from_millis(100);

pub enum ClaimResult {
    Primary(TcpListener),
    Exit(i32),
}

pub fn claim_primary_listener(port: u16) -> ClaimResult {
    match bind_primary_listener(port) {
        Ok(listener) => ClaimResult::Primary(listener),
        Err(err) if err.kind() == ErrorKind::AddrInUse => {
            if wait_for_existing_instance(port, PROBE_WINDOW) {
                tracing::info!("existing Sofamote instance detected on port {port}");
                show_notice(
                    "Sofamote is already running.\nUse the tray or menu bar icon to manage it.",
                );
                ClaimResult::Exit(0)
            } else {
                match bind_primary_listener(port) {
                    Ok(listener) => ClaimResult::Primary(listener),
                    Err(retry_err) if retry_err.kind() == ErrorKind::AddrInUse => {
                        tracing::error!("port {port} is already in use by another application");
                        show_error(&format!(
                            "Sofamote couldn't start because port {port} is already in use by another application."
                        ));
                        ClaimResult::Exit(1)
                    }
                    Err(retry_err) => {
                        tracing::error!("failed to bind port {port}: {retry_err}");
                        show_error(&format!(
                            "Sofamote couldn't start because it failed to open port {port}.\n\n{retry_err}"
                        ));
                        ClaimResult::Exit(1)
                    }
                }
            }
        }
        Err(err) => {
            tracing::error!("failed to bind port {port}: {err}");
            show_error(&format!(
                "Sofamote couldn't start because it failed to open port {port}.\n\n{err}"
            ));
            ClaimResult::Exit(1)
        }
    }
}

fn bind_primary_listener(port: u16) -> io::Result<TcpListener> {
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, port))?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

fn wait_for_existing_instance(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
    let deadline = Instant::now() + timeout;

    loop {
        match probe_instance_once(addr, CONNECT_TIMEOUT, READ_TIMEOUT) {
            Ok(true) => return true,
            Ok(false) => {}
            Err(err) => tracing::debug!("instance probe failed: {err}"),
        }

        if Instant::now() >= deadline {
            return false;
        }

        std::thread::sleep(RETRY_DELAY);
    }
}

fn probe_instance_once(
    addr: SocketAddr,
    connect_timeout: Duration,
    read_timeout: Duration,
) -> io::Result<bool> {
    let mut stream = TcpStream::connect_timeout(&addr, connect_timeout)?;
    stream.set_read_timeout(Some(read_timeout))?;
    stream.set_write_timeout(Some(read_timeout))?;

    let request = format!(
        "GET {INSTANCE_PROBE_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes())?;

    let response = read_response_headers(&mut stream)?;
    Ok(is_sofamote_probe_response(&response))
}

fn read_response_headers(stream: &mut TcpStream) -> io::Result<Vec<u8>> {
    let mut response = Vec::new();
    let mut chunk = [0u8; 1024];

    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => {
                response.extend_from_slice(&chunk[..count]);
                if response.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            Err(err)
                if matches!(err.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut)
                    && !response.is_empty() =>
            {
                break;
            }
            Err(err) => return Err(err),
        }
    }

    if response.is_empty() {
        return Err(io::Error::new(
            ErrorKind::UnexpectedEof,
            "instance probe returned no data",
        ));
    }

    Ok(response)
}

fn is_sofamote_probe_response(response: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(response) else {
        return false;
    };

    let mut lines = text.split("\r\n");
    let Some(status_line) = lines.next() else {
        return false;
    };

    let mut status_parts = status_line.split_whitespace();
    let _http_version = status_parts.next();
    if status_parts.next() != Some("204") {
        return false;
    }

    lines.any(|line| {
        let Some((name, value)) = line.split_once(':') else {
            return false;
        };
        name.trim().eq_ignore_ascii_case(INSTANCE_HEADER_NAME)
            && value.trim() == INSTANCE_HEADER_VALUE
    })
}

fn show_notice(message: &str) {
    show_dialog(MessageLevel::Info, message);
}

fn show_error(message: &str) {
    show_dialog(MessageLevel::Error, message);
}

fn show_dialog(level: MessageLevel, message: &str) {
    if let Err(err) = DialogBuilder::message()
        .set_title("Sofamote")
        .set_text(message)
        .set_level(level)
        .alert()
        .show()
    {
        tracing::warn!("failed to show startup dialog: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::{
        probe_instance_once, INSTANCE_HEADER_NAME, INSTANCE_HEADER_VALUE,
        INSTANCE_VERSION_HEADER_NAME,
    };
    use crate::types::VERSION;
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener};
    use std::time::Duration;

    #[test]
    fn probe_accepts_valid_sofamote_marker() {
        let (addr, handle) = spawn_stub_server(|mut stream| {
            let response = format!(
                "HTTP/1.1 204 No Content\r\n{INSTANCE_HEADER_NAME}: {INSTANCE_HEADER_VALUE}\r\n{INSTANCE_VERSION_HEADER_NAME}: {VERSION}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(response.as_bytes()).unwrap();
        });

        let result =
            probe_instance_once(addr, Duration::from_millis(200), Duration::from_millis(200))
                .unwrap();

        handle.join().unwrap();
        assert!(result);
    }

    #[test]
    fn probe_rejects_wrong_marker_response() {
        let (addr, handle) = spawn_stub_server(|mut stream| {
            let response = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok";
            stream.write_all(response.as_bytes()).unwrap();
        });

        let result =
            probe_instance_once(addr, Duration::from_millis(200), Duration::from_millis(200))
                .unwrap();

        handle.join().unwrap();
        assert!(!result);
    }

    #[test]
    fn probe_errors_when_server_never_responds() {
        let (addr, handle) = spawn_stub_server(|_stream| {
            std::thread::sleep(Duration::from_millis(200));
        });

        let result =
            probe_instance_once(addr, Duration::from_millis(50), Duration::from_millis(50));

        handle.join().unwrap();
        assert!(result.is_err());
    }

    fn spawn_stub_server<F>(handler: F) -> (SocketAddr, std::thread::JoinHandle<()>)
    where
        F: FnOnce(std::net::TcpStream) + Send + 'static,
    {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let addr = SocketAddr::V4(SocketAddrV4::new(
            Ipv4Addr::LOCALHOST,
            listener.local_addr().unwrap().port(),
        ));

        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request);
            handler(stream);
        });

        (addr, handle)
    }
}
