
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

pub struct Logger {
    file: Mutex<Option<std::fs::File>>,
    component: String,
}

#[allow(deprecated)] // libc::time_t is i32 on musl <1.2; harmless until 2038
fn format_timestamp() -> String {
    let mut t: libc::time_t = 0;
    unsafe { libc::time(&mut t); }
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::localtime_r(&t, &mut tm); }
    format!(
        "{}-{:02}-{:02} {:02}:{:02}:{:02}",
        tm.tm_year + 1900,
        tm.tm_mon + 1,
        tm.tm_mday,
        tm.tm_hour,
        tm.tm_min,
        tm.tm_sec,
    )
}

impl Logger {
    pub fn new(component: &str, log_path: &Path) -> Self {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .ok();
        Logger {
            file: Mutex::new(file),
            component: component.to_string(),
        }
    }

    fn write_line(&self, level: &str, msg: &str) {
        // Pad level to 5 chars to match qlog.sh alignment:
        //   INFO  -> "INFO "
        //   WARN  -> "WARN "
        //   ERROR -> "ERROR"
        //   DEBUG -> "DEBUG"
        let padded_level = match level {
            "INFO"  => "INFO ",
            "WARN"  => "WARN ",
            _       => level,   // ERROR and DEBUG are already 5 chars
        };
        let ts = format_timestamp();
        let pid = std::process::id();
        // Format: [TIMESTAMP] LEVEL [COMPONENT:PID] Message
        let line = format!("[{}] {} [{}:{}] {}\n", ts, padded_level, self.component, pid, msg);
        if let Ok(mut guard) = self.file.lock() {
            if let Some(f) = guard.as_mut() {
                let _ = f.write_all(line.as_bytes());
            }
        }
    }

    pub fn info(&self, msg: &str) { self.write_line("INFO", msg); }
    pub fn warn(&self, msg: &str) { self.write_line("WARN", msg); }
    pub fn error(&self, msg: &str) { self.write_line("ERROR", msg); }
    pub fn debug(&self, msg: &str) { self.write_line("DEBUG", msg); }

    pub fn state_change(&self, field: &str, old: &str, new: &str) {
        self.info(&format!("STATE: {}: {} \u{2192} {}", field, old, new));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::read_to_string;

    #[test]
    fn writes_log_line_with_component_and_level() {
        let dir = tempdir_unique();
        let path = dir.join("test.log");
        let pid = std::process::id();
        let log = Logger::new("ping", &path);
        log.info("hello");
        let content = read_to_string(&path).unwrap();
        // Format: [TIMESTAMP] INFO  [ping:4821] hello -- the number is the process ID
        let expected_component = format!("[ping:{}]", pid);
        assert!(content.contains(&expected_component), "got: {}", content);
        assert!(content.contains("INFO "), "got: {}", content);
        assert!(content.contains("hello"), "got: {}", content);
    }

    #[test]
    fn state_change_formats_arrow() {
        let dir = tempdir_unique();
        let path = dir.join("state.log");
        let log = Logger::new("ping", &path);
        log.state_change("reachable", "false", "true");
        let content = read_to_string(&path).unwrap();
        // Unicode arrow U+2192 matching qlog.sh line 244
        assert!(content.contains("STATE: reachable: false \u{2192} true"), "got: {}", content);
    }

    #[test]
    fn timestamp_is_human_readable() {
        let dir = tempdir_unique();
        let path = dir.join("ts.log");
        let log = Logger::new("ping", &path);
        log.info("x");
        let content = read_to_string(&path).unwrap();
        // Expect opening bracket with ISO-ish timestamp: [YYYY-MM-DD HH:MM:SS]
        let has_ts = content
            .lines()
            .next()
            .map(|line| {
                // Simple structural check: starts with '[', contains '-' and ':' in the right places
                line.starts_with('[')
                    && line.len() > 21
                    && line.chars().nth(5) == Some('-')   // year-month separator
                    && line.chars().nth(8) == Some('-')   // month-day separator
                    && line.chars().nth(11) == Some(' ')  // date-time separator
                    && line.chars().nth(14) == Some(':')  // hour:min separator
                    && line.chars().nth(17) == Some(':')  // min:sec separator
                    && line.chars().nth(20) == Some(']')  // closing bracket
            })
            .unwrap_or(false);
        assert!(has_ts, "timestamp not human-readable, got: {}", content);
    }

    fn tempdir_unique() -> std::path::PathBuf {
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let p = std::env::temp_dir().join(format!("qping-test-{}-{}", pid, nanos));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
}
