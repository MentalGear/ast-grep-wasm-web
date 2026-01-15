//! Full ast-grep WASI CLI with tree-sitter support
//!
//! This CLI provides full AST pattern matching via tree-sitter,
//! compiled to WASI for execution in wasmer/wasmtime.
//!
//! Build: cargo build --target wasm32-wasip1 --release -p sg-wasi-full
//! Run: wasmer run --dir=. sg.wasm -- 'console.log($$$)' ./src

use std::fs;
use std::path::Path;
use std::process;

use ast_grep_language::{SupportLang, LanguageExt};
use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};

// ============================================================================
// CLI DEFINITION WITH CLAP
// ============================================================================

#[derive(Parser)]
#[command(name = "sg")]
#[command(author = "ast-grep")]
#[command(version = "0.1.0")]
#[command(about = "ast-grep WASI CLI - AST-based code search and replace", long_about = None)]
#[command(args_conflicts_with_subcommands = true)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// AST pattern to search for (shorthand for 'run -p')
    #[arg(value_name = "PATTERN")]
    pattern: Option<String>,

    /// Paths to search
    #[arg(value_name = "PATH")]
    paths: Vec<String>,

    /// Replacement pattern for rewriting matches
    #[arg(short, long, value_name = "REWRITE")]
    rewrite: Option<String>,

    /// Language to use (typescript, javascript, python, etc.)
    #[arg(short, long, value_name = "LANG")]
    lang: Option<String>,

    /// Apply all fixes without prompting
    #[arg(short = 'U', long)]
    update_all: bool,

    /// Output results as JSON
    #[arg(long)]
    json: bool,

    /// Enable debug output
    #[arg(long)]
    debug: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Run a pattern search against files
    Run {
        /// AST pattern to search for
        #[arg(short, long, required = true)]
        pattern: String,

        /// Replacement pattern for rewriting matches
        #[arg(short, long)]
        rewrite: Option<String>,

        /// Language to use
        #[arg(short, long)]
        lang: Option<String>,

        /// Apply all fixes without prompting
        #[arg(short = 'U', long)]
        update_all: bool,

        /// Output results as JSON
        #[arg(long)]
        json: bool,

        /// Paths to search
        #[arg(default_value = ".")]
        paths: Vec<String>,
    },

    /// Scan files using rules from a YAML configuration
    Scan {
        /// Path to rules YAML file (auto-discovers sgconfig.yml if not specified)
        #[arg(short, long)]
        config: Option<String>,

        /// Apply all fixes without prompting
        #[arg(short = 'U', long)]
        update_all: bool,

        /// Output results as JSON
        #[arg(long)]
        json: bool,

        /// Paths to scan
        #[arg(default_value = ".")]
        paths: Vec<String>,
    },

    /// Parse a file and display its AST
    Parse {
        /// File to parse
        file: String,

        /// Language to use (auto-detected if not specified)
        #[arg(short, long)]
        lang: Option<String>,
    },

    /// Show version information
    Version,
}

// ============================================================================
// JSON OUTPUT STRUCTURES (matching native ast-grep format)
// ============================================================================

#[derive(Serialize)]
struct JsonMatch {
    file: String,
    range: JsonRange,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "ruleId")]
    rule_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    severity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
}

#[derive(Serialize)]
struct JsonRange {
    start: JsonPosition,
    end: JsonPosition,
}

#[derive(Serialize)]
struct JsonPosition {
    line: usize,
    column: usize,
    offset: usize,
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

fn lang_to_string(lang: SupportLang) -> String {
    format!("{:?}", lang).to_lowercase()
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

// Helper to get line and column from byte offset
fn byte_to_position(content: &str, byte_offset: usize) -> (usize, usize) {
    let safe_offset = byte_offset.min(content.len());
    let before = &content[..safe_offset];
    let line = before.matches('\n').count() + 1;
    let last_newline = before.rfind('\n').map(|i| i + 1).unwrap_or(0);
    let column = safe_offset - last_newline;
    (line, column)
}

// ============================================================================
// CONFIG DISCOVERY
// ============================================================================

const CONFIG_NAMES: &[&str] = &["sgconfig.yml", "sgconfig.yaml", ".sgconfig.yml", ".sgconfig.yaml"];

fn discover_config(start_path: &str) -> Option<String> {
    let mut current = Path::new(start_path);

    // If start_path is a file, start from its parent directory
    if current.is_file() {
        current = current.parent()?;
    }

    // Walk up the directory tree
    loop {
        for config_name in CONFIG_NAMES {
            let config_path = current.join(config_name);
            if config_path.exists() {
                return Some(config_path.to_string_lossy().to_string());
            }
        }

        match current.parent() {
            Some(parent) => current = parent,
            None => break,
        }
    }

    None
}

// ============================================================================
// YAML CONFIG
// ============================================================================

#[derive(Debug, Deserialize)]
struct YamlConfig {
    rules: Option<Vec<YamlRule>>,
    #[serde(rename = "ruleDirs")]
    rule_dirs: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Clone)]
struct YamlRule {
    id: String,
    language: Option<String>,
    rule: YamlRulePattern,
    fix: Option<String>,
    message: Option<String>,
    #[serde(default = "default_severity")]
    severity: String,
}

fn default_severity() -> String {
    "warning".to_string()
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

    // If there are ruleDirs, load rules from those directories too
    let mut all_rules = config.rules.unwrap_or_default();

    if let Some(rule_dirs) = config.rule_dirs {
        let config_dir = Path::new(config_path).parent().unwrap_or(Path::new("."));
        for dir in rule_dirs {
            let rule_dir = config_dir.join(&dir);
            if let Ok(entries) = fs::read_dir(&rule_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().map(|e| e == "yml" || e == "yaml").unwrap_or(false) {
                        if let Ok(content) = fs::read_to_string(&path) {
                            if let Ok(rules) = serde_yaml::from_str::<Vec<YamlRule>>(&content) {
                                all_rules.extend(rules);
                            } else if let Ok(rule) = serde_yaml::from_str::<YamlRule>(&content) {
                                all_rules.push(rule);
                            }
                        }
                    }
                }
            }
        }
    }

    if all_rules.is_empty() {
        return Err("No rules found".to_string());
    }

    Ok(all_rules)
}

// ============================================================================
// COMMANDS
// ============================================================================

fn run_pattern(pattern: &str, rewrite: Option<&str>, lang: Option<&str>, update_all: bool, json: bool, paths: &[String]) {
    let specified_lang = lang.and_then(parse_language);
    let mut total_matches = 0;
    let mut total_files = 0;
    let mut json_results: Vec<JsonMatch> = Vec::new();

    for path in paths {
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
            let matches: Vec<_> = grep.root().find_all(pattern).collect();

            if matches.is_empty() {
                continue;
            }

            if let Some(rewrite_pattern) = rewrite {
                if update_all {
                    // Apply fixes using replace_by
                    let mut edits: Vec<(usize, usize, String)> = matches.iter().map(|m| {
                        let edit = m.replace_by(rewrite_pattern);
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
                            if !json {
                                println!("\x1b[32mFixed: {}\x1b[0m", file);
                            }
                            total_files += 1;
                        }
                    }
                    continue;
                }
            }

            // Search mode
            total_matches += matches.len();
            total_files += 1;

            if json {
                for m in &matches {
                    let range = m.range();
                    let (start_line, start_col) = byte_to_position(&content, range.start);
                    let (end_line, end_col) = byte_to_position(&content, range.end);

                    json_results.push(JsonMatch {
                        file: file.clone(),
                        range: JsonRange {
                            start: JsonPosition { line: start_line, column: start_col, offset: range.start },
                            end: JsonPosition { line: end_line, column: end_col, offset: range.end },
                        },
                        text: m.text().to_string(),
                        rule_id: None,
                        severity: None,
                        message: None,
                        fix: rewrite.map(|r| r.to_string()),
                        language: Some(lang_to_string(file_lang)),
                    });
                }
            } else {
                println!("\x1b[35m{}\x1b[0m", file);
                for m in &matches {
                    let range = m.range();
                    let (line, _col) = byte_to_position(&content, range.start);
                    let text = m.text();
                    let preview: String = text.lines().next().unwrap_or("").chars().take(80).collect();
                    println!("  \x1b[2m{:4}\x1b[0m │ {}", line, preview);
                }
            }
        }
    }

    if json {
        for result in &json_results {
            println!("{}", serde_json::to_string(result).unwrap_or_default());
        }
    } else {
        println!();
        if rewrite.is_some() && update_all {
            println!("Fixed {} file(s)", total_files);
        } else {
            println!("Found {} match(es) in {} file(s)", total_matches, total_files);
        }
    }
}

fn run_scan(config_path: Option<&str>, update_all: bool, json: bool, paths: &[String]) {
    // Config discovery: use provided path, or search for sgconfig.yml
    let config_path = match config_path {
        Some(p) => p.to_string(),
        None => {
            // Try to discover config from the first path
            let search_start = paths.first().map(|s| s.as_str()).unwrap_or(".");
            match discover_config(search_start) {
                Some(p) => {
                    if !json {
                        eprintln!("Using config: {}", p);
                    }
                    p
                }
                None => {
                    eprintln!("Error: No config file specified and sgconfig.yml not found.");
                    eprintln!("Use -c/--config to specify a rules file, or create sgconfig.yml");
                    process::exit(1);
                }
            }
        }
    };

    let rules = match load_rules(&config_path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Error: {}", e);
            process::exit(1);
        }
    };

    let mut total_matches = 0;
    let mut json_results: Vec<JsonMatch> = Vec::new();

    for path in paths {
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

                if json {
                    for m in &matches {
                        let range = m.range();
                        let (start_line, start_col) = byte_to_position(&content, range.start);
                        let (end_line, end_col) = byte_to_position(&content, range.end);

                        json_results.push(JsonMatch {
                            file: file.clone(),
                            range: JsonRange {
                                start: JsonPosition { line: start_line, column: start_col, offset: range.start },
                                end: JsonPosition { line: end_line, column: end_col, offset: range.end },
                            },
                            text: m.text().to_string(),
                            rule_id: Some(rule.id.clone()),
                            severity: Some(rule.severity.clone()),
                            message: rule.message.clone(),
                            fix: rule.fix.clone(),
                            language: Some(lang_to_string(file_lang)),
                        });
                    }
                } else {
                    // Colored output based on severity
                    let severity_color = match rule.severity.as_str() {
                        "error" => "\x1b[31m",      // red
                        "warning" => "\x1b[33m",   // yellow
                        "info" => "\x1b[36m",      // cyan
                        "hint" => "\x1b[2m",       // dim
                        _ => "\x1b[33m",           // default yellow
                    };

                    println!("\x1b[35m{}\x1b[0m: {} {}[{}]\x1b[0m ({} match{})",
                        file, rule.id, severity_color, rule.severity,
                        count, if count > 1 { "es" } else { "" });

                    if let Some(msg) = &rule.message {
                        println!("  \x1b[33m{}\x1b[0m", msg);
                    }
                }

                // Apply fix
                if update_all {
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

    if json {
        for result in &json_results {
            println!("{}", serde_json::to_string(result).unwrap_or_default());
        }
    } else {
        println!();
        println!("Total: {} match(es)", total_matches);
    }
}

fn run_parse(file: &str, lang: Option<&str>) {
    let lang = lang
        .and_then(parse_language)
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
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Run { pattern, rewrite, lang, update_all, json, paths }) => {
            run_pattern(&pattern, rewrite.as_deref(), lang.as_deref(), update_all, json, &paths);
        }
        Some(Commands::Scan { config, update_all, json, paths }) => {
            run_scan(config.as_deref(), update_all, json, &paths);
        }
        Some(Commands::Parse { file, lang }) => {
            run_parse(&file, lang.as_deref());
        }
        Some(Commands::Version) => {
            println!("sg 0.1.0 (ast-grep WASI with full tree-sitter support)");
        }
        None => {
            // Handle shorthand: sg 'pattern' [paths...]
            if let Some(pattern) = cli.pattern {
                let paths = if cli.paths.is_empty() {
                    vec![".".to_string()]
                } else {
                    cli.paths
                };
                run_pattern(&pattern, cli.rewrite.as_deref(), cli.lang.as_deref(), cli.update_all, cli.json, &paths);
            } else {
                // No pattern provided, show help
                eprintln!("Usage: sg <PATTERN> [PATH...] or sg <COMMAND>");
                eprintln!("Try 'sg --help' for more information.");
                process::exit(1);
            }
        }
    }
}
