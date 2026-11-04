//! JSON string escaping shared by the qcmd -j output and the qsms envelopes.

/// JSON string escaping as jq emits it: \" \\ \b \f \n \r \t, other control
/// chars and DEL as \u00XX, everything else (UTF-8) verbatim.
pub fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

/// A small JSON object builder (ported from qmi_probe's `J`). Keys are
/// compile-time identifiers, so they are written unescaped; strings go
/// through `json_escape`. Absent values are `null`; a non-finite float is
/// `null` too, so the output never carries `NaN` or `N/A`.
pub struct J {
    s: String,
    first: bool,
}

#[allow(dead_code)]
impl J {
    pub fn obj() -> J {
        J { s: String::from("{"), first: true }
    }

    fn key(&mut self, k: &str) {
        if !self.first {
            self.s.push(',');
        }
        self.first = false;
        self.s.push('"');
        self.s.push_str(k);
        self.s.push_str("\":");
    }

    pub fn num<T: std::fmt::Display>(&mut self, k: &str, v: T) -> &mut J {
        self.key(k);
        self.s.push_str(&v.to_string());
        self
    }

    pub fn opt_num<T: std::fmt::Display>(&mut self, k: &str, v: Option<T>) -> &mut J {
        match v {
            Some(v) => self.num(k, v),
            None => self.null(k),
        }
    }

    /// One decimal place; null when not finite.
    pub fn f1(&mut self, k: &str, v: f64) -> &mut J {
        if !v.is_finite() {
            return self.null(k);
        }
        self.key(k);
        self.s.push_str(&format!("{:.1}", v));
        self
    }

    pub fn boolean(&mut self, k: &str, v: bool) -> &mut J {
        self.key(k);
        self.s.push_str(if v { "true" } else { "false" });
        self
    }

    pub fn opt_bool(&mut self, k: &str, v: Option<bool>) -> &mut J {
        match v {
            Some(v) => self.boolean(k, v),
            None => self.null(k),
        }
    }

    pub fn null(&mut self, k: &str) -> &mut J {
        self.key(k);
        self.s.push_str("null");
        self
    }

    pub fn str(&mut self, k: &str, v: &str) -> &mut J {
        self.key(k);
        self.s.push('"');
        self.s.push_str(&json_escape(v));
        self.s.push('"');
        self
    }

    pub fn opt_str(&mut self, k: &str, v: Option<&str>) -> &mut J {
        match v {
            Some(v) => self.str(k, v),
            None => self.null(k),
        }
    }

    /// An already-rendered JSON value.
    pub fn raw(&mut self, k: &str, json: &str) -> &mut J {
        self.key(k);
        self.s.push_str(json);
        self
    }

    pub fn done(&mut self) -> String {
        self.s.push('}');
        std::mem::take(&mut self.s)
    }
}

/// A JSON array from rendered items.
#[allow(dead_code)]
pub fn arr(items: &[String]) -> String {
    format!("[{}]", items.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builder_nulls_and_escapes() {
        let mut j = J::obj();
        j.num("a", 1).opt_num::<i32>("b", None).f1("c", f64::NAN).str("d", "x\"y").opt_bool("e", Some(true));
        assert_eq!(j.done(), "{\"a\":1,\"b\":null,\"c\":null,\"d\":\"x\\\"y\",\"e\":true}");
        assert_eq!(arr(&["1".into(), "2".into()]), "[1,2]");
    }

    #[test]
    fn escapes_quotes_and_controls() {
        assert_eq!(json_escape("a\"b\\c\u{1b}\u{7f}é"), "a\\\"b\\\\c\\u001b\\u007fé");
    }
}
