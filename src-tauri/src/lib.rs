use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const KEYCHAIN_SERVICE: &str = "Playlist Bridge";
const OAUTH_PORT: u16 = 8888;

/// Incrémenté à chaque nouvelle connexion : l'écoute précédente s'arrête et libère le port.
static OAUTH_GEN: AtomicU64 = AtomicU64::new(0);
/// Écritures du fichier de session, au cas où le trousseau refuse l'app non signée.
static SESSIONS: Mutex<()> = Mutex::new(());

fn account(service: &str) -> Result<(), String> {
    match service {
        "spotify" | "tidal" => Ok(()),
        _ => Err("Service inconnu".into()),
    }
}

fn entry(service: &str) -> Result<keyring::Entry, String> {
    account(service)?;
    keyring::Entry::new(KEYCHAIN_SERVICE, service).map_err(|e| e.to_string())
}

fn sessions_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("sessions.json"))
}

fn read_sessions(path: &Path) -> HashMap<String, String> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn write_sessions(path: &Path, sessions: &HashMap<String, String>) -> Result<(), String> {
    let bytes = serde_json::to_vec(sessions).map_err(|e| e.to_string())?;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts.open(path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())
}

fn remember(app: &tauri::AppHandle, service: &str, secret: Option<String>) -> Result<(), String> {
    let _guard = SESSIONS.lock().map_err(|e| e.to_string())?;
    let path = sessions_file(app)?;
    let mut sessions = read_sessions(&path);
    match secret {
        Some(value) => {
            sessions.insert(service.to_string(), value);
        }
        None => {
            sessions.remove(service);
        }
    }
    write_sessions(&path, &sessions)
}

#[tauri::command]
fn token_get(app: tauri::AppHandle, service: String) -> Result<Option<String>, String> {
    account(&service)?;
    if let Ok(entry) = entry(&service) {
        match entry.get_password() {
            Ok(secret) => return Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => {}
            Err(_) => {}
        }
    }
    let _guard = SESSIONS.lock().map_err(|e| e.to_string())?;
    let path = sessions_file(&app)?;
    Ok(read_sessions(&path).remove(&service))
}

#[tauri::command]
fn token_set(app: tauri::AppHandle, service: String, secret: String) -> Result<(), String> {
    account(&service)?;
    remember(&app, &service, Some(secret.clone()))?;
    if let Ok(entry) = entry(&service) {
        let _ = entry.set_password(&secret);
    }
    Ok(())
}

#[tauri::command]
fn token_delete(app: tauri::AppHandle, service: String) -> Result<(), String> {
    account(&service)?;
    remember(&app, &service, None)?;
    if let Ok(entry) = entry(&service) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => {}
        }
    }
    Ok(())
}

fn legacy_dir() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        let home = std::env::var_os("HOME")?;
        return Some(PathBuf::from(home).join("Library/Application Support/playlist-bridge"));
    }
    if cfg!(target_os = "windows") {
        let appdata = std::env::var_os("APPDATA")?;
        return Some(PathBuf::from(appdata).join("playlist-bridge"));
    }
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".config/playlist-bridge"))
}

/// Reprend réglages, correspondances et historique d'une install Electron. Pas les tokens :
/// ils étaient chiffrés par safeStorage et illisibles ici.
fn migrate(dir: &std::path::Path) {
    let Some(old) = legacy_dir() else {
        return;
    };
    if !old.is_dir() {
        return;
    }
    let _ = std::fs::create_dir_all(dir);
    for name in ["settings.json", "matches.json", "history.json"] {
        let from = old.join(name);
        let to = dir.join(name);
        if from.is_file() && !to.exists() {
            let _ = std::fs::copy(&from, &to);
        }
    }
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn page(title: &str, body: &str) -> String {
    let (title, body) = (esc(title), esc(body));
    let html = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{title}</title>\
<body style=\"font-family:system-ui;background:#0e0f12;color:#e8e8ea;display:grid;place-items:center;height:100vh;margin:0\">\
<div style=\"text-align:center\"><h1 style=\"font-weight:600\">{title}</h1><p style=\"opacity:.7\">{body}</p></div>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
        html.len()
    )
}

fn respond(stream: &mut TcpStream, title: &str, body: &str) {
    let _ = stream.write_all(page(title, body).as_bytes());
}

fn request_path(stream: &mut TcpStream) -> Option<String> {
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf[..n]);
    let target = text.lines().next()?.split_whitespace().nth(1)?;
    Some(target.to_string())
}

fn bind_oauth() -> Result<TcpListener, String> {
    let mut last = String::from("port occupé");
    for _ in 0..40 {
        match TcpListener::bind(("127.0.0.1", OAUTH_PORT)) {
            Ok(listener) => return Ok(listener),
            Err(e) => {
                last = e.to_string();
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    Err(format!("Port {OAUTH_PORT} occupé : {last}"))
}

fn wait_for_code(expected: String, generation: u64) -> Result<String, String> {
    let listener = bind_oauth()?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let started = Instant::now();
    let timeout = Duration::from_secs(5 * 60);

    loop {
        if OAUTH_GEN.load(Ordering::SeqCst) != generation {
            return Err("Connexion annulée".into());
        }
        if started.elapsed() > timeout {
            return Err("Connexion expirée (5 min)".into());
        }
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(40));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };

        let Some(target) = request_path(&mut stream) else {
            continue;
        };
        let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{target}")) else {
            respond(&mut stream, "Connexion refusée", "Réponse invalide, réessaie depuis l’app.");
            continue;
        };
        if url.path() != "/callback" {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            continue;
        }

        let code = url.query_pairs().find(|(k, _)| k == "code").map(|(_, v)| v.into_owned());
        let state = url.query_pairs().find(|(k, _)| k == "state").map(|(_, v)| v.into_owned());
        let error = url
            .query_pairs()
            .find(|(k, _)| k == "error_description" || k == "error")
            .map(|(_, v)| v.into_owned());

        if error.is_some() || code.is_none() || state.as_deref() != Some(expected.as_str()) {
            let message = error.unwrap_or_else(|| "Réponse invalide, réessaie depuis l’app.".into());
            respond(&mut stream, "Connexion refusée", &message);
            return Err(message);
        }

        respond(
            &mut stream,
            "C’est bon",
            "Tu peux fermer cet onglet et revenir sur Playlist Bridge.",
        );
        return Ok(code.unwrap_or_default());
    }
}

#[tauri::command]
async fn oauth_wait_code(state: String) -> Result<String, String> {
    let generation = OAUTH_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || wait_for_code(state, generation))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_csv(app: tauri::AppHandle, filename: String, csv: String) -> Result<String, String> {
    let safe: String = filename
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            other => other,
        })
        .collect();
    let picked = app
        .dialog()
        .file()
        .set_file_name(&safe)
        .add_filter("CSV", &["csv"])
        .blocking_save_file();
    let Some(file) = picked else {
        return Ok("cancelled".into());
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let mut content = String::from("\u{feff}");
    content.push_str(&csv);
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok("saved".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&dir);
                migrate(&dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            token_get,
            token_set,
            token_delete,
            oauth_wait_code,
            export_csv
        ])
        .run(tauri::generate_context!())
        .expect("erreur au démarrage de Playlist Bridge");
}
