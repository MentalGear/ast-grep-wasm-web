//! ast-grep CLI compiled with Emscripten for WebContainer/Node.js
//!
//! Build: Install emsdk, then:
//!   cargo build --target wasm32-unknown-emscripten --release
//!
//! Run in Node.js with wrapper (see playground-emscripten/run.js)

use std::env;
use std::fs;
use std::path::Path;
use std::process;

use ast_grep_language::{LanguageExt, SupportLang};
use serde::{Deserialize, Serialize};

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
        "json" => Some(SupportLang::Json),
        "yaml" | "yml" => Some(SupportLang::Yaml),
        "html" | "htm" => Some(SupportLang::Html),
        "css" => Some(SupportLang::Css),
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

        if name.starts_with('.')
            || matches!(
                name,
                "node_modules" | "target" | "dist" | "build" | "__pycache__"
            )
        {
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

const CONFIG_NAMES: &[&str] = &[
    "sgconfig.yml",
    "sgconfig.yaml",
    ".sgconfig.yml",
    ".sgconfig.yaml",
];

fn discover_config(start_path: &str) -> Option<String> {
    let mut current = Path::new(start_path);

    if current.is_file() {
        current = current.parent()?;
    }

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
    let content =
        fs::read_to_string(config_path).map_err(|e| format!("Failed to read config: {}", e))?;

    if let Ok(rules) = serde_yaml::from_str::<Vec<YamlRule>>(&content) {
        return Ok(rules);
    }

    let config: YamlConfig =
        serde_yaml::from_str(&content).map_err(|e| format!("Failed to parse YAML: {}", e))?;

    let mut all_rules = config.rules.unwrap_or_default();

    if let Some(rule_dirs) = config.rule_dirs {
        let config_dir = Path::new(config_path).parent().unwrap_or(Path::new("."));
        for dir in rule_dirs {
            let rule_dir = config_dir.join(&dir);
            if let Ok(entries) = fs::read_dir(&rule_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path
                        .extension()
                        .map(|e| e == "yml" || e == "yaml")
                        .unwrap_or(false)
                    {
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

fn run_pattern(
    pattern: &str,
    rewrite: Option<&str>,
    lang: Option<&str>,
    update_all: bool,
    json: bool,
    paths: &[String],
) {
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
                    let mut edits: Vec<(usize, usize, String)> = matches
                        .iter()
                        .map(|m| {
                            let edit = m.replace_by(rewrite_pattern);
                            let start = edit.position;
                            let end = edit.position + edit.deleted_length;
                            let replacement =
                                String::from_utf8_lossy(&edit.inserted_text).to_string();
                            (start, end, replacement)
                        })
                        .collect();

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
                                println!("Fixed: {}", file);
                            }
                            total_files += 1;
                        }
                    }
                    continue;
                }
            }

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
                            start: JsonPosition {
                                line: start_line,
                                column: start_col,
                                offset: range.start,
                            },
                            end: JsonPosition {
                                line: end_line,
                                column: end_col,
                                offset: range.end,
                            },
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
                println!("{}", file);
                for m in &matches {
                    let range = m.range();
                    let (line, _col) = byte_to_position(&content, range.start);
                    let text = m.text();
                    let preview: String = text.lines().next().unwrap_or("").chars().take(80).collect();
                    println!("  {:4} | {}", line, preview);
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
    let config_path = match config_path {
        Some(p) => p.to_string(),
        None => {
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
                                start: JsonPosition {
                                    line: start_line,
                                    column: start_col,
                                    offset: range.start,
                                },
                                end: JsonPosition {
                                    line: end_line,
                                    column: end_col,
                                    offset: range.end,
                                },
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
                    println!(
                        "{}: {} [{}] ({} match{})",
                        file,
                        rule.id,
                        rule.severity,
                        count,
                        if count > 1 { "es" } else { "" }
                    );

                    if let Some(msg) = &rule.message {
                        println!("  {}", msg);
                    }
                }

                if update_all {
                    if let Some(fix) = &rule.fix {
                        let mut edits: Vec<(usize, usize, String)> = matches
                            .iter()
                            .map(|m| {
                                let edit = m.replace_by(fix.as_str());
                                let start = edit.position;
                                let end = edit.position + edit.deleted_length;
                                let replacement =
                                    String::from_utf8_lossy(&edit.inserted_text).to_string();
                                (start, end, replacement)
                            })
                            .collect();

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

fn print_help() {
    println!("ast-grep Emscripten CLI");
    println!();
    println!("USAGE:");
    println!("  sg <PATTERN> [PATH...]           Search for pattern");
    println!("  sg run -p <PATTERN> [PATH...]    Search for pattern");
    println!("  sg scan [-c CONFIG] [PATH...]    Scan with rules");
    println!();
    println!("OPTIONS:");
    println!("  -p, --pattern <PATTERN>   AST pattern to search");
    println!("  -r, --rewrite <REWRITE>   Replacement pattern");
    println!("  -l, --lang <LANG>         Language (typescript, javascript, etc.)");
    println!("  -c, --config <FILE>       Rules file (YAML)");
    println!("  -U, --update-all          Apply all fixes");
    println!("  --json                    Output as JSON");
    println!("  -h, --help                Show this help");
    println!();
    println!("EXAMPLES:");
    println!("  sg 'console.log($$$ARGS)' ./src");
    println!("  sg run -p 'var $X = $Y' -r 'let $X = $Y' -U ./src");
    println!("  sg scan -c rules.yml ./src");
}

// ============================================================================
// MAIN - Simple argument parsing for Emscripten compatibility
// ============================================================================

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        print_help();
        process::exit(1);
    }

    // Parse arguments manually for maximum compatibility
    let mut i = 1;
    let mut command: Option<&str> = None;
    let mut pattern: Option<String> = None;
    let mut rewrite: Option<String> = None;
    let mut lang: Option<String> = None;
    let mut config: Option<String> = None;
    let mut update_all = false;
    let mut json = false;
    let mut paths: Vec<String> = Vec::new();

    // Check for subcommand
    if args.len() > 1 {
        match args[1].as_str() {
            "run" | "scan" | "help" | "version" => {
                command = Some(&args[1]);
                i = 2;
            }
            _ => {}
        }
    }

    // Parse remaining arguments
    while i < args.len() {
        let arg = &args[i];
        match arg.as_str() {
            "-h" | "--help" => {
                print_help();
                process::exit(0);
            }
            "-p" | "--pattern" => {
                i += 1;
                if i < args.len() {
                    pattern = Some(args[i].clone());
                }
            }
            "-r" | "--rewrite" => {
                i += 1;
                if i < args.len() {
                    rewrite = Some(args[i].clone());
                }
            }
            "-l" | "--lang" => {
                i += 1;
                if i < args.len() {
                    lang = Some(args[i].clone());
                }
            }
            "-c" | "--config" => {
                i += 1;
                if i < args.len() {
                    config = Some(args[i].clone());
                }
            }
            "-U" | "--update-all" => {
                update_all = true;
            }
            "--json" => {
                json = true;
            }
            "version" | "--version" => {
                println!("sg 0.1.0 (ast-grep Emscripten)");
                process::exit(0);
            }
            _ => {
                if !arg.starts_with('-') {
                    // First non-option might be pattern (shorthand) or path
                    if pattern.is_none() && command.is_none() {
                        pattern = Some(arg.clone());
                    } else {
                        paths.push(arg.clone());
                    }
                }
            }
        }
        i += 1;
    }

    // Default path
    if paths.is_empty() {
        paths.push(".".to_string());
    }

    // Execute command
    match command {
        Some("run") => {
            let p = pattern.unwrap_or_else(|| {
                eprintln!("Error: -p/--pattern required for 'run' command");
                process::exit(1);
            });
            run_pattern(&p, rewrite.as_deref(), lang.as_deref(), update_all, json, &paths);
        }
        Some("scan") => {
            run_scan(config.as_deref(), update_all, json, &paths);
        }
        Some("help") => {
            print_help();
        }
        Some("version") => {
            println!("sg 0.1.0 (ast-grep Emscripten)");
        }
        None => {
            // Shorthand mode
            if let Some(p) = pattern {
                run_pattern(&p, rewrite.as_deref(), lang.as_deref(), update_all, json, &paths);
            } else {
                print_help();
                process::exit(1);
            }
        }
        _ => {
            print_help();
            process::exit(1);
        }
    }
}
