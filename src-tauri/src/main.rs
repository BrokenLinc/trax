// Prevents an additional console window from spawning on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mode7b_lib::run()
}
