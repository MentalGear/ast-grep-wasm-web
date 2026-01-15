//! Full ast-grep WASI CLI with tree-sitter support
//!
//! This CLI provides full AST pattern matching via tree-sitter,
//! compiled to WASI for execution in wasmer/wasmtime.
//!
//! Build: cargo build --target wasm32-wasip1 --release -p sg-wasi-full
//! Run: wasmer run --mapdir /app:. sg.wasm -- scan -c /app/rules.yml /app/src

use std::env;
use std::fs;
use std::path::Path;
use std::process;

use ast_grep_language::{SupportLang, LanguageExt};
use serde::Deserialize;

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

#[derive(Debug, Default)]
struct Args {
    command: Option<String>,
    pattern: Option<String>,
    rewrite: Option<String>,
    language: Option<String>,
    config: Option<String>,
    paths: Vec<String>,
    json: bool,
    debug: bool,
    help: bool,
    update_all: bool,
}

fn parse_args() -> Args {
    let mut args = Args::default();
    let argv: Vec<String> = env::args().skip(1).collect();

    let mut i = 0;
    let mut positional_args: Vec<String> = Vec::new();

    while i < argv.len() {
        match argv[i].as_str() {
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
            "-r" | "--rewrite" | "--fix" => {
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
            "-c" | "--config" | "--rule" => {
                i += 1;
                if i < argv.len() {
                    args.config = Some(argv[i].clone());
                }
                i += 1;
            }
            "--json" => {
                args.json = true;
                i += 1;
            }
            "--debug" => {
                args.debug = true;
                i += 1;
            }
            "-U" | "--update-all" => {
                args.update_all = true;
                i += 1;
            }
            "scan" | "run" | "parse" | "version" => {
                if args.command.is_none() {
                    args.command = Some(argv[i].clone());
                } else {
                    positional_args.push(argv[i].clone());
                }
                i += 1;
            }
            s if !s.starts_with('-') => {
                positional_args.push(argv[i].clone());
                i += 1;
            }
            _ => {
                eprintln!("Unknown option: {}", argv[i]);
                i += 1;
            }
        }
    }

    // Handle shorthand syntax: sg 'pattern' [path...]
    // If no pattern is set and first positional looks like a pattern (contains $ or special chars),
    // treat it as a pattern
    if args.pattern.is_none() && !positional_args.is_empty() {
        let first = &positional_args[0];
        // Heuristic: if it contains $ (metavar), or parens/braces, or doesn't exist as path, it's a pattern
        let looks_like_pattern = first.contains('$')
            || first.contains('(')
            || first.contains('{')
            || (!Path::new(first).exists() && !first.starts_with('.') && !first.starts_with('/'));

        if looks_like_pattern {
            args.pattern = Some(positional_args.remove(0));
        }
    }

    // Remaining positional args are paths
    args.paths = positional_args;

    if args.command.is_none() {
        if args.config.is_some() {
            args.command = Some("scan".to_string());
        } else if args.pattern.is_some() {
            args.command = Some("run".to_string());
        }
    }

    if args.paths.is_empty() {
        args.paths.push(".".to_string());
    }

    args
}

fn print_help() {
    eprintln!(r#"
ast-grep WASI CLI (full AST support)

USAGE:
  sg <PATTERN> [PATH...]                 # shorthand for pattern search
  sg <COMMAND> [OPTIONS] [PATH...]       # full command syntax

COMMANDS:
  scan        Scan files using rules from a YAML file
  run         Run a single pattern against files
  parse       Parse and dump AST of a file
  version     Show version

OPTIONS:
  -p, --pattern <PATTERN>     AST pattern to search for
  -r, --rewrite <REWRITE>     Replacement pattern (enables fix mode)
  -l, --lang <LANGUAGE>       Language (typescript, javascript, python, etc.)
  -c, --config <FILE>         Rules file (YAML)
  -U, --update-all            Apply all fixes without prompting
  --json                      Output as JSON
  --debug                     Enable debug output
  -h, --help                  Show this help

EXAMPLES:
  sg 'console.log($$$ARGS)' ./src                          # shorthand
  sg run -p 'console.log($$$ARGS)' -l typescript ./src     # explicit
  sg 'var $X = $Y' -r 'let $X = $Y' -U ./src               # rewrite shorthand
  sg scan -c rules.yml ./src                               # scan with rules
"#);
}

// ============================================================================
// LANGUAGE DETECTION
// ============================================================================

fn detect_language(path: &str) -> Option<SupportLang> {
    let ext = Path::new(path).extension().and_then(|e| e.to_str())?;
    parse_language(ext)
}

fn parse_language(name: &str) -> Option<SupportLang> {
    match name.to_lowercase().as_str() {
        "typescript" | "ts" | "mts" | "cts" => Some(SupportLang::TypeScript),
        "tsx" => Some(SupportLang::Tsx),
        "javascript" | "js" | "mjs" | "cjs" | "jsx" => Some(SupportLang::JavaScript),
        "python" | "py" => Some(SupportLang::Python),
        "go" | "golang" => Some(SupportLang::Go),
        "rust" | "rs" => Some(SupportLang::Rust),
        "java" => Some(SupportLang::Java),
        "c" | "h" => Some(SupportLang::C),
        "cpp" | "cc" | "cxx" | "hpp" | "c++" => Some(SupportLang::Cpp),
        "csharp" | "cs" | "c#" => Some(SupportLang::CSharp),
        "json" => Some(SupportLang::Json),
        "yaml" | "yml" => Some(SupportLang::Yaml),
        "html" | "htm" => Some(SupportLang::Html),
        "css" => Some(SupportLang::Css),
        "ruby" | "rb" => Some(SupportLang::Ruby),
        "php" => Some(SupportLang::Php),
        "swift" => Some(SupportLang::Swift),
        "kotlin" | "kt" | "kts" => Some(SupportLang::Kotlin),
        "scala" | "sc" => Some(SupportLang::Scala),
        "bash" | "sh" => Some(SupportLang::Bash),
        "lua" => Some(SupportLang::Lua),
        "elixir" | "ex" | "exs" => Some(SupportLang::Elixir),
        "haskell" | "hs" => Some(SupportLang::Haskell),
        _ => None,
    }
}

// ============================================================================
// FILE COLLECTION
// ============================================================================

fn collect_files(path: &str, lang: Option<SupportLang>) -> Vec<String> {
    let mut files = Vec::new();
    let metadata = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return files,
    };

    if metadata.is_file() {
        if lang.is_none() || detect_language(path) == lang {
            files.push(path.to_string());
        }
        return files;
    }

    if metadata.is_dir() {
        collect_dir(path, lang, &mut files);
    }
    files
}

fn collect_dir(dir: &str, lang: Option<SupportLang>, files: &mut Vec<String>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        if name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist" | "build" | "__pycache__") {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();

        if path.is_dir() {
            collect_dir(&path_str, lang, files);
        } else if path.is_file() {
            let file_lang = detect_language(&path_str);
            if (lang.is_none() && file_lang.is_some()) || lang == file_lang {
                files.push(path_str);
            }
        }
    }
}

// Helper to get line number from byte offset
fn byte_to_line(content: &str, byte_offset: usize) -> usize {
    content[..byte_offset.min(content.len())].matches('\n').count() + 1
}

// ============================================================================
// YAML CONFIG
// ============================================================================

#[derive(Debug, Deserialize)]
struct YamlConfig {
    rules: Option<Vec<YamlRule>>,
}

#[derive(Debug, Deserialize, Clone)]
struct YamlRule {
    id: String,
    language: Option<String>,
    rule: YamlRulePattern,
    fix: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct YamlRulePattern {
    pattern: Option<String>,
}

fn load_rules(config_path: &str) -> Result<Vec<YamlRule>, String> {
    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    // Try as list of rules
    if let Ok(rules) = serde_yaml::from_str::<Vec<YamlRule>>(&content) {
        return Ok(rules);
    }

    // Try as config with rules field
    let config: YamlConfig = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse YAML: {}", e))?;

    config.rules.ok_or_else(|| "No rules found".to_string())
}

// ============================================================================
// COMMANDS
// ============================================================================

fn run_pattern(args: &Args) {
    let pattern = match &args.pattern {
        Some(p) => p,
        None => {
            eprintln!("Error: --pattern/-p required");
            process::exit(1);
        }
    };

    let specified_lang = args.language.as_ref().and_then(|l| parse_language(l));
    let mut total_matches = 0;
    let mut total_files = 0;

    for path in &args.paths {
        let files = collect_files(path, specified_lang);

        for file in files {
            let file_lang = specified_lang.or_else(|| detect_language(&file));
            let file_lang = match file_lang {
                Some(l) => l,
                None => continue,
            };

            let content = match fs::read_to_string(&file) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let grep = file_lang.ast_grep(&content);
            let matches: Vec<_> = grep.root().find_all(pattern.as_str()).collect();

            if matches.is_empty() {
                continue;
            }

            if let Some(rewrite) = &args.rewrite {
                if args.update_all {
                    // Apply fixes using replace_by
                    let mut edits: Vec<(usize, usize, String)> = matches.iter().map(|m| {
                        let edit = m.replace_by(rewrite.as_str());
                        let start = edit.position;
                        let end = edit.position + edit.deleted_length;
                        let replacement = String::from_utf8_lossy(&edit.inserted_text).to_string();
                        (start, end, replacement)
                    }).collect();

                    edits.sort_by(|a, b| b.0.cmp(&a.0));

                    let mut new_content = content.clone();
                    for (start, end, replacement) in edits {
                        if start <= new_content.len() && end <= new_content.len() {
                            new_content.replace_range(start..end, &replacement);
                        }
                    }

                    if new_content != content {
                        if fs::write(&file, &new_content).is_ok() {
                            println!("\x1b[32mFixed: {}\x1b[0m", file);
                            total_files += 1;
                        }
                    }
                    continue;
                }
            }

            // Search mode
            total_matches += matches.len();
            total_files += 1;

            if !args.json {
                println!("\x1b[35m{}\x1b[0m", file);
                for m in &matches {
                    let range = m.range();
                    let line = byte_to_line(&content, range.start);
                    let text = m.text();
                    let preview: String = text.lines().next().unwrap_or("").chars().take(80).collect();
                    println!("  \x1b[2m{:4}\x1b[0m │ {}", line, preview);
                }
            }
        }
    }

    println!();
    if args.rewrite.is_some() && args.update_all {
        println!("Fixed {} file(s)", total_files);
    } else {
        println!("Found {} match(es) in {} file(s)", total_matches, total_files);
    }
}

fn run_scan(args: &Args) {
    let config_path = match &args.config {
        Some(c) => c,
        None => {
            eprintln!("Error: --config/-c required");
            process::exit(1);
        }
    };

    let rules = match load_rules(config_path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Error: {}", e);
            process::exit(1);
        }
    };

    let mut total_matches = 0;

    for path in &args.paths {
        let files = collect_files(path, None);

        for file in files {
            let file_lang = match detect_language(&file) {
                Some(l) => l,
                None => continue,
            };

            let content = match fs::read_to_string(&file) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let grep = file_lang.ast_grep(&content);

            for rule in &rules {
                // Check language match
                if let Some(rule_lang) = &rule.language {
                    if let Some(parsed) = parse_language(rule_lang) {
                        if parsed != file_lang {
                            continue;
                        }
                    }
                }

                let pattern = match &rule.rule.pattern {
                    Some(p) => p,
                    None => continue,
                };

                let matches: Vec<_> = grep.root().find_all(pattern.as_str()).collect();
                if matches.is_empty() {
                    continue;
                }

                let count = matches.len();
                total_matches += count;

                println!("\x1b[35m{}\x1b[0m: {} ({} match{})",
                    file, rule.id, count, if count > 1 { "es" } else { "" });

                if let Some(msg) = &rule.message {
                    println!("  \x1b[33m{}\x1b[0m", msg);
                }

                // Apply fix
                if args.update_all {
                    if let Some(fix) = &rule.fix {
                        let mut edits: Vec<(usize, usize, String)> = matches.iter().map(|m| {
                            let edit = m.replace_by(fix.as_str());
                            let start = edit.position;
                            let end = edit.position + edit.deleted_length;
                            let replacement = String::from_utf8_lossy(&edit.inserted_text).to_string();
                            (start, end, replacement)
                        }).collect();

                        edits.sort_by(|a, b| b.0.cmp(&a.0));

                        let mut new_content = content.clone();
                        for (start, end, replacement) in edits {
                            if start <= new_content.len() && end <= new_content.len() {
                                new_content.replace_range(start..end, &replacement);
                            }
                        }

                        if new_content != content {
                            let _ = fs::write(&file, &new_content);
                        }
                    }
                }
            }
        }
    }

    println!();
    println!("Total: {} match(es)", total_matches);
}

fn run_parse(args: &Args) {
    if args.paths.is_empty() || args.paths[0] == "." {
        eprintln!("Error: file path required");
        process::exit(1);
    }

    let file = &args.paths[0];
    let lang = args.language.as_ref()
        .and_then(|l| parse_language(l))
        .or_else(|| detect_language(file));

    let lang = match lang {
        Some(l) => l,
        None => {
            eprintln!("Error: Cannot detect language. Use --lang.");
            process::exit(1);
        }
    };

    let content = match fs::read_to_string(file) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error: {}", e);
            process::exit(1);
        }
    };

    let grep = lang.ast_grep(&content);
    let root = grep.root();

    println!("File: {}", file);
    println!("Language: {:?}", lang);
    println!("Root: {}", root.kind());
    println!();

    fn print_tree<D: ast_grep_core::Doc>(node: &ast_grep_core::Node<D>, content: &str, indent: usize) {
        let spaces = "  ".repeat(indent);
        let range = node.range();
        let line = content[..range.start.min(content.len())].matches('\n').count() + 1;
        println!("{}{} (line {})", spaces, node.kind(), line);
        for child in node.children() {
            print_tree(&child, content, indent + 1);
        }
    }

    print_tree(&root, &content, 0);
}

// ============================================================================
// MAIN
// ============================================================================

fn main() {
    let args = parse_args();

    if args.help || args.command.is_none() {
        print_help();
        process::exit(if args.help { 0 } else { 1 });
    }

    if args.debug {
        eprintln!("Args: {:?}", args);
    }

    match args.command.as_deref() {
        Some("version") => println!("sg 0.1.0 (ast-grep WASI with full tree-sitter support)"),
        Some("run") => run_pattern(&args),
        Some("scan") => run_scan(&args),
        Some("parse") => run_parse(&args),
        Some(cmd) => {
            eprintln!("Unknown command: {}", cmd);
            process::exit(1);
        }
        None => {
            print_help();
            process::exit(1);
        }
    }
}
