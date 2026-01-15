//! WASI CLI for ast-grep
//!
//! This is a minimal WASI CLI that can be run via wasmer/wasmtime.
//! Compile with: cargo build --target wasm32-wasip1 --release --bin sg-wasi
//! Run with: wasmer run --dir . target/wasm32-wasip1/release/sg-wasi.wasm -- <args>

use std::env;
use std::fs;
use std::path::Path;
use std::process;

fn print_help() {
    eprintln!(
        r#"ast-grep WASI CLI

USAGE:
  sg-wasi <COMMAND> [OPTIONS] [PATH...]

COMMANDS:
  scan        Scan files using rules from a YAML file
  run         Run a single pattern against files
  parse       Parse and dump AST of a file
  version     Show version

OPTIONS:
  -p, --pattern <PATTERN>     Pattern to search for
  -r, --rewrite <REWRITE>     Replacement pattern
  -l, --lang <LANGUAGE>       Language (js, ts, tsx, py, go, rust, etc.)
  -c, --config <FILE>         Rules file (YAML)
  -h, --help                  Show this help

EXAMPLES:
  sg-wasi run -p 'console.log($$$ARGS)' -l typescript ./src
  sg-wasi scan -c rules.yml ./src

NOTE: This WASI build requires tree-sitter parser .so/.wasm files in the
current directory or specified via parser path.
"#
    );
}

fn print_version() {
    println!("sg-wasi 0.1.0 (ast-grep WASM/WASI CLI)");
}

#[derive(Debug, Default)]
struct Args {
    command: Option<String>,
    pattern: Option<String>,
    rewrite: Option<String>,
    language: Option<String>,
    config: Option<String>,
    paths: Vec<String>,
    help: bool,
}

fn parse_args() -> Args {
    let mut args = Args::default();
    let mut argv: Vec<String> = env::args().skip(1).collect();

    let mut i = 0;
    while i < argv.len() {
        let arg = &argv[i];
        match arg.as_str() {
            "-h" | "--help" => {
                args.help = true;
                i += 1;
            }
            "-p" | "--pattern" => {
                i += 1;
                if i < argv.len() {
                    args.pattern = Some(argv[i].clone());
                }
                i += 1;
            }
            "-r" | "--rewrite" => {
                i += 1;
                if i < argv.len() {
                    args.rewrite = Some(argv[i].clone());
                }
                i += 1;
            }
            "-l" | "--lang" | "--language" => {
                i += 1;
                if i < argv.len() {
                    args.language = Some(argv[i].clone());
                }
                i += 1;
            }
            "-c" | "--config" => {
                i += 1;
                if i < argv.len() {
                    args.config = Some(argv[i].clone());
                }
                i += 1;
            }
            "scan" | "run" | "parse" | "version" => {
                args.command = Some(arg.clone());
                i += 1;
            }
            _ if !arg.starts_with('-') => {
                args.paths.push(arg.clone());
                i += 1;
            }
            _ => {
                eprintln!("Unknown option: {}", arg);
                i += 1;
            }
        }
    }

    // Default command based on args
    if args.command.is_none() {
        if args.config.is_some() {
            args.command = Some("scan".to_string());
        } else if args.pattern.is_some() {
            args.command = Some("run".to_string());
        }
    }

    // Default path
    if args.paths.is_empty() {
        args.paths.push(".".to_string());
    }

    args
}

fn detect_language(path: &str) -> Option<&'static str> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    match ext {
        "js" | "mjs" | "cjs" => Some("javascript"),
        "ts" | "mts" | "cts" => Some("typescript"),
        "tsx" => Some("tsx"),
        "jsx" => Some("javascript"),
        "py" => Some("python"),
        "go" => Some("go"),
        "rs" => Some("rust"),
        "java" => Some("java"),
        "c" | "h" => Some("c"),
        "cpp" | "cc" | "hpp" | "cxx" => Some("cpp"),
        "json" => Some("json"),
        "yaml" | "yml" => Some("yaml"),
        "html" | "htm" => Some("html"),
        "css" => Some("css"),
        _ => None,
    }
}

fn collect_files(path: &str, language: Option<&str>) -> Vec<String> {
    let mut files = Vec::new();

    let metadata = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return files,
    };

    if metadata.is_file() {
        files.push(path.to_string());
    } else if metadata.is_dir() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                let name = entry_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");

                // Skip hidden and common ignore patterns
                if name.starts_with('.')
                    || name == "node_modules"
                    || name == "target"
                    || name == "dist"
                    || name == "build"
                {
                    continue;
                }

                let path_str = entry_path.to_string_lossy().to_string();

                if entry_path.is_dir() {
                    files.extend(collect_files(&path_str, language));
                } else if entry_path.is_file() {
                    if let Some(lang) = language {
                        if detect_language(&path_str) == Some(lang) {
                            files.push(path_str);
                        }
                    } else if detect_language(&path_str).is_some() {
                        files.push(path_str);
                    }
                }
            }
        }
    }

    files
}

fn run_pattern(args: &Args) {
    let pattern = match &args.pattern {
        Some(p) => p,
        None => {
            eprintln!("Error: run command requires --pattern/-p <pattern>");
            process::exit(1);
        }
    };

    let language = args.language.as_deref();
    let mut total_matches = 0;
    let mut total_files = 0;

    for path in &args.paths {
        let files = collect_files(path, language);

        for file in files {
            let content = match fs::read_to_string(&file) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let lang = args.language.as_deref()
                .or_else(|| detect_language(&file));

            if lang.is_none() {
                continue;
            }

            // Simple text-based matching for now
            // Full AST matching requires tree-sitter WASI support
            let pattern_words: Vec<&str> = pattern
                .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '$')
                .filter(|s| !s.is_empty() && !s.starts_with('$'))
                .collect();

            let mut file_matches = 0;
            for (i, line) in content.lines().enumerate() {
                let matches = pattern_words.iter().all(|word| line.contains(word));
                if matches && !pattern_words.is_empty() {
                    if file_matches == 0 {
                        println!("\x1b[35m{}\x1b[0m", file);
                    }
                    println!("  \x1b[2m{:4}\x1b[0m│ {}", i + 1, line);
                    file_matches += 1;
                }
            }

            if file_matches > 0 {
                total_matches += file_matches;
                total_files += 1;
            }
        }
    }

    println!();
    println!("Found {} match(es) in {} file(s)", total_matches, total_files);
    println!();
    println!("\x1b[33mNote: This is text-based matching. Full AST pattern matching");
    println!("requires tree-sitter WASI support (work in progress).\x1b[0m");
}

fn run_scan(args: &Args) {
    let config_file = match &args.config {
        Some(c) => c,
        None => {
            eprintln!("Error: scan command requires --config/-c <rules.yml>");
            process::exit(1);
        }
    };

    let config_content = match fs::read_to_string(config_file) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error reading config file: {}", e);
            process::exit(1);
        }
    };

    println!("Config file: {}", config_file);
    println!("Content length: {} bytes", config_content.len());
    println!();
    println!("\x1b[33mNote: Full YAML parsing and rule application requires");
    println!("tree-sitter WASI support (work in progress).\x1b[0m");
    println!();
    println!("Paths to scan: {:?}", args.paths);
}

fn run_parse(args: &Args) {
    if args.paths.is_empty() || args.paths[0] == "." {
        eprintln!("Error: parse command requires a file path");
        process::exit(1);
    }

    let file = &args.paths[0];
    let content = match fs::read_to_string(file) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error reading file: {}", e);
            process::exit(1);
        }
    };

    let lang = args.language.as_deref()
        .or_else(|| detect_language(file));

    println!("File: {}", file);
    println!("Language: {:?}", lang);
    println!("Size: {} bytes", content.len());
    println!("Lines: {}", content.lines().count());
    println!();
    println!("\x1b[33mNote: Full AST dump requires tree-sitter WASI support");
    println!("(work in progress).\x1b[0m");
}

fn main() {
    let args = parse_args();

    if args.help || args.command.is_none() {
        print_help();
        process::exit(if args.help { 0 } else { 1 });
    }

    match args.command.as_deref() {
        Some("version") => print_version(),
        Some("run") => run_pattern(&args),
        Some("scan") => run_scan(&args),
        Some("parse") => run_parse(&args),
        Some(cmd) => {
            eprintln!("Unknown command: {}", cmd);
            print_help();
            process::exit(1);
        }
        None => {
            print_help();
            process::exit(1);
        }
    }
}
