// Évite une console en plus sous Windows, en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    playlist_bridge_lib::run();
}
