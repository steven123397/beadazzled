//! Small helpers shared across the crate.

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Poison is permanent on std Mutex; a panic here is exceptional under the no-unwrap/expect contract, so recover it rather than fail every later command.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Normalization core shared by registry keys and workspace-lock keys: drop
/// the Win32 `\\?\` prefix `canonicalize` adds, then fold case on Windows.
/// Each caller keeps its own separator trimming and canonicalization on
/// purpose — the two keys must keep their distinct granularity, and trimming
/// the canonical string again would change a drive-root key.
pub(crate) fn normalize_path_key(text: &str) -> String {
    let stripped = text.strip_prefix(r"\\?\").unwrap_or(text);
    if cfg!(windows) {
        stripped.to_lowercase()
    } else {
        stripped.to_owned()
    }
}

fn unix_now() -> Duration {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
}

pub(crate) fn unix_secs_now() -> u64 {
    unix_now().as_secs()
}

pub(crate) fn unix_millis_now() -> u64 {
    unix_now().as_millis() as u64
}

/// Current UTC time as the fixed-width string stored in `saved_at`.
pub(crate) fn now_iso() -> String {
    format_utc(unix_secs_now())
}

fn format_utc(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64;
    let remainder = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        remainder / 3_600,
        (remainder % 3_600) / 60,
        remainder % 60
    )
}

/// Howard Hinnant's `civil_from_days`.
///
/// Why no date crate: the only UTC conversion this app needs is a fixed-width
/// timestamp for display and backup filenames. A date dependency would add a
/// compiled library (and the audit/build surface that comes with it) for a
/// few dozen lines of integer arithmetic. Keeping the conversion here also
/// pins the exact string shape the wire and `config.json` already expect.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::format_utc;

    #[test]
    fn formats_unix_timestamps_as_utc_iso() {
        assert_eq!(format_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_utc(1_700_000_000), "2023-11-14T22:13:20Z");
    }
}
