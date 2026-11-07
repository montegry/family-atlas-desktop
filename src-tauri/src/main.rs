#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
#[cfg(test)]
mod crop_tests;
mod domain;
mod gedcom;
#[cfg(test)]
mod regression;
mod store;

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    if let Some(index) = args.iter().position(|arg| arg == "--verify-project") {
        let result = args
            .get(index + 1)
            .ok_or_else(|| anyhow::anyhow!("Укажите папку проекта"))
            .and_then(|path| store::verify_project(std::path::Path::new(path)));
        match result {
            Ok(report) => println!("{}", serde_json::to_string_pretty(&report).unwrap()),
            Err(error) => {
                eprintln!("{error:#}");
                std::process::exit(1);
            }
        }
        return;
    }
    commands::run();
}
